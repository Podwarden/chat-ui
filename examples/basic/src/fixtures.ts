// Canned content for the no-backend demo (see ./demo-adapters.ts).
//
// Seven seeded chats and a short delta script are ALL the "backend" this
// example has. Everything below is plain data — no network, no timers, no
// randomness — so the app renders the exact same transcript on every load.
//
// Types are imported by RELATIVE path, not from the package name
// (`@podwarden/chat-ui`): the root vitest suite imports `./demo-adapters`
// directly, and resolving `@podwarden/chat-ui` there would depend on this
// example's own `node_modules` being installed. `src/adapters/types.ts`
// re-exports the contract types (`ChatSummary`, `ChatSettings`, `ModelInfo`,
// ...), so importing from it alone is enough.
import type {
  AttachmentOut, ChatDetail, ChatSettings, ChatSummary, ModelInfo,
} from '../../../src/adapters/types';
import type { Part } from '../../../src/model/message';
import type { ServerMessage } from '../../../src/model/message';
import { SUNSET_DATA_URI } from './sunset-image';

/** id of the seeded chat with a fenced code block and a LaTeX expression —
 *  the one `?seed=demo` opens deterministically, and the one meant to be
 *  screenshotted. */
export const DEMO_CHAT_ID = 'demo-showcase';
/** A tool call and its result (`tool-call` / `tool-result` events). */
export const TOOL_CHAT_ID = 'demo-tool-call';
/** The `present_options` client tool, rendered as its multiple-choice buttons. */
export const OPTIONS_CHAT_ID = 'demo-options';
/** A message with an image attachment (thumbnail + lightbox). */
export const ATTACHMENTS_CHAT_ID = 'demo-attachments';
/** A chat forked from `DEMO_CHAT_ID` partway through — carries `forked_from_chat_id`. */
export const FORKED_CHAT_ID = 'demo-fork';
/** A plain one-turn chat, seeded only to give the sidebar a realistic list length. */
export const REFACTOR_CHAT_ID = 'demo-refactor';
export const WELCOME_CHAT_ID = 'demo-welcome';

/** `?seed=<key>` → the chat id it opens (see `examples/basic/src/main.tsx`).
 *  `demo` is the original key and must keep resolving to `DEMO_CHAT_ID` —
 *  the published screenshots and `tests/public-readme.test.ts` both pin it. */
export const SEED_IDS: Record<string, string> = {
  demo: DEMO_CHAT_ID,
  tools: TOOL_CHAT_ID,
  options: OPTIONS_CHAT_ID,
  attachments: ATTACHMENTS_CHAT_ID,
  fork: FORKED_CHAT_ID,
};

export const DEMO_MODEL: ModelInfo = {
  id: 'demo-model',
  display: 'Demo Model (offline)',
  context_window: 8192,
  supports_tools: false,
  supports_vision: false,
  supports_reasoning: false,
  image_tokens_estimate: 0,
  pricing: null,
};

export const DEFAULT_SETTINGS: ChatSettings = {
  temperature: 0.7,
  max_tokens: 1024,
  top_p: 1,
  system_prompt: 'You are a friendly assistant.',
  enabled_tools: [],
  enabled_skills: [],
};

function chatSummary(over: Partial<ChatSummary> & { id: string; title: string; updated_at: string }): ChatSummary {
  return {
    title_prev: null,
    title_source: 'auto',
    model: DEMO_MODEL.id,
    settings: DEFAULT_SETTINGS,
    forked_from_chat_id: null,
    forked_at_seq: null,
    cost_micros_total: 0,
    created_at: over.updated_at,
    last_message_at: over.updated_at,
    context_full: false,
    ...over,
  };
}

function serverMessage(over: Partial<ServerMessage> & { id: string; seq: number; role: string; parts: unknown[]; created_at: string }): ServerMessage {
  return {
    model: null,
    settings_snapshot: {},
    usage: null,
    finish_reason: null,
    error: null,
    ...over,
  };
}

/** One record of the in-memory store: a chat plus everything `getChat` returns for it. */
export interface SeedChat {
  chat: ChatSummary;
  messages: ServerMessage[];
  attachments: AttachmentOut[];
  context: ChatDetail['context'];
}

