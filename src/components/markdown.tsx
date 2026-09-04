'use client';

import { isValidElement, memo, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { PluggableList } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import '../theme/katex';
import { remarkAutolinkPolicy } from '../model/autolink';
import { normalizeMathDelimiters } from '../model/math-delimiters';
import { linkifyCode } from './linkify';
import { useOptionalAdapters } from '../adapters/context';
import {
  DEFAULT_ATTACHMENT_PATH_PREFIX,
  SANITIZE_SCHEMA,
  rehypeChat2Policy,
  rehypeSafeMathSource,
  rehypeStashImgSrc,
} from '../model/sanitize-schema';
import { CodeBlock } from './code-block';

/**
 * The single place react-markdown is imported.
 *
 * The `rehypePlugins` order is load-bearing and is the contract documented in
 * `sanitize-schema.ts`: raw → stash-img-src → sanitize → katex(trust:false) →
 * safe-math-source → chat2 policy. Sanitising *after* KaTeX would strip the
 * `<span class="katex">` tree it just produced; sanitising before it means the
 * schema must keep remark-math's `math-inline` / `math-display` classes.
 *
 * Shiki is deliberately NOT in this chain — fences are intercepted through the
 * `components` map and highlighted inside `<CodeBlock>`, which re-sanitises Shiki's
 * output with the same schema.
 */
const rehypePlugins = (attachmentPathPrefix: string): PluggableList => [
  rehypeRaw,
  rehypeStashImgSrc,
  [rehypeSanitize, SANITIZE_SCHEMA],
  [rehypeKatex, { trust: false, throwOnError: false }],
  rehypeSafeMathSource,
  [rehypeChat2Policy, { attachmentPathPrefix }],
];

/**
 * `remarkGfm` is what makes a bare `https://…` in model output clickable (GFM
 * autolink literals) — it is also what keeps a URL inside inline code, a fence,
 * an existing `[label](url)` or an `<https://…>` autolink from being re-linked.
 * `remarkAutolinkPolicy` runs after it and only patches the two cases where
 * GFM's result is wrong for us (a mixed-case scheme that the sanitizer would
 * strip the href off, and a `>` swallowed into the href); see `model/autolink.ts`.
 */
const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkAutolinkPolicy, remarkMath];

/**
 * A fence's `children` is not always a single string — a highlight/emphasis inside
 * the fence, or a stream that split mid-token, arrives as an array of strings and
 * elements, and `String(children)` would turn that into `"a,[object Object]"`.
 * Walk it instead.
 */
function childrenToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join('');
  if (isValidElement(node)) {
    return childrenToText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

const COMPONENTS: Components = {
  // Fences are rendered by <CodeBlock>; unwrap the <pre> so the block isn't
  // double-wrapped.
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const match = /language-([\w#+.-]+)/.exec(className ?? '');
    if (!match) {
      // GFM leaves a URL inside inline code as text; we link it anyway — the
      // agent writes an approval URL as code because it is meant to be used.
      // Styling is untouched, and `linkifyCode` only ever emits `http(s)` hrefs.
      return (
        <code className="rounded-[0.25rem] bg-chat-surface-2 px-1 text-chat-accent [&_a]:underline">
          {linkifyCode(children)}
        </code>
      );
    }
    return <CodeBlock code={childrenToText(children).replace(/\n$/, '')} lang={match[1]} />;
  },
};

/**
 * Memoised on `{text, streaming}` — react-markdown re-parses the whole document on
 * every render, so without this every SSE frame would re-parse every sibling
 * message (renderer-decision doc, finding 1).
 */
export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming: boolean }) {
  // The image-src allowlist is the host's own attachment route, not a constant:
  // `adapters.id` is the chat backend's base URL (`/api/chat2` for vLLM Warden,
  // `/api/v1/warden/{instance}/chat2` for the Hub), and `storage.attachmentUrl`
  // hands back URLs under `${id}/attachments/`. Hard-coding the vLLM Warden path
  // here silently dropped every inline attachment image on any other host.
  //
  // Optional, not required: <Markdown> is a public building block a host may
  // render on its own (a stored transcript, a preview), and outside an
  // <AdaptersProvider> the package default is the correct answer rather than a
  // crash.
  const adapters = useOptionalAdapters();
  const prefix = adapters ? `${adapters.id}/attachments/` : DEFAULT_ATTACHMENT_PATH_PREFIX;
  const plugins = useMemo(() => rehypePlugins(prefix), [prefix]);
  // LaTeX-style \[ \] / \( \) math delimiters → $-forms remark-math can parse
  // (see model/math-delimiters.ts). Raw-text rewrite, so it happens before the
  // markdown parse; memoised with the same reasoning as the parse itself.
  const normalized = useMemo(() => normalizeMathDelimiters(text), [text]);
  return (
    <div
      data-streaming={streaming ? 'true' : undefined}
      className="chat2-md max-w-none text-[14px] leading-relaxed text-chat-fg [&_a]:text-chat-accent-strong [&_a:hover]:text-chat-accent [&_blockquote]:border-l-2 [&_blockquote]:border-chat-rule [&_blockquote]:pl-3 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-chat-rule [&_td]:px-2 [&_th]:border [&_th]:border-chat-rule [&_th]:px-2 [&_ul]:list-disc [&_ul]:pl-5"
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={plugins} components={COMPONENTS}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
});
