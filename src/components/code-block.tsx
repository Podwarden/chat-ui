'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyToClipboard } from '@/ui/clipboard';
import { useChatTheme } from '@/theme/context';
import { CODE_FOLD_PX } from '../model/limits';
import { linkifyCodeHast } from '../model/autolink';
import { getHighlighter, getLoadedHighlighter, resolveLang } from '../model/shiki';
import { linkifyCode } from './linkify';
import { sanitizeHastToHtml, sanitizeHastToHtmlSync } from '../model/sanitize-schema';

/**
 * A fenced code block: Shiki-highlighted, copy button, language label, folded above
 * `CODE_FOLD_PX` with a "Show all" control.
 *
 * SECURITY: `dangerouslySetInnerHTML` appears in exactly one place in chat2 — the
 * element below, and nowhere else in this feature (the `<Markdown>` renderer builds
 * React elements, it never injects HTML). The string handed to it below is Shiki's own `codeToHast`
 * output run through `sanitizeHastToHtml`, i.e. the *same* `SANITIZE_SCHEMA` +
 * policy plugin the markdown pipeline uses. Model text never reaches this element
 * as HTML; it arrives as `code` and is re-serialised by Shiki.
 */
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const theme = useChatTheme();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
  let html: string | null = null;
  const highlighter = getLoadedHighlighter();
  if (highlighter) {
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
      html = sanitizeHastToHtmlSync(linkifyCodeHast(hast));
    } catch {
      html = null; // highlighting is decorative
    }
  }

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

  useEffect(() => {
    if (ref.current) setTall(ref.current.scrollHeight > CODE_FOLD_PX);
  }, [html, code]);

  const bodyClass =
    'overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-chat-fg';
  const bodyStyle = tall && !expanded ? { maxHeight: CODE_FOLD_PX, overflowY: 'hidden' as const } : undefined;

  return (
    <div className="group relative my-2 rounded-[0.25rem] border border-chat-rule bg-chat-page">
      <div className="flex items-center justify-between border-b border-chat-rule px-2 py-1 font-mono text-[11px] text-chat-dim">
        <span>{lang ?? 'text'}</span>
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
      </div>

      {html ? (
        <div
          ref={ref}
          className={bodyClass}
          style={bodyStyle}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div ref={ref} className={bodyClass} style={bodyStyle}>
          <pre className="font-mono text-[13px] leading-relaxed [&_a]:underline">{linkifyCode(code)}</pre>
        </div>
      )}

      {tall && !expanded && (
        <button
          type="button"
          className="w-full border-t border-chat-rule py-1 text-xs text-chat-accent-strong hover:text-chat-accent"
          onClick={() => setExpanded(true)}
        >
          Show all
        </button>
      )}
    </div>
  );
}
