'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type TouchEvent, type WheelEvent } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { ArrowDown } from 'lucide-react';
import type { AttachmentOut } from '../adapters/types';
import type { ThreadState } from '../model/message';
import { MessageItem, type MessageItemProps } from './message-item';
import { DEFAULT_LABELS, type Labels } from '../app/labels';

type Handlers = Pick<MessageItemProps, 'onRegenerate' | 'onForkHere' | 'onEdit' | 'onPick' | 'onRetry' | 'onOpenImage'>;

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
  /** Overrides for the two strings this component owns; English otherwise. */
  labels?: Partial<Pick<Labels, 'startConversation' | 'jumpToLatest'>>;
}

/**
 * The `done` event makes the reducer announce "Response complete" for every
 * terminal reason. Two of them are not a completion at all and must read
 * differently to a screen reader — the user pressed Stop, or the stream died.
 */
function announcementFor(state: ThreadState): string {
  const a = state.announcement;
  if (!a || a !== 'Response complete') return a ?? '';
  const last = state.messages[state.messages.length - 1];
  if (last?.finishReason === 'aborted') return 'Response stopped';
  if (last?.finishReason === 'interrupted') return 'Connection lost';
  return a;
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
  const labels = { ...DEFAULT_LABELS, ...p.labels };
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
  const onTouchStart = useCallback((e: TouchEvent) => { touchStartYRef.current = e.touches[0]?.clientY ?? 0; }, []);
  const onTouchMove = useCallback((e: TouchEvent) => {
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

  return (
    <div
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
      onKeyDown={onKeyDown}
    >
      <Virtuoso
        ref={ref}
        style={{ height: '100%' }}
        data={msgs}
        followOutput="auto"
        atBottomStateChange={onAtBottomStateChange}
        computeItemKey={(_, m) => m.id}
        itemContent={(i, m) => (
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
        )}
        components={{
          Footer: () => (
            <div ref={bottomRef}>
              {tail && (
                <div data-testid="stream-tail">
                  <MessageItem
                    message={tail}
                    attachments={p.attachments}
                    isLast
                    isStreaming
                    turnInFlight
                    maxTokens={p.maxTokens}
                    onForkHere={onForkHere}
                    onPick={onPick}
                    onOpenImage={onOpenImage}
                    reasoningOpen={p.reasoningOpen}
                    onReasoningToggle={onReasoningToggle}
                  />
                </div>
              )}
              <div className="h-4" />
            </div>
          ),
          // Virtuoso renders the placeholder whenever `data` is empty, footer
          // or not — suppress it for the very first turn, whose tail is
          // already streaming into the footer.
          EmptyPlaceholder: () =>
            tail ? null : (
              <div className="flex h-full items-center justify-center p-8 text-sm text-chat-dim">
                {labels.startConversation}
              </div>
            ),
        }}
      />
      {/* streaming text itself is never announced — only terminal states and errors */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcementFor(p.state)}
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
  );
}
