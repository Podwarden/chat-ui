// Selection actions — the pure half.
//
// Everything that turns a quoted passage into text lives here, with no React
// and no DOM, so the prompt shapes are unit-testable and a host can reuse them
// for its own affordances.
//
// One rule runs through the whole file: the selection is model output (or a
// tool result it quoted) and may contain ANY characters, so it is only ever
// CONCATENATED into a prompt. Never `String.prototype.replace(pattern, sel)`:
// a replacement string interprets `$&`, `$1`, `$$`, `` $` `` and `$'`, and a
// selection containing them would be silently rewritten (Open WebUI #32355).

import { canonicalLocale, localeLanguage } from './locale';

/** Where a quote came from, so it can link back to the passage. */
export interface QuoteSource {
  /** The id of the message the text was selected in. */
  messageId: string;
  /**
   * Character offsets of the passage inside the message body's rendered text
   * (`textContent`, UI chrome excluded). Absent for a whole-message quote.
   */
  start?: number;
  end?: number;
}

/** One quoted passage, staged in the composer or about to be sent. */
export interface Quote {
  /** Local id (chip key). */
  id: string;
  /** The passage, verbatim. */
  text: string;
  /**
   * `'text'` serialises as a Markdown blockquote; `'code'` as a fenced block
   * carrying `lang` (a code-block "Ask", or a selection wholly inside one).
   */
  kind: 'text' | 'code';
  lang?: string;
  source?: QuoteSource;
}

/** The most chips the composer stages at once (LibreChat's limit). */
export const MAX_QUOTES = 10;
/** Characters of a chip's visible preview; the full text is its tooltip. */
export const QUOTE_PREVIEW_CHARS = 80;

let seq = 0;
/** A process-unique chip id. */
export function newQuoteId(): string {
  seq += 1;
  return `q${Date.now().toString(36)}-${seq}`;
}

/** `> ` before every line; a blank line inside the passage stays a `>` line so the quote does not split. */
export function toBlockquote(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+|\n+$/g, '')
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n');
}

/**
 * A fenced code block whose fence is longer than any backtick run in `code`,
 * so code that itself contains ``` cannot close the fence early.
 */
export function toFence(code: string, lang?: string): string {
  const runs = code.match(/`+/g) ?? [];
  const longest = runs.reduce((n, r) => Math.max(n, r.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  // the info string must not contain a backtick or a newline
  const info = (lang ?? '').replace(/[`\s]/g, '');
  return fence + info + '\n' + code.replace(/\n+$/, '') + '\n' + fence;
}

/** The Markdown a quote serialises to (blockquote or fence). */
export function quoteToMarkdown(q: Pick<Quote, 'text' | 'kind' | 'lang'>): string {
  return q.kind === 'code' ? toFence(q.text, q.lang) : toBlockquote(q.text);
}

/**
 * Staged quotes + the user's own text, as the message that is sent: each
 * quote as its Markdown, separated by blank lines, then the text.
 */
export function serializeQuotes(quotes: readonly Quote[], text: string): string {
  const parts = quotes.map(quoteToMarkdown);
  const body = text.trim();
  if (body) parts.push(body);
  return parts.join('\n\n');
}

/**
 * Text appended to the composer for a quote: separated from what is already
 * there by a blank line, and followed by one so the caret lands on a fresh
 * paragraph.
 */
export function appendQuoteToDraft(draft: string, q: Pick<Quote, 'text' | 'kind' | 'lang'>): string {
  const head = draft.replace(/\s+$/, '');
  return (head ? head + '\n\n' : '') + quoteToMarkdown(q) + '\n\n';
}

/** The visible preview of a chip: whitespace collapsed, cut at `QUOTE_PREVIEW_CHARS`. */
export function quotePreview(text: string, max = QUOTE_PREVIEW_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}

/** The instruction lines the built-in actions put before the quote. */
export const PROMPTS = {
  explain: 'Explain this:',
  simplify: 'Simplify this so it is easier to understand:',
  shorter: 'Make this shorter, keeping the key points:',
  example: 'Give a concrete example that illustrates this:',
  /** Followed by the language name and a colon. */
  translate: 'Translate this into',
} as const;

