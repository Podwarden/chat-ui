/**
 * chat2 sanitizer — spec §6. ONE schema; KaTeX and Shiki output pass through it too.
 *
 * Pipeline contract (identical in `<Markdown>` and in `sanitizeHtmlForTest`):
 *
 *   rehype-raw  →  rehypeStashImgSrc  →  rehype-sanitize(SANITIZE_SCHEMA)
 *               →  rehype-katex({trust: false})  →  rehypeSafeMathSource
 *               →  rehypeChat2Policy
 *
 * Why that order:
 *  - `rehype-raw` must run first or inline HTML (`<b onclick>`, `<img src>`) never
 *    becomes elements and the sanitizer has nothing to sanitize.
 *  - the sanitizer must run BEFORE `rehype-katex`: running it after strips the
 *    `<span class="katex">` / MathML tree KaTeX just produced (renderer-decision
 *    doc, finding 4A). The schema therefore has to keep remark-math's
 *    `math-inline` / `math-display` classes intact so KaTeX can still find the
 *    nodes. KaTeX's own output is not re-sanitized — `trust: false` is what makes
 *    that safe (it disables `\href`, `\url`, `\includegraphics`, `\htmlClass`, …).
 *  - `rehypeStashImgSrc` + `rehypeChat2Policy` bracket the sanitizer because
 *    `hast-util-sanitize` cannot express "this `data:` URL yes, that one no".
 *    The schema drops `src` outright; the policy plugin re-admits only the
 *    sources `isAllowedImageSrc` approves.
 */
import { defaultSchema, type Schema } from 'hast-util-sanitize';
import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';
import { DATA_URL_MAX_BYTES } from './limits';

/**
 * The attachment route this package was extracted from. It is only a DEFAULT:
 * a host mounts the chat backend wherever it likes (PodWarden Hub serves it at
 * `/api/v1/warden/{instance}/chat2/…`), and an image whose src does not match
 * the host's own route is dropped by `rehypeChat2Policy`. `<Markdown>` therefore
 * derives the prefix from `useOptionalAdapters().id` rather than using this
 * constant.
 */
export const DEFAULT_ATTACHMENT_PATH_PREFIX = '/api/chat2/attachments/';

/** Options every factory in this module accepts. */
export interface SanitizeOptions {
  /**
   * Absolute path prefix of the host's attachment route, INCLUDING the trailing
   * slash — e.g. `/api/v1/warden/chat2/attachments/`. Only same-origin absolute
   * paths under it are admitted; the id segment after it stays `[A-Za-z0-9_-]+`.
   * This is a literal string prefix match on `src`, not a same-origin check
   * performed by this code: `<Markdown>` derives it from
   * `useOptionalAdapters().id`, and if that adapter's `baseUrl` is itself
   * absolute (a scheme + host, not just a path), the prefix carries that origin
   * too — so an absolute `baseUrl` admits image srcs from that specific
   * origin's attachment path, not only the page's own origin.
   */
  attachmentPathPrefix?: string;
}

const RASTER_DATA_SRC = /^data:image\/(png|jpeg|webp);base64,/i;

/** The prefix is host configuration, not a pattern — quote it before it becomes one. */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Images are allowed from exactly two places: our own signed attachment route and
 * an inline base64 raster. Remote `http(s)` images are a no-click exfiltration
 * beacon under prompt injection, and `image/svg+xml` is a script container, not a
 * raster — both are rejected.
 *
 * The 2 MB cap is applied to the *URL text* (that is what the fixture asserts, and
 * it is the number that actually bounds what we splice into the DOM).
 *
 * Returned as a closure so the route pattern is compiled once per policy rather
 * than once per `<img>`.
 */
export function createImageSrcPolicy(
  attachmentPathPrefix: string = DEFAULT_ATTACHMENT_PATH_PREFIX,
): (src: string) => boolean {
  const attachmentSrc = new RegExp(`^${escapeRegExp(attachmentPathPrefix)}[A-Za-z0-9_-]+(\\?.*)?$`);
  return (src: string): boolean => {
    if (attachmentSrc.test(src)) return true;
    if (RASTER_DATA_SRC.test(src)) return src.length <= DATA_URL_MAX_BYTES;
    return false;
  };
}

const defaultImageSrcPolicy = createImageSrcPolicy();

export function isAllowedImageSrc(src: string, attachmentPathPrefix?: string): boolean {
  return attachmentPathPrefix === undefined
    ? defaultImageSrcPolicy(src)
    : createImageSrcPolicy(attachmentPathPrefix)(src);
}

