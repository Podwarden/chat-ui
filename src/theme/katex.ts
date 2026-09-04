/**
 * KaTeX's stylesheet, imported for its side effect and nothing else.
 *
 * The markdown renderer needs `katex/dist/katex.min.css` loaded for `$…$`
 * math to look like math, but a bare `import 'katex/dist/katex.min.css'`
 * sitting inside `markdown.tsx` is fragile: the host's bundler sees a module
 * whose exports are all unused and is entitled to drop the whole import along
 * with the stylesheet. `package.json`'s `sideEffects` list is the only way to
 * say "keep this one", and it matches on file paths — so the import needs a
 * file path of its own that survives the build. This module is that path
 * (`dist/theme/katex.js`, a tsup entry), listed in `sideEffects`.
 *
 * Hosts that would rather ship KaTeX's CSS themselves can mark this file
 * external / aliased to an empty module; nothing imports a value from it.
 */
import 'katex/dist/katex.min.css';