/** Instruction + blank line + the quote. Concatenation only (see the file header). */
export function buildInstructionPrompt(instruction: string, q: Pick<Quote, 'text' | 'kind' | 'lang'>): string {
  return instruction + '\n\n' + quoteToMarkdown(q);
}

export function buildExplainPrompt(q: Pick<Quote, 'text' | 'kind' | 'lang'>, instruction: string = PROMPTS.explain): string {
  return buildInstructionPrompt(instruction, q);
}

/** The quote as context, then the user's own question. */
export function buildAskPrompt(q: Pick<Quote, 'text' | 'kind' | 'lang'>, question: string): string {
  return quoteToMarkdown(q) + '\n\n' + question.trim();
}

/**
 * "Translate this into <language>:" + the quote. `instruction` replaces the
 * English line (a host's localised prompt); it gets the same `language`.
 */
export function buildTranslatePrompt(
  q: Pick<Quote, 'text' | 'kind' | 'lang'>,
  language: string,
  instruction?: (language: string) => string,
): string {
  return buildInstructionPrompt(instruction ? instruction(language) : PROMPTS.translate + ' ' + language + ':', q);
}

/** A built-in "More ▸" action. Hosts may replace the list (`quickActions`). */
export interface QuickAction {
  id: string;
  label: string;
  /** The instruction line placed before the quote. */
  instruction: string;
}

export const DEFAULT_QUICK_ACTIONS: readonly QuickAction[] = [
  { id: 'simplify', label: 'Simplify', instruction: PROMPTS.simplify },
  { id: 'shorter', label: 'Make shorter', instruction: PROMPTS.shorter },
  { id: 'example', label: 'Give an example', instruction: PROMPTS.example },
];

/** Languages offered by "Translate"; the browser's own language is added first. */
export const TRANSLATE_LANGUAGES: readonly string[] = [
  'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'uk', 'pl', 'tr', 'ar', 'hi', 'zh', 'ja', 'ko',
];

/**
 * Display name of a BCP 47 language code in `locale` ("fr" → "French" in
 * English, "французский" in Russian). English when `locale` is missing or
 * not a valid tag (`ru_RU` is read as `ru-RU`); the code itself only when
 * `Intl` cannot name it at all.
 */
export function languageName(code: string, locale = 'en'): string {
  const lang = code.replace(/_/g, '-');
  for (const locales of [[canonicalLocale(locale) ?? 'en', 'en'], ['en']]) {
    try {
      const name = new Intl.DisplayNames(locales, { type: 'language' }).of(lang);
      if (name) return name;
    } catch {
      /* invalid code, or no DisplayNames: try English, then give up */
    }
  }
  return code;
}

/** The base language of the browser locale ("en-GB" → "en"), `en` outside a browser. */
export function browserLanguage(): string {
  const l = typeof navigator !== 'undefined' ? navigator.language : '';
  return localeLanguage(l) ?? 'en';
}

/**
 * Markdown/whitespace-insensitive form used to find a quoted passage in a
 * message's SOURCE text (which carries `**`, backticks, list markers, …
 * the rendered selection does not).
 */
export function normalizeForSearch(s: string): string {
  return s
    .replace(/[*_`~#>|[\]()\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Split a user message's plain text into runs of ordinary text and
 * blockquotes (consecutive `>` lines), so sent quotes can be drawn as quote
 * blocks that link back to their source.
 */
export function splitQuotedText(text: string): { kind: 'text' | 'quote'; text: string }[] {
  const out: { kind: 'text' | 'quote'; text: string }[] = [];
  const push = (kind: 'text' | 'quote', line: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += '\n' + line;
    else out.push({ kind, text: line });
  };
  for (const line of text.split('\n')) {
    const m = /^>\s?(.*)$/.exec(line);
    if (m) push('quote', m[1]!);
    else push('text', line);
  }
  // A blank line between two quotes belongs to neither; trim text runs that
  // are only the separators around quotes.
  return out
    .map((r) => (r.kind === 'text' ? { ...r, text: r.text.replace(/^\n+|\n+$/g, '') } : r))
    .filter((r) => r.kind === 'quote' || r.text.trim() !== '');
}