/**
 * Class names are not merely cosmetic here: this app is Tailwind, so an attacker
 * controlling `class` controls layout (`fixed inset-0 z-50 …` is a full-page
 * overlay). Only the classes our own pipeline emits survive.
 */
const ALLOWED_CLASS =
  /^(math|math-inline|math-display|language-[\w#+.-]{1,32}|shiki|line|github-light|github-dark|contains-task-list|task-list-item|footnotes|sr-only|data-footnote-backref)$/;

export const SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  tagNames: [
    'p', 'br', 'hr', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'sub', 'sup', 'mark', 'small', 'kbd', 'abbr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'pre', 'code', 'a', 'img', 'span', 'div', 'details', 'summary', 'input', 'section',
    // KaTeX (MathML + HTML output)
    'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'msubsup', 'mfrac', 'msqrt',
    'mroot', 'mtext', 'mspace', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'annotation',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [['className', ALLOWED_CLASS], 'id', 'ariaHidden', 'title', 'lang', 'dir'],
    a: ['href', 'title', 'ariaLabel'],
    // NOTE: no `src` — `rehypeStashImgSrc` parks it on `dataChat2Src` and
    // `rehypeChat2Policy` puts back only what `isAllowedImageSrc` approves.
    img: ['alt', 'title', 'width', 'height', 'dataChat2Src'],
    code: [['className', ALLOWED_CLASS]],
    pre: [['className', ALLOWED_CLASS], 'tabIndex'],
    span: [['className', ALLOWED_CLASS], 'style', 'ariaHidden'], // Shiki colours + KaTeX layout spans
    // GFM task lists only — a value-restricted `type` means anything that is not a
    // checkbox loses the attribute and is then forced back to one by `required`.
    input: [['type', 'checkbox'], 'checked', 'disabled'],
    td: ['align'],
    th: ['align'],
    math: ['xmlns', 'display'],
    annotation: ['encoding'],
  },
  protocols: { ...defaultSchema.protocols, href: ['http', 'https', 'mailto'], src: [] },
  clobberPrefix: 'md-',
  // Removed *with* their content, not unwrapped.
  //
  // THREAT-MODEL NOTE on `svg`: KaTeX emits its own `<svg>` for stretchy delimiters,
  // `\sqrt` and arrows, and that output is produced AFTER this schema runs (see the
  // header — sanitising before KaTeX is the only order that renders math at all), so
  // it is not covered by this entry. That is deliberate and bounded: the SVG is
  // generated by the KaTeX library from a fixed set of glyph paths, never from model
  // text. Model text reaches KaTeX only as TeX source, where `trust: false` refuses
  // every command that can inject markup or URLs (`\href`, `\url`,
  // `\includegraphics`, `\htmlClass`, `\htmlData`, …) and `rehypeSafeMathSource`
  // scrubs what survives into the MathML annotation. So the residual exposure here
  // is "a KaTeX code-execution bug", not "a prompt-injection vector".
  strip: [
    'script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'video', 'audio',
    'source', 'track', 'link', 'meta', 'base', 'template', 'noscript', 'textarea', 'select', 'option',
  ],
  required: { ...defaultSchema.required, input: { type: 'checkbox', disabled: true } },
};

/**
 * Inline styles we tolerate on `<span>`: Shiki's per-token colours plus the
 * geometry KaTeX needs to lay glyphs out. Deliberately excluded: anything that can
 * reposition or repaint the page (`position`, `z-index`, `display`, `transform`,
 * `background-image`, `content`, …).
 */
const SAFE_STYLE_PROPS = new Set([
  'color', 'background-color', 'font-style', 'font-weight', 'font-size', 'text-decoration',
  'height', 'min-height', 'width', 'min-width', 'max-width', 'line-height', 'vertical-align',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'top', 'right', 'bottom', 'left', 'text-align', 'white-space',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
]);

const SAFE_STYLE_VALUE = /^[#a-z0-9(),.\s%_+/-]+$/i;

function filterStyle(style: string): string {
  return style
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => {
      const colon = decl.indexOf(':');
      if (colon < 1) return false;
      const prop = decl.slice(0, colon).trim().toLowerCase();
      const value = decl.slice(colon + 1).trim();
      if (!SAFE_STYLE_PROPS.has(prop)) return false;
      if (!SAFE_STYLE_VALUE.test(value)) return false;
      return !/url\(|expression\(|javascript:/i.test(value);
    })
    .join(';');
}

/**
 * Placeholder base for resolving relative hrefs. It is never emitted — it only lets
 * `new URL()` normalise a relative href so we can inspect its scheme, and lets us
 * recognise "resolved to our own origin".
 */
const LINK_BASE = 'https://chat2.invalid/';
const LINK_BASE_HOST = 'chat2.invalid';
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** `//host`, `\\host`, `/\host`, `\/host` — every form a browser reads as scheme-relative. */
const SCHEME_RELATIVE = /^[\\/]{2}/;

interface ResolvedHref {
  /** The cleaned href to emit. */
  href: string;
  /** Host to show in the true-host hint, or null (mailto, or same-origin relative). */
  host: string | null;
  /** In-page anchor: keep the href, but do not send it to a new tab. */
  fragmentOnly: boolean;
}

/**
 * `hast-util-sanitize`'s `protocols.href` allowlist only inspects the scheme it can
 * see, so it treats `//evil.test/x` and `\\evil.test\x` as *relative* and lets them
 * through — they are live cross-origin links in a browser. Resolve the href for
 * real, and derive the host hint from the resolved URL rather than from the raw
 * string (which is why the old `hostOf(href)` returned null and silently skipped the
 * hint on exactly these).
 */
function resolveHref(raw: string): ResolvedHref | null {
  // Control characters (incl. the `java\nscript:` trick) are dropped by browsers
  // before parsing, so drop them before we parse too.
  const href = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!href) return null;
  if (SCHEME_RELATIVE.test(href) || href.startsWith('\\')) return null;

  let url: URL;
  try {
    url = new URL(href, LINK_BASE);
  } catch {
    return null;
  }
  if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol)) return null;

  const sameOrigin = url.host === LINK_BASE_HOST && !/^https?:/i.test(href);
  return {
    href,
    host: url.protocol === 'mailto:' || sameOrigin ? null : url.host,
    fragmentOnly: href.startsWith('#'),
  };
}

