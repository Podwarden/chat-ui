// The whole "backend" for the no-backend example.
//
// `Transport.sendTurn(req, onEvent, signal)` delivers events by CALLBACK, not
// over the wire (see src/adapters/types.ts) — so an in-memory implementation
// of `Adapters` reproduces the full streaming experience with no HTTP
// fixture, no port and no SSE parsing at all. This is that implementation.
//
// Types are imported by RELATIVE path (not `@podwarden/chat-ui`): the root
// vitest suite (tests/demo-adapters.test.ts) imports this module directly,
// and resolving the package name there would depend on this example's own
// `node_modules` being installed, which the root test run never does.
import type {
  Adapters, AttachmentOut, Budget, ChatSummary, ModelInfo, Storage, Transport, TurnRequest,
} from '../../../src/adapters/types';
import { ApiError } from '../../../src/adapters/types';
import type { FinishReason } from '../../../src/contract/events';
import type { ServerMessage } from '../../../src/model/message';
import { DEFAULT_SETTINGS, DEMO_MODEL, REPLY_DELTAS, SEED_CHATS, type SeedChat } from './fixtures';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextSeq(messages: ServerMessage[]): number {
  return messages.reduce((max, m) => Math.max(max, m.seq), 0) + 1;
}

/** The one bit of `TurnRequest` this demo reads: the plain-text part of a
 *  user's send, if any (a regenerate or an options answer carries none). */
function firstUserText(req: TurnRequest): string {
  return req.userParts?.find((p) => p.type === 'text')?.text ?? '';
}

/**
 * Build an in-memory implementation of `Adapters`.
 *
 * `delayMs` controls the pause between streamed tokens (default 18ms, a
 * believable typing cadence); tests pass `0` so a run finishes instantly, and
 * a non-zero value that stays smaller than a test's own polling interval
 * still lets `signal.aborted` be observed mid-stream.
 */
