'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type TouchEvent, type WheelEvent } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { ArrowDown } from 'lucide-react';
import type { AttachmentOut } from '../adapters/types';
import type { ThreadState } from '../model/message';
import { MessageItem, type MessageItemProps } from './message-item';
import type { ChatUiLabels, Labels } from '../app/labels';
import { useChatLabels } from '../app/labels-context';
import { useSelectionActions } from './selection/context';
import { clampTextScale } from '../model/prefs';

/**
 * Every row, the streaming tail and the empty placeholder are scaled by the
 * container's `--chat-text-scale` through CSS `zoom`: unlike a transform it
 * re-lays the text out at the new size, so lines re-wrap to the width instead
 * of running off it, and the virtualised list measures the zoomed rows like
 * any other height change (checked in Chromium and WebKit).
 */
const SCALED = '[zoom:var(--chat-text-scale,1)]';

type Handlers = Pick<MessageItemProps, 'onRegenerate' | 'onForkHere' | 'onEdit' | 'onPick' | 'onRetry' | 'onOpenImage'>;

/**
 * What the footer (streaming tail) and the empty placeholder need from the
 * <Thread> render. Handed down through React context — NOT closed over by an
 * inline component — because Virtuoso's `components.*` are component TYPES:
 * an inline `Footer: () => …` is a new type on every <Thread> render, i.e. on
 * every streamed token, so React unmounted and remounted the whole tail per
 * token. That reset every piece of local state in it (a code block's
 * "Show all", its fold measurement — the owner-reported flicker) and swapped
 * the DOM out from under the user's clicks.
 */
interface ThreadSlotCtx {
  tail: MessageItemProps['message'] | null;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  tailProps: Omit<MessageItemProps, 'message' | 'isLast' | 'isStreaming' | 'turnInFlight'>;
  startConversation: string;
}
const SlotCtx = createContext<ThreadSlotCtx | null>(null);

function ThreadFooter() {
  const c = useContext(SlotCtx)!;
  return (
    <div ref={c.bottomRef}>
      {c.tail && (
        <div data-testid="stream-tail" className={SCALED}>
          <MessageItem message={c.tail} isLast isStreaming turnInFlight {...c.tailProps} />
        </div>
      )}
      <div className="h-4" />
    </div>
  );
}

function ThreadEmpty() {
  const c = useContext(SlotCtx)!;
  // Virtuoso renders the placeholder whenever `data` is empty, footer or not —
  // suppress it for the very first turn, whose tail is already streaming into
  // the footer.
  return c.tail ? null : (
    <div className={`flex h-full items-center justify-center p-8 text-sm text-chat-dim ${SCALED}`}>{c.startConversation}</div>
  );
}

/** Module-level so the component types never change between renders. */
const VIRTUOSO_COMPONENTS = { Footer: ThreadFooter, EmptyPlaceholder: ThreadEmpty };

export interface ThreadProps extends Handlers {
  state: ThreadState;
  attachments: Record<string, AttachmentOut>;
  isStreaming: boolean;
  turnInFlight: boolean;
  maxTokens?: number;
  onDropFiles: (e: DragEvent) => void;
  /** Persisted "auto-expand reasoning blocks" preference (see model/prefs.ts). */
  reasoningOpen: boolean;
  /** The user opened/closed a reasoning block by hand; the page persists it. */
  onReasoningToggle: (open: boolean) => void;
  /**
   * Overrides for the two strings this component owns, over whatever the
   * nearest `ChatLabelsProvider` says (English outside one).
   */
  labels?: Partial<Pick<Labels, 'startConversation' | 'jumpToLatest'>>;
  /** The transcript's text scale, 1 = the package's own sizes (see `TEXT_SCALE_MIN`/`MAX`). */
  textScale?: number;
  /**
   * Two fingers in the transcript change the text scale (re-wrapping it,
   * which page zoom never does) instead of zooming the page; this is called
   * once with the new scale when the fingers lift. Without it a pinch is the
   * browser's own page zoom, as before.
   */
  onTextScaleChange?: (scale: number) => void;
}

