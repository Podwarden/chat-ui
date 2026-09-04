// Backend contract types for `/api/chat2/*`.
//
// `make generate-api-types` produces NO named schemas for these response
// bodies: every chat2 route returns a bare FastAPI `dict[str, Any]`
// (see app/chat2/routes_chats.py, routes_attachments.py, routes_turn.py),
// so api-types.generated.ts has no `components['schemas']['ChatSummary']`
// etc. to alias. All shapes below are hand-defined to match the backend's
// serializer functions field-for-field:
//   - ChatSummary  <- app/chat2/routes_chats.py:serialize_chat
//   - ServerMessage (see ../model/message.ts) <- serialize_message
//   - AttachmentOut <- app/chat2/routes_attachments.py:_serialize
//   - ModelInfo <- app/chat2/catalog.py:ModelInfo.as_dict
// If a named schema for any of these is ever generated, switch to
// importing `components['schemas'][...]` from api-types.generated.ts
// instead of hand-maintaining the interface here.

/**
 * @deprecated 0.1.7 typed `ChatSettings.reasoning_effort` as
 * `'low' | 'medium' | 'xhigh'`. Since 0.1.8 the value is the model's own
 * chat-template vocabulary (`ModelInfo.reasoning_efforts`), so it is a
 * plain `string`; this alias only keeps 0.1.7 code compiling. Removed in 0.2.
 */
export type ReasoningEffort = string;

export interface ToolPolicy { max_iterations: number; tool_choice: 'auto' | 'none' | 'required' }

export interface ChatSettings {
  temperature: number; max_tokens: number; top_p: number; system_prompt: string;
  enabled_tools: string[]; enabled_skills: string[]; tool_policy?: ToolPolicy;
  /**
   * Whether vLLM's thinking preamble is on for this chat
   * (app/chat2/schemas.py:SettingsPatch.enable_thinking). Optional because a
   * chat created before the flag existed simply has no key — absent means the
   * engine default, which is on.
   */
  enable_thinking?: boolean;
  /**
   * `chat_template_kwargs.reasoning_effort`, in the MODEL's own vocabulary
   * (app/chat2/schemas.py:SettingsPatch.reasoning_effort) — the values on
   * offer are `ModelInfo.reasoning_efforts`, read by the backend from the
   * loaded model's chat template. Absent or `""` means the engine default,
   * and the backend forwards a value only while thinking is on AND the
   * current model's template lists it, so a level chosen under one model can
   * never reach a template that would raise on it (#241).
   */
  reasoning_effort?: string;
  /**
   * Opaque, host-defined scoping for the chat (which instance/tenant/project
   * it belongs to). The UI never interprets it — it round-trips the object
   * back on writes so a multi-tenant host can key off it.
   */
  scope?: Record<string, unknown>;
}

export interface ChatSummary {
  id: string; title: string;
  /**
   * The title this chat had before the auto-titler last reassessed it, or
   * null if it has only ever had one (app/chat2/routes_chats.py:serialize_chat).
   * Shown next to the current title so a chat that renamed itself mid-session
   * is still recognisable.
   */
  title_prev: string | null;
  title_source: 'auto' | 'user'; model: string | null;
  /**
   * Whether `model` names something the backend will serve a turn on RIGHT
   * NOW (app/chat2/routes_chats.py:serialize_chat, the same check the turn
   * route 404s with `model_not_loaded` on). A chat pins its model by name and
   * nothing keeps that name inside the loaded set, while `GET /models` lists
   * loaded models only — so this is the authoritative answer, and catalog
   * membership is the fallback. Optional: a backend from before #240 omits
   * it, and absent means "infer from the catalog".
   */
  model_loaded?: boolean;
  settings: ChatSettings; forked_from_chat_id: string | null; forked_at_seq: number | null;
  cost_micros_total: number; created_at: string; updated_at: string;
  last_message_at: string | null; context_full?: boolean;
  /**
   * Who the chat belongs to, on hosts that share chats between users.
   * Optional: a single-user host omits the key entirely.
   */
  owner?: { id: string; name: string };
  /**
   * Whether a turn is streaming server-side for this chat right now, so a
   * list view can show it without opening the chat. Optional — absent means
   * unknown, which the UI renders the same as `'idle'`.
   */
  turn_status?: 'idle' | 'running';
}

// Matches app/chat2/routes_attachments.py:_serialize exactly. Note this
// diverges from an earlier draft of this interface: the backend serializes
// `kind`, `size_bytes`, `sha256`, and a boolean `evicted` (not a timestamp),
// and does not emit `bytes`, `evicted_at`, or `created_at` at all. `width`/
// `height` are nullable (app/chat2/repo.py:AttachmentRow) and `url` is
// `null` once the row is evicted.
export interface AttachmentOut {
  id: string; chat_id: string | null; message_id: string | null; kind: string;
  mime: string; size_bytes: number; sha256: string;
  width: number | null; height: number | null; evicted: boolean; url: string | null;
}

// The GET /chats/{id} message row shape. Re-exported from ../model/message
// (Task 3/4 owns the canonical definition there) rather than redeclared.
// (Kept as two statements: a bare `export type { X } from '...'` re-export
// does NOT bind the name locally, and `ChatDetail.messages` below needs it.)
import type { ServerMessage } from '../model/message';
export type { ServerMessage };

export interface ChatDetail {
  chat: ChatSummary; messages: ServerMessage[]; attachments: AttachmentOut[];
  context: { type: 'context'; promptTokens: number; window: number | null; full: boolean };
  /**
   * Non-null while a detached turn is still streaming server-side for this
   * chat (app/chat2/routes_chats.py:get_chat, backed by app/chat2/live.py);
   * the hook re-attaches to it via `GET .../turn/live`. Optional so older
   * fixtures without the key keep typechecking — absent means null.
   */
  live_turn?: { request_id: string; message_id: string } | null;
}

export interface ModelInfo {
  id: string; display: string; context_window: number | null; supports_tools: boolean;
  supports_vision: boolean; supports_reasoning: boolean; image_tokens_estimate: number;
  pricing: null | { input_micros_per_1k: number; output_micros_per_1k: number };
  /**
   * The `reasoning_effort` values this model's chat template accepts, in the
   * template's own words (app/chat2/catalog.py:ModelInfo.reasoning_efforts;
   * Qwen3.8: `xhigh` / `medium` / `low`). The settings panel renders exactly
   * this list and nothing of its own, so a model family with a different
   * vocabulary needs no UI change. Optional: absent (an older backend) or
   * empty means the control is not offered.
   */
  reasoning_efforts?: string[];
}

export interface Budget {
  blocked_until: string | null;
  window: { used_micros: number; limit_micros: number; resets_at: string } | null;
}

export interface TurnRequest {
  chatId: string; requestId: string; userParts?: { type: 'text'; text: string }[];
  attachmentIds?: string[]; toolResults?: { call_id: string; result: unknown }[]; regenerate?: boolean;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
