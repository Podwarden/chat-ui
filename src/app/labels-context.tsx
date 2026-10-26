'use client';
// Where the components below <ChatApp> read their strings and the locale.
//
// A context, not props: the strings are needed deep inside memoised rows
// (a code block inside a message inside the virtualised list), and threading
// them through every level would put a new prop on each public component.
// Outside any provider every component renders the English defaults, so the
// building blocks keep working on their own.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_LABELS, mergeLabels, type ChatUiLabelOverrides, type ChatUiLabels } from './labels';
import { createFormatters, type Formatters } from './format';
import { canonicalLocale } from '../model/locale';

export interface ChatLabelsValue {
  /** Every string, defaults already merged in. */
  labels: ChatUiLabels;
  /** The host's locale as a canonical BCP 47 tag (`ru_RU` → `ru-RU`), or `undefined` when it gave none or an invalid one. */
  locale: string | undefined;
  /** Number/date formatting for `locale`. */
  format: Formatters;
}

const DEFAULT_VALUE: ChatLabelsValue = { labels: DEFAULT_LABELS, locale: undefined, format: createFormatters(undefined) };

const ChatLabelsContext = createContext<ChatLabelsValue>(DEFAULT_VALUE);

/**
 * Strings and locale for the components below it. `<ChatApp>` mounts one from
 * its `labels` and `locale` props; a host assembling its own layout from the
 * exported components mounts it itself. Keep `labels` stable (module-level or
 * memoised): a new object re-renders every message row.
 */
export function ChatLabelsProvider({ labels, locale, children }: { labels?: ChatUiLabelOverrides; locale?: string; children: ReactNode }) {
  const merged = useMemo(() => mergeLabels(labels), [labels]);
  // Canonicalised once (`ru_RU` → `ru-RU`); an empty or invalid tag is no locale.
  const tag = useMemo(() => canonicalLocale(locale), [locale]);
  const format = useMemo(() => createFormatters(tag), [tag]);
  const value = useMemo<ChatLabelsValue>(() => ({ labels: merged, locale: tag, format }), [merged, tag, format]);
  return <ChatLabelsContext.Provider value={value}>{children}</ChatLabelsContext.Provider>;
}

/** The strings, locale and formatters in effect (English defaults outside a provider). */
export function useChatLabels(): ChatLabelsValue {
  return useContext(ChatLabelsContext);
}
