'use client';

import { Code2, Quote as QuoteIcon, X } from 'lucide-react';
import { quotePreview, type Quote } from '../../model/selection';
import { DEFAULT_SELECTION_LABELS, useSelectionActions } from './context';

export interface QuoteChipsProps {
  quotes: readonly Quote[];
  onRemove(id: string): void;
  /** Clicking a chip's text. Defaults to scrolling to its source inside `<SelectionActions>`. */
  onReveal?(q: Quote): void;
}

/**
 * The quotes staged above the composer: one removable chip each, with a
 * truncated preview (full text in the tooltip). Clicking the preview jumps to
 * the passage it was quoted from.
 */
export function QuoteChips({ quotes, onRemove, onReveal }: QuoteChipsProps) {
  const ctx = useSelectionActions();
  const labels = ctx?.labels ?? DEFAULT_SELECTION_LABELS;
  if (quotes.length === 0) return null;
  const reveal = onReveal ?? ctx?.revealQuote;
  return (
    <ul aria-label={labels.quotes} className="flex flex-wrap gap-1.5 px-2 pt-2" data-testid="quote-chips">
      {quotes.map((q) => (
        <li key={q.id} className="flex max-w-full items-center gap-1 rounded-[0.25rem] border border-chat-rule bg-chat-surface-2 pl-1.5 text-xs text-chat-muted" data-testid="quote-chip">
          {q.kind === 'code' ? <Code2 className="h-3 w-3 shrink-0" aria-hidden /> : <QuoteIcon className="h-3 w-3 shrink-0" aria-hidden />}
          <button
            type="button"
            title={q.text}
            disabled={!reveal || !q.source}
            onClick={() => reveal?.(q)}
            className="min-w-0 truncate py-0.5 text-left hover:text-chat-accent disabled:hover:text-chat-muted"
          >
            {q.kind === 'code' && q.lang ? <span className="mr-1 font-mono text-chat-dim">{q.lang}</span> : null}
            {quotePreview(q.text)}
          </button>
          <button type="button" aria-label={`${labels.removeQuote}: ${quotePreview(q.text, 40)}`} onClick={() => onRemove(q.id)}
            className="shrink-0 rounded-[0.25rem] p-1 text-chat-dim hover:text-chat-accent">
            <X className="h-3 w-3" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
