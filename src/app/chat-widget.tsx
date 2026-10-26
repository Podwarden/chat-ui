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
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, MessageCircle, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { ChatApp, type ChatAppProps } from './chat-app';
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
  const side = position === 'bottom-left' ? 'left' : 'right';
  // Launcher: 3.5rem square; the panel stands 0.75rem above it.
  const panelStyle: React.CSSProperties = fullScreen
    ? { zIndex, inset: 0, width: '100%', height: '100%' }
    : {
        zIndex,
        [side]: offset,
        bottom: `calc(${offset} + 4.25rem)`,
        width: `min(${width}, calc(100vw - 2 * ${offset}))`,
        height: `min(${height}, calc(100dvh - ${offset} * 2 - 4.25rem))`,
      };
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
        className={cn(
          // `hidden` alone loses to the `flex` utility's display, so the class follows `open` too
          'fixed flex-col overflow-hidden border-chat-rule bg-chat-page text-chat-fg shadow-2xl [outline:none]',
          open ? 'flex' : 'hidden',
          fullScreen ? '' : 'rounded-lg border',
          panelClassName,
        )}
        style={panelStyle}
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-chat-rule px-3 py-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold">{title ?? l.title}</h2>
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
          style={{ zIndex, [side]: offset, bottom: offset }}
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
