'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, MessageSquareQuote } from 'lucide-react';
import { copyToClipboard } from '@/ui/clipboard';
import { useChatTheme } from '@/theme/context';
import { CODE_FOLD_PX } from '../model/limits';
import { linkifyCodeHast } from '../model/autolink';
import { getHighlighter, getLoadedHighlighter, resolveLang } from '../model/shiki';
import { linkifyCode } from './linkify';
import { sanitizeHastToHtml, sanitizeHastToHtmlSync } from '../model/sanitize-schema';
import { useSelectionActions } from './selection/context';

/**
 * Where a code block's fold choice lives, so it outlives the component.
 *
 * A message's blocks DO remount once per turn by design — the streaming tail
 * renders in <Thread>'s footer and the finished message as a list row — and a
 * user who pressed "Show all" mid-stream must still see it expanded afterwards.
 * So the user's choice is kept per block identity (`<message id>:<part index>`
 * scope + the fence's ordinal in that part), not in component state alone.
 * Bounded: the oldest entries are dropped past `FOLD_MEMORY_CAP`.
 */
const FOLD_MEMORY_CAP = 500;
const foldMemory = new Map<string, boolean>();
function rememberFold(key: string, expanded: boolean): void {
  foldMemory.delete(key);
  foldMemory.set(key, expanded);
  while (foldMemory.size > FOLD_MEMORY_CAP) foldMemory.delete(foldMemory.keys().next().value as string);
}
/** Test seam. */
export function __resetCodeFoldMemory(): void {
  foldMemory.clear();
}

/**
 * The identity scope for the code blocks rendered below — set by <Markdown>
 * from its optional `blockScope` prop (<MessageItem> passes
 * `<message id>:<part index>`). Without one, a block keeps its fold choice
 * only for as long as it stays mounted.
 */
export const CodeBlockScope = createContext<string | undefined>(undefined);

function useFold(blockIndex: number | undefined): [boolean, (v: boolean) => void] {
  const scope = useContext(CodeBlockScope);
  const key = scope !== undefined && blockIndex !== undefined ? `${scope}#${blockIndex}` : null;
  const [expanded, setLocal] = useState(() => (key !== null ? (foldMemory.get(key) ?? false) : false));
  const set = useCallback(
    (v: boolean) => {
      setLocal(v);
      if (key !== null) rememberFold(key, v);
    },
    [key],
  );
  return [expanded, set];
}

/** `useLayoutEffect` in the browser (measure before paint), a no-op-safe `useEffect` on the server. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * A fenced code block: Shiki-highlighted, copy button, language label, folded above
 * `CODE_FOLD_PX` with a "Show all" / "Collapse" toggle.
 *
 * STREAMING (owner report: toggle undone by the next token, block height
 * jumping per token): this component must stay MOUNTED while its text grows —
 * <Thread> renders the tail through stable component types for exactly that —
 * and must not change layout between tokens:
 *  - the "tall" decision is measured before paint (layout effect) and LATCHED
 *    while the code only grows, so a folded block never shows an unfolded
 *    frame and never toggles back and forth;
 *  - highlighting is synchronous once Shiki is loaded, rendered into the SAME
 *    body element, and the plain fallback uses the same box metrics, so the
 *    plain → highlighted switch happens at most once per page load.
 *
 * SECURITY: `dangerouslySetInnerHTML` appears in exactly one place in chat2 — the
 * element below, and nowhere else in this feature (the `<Markdown>` renderer builds
 * React elements, it never injects HTML). The string handed to it below is Shiki's own `codeToHast`
 * output run through `sanitizeHastToHtml`, i.e. the *same* `SANITIZE_SCHEMA` +
 * policy plugin the markdown pipeline uses. Model text never reaches this element
 * as HTML; it arrives as `code` and is re-serialised by Shiki.
 */
