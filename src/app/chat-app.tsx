'use client';
// <ChatApp> — the whole chat experience as one component (spec §5).
//
// Layout: sidebar | (header · thread · banners+composer). The root is a plain
// `flex` box with no geometry of its own: page-shell decisions (full-bleed vs.
// a 500px panel, cancelling a layout's padding) belong to the host, which
// states them through `className`.
//
// Below `COMPACT_BELOW_PX` of its OWN width (not the viewport's — a widget on
// a desktop screen is narrow while the viewport is not), or always under
// `layout="widget"`, the same tree goes compact: the chat list becomes a
// drawer over the transcript, settings an overlay, the meters lose their
// figures. Nothing is unmounted by the switch, so a streaming turn survives
// a resize.
//
// Nothing here is ambient. Transport, theme, capabilities, routing, the
// strings and the locale all arrive as props; the component mounts the three
// providers the tree below it reads from.
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
import { PanelLeftOpen, Settings2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { DEFAULT_CAPABILITIES, type Capabilities, type ScopeOption } from '../adapters/capabilities';
import { AdaptersProvider, useAdapters } from '../adapters/context';
import { ChatThemeProvider, type ChatTheme } from '../theme/context';
import { ApiError, type Adapters, type AttachmentOut, type ChatSettings, type ModelInfo } from '../adapters/types';
import { DEFAULT_SELECTION_PREFS, clampTextScale, readReasoningOpen, readSelectionPrefs, readTextScale, writeReasoningOpen, writeSelectionPrefs, writeTextScale, type SelectionPrefs } from '../model/prefs';
import { MAX_QUOTES, appendQuoteToDraft, serializeQuotes, type QuickAction, type Quote } from '../model/selection';
import { SelectionActions, SelectionDock } from '../components/selection/selection-actions';
import type { SelectionLabels } from '../components/selection/context';
import { resolveActiveModel } from '../model/resolve-model';
import { useChats } from '../hooks/use-chats';
import { useChatThread } from '../hooks/use-chat-thread';
import { useAttachments } from '../hooks/use-attachments';
import { useContextMeter } from '../hooks/use-context-meter';
import { useVisualViewport } from '../hooks/use-visual-viewport';
import { ChatSidebar } from '../components/chat-sidebar';
import { Thread } from '../components/thread';
import { Composer } from '../components/composer';
import { SettingsPanel } from '../components/settings-panel';
import { ContextBar } from '../components/context-bar';
import { BudgetMeter } from '../components/budget-meter';
import { Banners } from '../components/banners';
import { ForkDialog } from '../components/fork-dialog';
import { Lightbox } from '../components/lightbox';
import type { ChatUiLabelOverrides } from './labels';
import { ChatLabelsProvider, useChatLabels } from './labels-context';
import { OverlaysSuspendedProvider, PortalContainerProvider } from '../ui/portal';

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

/** Whether a paste carries at least one image file (vs. plain text). */
function pasteHasImage(e: ReactClipboardEvent): boolean {
  return Array.from(e.clipboardData?.items ?? []).some((i) => i.kind === 'file' && i.type.startsWith('image/'));
}

/** Root width under which `layout="auto"` goes compact. */
export const COMPACT_BELOW_PX = 640;

/**
 * The element's content width, kept current by a ResizeObserver; `null` until
 * the first measurement, on the server, and where ResizeObserver does not
 * exist (the auto layout then stays full, as it was before 0.1.27).
 */
function useElementWidth(ref: React.RefObject<HTMLElement | null>, on: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el || typeof ResizeObserver === 'undefined') { setWidth(null); return; }
    const ro = new ResizeObserver((entries) => {
      const w = entries[entries.length - 1]?.contentRect.width;
      if (typeof w === 'number') setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, on]);
  return width;
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError || e instanceof Error ? (e.message || fallback) : fallback;
}

/**
 * Text-selection actions as `<ChatApp>` wires them. Every key is optional;
 * keep the object stable (module-level or memoized).
 */
