'use client';

import { memo, useMemo, useState } from 'react';
import { Copy, GitFork, Pencil, RotateCcw } from 'lucide-react';
import { copyToClipboard } from '@/ui/clipboard';
import type { AttachmentOut } from '../adapters/types';
import type { Message, Part } from '../model/message';
import { detectTrailingOptions } from '../model/options-heuristic';
import { Markdown } from './markdown';
import { ReasoningBlock } from './reasoning-block';
import { ToolCallBlock } from './tool-call-block';
import { OptionsButtons } from './options-buttons';
import { AttachmentImage } from './attachment-image';
import { ErrorPart } from './error-part';
import { TokenBar } from './token-bar';

export interface MessageItemProps {
  message: Message;
  attachments: Record<string, AttachmentOut>;
  isLast: boolean;
  isStreaming: boolean;
  turnInFlight: boolean;
  maxTokens?: number;
  onRegenerate?: () => void;
  onForkHere: (seq: number) => void;
  onEdit?: (seq: number, text: string) => void;
  onPick: (callId: string | null, selected: string[]) => void;
  onRetry?: () => void;
  onOpenImage: (a: AttachmentOut) => void;
  /**
   * The persisted "auto-expand reasoning blocks" preference, passed straight
   * through to every `ReasoningBlock` on this message. Optional with the
   * historic default so a caller that has no opinion behaves as before;
   * `<Thread>` (the only caller in the app) always supplies it.
   */
  reasoningOpen?: boolean;
  /** Called when the user opens/closes a reasoning block by hand. */
  onReasoningToggle?: (open: boolean) => void;
}

const noop = () => undefined;

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-[0.25rem] p-1 text-chat-dim hover:text-chat-accent disabled:opacity-40 disabled:hover:text-chat-dim"
    >
      {children}
    </button>
  );
}

