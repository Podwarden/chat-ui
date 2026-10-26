import type { Budget } from '../adapters/types';
import { useChatLabels } from '../app/labels-context';

/** `compact`: as on `<ContextBar>` — a shorter bar, the figures for screen readers only. */
export function BudgetMeter({ budget, compact }: { budget: Budget; compact?: boolean }) {
  const { labels: { meters: l }, format } = useChatLabels();
  if (!budget.window) return null;
  const pct = Math.min(100, Math.round((budget.window.used_micros / Math.max(1, budget.window.limit_micros)) * 100));
  const usd = (m: number) => format.usd(m / 1_000_000, 2);
  return (
    <div className="flex items-center gap-2 text-[11px] text-chat-dim" title={l.budgetResets(format.dateTime(budget.window.resets_at))}>
      <div
        role="progressbar"
        aria-label={l.budget}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className={`h-1.5 ${compact ? 'w-12' : 'w-24'} overflow-hidden rounded-[0.25rem] bg-chat-surface-2`}
      >
        <div className={`h-full ${pct >= 100 ? 'bg-chat-negative' : pct >= 85 ? 'bg-chat-warn' : 'bg-chat-user'}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={compact ? 'sr-only' : undefined}>
        {usd(budget.window.used_micros)} / {usd(budget.window.limit_micros)}
      </span>
    </div>
  );
}
