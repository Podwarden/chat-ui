import { jsonOrThrow, readError } from './errors';
import type {
  Adapters, AttachmentOut, Budget, ChatDetail, ChatSettings, ChatSummary, ModelInfo, Storage, Transport, TurnRequest,
} from './types';
import type { ChatEvent, ErrorCode } from '../contract/events';
import { parseSseStream } from '../model/wire';

const J = { 'Content-Type': 'application/json' };

const RETRYABLE = new Set<ErrorCode>(['rate_limited', 'turn_in_flight', 'timeout', 'upstream', 'guard']);

/**
 * The HTTP implementation of `Adapters` — the `/api/chat2/*` contract, spoken
 * over an injected `fetch`.
 *
 * Nothing here is a module singleton: the whole surface closes over `baseUrl`
 * and `fetch`, so a host mounts as many independently-configured chat trees as
 * it likes (a different instance per tab, a fixture in a test) and this file
 * has no opinion at all about authentication — whatever headers the host's
 * `fetch` adds are the headers that go out.
 */
export function createHttpAdapters(opts: { baseUrl: string; fetch: Adapters['fetch'] }): Adapters {
  // Trailing slashes are normalised (all of them, not just one) so
  // `'/api/chat2/'` and `'/api/chat2'` behave identically — `id` and every
  // request path below are built from this value, never `opts.baseUrl`.
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const { fetch } = opts;

  const storage: Storage = {
    listChats: () => fetch(`${baseUrl}/chats`).then(jsonOrThrow<{ chats: ChatSummary[] }>).then((r) => r.chats),
    getChat: (id: string) => fetch(`${baseUrl}/chats/${id}`).then(jsonOrThrow<ChatDetail>),
    createChat: (body: { model?: string | null; settings?: Partial<ChatSettings> }) =>
      fetch(`${baseUrl}/chats`, { method: 'POST', headers: J, body: JSON.stringify(body) }).then(jsonOrThrow<ChatSummary>),
    patchChat: (id: string, body: { title?: string; model?: string; settings?: Partial<ChatSettings> }) =>
      fetch(`${baseUrl}/chats/${id}`, { method: 'PATCH', headers: J, body: JSON.stringify(body) }).then(jsonOrThrow<ChatSummary>),
    deleteChat: (id: string) => fetch(`${baseUrl}/chats/${id}`, { method: 'DELETE' }).then(jsonOrThrow<void>),
    deleteAllChats: () => fetch(`${baseUrl}/chats`, { method: 'DELETE' }).then(jsonOrThrow<{ deleted: number }>),
    fork: (id: string, body: { at_seq: number; edited_text?: string }) =>
      fetch(`${baseUrl}/chats/${id}/fork`, { method: 'POST', headers: J, body: JSON.stringify(body) }).then(jsonOrThrow<ChatSummary>),
    getDefaults: () => fetch(`${baseUrl}/defaults`).then(jsonOrThrow<{ model: string | null; settings: ChatSettings }>),
    putDefaults: (body: { model?: string | null; settings: Partial<ChatSettings> }) =>
      fetch(`${baseUrl}/defaults`, { method: 'PUT', headers: J, body: JSON.stringify(body) }).then(jsonOrThrow<{ model: string | null; settings: ChatSettings }>),
    /**
     * Upload a draft image attachment for `chatId`. `chat_id` is a required
     * multipart field on the backend (app/chat2/routes_attachments.py's
     * `upload` route declares `chat_id: str = Form(...)`, and the generated
     * `Body_upload_api_chat2_attachments_post` schema requires it alongside
     * `file`) — omitting it 422s.
     */
    uploadAttachment: (file: File, chatId: string, signal?: AbortSignal) => {
      const fd = new FormData(); fd.append('file', file, file.name); fd.append('chat_id', chatId);
      return fetch(`${baseUrl}/attachments`, { method: 'POST', body: fd, signal }).then(jsonOrThrow<AttachmentOut>);
    },
    deleteDraft: (id: string) => fetch(`${baseUrl}/attachments/${id}`, { method: 'DELETE' }).then(jsonOrThrow<void>),
    /**
     * Signed URLs expire (SIGNED_URL_TTL_S); re-fetch the chat to refresh
     * them. Returns `null` once the attachment has been evicted
     * (app/chat2/routes_attachments.py:_serialize sets `url: null` when
     * `evicted` is true).
     */
    attachmentUrl: (a: AttachmentOut): string | null => a.url,
  };

  /**
   * The one SSE reader loop, shared by `sendTurn` (POST /turns) and
   * `attachLiveTurn` (GET /turn/live) so a re-attached stream runs through the
   * exact same fetch/error/parse path as a locally-started one.
   */
  async function streamEvents(
    url: string, init: RequestInit, onEvent: (e: ChatEvent) => void, signal: AbortSignal,
    on404?: () => void,
  ): Promise<void> {
    let r: Response;
    try {
      r = await fetch(url, { ...init, signal });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      onEvent({ type: 'error', code: 'internal', message: err instanceof Error ? err.message : 'network error', retryable: true });
      return;
    }
    if (!r.ok) {
      if (r.status === 404 && on404) { on404(); return; }
      const e = await readError(r);
      const code = (e.code as ErrorCode) || 'internal';
      onEvent({ type: 'error', code, message: e.message, retryable: RETRYABLE.has(code) });
      return;
    }
    if (!r.body) { onEvent({ type: 'error', code: 'internal', message: 'no response body', retryable: true }); return; }
    for await (const ev of parseSseStream(r.body, signal)) onEvent(ev);
  }

  const transport: Transport = {
    sendTurn: async (req: TurnRequest, onEvent: (e: ChatEvent) => void, signal: AbortSignal) => {
      const body = {
        request_id: req.requestId, user_parts: req.userParts, attachment_ids: req.attachmentIds ?? [],
        tool_results: req.toolResults, regenerate: req.regenerate === true,
      };
      await streamEvents(`${baseUrl}/chats/${req.chatId}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
      }, onEvent, signal);
    },

    /**
     * Re-attach to a detached turn: replays the frames the original subscriber
     * saw (byte-identical, so the reducer runs the same path) and then follows
     * the live tail. A 404 means the turn finished and was reaped between the
     * detail response and this request — synthesize the terminal `done` so the
     * caller's post-stream path runs instead of reporting a dropped connection.
     */
    attachLiveTurn: async (chatId: string, messageId: string, onEvent: (e: ChatEvent) => void, signal: AbortSignal) => {
      await streamEvents(`${baseUrl}/chats/${chatId}/turn/live`, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      }, onEvent, signal, () => onEvent({ type: 'done', messageId, finishReason: 'stop' }));
    },

    /**
     * Explicitly stop the chat's detached turn server-side. The backend cancels
     * the runner and only answers once the partial tail is persisted as aborted
     * and the per-chat turn lock is released — so a send issued after this
     * resolves cannot race a 409 `turn_in_flight`. Best-effort: a 404 just means
     * the turn already ended.
     */
    abortTurn: async (chatId: string) => {
      try {
        await fetch(`${baseUrl}/chats/${chatId}/turn/abort`, { method: 'POST' });
      } catch {
        /* best-effort — the local reader abort already detaches the UI */
      }
    },
  };

  const models = {
    listModels: () => fetch(`${baseUrl}/models`).then(jsonOrThrow<{ models: ModelInfo[] }>).then((r) => r.models),
  };

  const billing = {
    getBudget: () => fetch(`${baseUrl}/budget`).then(jsonOrThrow<{ budget: Budget | null }>).then((r) => r.budget),
  };

  return { id: baseUrl, fetch, storage, transport, models, billing };
}
