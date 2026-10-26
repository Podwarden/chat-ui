'use client';

import {
  useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Copy, GitBranch, HelpCircle, MessageSquareQuote, Quote as QuoteIcon, Send } from 'lucide-react';
import { copyToClipboard } from '@/ui/clipboard';
import { cn } from '@/ui/cn';
import type { Message } from '../../model/message';
import { DEFAULT_SELECTION_PREFS, type SelectionPrefs } from '../../model/prefs';
import {
  DEFAULT_QUICK_ACTIONS, TRANSLATE_LANGUAGES, browserLanguage, buildAskPrompt, buildExplainPrompt,
  buildInstructionPrompt, buildTranslatePrompt, languageName, newQuoteId, normalizeForSearch,
  type QuickAction, type Quote,
} from '../../model/selection';
import {
  BODY_SELECTOR, clipBoxFor, computeMenuPosition, findTextRange, flash, rangeFromOffsets, takeSnapshot,
  visibleRects, type MenuPosition, type SelectionSnapshot,
} from './dom';
import {
  DEFAULT_SELECTION_LABELS, DockSlotContext, SELECTION_SHORTCUT, SelectionActionsContext,
  type DockSlotValue, type SelectionActionsContextValue, type SelectionLabels,
} from './context';
import { useChatLabels } from '../../app/labels-context';
import { localeLanguage } from '../../model/locale';

/** Imperative handle (`ref`) — for a host whose composer lives outside the provider. */
export interface SelectionActionsHandle {
  revealQuote(q: Pick<Quote, 'text' | 'source'>): void;
  close(): void;
}

export interface SelectionActionsProps {
  /** The thread (and, ideally, the composer — see `<SelectionDock>`). */
  children: ReactNode;
  /** Effective preferences; defaults to `DEFAULT_SELECTION_PREFS`. */
  prefs?: Partial<SelectionPrefs>;
  /**
   * Stage a quote in the composer. `opts.chip` asks for a chip regardless of
   * `prefs.quoteAsChips` (the code-block "Ask"). Return `false` to refuse
   * (e.g. the chip limit) — the user is told.
   */
  onQuote(q: Quote, opts: { chip: boolean }): void | false;
  /** Send `text` as a new user message in this chat, now. `quotes` are the passages it carries. */
  onSend(text: string, quotes: Quote[]): void;
  /** Put `text` in the message box (replacing nothing the user typed) and focus it. */
  onPrefill(text: string, quotes: Quote[]): void;
  /** `false` while a turn is in flight / the composer is blocked: sending actions prefill instead. */
  canSend?: boolean;
  /**
   * "Branch into a new chat" (More ▸). Absent → the item is not offered.
   * `<ChatApp>` wires this to the fork capability by default.
   */
  onBranchFrom?(messageId: string, quote: Quote): void;
  /** Replaces the built-in Simplify / Make shorter / Give an example. */
  quickActions?: readonly QuickAction[];
  /** Language codes offered by Translate (the browser's own is put first). */
  translateLanguages?: readonly string[];
  /**
   * `'auto'` (default) docks the actions above the composer on touch input
   * (never floating over the native selection menu) and floats them on a mouse;
   * `'dock'` / `'float'` force one.
   */
  touchMode?: 'auto' | 'dock' | 'float';
  /** The transcript, for finding a sent quote's source after a reload. */
  messages?: readonly Message[];
  /**
   * The menu's strings, over the nearest `ChatLabelsProvider`'s `selection`
   * group (English outside one), key by key; `undefined` values are skipped. The Explain/Translate instruction lines and
   * the language-name locale come from that provider (`labels.prompts`,
   * `locale`).
   */
  labels?: Partial<SelectionLabels>;
  className?: string;
  ref?: Ref<SelectionActionsHandle>;
}

type View = 'main' | 'ask' | 'more';
interface MenuState {
  snap: SelectionSnapshot;
  mode: 'float' | 'dock';
  view: View;
  /** Opened from the keyboard: focus goes to the first item. */
  focus: boolean;
}

const TOAST_MS = 1800;

