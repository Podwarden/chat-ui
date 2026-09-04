#!/usr/bin/env node
/**
 * Two fix-ups tsup cannot express, run over `dist/` after every build.
 *
 * 1. KATEX SIDE-EFFECT MODULE.
 *    `src/theme/katex.ts` exists so `import 'katex/dist/katex.min.css'` has a
 *    stable file path that `package.json`'s `sideEffects` can name — a host
 *    bundler is otherwise entitled to drop a module whose exports are all
 *    unused, stylesheet and all. But esbuild's code splitting hoists a module
 *    reachable from two entry points into a hashed shared chunk, so the import
 *    lands in `dist/chunk-XXXX.js`, which no `sideEffects` glob can match.
 *    This step folds that chunk back into `dist/theme/katex.js` and repoints
 *    its importers there. It fails the build if the import goes missing.
 *
 * 2. `'use client'`.
 *    esbuild strips directives out of source modules, and a tsup `banner`
 *    applies to EVERY entry — which would wrongly mark `contract`,
 *    `adapters/http` and `conformance` (React-free, all importable from a
 *    server component) as client modules. So the directive is stamped here,
 *    precisely: on `dist/index.js`, and on every chunk that itself imports
 *    react / react-dom / react/jsx-runtime, because with `splitting: true`
 *    that is where the component code actually lives. It then asserts no
 *    React-free entry reaches a stamped file through its import graph.
 *
 * Source maps are kept honest: the directive adds exactly one line, so a
 * leading `;` (an empty line group) is spliced onto the `mappings` string.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');
const DIRECTIVE = "'use client';";
const KATEX_CSS = 'katex/dist/katex.min.css';
const KATEX_MODULE = join(DIST, 'theme/katex.js');

/** Entries that must stay free of the directive (they contain no React). */
const SERVER_SAFE_ENTRIES = [
  'contract/index.js',
  'adapters/http.js',
  'conformance/index.js',
  'theme/katex.js',
];

const REACT_IMPORT = /['"](?:react|react-dom|react\/jsx-runtime|react-dom\/client)['"]/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Specifiers of every static import / export-from in `code`. */
function importsOf(code) {
  const specs = [];
  const re = /(?:^|[\s;}])(?:import|export)\s*(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code)) !== null) specs.push(m[1]);
  return specs;
}

/** `./theme/katex.js`-shaped specifier pointing from `from` at `to`. */
function specifierFor(from, to) {
  const rel = relative(dirname(from), to).split('\\').join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function fail(message) {
  console.error(`postbuild: ${message}`);
  process.exit(1);
}

if (!existsSync(DIST)) fail(`${DIST} does not exist — run the build first.`);
if (!existsSync(join(DIST, 'index.js'))) {
  fail(`${join(DIST, 'index.js')} does not exist — tsup did not emit the React entry.`);
}

// --- 1. katex ---------------------------------------------------------------
{
  const files = walk(DIST);
  const carriers = files.filter((f) => readFileSync(f, 'utf8').includes(KATEX_CSS));
  if (carriers.length === 0) {
    fail(`no built file imports '${KATEX_CSS}' — the stylesheet was tree-shaken away.`);
  }
  if (carriers.length > 1) {
    fail(`'${KATEX_CSS}' is imported from ${carriers.length} files (${carriers
      .map((f) => relative(DIST, f))
      .join(', ')}); expected exactly one.`);
  }
  const carrier = carriers[0];
  if (carrier !== KATEX_MODULE) {
    const body = readFileSync(carrier, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('//#'))
      .join('\n')
      .trim();
    if (body !== `import '${KATEX_CSS}';` && body !== `import "${KATEX_CSS}";`) {
      fail(
        `expected ${relative(DIST, carrier)} to hold nothing but the katex CSS import, ` +
          `found:\n${body}`,
      );
    }
    writeFileSync(KATEX_MODULE, `import '${KATEX_CSS}';\n`);
    rmSync(`${KATEX_MODULE}.map`, { force: true });
    for (const file of files) {
      if (file === carrier) continue;
      const src = readFileSync(file, 'utf8');
      const spec = specifierFor(file, carrier);
      if (!src.includes(spec)) continue;
      writeFileSync(file, src.split(spec).join(specifierFor(file, KATEX_MODULE)));
    }
    rmSync(carrier, { force: true });
    rmSync(`${carrier}.map`, { force: true });
    console.log(
      `postbuild: folded ${relative(DIST, carrier)} into theme/katex.js (katex CSS side effect)`,
    );
  }

  // The module existing is not the point — the React entry PULLING IT IN is.
  // `theme/katex` is also a tsup entry, and entry points are never dropped, so
  // `dist/theme/katex.js` gets written even when esbuild has discarded the
  // import from markdown.tsx. That is exactly what happens if package.json's
  // `sideEffects` fails to name the SOURCE path `src/theme/katex.ts`: esbuild
  // logs `[ignored-bare-import]`, the stylesheet silently stops loading, and
  // every file this script checks still looks right. Assert the edge itself.
  const entry = readFileSync(join(DIST, 'index.js'), 'utf8');
  const edge = `./${relative(DIST, KATEX_MODULE).split('\\').join('/')}`;
  if (!entry.includes(`'${edge}'`) && !entry.includes(`"${edge}"`)) {
    fail(
      `index.js does not import '${edge}' — the katex stylesheet is not reachable from the ` +
        `React entry. esbuild drops that import unless package.json's "sideEffects" names ` +
        `the source path src/theme/katex.ts; check for an [ignored-bare-import] warning above.`,
    );
  }
}

// --- 2. 'use client' --------------------------------------------------------
const files = walk(DIST);
const code = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

const targets = new Set([join(DIST, 'index.js')]);
for (const [file, src] of code) {
  if (REACT_IMPORT.test(src)) targets.add(file);
}

for (const entry of SERVER_SAFE_ENTRIES) {
  const start = join(DIST, entry);
  if (!existsSync(start)) continue;
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (targets.has(file)) {
      fail(
        `${entry} reaches ${relative(DIST, file)}, which carries React — a React-free ` +
          `entry must not become a client module. Check the tsup entry graph.`,
      );
    }
    for (const spec of importsOf(code.get(file) ?? '')) {
      if (!spec.startsWith('.')) continue;
      const next = resolve(dirname(file), spec);
      if (code.has(next)) queue.push(next);
    }
  }
}

const stamped = [];
for (const file of [...targets].sort()) {
  const src = code.get(file) ?? readFileSync(file, 'utf8');
  if (src.startsWith(DIRECTIVE) || src.startsWith('"use client";')) continue;
  writeFileSync(file, `${DIRECTIVE}\n${src}`);
  stamped.push(relative(DIST, file));

  const map = `${file}.map`;
  if (!existsSync(map)) continue;
  const json = JSON.parse(readFileSync(map, 'utf8'));
  if (typeof json.mappings === 'string') {
    json.mappings = `;${json.mappings}`;
    writeFileSync(map, JSON.stringify(json));
  }
}

console.log(`postbuild: 'use client' on ${stamped.length} file(s): ${stamped.join(', ') || '(none)'}`);