/** What the reducer writes into `state.announcement` (see `model/message.ts`). */
const DONE_ANNOUNCEMENT = 'Response complete';
const ERROR_PREFIX = 'Error: ';

/**
 * The `done` event makes the reducer announce "Response complete" for every
 * terminal reason. Two of them are not a completion at all and must read
 * differently to a screen reader — the user pressed Stop, or the stream died.
 *
 * The reducer is pure and locale-free, so its two fixed announcements are
 * mapped to the host's strings here; anything else it might carry is passed
 * through as is.
 */
function announcementFor(state: ThreadState, l: ChatUiLabels['thread']): string {
  const a = state.announcement;
  if (!a) return '';
  if (a.startsWith(ERROR_PREFIX)) return l.error(a.slice(ERROR_PREFIX.length));
  if (a !== DONE_ANNOUNCEMENT) return a;
  const last = state.messages[state.messages.length - 1];
  if (last?.finishReason === 'aborted') return l.responseStopped;
  if (last?.finishReason === 'interrupted') return l.connectionLost;
  return l.responseComplete;
}

/**
 * How long the viewport has to stay off the bottom before "Jump to latest"
 * appears. A streaming burst outruns the scroll animation and makes Virtuoso
 * emit a stutter of transient `atBottom=false`; without this the button
 * flickers on every other delta.
 */
const JUMP_DEBOUNCE_MS = 200;
/**
 * Pointer/touch travel (px) below which a press is a tap or hand tremor, not a
 * drag. Shared by the touch handler and the scrollbar-drag detection: both are
 * asking the same question — did this press MOVE?
 */
const TOUCH_SLOP_PX = 8;