/** Plain text of a message's text parts (source Markdown). */
function messageText(m: Message): string {
  return m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
}

/**
 * Text-selection actions for a chat thread: a small menu over a selection
 * (Copy · Quote · Explain · Ask… · More ▸), a docked bar on touch screens,
 * a keyboard shortcut, and the plumbing for "Quote" on a message, "Ask" on
 * a code block and sent quotes that link back to their source.
 *
 * Generic: it never touches a composer or a transport itself — every effect
 * goes through `onQuote` / `onSend` / `onPrefill` / `onBranchFrom`.
 */
export function SelectionActions(p: SelectionActionsProps) {
  const prefs: SelectionPrefs = { ...DEFAULT_SELECTION_PREFS, ...p.prefs };
  const strings = useChatLabels();
  const contextLabels = strings.labels.selection;
  // `selectionActions.labels` wins over `labels.selection` key by key; like
  // `labels`, it only replaces a string with a string (undefined is skipped).
  const labels = useMemo(() => {
    const out: SelectionLabels = { ...DEFAULT_SELECTION_LABELS, ...contextLabels };
    for (const [k, v] of Object.entries(p.labels ?? {})) {
      if (typeof v === 'string' && Object.hasOwn(out, k)) out[k as keyof SelectionLabels] = v;
    }
    return out;
  }, [contextLabels, p.labels]);
  const locale = strings.locale;
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenuState] = useState<MenuState | null>(null);
  const menuStateRef = useRef<MenuState | null>(null);
  const setMenu = useCallback((m: MenuState | null) => { menuStateRef.current = m; setMenuState(m); }, []);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [dockSlots, setDockSlots] = useState(0);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  const latest = useRef(p);
  latest.current = p;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  // Instruction lines and locale for the actions, read at call time.
  const stringsRef = useRef(strings);
  stringsRef.current = strings;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerDownRef = useRef(false);
  /** A press on the menu/dock is under way: the selection collapsing under it is not a dismissal. */
  const interactingRef = useRef(false);
  const lastPointerType = useRef<string | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const announcedRef = useRef(false);
  const flipRef = useRef(false);
  const focusedFor = useRef<MenuState | null>(null);
  const scrollerRef = useRef<((id: string) => boolean) | null>(null);
  /** Sent quotes → where they came from, so the sent blockquote can link back. */
  const sentSources = useRef(new Map<string, Quote['source']>());

  useEffect(() => {
    const el = rootRef.current;
    if (el) setPortalTarget(el.closest('[data-chat-theme]') ?? el.ownerDocument.body);
  }, []);

  const say = useCallback((msg: string, visible = true) => {
    // a trailing no-break space on every other message makes the same text
    // twice a CHANGE, so a live region announces it again
    flipRef.current = !flipRef.current;
    setAnnounce(msg + (flipRef.current ? '\u00a0' : ''));
    if (!visible) return;
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const close = useCallback((restore = true) => {
    const m = menuStateRef.current;
    if (!m) return;
    const hadFocus = menuRef.current?.contains(document.activeElement) ?? false;
    setMenu(null);
    setPos(null);
    if (restore && hadFocus && restoreFocusRef.current?.isConnected) restoreFocusRef.current.focus();
    restoreFocusRef.current = null;
  }, [setMenu]);

  const isTouch = useCallback(() => {
    const mode = latest.current.touchMode ?? 'auto';
    if (mode !== 'auto') return mode === 'dock';
    if (lastPointerType.current) return lastPointerType.current === 'touch' || lastPointerType.current === 'pen';
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  }, []);

  /** Open (or refresh) the menu for the current selection; close when there is none. */
  const evaluate = useCallback((viaKeyboard = false) => {
    const root = rootRef.current;
    if (!root || !prefsRef.current.enabled) return false;
    const snap = takeSnapshot(root);
    const cur = menuStateRef.current;
    if (!snap) {
      // Focus inside the menu (the Ask field) collapses the selection on purpose.
      if (cur && !menuRef.current?.contains(document.activeElement) && cur.snap.range.startContainer.isConnected) close(false);
      return false;
    }
    const same = cur && cur.snap.text === snap.text && cur.snap.quote.source?.messageId === snap.quote.source?.messageId;
    if (same && !viaKeyboard) return true;
    if (viaKeyboard) restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const mode = isTouch() ? 'dock' : 'float';
    setMenu({ snap, mode, view: 'main', focus: viaKeyboard });
    setPos(null);
    if (!viaKeyboard && !announcedRef.current) {
      announcedRef.current = true;
      say(stringsRef.current.labels.selectionPhrases.available(SELECTION_SHORTCUT, labelsRef.current.available), false);
    }
    return true;
  }, [close, isTouch, say, setMenu]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; evaluate(false); }, prefsRef.current.delayMs);
  }, [evaluate]);

  // ---- document listeners -------------------------------------------------
  useEffect(() => {
    if (!prefs.enabled) { close(false); return; }
    const inUi = (t: EventTarget | null) => t instanceof Node && !!menuRef.current?.contains(t);
    const onPointerDown = (e: PointerEvent) => {
      lastPointerType.current = e.pointerType || lastPointerType.current;
      if (inUi(e.target)) { interactingRef.current = true; return; }
      pointerDownRef.current = true;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      // a click outside dismisses a floating menu (the dock follows the selection instead)
      if (menuStateRef.current?.mode === 'float') close(false);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (inUi(e.target)) { setTimeout(() => { interactingRef.current = false; }, 0); return; }
      pointerDownRef.current = false;
      schedule();
    };
    const onPointerCancel = () => {
      pointerDownRef.current = false;
      interactingRef.current = false;
      schedule();
    };
    const onSelectionChange = () => {
      if (pointerDownRef.current || interactingRef.current) return; // settles on pointerup
      const sel = document.getSelection();
      const m = menuStateRef.current;
      if (m && (!sel || sel.isCollapsed) && !menuRef.current?.contains(document.activeElement)) {
        // Nodes that vanished are a streaming re-render, not the user: keep the snapshot.
        if (m.snap.range.startContainer.isConnected) close(false);
        return;
      }
      schedule();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuStateRef.current) {
        e.preventDefault();
        e.stopPropagation();
        close(true);
        return;
      }
      if (e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const t = e.target as Element | null;
        if (t?.closest?.('input, textarea, select, [contenteditable="true"]') && !inUi(t)) return;
        if (evaluate(true)) e.preventDefault();
        else if (menuStateRef.current) { e.preventDefault(); setMenu({ ...menuStateRef.current, focus: true }); }
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    // A drag of already-selected text ends in `dragend`, and a gesture the
    // browser takes over in `pointercancel` — neither sends a pointerup.
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('dragend', onPointerCancel, true);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      document.removeEventListener('dragend', onPointerCancel, true);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('keydown', onKeyDown, true);
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [prefs.enabled, close, evaluate, schedule, setMenu]);

  // ---- placement ----------------------------------------------------------
  const reposition = useCallback(() => {
    const m = menuStateRef.current;
    const el = menuRef.current;
    if (!m || m.mode !== 'float' || !el) return;
    const range = m.snap.range;
    const anchorEl = range.startContainer.isConnected ? (range.startContainer.parentElement ?? rootRef.current) : null;
    if (!anchorEl) return; // re-rendered away mid-stream: stay where we are
    const clip = clipBoxFor(anchorEl);
    const all = Array.from(range.getClientRects?.() ?? []).filter((r) => r.width > 0 || r.height > 0);
    const rects = visibleRects(range, clip);
    if (all.length > 0 && rects.length === 0) { close(false); return; } // scrolled out of view
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const next = computeMenuPosition(rects, clip, size, { width: window.innerWidth, height: window.innerHeight });
    setPos(next ?? { top: Math.max(8, clip.top + 8), left: Math.max(8, clip.left + 8), placement: 'below' });
  }, [close]);

  useLayoutEffect(() => { if (menu?.mode === 'float') reposition(); }, [menu, reposition]);
  useEffect(() => {
    if (menu?.mode !== 'float') return;
    const on = () => reposition();
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on, true); window.removeEventListener('resize', on); };
  }, [menu?.mode, reposition]);

  // Keyboard-opened: focus the first item — once the menu is placed. A
  // floating menu is `visibility: hidden` until its first measurement, and
  // the browser silently refuses focus to a hidden element.
  useEffect(() => {
    if (!menu?.focus || (menu.mode === 'float' && !pos) || focusedFor.current === menu) return;
    focusedFor.current = menu; // once per opening, not on every reposition
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menu, pos]);

  // ---- actions ------------------------------------------------------------
  const deliver = useCallback((text: string, quotes: Quote[], mode: 'send' | 'prefill') => {
    for (const q of quotes) if (q.source) sentSources.current.set(normalizeForSearch(q.text), q.source);
    if (mode === 'send' && latest.current.canSend !== false) {
      latest.current.onSend(text, quotes);
      say(labelsRef.current.sent, false);
    } else {
      latest.current.onPrefill(text, quotes);
      say(mode === 'send' ? labelsRef.current.busyPrefilled : labelsRef.current.prefilled, mode === 'send');
    }
  }, [say]);

  const stage = useCallback((q: Quote, chip: boolean) => {
    if (latest.current.onQuote(q, { chip }) === false) { say(labelsRef.current.tooManyQuotes); return false; }
    if (q.source) sentSources.current.set(normalizeForSearch(q.text), q.source);
    say(labelsRef.current.quoted, false);
    return true;
  }, [say]);

  const doCopy = useCallback(async (snap: SelectionSnapshot) => {
    try {
      const nav = navigator as Navigator & { clipboard?: Clipboard };
      const CI = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (snap.rich && CI && nav.clipboard?.write && window.isSecureContext) {
        // plain text first: it is what most paste targets read
        await nav.clipboard.write([new CI({
          'text/plain': new Blob([snap.text], { type: 'text/plain' }),
          'text/html': new Blob([snap.html], { type: 'text/html' }),
        })]);
      } else {
        await copyToClipboard(snap.text);
      }
      say(labelsRef.current.copied);
    } catch {
      say(labelsRef.current.copyFailed);
    }
  }, [say]);

  const run = useCallback((action: string, arg?: string) => {
    const m = menuStateRef.current;
    if (!m) return;
    const { snap } = m;
    const q = snap.quote;
    switch (action) {
      case 'copy': void doCopy(snap); close(true); return;
      case 'quote': close(false); stage({ ...q, id: newQuoteId() }, false); return;
      case 'explain': close(false); deliver(buildExplainPrompt(q, stringsRef.current.labels.prompts.explain), [q], prefsRef.current.explainMode); return;
      case 'ask': setMenu({ ...m, view: 'ask', focus: false }); return;
      case 'ask-send': {
        const question = (arg ?? '').trim();
        if (!question) return;
        close(false);
        deliver(buildAskPrompt(q, question), [q], 'send');
        return;
      }
      case 'more': setMenu({ ...m, view: m.view === 'more' ? 'main' : 'more', focus: false }); return;
      case 'translate': {
        close(false);
        const { labels: all, locale: loc } = stringsRef.current;
        const code = arg ?? 'en';
        deliver(buildTranslatePrompt(q, languageName(code, loc), (name) => all.prompts.translate(name, code)), [q], 'send');
        return;
      }
      case 'branch': {
        close(false);
        if (!q.source) { say(labelsRef.current.cannotBranch); return; }
        latest.current.onBranchFrom?.(q.source.messageId, { ...q, id: newQuoteId() });
        return;
      }
      default: {
        const qa = (latest.current.quickActions ?? DEFAULT_QUICK_ACTIONS).find((a) => a.id === action);
        if (!qa) return;
        close(false);
        deliver(buildInstructionPrompt(qa.instruction, q), [q], 'send');
      }
    }
  }, [close, deliver, doCopy, say, setMenu, stage]);

  // ---- source links ---------------------------------------------------------
  const revealQuote = useCallback((qq: Pick<Quote, 'text' | 'source'>) => {
    const root = rootRef.current;
    if (!root) return;
    let source = qq.source ?? sentSources.current.get(normalizeForSearch(qq.text));
    if (!source) {
      // after a reload: find the passage in the transcript's source text, newest first
      const needle = normalizeForSearch(qq.text).slice(0, 120);
      const msgs = latest.current.messages ?? [];
      for (let i = msgs.length - 1; i >= 0 && needle; i--) {
        const m = msgs[i]!;
        if (m.role === 'user') continue;
        if (normalizeForSearch(messageText(m)).includes(needle)) { source = { messageId: m.id }; break; }
      }
    }
    if (!source) { say(labelsRef.current.sourceNotFound); return; }
    const id = source.messageId;
    const find = () => Array.from(root.querySelectorAll<HTMLElement>(BODY_SELECTOR)).find((b) => b.dataset.messageId === id) ?? null;
    const land = (body: HTMLElement) => {
      let range: Range | null = null;
      if (source!.start !== undefined && source!.end !== undefined) {
        const r = rangeFromOffsets(body, source!.start, source!.end);
        // trust the offsets only while the text there is still the quote
        if (r && r.toString().replace(/\s+/g, '') === qq.text.replace(/\s+/g, '')) range = r;
      }
      range ??= findTextRange(body, qq.text);
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      body.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      flash(body, range);
    };
    const now = find();
    if (now) { land(now); return; }
    if (!scrollerRef.current?.(id)) { say(labelsRef.current.sourceNotFound); return; }
    // virtualised: wait for the row to mount
    let tries = 0;
    const tick = () => {
      const b = find();
      if (b) land(b);
      else if (++tries < 40) requestAnimationFrame(tick);
      else say(labelsRef.current.sourceNotFound);
    };
    requestAnimationFrame(tick);
  }, [say]);

  useImperativeHandle(p.ref, () => ({ revealQuote, close: () => close(false) }), [revealQuote, close]);

  const ctx = useMemo<SelectionActionsContextValue>(() => ({
    quoteMessage: (messageId, text) => {
      stage({ id: newQuoteId(), text: text.trim(), kind: 'text', source: { messageId } }, false);
    },
    quoteCode: (code, lang, messageId) => {
      stage({ id: newQuoteId(), text: code, kind: 'code', lang, source: messageId ? { messageId } : undefined }, true);
    },
    revealQuote,
    registerScroller: (fn) => { scrollerRef.current = fn; },
    labels,
  }), [stage, revealQuote, labels]);

  // ---- rendering ------------------------------------------------------------
  const menuNode = menu ? (
    <MenuBody
      ref={menuRef}
      state={menu}
      labels={labels}
      canBranch={!!p.onBranchFrom}
      quickActions={p.quickActions ?? DEFAULT_QUICK_ACTIONS}
      languages={p.translateLanguages ?? TRANSLATE_LANGUAGES}
      locale={locale}
      onRun={run}
      onClose={() => close(true)}
      style={menu.mode === 'float'
        ? { position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden', zIndex: 50 }
        : undefined}
    />
  ) : null;

  const dockNode = menu?.mode === 'dock' ? menuNode : null;
  const dockSlot = useMemo<DockSlotValue>(() => ({
    node: dockNode,
    register: () => { setDockSlots((n) => n + 1); return () => setDockSlots((n) => n - 1); },
  }), [dockNode]);

  return (
    <SelectionActionsContext.Provider value={ctx}>
      <DockSlotContext.Provider value={dockSlot}>
        <div ref={rootRef} className={cn('relative', p.className)} data-selection-root="">
          {p.children}
          {dockSlots === 0 && dockNode && <div className="absolute inset-x-2 bottom-2 z-20">{dockNode}</div>}
        </div>
        {menu?.mode === 'float' && portalTarget && createPortal(menuNode, portalTarget)}
        {toast && (
          <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full border border-chat-rule bg-chat-surface px-3 py-1 text-xs text-chat-fg shadow-[0_1px_3px_rgb(0_0_0/0.3)]" data-testid="selection-toast" aria-hidden>
            {toast}
          </div>
        )}
        <div role="status" aria-live="polite" className="sr-only" data-testid="selection-live">{announce}</div>
      </DockSlotContext.Provider>
    </SelectionActionsContext.Provider>
  );
}

