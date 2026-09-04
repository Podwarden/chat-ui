/**
 * Bare-URL autolinking policy — the two places GFM's own rule and ours disagree.
 *
 * Turning a bare `https://…` in model output into a clickable link is **not**
 * this module's job: `remark-gfm` (already in the renderer's `remarkPlugins`,
 * see `components/markdown.tsx`) implements GFM autolink literals, and that is
 * the well-trodden rule we keep — `https?://` + host, `www.` literals promoted
 * to `http://www.…`, `localhost`, IPv4, an optional port, path/query/fragment,
 * stopping at whitespace or `<`, trailing `.,;:!?"` trimmed and a closing `)`
 * trimmed only when unbalanced. It also already refuses to touch text inside a
 * markdown link, an `<https://…>` autolink, inline code or a fence, which no
 * text-level regex can get right.
 *
 * What GFM leaves broken, and this plugin fixes, is two things:
 *
 *  1. **An upper/mixed-case scheme produced a DEAD anchor.** GFM happily links
 *     `HTTPS://EXAMPLE.COM/x`, but `hast-util-sanitize`'s `protocols.href`
 *     allowlist compares the scheme case-sensitively, so it dropped the `href`
 *     and left an `<a>` with no destination — a bare URL that renders as
 *     un-clickable text, which is exactly the bug this policy exists to kill.
 *     Lower-case the scheme (of the href only — the visible text stays as the
 *     model wrote it) so the sanitizer recognises it. Only the three schemes
 *     the sanitizer allows are normalised; `JAVASCRIPT:` is left mis-cased and
 *     is dropped downstream exactly as `javascript:` is.
 *
 *  2. **`>` was swallowed into the href.** GFM ends a literal at `<` but reads
 *     `>` as an ordinary path character and percent-encodes it, so
 *     `https://example.com/a>b` linked to `…/a%3Eb`. Our rule stops at `<`,
 *     `>` and `"`; cut the literal there and give the remainder back to the
 *     paragraph as text.
 *
 * Both rewrites are scoped to *literals* — a link whose visible text is its own
 * URL. A `[label](url)` link is never re-pointed by (2), because its text says
 * nothing about its destination.
 */
