// Composer-adjacent states (spec §5): context full, budget blocked, turn in
// flight, dropped connection, model not loaded.
import type { ReactNode } from 'react';
import { Button } from '@/ui/button';
import type { Budget, ChatSummary, ModelInfo } from '../adapters/types';
import type { ContextMeter } from '../model/context-meter';
import type { LastError } from '../hooks/use-chat-thread';

export interface BannersProps {
  lastError: LastError | null; meter: ContextMeter; budget: Budget | null; chat: ChatSummary | null;
  modelLoaded: boolean; onFork: () => void; onRetry: () => void;
  /**
   * A failed page-level action (create / rename / delete / fork / save
   * defaults). Unlike the states above it is not derived from anything the
   * page keeps re-deriving, so it stays until the user dismisses it.
   */
  actionError?: string | null;
  onDismissActionError?: () => void;
  /**
   * Replacement text for the "model is not loaded" banner. The two defaults
   * below both point the user at the settings panel, which a host running
   * `capabilities.settings === 'hidden'` has removed — telling someone to
   * "pick a model in Settings" they cannot open is worse than saying nothing.
   * <ChatApp> feeds this from `labels.noModelAvailable` exactly then, and
   * leaves it undefined otherwise, so the editable-settings wording is
   * untouched.
   */
  noModelText?: string;
  /**
   * The recovery for a chat pinned to a model that is not loaded (#240): the
   * loaded catalog, and what to do with it. With exactly one loaded model the
   * banner offers to switch to it; with several it opens Settings, where the
   * picker lists them. <ChatApp> passes these only while the settings panel
   * exists — a host running `settings: 'hidden'` keeps its own wording and
   * no action, as before.
   */
  models?: readonly ModelInfo[];
  onSwitchModel?: (modelId: string) => void;
  onOpenSettings?: () => void;
}

const NO_MODELS: readonly ModelInfo[] = [];

export function Banners({ lastError, meter, budget, chat, modelLoaded, onFork, onRetry, actionError, onDismissActionError, noModelText, models = NO_MODELS, onSwitchModel, onOpenSettings }: BannersProps) {
  const items: { key: string; text: string; action?: ReactNode }[] = [];
  if (meter.state === 'full') {
    items.push({ key: 'ctx', text: 'Context window is full. The chat stays readable; fork it to continue.', action: <Button size="sm" variant="outline" onClick={onFork}>Fork</Button> });
  }
  // `budget.window` is nullable (no usage reported yet / Hub-only enrichment)
  // — only `blocked_until` drives this banner, so no read of `window` here.
  if (budget?.blocked_until) {
    items.push({ key: 'budget', text: `Budget exhausted — resets ${new Date(budget.blocked_until).toLocaleString()}.` });
  }
  if (lastError?.code === 'turn_in_flight') {
    items.push({ key: 'inflight', text: 'Another turn is running for this chat (maybe in another tab).', action: <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button> });
  }
  // The stream dropped without a terminal frame (`use-chat-thread.ts` reports
  // this as `code: 'upstream', message: 'connection lost'`) — offer Retry.
  if (lastError?.code === 'upstream') {
    items.push({ key: 'upstream', text: 'Connection lost — retry?', action: <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button> });
  }
  if (chat && !modelLoaded) {
    let action: ReactNode;
    if (chat.model && !noModelText) {
      if (models.length === 1 && onSwitchModel) {
        const only = models[0];
        action = <Button size="sm" variant="outline" onClick={() => onSwitchModel(only.id)}>Use {only.display}</Button>;
      } else if (models.length > 1 && onOpenSettings) {
        action = <Button size="sm" variant="outline" onClick={onOpenSettings}>Choose a model</Button>;
      }
    }
    items.push({ key: 'model', text: noModelText ?? (chat.model ? `Model "${chat.model}" is not loaded.` : 'Pick a model in Settings.'), action });
  }
  if (actionError) {
    items.unshift({
      key: 'action',
      text: actionError,
      action: <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={onDismissActionError}>Dismiss</Button>,
    });
  }
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {items.map((i) => (
        <div key={i.key} role="status" className="flex items-center justify-between gap-2 rounded-[0.25rem] border border-chat-warn/30 bg-chat-warn/10 px-3 py-1.5 text-xs text-chat-warn">
          <span>{i.text}</span>{i.action}
        </div>
      ))}
    </div>
  );
}
