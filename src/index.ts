// The package's React entry.
//
// `<ChatApp>` is the whole experience in one component — a host that wants the
// standard layout mounts that and nothing else. Everything it is built from is
// exported beside it for hosts that assemble their own: the two providers, the
// components, the hooks, the pure message/wire model, and the three UI atoms
// the components share.
//
// Two neighbours stay out of this file on purpose. `createHttpAdapters` has
// its own entry (`@podwarden/chat-ui/adapters-http`) so a host that ships a
// different transport never pulls it in, and the conformance suite has
// `@podwarden/chat-ui/conformance`. The backend contract, being React-free, is
// re-exported here as a convenience and is also importable on its own from
// `@podwarden/chat-ui/contract`.
export { ChatApp } from './app/chat-app';
export type { ChatAppProps } from './app/chat-app';
export type { Labels } from './app/labels';

export { AdaptersProvider, useAdapters, useOptionalAdapters } from './adapters/context';
export { DEFAULT_CAPABILITIES } from './adapters/capabilities';
export type { Capabilities, ScopeOption } from './adapters/capabilities';
export type { Adapters } from './adapters/types';

export { ChatThemeProvider, useChatTheme } from './theme/context';
export type { ChatTheme } from './theme/context';

export { Thread } from './components/thread';
export { Composer } from './components/composer';
export { ChatSidebar } from './components/chat-sidebar';
export { SettingsPanel } from './components/settings-panel';
export { Lightbox } from './components/lightbox';
export { ContextBar } from './components/context-bar';
export { BudgetMeter } from './components/budget-meter';
export { Banners } from './components/banners';

export { useChatThread } from './hooks/use-chat-thread';
export { useChats } from './hooks/use-chats';
export { useAttachments } from './hooks/use-attachments';
export { useContextMeter } from './hooks/use-context-meter';

export { reduceEvent, emptyThread, fromServerMessage } from './model/message';
// The single-model rule the composer, the banners and the settings panel all
// read through — exported so a host's own chrome can agree with them.
export { resolveActiveModel } from './model/resolve-model';
export { parseSseStream } from './model/wire';

export { Button } from './ui/button';
export { Modal } from './ui/modal';
export { cn } from './ui/cn';
export { copyToClipboard } from './ui/clipboard';

export * from './contract';

// A namespace, not a flat re-export: `LIMITS.MAX_IMAGE_BYTES`, `LIMITS.SIGNED_URL_TTL_S`,
// etc. A host's own contract tests assert against these directly rather than
// duplicating the numbers (see `src/model/limits.ts` for the full list).
export * as LIMITS from './model/limits';
