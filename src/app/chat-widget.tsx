'use client';
// <ChatWidget> — <ChatApp> as a "chat with us" launcher and pop-up panel.
//
// A fixed launcher button in a bottom corner opens a fixed panel above it; the
// panel holds a `layout="widget"` <ChatApp> whose dialogs portal into the
// panel itself, so nothing the chat opens escapes onto the host page. Below
// `fullScreenBelow` px of viewport the panel takes the whole screen instead.
//
// Lifecycle: the chat mounts on the first open — a page that never opens the
// widget makes no request — and then stays mounted while the panel is hidden,
// so a reply keeps streaming when the user closes it. A reply that finishes
// while the panel is closed marks the launcher until the next open.
//
// The panel is a non-modal dialog: the page behind it stays usable, as a
// support chat's does. Escape inside it closes it (after any dialog, drawer or
// settings overlay of the chat's own, which take the key first) and focus
// returns to the launcher.
//
// Geometry: by default the panel is `width` × `height` above the launcher.
// `resizable` adds handles on the edges facing the page (and a maximize
// button); `movable` lets the header drag it. Either way the result is held
// as pixels measured from the launcher's corner — so the anchor stays the same
// edge when the window changes — clamped to the viewport on every render, and
// remembered in this browser unless `rememberLayout` is false.
//
// Full screen (narrow viewports) follows the VISUAL viewport, so the
// on-screen keyboard shrinks the panel instead of covering the composer, and
// pads itself out of the notch and home-indicator areas.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, Maximize2, MessageCircle, Minimize2, Move, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { ChatApp, type ChatAppProps } from './chat-app';
import { useVisualViewport } from '../hooks/use-visual-viewport';
import { ChatLabelsProvider, useChatLabels } from './labels-context';

export interface ChatWidgetProps extends Omit<ChatAppProps, 'layout' | 'portalContainer' | 'className' | 'suspended'> {
  /** Controlled open state; `onOpenChange` reports the user's opens and closes either way. */
  open?: boolean;
  /** Initial state when `open` is not controlled (default `false`). */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Which bottom corner (default `'bottom-right'`). */
  position?: 'bottom-right' | 'bottom-left';
  /** Panel width, any CSS length (default `'26rem'`); never wider than the viewport allows. */
  width?: string;
  /** Panel height, any CSS length (default `'40rem'`); never taller than the viewport allows. */
  height?: string;
  /** Distance of the launcher from the viewport edges, any CSS length (default `'1.25rem'`). */
  offset?: string;
  /** Viewport width in px under which the open panel fills the screen (default 640; `0` never). */
  fullScreenBelow?: number;
  /** When set, the panel's header links here ("Open full page"). */
  fullPageHref?: string;
  /** The panel's heading; `labels.widget.title` when absent. */
  title?: string;
  /** z-index of the launcher and panel (default 1000). */
  zIndex?: number;
  /** Extra classes for the launcher button. */
  launcherClassName?: string;
  /** Extra classes for the panel. */
  panelClassName?: string;
  /** Drag handles on the panel's edges facing the page, and a maximize button (default `false`). */
  resizable?: boolean;
  /** Drag the panel by its header (default `false`). Double-click the header to put it back. */
  movable?: boolean;
  /** Keep the size and place the user chose in this browser (default `true`; only with `resizable` or `movable`). */
  rememberLayout?: boolean;
  /** The user resized, moved, maximized or reset the panel; `null` is the default geometry. */
  onLayoutChange?: (layout: WidgetLayout | null) => void;
}

/**
 * The panel's chosen geometry, in CSS pixels: its size, and its distance from
 * the launcher's side (`x`) and from the bottom (`y`) of the viewport.
 */
export interface WidgetLayout { width: number; height: number; x: number; y: number }

const LAYOUT_KEY = 'chat2:widgetLayout';
/** Smallest panel a drag produces (the compact layout's floor), and the gap kept to the viewport's edges. */
const MIN_W = 320;
const MIN_H = 384;
const GAP = 8;
/** Arrow-key step for the resize and move handles; Shift multiplies it. */
const KEY_STEP = 16;

