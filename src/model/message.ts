import type { ChatEvent, ErrorCode, FinishReason } from './events';
import { validateArgs } from './client-tools';

export type OptionItem = { label: string; value: string };
export type Part =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; durationMs?: number }
  | { type: 'tool_call'; id: string; name: string; args: unknown; argsText: string; client: boolean }
  | { type: 'tool_result'; callId: string; result: unknown; ok: boolean; durationMs?: number }
  | { type: 'image'; attachmentId: string; width?: number; height?: number }
  | { type: 'options'; callId?: string; question?: string; options: OptionItem[]; multi: boolean; answered?: string[] }
  | { type: 'error'; code: ErrorCode; message: string };

export interface Usage { prompt: number; completion: number; reasoning?: number; cacheRead?: number; cacheWrite?: number; estimated: boolean; costMicros?: number }
export interface Message {
  id: string; seq: number; role: 'user' | 'assistant' | 'tool'; parts: Part[];
  model?: string | null; usage?: Usage | null; finishReason?: FinishReason | null;
  error?: { code: ErrorCode; message: string } | null; createdAt: string; streaming?: boolean;
}
export interface ContextInfo { promptTokens: number; window: number | null; full: boolean }
export interface Ack { messageId: string; seq: number; role: 'user' | 'tool'; attachmentIds: string[] }
export interface ThreadState {
  messages: Message[]; context: ContextInfo | null; pendingTail: Message | null;
  pendingAck: Ack | null;
  toolCalls: Record<string, { name?: string; argsText: string; startedAt: number }>;
  reasoningStartedAt: number | null; announcement: string | null;
  /**
   * Transient server-raised banners, keyed so a repeat replaces rather than
   * stacks. Keys under the `turn:` prefix are turn-scoped and are dropped
   * when the turn ends (`done`); anything else persists until replaced.
   */
  notices: Record<string, { level: 'info' | 'warn'; text: string }>;
}

export function emptyThread(initial: Message[], context: ContextInfo | null): ThreadState {
  return { messages: initial, context, pendingTail: null, pendingAck: null, toolCalls: {}, reasoningStartedAt: null, announcement: null, notices: {} };
}

// The GET /chats/{id} message row. The backend route returns `dict[str, Any]`
// so the OpenAPI generator emits no named schema for it; define the shape
// locally and cast `parts` through `Part[]`. If a named schema ever appears
// in api-types.generated.ts (components['schemas']['MessageOut']), switch to
// importing it instead of hand-maintaining this interface.
export interface ServerMessage {
  id: string; seq: number; role: string; parts: unknown[]; model: string | null;
  settings_snapshot: Record<string, unknown>; usage: Record<string, unknown> | null;
  finish_reason: string | null; error: { code: string; message: string } | null; created_at: string;
}
export function fromServerMessage(m: ServerMessage): Message {
  return { id: m.id, seq: m.seq, role: m.role as Message['role'], parts: m.parts as Part[], model: m.model,
    usage: m.usage as Usage | null, finishReason: m.finish_reason as FinishReason | null,
    error: m.error as Message['error'], createdAt: m.created_at };
}

function last(parts: Part[]): Part | undefined { return parts[parts.length - 1]; }

function closeReasoning(state: ThreadState, tail: Message, now: number): Message {
  if (state.reasoningStartedAt === null) return tail;
  const parts = tail.parts.slice();
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === 'reasoning' && p.durationMs === undefined) { parts[i] = { ...p, durationMs: now - state.reasoningStartedAt }; break; }
  }
  return { ...tail, parts };
}

function appendText(parts: Part[], text: string): Part[] {
  const l = last(parts);
  if (l?.type === 'text') return [...parts.slice(0, -1), { ...l, text: l.text + text }];
  return [...parts, { type: 'text', text }];
}

function optionsPartFromCall(id: string, args: unknown): Part | null {
  const ok = validateArgs('present_options', args);
  if (!ok) return null;
  const a = args as { question?: string; options: OptionItem[]; multi?: boolean };
  return { type: 'options', callId: id, question: a.question, options: a.options, multi: a.multi === true };
}


function dropTurnNotices(notices: ThreadState['notices']): ThreadState['notices'] {
  return Object.fromEntries(Object.entries(notices).filter(([k]) => !k.startsWith('turn:')));
}