export function Thread(p: ThreadProps) {
  const { labels: context } = useChatLabels();
  const labels = { ...context, ...p.labels };
  const ref = useRef<VirtuosoHandle>(null);
  const msgs = p.state.messages;
  const tail = p.state.pendingTail;

  // Follow mode is deliberately NOT derived from the scroll position.
  //
  // `atBottom` is a *system* signal: during a fast stream Virtuoso reports
  // off-bottom constantly simply because the content grew faster than the
  // scroll landed. Latching follow off that signal is what used to unstick
  // the tail mid-answer with nobody having touched anything. So:
  //
  //   - `follow` flips off ONLY on a user gesture on the scroller (wheel up,
  //     touch drag that pulls earlier content in, PageUp/ArrowUp/Home) and
  //     back on when they press "Jump to latest";
  //   - `atBottom` drives nothing but the button's visibility, debounced;
  //   - `followOutput="auto"` stays on permanently — react-virtuoso only
  //     auto-scrolls when the list is ALREADY at the bottom, so it self-gates
  //     the re-pin and never yanks a reader who has scrolled up.
  const [follow, setFollow] = useState(true);
  const followRef = useRef(follow); followRef.current = follow;
  // `followOutput` re-pins only when DATA changes. Rows that grow after they
  // landed — Shiki highlighting a block, KaTeX typesetting, a narrow widget
  // panel re-wrapping the text — moved the bottom away with nobody scrolling,
  // and a chat opened in a short box sat above its last line behind "Jump to
  // latest". While following, any height change re-pins.
  const onTotalHeightChanged = useCallback(() => {
    if (followRef.current) ref.current?.scrollToIndex({ index: 'LAST', align: 'end' });
  }, []);
  const [showJump, setShowJump] = useState(false);
  const atBottomRef = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartYRef = useRef(0);
  // Where a press started, and whether it has since travelled far enough to
  // count as a drag. Both null/false whenever no button is held.
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerDraggingRef = useRef(false);

  const onAtBottomStateChange = useCallback((atBottom: boolean) => {
    atBottomRef.current = atBottom;
    // A scrollbar drag emits no wheel, no touch and no keydown — the only
    // trace it leaves is a pointer that MOVED while held. "Held" alone is not
    // enough: a plain click or tap in the thread holds the button for ~100 ms,
    // and a streaming burst that lands inside that window would then read as a
    // scroll decision — the exact race this design exists to prevent. So the
    // arming condition is travel past the slop, not the press itself.
    if (!atBottom && pointerDraggingRef.current) setFollow(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Hiding is immediate — the latest IS on screen, saying otherwise for
    // another 200 ms would be a lie the user can see.
    if (atBottom) { setShowJump(false); return; }
    debounceRef.current = setTimeout(() => {
      if (!atBottomRef.current) setShowJump(true);
    }, JUMP_DEBOUNCE_MS);
  }, []);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const onPointerDown = useCallback((e: PointerEvent) => {
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    pointerDraggingRef.current = false;
  }, []);
  // The move and release halves are on the window, not the element: a
  // scrollbar drag routinely travels (and ends) outside the scroller, or
  // outside the viewport entirely. A `pointerup` we never heard would leave
  // the flag stuck on, turning every later streaming stutter into a follow
  // exit — so the listeners live where they cannot be escaped. `move` costs a
  // null check per event and does nothing at all unless a press is open.
  useEffect(() => {
    const move = (e: globalThis.PointerEvent) => {
      const start = pointerStartRef.current;
      if (!start || pointerDraggingRef.current) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TOUCH_SLOP_PX) {
        pointerDraggingRef.current = true;
      }
    };
    const release = () => {
      pointerStartRef.current = null;
      pointerDraggingRef.current = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  const exitFollow = useCallback(() => setFollow(false), []);
  const onWheel = useCallback((e: WheelEvent) => { if (e.deltaY < 0) exitFollow(); }, [exitFollow]);
  // One finger only: two are a pinch, and a pinch is not a decision to
  // scroll away from the latest message. The start is re-seeded whenever
  // the finger count changes, so the finger left on the glass after a pinch
  // measures from where it is now, not from where the pinch began.
  const onTouchStart = useCallback((e: TouchEvent) => { touchStartYRef.current = e.touches[0]?.clientY ?? 0; }, []);
  const onTouchEnd = useCallback((e: TouchEvent) => { if (e.touches.length) touchStartYRef.current = e.touches[0].clientY; }, []);
  const onTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const y = e.touches[0]?.clientY;
    // A finger dragged DOWN pulls earlier content into view — the touch
    // equivalent of `wheel` with `deltaY < 0`.
    if (y !== undefined && y - touchStartYRef.current > TOUCH_SLOP_PX) exitFollow();
  }, [exitFollow]);
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    // Only fires when focus is inside the scroller, which is exactly when
    // these keys scroll it.
    if (e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'Home') exitFollow();
  }, [exitFollow]);

  const jumpToLatest = useCallback(() => {
    ref.current?.scrollToIndex({ index: 'LAST', align: 'end' });
    setFollow(true);
    // The scroll lands asynchronously, so `atBottomStateChange` would leave
    // the button up for a frame or two; the intent is unambiguous here.
    setShowJump(false);
  }, []);

  // Inside <SelectionActions>: let a quote's "go to source" bring a row that
  // Virtuoso has not mounted into view. Leaving follow mode is the point — a
  // reader sent up the transcript must not be yanked back by the next token.
  const selection = useSelectionActions();
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;
  useEffect(() => {
    if (!selection) return;
    selection.registerScroller((id) => {
      const index = msgsRef.current.findIndex((m) => m.id === id);
      if (index < 0) return false;
      setFollow(false);
      ref.current?.scrollToIndex({ index, align: 'center' });
      return true;
    });
    return () => selection.registerScroller(null);
  }, [selection]);

  // `MessageItem` is `memo`'d so that a delta on the tail costs one row
  // render, not N. That only holds if every callback a row receives is
  // referentially stable — callers hand us fresh arrows on most renders, so
  // read them through a ref and expose identity-stable wrappers.
  const latest = useRef(p);
  latest.current = p;
  const onForkHere = useCallback((seq: number) => latest.current.onForkHere(seq), []);
  const onPick = useCallback((callId: string | null, selected: string[]) => latest.current.onPick(callId, selected), []);
  const onOpenImage = useCallback((a: AttachmentOut) => latest.current.onOpenImage(a), []);
  const onEditStable = useCallback((seq: number, text: string) => latest.current.onEdit?.(seq, text), []);
  const onRegenerateStable = useCallback(() => latest.current.onRegenerate?.(), []);
  const onRetryStable = useCallback(() => latest.current.onRetry?.(), []);
  const onReasoningToggle = useCallback((open: boolean) => latest.current.onReasoningToggle(open), []);
  // presence still has to be honoured — `MessageItem` renders the Edit /
  // Regenerate / Retry affordances only when the prop is defined
  const onEdit = p.onEdit ? onEditStable : undefined;
  const onRegenerate = p.onRegenerate ? onRegenerateStable : undefined;
  const onRetry = p.onRetry ? onRetryStable : undefined;

  const lastAssistantIdx = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') return i;
    return -1;
  }, [msgs]);

  // The tail lives in Virtuoso's footer (outside item measurement) so its
  // growth never reflows the committed rows — which also means Virtuoso's own
  // `followOutput` cannot see it. Nudge the footer into view ourselves while
  // the user is still stuck to the bottom.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!follow || !tail) return;
    // jsdom has no scrollIntoView
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [tail, follow]);

  const slot = useMemo<ThreadSlotCtx>(
    () => ({
      tail,
      bottomRef,
      tailProps: {
        attachments: p.attachments,
        maxTokens: p.maxTokens,
        onForkHere,
        onPick,
        onOpenImage,
        reasoningOpen: p.reasoningOpen,
        onReasoningToggle,
      },
      startConversation: labels.startConversation,
    }),
    [tail, p.attachments, p.maxTokens, onForkHere, onPick, onOpenImage, p.reasoningOpen, onReasoningToggle, labels.startConversation],
  );

  // ---- text scale ------------------------------------------------------------
  // The variable is written to the DOM, not rendered: a pinch updates it every
  // frame without re-rendering the transcript, and a render in between (a
  // streamed token) must not snap it back to the committed value mid-gesture.
  const containerRef = useRef<HTMLDivElement>(null);
  const textScale = clampTextScale(p.textScale ?? 1);
  const pinchingRef = useRef(false);
  useLayoutEffect(() => {
    if (!pinchingRef.current) containerRef.current?.style.setProperty('--chat-text-scale', String(textScale));
  }, [textScale]);
  const textScaleRef = useRef(textScale); textScaleRef.current = textScale;
  const onTextScaleChangeRef = useRef(p.onTextScaleChange); onTextScaleChangeRef.current = p.onTextScaleChange;
  const pinchOn = !!p.onTextScaleChange;
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !pinchOn) return;
    type Start = { dist: number; scale: number; midY: number; anchor: Element | null; ratio: number };
    let start: Start | null = null;
    let live = textScaleRef.current;
    let frame = 0;
    const distance = (t: globalThis.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const scroller = () => el.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]');
    const apply = () => {
      frame = 0;
      const s = start;
      el.style.setProperty('--chat-text-scale', String(live));
      // Keep the line under the fingers under the fingers. While following,
      // the bottom is the anchor instead (`onTotalHeightChanged` re-pins).
      if (!s?.anchor || followRef.current || !s.anchor.isConnected) return;
      const r = s.anchor.getBoundingClientRect();
      const sc = scroller();
      if (sc) sc.scrollTop += r.top + s.ratio * r.height - s.midY;
    };
    const onStart = (e: globalThis.TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      const anchor = document.elementFromPoint?.(midX, midY)?.closest('[data-index], [data-testid="stream-tail"]') ?? null;
      const r = anchor?.getBoundingClientRect();
      pinchingRef.current = true;
      live = textScaleRef.current;
      start = { dist: distance(e.touches) || 1, scale: live, midY, anchor, ratio: r && r.height ? (midY - r.top) / r.height : 0 };
    };
    const onMove = (e: globalThis.TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      live = clampTextScale(start.scale * (distance(e.touches) / start.dist));
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onEnd = (e: globalThis.TouchEvent) => {
      if (!start || e.touches.length >= 2) return;
      start = null;
      if (frame) { cancelAnimationFrame(frame); apply(); }
      pinchingRef.current = false;
      if (live !== textScaleRef.current) onTextScaleChangeRef.current?.(live);
      // Back to the committed value a frame later — by then a host that took
      // the new scale has re-rendered with it (touchend is a discrete event,
      // rendered synchronously), and a controlled host that did not is not
      // left showing a scale it never agreed to.
      requestAnimationFrame(() => {
        if (!pinchingRef.current) el.style.setProperty('--chat-text-scale', String(textScaleRef.current));
      });
    };
    // Safari's own pinch-zoom arrives as gesture events beside the touches.
    const onGesture = (e: Event) => e.preventDefault();
    const opts = { passive: false } as const;
    el.addEventListener('touchstart', onStart, opts);
    el.addEventListener('touchmove', onMove, opts);
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('gesturestart', onGesture, opts);
    el.addEventListener('gesturechange', onGesture, opts);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      pinchingRef.current = false;
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('gesturestart', onGesture);
      el.removeEventListener('gesturechange', onGesture);
    };
  }, [pinchOn]);

  return (
    <SlotCtx.Provider value={slot}>
    <div
      ref={containerRef}
      className="relative h-full"
      data-testid="thread-drop-zone"
      // a `drop` handler alone never fires — the default dragover action is
      // "reject the drag", so it has to be prevented on every dragover tick
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
      }}
      onDrop={p.onDropFiles}
      // Follow-mode exits: these bubble up from the Virtuoso scroller, and a
      // user gesture is the ONLY thing allowed to turn following off.
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onKeyDown={onKeyDown}
    >
      <Virtuoso
        ref={ref}
        // contain: reaching the top or bottom of the transcript must not hand
        // the swipe on to the page — on a phone that scrolled the header and
        // the composer off the screen
        style={{ height: '100%', overscrollBehavior: 'contain' }}
        data={msgs}
        followOutput="auto"
        totalListHeightChanged={onTotalHeightChanged}
        atBottomStateChange={onAtBottomStateChange}
        computeItemKey={(_, m) => m.id}
        itemContent={(i, m) => (
          <div className={SCALED}>
          <MessageItem
            message={m}
            attachments={p.attachments}
            isLast={i === lastAssistantIdx && !tail}
            isStreaming={false}
            turnInFlight={p.turnInFlight}
            onRegenerate={i === lastAssistantIdx && !tail ? onRegenerate : undefined}
            onForkHere={onForkHere}
            onEdit={onEdit}
            onPick={onPick}
            onRetry={i === msgs.length - 1 && !tail ? onRetry : undefined}
            onOpenImage={onOpenImage}
            reasoningOpen={p.reasoningOpen}
            onReasoningToggle={onReasoningToggle}
          />
          </div>
        )}
        components={VIRTUOSO_COMPONENTS}
      />
      {/* streaming text itself is never announced — only terminal states and errors */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcementFor(p.state, context.thread)}
      </div>
      {/* nothing to jump TO on an empty thread, however the scroller reports */}
      {showJump && (msgs.length > 0 || tail) && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-chat-rule bg-chat-surface px-3 py-1 text-xs text-chat-muted shadow-[0_1px_3px_rgb(0_0_0/0.3)] hover:text-chat-accent"
          aria-label={labels.jumpToLatest}
        >
          <ArrowDown className="mr-1 inline h-3 w-3" aria-hidden /> {labels.jumpToLatest}
        </button>
      )}
    </div>
    </SlotCtx.Provider>
  );
}