/** The host a *link text* points at, but only when the text really is an absolute URL. */
function textHost(text: string): string | null {
  const value = text.trim();
  if (SCHEME_RELATIVE.test(value)) {
    try {
      return new URL(`https://${value.replace(SCHEME_RELATIVE, '')}`).host || null;
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(value);
    return url.protocol === 'mailto:' ? null : url.host || null;
  } catch {
    return null;
  }
}

/**
 * Runs BEFORE `rehype-sanitize`: stash the raw src where the sanitizer's protocol
 * checks cannot see it, so the policy plugin gets to decide. This is the only way
 * to allow a `data:` scheme selectively with `hast-util-sanitize`.
 */
export function rehypeStashImgSrc() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName === 'img' && typeof node.properties?.src === 'string') {
        node.properties.dataChat2Src = node.properties.src;
        delete node.properties.src;
      }
    });
  };
}

const UNSAFE_TEX_SCHEME = /(?:javascript|vbscript|data)\s*:/gi;

/**
 * The trust-gated KaTeX commands that take a URL argument. `trust: false` refuses to
 * *render* these, but the argument still reaches the MathML annotation verbatim.
 */
const TRUST_GATED_TEX = /\\(href|url|includegraphics)\s*(\[[^\]]*\])?\s*\{([^}]*)\}/gi;

function scrubTexAnnotation(source: string): string {
  return source.replace(TRUST_GATED_TEX, (whole, command, optional, argument: string) => {
    const scrubbed = argument.replace(UNSAFE_TEX_SCHEME, '[blocked]');
    return scrubbed === argument ? whole : `\\${command}${optional ?? ''}{${scrubbed}}`;
  });
}

/** hast property names for the raw attribute names Shiki hand-builds. */
const RAW_PROP_NAMES: Record<string, string> = { class: 'className', tabindex: 'tabIndex' };

/**
 * Shiki's `codeToHast` hand-builds hast with *raw HTML attribute* names (`class`,
 * `tabindex`) rather than hast property names (`className`, `tabIndex`). The schema
 * keys off property names, so without this every Shiki class and the `tabindex`
 * would be silently dropped — making the `shiki` / `line` / `github-*` entries in
 * `ALLOWED_CLASS` and `pre.tabIndex` dead code, and `.line` unstyleable.
 * Normalise before sanitising so the allowlist actually does its job.
 */
export function normalizeRawHastProps(tree: Root): Root {
  visit(tree, 'element', (node: Element) => {
    if (!node.properties) return;
    for (const [raw, prop] of Object.entries(RAW_PROP_NAMES)) {
      if (!(raw in node.properties)) continue;
      const value = node.properties[raw];
      delete node.properties[raw];
      if (value === undefined || value === null) continue;
      node.properties[prop] =
        prop === 'className' && typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : value;
    }
  });
  return tree;
}

