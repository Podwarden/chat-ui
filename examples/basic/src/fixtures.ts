// Canned content for the no-backend demo (see ./demo-adapters.ts).
//
// Two seeded chats and a short delta script are ALL the "backend" this
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
import type { ServerMessage } from '../../../src/model/message';

/** id of the seeded chat with a fenced code block and a LaTeX expression —
 *  the one `?seed=demo` opens deterministically, and the one meant to be
 *  screenshotted. */
export const DEMO_CHAT_ID = 'demo-showcase';

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

export const SEED_CHATS: SeedChat[] = [
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
    chat: chatSummary({ id: 'demo-welcome', title: 'Welcome', updated_at: '2026-01-01T12:00:00.000Z' }),
    messages: [
      serverMessage({
        id: 'demo-welcome-m1', seq: 1, role: 'user',
        parts: [{ type: 'text', text: 'Hi there!' }],
        created_at: '2026-01-01T11:59:50.000Z',
      }),
      serverMessage({
        id: 'demo-welcome-m2', seq: 2, role: 'assistant',
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
