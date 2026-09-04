import type { ContextMeter } from '../model/context-meter';

const FILL = { unknown: 'bg-chat-surface-2', ok: 'bg-chat-user', warn: 'bg-chat-warn', full: 'bg-chat-negative' } as const;

export function ContextBar({ meter }: { meter: ContextMeter }) {
  const pct = meter.fraction === null ? 0 : Math.min(100, Math.round(meter.fraction * 100));
  const label =
    meter.window === null
      ? `${meter.history.toLocaleString()} tokens · limit unknown`
      : `${(meter.history + meter.draft).toLocaleString()} + ${meter.reserve.toLocaleString()} reserved / ${meter.window.toLocaleString()}`;
  const segW = (n: number) => (meter.window ? `${Math.min(100, (n / meter.window) * 100)}%` : '0%');
  return (
    <div className="flex items-center gap-2 text-[11px] text-chat-dim" title="context window">
      <div
        role="progressbar"
        aria-label="Context window"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="relative h-1.5 w-40 overflow-hidden rounded-[0.25rem] bg-chat-surface-2"
      >
        <div data-testid="context-fill" className={`absolute inset-y-0 left-0 ${FILL[meter.state]}`} style={{ width: segW(meter.history) }} />
        <div className="absolute inset-y-0 bg-chat-user/40" style={{ left: segW(meter.history), width: segW(meter.draft) }} />
        <div className="absolute inset-y-0 bg-chat-dim" style={{ left: segW(meter.history + meter.draft), width: segW(meter.reserve) }} />
      </div>
      <span>{label}</span>
    </div>
  );
}