const SHOWCASE_ANSWER = [
  "Sure — here's a small example.",
  '',
  '```python',
  'def greet(name: str) -> str:',
  '    return f"Hello, {name}!"',
  '```',
  '',
  'And since you asked about geometry too: the area of a circle is $A = \\pi r^2$,',
  'where $r$ is the radius.',
].join('\n');

const WELCOME_ANSWER = [
  "Hello! I'm a fully in-memory demo — there is no server and no network",
  'call behind me. Type a message below and I will stream a reply back',
  'token by token, the same way a real backend would over SSE.',
].join('\n');

const GENERIC_GREET_ANSWER = [
  "Here's a generic version — pass the greeting template in, and the language",
  "becomes a parameter instead of something baked into the function:",
  '',
  '```python',
  'def greet(name: str, template: str = "Hello, {}!") -> str:',
  '    return template.format(name)',
  '',
  'greet("Alex")                       # "Hello, Alex!"',
  'greet("Alex", "Hallo, {}!")         # "Hallo, Alex!"',
  '```',
].join('\n');

/** Weather-lookup tool call: a non-client tool (`client: false`), so it renders
 *  as the collapsible `ToolCallBlock` — unlike `present_options` below, which
 *  is a client tool the package resolves into buttons directly. */
const WEATHER_CALL_ID = 'call-weather-1';
const weatherToolParts: Part[] = [
  {
    type: 'tool_call', id: WEATHER_CALL_ID, name: 'get_weather', client: false,
    args: { location: 'Amsterdam, NL' },
    argsText: JSON.stringify({ location: 'Amsterdam, NL' }),
  },
  {
    type: 'tool_result', callId: WEATHER_CALL_ID, ok: true, durationMs: 812,
    result: { temp_c: 14, conditions: 'Overcast, light breeze' },
  },
  {
    type: 'text',
    text: "It's 14°C and overcast in Amsterdam right now, with a light breeze — a light jacket is enough.",
  },
];

/** `present_options`: the reducer always emits BOTH the raw `tool_call` part
 *  AND the derived `options` part for the same call id (see
 *  `src/model/message.ts:reduceEvent`, the `'tool-call'` case) — replicated
 *  here by hand since this fixture is authored data, not a live event
 *  stream. `MessageItem` hides the tool-call row whenever a matching
 *  `options` part exists, so only the buttons render. No `answered` field:
 *  the question is still open, exactly the state worth a screenshot. */
const OPTIONS_CALL_ID = 'call-target-1';
const optionsArgs = {
  question: 'Which environment should I deploy this to?',
  options: [
    { label: 'Staging', value: 'staging' },
    { label: 'Production', value: 'production' },
    { label: 'Local sandbox', value: 'local' },
  ],
};
const deployOptionParts: Part[] = [
  {
    type: 'tool_call', id: OPTIONS_CALL_ID, name: 'present_options', client: true,
    args: optionsArgs, argsText: JSON.stringify(optionsArgs),
  },
  {
    type: 'options', callId: OPTIONS_CALL_ID, question: optionsArgs.question,
    options: optionsArgs.options, multi: false,
  },
];

const SUNSET_ATTACHMENT_ID = 'att-sunset-1';
const sunsetAttachment: AttachmentOut = {
  id: SUNSET_ATTACHMENT_ID,
  chat_id: ATTACHMENTS_CHAT_ID,
  message_id: `${ATTACHMENTS_CHAT_ID}-m1`,
  kind: 'image',
  mime: 'image/png',
  size_bytes: 6122,
  sha256: 'b4f0c9e2a1d7e6f3c8b5a94d2e1f0c7b6a59483d2e1f0c7b6a5948372615049',
  width: 320,
  height: 240,
  evicted: false,
  url: SUNSET_DATA_URI,
};

