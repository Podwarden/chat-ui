'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { chatsKey, useAdapters } from '../adapters/context';
import type { AttachmentOut, ChatSettings, ChatSummary, TurnRequest } from '../adapters/types';
import type { ChatEvent, ErrorCode, FinishReason } from '../contract/events';
import { emptyThread, fromServerMessage, reduceEvent, type Message, type Part, type ThreadState } from '../model/message';
import { TICKET_REFRESH_MS } from '../model/limits';

export type Phase = 'idle' | 'loading' | 'streaming' | 'error';
export interface LastError { code: ErrorCode; message: string; retryable: boolean }

function newId(): string { return crypto.randomUUID(); }

/** Per-turn bookkeeping. Held on an object so TS does not narrow these away
 *  across the `await sendTurn(...)` that mutates them from its callback. */
interface TurnFlags { persisted: boolean; sawDone: boolean; sawError: boolean; tailId: string | null }

/**
 * One chat thread plus its in-flight turn.
 *
 * Frame order is fixed by the backend (app/chat2/routes_turn.py `gen()`): the
 * `message-persisted` rows, `message-start` and the opening `context` are all
 * yielded *before* upstream status is known. So "did the stream start?" says
 * nothing about success — an upstream pre-stream failure emits those three and
 * then a single terminal `error` with **no** `done`. Three facts drive every
 * decision here:
 *   - `persisted` — a `message-persisted` frame arrived, so the user/tool row
 *     really is in the database (the optimistic row must be kept, and a retry
 *     of this turn is a `regenerate`, not a resend);
 *   - `sawError` / `sawDone` — the stream ended on an error frame with no
 *     `done`, i.e. the turn failed; and if neither arrived the connection
 *     simply dropped, which is reported as `interrupted` + a retryable
 *     `upstream` error so the UI can offer Retry.
 *
 * The streamed reducer state is authoritative for `messages`/`context` once a
 * turn has run: the SSE carries the server ids, so re-reading
 * `GET /chats/{id}` afterwards would only risk clobbering fresher local state.
 * The post-turn refresh therefore updates metadata (chat title/settings/cost,
 * the attachment map with its freshly signed URLs) and reconciles `seq` — the
 * assistant row streams as `seq: -1` and only gets its real sequence number
 * when the row is persisted. A full reload happens on mount, on `chatId`
 * change, on an explicit `reload()`, and on focus once the signed URLs are
 * close to expiring.
 *
 * ## Switching chats
 *
 * There is exactly one rule, and it is enforced synchronously: **when `chatId`
 * changes, everything belonging to the old chat is destroyed before any await**
 * — the in-flight turn is aborted, `state`/`chat`/`attachments`/`lastError` are
 * emptied and `phase` goes to 'loading'. Nothing that was in flight for the old
 * chat may then write anything: the aborted turn's continuation sees
 * `chatIdRef.current !== turnChatId` and simply returns, and a stale `getChat`
 * (resolved or rejected) sees `chatIdRef.current !== forChatId` and returns.
 * They own nothing any more, so they have nothing to release.
 *
 * The mirror-image hazard — a turn started in the NEW chat while that chat's
 * own detail is still in flight — is handled by ownership rather than by
 * timing: `turnChatIdRef` names the chat with a live turn, and a full load only
 * merges (keeping the optimistic row and the streaming tail) when the live turn
 * belongs to the chat it is loading. Otherwise it re-seeds.
 *
 * ## Detached turns
 *
 * The backend keeps generating after the socket dies (app/chat2/live.py), so
 * navigating away, switching chats or reloading never kills an answer —
 * aborting the local reader only detaches. A full load whose detail carries
 * `live_turn` re-attaches via `GET .../turn/live` through `runStream`, which
 * claims the same ownership refs (`turnChatIdRef`, `controllerRef`) a locally
 * started turn would, so every rule above applies unchanged. Only `abort()`
 * (and the supersede path in `runStream`) truly stops a turn, via
 * `POST .../turn/abort`.
 */
