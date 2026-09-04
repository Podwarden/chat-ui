'use client';
// <ChatApp> — the whole chat experience as one component (spec §5).
//
// Layout: sidebar | (header · thread · banners+composer). The root is a plain
// `flex` box with no geometry of its own: page-shell decisions (full-bleed vs.
// a 500px panel, cancelling a layout's padding) belong to the host, which
// states them through `className`.
//
// Nothing here is ambient. Transport, theme, capabilities, routing and the
// handful of overridable strings all arrive as props; the component mounts the
// two providers the tree below it reads from.
//
// The inner component owns exactly four pieces of state — the selected chat, the
// composer text, and the two transient dialogs (fork, lightbox). Everything
// else lives in the hooks. Two rules shape the code below:
//
//  1. Every callback handed to <Thread> must be referentially stable, because
//     `MessageItem` is `memo`'d: an arrow rebuilt per render would re-render
//     every committed row on each streaming delta. The current hook objects
//     are therefore read through refs instead of being closed over.
//  2. `attachments` is passed straight from the thread hook's state (never
//     rebuilt here) for the same reason.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react';
import useSWR from 'swr';
import { Settings2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { DEFAULT_CAPABILITIES, type Capabilities, type ScopeOption } from '../adapters/capabilities';
import { AdaptersProvider, useAdapters } from '../adapters/context';
import { ChatThemeProvider, type ChatTheme } from '../theme/context';
import { ApiError, type Adapters, type AttachmentOut, type ChatSettings, type ModelInfo } from '../adapters/types';
import { readReasoningOpen, writeReasoningOpen } from '../model/prefs';
import { resolveActiveModel } from '../model/resolve-model';
import { useChats } from '../hooks/use-chats';
import { useChatThread } from '../hooks/use-chat-thread';
import { useAttachments } from '../hooks/use-attachments';
import { useContextMeter } from '../hooks/use-context-meter';
import { ChatSidebar } from '../components/chat-sidebar';
import { Thread } from '../components/thread';
import { Composer } from '../components/composer';
import { SettingsPanel } from '../components/settings-panel';
import { ContextBar } from '../components/context-bar';
import { BudgetMeter } from '../components/budget-meter';
import { Banners } from '../components/banners';
import { ForkDialog } from '../components/fork-dialog';
import { Lightbox } from '../components/lightbox';
import { DEFAULT_LABELS, type Labels } from './labels';

// Module-level so `models` keeps one identity while SWR has no data — a fresh
// `[]` default would churn every memo and prop that depends on it.
const NO_MODELS: ModelInfo[] = [];
// Same reason as NO_MODELS: one identity for "the host configured no scopes",
// so the effect below can reset to it without churning every consumer.
const NO_SCOPES: ScopeOption[] = [];

/**
 * A `seq` the server can actually resolve.
 *
 * Two kinds of row carry a placeholder: the optimistic user row
 * (`Number.MAX_SAFE_INTEGER`, until `message-persisted` lands) and the
 * streaming assistant tail (`-1`, until the post-turn refresh reconciles it).
 * Forking at either would ask the backend to cut the history at a message it
 * has no sequence number for. `at_seq` is also `Field(ge=1)` on the backend
 * (`app/chat2/schemas.py:ForkBody`) — a `0` is a 422, not a no-op fork.
 */
function isForkable(seq: number): boolean {
  return seq >= 1 && seq !== Number.MAX_SAFE_INTEGER;
}

/**
 * Highest reconciled `seq` in a transcript, or `null` when nothing in it can
 * be forked yet (an empty chat, or one whose only rows are still in flight).
 */
function lastForkableSeq(messages: readonly { seq: number }[]): number | null {
  let max: number | null = null;
  for (const m of messages) if (isForkable(m.seq) && (max === null || m.seq > max)) max = m.seq;
  return max;
}

const NO_VISION_REASON = "This model can't see images";

/** Whether a paste carries at least one image file (vs. plain text). */
function pasteHasImage(e: ReactClipboardEvent): boolean {
  return Array.from(e.clipboardData?.items ?? []).some((i) => i.kind === 'file' && i.type.startsWith('image/'));
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError || e instanceof Error ? (e.message || fallback) : fallback;
}

export interface ChatAppProps {
  /** Everything outside the UI: transport, storage, models, billing. */
  adapters: Adapters;
  /**
   * Product decisions the package cannot make; merged over
   * `DEFAULT_CAPABILITIES`. Keep the object stable (module-level, or memoized)
   * — <SettingsPanel> re-runs `listSkills()` whenever its identity changes.
   */
  capabilities?: Partial<Capabilities>;
  theme: ChatTheme;
  /** Which chat to open on mount. Seeds the selection once; later changes are ignored. */
  initialChatId?: string | null;
  /** Called whenever the selection changes — never for `initialChatId` itself. */
  onChatIdChange?: (id: string | null) => void;
  /**
   * Query parameter the open chat's id is WRITTEN to, via
   * `history.replaceState` (no navigation, no re-render, no scroll reset), so
   * the address bar and any bookmark taken from it name the chat on screen.
   *
   * Writing is all this does: the package never reads the parameter back. A
   * reload reopens that chat only if the host parses its own URL and passes
   * the id in as `initialChatId` — which it must do itself, since only the
   * host knows when its router has finished producing a URL to read.
   *
   * `null` — a host that does its own routing, or none — turns the writing off
   * entirely; `onChatIdChange` is then the only channel.
   */
  syncUrlParam?: string | null;
  /** Geometry for the root box; the package brings none of its own. */
  className?: string;
  /** id of the host element modals mark `inert` while open (default `"app-root"`). */
  rootInertId?: string;
  /** Overrides for the seven host-facing strings; English otherwise. */
  labels?: Partial<Labels>;
  /**
   * Who is looking. Only consulted when `capabilities.sharedChats` is on, to
   * tell the viewer's own chats from a colleague's in the sidebar.
   */
  currentUserId?: string;
}

/**
 * The providers live out here, in a component that calls no hook of its own:
 * `useAdapters()` reads a context this same component mounts, and a consumer
 * cannot see its own provider. Everything that uses the hooks is therefore one
 * level down, in `<ChatAppInner>`.
 */
export function ChatApp(props: ChatAppProps) {
  return (
    <AdaptersProvider adapters={props.adapters}>
      <ChatThemeProvider theme={props.theme}>
        <ChatAppInner {...props} />
      </ChatThemeProvider>
    </AdaptersProvider>
  );
}

function ChatAppInner({
  capabilities: capabilitiesOverride,
  initialChatId,
  onChatIdChange,
  syncUrlParam = 'c',
  className,
  rootInertId,
  labels: labelsOverride,
  currentUserId,
}: ChatAppProps) {
  // `initialChatId` is a seed, not a controlled value: the selection is this
  // component's state from the first render on, and a host that wants to drive
  // it from the outside remounts (`key=`) rather than fighting the effects
  // below over who owns it.
  const [selectedId, setSelectedId] = useState<string | null>(() => initialChatId ?? null);
  const [input, setInput] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [forkReq, setForkReq] = useState<{ mode: 'fork' | 'edit'; atSeq: number; text?: string; chatId: string } | null>(null);
  const [lightbox, setLightbox] = useState<AttachmentOut | null>(null);
  // The host's scope choices and the one the NEXT new chat will be bound to.
  // Both are creation-time state: an existing chat's scope is whatever was
  // persisted with it, and changing the picker never rewrites it.
  const [scopeOptions, setScopeOptions] = useState<readonly ScopeOption[]>(NO_SCOPES);
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  // Seeded to the default rather than read in the initializer: this component
  // also renders on the server, where `localStorage` does not exist, and a
  // stored `false` would then be a hydration mismatch. The effect below reads
  // the real answer on the client's first commit.
  const [reasoningOpen, setReasoningOpen] = useState(true);
  useEffect(() => { setReasoningOpen(readReasoningOpen()); }, []);
  const onReasoningToggle = useCallback((open: boolean) => {
    setReasoningOpen(open);
    writeReasoningOpen(open);
  }, []);
  // Sidebar/dialog mutations are fire-and-forget from the UI's point of view;
  // this is where their rejections surface instead of vanishing into a `void`.
  const [actionError, setActionError] = useState<string | null>(null);

  // Memoized because <SettingsPanel> re-runs `listSkills()` whenever the
  // `capabilities` identity changes — a fresh object per render would refetch
  // the skill list on every keystroke in the composer.
  const capabilities = useMemo(() => ({ ...DEFAULT_CAPABILITIES, ...capabilitiesOverride }), [capabilitiesOverride]);
  const labels = useMemo(() => ({ ...DEFAULT_LABELS, ...labelsOverride }), [labelsOverride]);

  // Loaded once per `capabilities` identity (the same contract <SettingsPanel>
  // states for `listSkills`), and cancellation-safe: a capabilities swap while
  // a list() is in flight must not let the stale answer land.
  const scopesCap = capabilities.scopes;
  useEffect(() => {
    if (!scopesCap) { setScopeOptions(NO_SCOPES); setSelectedScopeId(null); return; }
    let on = true;
    // `Promise.resolve().then(...)` rather than a bare `scopesCap.list()`: a
    // host whose `list` throws SYNCHRONOUSLY (a destructured config read, a
    // guard clause) would otherwise blow up inside the effect — an uncaught
    // error during commit, not the logged "no scopes" fallback a rejected
    // promise gets. Both failure shapes belong on the same path.
    void Promise.resolve().then(() => scopesCap.list()).then((opts) => {
      if (!on) return;
      setScopeOptions(opts);
      // Re-default only when the current choice is gone from the new list —
      // a reload that still offers it must not silently move the binding.
      setSelectedScopeId((cur) => (cur && opts.some((o) => o.id === cur) ? cur : opts[0]?.id ?? null));
    }).catch((e: unknown) => {
      if (!on) return;
      // A host whose scope service is down still gets a working chat app: no
      // picker, and chats created without a scope. Logged, never thrown —
      // this is the host's dependency failing, not the user's action.
      console.warn('[chat-ui] capabilities.scopes.list() failed; continuing without scopes', e);
      setScopeOptions(NO_SCOPES);
      setSelectedScopeId(null);
    });
    return () => { on = false; };
  }, [scopesCap]);

  const adapters = useAdapters();
  const chatsApi = useChats();
  const thread = useChatThread(selectedId);
  const drafts = useAttachments(selectedId);
  const { data: models = NO_MODELS, mutate: refreshModels, isLoading: modelsLoading } = useSWR(['chat-ui', adapters.id, 'models'], () => adapters.models.listModels(), { refreshInterval: 60_000 });
  const { data: budget = null } = useSWR(['chat-ui', adapters.id, 'budget'], () => adapters.billing.getBudget(), { refreshInterval: 60_000 });

  // Latest-value refs so the callbacks below can stay identity-stable.
  const adaptersRef = useRef(adapters); adaptersRef.current = adapters;
  const chatsApiRef = useRef(chatsApi); chatsApiRef.current = chatsApi;
  const threadRef = useRef(thread); threadRef.current = thread;
  const draftsRef = useRef(drafts); draftsRef.current = drafts;
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId;
  const inputRef = useRef(input); inputRef.current = input;
  // attachment ids handed to the turn that is (or just was) in flight
  const sentIdsRef = useRef<string[]>([]);
  // the settings PATCH the panel started last, so "save as defaults" can wait
  // for it instead of persisting the pre-edit snapshot
  const settingsPatchRef = useRef<Promise<void>>(Promise.resolve());

  // select the first chat when none is chosen; clear the selection if it vanished
  useEffect(() => {
    if (chatsApi.isLoading) return;
    if (selectedId && !chatsApi.chats.some((c) => c.id === selectedId)) setSelectedId(chatsApi.chats[0]?.id ?? null);
    else if (!selectedId && chatsApi.chats[0]) setSelectedId(chatsApi.chats[0].id);
  }, [chatsApi.chats, chatsApi.isLoading, selectedId]);

  // A chat switch drops the drafts hook's state, so the ids the previous
  // chat's turn was carrying must go with it — otherwise the effect further
  // down could mark them missing on a chat they never belonged to. Its own
  // effect, keyed on the selection alone: this is bookkeeping the URL has no
  // say in, and sharing an effect with the writer below meant a host toggling
  // `syncUrlParam` silently discarded in-flight attachment ids.
  useEffect(() => { sentIdsRef.current = []; }, [selectedId]);

  // Keeps `?<syncUrlParam>=<id>` current through `history.replaceState` — no
  // navigation, no re-render, no scroll reset — so the address bar names the
  // chat on screen. Only the *writing* half: nothing here ever reads the
  // parameter back, so reopening that chat after a reload is the host's job,
  // via `initialChatId`. A host that routes for itself passes
  // `syncUrlParam={null}` and gets `onChatIdChange` instead.
  useEffect(() => {
    if (!syncUrlParam) return;
    const u = new URL(window.location.href);
    if (selectedId) u.searchParams.set(syncUrlParam, selectedId); else u.searchParams.delete(syncUrlParam);
    window.history.replaceState(null, '', u);
  }, [selectedId, syncUrlParam]);

  // Report selection changes, but never the seed: the host handed
  // `initialChatId` in, and echoing it back on mount would make a host that
  // stores the value in its own state loop through a render for nothing.
  const onChatIdChangeRef = useRef(onChatIdChange);
  onChatIdChangeRef.current = onChatIdChange;
  const reportedIdRef = useRef<string | null>(selectedId);
  useEffect(() => {
    if (reportedIdRef.current === selectedId) return;
    reportedIdRef.current = selectedId;
    onChatIdChangeRef.current?.(selectedId);
  }, [selectedId]);

  // Two rules behind one `model`, and which one applies is the HOST's call.
  // Under the default `modelSelection: 'user'` this is the 0.1.2 lookup to the
  // letter — the chat's stored id is authoritative and a miss is a miss, which
  // is what keeps the composer refusing a send vLLM Warden's turn route would
  // 404 anyway. Only a host that says `'host'` (it picks the model
  // system-wide, the user never sees a picker) gets `resolveActiveModel`'s
  // single-model fallback.
  const hostPicksModel = capabilities.modelSelection === 'host';
  // `model_loaded` is the backend's own answer for the chat's pinned model
  // (#240) and beats the catalog, which is polled: a model unloaded between
  // two polls is still listed here for up to a minute while the turn route
  // already 404s on it. Absent (an older backend) leaves the lookup as it was.
  const chatModel = thread.chat?.model;
  const chatModelLoaded = thread.chat?.model_loaded;
  const model = useMemo(
    () => (hostPicksModel
      ? resolveActiveModel(models, chatModel)
      : chatModelLoaded === false ? null : models.find((m) => m.id === chatModel) ?? null),
    [hostPicksModel, models, chatModel, chatModelLoaded],
  );
  // The two sources disagreeing means one of them is stale: the catalog
  // (polled every 60 s) right after a model went away or came up, or the chat
  // detail (loaded on mount and on focus) after the pinned model was loaded
  // again from elsewhere — the Models page, another tab, the API. Refresh
  // BOTH at once rather than waiting out either interval, so the state heals
  // in whichever direction it went wrong. Once per distinct disagreement: a
  // backend answering inconsistently must not turn this into a request loop.
  const disagreementRef = useRef<string | null>(null);
  useEffect(() => {
    if (modelsLoading || chatModelLoaded === undefined || !chatModel) return;
    const inCatalog = models.some((m) => m.id === chatModel);
    if (chatModelLoaded === inCatalog) { disagreementRef.current = null; return; }
    const key = `${chatModel}:${String(chatModelLoaded)}:${String(inCatalog)}`;
    if (disagreementRef.current === key) return;
    disagreementRef.current = key;
    void refreshModels();
    if (threadRef.current.phase !== 'streaming') void threadRef.current.reload().catch(() => undefined);
  }, [chatModel, chatModelLoaded, models, modelsLoading, refreshModels]);
  // The backend auto-detects vision from the on-disk HF config while the
  // operator has not stated an answer (app/chat2/catalog.py), so this flag is
  // the whole truth about whether an image would survive the turn.
  const canAttach = model?.supports_vision === true;
  const canAttachRef = useRef(canAttach); canAttachRef.current = canAttach;
  // Two different reasons hide behind one disabled button, and saying the
  // wrong one is worse than saying nothing: "This model can't see images" in
  // front of an operator who has not loaded a model at all sends them off to
  // find a vision model they already have.
  const attachDisabledReason = canAttach ? undefined : model ? NO_VISION_REASON : labels.loadModelFirst;
  const attachReasonRef = useRef(attachDisabledReason); attachReasonRef.current = attachDisabledReason;
  const maxTokens = thread.chat?.settings.max_tokens ?? 1024;
  const meter = useContextMeter({ context: thread.state.context, draftText: input, draftImages: drafts.readyIds.length, model, maxTokens });
  const streaming = thread.phase === 'streaming';

  // A chat whose detail is still loading has no settings, no model and no
  // context yet, so a send would race the load — it reads as "no chat picked"
  // for as long as that lasts (which is also why it reuses that reason).
  const disabledReason = !thread.chat || thread.phase === 'loading'
    ? 'Create or pick a chat'
    : !model
      ? 'Model is not loaded'
      : meter.state === 'full'
        ? 'Context window is full — fork to continue'
        : budget?.blocked_until
          ? 'Budget exhausted'
          : undefined;

  const send = useCallback(async () => {
    const text = inputRef.current.trim();
    const ids = draftsRef.current.readyIds;
    if (!text && ids.length === 0) return;
    setInput('');
    // The drafts are NOT cleared here: whether they may be dropped depends on
    // whether the turn reached the database, which is only knowable from the
    // hook's state once it has committed (see the effect below).
    sentIdsRef.current = ids;
    await threadRef.current.send(text, ids, draftsRef.current.ready);
  }, []);

  // Draft lifecycle after a send. `send`'s own continuation cannot decide this
  // — the thread hook's post-stream `setState`/`setLastError` have not been
  // committed by the time it resumes — so the decision is made from rendered
  // state instead:
  //   - the turn failed because an image had been evicted → flag those chips
  //     so the user can remove and re-attach them;
  //   - the user row carrying the ids is in the transcript under a server id
  //     → it owns the attachments now, the composer's copies are done;
  //   - anything else (a pre-flight rejection, a dropped connection) leaves
  //     the drafts alone so Retry can resend them.
  const { clear: clearDrafts, markMissing } = drafts;
  useEffect(() => {
    const ids = sentIdsRef.current;
    if (ids.length === 0) return;
    if (thread.lastError?.code === 'attachment_missing') {
      sentIdsRef.current = [];
      for (const id of ids) markMissing(id);
      return;
    }
    const persisted = thread.state.messages.some((m) => !m.id.startsWith('local-')
      && m.parts.some((p) => p.type === 'image' && ids.includes(p.attachmentId)));
    if (persisted) {
      sentIdsRef.current = [];
      clearDrafts();
    }
  }, [thread.state.messages, thread.lastError, clearDrafts, markMissing]);

  // Latest-value ref for the same reason as the others: `newChat` is handed to
  // the sidebar and must keep one identity across a scope change.
  const selectedScopeRef = useRef<ScopeOption | null>(null);
  selectedScopeRef.current = scopeOptions.find((o) => o.id === selectedScopeId) ?? null;
  const newChat = useCallback(async () => {
    try {
      // The host's opaque object, verbatim — including when there is exactly
      // one option and no picker was shown: the binding is what the host
      // wanted, the choice is just not the user's to make.
      //
      // Copied, not passed by reference: the option objects are the host's and
      // this package treats them as frozen. Handing the live object to the
      // adapter would let a transport that mutates its body (an interceptor
      // stamping a field, a host adapter normalising keys) write back into the
      // host's own list and change what every LATER chat gets bound to.
      const opt = selectedScopeRef.current;
      const c = await chatsApiRef.current.create(opt ? { settings: { scope: { ...opt.scope } } } : {});
      setSelectedId(c.id);
    } catch (e) { setActionError(errorText(e, 'Could not create the chat')); }
  }, []);
  const renameChat = useCallback((id: string, title: string) => {
    void chatsApiRef.current.rename(id, title).catch((e: unknown) => setActionError(errorText(e, 'Could not rename the chat')));
  }, []);
  const removeChat = useCallback((id: string) => {
    void chatsApiRef.current.remove(id).catch((e: unknown) => setActionError(errorText(e, 'Could not delete the chat')));
  }, []);
  const removeAllChats = useCallback(() => {
    void chatsApiRef.current.removeAll().catch((e: unknown) => setActionError(errorText(e, 'Could not delete the chats')));
  }, []);

  const openFork = useCallback((mode: 'fork' | 'edit', atSeq: number, text?: string) => {
    const chatId = selectedIdRef.current;
    // a row that is still in flight has no sequence number the backend could
    // cut at — the affordance is simply inert until the refresh reconciles it
    if (!chatId || !isForkable(atSeq)) return;
    setForkReq({ mode, atSeq, text, chatId });
  }, []);
  const onForkHere = useCallback((seq: number) => openFork('fork', seq), [openFork]);
  const onEdit = useCallback((seq: number, text: string) => openFork('edit', seq, text), [openFork]);

  /**
   * "Fork the whole chat" from the sidebar. `at_seq` is `ge=1` on the backend
   * with no clamping, so the cut point has to be a real sequence number:
   * the open chat has its transcript in memory, any other row needs one
   * `GET /chats/{id}` to find its last row.
   */
  const forkWhole = useCallback(async (chatId: string) => {
    try {
      const atSeq = chatId === selectedIdRef.current
        ? lastForkableSeq(threadRef.current.state.messages)
        : lastForkableSeq((await adaptersRef.current.storage.getChat(chatId)).messages);
      if (atSeq === null) { setActionError('That chat has no messages to fork yet.'); return; }
      setForkReq({ mode: 'fork', atSeq, chatId });
    } catch (e) { setActionError(errorText(e, 'Could not fork the chat')); }
  }, []);
  const onSidebarFork = useCallback((chatId: string) => { void forkWhole(chatId); }, [forkWhole]);
  const forkCurrent = useCallback(() => {
    const id = selectedIdRef.current;
    if (id) void forkWhole(id);
  }, [forkWhole]);
  const doFork = useCallback(async (editedText?: string) => {
    if (!forkReq) return;
    try {
      const c = await chatsApiRef.current.fork(forkReq.chatId, forkReq.atSeq, editedText);
      setForkReq(null);
      setSelectedId(c.id);
    } catch (e) {
      // the dialog closes either way: leaving it open with no explanation
      // reads as a frozen button
      setForkReq(null);
      setActionError(errorText(e, 'Could not fork the chat'));
    }
  }, [forkReq]);

  const onPick = useCallback((callId: string | null, selected: string[]) => {
    if (callId) void threadRef.current.answerOptions(callId, selected);
    else void threadRef.current.sendPlain(selected[0]);
  }, []);
  const onRegenerate = useCallback(() => { void threadRef.current.regenerate(); }, []);
  const onRetry = useCallback(() => { void threadRef.current.retry(); }, []);
  const onAbort = useCallback(() => { threadRef.current.abort(); }, []);
  // Images only reach the backend as "[image omitted]" on a model without
  // vision, so every entry point — the button, a drop, a paste — is closed
  // rather than silently swallowing the picture. The button is disabled and
  // the two gesture paths say why, since a drop that just vanishes is
  // indistinguishable from a bug.
  const onDropFiles = useCallback((e: ReactDragEvent) => {
    if (!canAttachRef.current) {
      // the dragover handler only ever prevents the default for `Files`, so
      // anything arriving here is a file drop
      e.preventDefault();
      setActionError(attachReasonRef.current ?? NO_VISION_REASON);
      return;
    }
    draftsRef.current.acceptDrop(e);
  }, []);
  const rejectImagePaste = useCallback((e: ReactClipboardEvent): boolean => {
    // a plain text paste must still reach the textarea untouched
    if (!pasteHasImage(e)) return false;
    e.preventDefault();
    setActionError(attachReasonRef.current ?? NO_VISION_REASON);
    return true;
  }, []);
  const onPaste = useCallback((e: ReactClipboardEvent) => {
    if (!canAttachRef.current) { rejectImagePaste(e); return; }
    draftsRef.current.acceptPaste(e);
  }, [rejectImagePaste]);
  // The composer's own paste handler runs first and bubbles up to this one;
  // `acceptPaste` marks an image paste as handled, so re-adding it here would
  // duplicate every pasted file.
  const onPasteAnywhere = useCallback((e: ReactClipboardEvent) => {
    if (e.defaultPrevented) return;
    if (!canAttachRef.current) { rejectImagePaste(e); return; }
    draftsRef.current.acceptPaste(e);
  }, [rejectImagePaste]);
  const onAddFiles = drafts.add;
  const onRemoveDraft = drafts.remove;

  const changeSettings = useCallback((patch: { model?: string; settings?: Partial<ChatSettings> }) => {
    settingsPatchRef.current = threadRef.current.updateSettings(patch)
      .catch((e: unknown) => setActionError(errorText(e, 'Could not update the chat settings')));
  }, []);
  // The not-loaded banner's recovery (#240): switch the chat to a loaded
  // model, or open the panel where the picker lists them.
  const switchModel = useCallback((modelId: string) => changeSettings({ model: modelId }), [changeSettings]);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const saveDefaults = useCallback(async () => {
    // "Save as defaults" sits next to the controls that PATCH the chat; without
    // this wait it would persist the snapshot from before the last edit.
    await settingsPatchRef.current;
    const c = threadRef.current.chat;
    if (!c) return;
    try { await adaptersRef.current.storage.putDefaults({ model: c.model, settings: c.settings }); }
    catch (e) { setActionError(errorText(e, 'Could not save the defaults')); }
  }, []);

  return (
    // `relative` is load-bearing: <SettingsPanel> becomes an `absolute`
    // overlay below `md`, and it must resolve against this root, not the page.
    // The host's `className` comes last so it can override anything but that.
    <div className={cn('relative flex overflow-hidden', className)} onPaste={onPasteAnywhere}>
      <ChatSidebar
        chats={chatsApi.chats} selectedId={selectedId} collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)} onSelect={setSelectedId} onNew={() => void newChat()}
        onRename={renameChat} onDelete={removeChat} onDeleteAll={removeAllChats} onFork={onSidebarFork}
        // A chat with no model behind it can never be sent to; browsing the
        // ones that already exist stays available.
        canCreate={models.length > 0} createDisabledReason={labels.loadModelFirst}
        capabilities={capabilities} currentUserId={currentUserId}
        scopeOptions={scopeOptions} selectedScopeId={selectedScopeId} onScopeChange={setSelectedScopeId}
        labels={labels} rootInertId={rootInertId}
      />
      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-chat-rule px-4 py-2">
          <h1 className="flex min-w-0 items-baseline gap-1.5 font-mono text-sm text-chat-fg">
            <span className="truncate">{thread.chat?.title ?? 'Chat'}</span>
            {/* the auto-titler reassesses periodically; showing what the chat
                used to be called keeps it recognisable after it renames itself */}
            {thread.chat?.title_prev && (
              <span className="min-w-0 shrink truncate text-xs text-chat-dim" title={"was: " + thread.chat.title_prev}>
                (was: {thread.chat.title_prev})
              </span>
            )}
          </h1>
          <div className="ml-auto flex items-center gap-4">
            <ContextBar meter={meter} />
            {budget && <BudgetMeter budget={budget} />}
            {/* `settings: 'hidden'` removes the affordance AND the panel below;
                `settingsOpen` simply never leaves `false`. Nothing else in the
                header, sidebar or thread is conditioned on it. */}
            {capabilities.settings !== 'hidden' && (
              <Button variant="ghost" size="sm" aria-label="Settings" onClick={() => setSettingsOpen((v) => !v)}>
                <Settings2 className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        </header>
        <div className="min-h-0 flex-1">
          <Thread
            state={thread.state} attachments={thread.attachments} isStreaming={streaming} turnInFlight={streaming}
            maxTokens={maxTokens} onRegenerate={onRegenerate} onForkHere={onForkHere} onEdit={onEdit}
            onPick={onPick} onRetry={onRetry} onOpenImage={setLightbox} onDropFiles={onDropFiles}
            reasoningOpen={reasoningOpen} onReasoningToggle={onReasoningToggle} labels={labels}
          />
        </div>
        <div className="space-y-2 border-t border-chat-rule p-3">
          <Banners
            lastError={thread.lastError} meter={meter} budget={budget} chat={thread.chat}
            modelLoaded={!!model} onFork={forkCurrent} onRetry={onRetry}
            // Only when the panel it would send the user to is gone; the
            // editable-settings wording is untouched.
            noModelText={capabilities.settings === 'hidden' ? labels.noModelAvailable : undefined}
            // The recovery actions only where the panel they lead to exists.
            models={models}
            onSwitchModel={capabilities.settings === 'hidden' ? undefined : switchModel}
            onOpenSettings={capabilities.settings === 'hidden' ? undefined : openSettings}
            actionError={actionError} onDismissActionError={() => setActionError(null)}
          />
          <Composer
            value={input} onChange={setInput} onSend={() => void send()} onAbort={onAbort} isStreaming={streaming}
            disabled={!!disabledReason} disabledReason={disabledReason} drafts={drafts.drafts}
            canAttach={canAttach} attachDisabledReason={attachDisabledReason}
            onAddFiles={onAddFiles} onRemoveDraft={onRemoveDraft} onPaste={onPaste}
            capabilities={capabilities} focusKey={selectedId}
          />
        </div>
      </section>
      {capabilities.settings !== 'hidden' && thread.chat && (
        <SettingsPanel
          open={settingsOpen} onClose={() => setSettingsOpen(false)} chat={thread.chat} models={models}
          capabilities={capabilities} onChange={changeSettings} onSaveDefaults={saveDefaults}
        />
      )}
      {forkReq && (
        <ForkDialog
          open mode={forkReq.mode} atSeq={forkReq.atSeq} initialText={forkReq.text}
          onClose={() => setForkReq(null)} onConfirm={(t) => void doFork(t)} rootInertId={rootInertId}
        />
      )}
      <Lightbox attachment={lightbox} onClose={() => setLightbox(null)} rootInertId={rootInertId} />
    </div>
  );
}
