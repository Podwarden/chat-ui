/**
 * `@podwarden/chat-ui/conformance` — a runnable contract suite (spec §5.7).
 *
 * A host that implements `/api/chat2/*` proves it speaks the contract by
 * adding one test file:
 *
 * ```ts
 * import { runConformance } from '@podwarden/chat-ui/conformance';
 * runConformance({ baseUrl: 'http://127.0.0.1:8000/api/chat2', fetch: authedFetch });
 * ```
 *
 * `runConformance` registers `describe`/`it` blocks in the calling file — it
 * does not run anything itself, so the host's own reporter, retries and CI
 * wiring all apply unchanged.
 *
 * Three rules keep it usable against a LIVE server, not just a fixture:
 *   - every request goes through the injected `fetch` and `baseUrl`. There is
 *     no direct network access, no hard-coded host and no opinion about
 *     authentication: whatever headers the host's `fetch` adds are the headers
 *     that go out.
 *   - no timer waits longer than a few hundred milliseconds, and every `it`
 *     gets a generous 10 s budget, because a real backend talking to a real
 *     model is slower than any mock.
 *   - every assertion pins a WIRE fact — a status, an envelope, a frame order.
 *     Nothing here asserts on server internals, storage or timing.
 *
 * `describe`/`it`/`expect` are imported from `vitest` explicitly rather than
 * taken from globals, so a host with `globals: false` can use the kit as-is.
 * That import is the only test-runner coupling in this file.
 *
 * The suite CLEANS UP AFTER ITSELF: every chat it creates is tracked and
 * best-effort deleted in an `afterAll`, and the `defaults` group restores what
 * it wrote, so pointing the kit at a live server leaves that server as found.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createHttpAdapters } from '../adapters/http';
import { readError } from '../adapters/errors';
import type { ChatDetail, ChatSettings, ChatSummary, ModelInfo } from '../contract/types';
import type { ChatEvent } from '../contract/events';
import { CONTRACT_VERSION } from '../contract/version';
import { parseSseStream } from '../model/wire';

export interface ConformanceFixtures {
  /** Model to pin turns to. Defaults to whatever the backend's own defaults say. */
  modelId?: string;
  /**
   * A prompt long enough that the backend is still streaming a beat later.
   * The `abort` and `live-replay` groups need a turn they can act on
   * mid-flight; override this when the default is answered too quickly.
   */
  makeLongPrompt?: () => string;
  /** Force-skip the `attachments` group (no image support, or no fixture image). */
  skipAttachments?: boolean;
}

/** Per-test budget. Real backends are slower than mocks; be generous. */
const TIMEOUT_MS = 10_000;
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const SSE_HEADERS = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };

/** A 1x1 transparent PNG, for the attachment round-trip. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function runConformance(opts: {
  baseUrl: string;
  fetch: typeof fetch;
  fixtures?: ConformanceFixtures;
}): void {
  const { baseUrl, fixtures = {} } = opts;
  const call = opts.fetch;
  const adapters = createHttpAdapters({ baseUrl, fetch: call });
  const longPrompt = fixtures.makeLongPrompt
    ?? (() => 'Tell me, at length and in detail, a story about a lighthouse keeper. '.repeat(8));

  const url = (p: string) => `${baseUrl}${p}`;

  /** `request_id` is 8..64 chars on the wire (TurnBody); stay well inside. */
  const rid = (tag: string) => `conf-${tag}-${Math.random().toString(36).slice(2, 10)}`;

  const sleep = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

  async function waitFor(pred: () => boolean, budgetMs = 5_000): Promise<void> {
    const deadline = Date.now() + budgetMs;
    while (!pred()) {
      if (Date.now() > deadline) throw new Error('timed out waiting for a stream frame');
      await sleep(5);
    }
  }

  /**
   * Every chat this suite brings into existence, so `afterAll` can take it away
   * again. A live server is somebody's real instance — the kit must not leave a
   * drift of "New chat" rows behind it.
   */
  const createdChats = new Set<string>();
  const track = <T extends { id?: unknown }>(chat: T): T => {
    if (typeof chat.id === 'string') createdChats.add(chat.id);
    return chat;
  };

  async function createChat(): Promise<ChatSummary> {
    const r = await call(url('/chats'), {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify(fixtures.modelId ? { model: fixtures.modelId } : {}),
    });
    expect(r.status).toBe(201);
    return track((await r.json()) as ChatSummary);
  }

  /**
   * Skip the current test, saying why.
   *
   * vitest 2's `TestContext.skip` is typed `() => void` and hardcodes its own
   * message; vitest 3+ accepts a note. Passing the reason through a widened
   * signature is inert on 2.x (JS drops the extra argument) and picked up on
   * 3+, and the `console.info` makes the reason visible on either.
   */
  function skipWith(ctx: { skip: () => void }, reason: string): never {
    console.info(`[conformance] skipped: ${reason}`);
    (ctx.skip as (note?: string) => void)(reason);
    throw new Error('unreachable: ctx.skip() throws');
  }

  afterAll(async () => {
    // Best-effort: a chat the `chats` group already deleted 404s here, and a
    // teardown failure must never turn a green suite red.
    await Promise.all([...createdChats].map((id) =>
      call(url(`/chats/${id}`), { method: 'DELETE' }).catch(() => undefined)));
    createdChats.clear();
  });

  function openTurn(chatId: string, text: string, requestId: string): Promise<Response> {
    return call(url(`/chats/${chatId}/turns`), {
      method: 'POST', headers: SSE_HEADERS,
      body: JSON.stringify({
        request_id: requestId, user_parts: [{ type: 'text', text }],
        attachment_ids: [], regenerate: false,
      }),
    });
  }

  /** Drain an SSE response through the shipped parser and keep every event. */
  async function collect(r: Response): Promise<ChatEvent[]> {
    const out: ChatEvent[] = [];
    if (!r.body) return out;
    for await (const e of parseSseStream(r.body)) out.push(e);
    return out;
  }

  /**
   * The first `n` RAW frame blocks of a stream, `data:` prefix and all — the
   * only way to prove `turn/live` replays bytes rather than re-rendering
   * equivalent JSON.
   */
  async function rawFrames(r: Response, n: number): Promise<string[]> {
    if (!r.body) return [];
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    const frames: string[] = [];
    let buf = '';
    try {
      while (frames.length < n) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true }).replace(/\r/g, '');
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          // Keep only real event blocks: SSE comments (`: keep-alive`) and
          // bare heartbeats carry no `data:` line and must not be compared.
          if (p.split('\n').some((l) => l.startsWith('data:'))) frames.push(p);
          if (frames.length >= n) break;
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return frames.slice(0, n);
  }

  const types = (events: ChatEvent[]) => events.map((e) => e.type);

  // ------------------------------------------------------------------ whoami

  describe('conformance: whoami', () => {
    it('GET /_whoami answers the caller identity and a contract version this package understands', async () => {
      const r = await call(url('/_whoami'));
      expect(r.status).toBe(200);
      const body = (await r.json()) as { user_id?: unknown; contract?: unknown };
      // String OR number: vLLM Warden's users are integer primary keys, PodWarden
      // Hub's are UUIDs. The contract only requires that the id identify the
      // caller and compare equal to `ChatSummary.owner.id`; it does not pick a
      // representation, so the kit must not either.
      expect(['string', 'number']).toContain(typeof body.user_id);
      expect(typeof body.contract).toBe('string');
      // Same major = the frames and envelopes asserted below are the ones this
      // package was built against.
      expect(String(body.contract).startsWith(`${CONTRACT_VERSION.split('.')[0]}.`)).toBe(true);
    }, TIMEOUT_MS);
  });

  // ------------------------------------------------------------------- chats

  describe('conformance: chats', () => {
    it('POST /chats answers 201 with a chat summary', async () => {
      const chat = await createChat();
      expect(typeof chat.id).toBe('string');
      expect(typeof chat.title).toBe('string');
      expect(chat).toHaveProperty('title_source');
      expect(chat).toHaveProperty('settings');
      expect(chat).toHaveProperty('created_at');
      expect(chat.forked_from_chat_id).toBeNull();
      const listed = await adapters.storage.listChats();
      expect(listed.some((c) => c.id === chat.id)).toBe(true);
    }, TIMEOUT_MS);

    it('GET /chats/{id} answers the {chat, messages, attachments, context} envelope', async () => {
      const chat = await createChat();
      const r = await call(url(`/chats/${chat.id}`));
      expect(r.status).toBe(200);
      const detail = (await r.json()) as ChatDetail;
      expect(detail.chat.id).toBe(chat.id);
      expect(Array.isArray(detail.messages)).toBe(true);
      expect(Array.isArray(detail.attachments)).toBe(true);
      expect(detail.context.type).toBe('context');
      expect(typeof detail.context.promptTokens).toBe('number');
      // Optional on the wire (a backend from before #240 omits it), but when
      // it is there it is the boolean the UI trusts over the catalog.
      if ('model_loaded' in detail.chat) expect(typeof detail.chat.model_loaded).toBe('boolean');
    }, TIMEOUT_MS);

    it('PATCH /chats/{id} answers 200 with the updated title', async () => {
      const chat = await createChat();
      const r = await call(url(`/chats/${chat.id}`), {
        method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ title: 'renamed by conformance' }),
      });
      expect(r.status).toBe(200);
      const updated = (await r.json()) as ChatSummary;
      expect(updated.title).toBe('renamed by conformance');
      expect(updated.title_source).toBe('user');
    }, TIMEOUT_MS);

    it('DELETE /chats/{id} answers 204 and the chat is gone', async () => {
      const chat = await createChat();
      const r = await call(url(`/chats/${chat.id}`), { method: 'DELETE' });
      expect(r.status).toBe(204);
      const after = await call(url(`/chats/${chat.id}`));
      expect(after.status).toBe(404);
    }, TIMEOUT_MS);

    it('a missing chat id is a 404 carrying {detail:{code:"not_found"}}', async () => {
      const r = await call(url('/chats/definitely-not-a-chat-id'));
      expect(r.status).toBe(404);
      const e = await readError(r);
      expect(e.status).toBe(404);
      expect(e.code).toBe('not_found');
      expect(typeof e.message).toBe('string');
      expect(e.message.length).toBeGreaterThan(0);
    }, TIMEOUT_MS);
  });

  // ------------------------------------------------------------------ models

  describe('conformance: models', () => {
    it('GET /models answers {models: ModelInfo[]} — the LOADED catalog the picker renders from', async () => {
      const r = await call(url('/models'));
      expect(r.status).toBe(200);
      const body = (await r.json()) as { models?: unknown };
      expect(Array.isArray(body.models)).toBe(true);
      for (const m of body.models as ModelInfo[]) {
        expect(typeof m.id).toBe('string');
        expect(typeof m.display).toBe('string');
        for (const k of ['supports_tools', 'supports_vision', 'supports_reasoning'] as const) {
          expect(typeof m[k]).toBe('boolean');
        }
        // Optional (pre-#241 backends omit it); the panel renders it verbatim,
        // so it has to be a list of strings and nothing else.
        if (m.reasoning_efforts !== undefined) {
          expect(Array.isArray(m.reasoning_efforts)).toBe(true);
          for (const lv of m.reasoning_efforts) expect(typeof lv).toBe('string');
        }
      }
      // The adapter unwraps the envelope to the list itself.
      await expect(adapters.models.listModels()).resolves.toEqual(body.models);
    }, TIMEOUT_MS);
  });

  // ---------------------------------------------------------------- defaults

  describe('conformance: defaults', () => {
    it('GET /defaults answers {model, settings} with the full settings shape', async () => {
      const r = await call(url('/defaults'));
      expect(r.status).toBe(200);
      const body = (await r.json()) as { model: string | null; settings: ChatSettings };
      expect(body).toHaveProperty('model');
      for (const k of ['temperature', 'max_tokens', 'top_p', 'system_prompt', 'enabled_tools', 'enabled_skills']) {
        expect(body.settings).toHaveProperty(k);
      }
      expect(Array.isArray(body.settings.enabled_tools)).toBe(true);
    }, TIMEOUT_MS);

    it('PUT /defaults round-trips a settings patch, then restores', async () => {
      const original = await adapters.storage.getDefaults();
      const probe = original.settings.temperature === 0.5 ? 0.75 : 0.5;
      const r = await call(url('/defaults'), {
        method: 'PUT', headers: JSON_HEADERS,
        body: JSON.stringify({ model: original.model, settings: { temperature: probe } }),
      });
      expect(r.status).toBe(200);
      const written = (await r.json()) as { model: string | null; settings: ChatSettings };
      expect(written.settings.temperature).toBe(probe);
      // Leave a live server exactly as we found it.
      const restored = await adapters.storage.putDefaults({ model: original.model, settings: original.settings });
      expect(restored.settings.temperature).toBe(original.settings.temperature);
    }, TIMEOUT_MS);
  });

  // -------------------------------------------------------------------- fork

  describe('conformance: fork', () => {
    it('POST /chats/{id}/fork answers 201 and records the cut point', async () => {
      const chat = await createChat();
      await collect(await openTurn(chat.id, 'hello', rid('fork')));
      const r = await call(url(`/chats/${chat.id}/fork`), {
        method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ at_seq: 1 }),
      });
      expect(r.status).toBe(201);
      const forked = track((await r.json()) as ChatSummary);
      expect(forked.id).not.toBe(chat.id);
      expect(forked.forked_from_chat_id).toBe(chat.id);
      expect(forked.forked_at_seq).toBe(1);
    }, TIMEOUT_MS);

    it('fork with at_seq below 1 is a 422', async () => {
      const chat = await createChat();
      const r = await call(url(`/chats/${chat.id}/fork`), {
        method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ at_seq: 0 }),
      });
      // Status only: FastAPI's own request-validation 422 is a list-shaped
      // `detail`, while a hand-raised chat2 422 is the `{code, message}`
      // envelope. The status is the fact both shapes share; `readError`
      // normalises either into an `ApiError`.
      expect(r.status).toBe(422);
      const e = await readError(r);
      expect(e.status).toBe(422);
      expect(typeof e.code).toBe('string');
    }, TIMEOUT_MS);

    it('fork of a missing chat is a 404 not_found', async () => {
      const r = await call(url('/chats/definitely-not-a-chat-id/fork'), {
        method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ at_seq: 1 }),
      });
      expect(r.status).toBe(404);
      expect((await readError(r)).code).toBe('not_found');
    }, TIMEOUT_MS);
  });

  // ------------------------------------------------------------- turn-frames

  describe('conformance: turn-frames', () => {
    it('the happy path opens persisted/start/context and closes context/done', async () => {
      const chat = await createChat();
      const r = await openTurn(chat.id, 'hello', rid('frames'));
      expect(r.status).toBe(200);
      const events = await collect(r);
      const t = types(events);

      expect(t.slice(0, 3)).toEqual(['message-persisted', 'message-start', 'context']);
      expect(t.at(-1)).toBe('done');
      expect(t.at(-2)).toBe('context');
      expect(t.filter((x) => x === 'done')).toHaveLength(1);

      const start = events.find((e) => e.type === 'message-start');
      const done = events.at(-1);
      expect(start && 'messageId' in start ? start.messageId : null)
        .toBe(done && 'messageId' in done ? done.messageId : undefined);
      // A finish reason must be present and meaningful, but WHICH one is the
      // model's business: a turn that stops on a tool call or a length cap is
      // just as conformant as one that stops on `stop`. Likewise there is no
      // `text-delta` requirement — a tool-only turn emits none.
      const finishReason = done && 'finishReason' in done ? done.finishReason : null;
      expect(typeof finishReason).toBe('string');
      expect(String(finishReason).length).toBeGreaterThan(0);
    }, TIMEOUT_MS);
  });

  // -------------------------------------------------------- pre-stream-error

  describe('conformance: pre-stream-error', () => {
    it('an upstream failure after the opening frames is a terminal error frame with no done', async () => {
      const chat = await createChat();
      // A failure discovered AFTER the user row is persisted is in-band: the
      // response is still a 200 SSE stream and the failure is an `error` frame,
      // not an HTTP status.
      const r = await openTurn(chat.id, '__fail__', rid('fail'));
      expect(r.status).toBe(200);
      const t = types(await collect(r));
      expect(t.slice(0, 3)).toEqual(['message-persisted', 'message-start', 'context']);

      if (t.includes('error')) {
        expect(t.at(-1)).toBe('error');
        expect(t.includes('done')).toBe(false);
      } else {
        // A live backend with no `__fail__` hook just answers the prompt. The
        // invariant holds either way: exactly one terminal frame, and `error`
        // and `done` never both appear in one stream.
        expect(t.at(-1)).toBe('done');
        expect(t.filter((x) => x === 'done')).toHaveLength(1);
      }
    }, TIMEOUT_MS);
  });

  // ------------------------------------------------------- idempotent-replay

  describe('conformance: idempotent-replay', () => {
    it('replaying a request_id yields a lone done and does not re-run the turn', async () => {
      const chat = await createChat();
      const requestId = rid('replay');
      const first = types(await collect(await openTurn(chat.id, 'hello', requestId)));
      expect(first.at(-1)).toBe('done');

      const second = await collect(await openTurn(chat.id, 'hello', requestId));
      expect(types(second)).toEqual(['done']);

      // The replay charged nothing and wrote nothing: the same rows as after
      // the first run.
      const detail = await adapters.storage.getChat(chat.id);
      expect(detail.messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    }, TIMEOUT_MS);
  });

  // ----------------------------------------------------------- turn-in-flight

  describe('conformance: turn-in-flight', () => {
    it('a second turn started while one streams is a 409 turn_in_flight', async () => {
      const chat = await createChat();
      const inFlight = await openTurn(chat.id, longPrompt(), rid('busy1'));
      expect(inFlight.status).toBe(200);

      const second = await openTurn(chat.id, 'hello', rid('busy2'));
      expect(second.status).toBe(409);
      const e = await readError(second);
      expect(e.code).toBe('turn_in_flight');

      // Leave the chat idle for whatever runs next.
      await collect(inFlight);
    }, TIMEOUT_MS);
  });

  // ------------------------------------------------------------------- abort

  describe('conformance: abort', () => {
    it('POST turn/abort ends the stream with done{aborted} and no trailing context', async (ctx) => {
      const chat = await createChat();
      const r = await openTurn(chat.id, longPrompt(), rid('abort'));
      expect(r.status).toBe(200);

      const events: ChatEvent[] = [];
      let streamEnded = false;
      const pump = (async () => {
        if (!r.body) return;
        for await (const e of parseSseStream(r.body)) events.push(e);
      })().finally(() => { streamEnded = true; });
      // Stop waiting as soon as there is something to abort MID-turn, or as
      // soon as the whole turn has gone by — a backend fast enough to finish
      // first is handled below, not by burning the wait budget.
      await waitFor(() => streamEnded || events.some((e) => e.type === 'text-delta'));

      const ack = await call(url(`/chats/${chat.id}/turn/abort`), { method: 'POST' });
      if (ack.status === 404) {
        // Nothing was left to abort. That is a legitimate answer, and the
        // contract still pins its shape — but this backend cannot demonstrate
        // the aborted-tail rule, so say so rather than fail on it.
        expect((await readError(ack)).code).toBe('not_found');
        await pump;
        skipWith(ctx, 'turn finished before abort; pass fixtures.makeLongPrompt for a slower backend');
      }
      expect(ack.status).toBe(200);
      await pump;

      const t = types(events);
      const last = events.at(-1);
      expect(t.at(-1)).toBe('done');
      expect(last && 'finishReason' in last ? last.finishReason : null).toBe('aborted');
      // A partial tail must not be followed by a fresh context reading: the
      // one the client already has is the truthful one.
      expect(t.slice(t.lastIndexOf('text-delta') + 1)).not.toContain('context');
    }, TIMEOUT_MS);

    it('abort on a chat with no live turn is a 404 not_found', async () => {
      const chat = await createChat();
      const r = await call(url(`/chats/${chat.id}/turn/abort`), { method: 'POST' });
      expect(r.status).toBe(404);
      expect((await readError(r)).code).toBe('not_found');
    }, TIMEOUT_MS);
  });

  // ------------------------------------------------------------- live-replay

  describe('conformance: live-replay', () => {
    it('GET turn/live replays the recorded frames byte-identically', async () => {
      const chat = await createChat();
      const original = await openTurn(chat.id, longPrompt(), rid('live'));
      expect(original.status).toBe(200);

      const live = await call(url(`/chats/${chat.id}/turn/live`), {
        method: 'GET', headers: { Accept: 'text/event-stream' },
      });

      if (live.status === 404) {
        // The turn finished and was reaped before this request landed — the
        // fast-backend branch. The contract still pins the shape of that
        // answer, so assert it and stop.
        expect((await readError(live)).code).toBe('not_found');
        await collect(original);
        return;
      }

      expect(live.status).toBe(200);
      const n = 3;
      const [first, replayed] = await Promise.all([rawFrames(original, n), rawFrames(live, n)]);
      expect(first).toHaveLength(n);
      expect(first[0].startsWith('data:')).toBe(true);
      // Byte-for-byte, not "structurally equal": a reattached subscriber must
      // drive the reducer down the exact same path as the original one.
      expect(replayed).toEqual(first);
    }, TIMEOUT_MS);

    it('GET turn/live with no live turn is a 404 not_found', async () => {
      const chat = await createChat();
      const r = await call(url(`/chats/${chat.id}/turn/live`), {
        method: 'GET', headers: { Accept: 'text/event-stream' },
      });
      expect(r.status).toBe(404);
      expect((await readError(r)).code).toBe('not_found');
    }, TIMEOUT_MS);
  });

  // ------------------------------------------------------------- attachments

  // Both skips run through `ctx.skip` so the REASON travels with them: the
  // fixture opt-out and "this catalog has no vision model" are different
  // facts about the backend and read differently in a CI log.
  describe('conformance: attachments (needs a vision-capable model)', () => {
    const pixel = () => new File(
      [Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0))], 'pixel.png', { type: 'image/png' },
    );

    it('uploads a draft image and deletes it', async (ctx) => {
      if (fixtures.skipAttachments) skipWith(ctx, 'fixtures.skipAttachments set');
      const models = await adapters.models.listModels();
      if (!models.some((m) => m.supports_vision)) skipWith(ctx, 'no vision-capable model');

      const chat = await createChat();
      const out = await adapters.storage.uploadAttachment(pixel(), chat.id);
      expect(typeof out.id).toBe('string');
      expect(out.mime).toBe('image/png');
      expect(out.chat_id).toBe(chat.id);
      expect(out.evicted).toBe(false);
      expect(typeof out.sha256).toBe('string');
      expect(out.sha256.length).toBeGreaterThan(0);
      expect(out.size_bytes).toBeGreaterThan(0);
      // A draft is not yet attached to any message.
      expect(out.message_id).toBeNull();
      // The signed URL is a path on this API, not an opaque blob.
      expect(typeof out.url).toBe('string');

      // The chat detail lists the draft.
      const detail = await adapters.storage.getChat(chat.id);
      expect(detail.attachments.some((a) => a.id === out.id)).toBe(true);

      const del = await call(url(`/attachments/${out.id}`), { method: 'DELETE' });
      expect(del.status).toBe(204);
      const again = await call(url(`/attachments/${out.id}`), { method: 'DELETE' });
      expect(again.status).toBe(404);
      expect((await readError(again)).code).toBe('not_found');
    }, TIMEOUT_MS);

    it('upload without the chat_id form field is a 422', async (ctx) => {
      if (fixtures.skipAttachments) skipWith(ctx, 'fixtures.skipAttachments set');
      const models = await adapters.models.listModels();
      if (!models.some((m) => m.supports_vision)) skipWith(ctx, 'no vision-capable model');

      // `chat_id` is a REQUIRED multipart field, not a convenience — the route
      // declares it `Form(...)`, so omitting it is a validation failure.
      const fd = new FormData();
      fd.append('file', pixel(), 'pixel.png');
      const r = await call(url('/attachments'), { method: 'POST', body: fd });
      expect(r.status).toBe(422);
      expect((await readError(r)).status).toBe(422);
    }, TIMEOUT_MS);

    it('upload against an unknown chat is a 404 not_found', async (ctx) => {
      if (fixtures.skipAttachments) skipWith(ctx, 'fixtures.skipAttachments set');
      const models = await adapters.models.listModels();
      if (!models.some((m) => m.supports_vision)) skipWith(ctx, 'no vision-capable model');

      const fd = new FormData();
      fd.append('file', pixel(), 'pixel.png');
      fd.append('chat_id', 'definitely-not-a-chat-id');
      const r = await call(url('/attachments'), { method: 'POST', body: fd });
      expect(r.status).toBe(404);
      expect((await readError(r)).code).toBe('not_found');
    }, TIMEOUT_MS);
  });

  // ------------------------------------------------------------------ budget

  describe('conformance: budget', () => {
    it('GET /budget answers {budget: null | {blocked_until, window}}', async () => {
      const r = await call(url('/budget'));
      expect(r.status).toBe(200);
      const body = (await r.json()) as { budget?: unknown };
      expect(Object.prototype.hasOwnProperty.call(body, 'budget')).toBe(true);
      if (body.budget !== null) {
        expect(body.budget).toHaveProperty('blocked_until');
        expect(body.budget).toHaveProperty('window');
      }
      // The adapter unwraps the envelope to the value itself.
      await expect(adapters.billing.getBudget()).resolves.toEqual(body.budget);
    }, TIMEOUT_MS);
  });
}