export function useChatThread(chatId: string | null) {
  // Latest-value ref, NOT a dependency. A host that re-renders its
  // <AdaptersProvider> with a freshly-built Adapters object would otherwise
  // change `load`'s identity, which the chat-switch effect below depends on —
  // aborting a live stream and wiping the thread on a re-render that has
  // nothing to do with this chat. Ownership here is keyed on `chatId` alone;
  // the adapters are just where the network lives.
  const adapters = useAdapters();
  const adaptersRef = useRef(adapters);
  adaptersRef.current = adapters;
  const [chat, setChat] = useState<ChatSummary | null>(null);
  const [state, setState] = useState<ThreadState>(() => emptyThread([], null));
  const [attachments, setAttachments] = useState<Record<string, AttachmentOut>>({});
  const [phase, setPhase] = useState<Phase>(chatId ? 'loading' : 'idle');
  const [lastError, setLastError] = useState<LastError | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const loadedAtRef = useRef(0);
  const lastTurnRef = useRef<{ req: TurnRequest; optimistic: Message | null; flags: TurnFlags } | null>(null);
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  // the chat that currently has a live turn, or null. Set in `runStream`'s
  // prologue, cleared when the turn ends and by the chat-switch reset.
  const turnChatIdRef = useRef<string | null>(null);
  // `load` runs before `runStream` is defined (and must not depend on it, or
  // every finished turn would re-create the whole callback chain); the ref is
  // refreshed each render so `load` can kick off a re-attach.
  const runStreamRef = useRef<((
    turnChatId: string,
    doStream: (onEvent: (e: ChatEvent) => void, signal: AbortSignal) => Promise<void>,
    optimistic: Message | null,
    req: TurnRequest | null,
  ) => Promise<void>) | null>(null);
  const { mutate } = useSWRConfig();

  const load = useCallback(async (full: boolean) => {
    const forChatId = chatId;
    if (!forChatId) return;
    // A live turn in THIS chat owns `phase` ('streaming'); a load must not
    // pull it back to 'loading'/'idle' underneath it.
    const owned = () => turnChatIdRef.current === forChatId;
    if (full) setPhase((p) => (owned() ? p : 'loading'));
    const d = await adaptersRef.current.storage.getChat(forChatId);
    // The user switched away while this load was in flight: its payload belongs
    // to a chat that is no longer on screen, and the switch has already reset
    // every piece of state this function would write.
    if (chatIdRef.current !== forChatId) return;
    setChat(d.chat);
    setAttachments(Object.fromEntries(d.attachments.map((a) => [a.id, a])));
    if (full) {
      const serverMessages = d.messages.map(fromServerMessage);
      const serverContext = { promptTokens: d.context.promptTokens, window: d.context.window, full: d.context.full };
      // A turn started in this chat before its detail landed (or while a
      // same-chat refresh was in flight) owns rows the payload cannot know
      // about: the optimistic user row and the streaming tail. Keep those and
      // take the server's history underneath them. With no live turn of our
      // own there is nothing local worth keeping — re-seed.
      const live = owned();
      setState((prev) => {
        if (!live) return emptyThread(serverMessages, serverContext);
        const known = new Set(serverMessages.map((m) => m.id));
        return {
          ...prev,
          messages: [...serverMessages, ...prev.messages.filter((m) => !known.has(m.id))],
          context: prev.context ?? serverContext,
        };
      });
      // A detached turn is still streaming server-side for this chat (a
      // reload, or a return to a chat left mid-answer): re-attach to it
      // through the same reducer/ownership machinery a locally-started turn
      // uses — `runStream` sets `turnChatIdRef`/`controllerRef` synchronously,
      // so chat-switch teardown and the phase guard below both see it.
      const lt = d.live_turn;
      if (lt && !owned() && !controllerRef.current) {
        void runStreamRef.current?.(
          forChatId,
          (onEvent, signal) => adaptersRef.current.transport.attachLiveTurn(forChatId, lt.message_id, onEvent, signal),
          null, null,
        );
      }
    } else {
      // reconcile `seq` only (the streamed rows carry `seq: -1` until persisted);
      // parts/usage/finishReason stay as streamed
      const seqById = new Map(d.messages.map((m) => [m.id, m.seq]));
      setState((prev) => {
        let changed = false;
        const messages = prev.messages.map((m) => {
          const seq = seqById.get(m.id);
          if (seq === undefined || seq === m.seq) return m;
          changed = true;
          return { ...m, seq };
        });
        return changed ? { ...prev, messages } : prev;
      });
    }
    loadedAtRef.current = Date.now();
    if (full) setPhase((p) => (owned() ? p : 'idle'));
  }, [chatId]);

  const reload = useCallback(() => load(true), [load]);

  // `chatId` changed: destroy the old chat's world SYNCHRONOUSLY, before any
  // await, then load the new one. Everything still in flight for the old chat
  // is now ownerless and will bail out without writing.
  useEffect(() => {
    const forChatId = chatId;
    controllerRef.current?.abort();
    controllerRef.current = null;
    turnChatIdRef.current = null;
    lastTurnRef.current = null;
    loadedAtRef.current = 0;
    setState(emptyThread([], null));
    setChat(null);
    setAttachments({});
    setLastError(null);
    setPhase(forChatId ? 'loading' : 'idle');
    void load(true).catch((e: Error) => {
      // a rejection for a chat the user has since left must not surface as an
      // error over the chat now on screen
      if (chatIdRef.current !== forChatId) return;
      setPhase('error');
      setLastError({ code: 'internal', message: e.message, retryable: true });
    });
    return () => { controllerRef.current?.abort(); };
  }, [chatId, load]);

  // Signed attachment URLs expire after SIGNED_URL_TTL_S; refresh the page when
  // it regains focus and the tickets are stale (spec §9).
  useEffect(() => {
    const onFocus = () => {
      if (chatId && phase !== 'streaming' && loadedAtRef.current > 0 && Date.now() - loadedAtRef.current > TICKET_REFRESH_MS) {
        void reload().catch(() => undefined);
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [chatId, phase, reload]);

  /**
   * Run one event stream — a locally-started turn (`sendTurn`) or a
   * re-attached detached one (`attachLiveTurn`) — through the shared
   * reducer/ownership/commit machinery. `req` is null for a re-attach: there
   * is nothing to retry with, so `lastTurnRef` is cleared instead of seeded.
   */
  const runStream = useCallback(async (
    turnChatId: string,
    doStream: (onEvent: (e: ChatEvent) => void, signal: AbortSignal) => Promise<void>,
    optimistic: Message | null,
    req: TurnRequest | null,
  ) => {
    if (controllerRef.current) {
      // A turn is already in flight in this chat (abort-then-resend, or a
      // second send racing the first). Commit its partial tail HERE, before
      // the new optimistic row is appended, so the aborted answer keeps its
      // place in the transcript — the superseded turn's own continuation runs
      // a microtask later, by which time the new row is already in `messages`.
      controllerRef.current.abort();
      controllerRef.current = null;
      setState((s) => (s.pendingTail
        ? reduceEvent(s, { type: 'done', messageId: s.pendingTail.id, finishReason: 'aborted' }, Date.now)
        : s));
      // The server-side runner no longer dies with the local reader: it must
      // be stopped explicitly, and WAITED for — the abort endpoint answers
      // only once the chat's turn lock is free, so the POST below cannot race
      // a 409 turn_in_flight against our own superseded turn.
      await adaptersRef.current.transport.abortTurn(turnChatId);
      if (chatIdRef.current !== turnChatId) return; // switched away during the await
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    turnChatIdRef.current = turnChatId;
    const flags: TurnFlags = { persisted: false, sawDone: false, sawError: false, tailId: null };
    lastTurnRef.current = req ? { req, optimistic, flags } : null;
    setLastError(null);
    setPhase('streaming');
    if (optimistic) setState((s) => ({ ...s, messages: [...s.messages, optimistic] }));

    const onEvent = (ev: ChatEvent) => {
      if (ev.type === 'message-persisted') flags.persisted = true;
      if (ev.type === 'message-start') flags.tailId = ev.messageId;
      if (ev.type === 'done') flags.sawDone = true;
      if (ev.type === 'error') {
        flags.sawError = true;
        setLastError({ code: ev.code, message: ev.message, retryable: ev.retryable });
      }
      setState((s) => {
        let next = reduceEvent(s, ev, Date.now);
        if (ev.type === 'message-persisted' && optimistic) {
          // reconcile the optimistic row with its server id/seq
          next = {
            ...next,
            messages: next.messages.map((m) => (m.id === optimistic.id ? { ...m, id: ev.messageId, seq: ev.seq } : m)),
            pendingAck: null,
          };
        }
        return next;
      });
    };

    await doStream(onEvent, controller.signal);

    // The user switched chats while this turn was streaming. The switch effect
    // already aborted this controller, nulled `controllerRef`/`turnChatIdRef`,
    // emptied `state` and set `phase` for the new chat — this turn owns nothing
    // and must touch nothing. The DETACHED runner keeps streaming server-side;
    // the next load of that chat re-attaches to it (or finds the finished row).
    if (chatIdRef.current !== turnChatId) return;

    const superseded = controllerRef.current !== controller;
    const aborted = controller.signal.aborted;
    // The stream can end without `done`: the user aborted, a terminal `error`
    // frame arrived, or the connection simply dropped (no terminal frame at
    // all). The tail must be committed in every case, never left dangling.
    const dropped = !aborted && !superseded && !flags.sawDone && !flags.sawError;
    const finishReason: FinishReason = aborted || superseded ? 'aborted' : flags.sawError ? 'error' : 'interrupted';

    setState((s) => {
      let next = s;
      // Only ever commit the tail THIS turn started — a superseded turn's tail
      // was already committed by the turn that replaced it, and `pendingTail`
      // may by now belong to that newer turn.
      if (next.pendingTail && next.pendingTail.id === flags.tailId) {
        next = reduceEvent(next, { type: 'done', messageId: next.pendingTail.id, finishReason }, Date.now);
      }
      // Nothing was persisted server-side (a pre-flight rejection: 409
      // context_full, 429, a network error) — the optimistic row is a lie.
      if (!flags.persisted && optimistic) {
        next = { ...next, messages: next.messages.filter((m) => m.id !== optimistic.id) };
      }
      return next;
    });

    // A newer turn in this same chat owns the controller, the phase and the
    // refresh now. Its partial tail and optimistic row were reconciled above;
    // everything else is the newer turn's to manage.
    if (superseded) return;

    controllerRef.current = null;
    turnChatIdRef.current = null;
    if (dropped) setLastError({ code: 'upstream', message: 'connection lost', retryable: true });
    setPhase(dropped || (flags.sawError && !flags.sawDone) ? 'error' : 'idle');
    // the server may have retitled the chat and bound the draft attachments
    void mutate(chatsKey(adaptersRef.current));
    // only worth a round trip if the turn actually wrote something
    if (flags.persisted || flags.sawDone) await load(false).catch(() => undefined);
  }, [load, mutate]);

  const runTurn = useCallback(async (req: TurnRequest, optimistic: Message | null) => {
    const turnChatId = chatId;
    if (!turnChatId) return;
    await runStream(turnChatId, (onEvent, signal) => adaptersRef.current.transport.sendTurn(req, onEvent, signal), optimistic, req);
  }, [chatId, runStream]);
  runStreamRef.current = runStream;

  const send = useCallback(async (text: string, attachmentIds: string[], attachmentMeta: AttachmentOut[] = []) => {
    if (!chatId) return;
    // "image expired" right after pasting (user report): the optimistic user
    // row references attachment ids, but the thread's attachment map only
    // fills from a full load() — which doesn't happen until the turn ends. Seed
    // the map from the composer's freshly-uploaded rows (signed URLs included)
    // so the image renders from the very first frame.
    if (attachmentMeta.length) {
      setAttachments((prev) => ({ ...prev, ...Object.fromEntries(attachmentMeta.map((a) => [a.id, a])) }));
    }
    const parts: Part[] = [{ type: 'text', text }, ...attachmentIds.map((id) => ({ type: 'image' as const, attachmentId: id }))];
    const optimistic: Message = {
      id: `local-${newId()}`, seq: Number.MAX_SAFE_INTEGER, role: 'user', parts, createdAt: new Date().toISOString(),
    };
    await runTurn({ chatId, requestId: newId(), userParts: [{ type: 'text', text }], attachmentIds }, optimistic);
  }, [chatId, runTurn]);

  const sendPlain = useCallback((text: string) => send(text, []), [send]);

  const answerOptions = useCallback(async (callId: string, selected: string[]) => {
    if (!chatId) return;
    setState((s) => ({
      ...s,
      messages: s.messages.map((m) => (m.parts.some((p) => p.type === 'options' && p.callId === callId)
        ? { ...m, parts: m.parts.map((p) => (p.type === 'options' && p.callId === callId ? { ...p, answered: selected } : p)) }
        : m)),
    }));
    const optimistic: Message = {
      id: `local-${newId()}`, seq: Number.MAX_SAFE_INTEGER, role: 'tool',
      parts: [{ type: 'tool_result', callId, result: { selected }, ok: true }], createdAt: new Date().toISOString(),
    };
    await runTurn({ chatId, requestId: newId(), toolResults: [{ call_id: callId, result: { selected } }] }, optimistic);
  }, [chatId, runTurn]);

  const regenerate = useCallback(async () => {
    if (!chatId) return;
    setState((s) => {
      const last = s.messages.at(-1);
      return last?.role === 'assistant' ? { ...s, messages: s.messages.slice(0, -1) } : s;
    });
    await runTurn({ chatId, requestId: newId(), regenerate: true }, null);
  }, [chatId, runTurn]);

  const retry = useCallback(async () => {
    const prev = lastTurnRef.current;
    if (!prev) return;
    // Whether the *previous turn* wrote its user/tool row decides the shape of
    // the retry: once `message-persisted` has arrived the row is in the
    // database, so resending `user_parts` would duplicate it — that retry is a
    // regenerate. Only a turn that never persisted resends the same body.
    // Either way a FRESH request_id is minted: every failed turn still writes a
    // ledger row, so reusing the id would replay a bare `done` (spec §9.1).
    if (prev.flags.persisted) { await regenerate(); return; }
    setState((s) => ({ ...s, messages: s.messages.filter((m) => !m.id.startsWith('err-')) }));
    const optimistic = prev.optimistic ? { ...prev.optimistic, id: `local-${newId()}` } : null;
    await runTurn({ ...prev.req, requestId: newId() }, optimistic);
  }, [regenerate, runTurn]);

  const abort = useCallback(() => {
    // Stop the server-side runner too — the reader abort alone only detaches
    // now. Fire-and-forget: the local commit below must not wait on the
    // network, and the endpoint 404s harmlessly if the turn already ended.
    const liveChatId = turnChatIdRef.current;
    if (liveChatId) void adaptersRef.current.transport.abortTurn(liveChatId);
    controllerRef.current?.abort();
  }, []);

  const updateSettings = useCallback(async (patch: { model?: string; settings?: Partial<ChatSettings> }) => {
    if (!chatId) return;
    const c = await adaptersRef.current.storage.patchChat(chatId, patch);
    setChat(c);
    void mutate(chatsKey(adaptersRef.current));
  }, [chatId, mutate]);

  return useMemo(() => ({
    chat, state, attachments, phase, lastError,
    send, sendPlain, answerOptions, regenerate, retry, abort, updateSettings, reload,
  }), [chat, state, attachments, phase, lastError, send, sendPlain, answerOptions, regenerate, retry, abort, updateSettings, reload]);
}