/**
 * Where the touch dock renders: place it directly above the composer. Without
 * one, `<SelectionActions>` docks the bar at the bottom of its own box.
 */
export function SelectionDock({ className }: { className?: string }) {
  const slot = useContext(DockSlotContext);
  const register = slot?.register;
  useEffect(() => register?.(), [register === undefined]); // eslint-disable-line react-hooks/exhaustive-deps -- register once
  if (!slot?.node) return null;
  return <div className={className}>{slot.node}</div>;
}

// ---------------------------------------------------------------------------

interface MenuBodyProps {
  state: MenuState;
  labels: SelectionLabels;
  canBranch: boolean;
  quickActions: readonly QuickAction[];
  languages: readonly string[];
  /** Language names are shown in this locale; its language is offered first. */
  locale: string | undefined;
  onRun(action: string, arg?: string): void;
  onClose(): void;
  style?: React.CSSProperties;
  ref?: Ref<HTMLDivElement>;
}

const itemCls =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[0.25rem] px-2 py-1 text-xs text-chat-fg hover:bg-chat-surface-2 focus-visible:[outline:none] focus-visible:ring-2 focus-visible:ring-chat-accent disabled:opacity-40';

/** Move focus among a menu's items: arrows, Tab, Home/End (WAI-ARIA menu pattern, roving tabindex). */
function rove(e: ReactKeyboardEvent<HTMLElement>, container: HTMLElement | null, vertical: boolean, onExit?: () => void) {
  if (!container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"], select'))
    .filter((el) => !(el as HTMLButtonElement).disabled);
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const onSelect = (document.activeElement as HTMLElement).tagName === 'SELECT';
  const next = vertical ? ['ArrowDown'] : ['ArrowRight', 'ArrowDown'];
  const prev = vertical ? ['ArrowUp'] : ['ArrowLeft', 'ArrowUp'];
  let to = -1;
  if (onSelect && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) return; // native option change
  if (next.includes(e.key) || (e.key === 'Tab' && !e.shiftKey)) to = (i + 1) % items.length;
  else if (prev.includes(e.key) || (e.key === 'Tab' && e.shiftKey)) to = (i - 1 + items.length) % items.length;
  else if (e.key === 'Home') to = 0;
  else if (e.key === 'End') to = items.length - 1;
  else if (vertical && e.key === 'ArrowLeft' && onExit) { e.preventDefault(); e.stopPropagation(); onExit(); return; }
  if (to < 0) return;
  e.preventDefault();
  e.stopPropagation();
  items[to]!.focus();
}

function MenuBody({ state, labels, canBranch, quickActions, languages, locale, onRun, onClose, style, ref }: MenuBodyProps) {
  const mainRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLInputElement>(null);
  const [question, setQuestion] = useState('');
  // The UI's language first when the host gave one (the user picked it),
  // else the browser's.
  const langs = useMemo(() => {
    const mine = localeLanguage(locale) ?? browserLanguage();
    return [mine, ...languages.filter((l) => l !== mine)];
  }, [languages, locale]);
  const nameOf = (code: string) => languageName(code, locale);
  const phrases = useChatLabels().labels.selectionPhrases;
  const [lang, setLang] = useState(langs[0]!);
  const moreViaKeyboard = useRef(false);
  const dock = state.mode === 'dock';

  useEffect(() => { if (state.view === 'ask') askRef.current?.focus(); }, [state.view]);
  useEffect(() => {
    if (state.view === 'more' && moreViaKeyboard.current) {
      moreViaKeyboard.current = false;
      subRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  }, [state.view]);

  // Buttons must not take the selection away (focus/selection survive the press).
  const keep = (e: React.MouseEvent | React.PointerEvent) => {
    if ((e.target as Element).closest('input, select')) return;
    e.preventDefault();
  };

  const item = (id: string, label: string, icon: ReactNode, extra?: Partial<React.ButtonHTMLAttributes<HTMLButtonElement>> & { ref?: Ref<HTMLButtonElement> }) => (
    <button key={id} type="button" role="menuitem" tabIndex={id === (dock ? 'quote' : 'copy') ? 0 : -1} aria-label={label} className={cn(itemCls, dock && 'min-h-[44px] px-1.5')}
      onClick={(e) => { if (id === 'more') moreViaKeyboard.current = e.detail === 0; onRun(id); }} {...extra}>
      {icon}<span>{label}</span>
    </button>
  );

  return (
    <div
      ref={ref}
      style={style}
      data-testid={dock ? 'selection-dock' : 'selection-menu'}
      data-selection-ignore=""
      className={cn(
        'select-none rounded-[0.375rem] border border-chat-rule bg-chat-surface p-1 text-chat-fg shadow-[0_4px_16px_rgb(0_0_0/0.35)]',
        dock && 'w-full',
      )}
      onPointerDown={keep}
      onMouseDown={keep}
    >
      {state.view === 'ask' ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => { e.preventDefault(); onRun('ask-send', question); }}
        >
          <input
            ref={askRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
            aria-label={labels.askPlaceholder}
            placeholder={labels.askPlaceholder}
            className="min-w-0 flex-1 rounded-[0.25rem] bg-chat-page px-2 py-1 text-sm text-chat-fg placeholder:text-chat-dim focus:[outline:none] focus:ring-2 focus:ring-chat-accent sm:w-64"
          />
          <button type="submit" aria-label={labels.askSend} className={itemCls} disabled={!question.trim()}>
            <Send className="h-3.5 w-3.5" aria-hidden />
          </button>
        </form>
      ) : (
        <>
          <div
            ref={mainRef}
            role="menu"
            aria-label={labels.menu}
            aria-orientation="horizontal"
            className={cn('flex items-center gap-0.5', dock && 'flex-wrap justify-around')}
            onKeyDown={(e) => rove(e, mainRef.current, false)}
          >
            {!dock && item('copy', labels.copy, <Copy className="h-3.5 w-3.5" aria-hidden />)}
            {item('quote', labels.quote, <QuoteIcon className="h-3.5 w-3.5" aria-hidden />)}
            {item('explain', labels.explain, <HelpCircle className="h-3.5 w-3.5" aria-hidden />)}
            {item('ask', labels.ask, <MessageSquareQuote className="h-3.5 w-3.5" aria-hidden />)}
            {item('more', labels.more, <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', state.view === 'more' && 'rotate-90')} aria-hidden />, {
              ref: moreRef, 'aria-haspopup': 'menu', 'aria-expanded': state.view === 'more',
            })}
          </div>
          {state.view === 'more' && (
            <div
              ref={subRef}
              role="menu"
              aria-label={labels.more}
              className="mt-1 flex flex-col border-t border-chat-rule pt-1"
              onKeyDown={(e) => rove(e, subRef.current, true, () => { onRun('more'); moreRef.current?.focus(); })}
            >
              {quickActions.map((a) => item(a.id, a.label, null))}
              <div className="flex items-center gap-1">
                <button type="button" role="menuitem" tabIndex={-1} className={cn(itemCls, 'flex-1 justify-start', dock && 'min-h-[44px]')}
                  aria-label={phrases.translateTo(nameOf(lang), labels.translateTo)} onClick={() => onRun('translate', lang)}>
                  {phrases.translateTo(nameOf(lang), labels.translateTo)}
                </button>
                <select aria-label={labels.translateLanguage} value={lang} onChange={(e) => setLang(e.target.value)} tabIndex={-1}
                  className="rounded-[0.25rem] border border-chat-rule bg-chat-page px-1 py-0.5 text-xs text-chat-fg">
                  {langs.map((l) => <option key={l} value={l}>{nameOf(l)}</option>)}
                </select>
              </div>
              {canBranch && item('branch', labels.branch, <GitBranch className="h-3.5 w-3.5" aria-hidden />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