export function createDemoAdapters(opts: { delayMs?: number } = {}): Adapters {
  const delay = opts.delayMs ?? 18;
  // Deep-cloned so two `createDemoAdapters()` calls (e.g. two tests) never
  // share mutable state, and so nothing here ever touches the fixture
  // module's own exported arrays.
  const chats: SeedChat[] = structuredClone(SEED_CHATS);

  function findChat(id: string): SeedChat | undefined {
    return chats.find((c) => c.chat.id === id);
  }

  function requireChat(id: string): SeedChat {
    const c = findChat(id);
    if (!c) throw new ApiError(404, 'internal', `No such demo chat: ${id}`);
    return c;
  }

  /** Records a finished (or aborted) turn into its chat's history so
   *  switching away and back — which reloads via `storage.getChat` — still
   *  shows what was just streamed. Silently a no-op for the conformance-style
   *  test calls above, whose fake `TurnRequest` carries no real `chatId`. */
  function persistTurn(chatId: string | undefined, userText: string, replyText: string, finishReason: FinishReason): void {
    if (!chatId) return;
    const rec = findChat(chatId);
    if (!rec) return;
    const at = nowIso();
    if (userText) {
      rec.messages.push({
        id: newId('m'), seq: nextSeq(rec.messages), role: 'user',
        parts: [{ type: 'text', text: userText }], model: null, settings_snapshot: {},
        usage: null, finish_reason: null, error: null, created_at: at,
      });
    }
    if (replyText) {
      rec.messages.push({
        id: newId('m'), seq: nextSeq(rec.messages), role: 'assistant',
        parts: [{ type: 'text', text: replyText }], model: DEMO_MODEL.id, settings_snapshot: {},
        usage: { prompt: 128, completion: 96, estimated: true }, finish_reason: finishReason, error: null, created_at: at,
      });
    }
    rec.chat.updated_at = at;
    rec.chat.last_message_at = at;
    rec.context = { type: 'context', promptTokens: 224, window: DEMO_MODEL.context_window, full: false };
  }

  const storage: Storage = {
    listChats: async () => [...chats].sort((a, b) => (b.chat.last_message_at ?? '').localeCompare(a.chat.last_message_at ?? '')).map((c) => c.chat),

    getChat: async (id) => {
      const c = requireChat(id);
      return { chat: c.chat, messages: c.messages, attachments: c.attachments, context: c.context };
    },

    createChat: async (body) => {
      const at = nowIso();
      const chat: ChatSummary = {
        id: newId('chat'), title: 'New chat', title_prev: null, title_source: 'auto',
        model: body.model ?? DEMO_MODEL.id, settings: { ...DEFAULT_SETTINGS, ...body.settings },
        forked_from_chat_id: null, forked_at_seq: null, cost_micros_total: 0,
        created_at: at, updated_at: at, last_message_at: null, context_full: false,
      };
      chats.unshift({ chat, messages: [], attachments: [], context: { type: 'context', promptTokens: 0, window: DEMO_MODEL.context_window, full: false } });
      return chat;
    },

    patchChat: async (id, body) => {
      const rec = requireChat(id);
      if (body.title !== undefined && body.title !== rec.chat.title) {
        rec.chat = { ...rec.chat, title_prev: rec.chat.title, title: body.title, title_source: 'user' };
      }
      if (body.model !== undefined) rec.chat = { ...rec.chat, model: body.model };
      if (body.settings) rec.chat = { ...rec.chat, settings: { ...rec.chat.settings, ...body.settings } };
      rec.chat = { ...rec.chat, updated_at: nowIso() };
      return rec.chat;
    },

    deleteChat: async (id) => {
      const i = chats.findIndex((c) => c.chat.id === id);
      if (i !== -1) chats.splice(i, 1);
    },

    deleteAllChats: async () => {
      const deleted = chats.length;
      chats.length = 0;
      return { deleted };
    },

    fork: async (id, body) => {
      const src = requireChat(id);
      const at = nowIso();
      const cut = src.messages.filter((m) => m.seq <= body.at_seq).map((m) => structuredClone(m));
      if (body.edited_text !== undefined) {
        const last = cut.at(-1);
        if (last) last.parts = [{ type: 'text', text: body.edited_text }];
      }
      const chat: ChatSummary = {
        ...structuredClone(src.chat), id: newId('chat'), title: `${src.chat.title} (fork)`,
        forked_from_chat_id: src.chat.id, forked_at_seq: body.at_seq, created_at: at, updated_at: at,
        last_message_at: cut.length ? at : null,
      };
      chats.unshift({ chat, messages: cut, attachments: [], context: structuredClone(src.context) });
      return chat;
    },

    getDefaults: async () => ({ model: DEMO_MODEL.id, settings: DEFAULT_SETTINGS }),

    putDefaults: async (body) => ({
      model: body.model ?? DEMO_MODEL.id,
      settings: { ...DEFAULT_SETTINGS, ...body.settings },
    }),

    // No storage backend to receive bytes into — attaching an image is
    // gated on `model.supports_vision` anyway, and `DEMO_MODEL` says false,
    // so the composer's attach button never enables this path.
    uploadAttachment: async () => {
      throw new ApiError(501, 'internal', 'This demo has no backend, so attachments are not supported.');
    },
    deleteDraft: async () => {},
    attachmentUrl: (a: AttachmentOut) => a.url,
  };

  const transport: Transport = {
    async sendTurn(req, onEvent, signal) {
      const userId = newId('m');
      const assistantId = `${userId}-a`;
      onEvent({ type: 'message-persisted', role: 'user', messageId: userId, seq: 1, attachmentIds: [] });
      onEvent({ type: 'message-start', messageId: assistantId, seq: 2, model: DEMO_MODEL.id });
      onEvent({ type: 'context', promptTokens: 128, window: DEMO_MODEL.context_window, full: false });

      let replyText = '';
      // The abort check sits BEFORE each delta, and an abort ends the turn
      // with `done{aborted}` and NO trailing `context` event — that is the
      // documented contract, and it is what the conformance suite pins.
      for (const chunk of REPLY_DELTAS) {
        if (signal.aborted) {
          onEvent({ type: 'done', messageId: assistantId, finishReason: 'aborted' });
          persistTurn(req.chatId, firstUserText(req), replyText, 'aborted');
          return;
        }
        onEvent({ type: 'text-delta', text: chunk });
        replyText += chunk;
        if (delay) await sleep(delay);
      }
      onEvent({ type: 'usage', prompt: 128, completion: 96, estimated: true });
      onEvent({ type: 'context', promptTokens: 224, window: DEMO_MODEL.context_window, full: false });
      onEvent({ type: 'done', messageId: assistantId, finishReason: 'stop' });
      persistTurn(req.chatId, firstUserText(req), replyText, 'stop');
    },

    // Nothing is ever mid-flight across a reload here: every event this demo
    // ever emits is delivered synchronously (modulo `delay`) to the caller
    // that started the turn, so there is never a detached turn to reattach to.
    async attachLiveTurn() {},

    // The `AbortSignal` handed to `sendTurn` above is the entire abort
    // mechanism; there is no server-side runner to reach out and stop.
    async abortTurn() {},
  };

  const models = { listModels: async (): Promise<ModelInfo[]> => [DEMO_MODEL] };
  const billing = { getBudget: async (): Promise<Budget | null> => null };

  return {
    id: 'demo',
    // No network in this demo; a host that (incorrectly) relied on this for
    // something real would get a clear failure rather than a silent no-op.
    fetch: async () => { throw new Error('chat-ui demo: fetch() is not available — this example has no backend.'); },
    storage,
    transport,
    models,
    billing,
  };
}
