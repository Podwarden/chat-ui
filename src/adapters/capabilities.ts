import type { ChatSettings } from './types';
import { PRESENT_OPTIONS, type ClientTool } from '../model/client-tools';

/**
 * What the host lets this chat do — the second injection point beside
 * `Adapters`. Everything here is a product decision the package cannot make
 * for itself: vLLM Warden edits its system prompt and hides tool policy, the
 * Hub does the opposite and adds shared chats on top.
 *
 * A host passes a `Partial<Capabilities>` to `<ChatApp>`; the keys it leaves
 * out fall back to `DEFAULT_CAPABILITIES`.
 */
export interface Capabilities {
  /** Client-side tools offered to the model (checkboxes in Settings). */
  listTools(): ClientTool[];
  /** Server-side skills the chat may enable; an empty list hides the section. */
  listSkills(): Promise<string[]>;
  systemPrompt: 'editable' | 'readonly' | 'hidden';
  toolPolicy: 'editable' | 'hidden';
  /**
   * Whether chats are shared between users (Hub only). On, the sidebar needs
   * `ChatApp`'s `currentUserId` too: it groups other people's chats under
   * their name and offers Fork — never rename or delete — on them.
   */
  sharedChats?: boolean;
  /**
   * A short badge naming the chat's scope, e.g. the instance it belongs to
   * (Hub only). Reads the host's own opaque `settings.scope`; `null` (or an
   * absent capability) renders no badge on that row.
   */
  scopeLabel?: (settings: ChatSettings) => string | null;
  /**
   * Who picks the model. `'user'` — the default, and what every host before
   * 0.1.3 got — means the chat's stored `model` is authoritative: it names a
   * model the backend will be asked for, and a miss is a real miss (composer
   * disabled, "not loaded" banner). `'host'` means the host chooses the model
   * system-wide and never shows a picker, so a chat's stored `model` is
   * informational and the single listed model IS the active one; a stale or
   * absent id resolves to it rather than reading as "not loaded".
   *
   * Strictly opt-in, because it is not safe to guess. vLLM Warden's turn route
   * 404s on both a null and a stale model id (`app/chat2/routes_turn.py`), and
   * a brand-new user there has no defaults row to seed one from — so under
   * `'user'` every render path stays byte-identical to 0.1.2 and the UI keeps
   * refusing a send the server would refuse anyway.
   */
  modelSelection?: 'user' | 'host';
  /**
   * Whether the user may see and edit the per-chat settings at all.
   * `'hidden'` removes the header's Settings toggle and the panel behind it —
   * for a host that has already decided every knob (the Hub) and does not want
   * a panel offering a model picker it never intends to honour. Nothing else
   * moves: rename, fork, delete and regenerate are untouched.
   *
   * Optional, like `sharedChats` and `scopeLabel` and unlike `systemPrompt` /
   * `toolPolicy`: `DEFAULT_CAPABILITIES` stamps `'editable'`, and every read is
   * `!== 'hidden'`, so a hand-built `Capabilities` literal in a host that
   * assembles its own layout keeps compiling and keeps its panel.
   */
  settings?: 'editable' | 'hidden';
  /**
   * Lets the user bind each NEW chat to one of the host's scopes — the Hub
   * calls a scope a "core". The host supplies both halves: the options to
   * show, and the exact opaque object to persist as `settings.scope` for the
   * one that is chosen. The package never learns what a host's scope keys mean
   * (`instance_id`, `tenant`, …), it only round-trips the object.
   *
   * `label` names the control ("Core"). `list()` is called once per
   * `capabilities` identity, so keep that object stable; a rejection is logged
   * and treated as "no scopes", never thrown at the user.
   *
   * Absent — the default — is today's behaviour: no picker, and created chats
   * carry no scope. Existing chats' badges are `scopeLabel`'s business, not
   * this one's.
   */
  scopes?: {
    label: string;
    list(): Promise<ScopeOption[]>;
  };
}

/**
 * One choice in the scope picker. `scope` is the host's own opaque object,
 * persisted verbatim as the new chat's `settings.scope`.
 */
export interface ScopeOption {
  id: string;
  label: string;
  scope: Record<string, unknown>;
}

// `client-tools.ts` already ships exactly the `PRESENT_OPTIONS`/`ClientTool`
// shape this default needs — no placeholder.
export const DEFAULT_CAPABILITIES: Capabilities = {
  listTools: (): ClientTool[] => [PRESENT_OPTIONS],
  listSkills: async (): Promise<string[]> => [],
  systemPrompt: 'editable',
  // vLLM Warden itself: 'hidden' (tool policy is not user-editable here).
  // The Hub overrides this to 'editable' for its own richer tool-policy UI.
  toolPolicy: 'hidden',
  // The panel has always been there; a host that wants it gone says so.
  settings: 'editable',
  // The chat's stored model is authoritative until a host says otherwise.
  modelSelection: 'user',
  // `scopes` stays absent by design — an undefined key here is what makes "no
  // picker, no scope on create" the default for every host that never mentions
  // it (vLLM Warden included).
};