export function reduceEvent(state: ThreadState, ev: ChatEvent, now: () => number): ThreadState {
  const t = now();
  switch (ev.type) {
    case 'message-persisted':
      return { ...state, pendingAck: { messageId: ev.messageId, seq: ev.seq, role: ev.role, attachmentIds: ev.attachmentIds } };
    case 'message-start':
      return { ...state, announcement: null, toolCalls: {}, reasoningStartedAt: null,
        pendingTail: { id: ev.messageId, seq: ev.seq, role: 'assistant', parts: [], model: ev.model, createdAt: new Date(t).toISOString(), streaming: true } };
    case 'reasoning-delta': {
      const tail = state.pendingTail; if (!tail) return state;
      const l = last(tail.parts);
      if (l?.type === 'reasoning' && l.durationMs === undefined) {
        return { ...state, pendingTail: { ...tail, parts: [...tail.parts.slice(0, -1), { ...l, text: l.text + ev.text }] } };
      }
      return { ...state, reasoningStartedAt: t, pendingTail: { ...tail, parts: [...tail.parts, { type: 'reasoning', text: ev.text }] } };
    }
    case 'text-delta': {
      const tail = state.pendingTail; if (!tail) return state;
      const closed = closeReasoning(state, tail, t);
      return { ...state, reasoningStartedAt: null, pendingTail: { ...closed, parts: appendText(closed.parts, ev.text) } };
    }
    case 'tool-call-delta': {
      const prev = state.toolCalls[ev.id] ?? { argsText: '', startedAt: t };
      return { ...state, toolCalls: { ...state.toolCalls, [ev.id]: { name: ev.name ?? prev.name, argsText: prev.argsText + ev.argsText, startedAt: prev.startedAt } } };
    }
    case 'tool-call': {
      const tail = state.pendingTail; if (!tail) return state;
      const closed = closeReasoning(state, tail, t);
      const pending = state.toolCalls[ev.id];
      const argsText = pending?.argsText || JSON.stringify(ev.args);
      // The slot is kept (not dropped) until the matching `tool-result` so the
      // reducer can still measure the call's duration when the event itself
      // carries no `durationMs`; `message-start`/`done` clear the whole map.
      const rest = { ...state.toolCalls, [ev.id]: { name: ev.name, argsText, startedAt: pending?.startedAt ?? t } };
      const parts: Part[] = [...closed.parts, { type: 'tool_call', id: ev.id, name: ev.name, args: ev.args, argsText, client: ev.client }];
      if (ev.client && ev.name === 'present_options') {
        const opt = optionsPartFromCall(ev.id, ev.args);
        parts.push(opt ?? { type: 'text', text: '```json\n' + argsText + '\n```' });
      }
      return { ...state, reasoningStartedAt: null, toolCalls: rest, pendingTail: { ...closed, parts } };
    }
    case 'tool-result': {
      const tail = state.pendingTail; if (!tail) return state;
      const started = state.toolCalls[ev.id]?.startedAt;
      const durationMs = ev.durationMs ?? (started !== undefined ? t - started : undefined);
      const { [ev.id]: _done, ...remaining } = state.toolCalls; void _done;
      const part: Part = { type: 'tool_result', callId: ev.id, result: ev.result, ok: ev.ok,
        ...(durationMs === undefined ? {} : { durationMs }) };
      return { ...state, toolCalls: remaining, pendingTail: { ...tail, parts: [...tail.parts, part] } };
    }
    case 'image': {
      const tail = state.pendingTail; if (!tail) return state;
      return { ...state, pendingTail: { ...tail, parts: [...tail.parts, { type: 'image', attachmentId: ev.attachmentId }] } };
    }
    case 'usage': {
      const tail = state.pendingTail; if (!tail) return state;
      const { type: _t, ...usage } = ev; void _t;
      return { ...state, pendingTail: { ...tail, usage } };
    }
    case 'context':
      return { ...state, context: { promptTokens: ev.promptTokens, window: ev.window, full: ev.full } };
    case 'notice':
      return { ...state, notices: { ...state.notices, [ev.key]: { level: ev.level, text: ev.text } } };
    case 'error': {
      const part: Part = { type: 'error', code: ev.code, message: ev.message };
      if (state.pendingTail) {
        const tail = closeReasoning(state, state.pendingTail, t);
        return { ...state, reasoningStartedAt: null, pendingTail: { ...tail, parts: [...tail.parts, part], error: { code: ev.code, message: ev.message } }, announcement: `Error: ${ev.message}` };
      }
      const row: Message = { id: `err-${t}`, seq: -1, role: 'assistant', parts: [part], finishReason: 'error', error: { code: ev.code, message: ev.message }, createdAt: new Date(t).toISOString() };
      return { ...state, messages: [...state.messages, row], announcement: `Error: ${ev.message}` };
    }
    case 'done': {
      const tail = state.pendingTail;
      // Turn-scoped notices die with the turn, on BOTH exits from this branch.
      const notices = dropTurnNotices(state.notices);
      if (!tail) return { ...state, notices, announcement: state.announcement ?? 'Response complete' };
      const closed = closeReasoning(state, tail, t);
      const committed: Message = { ...closed, id: ev.messageId || closed.id, finishReason: ev.finishReason, streaming: false };
      // Id-idempotent commit: a REPLAYED stream (GET .../turn/live after a
      // reload) can commit a row whose id the loaded history already carries
      // when the turn finished in the gap between the two requests. Replace,
      // never duplicate.
      return { ...state, pendingTail: null, reasoningStartedAt: null, toolCalls: {}, notices,
        messages: [...state.messages.filter((m) => m.id !== committed.id), committed],
        announcement: state.announcement ?? 'Response complete' };
    }
  }
}
