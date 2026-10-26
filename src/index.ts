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
export type { ChatAppProps, SelectionActionsOptions } from './app/chat-app';
// The same chat as a launcher button and pop-up panel, for every page of a host.
export { ChatWidget } from './app/chat-widget';
export type { ChatWidgetProps, WidgetLayout } from './app/chat-widget';
// Every visible string (`labels`) and the locale numbers, dates and language
// names follow (`locale`). The provider and hook are for hosts that assemble
// their own layout from the components below.
export { DEFAULT_LABELS, mergeLabels } from './app/labels';
export type { Labels, ChatUiLabels, ChatUiLabelOverrides, CountLabel } from './app/labels';
export { ChatLabelsProvider, useChatLabels } from './app/labels-context';
export type { ChatLabelsValue } from './app/labels-context';
export { selectPlural } from './app/format';
export type { PluralForms, Formatters } from './app/format';

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

// Text-selection actions: the menu/dock provider, the dock slot, the chips,
// the context hook and the pure prompt/quote helpers.
export { SelectionActions, SelectionDock } from './components/selection/selection-actions';
export type { SelectionActionsProps, SelectionActionsHandle } from './components/selection/selection-actions';
export { QuoteChips } from './components/selection/quote-chips';
export type { QuoteChipsProps } from './components/selection/quote-chips';
export { useSelectionActions, DEFAULT_SELECTION_LABELS, SELECTION_SHORTCUT } from './components/selection/context';
export type { SelectionLabels, SelectionActionsContextValue } from './components/selection/context';
export {
  MAX_QUOTES, PROMPTS, DEFAULT_QUICK_ACTIONS, TRANSLATE_LANGUAGES,
  toBlockquote, toFence, quoteToMarkdown, serializeQuotes, appendQuoteToDraft,
  buildExplainPrompt, buildAskPrompt, buildTranslatePrompt, buildInstructionPrompt, languageName,
} from './model/selection';
export type { Quote, QuoteSource, QuickAction } from './model/selection';
export { DEFAULT_SELECTION_PREFS, readSelectionPrefs, writeSelectionPrefs } from './model/prefs';
export type { SelectionPrefs } from './model/prefs';

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
