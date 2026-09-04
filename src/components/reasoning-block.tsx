'use client';

import { useEffect, useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import type { Part } from '../model/message';

type ReasoningPart = Extract<Part, { type: 'reasoning' }>;

/**
 * Renders the model's `reasoning` part. Expanded while it is the newest part
 * and still streaming (no `durationMs` yet); collapses to a "Thought for N s"
 * summary once the reasoning span closes. A later reasoning part on the same
 * message is a fresh instance (`durationMs === undefined` again) and
 * re-expands via the `live` recompute in the effect below.
 *
 * `preferOpen` is the user's standing answer to "do I want to watch the model
 * think?", persisted per browser by the page. It gates ONLY the automatic
 * expansion: a block the user opened by hand stays open regardless (its
 * `live` never becomes true, so the effect below never fires on it), and
 * collapsing one mid-stream flips the preference so every subsequent span
 * stays shut too — which is exactly the reported complaint ("when it is
 * collapsed, it should stay collapsed").
 *
 * The reasoning text is deliberately not copyable (`select-none` + blocked
 * `onCopy`) — the message-level Copy button (Task 8 `MessageItem`) only
 * copies `text` parts.
 */
export function ReasoningBlock({ part, isNewest, streaming, preferOpen, onUserToggle }: {
  part: ReasoningPart;
  isNewest: boolean;
  streaming: boolean;
  preferOpen: boolean;
  onUserToggle: (open: boolean) => void;
}) {
  const live = preferOpen && isNewest && streaming && part.durationMs === undefined;
  const [open, setOpen] = useState(live);
  useEffect(() => {
    setOpen(live);
  }, [live]);
  const label = part.durationMs !== undefined ? `Thought for ${Math.max(1, Math.round(part.durationMs / 1000))} s` : 'Thinking…';
  return (
    <div className="my-1 rounded-[0.25rem] border border-chat-rule bg-chat-surface/50 text-xs">
      <button
        type="button"
        aria-expanded={open}
        // Not a setState updater: `onUserToggle` is a side effect, and React
        // may run an updater more than once.
        onClick={() => { const next = !open; setOpen(next); onUserToggle(next); }}
        className="flex w-full items-center gap-2 px-2 py-1 text-chat-muted hover:text-chat-fg"
      >
        {open ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
        <Brain className="h-3 w-3" aria-hidden />
        <span>{label}</span>
      </button>
      {open && (
        <pre
          className="select-none whitespace-pre-wrap px-3 pb-2 font-mono text-[12px] text-chat-dim"
          aria-label="model reasoning"
          onCopy={(e) => e.preventDefault()}
        >
          {part.text}
        </pre>
      )}
    </div>
  );
}
