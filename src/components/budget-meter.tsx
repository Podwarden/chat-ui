import type { Budget } from '../adapters/types';

export function BudgetMeter({ budget }: { budget: Budget }) {
  if (!budget.window) return null;
  const pct = Math.min(100, Math.round((budget.window.used_micros / Math.max(1, budget.window.limit_micros)) * 100));
  const usd = (m: number) => `$${(m / 1_000_000).toFixed(2)}`;
  return (
    <div className="flex items-center gap-2 text-[11px] text-chat-dim" title={`resets ${new Date(budget.window.resets_at).toLocaleString()}`}>
      <div
        role="progressbar"
        aria-label="Budget"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 w-24 overflow-hidden rounded-[0.25rem] bg-chat-surface-2"
      >
        <div className={`h-full ${pct >= 100 ? 'bg-chat-negative' : pct >= 85 ? 'bg-chat-warn' : 'bg-chat-user'}`} style={{ width: `${pct}%` }} />
      </div>
      <span>
        {usd(budget.window.used_micros)} / {usd(budget.window.limit_micros)}
      </span>
    </div>
  );
}
