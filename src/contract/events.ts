// spec §2.2, verbatim
export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'aborted' | 'interrupted' | 'guard' | 'timeout' | 'error';
export type ErrorCode = 'rate_limited' | 'budget_blocked' | 'context_full' | 'model_not_loaded' | 'turn_in_flight'
  | 'upstream' | 'timeout' | 'guard' | 'attachment_missing' | 'tools_unsupported' | 'too_many_images' | 'internal'
  | 'forbidden' | 'instance_offline';

/**
 * A transient, keyed banner the server can raise mid-turn (posture changes,
 * budget warnings, degraded upstreams). Keyed so a repeat replaces rather
 * than stacks; keys under the `turn:` prefix are scoped to the turn and are
 * dropped by the reducer when the turn ends.
 */
export interface NoticeEvent { type: 'notice'; level: 'info' | 'warn'; key: string; text: string }

export type ChatEvent =
  | { type: 'message-persisted'; role: 'user' | 'tool'; messageId: string; seq: number; attachmentIds: string[] }
  | { type: 'message-start'; messageId: string; seq: number; model: string }
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call-delta'; id: string; name?: string; argsText: string }
  | { type: 'tool-call'; id: string; name: string; args: unknown; client: boolean }
  | { type: 'tool-result'; id: string; result: unknown; ok: boolean; durationMs?: number }
  | { type: 'image'; attachmentId: string }
  | { type: 'usage'; prompt: number; completion: number; reasoning?: number; cacheRead?: number; cacheWrite?: number; estimated: boolean; costMicros?: number }
  | { type: 'context'; promptTokens: number; window: number | null; full: boolean }
  | { type: 'done'; messageId: string; finishReason: FinishReason }
  | { type: 'error'; code: ErrorCode; message: string; retryable: boolean }
  | NoticeEvent;

const TYPES = new Set<ChatEvent['type']>(['message-persisted', 'message-start', 'text-delta', 'reasoning-delta',
  'tool-call-delta', 'tool-call', 'tool-result', 'image', 'usage', 'context', 'done', 'error', 'notice']);

export function isChatEvent(x: unknown): x is ChatEvent {
  return typeof x === 'object' && x !== null && typeof (x as { type?: unknown }).type === 'string'
    && TYPES.has((x as { type: ChatEvent['type'] }).type);
}