export interface SelectionActionsOptions {
  /** The host's defaults; whatever the user changes in Settings → Text selection wins. */
  defaults?: Partial<SelectionPrefs>;
  /**
   * "Branch into a new chat" from a selection. Default: fork the open chat at
   * that message (the same fork the "Fork here" action makes), open the new
   * chat and stage the quote in its composer. Pass your own to route it
   * elsewhere (e.g. a side panel).
   */
  onBranchFrom?: (messageId: string, quote: Quote) => void;
  /** Replaces the built-in More ▸ actions (Simplify, Make shorter, Give an example). */
  quickActions?: readonly QuickAction[];
  /** Language codes Translate offers; the browser's language always comes first. */
  translateLanguages?: readonly string[];
  /** `'auto'` (default): docked bar on touch, floating menu on a mouse. */
  touchMode?: 'auto' | 'dock' | 'float';
  /** The selection strings; wins over `labels.selection` key by key. */
  labels?: Partial<SelectionLabels>;
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
  /**
   * The open chat, from the host. Unlike `initialChatId` every CHANGE is
   * honoured: setting it to another id opens that chat, without a remount and
   * without an `onChatIdChange` echo. The user can still switch chats; that is
   * reported through `onChatIdChange`, and a host that stores the id simply
   * passes the new value back. An id the list does not have falls back to the
   * first chat, as a vanished selection always has. Wins over `initialChatId`.
   */
  chatId?: string | null;
  /** Called whenever the selection changes — never for `initialChatId` itself, nor for a `chatId` the host set. */
  onChatIdChange?: (id: string | null) => void;
  /**
   * `'auto'` (default): compact below 640 px (`COMPACT_BELOW_PX`) of the root's own
   * width, full otherwise. `'widget'`: always compact — the chat list is a
   * drawer over the transcript, settings an overlay. `'full'`: never compact,
   * the pre-0.1.27 layout at every width.
   */
  layout?: 'auto' | 'full' | 'widget';
  /**
   * The full layout's chat list: `true` collapses it to the icon rail.
   * Controlled when set; `onSidebarCollapsedChange` reports the user's
   * toggles either way. The compact layout's drawer is separate state: it
   * always starts closed and closes again when a chat is picked.
   */
  sidebarCollapsed?: boolean;
  /** The full layout's initial rail state when `sidebarCollapsed` is not controlled (default `false`). */
  defaultSidebarCollapsed?: boolean;
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  /**
   * Where the dialogs and the lightbox portal to (default `document.body`).
   * Pass the element the chat lives in — a widget panel, an iframe's root —
   * to keep them inside it; it must be positioned, since the overlay is then
   * `absolute` against it.
   */
  portalContainer?: HTMLElement | null;
  /** Called when a reply starts and stops streaming (not on mount). */
  onStreamingChange?: (streaming: boolean) => void;
  /**
   * The host has the chat out of sight but mounted (a closed widget panel).
   * Its dialogs render closed meanwhile — nothing stays inert, no key
   * listener stays on the page — and come back when it turns `false`.
   */
  suspended?: boolean;
  /**
   * The transcript's text scale (1 = the package's sizes; 0.8–2). Controlled
   * when set; `onTextScaleChange` reports the user's changes either way.
   * Uncontrolled, it starts at what this browser last stored, else
   * `defaultTextScale`, and is stored when the user changes it.
   */
  textScale?: number;
  /** The uncontrolled starting scale when this browser has stored none (default 1). */
  defaultTextScale?: number;
  onTextScaleChange?: (scale: number) => void;
  /**
   * Two fingers in the transcript resize its text, re-wrapped to the width
   * (default `true`). `false` leaves a pinch to the browser's page zoom; the
   * Settings control stays.
   */
  pinchToZoomText?: boolean;
  /**
   * For a chat that IS the page (a full-screen route, a phone): pin the root
   * to the visual viewport — `fixed`, as tall as what the browser's toolbars
   * and the on-screen keyboard leave, padded out of the notch and the home
   * indicator. The header and the composer then never leave the screen; only
   * the transcript scrolls, so the user can type while reading an old
   * message. `100vh`/`h-screen` cannot do this on mobile Safari, which sizes
   * neither for the toolbar nor the keyboard. Overrides the geometry in
   * `className` (default `false`).
   */
  fitViewport?: boolean;
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
  /**
   * Any of the package's strings (`ChatUiLabels`); everything left out stays
   * English. Groups merge key by key, so `{ composer: { send: 'Senden' } }`
   * keeps the rest of the composer's defaults. Keep the object stable
   * (module-level or memoised): a new one re-renders every message row.
   */
  labels?: ChatUiLabelOverrides;
  /**
   * BCP 47 locale of the UI (`'ru'`, `'es-MX'`). Drives the language names in
   * Translate (English without it), the language Translate offers first, and
   * every number and date the package prints (the runtime's own formatting
   * without it, as before). The strings themselves come from `labels`.
   */
  locale?: string;
  /**
   * Who is looking. Only consulted when `capabilities.sharedChats` is on, to
   * tell the viewer's own chats from a colleague's in the sidebar.
   */
  currentUserId?: string;
  /**
   * Text-selection actions (menu over selected text, quote chips, "Quote" on
   * a message, "Ask" on a code block). On by default; `false` removes all of
   * it, including the Settings section — e.g. a deployment that must not
   * offer it.
   */
  selectionActions?: SelectionActionsOptions | false;
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
        <ChatLabelsProvider labels={props.labels} locale={props.locale}>
          <PortalContainerProvider value={props.portalContainer ?? null}>
            <OverlaysSuspendedProvider value={!!props.suspended}>
              <ChatAppInner {...props} />
            </OverlaysSuspendedProvider>
          </PortalContainerProvider>
        </ChatLabelsProvider>
      </ChatThemeProvider>
    </AdaptersProvider>
  );
}