export const MessageItem = memo(function MessageItem(p: MessageItemProps) {
  const { message: m, isStreaming } = p;
  const [copied, setCopied] = useState(false);
  const textOnly = useMemo(
    () => m.parts.filter((x): x is Extract<Part, { type: 'text' }> => x.type === 'text').map((x) => x.text).join('\n'),
    [m.parts],
  );
  const hasToolCall = m.parts.some((x) => x.type === 'tool_call');
  const heuristic = useMemo(
    () => (m.role === 'assistant' && !isStreaming && m.finishReason && !hasToolCall ? detectTrailingOptions(textOnly) : null),
    [m.role, isStreaming, m.finishReason, hasToolCall, textOnly],
  );
  const results = useMemo(
    () => Object.fromEntries(m.parts.filter((x): x is Extract<Part, { type: 'tool_result' }> => x.type === 'tool_result').map((x) => [x.callId, x])),
    [m.parts],
  );
  // A client `present_options` call is already rendered as its buttons — the
  // reducer (and the backend's `StreamState.parts`) emit BOTH a `tool_call`
  // part and the derived `options` part for the same callId, so drawing the
  // collapsible tool row too would duplicate the same call in the transcript.
  const optionCallIds = useMemo(
    () => new Set(m.parts.filter((x): x is Extract<Part, { type: 'options' }> => x.type === 'options' && x.callId !== undefined).map((x) => x.callId!)),
    [m.parts],
  );
  const lastReasoningIdx = m.parts.map((x) => x.type).lastIndexOf('reasoning');
  const isUser = m.role === 'user';

  // A turn that got cut off mid-stream (connection drop, server restart, …)
  // lands with `finishReason: 'interrupted'` and often no explicit `error`
  // part — the model simply stopped producing deltas. Surface a generic
  // "Connection lost" line (with Retry, when this is the last message) so
  // the user isn't left staring at a silently truncated response.
  const hasErrorPart = m.parts.some((x) => x.type === 'error');
  const showConnectionLost = !isStreaming && m.finishReason === 'interrupted' && !hasErrorPart;

  return (
    <article className={`group px-4 py-3 ${isUser ? 'bg-chat-surface/50' : ''}`} data-seq={m.seq} data-role={m.role} aria-label={`${m.role} message`}>
      <div className={`mb-1 font-mono text-[11px] uppercase tracking-wider ${isUser ? 'text-chat-muted' : 'text-chat-accent-strong'}`}>
        {isUser ? 'you' : m.role === 'tool' ? 'tool' : (m.model ?? 'assistant')}
      </div>
      {m.parts.map((part, i) => {
        switch (part.type) {
          case 'reasoning':
            return (
              <ReasoningBlock
                key={i}
                part={part}
                isNewest={i === lastReasoningIdx}
                streaming={isStreaming}
                preferOpen={p.reasoningOpen ?? true}
                onUserToggle={p.onReasoningToggle ?? noop}
              />
            );
          case 'tool_call':
            if (part.client && part.name === 'present_options' && optionCallIds.has(part.id)) return null;
            return <ToolCallBlock key={i} call={part} result={results[part.id]} streaming={isStreaming} durationMs={results[part.id]?.durationMs} />;
          case 'tool_result':
            return null; // rendered inside its call block; tool rows (role==='tool') show nothing extra
          case 'text':
            return isUser ? (
              <div key={i} className="whitespace-pre-wrap text-[14px] text-chat-fg">
                {part.text}
              </div>
            ) : (
              <Markdown key={i} text={part.text} streaming={isStreaming && i === m.parts.length - 1} />
            );
          case 'options':
            return <OptionsButtons key={i} part={part} disabled={p.turnInFlight} onPick={(sel) => p.onPick(part.callId ?? null, sel)} />;
          case 'image':
            return (
              <div key={i} className="my-2">
                <AttachmentImage attachment={p.attachments[part.attachmentId]} attachmentId={part.attachmentId} onOpen={p.onOpenImage} />
              </div>
            );
          case 'error':
            return <ErrorPart key={i} part={part} retryable={p.isLast} onRetry={p.onRetry} />;
        }
      })}
      {heuristic && (
        <OptionsButtons
          part={{ type: 'options', question: undefined, options: heuristic.options.map((l) => ({ label: l, value: l })), multi: false }}
          disabled={p.turnInFlight}
          onPick={(sel) => p.onPick(null, sel)}
        />
      )}
      {showConnectionLost && (
        <ErrorPart part={{ type: 'error', code: 'internal', message: 'Connection lost' }} retryable={p.isLast} onRetry={p.onRetry} />
      )}
      {isStreaming && m.role === 'assistant' && p.maxTokens !== undefined && (
        <TokenBar completion={m.usage?.completion ?? Math.ceil(textOnly.length / 4)} max={p.maxTokens} streaming />
      )}
      {!isStreaming && (
        <footer className="mt-1 flex items-center gap-1 text-[11px] text-chat-dim opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {m.role === 'assistant' && m.usage && (
            <span className="mr-2 font-mono" title="prompt / completion / reasoning tokens">
              {m.usage.prompt} / {m.usage.completion} / {m.usage.reasoning ?? 0}
              {m.usage.estimated ? ' (est.)' : ''}
              {m.usage.costMicros !== undefined ? ` · $${(m.usage.costMicros / 1e6).toFixed(4)}` : ''}
            </span>
          )}
          <IconBtn
            label={copied ? 'Copied' : 'Copy'}
            onClick={() => {
              void copyToClipboard(textOnly).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
          </IconBtn>
          {m.role === 'assistant' && p.isLast && p.onRegenerate && (
            <IconBtn label="Regenerate" onClick={p.onRegenerate} disabled={p.turnInFlight}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            </IconBtn>
          )}
          {isUser && p.onEdit && (
            <IconBtn label="Edit (forks the chat)" onClick={() => p.onEdit!(m.seq, textOnly)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </IconBtn>
          )}
          <IconBtn label="Fork here" onClick={() => p.onForkHere(m.seq)}>
            <GitFork className="h-3.5 w-3.5" aria-hidden />
          </IconBtn>
        </footer>
      )}
    </article>
  );
});