function readLayout(): WidgetLayout | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as Partial<WidgetLayout> | null;
    if (!v || ![v.width, v.height, v.x, v.y].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    return v as WidgetLayout;
  } catch { return null; }
}
function writeLayout(l: WidgetLayout | null): void {
  try { if (l) localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)); else localStorage.removeItem(LAYOUT_KEY); }
  catch { /* applies for this session only */ }
}

/** `l` inside a `vw` × `vh` viewport: never smaller than the floor allows, never past an edge. */
export function clampLayout(l: WidgetLayout, vw: number, vh: number): WidgetLayout {
  const width = Math.max(Math.min(MIN_W, vw - 2 * GAP), Math.min(l.width, vw - 2 * GAP));
  const height = Math.max(Math.min(MIN_H, vh - 2 * GAP), Math.min(l.height, vh - 2 * GAP));
  const x = Math.min(Math.max(GAP, l.x), Math.max(GAP, vw - width - GAP));
  const y = Math.min(Math.max(GAP, l.y), Math.max(GAP, vh - height - GAP));
  return { width: Math.round(width), height: Math.round(height), x: Math.round(x), y: Math.round(y) };
}

/** The viewport's size, kept current; the layout is clamped against it. */
function useViewportSize(): { vw: number; vh: number } {
  const [size, setSize] = useState({ vw: 0, vh: 0 });
  useEffect(() => {
    const on = () => setSize({ vw: window.innerWidth, vh: window.innerHeight });
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}


/** Whether `query` matches, kept current; `false` on the server and before mount. */
function useMediaQuery(query: string | null): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (!query || typeof window.matchMedia !== 'function') { setMatches(false); return; }
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}

/**
 * The launcher and panel read the strings too, and they sit outside the
 * provider <ChatApp> mounts — so the widget mounts its own from the same props.
 */
export function ChatWidget(props: ChatWidgetProps) {
  return (
    <ChatLabelsProvider labels={props.labels} locale={props.locale}>
      <ChatWidgetInner {...props} />
    </ChatLabelsProvider>
  );
}

function ChatWidgetInner({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  position = 'bottom-right',
  width = '26rem',
  height = '40rem',
  offset = '1.25rem',
  fullScreenBelow = 640,
  fullPageHref,
  title,
  zIndex = 1000,
  launcherClassName,
  panelClassName,
  // A widget sits on every page of the host; rewriting each page's URL with
  // the open chat's id is not what it is for. A host that wants it says so.
  syncUrlParam = null,
  onStreamingChange,
  resizable = false,
  movable = false,
  rememberLayout = true,
  onLayoutChange,
  ...chatProps
}: ChatWidgetProps) {
  const { labels: { widget: l } } = useChatLabels();
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const openRef = useRef(open); openRef.current = open;
  const onOpenChangeRef = useRef(onOpenChange); onOpenChangeRef.current = onOpenChange;
  const controlled = openProp !== undefined;
  const setOpen = useCallback((next: boolean) => {
    if (!controlled) setOpenState(next);
    onOpenChangeRef.current?.(next);
  }, [controlled]);

  // State, not a ref: <ChatApp> needs the element as its portal container,
  // so it mounts only once the panel exists.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const [everOpened, setEverOpened] = useState(open);
  useEffect(() => { if (open) setEverOpened(true); }, [open]);

  const [streaming, setStreaming] = useState(false);
  const [unread, setUnread] = useState(false);
  useEffect(() => { if (open) setUnread(false); }, [open]);
  const onStreamingChangeRef = useRef(onStreamingChange); onStreamingChangeRef.current = onStreamingChange;
  const onStreaming = useCallback((s: boolean) => {
    setStreaming(s);
    if (!s && !openRef.current) setUnread(true);
    onStreamingChangeRef.current?.(s);
  }, []);

  const fullScreen = useMediaQuery(fullScreenBelow > 0 ? `(max-width: ${fullScreenBelow - 0.02}px)` : null);
  const visual = useVisualViewport(open && fullScreen);

  // ---- resize / move ---------------------------------------------------------
  const side = position === 'bottom-left' ? 'left' : 'right';
  const adjustable = (resizable || movable) && !fullScreen;
  const persist = (resizable || movable) && rememberLayout;
  const { vw, vh } = useViewportSize();
  const [layoutState, setLayoutState] = useState<WidgetLayout | null>(null);
  // Stored geometry is read after mount: the server has no localStorage, and
  // the first client render must match what it sent.
  useEffect(() => { if (persist) setLayoutState(readLayout()); }, [persist]);
  const layout = adjustable && layoutState && vw > 0 ? clampLayout(layoutState, vw, vh) : null;
  // The size to go back to while maximized (`undefined`: not maximized).
  // While maximized, THIS is what is stored, not the maximized geometry: a
  // reload comes back restored, with a button that says "Maximize".
  const [maxRestore, setMaxRestore] = useState<WidgetLayout | null | undefined>(undefined);
  const onLayoutChangeRef = useRef(onLayoutChange); onLayoutChangeRef.current = onLayoutChange;
  const commitLayout = useCallback((next: WidgetLayout | null, stored: WidgetLayout | null = next) => {
    setLayoutState(next);
    if (persist) writeLayout(stored);
    onLayoutChangeRef.current?.(next);
  }, [persist]);
  /** Where the panel is now, as a layout — the starting point of any drag. */
  const currentLayout = useCallback((): WidgetLayout | null => {
    if (layout) return layout;
    const r = panel?.getBoundingClientRect();
    if (!r) return null;
    return { width: r.width, height: r.height, x: side === 'right' ? window.innerWidth - r.right : r.left, y: window.innerHeight - r.bottom };
  }, [layout, panel, side]);
  /**
   * One pointer drag. `edges` names what moves with the pointer: `move` the
   * whole panel, otherwise the edges being dragged (`top`, and `inner` — the
   * side facing the page). The listeners are on `window`, so the drag
   * survives its handle unmounting (full screen kicking in on a rotation,
   * `resizable` turning off): the effect below ends it, committed. Nothing
   * is committed until the pointer actually MOVES — a click on the header
   * is a click, not a layout.
   */
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endDragRef.current?.(), [adjustable]);
  const startDrag = (e: React.PointerEvent, edges: { move?: boolean; top?: boolean; inner?: boolean }) => {
    if (e.button !== 0) return;
    const from = currentLayout();
    if (!from) return;
    e.preventDefault();
    endDragRef.current?.();
    const x0 = e.clientX; const y0 = e.clientY;
    // a pointer moving right shrinks a right-anchored panel's inner edge
    const dirX = side === 'right' ? -1 : 1;
    let last: WidgetLayout | null = null;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) * dirX; const dy = y0 - ev.clientY;
      if (!last && !dx && !dy) return;
      const next = edges.move
        ? { ...from, x: from.x + dx, y: from.y + dy }
        : { ...from, width: edges.inner ? from.width + dx : from.width, height: edges.top ? from.height + dy : from.height };
      last = clampLayout(next, window.innerWidth, window.innerHeight);
      setLayoutState(last);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      endDragRef.current = null;
      if (!last) return;
      setMaxRestore(undefined);
      commitLayout(last);
    };
    endDragRef.current = end;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const onHandleKey = (e: React.KeyboardEvent, kind: 'resize' | 'move') => {
    const step = (e.shiftKey ? 4 : 1) * KEY_STEP;
    // arrows point where the edge (or panel) goes, on either side
    const toPage = side === 'right' ? 'ArrowLeft' : 'ArrowRight';
    const toEdge = side === 'right' ? 'ArrowRight' : 'ArrowLeft';
    const dx = e.key === toPage ? step : e.key === toEdge ? -step : 0;
    const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const from = currentLayout();
    if (!from) return;
    const next = kind === 'move' ? { ...from, x: from.x + dx, y: from.y + dy } : { ...from, width: from.width + dx, height: from.height + dy };
    setMaxRestore(undefined);
    commitLayout(clampLayout(next, window.innerWidth, window.innerHeight));
  };
  const maximized = maxRestore !== undefined;
  const toggleMaximize = () => {
    if (maximized) { commitLayout(maxRestore ?? null); setMaxRestore(undefined); return; }
    setMaxRestore(layoutState);
    // every pixel the launcher leaves: it stays on screen below the panel
    const bottom = launcherGap();
    commitLayout(
      clampLayout({ width: window.innerWidth, height: window.innerHeight - bottom - GAP, x: GAP, y: bottom }, window.innerWidth, window.innerHeight),
      layoutState,
    );
  };
  /** The default panel's distance from the bottom: above the launcher. */
  const launcherGap = () => {
    const r = launcherRef.current?.getBoundingClientRect();
    return r ? window.innerHeight - r.top + 12 : GAP;
  };

  // Focus follows the panel: into the composer on open (the panel itself when
  // the composer cannot take it yet), back to the launcher on close — but
  // only when it was inside the panel, so a host closing the widget from
  // elsewhere does not steal focus from where the user is.
  const chatMounted = everOpened && !!panel;
  useEffect(() => {
    if (!open || !panel) return;
    const id = requestAnimationFrame(() => {
      if (panel.contains(document.activeElement)) return;
      const field = panel.querySelector<HTMLTextAreaElement>('textarea:not([disabled])');
      (field ?? panel).focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, panel, chatMounted]);
  // The launcher is not mounted while a full-screen panel covers its corner,
  // so the hand-back waits for the commit that brings it back.
  const restoreFocusRef = useRef(false);
  const close = useCallback(() => {
    if (panel?.contains(document.activeElement)) {
      restoreFocusRef.current = true;
      launcherRef.current?.focus();
    }
    setOpen(false);
  }, [panel, setOpen]);
  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    if (document.activeElement !== launcherRef.current) launcherRef.current?.focus();
  }, [open]);

  // Escape closes the panel last: the chat's own dialogs, drawer, settings
  // overlay, rename field and selection menu all claim it first (they
  // preventDefault, or a dialog is still on screen).
  useEffect(() => {
    if (!open || !panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as Node | null;
      if (!t || !(panel.contains(t) || launcherRef.current?.contains(t))) return;
      if (document.querySelector('[data-modal-overlay]')) return;
      e.preventDefault();
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, panel, close]);

  const titleId = useId();
  const panelId = useId();
  // Launcher: 3.5rem square; the panel stands 0.75rem above it. Both keep
  // clear of the home indicator (`safe-area-inset-bottom`, 0 elsewhere).
  const bottomInset = 'env(safe-area-inset-bottom, 0px)';
  const panelStyle: React.CSSProperties = fullScreen
    ? {
        zIndex, left: 0, right: 0, width: '100%',
        // the visual viewport: what the keyboard leaves of the screen
        top: visual ? visual.top : 0,
        height: visual ? visual.height : '100%',
        paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: bottomInset,
        paddingLeft: 'env(safe-area-inset-left, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)',
      }
    : layout
      ? { zIndex, [side]: layout.x, bottom: layout.y, width: layout.width, height: layout.height }
      : {
          zIndex,
          [side]: offset,
          bottom: `calc(${offset} + 4.25rem + ${bottomInset})`,
          width: `min(${width}, calc(100vw - 2 * ${offset}))`,
          height: `min(${height}, calc(100dvh - ${offset} * 2 - 4.25rem - ${bottomInset}))`,
        };
  // the handles sit on the edges facing the page: left of a right-anchored panel
  const inner = side === 'right' ? 'left' : 'right';
  const status = streaming ? l.answering : unread ? l.unread : null;

  return (
    <>
      <div
        ref={setPanel}
        id={panelId}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        hidden={!open}
        data-chat-widget-panel=""
        data-chat-root=""
        className={cn(
          // `hidden` alone loses to the `flex` utility's display, so the class follows `open` too
          'fixed flex-col overflow-hidden border-chat-rule bg-chat-page text-chat-fg shadow-2xl [outline:none]',
          open ? 'flex' : 'hidden',
          fullScreen ? '' : 'rounded-lg border',
          panelClassName,
        )}
        style={panelStyle}
      >
        {adjustable && resizable && (
          <>
            {/* Pointer-only strips; the corner button below is the keyboard way. */}
            <div aria-hidden className={cn('absolute inset-x-0 top-0 z-40 h-1.5 cursor-ns-resize touch-none')}
              onPointerDown={(e) => startDrag(e, { top: true })} data-chat-widget-handle="top" />
            <div aria-hidden className={cn('absolute inset-y-0 z-40 w-1.5 cursor-ew-resize touch-none', inner === 'left' ? 'left-0' : 'right-0')}
              onPointerDown={(e) => startDrag(e, { inner: true })} data-chat-widget-handle="inner" />
            <button type="button" aria-label={l.resize} title={l.resize}
              className={cn('absolute top-0 z-50 h-4 w-4 touch-none focus-visible:[outline:none] focus-visible:ring-2 focus-visible:ring-chat-accent',
                inner === 'left' ? 'left-0 cursor-nwse-resize' : 'right-0 cursor-nesw-resize')}
              onPointerDown={(e) => startDrag(e, { top: true, inner: true })} onKeyDown={(e) => onHandleKey(e, 'resize')}
              onDoubleClick={() => { setMaxRestore(undefined); commitLayout(null); }}
              data-chat-widget-handle="corner" />
          </>
        )}
        <div
          className={cn('flex shrink-0 items-center gap-1 border-b border-chat-rule px-3 py-2', adjustable && movable && 'cursor-move touch-none select-none')}
          // the header's own buttons and link keep their clicks
          onPointerDown={adjustable && movable ? (e) => { if (!(e.target as Element).closest('button, a')) startDrag(e, { move: true }); } : undefined}
          onDoubleClick={adjustable && movable ? (e) => { if (!(e.target as Element).closest('button, a')) { setMaxRestore(undefined); commitLayout(null); } } : undefined}
          data-chat-widget-header=""
        >
          {adjustable && movable && (
            <Button variant="ghost" size="sm" aria-label={l.move} title={l.move} className="cursor-move px-1.5" onKeyDown={(e) => onHandleKey(e, 'move')}>
              <Move className="h-4 w-4" aria-hidden />
            </Button>
          )}
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold">{title ?? l.title}</h2>
          {adjustable && resizable && (
            <Button variant="ghost" size="sm" aria-label={maximized ? l.restore : l.maximize} title={maximized ? l.restore : l.maximize} onClick={toggleMaximize}>
              {maximized ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
            </Button>
          )}
          {fullPageHref && (
            <a href={fullPageHref} aria-label={l.openFullPage} title={l.openFullPage}
              className="rounded-[0.25rem] p-1.5 text-chat-muted hover:bg-chat-surface-2 hover:text-chat-fg focus-visible:[outline:none] focus-visible:ring-2 focus-visible:ring-chat-accent">
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          )}
          <Button variant="ghost" size="sm" aria-label={l.close} onClick={close}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        {chatMounted && (
          <ChatApp
            {...chatProps}
            layout="widget"
            syncUrlParam={syncUrlParam}
            portalContainer={panel}
            onStreamingChange={onStreaming}
            suspended={!open}
            className="min-h-0 flex-1"
          />
        )}
      </div>
      {/* Hidden while a full-screen panel covers its corner; the panel's own × closes it. */}
      {!(open && fullScreen) && (
        <button
          ref={launcherRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? l.close : status ? `${l.open} — ${status}` : l.open}
          title={!open && status ? status : undefined}
          onClick={() => (open ? close() : setOpen(true))}
          data-chat-widget-launcher=""
          className={cn(
            'fixed flex h-14 w-14 items-center justify-center rounded-full bg-chat-user text-chat-on-accent shadow-xl hover:opacity-90 focus-visible:[outline:none] focus-visible:ring-2 focus-visible:ring-chat-accent focus-visible:ring-offset-2 focus-visible:ring-offset-chat-page',
            launcherClassName,
          )}
          style={{ zIndex, [side]: offset, bottom: `calc(${offset} + ${bottomInset})` }}
        >
          {open ? <X className="h-6 w-6" aria-hidden /> : <MessageCircle className="h-6 w-6" aria-hidden />}
          {!open && status && (
            <span
              data-testid="chat-widget-indicator"
              data-state={streaming ? 'answering' : 'unread'}
              className={cn('absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-chat-accent ring-2 ring-chat-page', streaming && 'animate-pulse')}
              aria-hidden
            />
          )}
        </button>
      )}
    </>
  );
}
