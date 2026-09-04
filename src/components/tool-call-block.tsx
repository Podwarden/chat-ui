'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import type { Part } from '../model/message';
import { TOOL_BLOCK_CHAR_CAP } from '../model/limits';

type ToolCallPart = Extract<Part, { type: 'tool_call' }>;
type ToolResultPart = Extract<Part, { type: 'tool_result' }>;

/** Text block capped at `TOOL_BLOCK_CHAR_CAP` chars with a "Show all" reveal. */
function Capped({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const shown = all || text.length <= TOOL_BLOCK_CHAR_CAP ? text : text.slice(0, TOOL_BLOCK_CHAR_CAP);
  return (
    <>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] text-chat-muted">{shown}</pre>
      {!all && text.length > TOOL_BLOCK_CHAR_CAP && (
        <button type="button" className="text-xs text-chat-accent-strong hover:text-chat-accent" onClick={() => setAll(true)}>
          Show all ({text.length.toLocaleString()} chars)
        </button>
      )}
    </>
  );
}

export function ToolCallBlock({
  call,
  result,
  streaming,
  durationMs,
}: {
  call: ToolCallPart;
  result?: ToolResultPart;
  streaming: boolean;
  durationMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const status = result ? (result.ok ? 'done' : 'failed') : streaming ? 'running' : 'pending';
  const preview = call.argsText.length > 80 ? call.argsText.slice(0, 80) + '…' : call.argsText;
  return (
    <div className="my-1 rounded-[0.25rem] border border-chat-rule bg-chat-surface/50 text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-chat-muted hover:text-chat-fg"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" aria-hidden /> : <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
        <Wrench className="h-3 w-3 shrink-0" aria-hidden />
        <span className="font-mono text-chat-accent-strong">{call.name}</span>
        <span className="truncate font-mono text-chat-dim">{preview}</span>
        <span className="ml-auto shrink-0">
          {status}
          {durationMs !== undefined ? ` · ${durationMs} ms` : ''}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-chat-rule px-3 py-2">
          <div>
            <div className="mb-1 text-chat-dim">arguments</div>
            <Capped text={call.argsText} />
          </div>
          {result && (
            <div>
              <div className="mb-1 text-chat-dim">result</div>
              <Capped text={typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
