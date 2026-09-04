export * from '../contract/types';

import type {
  AttachmentOut, Budget, ChatDetail, ChatSettings, ChatSummary, ModelInfo, TurnRequest,
} from '../contract/types';
import type { ChatEvent } from '../contract/events';

/**
 * Everything the chat UI is allowed to know about the outside world.
 *
 * The package ships one implementation (`createHttpAdapters`, which talks to
 * the `/api/chat2/*` contract over HTTP), but the components and hooks only
 * ever see this interface through `useAdapters()` — so a host can substitute
 * its own transport, its own auth or a fixture without touching anything
 * below. Header injection (bearer tokens, CSRF) is the host's job: it owns
 * the `fetch` it hands in.
 */
export interface Adapters {
  /**
   * Stable key prefix for every SWR cache entry this package creates (the
   * `baseUrl`, for the HTTP implementation). Two `<AdaptersProvider>`s
   * pointed at different backends must not share cached chats, so the id is
   * part of every key rather than the URL itself being the key.
   */
  id: string;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  storage: Storage;
  transport: Transport;
  models: { listModels(): Promise<ModelInfo[]> };
  billing: { getBudget(): Promise<Budget | null> };
}

export interface Storage {
  listChats(): Promise<ChatSummary[]>;
  getChat(id: string): Promise<ChatDetail>;
  createChat(body: { model?: string | null; settings?: Partial<ChatSettings> }): Promise<ChatSummary>;
  patchChat(id: string, body: { title?: string; model?: string; settings?: Partial<ChatSettings> }): Promise<ChatSummary>;
  deleteChat(id: string): Promise<void>;
  deleteAllChats(): Promise<{ deleted: number }>;
  fork(id: string, body: { at_seq: number; edited_text?: string }): Promise<ChatSummary>;
  getDefaults(): Promise<{ model: string | null; settings: ChatSettings }>;
  putDefaults(body: { model?: string | null; settings: Partial<ChatSettings> }): Promise<{ model: string | null; settings: ChatSettings }>;
  uploadAttachment(file: File, chatId: string, signal?: AbortSignal): Promise<AttachmentOut>;
  deleteDraft(id: string): Promise<void>;
  attachmentUrl(a: AttachmentOut): string | null;
}

export interface Transport {
  sendTurn(req: TurnRequest, onEvent: (e: ChatEvent) => void, signal: AbortSignal): Promise<void>;
  attachLiveTurn(chatId: string, messageId: string, onEvent: (e: ChatEvent) => void, signal: AbortSignal): Promise<void>;
  abortTurn(chatId: string): Promise<void>;
}
