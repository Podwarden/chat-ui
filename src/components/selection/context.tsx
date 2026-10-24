'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Quote } from '../../model/selection';

/** Every string the selection actions render. English defaults in `DEFAULT_SELECTION_LABELS`. */
export interface SelectionLabels {
  menu: string;
  copy: string;
  quote: string;
  explain: string;
  ask: string;
  more: string;
  askPlaceholder: string;
  askSend: string;
  /** Prefix of "Translate to <language>". */
  translateTo: string;
  translateLanguage: string;
  branch: string;
  dock: string;
  copied: string;
  copyFailed: string;
  quoted: string;
  sent: string;
  prefilled: string;
  busyPrefilled: string;
  /** Announced (screen readers) the first time the menu appears; `{shortcut}` is NOT interpolated — it is appended. */
  available: string;
  tooManyQuotes: string;
  sourceNotFound: string;
  cannotBranch: string;
  /** The per-message "Quote" action. */
  quoteMessage: string;
  /** The code-block header "Ask" button. */
  askCode: string;
  askCodeShort: string;
  /** The link on a sent quote. */
  goToSource: string;
  removeQuote: string;
  quotes: string;
}

export const DEFAULT_SELECTION_LABELS: SelectionLabels = {
  menu: 'Selection actions',
  copy: 'Copy',
  quote: 'Quote',
  explain: 'Explain',
  ask: 'Ask…',
  more: 'More',
  askPlaceholder: 'Ask about the selection…',
  askSend: 'Send question',
  translateTo: 'Translate to',
  translateLanguage: 'Translation language',
  branch: 'Branch into a new chat',
  dock: 'Selection actions',
  copied: 'Copied',
  copyFailed: 'Could not copy',
  quoted: 'Quoted into the message box',
  sent: 'Sent',
  prefilled: 'Added to the message box',
  busyPrefilled: 'A reply is in progress — added to the message box instead',
  available: 'Selection actions available. Press',
  tooManyQuotes: 'You can stage up to 10 quotes',
  sourceNotFound: 'The quoted passage is no longer in this chat',
  cannotBranch: 'This message cannot be branched from yet',
  quoteMessage: 'Quote',
  askCode: 'Ask about this code',
  askCodeShort: 'Ask',
  goToSource: 'Go to the quoted passage',
  removeQuote: 'Remove quote',
  quotes: 'Quoted passages',
};

/** The keyboard shortcut that opens the menu for the current selection. */
export const SELECTION_SHORTCUT = 'Alt+Enter';

export interface SelectionActionsContextValue {
  /** Stage a whole message as a quote (message action row). */
  quoteMessage(messageId: string, text: string): void;
  /** Stage a code block as a fenced chip (code-block "Ask"). */
  quoteCode(code: string, lang: string | undefined, messageId?: string): void;
  /** Scroll to and flash the passage a quote came from. */
  revealQuote(q: Pick<Quote, 'text' | 'source'>): void;
  /** <Thread> registers how to bring a (possibly virtualised) message into view. */
  registerScroller(fn: ((messageId: string) => boolean) | null): void;
  labels: SelectionLabels;
}

export const SelectionActionsContext = createContext<SelectionActionsContextValue | null>(null);

/** The selection-actions controller, or null outside `<SelectionActions>` (every consumer then renders as before). */
export function useSelectionActions(): SelectionActionsContextValue | null {
  return useContext(SelectionActionsContext);
}

/** Dock slot plumbing (kept apart so dock updates never re-render message rows). */
export interface DockSlotValue {
  node: ReactNode;
  register(): () => void;
}
export const DockSlotContext = createContext<DockSlotValue | null>(null);