export function CodeBlock({ code, lang, blockIndex }: { code: string; lang?: string; blockIndex?: number }) {
  const theme = useChatTheme();
  const sel = useSelectionActions();
  const scope = useContext(CodeBlockScope);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useFold(blockIndex);
  const [tall, setTall] = useState(false);
  const [, forceRender] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // STREAMING FLICKER (user report): every token re-parses the markdown and can
  // remount this component, so an async highlight showed an unstyled frame per
  // token. Shiki's `codeToHast` is synchronous once the highlighter is loaded,
  // and the sanitizer has a sync variant once its imports have landed — so we
  // highlight IN RENDER whenever possible and only ever fall back before the
  // one-time module loads (first code block of the session).
  const shikiTheme = theme === 'light' ? 'github-light' : 'github-dark';
  const highlighter = getLoadedHighlighter();
  const html = useMemo(() => {
    if (!highlighter) return null;
    try {
      const hast = highlighter.codeToHast(code, {
        lang: resolveLang(lang),
        // Never Shiki's dual-theme mode: it emits a `--shiki-dark` custom property
        // that only applies through a `dark:` variant, which global-constraints bans.
        theme: shikiTheme,
      });
      // Linkify BEFORE sanitising, so the anchors we add are held to the same
      // schema + policy as everything else in the tree (that is what gives them
      // their `target`/`rel` and rejects any href that is not http(s)/mailto).
      return sanitizeHastToHtmlSync(linkifyCodeHast(hast));
    } catch {
      return null; // highlighting is decorative
    }
  }, [highlighter, code, lang, shikiTheme]);

  useEffect(() => {
    // Warm the async pieces exactly once, then re-render so the sync path takes
    // over. After this first resolution the fallback is never shown again.
    if (html !== null) return;
    let alive = true;
    void (async () => {
      try {
        const h = await getHighlighter();
        const hast = h.codeToHast(code, { lang: resolveLang(lang), theme: shikiTheme });
        await sanitizeHastToHtml(hast); // warms the sanitizer imports
        if (alive) forceRender((n) => n + 1);
      } catch {
        /* stay on the fallback */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- warmup only; the sync path owns steady-state
  }, [html === null]);

  // Measured before paint, and latched: while the code only grows (streaming)
  // a block that has crossed the fold stays "tall", so the fold never drops
  // for a frame and the block's visible height cannot oscillate. Only a
  // non-append change (a different code string) re-decides from scratch.
  const measuredFor = useRef('');
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const grew = code.startsWith(measuredFor.current);
    measuredFor.current = code;
    const over = el.scrollHeight > CODE_FOLD_PX;
    setTall((was) => (grew && was) || over);
  }, [html, code]);

  const bodyClass =
    'overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-chat-fg';
  const bodyStyle = tall && !expanded ? { maxHeight: CODE_FOLD_PX, overflowY: 'hidden' as const } : undefined;

  return (
    <div className="group relative my-2 rounded-[0.25rem] border border-chat-rule bg-chat-page" data-code-block="" data-lang={lang ?? ''}>
      <div data-selection-ignore="" className="flex select-none items-center justify-between border-b border-chat-rule px-2 py-1 font-mono text-[11px] text-chat-dim">
        <span>{lang ?? 'text'}</span>
        <span className="flex items-center gap-1">
        {sel && (
          <button
            type="button"
            aria-label={sel.labels.askCode}
            title={sel.labels.askCode}
            className="inline-flex items-center gap-1 rounded-[0.25rem] px-1 text-chat-muted hover:text-chat-accent"
            // <message id>:<part index> — see CodeBlockScope
            onClick={() => sel.quoteCode(code, lang, scope !== undefined ? scope.slice(0, scope.lastIndexOf(':')) : undefined)}
          >
            <MessageSquareQuote className="h-3.5 w-3.5" aria-hidden />
            <span>{sel.labels.askCodeShort}</span>
          </button>
        )}
        <button
          type="button"
          aria-label="Copy code"
          className="rounded-[0.25rem] px-1 text-chat-muted hover:text-chat-accent"
          onClick={() => {
            void copyToClipboard(code)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              })
              .catch(() => setCopied(false));
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        </button>
        </span>
      </div>

      {/* ONE body element for both renderings — its box (padding, font, line
          height, fold) is what the user sees grow, so it is never replaced;
          only its content switches, and only once, from plain to highlighted. */}
      <div
        ref={ref}
        className={bodyClass}
        style={bodyStyle}
        data-highlighted={html ? 'true' : 'false'}
        {...(html
          ? { dangerouslySetInnerHTML: { __html: html } }
          : {
              children: (
                <pre className="font-mono text-[13px] leading-relaxed [&_a]:underline">{linkifyCode(code)}</pre>
              ),
            })}
      />

      {tall && (
        <button
          type="button"
          aria-expanded={expanded}
          data-selection-ignore=""
          className="w-full select-none border-t border-chat-rule py-1 text-xs text-chat-accent-strong hover:text-chat-accent"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Collapse' : 'Show all'}
        </button>
      )}
    </div>
  );
}
