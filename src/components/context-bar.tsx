import type { ContextMeter } from '../model/context-meter';
import { useChatLabels } from '../app/labels-context';

const FILL = { unknown: 'bg-chat-surface-2', ok: 'bg-chat-user', warn: 'bg-chat-warn', full: 'bg-chat-negative' } as const;

/**
 * `compact`: a shorter bar and the figures for screen readers only — the
 * header of a 400 px widget has no room for "12,345 / 8,192 tokens".
 */
export function ContextBar({ meter, compact }: { meter: ContextMeter; compact?: boolean }) {
  const { labels: { meters: l }, format } = useChatLabels();
  const pct = meter.fraction === null ? 0 : Math.min(100, Math.round(meter.fraction * 100));
  const label =
    meter.window === null
      ? l.contextLimitUnknown(format.number(meter.history))
      : l.contextUsage(format.number(meter.history + meter.draft), format.number(meter.reserve), format.number(meter.window));
  const segW = (n: number) => (meter.window ? `${Math.min(100, (n / meter.window) * 100)}%` : '0%');
  return (
    <div className="flex items-center gap-2 text-[11px] text-chat-dim" title={l.contextTooltip}>
      <div
        role="progressbar"
        aria-label={l.contextWindow}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className={`relative h-1.5 ${compact ? 'w-16' : 'w-40'} overflow-hidden rounded-[0.25rem] bg-chat-surface-2`}
      >
        <div data-testid="context-fill" className={`absolute inset-y-0 left-0 ${FILL[meter.state]}`} style={{ width: segW(meter.history) }} />
        <div className="absolute inset-y-0 bg-chat-user/40" style={{ left: segW(meter.history), width: segW(meter.draft) }} />
        <div className="absolute inset-y-0 bg-chat-dim" style={{ left: segW(meter.history + meter.draft), width: segW(meter.reserve) }} />
      </div>
      <span className={compact ? 'sr-only' : undefined}>{label}</span>
    </div>
  );
}