/**
 * Runs AFTER `rehype-katex`, immediately before `rehypeChat2Policy`.
 *
 * `trust: false` already refuses `\href` / `\url` / `\includegraphics`, but KaTeX
 * still echoes the *TeX source* verbatim into its MathML
 * `<annotation encoding="application/x-tex">`. That is inert markup, yet it means a
 * literal `javascript:…` payload lands in the DOM, and KaTeX's output is the one
 * part of the tree the sanitizer does not get to see (it has to run before KaTeX,
 * see the header).
 *
 * Scoped twice over: to the `<annotation>` node, and within it to the arguments of
 * trust-gated commands. An earlier version rewrote every colon-scheme in the whole
 * math *source* before KaTeX saw it, which corrupted innocent formulas —
 * `$\text{data: 42}$` became `\text{[blocked] 42}`. Rendered HTML, MathML and
 * ordinary TeX all come through untouched now.
 */
export function rehypeSafeMathSource() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'annotation') return;
      visit(node, 'text', (text) => {
        text.value = scrubTexAnnotation(text.value);
      });
    });
  };
}

/**
 * Runs AFTER `rehype-sanitize` (and after `rehype-katex`): image-src policy, link
 * hardening, the true-host hint from spec §6, and the inline-style whitelist —
 * which is also what guards KaTeX's un-re-sanitized output.
 *
 * THIS is the host-configurable half of the sanitizer, which is why the factory
 * lives here and not on the schema: `SANITIZE_SCHEMA` drops `src` unconditionally
 * (see the `img` entry) and so does not vary with the attachment route at all — a
 * `createSanitizeSchema(prefix)` would return the same object for every prefix and
 * quietly imply otherwise. Called with no options it keeps the historical
 * `/api/chat2/attachments/` default, so every existing call site is unchanged.
 */
export function rehypeChat2Policy(options: SanitizeOptions = {}) {
  const allowedImageSrc =
    options.attachmentPathPrefix === undefined
      ? defaultImageSrcPolicy
      : createImageSrcPolicy(options.attachmentPathPrefix);
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName === 'img') {
        const src = String(node.properties?.dataChat2Src ?? '');
        if (!allowedImageSrc(src)) {
          if (parent && typeof index === 'number') parent.children.splice(index, 1);
          return index;
        }
        node.properties = { ...node.properties, src, loading: 'lazy', decoding: 'async' };
        delete node.properties.dataChat2Src;
      }

      if (node.tagName === 'a' && node.properties?.href) {
        const resolved = resolveHref(String(node.properties.href));
        if (!resolved) {
          // Scheme-relative (`//evil.test`), backslash (`\\evil.test`) or a scheme the
          // sanitizer's string-level allowlist could not see. Leave the text, kill
          // the navigation.
          delete node.properties.href;
          delete node.properties.rel;
          delete node.properties.target;
          return undefined;
        }
        node.properties.href = resolved.href;
        if (resolved.fragmentOnly) {
          // In-page anchor — a new tab would just reload the app.
          delete node.properties.target;
          delete node.properties.rel;
        } else {
          node.properties.rel = ['noopener', 'noreferrer'];
          node.properties.target = '_blank';
        }
        // spec §6: when the visible text is itself a URL on a different host, show
        // the true host next to it. Both hosts come from *resolved* URLs.
        const text = node.children.map((c) => (c.type === 'text' ? c.value : '')).join('').trim();
        const shown = textHost(text);
        const real = resolved.host;
        if (shown && real && shown !== real) {
          node.children.push({
            type: 'element',
            tagName: 'span',
            properties: { className: ['text-chat-dim'] },
            children: [{ type: 'text', value: ` (${real})` }],
          });
        }
      }

      if (node.tagName === 'span' && typeof node.properties?.style === 'string') {
        const kept = filterStyle(node.properties.style);
        if (kept) node.properties.style = kept;
        else delete node.properties.style;
      }

      return undefined;
    });
  };
}

/**
 * Sanitize an already-built hast tree with the same schema + policy the markdown
 * pipeline uses. `code-block.tsx` runs Shiki's `codeToHast` output through this
 * before `dangerouslySetInnerHTML`.
 */
let sanitizeDeps: { sanitize: typeof import('hast-util-sanitize').sanitize; toHtml: typeof import('hast-util-to-html').toHtml } | null = null;