function ChatAppInner({
  capabilities: capabilitiesOverride,
  initialChatId,
  chatId,
  onChatIdChange,
  layout = 'auto',
  sidebarCollapsed: sidebarCollapsedProp,
  defaultSidebarCollapsed = false,
  onSidebarCollapsedChange,
  onStreamingChange,
  textScale: textScaleProp,
  defaultTextScale = 1,
  onTextScaleChange,
  pinchToZoomText = true,
  fitViewport = false,
  syncUrlParam = 'c',
  className,
  rootInertId,
  currentUserId,
  selectionActions,
}: ChatAppProps) {
  // The selection is this component's state from the first render on.
  // `initialChatId` only seeds it; `chatId` seeds it too and then pushes each
  // later change in (the effect further down) — the user's own switches still
  // land here first, so the auto-select and vanished-chat rules below keep a
  // single owner.
  const [selectedId, setSelectedId] = useState<string | null>(() => (chatId !== undefined ? chatId : initialChatId) ?? null);
  const [input, setInput] = useState('');
  const [railState, setRailState] = useState(defaultSidebarCollapsed);
  const railCollapsed = sidebarCollapsedProp ?? railState;
  const toggleRail = () => {
    const next = !railCollapsed;
    if (sidebarCollapsedProp === undefined) setRailState(next);
    onSidebarCollapsedChange?.(next);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const visual = useVisualViewport(fitViewport);
  const rootStyle: React.CSSProperties | undefined = fitViewport
    ? {
        position: 'fixed', left: 0, right: 0,
        top: visual ? visual.top : 0,
        // before the first measurement (and on the server): the small viewport
        height: visual ? visual.height : '100svh',
        paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)',
      }
    : undefined;
  const width = useElementWidth(rootRef, layout === 'auto');
  const compact = layout === 'widget' || (layout === 'auto' && width !== null && width < COMPACT_BELOW_PX);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerToggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  // Leaving the compact layout takes the drawer with it; coming back starts closed.
  useEffect(() => { if (!compact) setDrawerOpen(false); }, [compact]);
  useEffect(() => {
    if (drawerOpen) drawerRef.current?.querySelector<HTMLElement>('button:not([disabled]), input')?.focus();
  }, [drawerOpen]);
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
  // Read after mount for the same SSR reason as `reasoningOpen` below.
  const [storedTextScale, setStoredTextScale] = useState<number | null>(null);
  useEffect(() => { setStoredTextScale(readTextScale()); }, []);
  const textScale = clampTextScale(textScaleProp ?? storedTextScale ?? defaultTextScale);
  const onTextScaleChangeRef = useRef(onTextScaleChange); onTextScaleChangeRef.current = onTextScaleChange;
  const textScaleControlled = textScaleProp !== undefined;
  const changeTextScale = useCallback((s: number) => {
    const next = clampTextScale(s);
    if (!textScaleControlled) { setStoredTextScale(next); writeTextScale(next); }
    onTextScaleChangeRef.current?.(next);
  }, [textScaleControlled]);
  const [reasoningOpen, setReasoningOpen] = useState(true);
  useEffect(() => { setReasoningOpen(readReasoningOpen()); }, []);
  const onReasoningToggle = useCallback((open: boolean) => {
    setReasoningOpen(open);
    writeReasoningOpen(open);
  }, []);
  // Text-selection preferences: the host's defaults under what the user set
  // in this browser (read after mount for the same SSR reason as above).
  const selectionOn = selectionActions !== false;
  const selOpts = selectionActions || undefined;
  const [storedSelPrefs, setStoredSelPrefs] = useState<Partial<SelectionPrefs>>({});
  useEffect(() => { setStoredSelPrefs(readSelectionPrefs()); }, []);
  const selectionPrefs = useMemo<SelectionPrefs>(
    () => ({ ...DEFAULT_SELECTION_PREFS, ...selOpts?.defaults, ...storedSelPrefs }),
    [selOpts?.defaults, storedSelPrefs],
  );
  const selectionPrefsRef = useRef(selectionPrefs); selectionPrefsRef.current = selectionPrefs;
  const onSelectionPrefsChange = useCallback((patch: Partial<SelectionPrefs>) => {
    writeSelectionPrefs(patch);
    setStoredSelPrefs((prev) => ({ ...prev, ...patch }));
  }, []);
  // Quotes staged above the composer (chips), and a counter that asks the
  // composer to take focus with the caret at the end.
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const quotesRef = useRef(quotes); quotesRef.current = quotes;
  const [focusSignal, setFocusSignal] = useState(0);
  const bumpFocus = useCallback(() => setFocusSignal((n) => n + 1), []);
  // Sidebar/dialog mutations are fire-and-forget from the UI's point of view;
  // this is where their rejections surface instead of vanishing into a `void`.
  const [actionError, setActionError] = useState<string | null>(null);

  // Memoized because <SettingsPanel> re-runs `listSkills()` whenever the
  // `capabilities` identity changes — a fresh object per render would refetch
  // the skill list on every keystroke in the composer.
  const capabilities = useMemo(() => ({ ...DEFAULT_CAPABILITIES, ...capabilitiesOverride }), [capabilitiesOverride]);
  const { labels } = useChatLabels();
  // The callbacks below must keep one identity (see the header), so they read
  // the strings through a ref rather than closing over them.
  const labelsRef = useRef(labels); labelsRef.current = labels;

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

  // A host-set id waiting for the list to catch up (see the `chatId` effect).
  const [pendingHostId, setPendingHostId] = useState<string | null>(null);
  // select the first chat when none is chosen; clear the selection if it vanished
  useEffect(() => {
    if (chatsApi.isLoading || (selectedId !== null && selectedId === pendingHostId)) return;
    if (selectedId && !chatsApi.chats.some((c) => c.id === selectedId)) setSelectedId(chatsApi.chats[0]?.id ?? null);
    else if (!selectedId && chatsApi.chats[0]) setSelectedId(chatsApi.chats[0].id);
  }, [chatsApi.chats, chatsApi.isLoading, selectedId, pendingHostId]);

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

  // A host-set `chatId` change opens that chat. Only CHANGES of the prop act:
  // a host that leaves it alone after the user switched chats does not drag
  // the selection back. Marked as reported first, so it is not echoed.
  //
  // An id the list does not have yet (a chat the host just created through
  // its own API) is held while the list refreshes once; only an id still
  // missing after that falls back like any vanished selection.
  const chatIdPropRef = useRef(chatId);
  useEffect(() => {
    if (chatId === undefined || chatId === chatIdPropRef.current) { chatIdPropRef.current = chatId; return; }
    chatIdPropRef.current = chatId;
    reportedIdRef.current = chatId;
    setSelectedId(chatId);
    if (chatId && !chatsApiRef.current.chats.some((c) => c.id === chatId)) {
      setPendingHostId(chatId);
      void Promise.resolve(chatsApiRef.current.mutate()).catch(() => undefined)
        .finally(() => setPendingHostId((cur) => (cur === chatId ? null : cur)));
    }
  }, [chatId]);

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
  const attachDisabledReason = canAttach ? undefined : model ? labels.composer.noVision : labels.loadModelFirst;
  const attachReasonRef = useRef(attachDisabledReason); attachReasonRef.current = attachDisabledReason;
  const maxTokens = thread.chat?.settings.max_tokens ?? 1024;
  const meter = useContextMeter({ context: thread.state.context, draftText: input, draftImages: drafts.readyIds.length, model, maxTokens });
  const streaming = thread.phase === 'streaming';
  const onStreamingChangeRef = useRef(onStreamingChange); onStreamingChangeRef.current = onStreamingChange;
  const wasStreamingRef = useRef(streaming);
  useEffect(() => {
    if (wasStreamingRef.current === streaming) return;
    wasStreamingRef.current = streaming;
    onStreamingChangeRef.current?.(streaming);
  }, [streaming]);

  // A chat whose detail is still loading has no settings, no model and no
  // context yet, so a send would race the load — it reads as "no chat picked"
  // for as long as that lasts (which is also why it reuses that reason).
  const disabledReason = !thread.chat || thread.phase === 'loading'
    ? labels.composer.pickChat
    : !model
      ? labels.composer.modelNotLoaded
      : meter.state === 'full'
        ? labels.composer.contextFull
        : budget?.blocked_until
          ? labels.composer.budgetExhausted
          : undefined;

  const send = useCallback(async () => {
    // staged quotes go first, as blockquotes / fences, then what was typed
    const text = serializeQuotes(quotesRef.current, inputRef.current);
    const ids = draftsRef.current.readyIds;
    if (!text && ids.length === 0) return;
    setInput('');
    quotesRef.current = [];
    setQuotes([]);
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
    } catch (e) { setActionError(errorText(e, labelsRef.current.actionErrors.createChat)); }
  }, []);
  const renameChat = useCallback((id: string, title: string) => {
    void chatsApiRef.current.rename(id, title).catch((e: unknown) => setActionError(errorText(e, labelsRef.current.actionErrors.renameChat)));
  }, []);
  const removeChat = useCallback((id: string) => {
    void chatsApiRef.current.remove(id).catch((e: unknown) => setActionError(errorText(e, labelsRef.current.actionErrors.deleteChat)));
  }, []);
  const removeAllChats = useCallback(() => {
    void chatsApiRef.current.removeAll().catch((e: unknown) => setActionError(errorText(e, labelsRef.current.actionErrors.deleteChats)));
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
      if (atSeq === null) { setActionError(labelsRef.current.actionErrors.nothingToFork); return; }
      setForkReq({ mode: 'fork', atSeq, chatId });
    } catch (e) { setActionError(errorText(e, labelsRef.current.actionErrors.forkChat)); }
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
      setActionError(errorText(e, labelsRef.current.actionErrors.forkChat));
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
      setActionError(attachReasonRef.current ?? labelsRef.current.composer.noVision);
      return;
    }
    draftsRef.current.acceptDrop(e);
  }, []);
  const rejectImagePaste = useCallback((e: ReactClipboardEvent): boolean => {
    // a plain text paste must still reach the textarea untouched
    if (!pasteHasImage(e)) return false;
    e.preventDefault();
    setActionError(attachReasonRef.current ?? labelsRef.current.composer.noVision);
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

  // ---- selection actions → composer / transport ----------------------------
  const stageQuote = useCallback((q: Quote, opts: { chip: boolean }): void | false => {
    const asChip = opts.chip || selectionPrefsRef.current.quoteAsChips || quotesRef.current.length > 0;
    if (asChip) {
      if (quotesRef.current.length >= MAX_QUOTES) return false;
      const next = [...quotesRef.current, q];
      quotesRef.current = next;
      setQuotes(next);
    } else {
      const next = appendQuoteToDraft(inputRef.current, q);
      inputRef.current = next;
      setInput(next);
    }
    bumpFocus();
  }, [bumpFocus]);
  const removeQuote = useCallback((id: string) => {
    const next = quotesRef.current.filter((q) => q.id !== id);
    quotesRef.current = next;
    setQuotes(next);
  }, []);
  const sendNow = useCallback((text: string) => { void threadRef.current.sendPlain(text); }, []);
  const prefill = useCallback((text: string) => {
    const head = inputRef.current.replace(/\s+$/, '');
    const next = head ? head + '\n\n' + text : text;
    inputRef.current = next;
    setInput(next);
    bumpFocus();
  }, [bumpFocus]);
  const hostBranch = selOpts?.onBranchFrom;
  const branchFrom = useCallback(async (messageId: string, quote: Quote) => {
    if (hostBranch) { hostBranch(messageId, quote); return; }
    const chatId = selectedIdRef.current;
    const m = threadRef.current.state.messages.find((x) => x.id === messageId);
    if (!chatId || !m || !isForkable(m.seq)) { setActionError(labelsRef.current.actionErrors.cannotBranch); return; }
    try {
      const c = await chatsApiRef.current.fork(chatId, m.seq);
      setSelectedId(c.id);
      // the new chat's composer starts with the passage quoted
      stageQuote(quote, { chip: false });
    } catch (e) { setActionError(errorText(e, labelsRef.current.actionErrors.branchChat)); }
  }, [hostBranch, stageQuote]);
  const onBranchFrom = useCallback((messageId: string, quote: Quote) => { void branchFrom(messageId, quote); }, [branchFrom]);

  const changeSettings = useCallback((patch: { model?: string; settings?: Partial<ChatSettings> }) => {
    settingsPatchRef.current = threadRef.current.updateSettings(patch)
      .catch((e: unknown) => setActionError(errorText(e, labelsRef.current.actionErrors.updateSettings)));
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
    catch (e) { setActionError(errorText(e, labelsRef.current.actionErrors.saveDefaults)); }
  }, []);

  const closeDrawer = () => {
    // focus goes back to the button that opened it, not to <body>
    if (drawerRef.current?.contains(document.activeElement)) drawerToggleRef.current?.focus();
    setDrawerOpen(false);
  };
  const sidebarProps = {
    chats: chatsApi.chats, selectedId,
    onRename: renameChat, onDelete: removeChat, onDeleteAll: removeAllChats, onFork: onSidebarFork,
    // A chat with no model behind it can never be sent to; browsing the
    // ones that already exist stays available.
    canCreate: models.length > 0, createDisabledReason: labels.loadModelFirst,
    capabilities, currentUserId,
    scopeOptions, selectedScopeId, onScopeChange: setSelectedScopeId,
    rootInertId,
  };
  // Escape closes the compact layout's own overlays, the drawer first. Not
  // for a key that already did something (the rename field, the selection
  // menu) or one pressed inside a dialog — portals bubble through the React
  // tree, so a confirm dialog's Escape arrives here too, and must close only
  // the dialog.
  const onRootKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !compact) return;
    if ((e.target as Element).closest?.('[data-modal-overlay]')) return;
    if (drawerOpen) { e.preventDefault(); closeDrawer(); return; }
    if (settingsOpen) { e.preventDefault(); setSettingsOpen(false); }
  };

  return (
    // `relative` is load-bearing: <SettingsPanel> becomes an `absolute`
    // overlay below `md` (and always in the compact layout), and the drawer is
    // one too; both must resolve against this root, not the page. The host's
    // `className` comes last so it can override anything but that.
    <div ref={rootRef} className={cn('relative flex overflow-hidden', className)} style={rootStyle} onPaste={onPasteAnywhere} onKeyDown={onRootKeyDown}
      data-chat-layout={compact ? 'compact' : 'full'} data-chat-root="">
      {!compact && (
        <ChatSidebar {...sidebarProps} collapsed={railCollapsed} onToggle={toggleRail}
          onSelect={setSelectedId} onNew={() => void newChat()} />
      )}
      {compact && drawerOpen && (
        <>
          <div className="absolute inset-0 z-20 bg-chat-page/60" onClick={closeDrawer} aria-hidden data-chat-overlay="" />
          <div ref={drawerRef} className="absolute inset-y-0 left-0 z-30 flex max-w-[85%] overflow-hidden bg-chat-page shadow-xl" data-chat-overlay="">
            <ChatSidebar {...sidebarProps} collapsed={false} onToggle={closeDrawer}
              onSelect={(id) => { setSelectedId(id); closeDrawer(); }}
              onNew={() => { closeDrawer(); void newChat(); }} />
          </div>
        </>
      )}
      <SelectionScope
        on={selectionOn} prefs={selectionPrefs} onQuote={stageQuote} onSend={sendNow} onPrefill={prefill}
        canSend={!disabledReason && !streaming} onBranchFrom={onBranchFrom} messages={thread.state.messages}
        quickActions={selOpts?.quickActions} translateLanguages={selOpts?.translateLanguages}
        touchMode={selOpts?.touchMode} labels={selOpts?.labels}
      >
      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className={cn('flex items-center border-b border-chat-rule py-2', compact ? 'gap-2 px-2' : 'gap-3 px-4')}>
          {compact && (
            <Button ref={drawerToggleRef} variant="ghost" size="sm" aria-label={labels.widget.showChats} aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen((v) => !v)}>
              <PanelLeftOpen className="h-4 w-4" aria-hidden />
            </Button>
          )}
          <h1 className="flex min-w-0 items-baseline gap-1.5 font-mono text-sm text-chat-fg">
            <span className="truncate">{thread.chat?.title ?? labels.header.untitledChat}</span>
            {/* the auto-titler reassesses periodically; showing what the chat
                used to be called keeps it recognisable after it renames itself */}
            {thread.chat?.title_prev && (
              <span className="min-w-0 shrink truncate text-xs text-chat-dim" title={labels.header.previousTitleTooltip(thread.chat.title_prev)}>
                {labels.header.previousTitle(thread.chat.title_prev)}
              </span>
            )}
          </h1>
          <div className={cn('ml-auto flex shrink-0 items-center', compact ? 'gap-2' : 'gap-4')}>
            <ContextBar meter={meter} compact={compact} />
            {budget && <BudgetMeter budget={budget} compact={compact} />}
            {/* `settings: 'hidden'` removes the affordance AND the panel below;
                `settingsOpen` simply never leaves `false`. Nothing else in the
                header, sidebar or thread is conditioned on it. */}
            {capabilities.settings !== 'hidden' && (
              <Button variant="ghost" size="sm" aria-label={labels.header.settings} onClick={() => setSettingsOpen((v) => !v)}>
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
            reasoningOpen={reasoningOpen} onReasoningToggle={onReasoningToggle}
            textScale={textScale} onTextScaleChange={pinchToZoomText ? changeTextScale : undefined}
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
          {selectionOn && <SelectionDock />}
          <Composer
            value={input} onChange={setInput} onSend={() => void send()} onAbort={onAbort} isStreaming={streaming}
            disabled={!!disabledReason} disabledReason={disabledReason} drafts={drafts.drafts}
            canAttach={canAttach} attachDisabledReason={attachDisabledReason}
            onAddFiles={onAddFiles} onRemoveDraft={onRemoveDraft} onPaste={onPaste}
            capabilities={capabilities} focusKey={selectedId}
            quotes={selectionOn ? quotes : undefined} onRemoveQuote={selectionOn ? removeQuote : undefined}
            focusSignal={focusSignal} compact={compact}
          />
        </div>
      </section>
      </SelectionScope>
      {capabilities.settings !== 'hidden' && thread.chat && (
        <SettingsPanel
          open={settingsOpen} onClose={() => setSettingsOpen(false)} chat={thread.chat} models={models}
          capabilities={capabilities} onChange={changeSettings} onSaveDefaults={saveDefaults}
          selectionPrefs={selectionOn ? selectionPrefs : undefined}
          onSelectionPrefsChange={selectionOn ? onSelectionPrefsChange : undefined}
          overlay={compact}
          textScale={textScale} onTextScaleChange={changeTextScale}
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

/**
 * <SelectionActions> around the thread + composer column, or the column as
 * is when the host turned selection actions off.
 */
function SelectionScope({ on, children, ...rest }: { on: boolean; children: React.ReactNode } & Omit<React.ComponentProps<typeof SelectionActions>, 'children' | 'className'>) {
  if (!on) return <>{children}</>;
  return <SelectionActions {...rest} className="flex min-w-0 flex-1">{children}</SelectionActions>;
}