export const SEED_CHATS: SeedChat[] = [
  {
    chat: chatSummary({
      id: OPTIONS_CHAT_ID, title: 'Deployment target', title_prev: 'New chat',
      updated_at: '2026-01-03T09:15:00.000Z',
    }),
    messages: [
      serverMessage({
        id: `${OPTIONS_CHAT_ID}-m1`, seq: 1, role: 'user',
        parts: [{ type: 'text', text: "I'm ready to ship the update — where should it go?" }],
        created_at: '2026-01-03T09:14:40.000Z',
      }),
      serverMessage({
        id: `${OPTIONS_CHAT_ID}-m2`, seq: 2, role: 'assistant', parts: deployOptionParts,
        model: DEMO_MODEL.id, finish_reason: 'tool_calls',
        created_at: '2026-01-03T09:15:00.000Z',
      }),
    ],
    attachments: [],
    context: { type: 'context', promptTokens: 140, window: DEMO_MODEL.context_window, full: false },
  },
  {
    chat: chatSummary({ id: TOOL_CHAT_ID, title: 'Weather lookup', updated_at: '2026-01-03T08:40:00.000Z' }),
    messages: [
      serverMessage({
        id: `${TOOL_CHAT_ID}-m1`, seq: 1, role: 'user',
        parts: [{ type: 'text', text: "What's the weather like in Amsterdam right now?" }],
        created_at: '2026-01-03T08:39:45.000Z',
      }),
      serverMessage({
        id: `${TOOL_CHAT_ID}-m2`, seq: 2, role: 'assistant', parts: weatherToolParts,
        model: DEMO_MODEL.id,
        usage: { prompt: 112, completion: 58, estimated: true },
        finish_reason: 'stop',
        created_at: '2026-01-03T08:40:00.000Z',
      }),
    ],
    attachments: [],
    context: { type: 'context', promptTokens: 170, window: DEMO_MODEL.context_window, full: false },
  },
  {
    chat: chatSummary({ id: ATTACHMENTS_CHAT_ID, title: 'Sunset photo review', updated_at: '2026-01-02T18:20:00.000Z' }),
    messages: [
      serverMessage({
        id: `${ATTACHMENTS_CHAT_ID}-m1`, seq: 1, role: 'user',
        parts: [
          { type: 'text', text: "Here's the shot from last night — does the colour grade look right to you?" },
          { type: 'image', attachmentId: SUNSET_ATTACHMENT_ID, width: 320, height: 240 },
        ],
        created_at: '2026-01-02T18:19:30.000Z',
      }),
      serverMessage({
        id: `${ATTACHMENTS_CHAT_ID}-m2`, seq: 2, role: 'assistant',
        parts: [{
          type: 'text',
          text: 'The gradient reads naturally, and the warm rim on the sun keeps it from going flat. If '
            + "anything, push the foreground hills a touch darker — they're close enough to the sky tone at "
            + 'the edges to lose separation once this is compressed for the web.',
        }],
        model: DEMO_MODEL.id,
        usage: { prompt: 96, completion: 52, estimated: true },
        finish_reason: 'stop',
        created_at: '2026-01-02T18:20:00.000Z',
      }),
    ],
    attachments: [sunsetAttachment],
    context: { type: 'context', promptTokens: 260, window: DEMO_MODEL.context_window, full: false },
  },
  {
    chat: chatSummary({
      id: FORKED_CHAT_ID, title: 'Markdown & math showcase (fork)',
      forked_from_chat_id: DEMO_CHAT_ID, forked_at_seq: 2,
      updated_at: '2026-01-02T12:10:00.000Z',
    }),
    messages: [
      serverMessage({
        id: `${FORKED_CHAT_ID}-m1`, seq: 1, role: 'user',
        parts: [{ type: 'text', text: 'Show me a short Python example and a math formula.' }],
        created_at: '2026-01-01T12:04:50.000Z',
      }),
      serverMessage({
        id: `${FORKED_CHAT_ID}-m2`, seq: 2, role: 'assistant',
        parts: [{ type: 'text', text: SHOWCASE_ANSWER }],
        model: DEMO_MODEL.id,
        usage: { prompt: 96, completion: 64, estimated: true },
        finish_reason: 'stop',
        created_at: '2026-01-01T12:05:00.000Z',
      }),
      serverMessage({
        id: `${FORKED_CHAT_ID}-m3`, seq: 3, role: 'user',
        parts: [{ type: 'text', text: 'Now make the function generic over any greeting language.' }],
        created_at: '2026-01-02T12:09:40.000Z',
      }),
      serverMessage({
        id: `${FORKED_CHAT_ID}-m4`, seq: 4, role: 'assistant',
        parts: [{ type: 'text', text: GENERIC_GREET_ANSWER }],
        model: DEMO_MODEL.id,
        usage: { prompt: 168, completion: 88, estimated: true },
        finish_reason: 'stop',
        created_at: '2026-01-02T12:10:00.000Z',
      }),
    ],
    attachments: [],
    context: { type: 'context', promptTokens: 352, window: DEMO_MODEL.context_window, full: false },
  },
  {
    chat: chatSummary({ id: DEMO_CHAT_ID, title: 'Markdown & math showcase', updated_at: '2026-01-01T12:05:00.000Z' }),
    messages: [
      serverMessage({
        id: `${DEMO_CHAT_ID}-m1`, seq: 1, role: 'user',
        parts: [{ type: 'text', text: 'Show me a short Python example and a math formula.' }],
        created_at: '2026-01-01T12:04:50.000Z',
      }),
      serverMessage({
        id: `${DEMO_CHAT_ID}-m2`, seq: 2, role: 'assistant',
        parts: [{ type: 'text', text: SHOWCASE_ANSWER }],
        model: DEMO_MODEL.id,
        usage: { prompt: 96, completion: 64, estimated: true },
        finish_reason: 'stop',
        created_at: '2026-01-01T12:05:00.000Z',
      }),
    ],
    attachments: [],
    context: { type: 'context', promptTokens: 160, window: DEMO_MODEL.context_window, full: false },
  },
  {
    chat: chatSummary({ id: REFACTOR_CHAT_ID, title: 'Refactor the auth middleware', updated_at: '2026-01-01T10:05:00.000Z' }),
    messages: [
      serverMessage({
        id: `${REFACTOR_CHAT_ID}-m1`, seq: 1, role: 'user',
        parts: [{ type: 'text', text: 'Can you review this middleware for edge cases before I merge it?' }],
        created_at: '2026-01-01T10:04:30.000Z',
      }),
      serverMessage({
        id: `${REFACTOR_CHAT_ID}-m2`, seq: 2, role: 'assistant',
        parts: [{
          type: 'text',
          text: "Paste it in and I'll go through it — worth checking up front whether it re-validates on "
            + 'token refresh, or only on the initial request.',
        }],
        model: DEMO_MODEL.id,
        usage: { prompt: 64, completion: 34, estimated: true },
        finish_reason: 'stop',
        created_at: '2026-01-01T10:05:00.000Z',
      }),
    ],
    attachments: [],
    context: { type: 'context', promptTokens: 98, window: DEMO_MODEL.context_window, full: false },
  },
  {
    chat: chatSummary({ id: WELCOME_CHAT_ID, title: 'Welcome', updated_at: '2026-01-01T12:00:00.000Z' }),
    messages: [
      serverMessage({
        id: `${WELCOME_CHAT_ID}-m1`, seq: 1, role: 'user',
        parts: [{ type: 'text', text: 'Hi there!' }],
        created_at: '2026-01-01T11:59:50.000Z',
      }),
      serverMessage({
        id: `${WELCOME_CHAT_ID}-m2`, seq: 2, role: 'assistant',
        parts: [{ type: 'text', text: WELCOME_ANSWER }],
        model: DEMO_MODEL.id,
        usage: { prompt: 40, completion: 48, estimated: true },
        finish_reason: 'stop',
        created_at: '2026-01-01T12:00:00.000Z',
      }),
    ],
    attachments: [],
    context: { type: 'context', promptTokens: 88, window: DEMO_MODEL.context_window, full: false },
  },
];

/** Chunks of the canned reply `demo-adapters.ts` streams back for any new turn. */
export const REPLY_DELTAS: string[] = [
  'This reply is ', 'streamed from ', 'an in-memory ', 'fixture — ',
  'there is no ', 'server behind ', 'it at all. ',
  'Try the stop ', 'button while ', "I'm typing ", 'to see an ',
  'aborted turn.',
];
