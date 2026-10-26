import { AlertTriangle } from 'lucide-react';
import { Button } from '@/ui/button';
import type { Part } from '../model/message';
import { useChatLabels } from '../app/labels-context';

export function ErrorPart({
  part,
  retryable,
  onRetry,
}: {
  part: Extract<Part, { type: 'error' }>;
  retryable: boolean;
  onRetry?: () => void;
}) {
  const { labels } = useChatLabels();
  const heading = (labels.errors as Record<string, string | undefined>)[part.code] ?? part.code;
  return (
    <div role="alert" className="my-2 flex items-start gap-2 rounded-[0.25rem] border border-chat-negative/30 bg-chat-negative-dim/30 px-3 py-2 text-xs text-chat-negative">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="flex-1">
        <div className="font-medium">{heading}</div>
        <div className="text-chat-negative/80">{part.message}</div>
      </div>
      {retryable && onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {labels.common.retry}
        </Button>
      )}
    </div>
  );
}