import type { Element as HastElement, Root as HastRoot, RootContent as HastContent } from 'hast';
import type { Link, Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

/** Characters that terminate a bare URL. GFM handles `<`; `>` and `"` are ours. */
const URL_STOP = /[<>"]/;

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/** Exactly the schemes `SANITIZE_SCHEMA.protocols.href` admits. */
const NORMALISED_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * Is this link a bare literal — text identical to destination? GFM stores a
 * literal's `url` as the matched text verbatim (prefixed with `http://` for a
 * `www.` literal); the percent-encoding one sees in the final `href` is applied
 * later, by `mdast-util-to-hast`'s URI normaliser. Accept either form so this
 * stays correct whichever side of that step a future plugin order puts us on
 * (`<` → `%3C`, `>` → `%3E`, `"` → `%22` is what `encodeURI` reproduces).
 * Compared case-insensitively so a mixed-case scheme still matches.
 */
function isLiteral(url: string, text: string): boolean {
  const expected = SCHEME.test(text) ? text : `http://${text}`;
  const lower = url.toLowerCase();
  if (lower === expected.toLowerCase()) return true;
  try {
    return lower === encodeURI(expected).toLowerCase();
  } catch {
    return false; // lone surrogate — not a URL we want to touch
  }
}

export function remarkAutolinkPolicy() {
  return (tree: Root) => {
    visit(tree, 'link', (node: Link, index, parent) => {
      // (2) cut a literal at the first `<` / `>` / `"`.
      const child = node.children.length === 1 ? node.children[0] : undefined;
      if (parent && typeof index === 'number' && child?.type === 'text') {
        const stop = child.value.search(URL_STOP);
        if (stop > 0 && isLiteral(node.url, child.value)) {
          const kept = child.value.slice(0, stop);
          const rest: Text = { type: 'text', value: child.value.slice(stop) };
          child.value = kept;
          node.url = SCHEME.test(kept) ? kept : `http://${kept}`;
          parent.children.splice(index + 1, 0, rest);
        }
      }

      // (1) lower-case an allowed scheme so the sanitizer keeps the href.
      const scheme = SCHEME.exec(node.url)?.[1];
      if (scheme && scheme !== scheme.toLowerCase() && NORMALISED_SCHEMES.has(scheme.toLowerCase())) {
        node.url = scheme.toLowerCase() + node.url.slice(scheme.length);
      }

      return undefined;
    });
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * URLs inside code — fences and inline code.
 *
 * GFM deliberately does NOT autolink inside code, and for source that is the
 * right call. It is the wrong call for this chat: the Warden Agent hands out a
 * grant-approval URL and formats it as a fence (or inline code) precisely
 * *because* it is a thing to copy — and the user could not click it. So the
 * code renderers linkify too, keeping the monospace styling, keeping the text
 * exactly as written, and keeping the copy button on the raw source (the
 * anchors live in the rendered tree only, never in the clipboard).
 *
 * The rule is the same one GFM applies elsewhere, minus the `www.` shorthand:
 * an explicit `http://` or `https://` scheme is required here, since bare
 * `www.` in source is far more often a hostname in a config than a link.
 * Nothing else can produce an anchor — a `javascript:` URL is not matched at
 * all, and the same sanitizer still runs over the fence path afterwards.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Scheme + everything up to whitespace or one of `< > "`, per the package rule. */
const CODE_URL = /https?:\/\/[^\s<>"]+/gi;

/** Trailing characters GFM strips from a literal before linking it. */
const TRAILING = `?!.,:;*_~'"`;

/**
 * GFM's trailing-punctuation trim: drop `?!.,:;*_~'"` from the end, and a final
 * `)` only when the URL has more closing than opening parens — so
 * `(https://x.io/a)` links `https://x.io/a` while `https://x.io/a_(b)` keeps
 * its own pair.
 */
function trimTrailing(url: string): string {
  let end = url.length;
  for (;;) {
    const ch = url[end - 1];
    if (ch === undefined) break;
    if (TRAILING.includes(ch)) {
      end -= 1;
      continue;
    }
    if (ch === ')') {
      const slice = url.slice(0, end);
      const open = (slice.match(/\(/g) ?? []).length;
      const close = (slice.match(/\)/g) ?? []).length;
      if (close > open) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

/** Empty host (`https://`, `https:///x`) or a host with characters no host has. */
const HOST = /^[A-Za-z0-9._~%+:@-]+$/;

function hasRealHost(url: string): boolean {
  const rest = url.slice(url.indexOf('//') + 2);
  const host = rest.split(/[/?#]/, 1)[0];
  return host.length > 0 && HOST.test(host);
}

export interface CodeSegment {
  /** Present when this segment is a URL to link; absent for plain text. */
  url?: string;
  value: string;
}

/**
 * Split code text into plain and linkable runs. Always returns at least one
 * segment, and concatenating every `value` reproduces the input exactly — which
 * is what keeps the rendered code identical to the source, anchors aside.
 */
export function splitCodeUrls(text: string): CodeSegment[] {
  const out: CodeSegment[] = [];
  let last = 0;
  CODE_URL.lastIndex = 0;
  for (let m = CODE_URL.exec(text); m; m = CODE_URL.exec(text)) {
    const url = trimTrailing(m[0]);
    if (!url || !hasRealHost(url)) continue;
    if (m.index > last) out.push({ value: text.slice(last, m.index) });
    out.push({ url, value: url });
    last = m.index + url.length;
    CODE_URL.lastIndex = last;
  }
  if (last < text.length || out.length === 0) out.push({ value: text.slice(last) });
  return out;
}

/**
 * The fence path: rewrite Shiki's hast in place so every URL inside it becomes
 * an `<a>`. Runs BEFORE `sanitizeHastToHtml`, so the anchors are subject to the
 * same `SANITIZE_SCHEMA` (`http` / `https` / `mailto` hrefs only) and the same
 * `rehypeChat2Policy` that adds `target="_blank" rel="noopener noreferrer"` —
 * this module never has to be trusted about a URL on its own.
 *
 * Only text nodes are touched, so Shiki's per-token `<span>`s, their colours
 * and their `line` classes survive: a URL that the grammar split across tokens
 * simply yields one anchor per token run, and a URL inside a single token
 * yields one anchor inside that coloured span.
 */
export function linkifyCodeHast(tree: HastRoot): HastRoot {
  visit(tree, 'text', (node, index, parent) => {
    if (!parent || typeof index !== 'number') return undefined;
    if (parent.type === 'element' && (parent as HastElement).tagName === 'a') return undefined;
    const segments = splitCodeUrls(node.value);
    if (segments.length === 1 && segments[0].url === undefined) return undefined;
    const replacement: HastContent[] = segments.map((seg) =>
      seg.url === undefined
        ? { type: 'text', value: seg.value }
        : {
            type: 'element',
            tagName: 'a',
            properties: { href: seg.url },
            children: [{ type: 'text', value: seg.value }],
          },
    );
    parent.children.splice(index, 1, ...replacement);
    return index + replacement.length;
  });
  return tree;
}
