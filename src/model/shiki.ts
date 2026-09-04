/**
 * Lazy Shiki singleton for chat2 code fences.
 *
 * Per the renderer decision doc (docs/superpowers/specs/2026-08-23-chat2-renderer-decision.md
 * §5): use `shiki/core` + the JavaScript RegExp engine + explicit `@shikijs/langs/*`
 * subpath imports. The naive `import('shiki')` route drags in the full grammar map
 * *and* the ~231 kB gz oniguruma WASM chunk. Everything here is behind a dynamic
 * import so nothing Shiki-shaped lands in first-load JS.
 *
 * NOTE: this module deliberately does NOT import the sanitizer — `sanitize-schema.ts`
 * pulls the highlighter in (dynamically) for its test-only helper, and a static edge
 * in both directions would be a cycle.
 */
import type { HighlighterCore } from 'shiki/core';

/** The 15-grammar subset. Canonical ids — `@shikijs/langs` subpaths are not aliased. */
export const SHIKI_LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'json',
  'python',
  'bash',
  'yaml',
  'sql',
  'diff',
  'markdown',
  'html',
  'css',
  'go',
  'rust',
  'toml',
] as const;

export type ShikiLang = (typeof SHIKI_LANGS)[number];
export type ShikiTheme = 'github-light' | 'github-dark';

/** Fence-info aliases → canonical grammar id. Anything unknown falls back to `markdown`. */
const LANG_ALIASES: Record<string, ShikiLang> = {
  ts: 'typescript',
  typescript: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  jsx: 'tsx',
  js: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  json: 'json',
  jsonc: 'json',
  py: 'python',
  python: 'python',
  python3: 'python',
  sh: 'bash',
  shell: 'bash',
  bash: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  postgres: 'sql',
  psql: 'sql',
  diff: 'diff',
  patch: 'diff',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  text: 'markdown',
  txt: 'markdown',
  plaintext: 'markdown',
  html: 'html',
  xml: 'html',
  svg: 'html',
  vue: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  go: 'go',
  golang: 'go',
  rs: 'rust',
  rust: 'rust',
  toml: 'toml',
  ini: 'toml',
};

/** Map a markdown fence's info string onto a grammar we actually loaded. */
export function resolveLang(lang: string | undefined): ShikiLang {
  if (!lang) return 'markdown';
  return LANG_ALIASES[lang.trim().toLowerCase()] ?? 'markdown';
}

let highlighterP: Promise<HighlighterCore> | null = null;

/** Module-level promise so the grammars/themes are fetched at most once per page. */
export function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterP) {
    highlighterP = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/javascript'),
      ]);
      return createHighlighterCore({
        themes: [
          import('@shikijs/themes/github-light'),
          import('@shikijs/themes/github-dark'),
        ],
        langs: [
          import('@shikijs/langs/typescript'),
          import('@shikijs/langs/tsx'),
          import('@shikijs/langs/javascript'),
          import('@shikijs/langs/json'),
          import('@shikijs/langs/python'),
          import('@shikijs/langs/bash'),
          import('@shikijs/langs/yaml'),
          import('@shikijs/langs/sql'),
          import('@shikijs/langs/diff'),
          import('@shikijs/langs/markdown'),
          import('@shikijs/langs/html'),
          import('@shikijs/langs/css'),
          import('@shikijs/langs/go'),
          import('@shikijs/langs/rust'),
          import('@shikijs/langs/toml'),
        ],
        engine: createJavaScriptRegexEngine(),
      });
    })();
  }
  return highlighterP;
}

/** Test seam: drop the memoised highlighter (used by the component test's Shiki mock). */

/**
 * The highlighter once it has finished loading, else null. Lets `CodeBlock`
 * highlight synchronously during streaming (Shiki's `codeToHast` is sync on a
 * loaded highlighter) so a re-parse never shows an unhighlighted frame.
 */
let loadedHighlighter: HighlighterCore | null = null;
export function getLoadedHighlighter(): HighlighterCore | null {
  if (!loadedHighlighter) {
    void getHighlighter().then((h) => { loadedHighlighter = h; }).catch(() => undefined);
  }
  return loadedHighlighter;
}

export function __resetHighlighter(): void {
  loadedHighlighter = null;
  highlighterP = null;
}