/** Kick the dynamic imports; resolves once `sanitizeHastToHtmlSync` can work. */
async function loadSanitizeDeps(): Promise<NonNullable<typeof sanitizeDeps>> {
  if (!sanitizeDeps) {
    const [{ sanitize }, { toHtml }] = await Promise.all([
      import('hast-util-sanitize'),
      import('hast-util-to-html'),
    ]);
    sanitizeDeps = { sanitize, toHtml };
  }
  return sanitizeDeps;
}

/**
 * Synchronous variant for streaming re-renders: returns null until the dynamic
 * imports have landed (call `sanitizeHastToHtml` once, or any prior render, to
 * warm them). Same schema + policy as the async path.
 */
export function sanitizeHastToHtmlSync(tree: Root, options: SanitizeOptions = {}): string | null {
  if (!sanitizeDeps) {
    void loadSanitizeDeps().catch(() => undefined);
    return null;
  }
  const clean = sanitizeDeps.sanitize(normalizeRawHastProps(tree), SANITIZE_SCHEMA) as Root;
  rehypeChat2Policy(options)(clean);
  return sanitizeDeps.toHtml(clean);
}

export async function sanitizeHastToHtml(tree: Root, options: SanitizeOptions = {}): Promise<string> {
  const { sanitize, toHtml } = await loadSanitizeDeps();
  const clean = sanitize(normalizeRawHastProps(tree), SANITIZE_SCHEMA) as Root;
  rehypeChat2Policy(options)(clean);
  return toHtml(clean);
}

/**
 * Test-only: the full pipeline as a string→string function, so the fixture suite in
 * `tests/contract/chat2/sanitize.test.ts` asserts against exactly the chain the
 * renderer uses. Every import is dynamic so none of this reaches the client bundle
 * (`<Markdown>` imports only the schema and the two plugins from this module).
 *
 * The one difference from `<Markdown>`: code fences are highlighted inline by a
 * miniature rehype-shiki here, whereas the component renders them through
 * `<CodeBlock>`. Both feed Shiki's output through this same schema — which is what
 * the Shiki fixture pins.
 */
export async function sanitizeHtmlForTest(markdown: string, options: SanitizeOptions = {}): Promise<string> {
  const [
    { unified },
    { default: remarkParse },
    { default: remarkGfm },
    { remarkAutolinkPolicy, linkifyCodeHast },
    { default: remarkMath },
    { default: remarkRehype },
    { default: rehypeRaw },
    { default: rehypeKatex },
    { default: rehypeSanitize },
    { default: rehypeStringify },
    shikiMod,
  ] = await Promise.all([
    import('unified'),
    import('remark-parse'),
    import('remark-gfm'),
    import('./autolink'),
    import('remark-math'),
    import('remark-rehype'),
    import('rehype-raw'),
    import('rehype-katex'),
    import('rehype-sanitize'),
    import('rehype-stringify'),
    import('./shiki'),
  ]);

  const highlighter = await shikiMod.getHighlighter();

  const rehypeShikiFixture = () => (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'pre' || !parent || typeof index !== 'number') return;
      const code = node.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
      if (!code) return;
      const classes = (code.properties?.className ?? []) as string[];
      // `mdast-util-math` renders display math as `<pre><code class="language-math
      // math-display">`, which looks exactly like a fence. Highlighting it would eat
      // the node before `rehype-katex` ever sees it — that is precisely how display
      // math went untested. Leave math alone.
      if (classes.some((c) => c === 'language-math' || c === 'math-display' || c === 'math-inline')) return;
      const info = classes.map((c) => /^language-(.+)$/.exec(c)?.[1]).find(Boolean);
      const source = code.children.map((c) => (c.type === 'text' ? c.value : '')).join('');
      // `<CodeBlock>` linkifies Shiki's tree before sanitising it (URLs in a
      // fence are clickable — see `model/autolink.ts`); do the same here or the
      // fixture stops describing what the component renders.
      const out = linkifyCodeHast(
        normalizeRawHastProps(
          highlighter.codeToHast(source.replace(/\n$/, ''), {
            lang: shikiMod.resolveLang(info),
            theme: 'github-dark',
          }) as Root,
        ),
      );
      parent.children.splice(index, 1, ...out.children);
      return index + out.children.length;
    });
  };

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkAutolinkPolicy)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeShikiFixture)
    .use(rehypeStashImgSrc)
    .use(rehypeSanitize, SANITIZE_SCHEMA)
    .use(rehypeKatex, { trust: false, throwOnError: false })
    .use(rehypeSafeMathSource)
    .use(rehypeChat2Policy, options)
    .use(rehypeStringify)
    .process(markdown);

  return String(file);
}
