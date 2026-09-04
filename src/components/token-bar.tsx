export function TokenBar({ completion, max, streaming }: { completion: number; max: number; streaming: boolean }) {
  const pct = Math.min(100, Math.round((completion / Math.max(1, max)) * 100));
  return (
    <div className="mt-1 flex items-center gap-2 text-[11px] text-chat-dim">
      <div
        role="progressbar"
        aria-label="Response tokens"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1 w-24 overflow-hidden rounded-[0.25rem] bg-chat-surface-2"
      >
        <div className={`h-full ${streaming ? 'bg-chat-user' : 'bg-chat-dim'}`} style={{ width: `${pct}%` }} />
      </div>
      <span>{`${completion} / ${max}`}</span>
    </div>
  );
}
