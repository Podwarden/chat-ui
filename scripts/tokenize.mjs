#!/usr/bin/env node
/**
 * One-shot codemod: rewrite the literal Tailwind palette classes in `src/**`
 * to the semantic `chat-*` tokens defined by `src/theme/theme.css` and
 * `tailwind-preset.cjs` (spec §4.1–4.2).
 *
 * Kept in the repo as the record of the exact mapping that was applied, and so
 * the same pass can be re-run over new code. It is idempotent: the semantic
 * names it writes are never themselves inputs of the table.
 *
 * Matching rules:
 *  - word-boundary-ish lookaround (`[\w-]`) so `text-slate-500` can never be
 *    hit inside `text-slate-50` and `bg-slate-900` can never be hit inside
 *    `ring-offset-slate-900`;
 *  - variant prefixes (`hover:`, `focus-visible:`, `disabled:`, `group-hover:`,
 *    arbitrary `[&_a]:` …) fall out for free — `:` is not `[\w-]`;
 *  - `/NN` opacity suffixes are preserved because the table keys stop before
 *    the slash: `bg-slate-900/50` → `bg-chat-surface/50`.
 *
 * Usage:
 *   node scripts/tokenize.mjs           # rewrite src/ in place, print counts
 *   node scripts/tokenize.mjs --dry-run # report only, touch nothing
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DRY = process.argv.includes('--dry-run');

/** literal → semantic. Keys carry no `/NN` suffix; suffixes survive the swap. */
const MAPPING = [
  // surfaces
  ['bg-slate-950', 'bg-chat-page'],
  ['bg-black', 'bg-chat-page'],
  ['bg-slate-900', 'bg-chat-surface'],
  ['ring-offset-slate-900', 'ring-offset-chat-surface'],
  ['bg-slate-800', 'bg-chat-surface-2'],
  ['bg-slate-700', 'bg-chat-surface-2'],
  ['bg-slate-600', 'bg-chat-dim'],
  ['bg-slate-500', 'bg-chat-dim'],
  // rules
  ['border-slate-800', 'border-chat-rule'],
  ['border-slate-700', 'border-chat-rule'],
  ['border-slate-600', 'border-chat-rule'],
  // foreground
  ['text-slate-100', 'text-chat-fg'],
  ['text-slate-200', 'text-chat-fg'],
  // NOTE: `text-white` defaults to `text-chat-fg`, but any site whose text sits ON a
  // coloured fill (bg-chat-{accent,accent-strong,user,negative,warn}) wants
  // `text-chat-on-accent` instead — chat-fg goes dark in a light theme. Re-check by
  // hand after a re-run; the three known sites are already on-accent.
  ['text-white', 'text-chat-fg'],
  ['text-slate-300', 'text-chat-muted'],
  ['text-slate-400', 'text-chat-muted'],
  ['text-slate-500', 'text-chat-dim'],
  // accents
  ['text-emerald-300', 'text-chat-accent'],
  ['text-emerald-400', 'text-chat-accent-strong'],
  ['bg-emerald-600', 'bg-chat-user'],
  ['bg-emerald-500', 'bg-chat-accent-strong'],
  ['ring-emerald-500', 'ring-chat-accent'],
  ['ring-emerald-400', 'ring-chat-accent'],
  // warnings
  ['text-amber-500', 'text-chat-warn'],
  ['bg-amber-500', 'bg-chat-warn'],
  ['border-amber-500', 'border-chat-warn'],
  // negatives
  ['text-red-400', 'text-chat-negative'],
  ['text-red-300', 'text-chat-negative'],
  ['bg-red-600', 'bg-chat-negative'],
  ['bg-red-500', 'bg-chat-negative'],
  ['bg-rose-500', 'bg-chat-negative'],
  ['bg-red-950', 'bg-chat-negative-dim'],
  ['border-red-500', 'border-chat-negative'],
];

/** Longest key first: leftmost-first alternation must not settle for a prefix. */
const KEYS = [...MAPPING].sort((a, b) => b[0].length - a[0].length).map(([k]) => k);
const TABLE = new Map(MAPPING);
const RE = new RegExp(`(?<![\\w-])(${KEYS.join('|')})(?![\\w-])`, 'g');

/** The coverage check: anything palette-shaped the table did not claim. */
const LITERAL =
  /(?:bg|text|border|ring|ring-offset|from|to|via|placeholder|divide|outline|fill|stroke|shadow|decoration|caret|accent)-(?:slate|emerald|amber|red|rose|zinc|gray|neutral|sky|blue|green|yellow|orange|white|black)(?:-\d{1,3})?(?![\w-])/g;

const walk = (d) =>
  readdirSync(d).flatMap((f) => {
    const p = path.join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });

const counts = new Map();
const touched = [];

for (const file of walk(SRC)) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(RE, (m) => {
    counts.set(m, (counts.get(m) ?? 0) + 1);
    return TABLE.get(m);
  });
  if (after !== before) {
    touched.push(path.relative(ROOT, file));
    if (!DRY) writeFileSync(file, after);
  }
}

let total = 0;
console.log('literal -> semantic                                   count');
for (const [literal, semantic] of MAPPING) {
  const n = counts.get(literal) ?? 0;
  total += n;
  console.log(`${`${literal} -> ${semantic}`.padEnd(52)} ${n}`);
}
console.log(`${'TOTAL'.padEnd(52)} ${total}`);
console.log(`\n${touched.length} file(s) ${DRY ? 'would change' : 'changed'}`);

const leftovers = walk(SRC).flatMap((file) =>
  (DRY ? readFileSync(file, 'utf8').replace(RE, (m) => TABLE.get(m)) : readFileSync(file, 'utf8'))
    .split('\n')
    .flatMap((line, i) => (line.match(LITERAL) ?? []).map((hit) => `${path.relative(ROOT, file)}:${i + 1}: ${hit}`)),
);
if (leftovers.length) {
  console.log(`\nUNMAPPED literals still present (${leftovers.length}):`);
  for (const l of leftovers) console.log(`  ${l}`);
  process.exitCode = 1;
} else {
  console.log('\nNo literal palette classes remain in src/.');
}
