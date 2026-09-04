import { AlertTriangle } from 'lucide-react';
import { Button } from '@/ui/button';
import type { Part } from '../model/message';

const HUMAN: Record<string, string> = {
  guard: 'Stopped by the runaway guard',
  timeout: 'The model took too long',
  rate_limited: 'Rate limited — try again shortly',
  context_full: 'Context window is full — fork to continue',
  budget_blocked: 'Budget exhausted',
  model_not_loaded: 'Model is not loaded',
  turn_in_flight: 'Another turn is already running for this chat',
  attachment_missing: 'An attached image is gone',
  tools_unsupported: 'This model cannot use tools',
  too_many_images: 'Too many images (max 8)',
  upstream: 'The model returned an error',
  internal: 'Something went wrong',
};

export function ErrorPart({
  part,
  retryable,
  onRetry,
}: {
  part: Extract<Part, { type: 'error' }>;
  retryable: boolean;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="my-2 flex items-start gap-2 rounded-[0.25rem] border border-chat-negative/30 bg-chat-negative-dim/30 px-3 py-2 text-xs text-chat-negative">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="flex-1">
        <div className="font-medium">{HUMAN[part.code] ?? part.code}</div>
        <div className="text-chat-negative/80">{part.message}</div>
      </div>
      {retryable && onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
