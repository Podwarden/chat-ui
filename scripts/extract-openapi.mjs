#!/usr/bin/env node
// usage: node scripts/extract-openapi.mjs <path-to-vllm-warden-openapi.json>
import { readFileSync, writeFileSync } from 'node:fs';
const src = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const paths = Object.fromEntries(Object.entries(src.paths).filter(([p]) => p.startsWith('/api/chat2/')));
const used = new Set();
const walk = (o) => { if (o && typeof o === 'object') { if (typeof o.$ref === 'string') used.add(o.$ref.split('/').pop()); Object.values(o).forEach(walk); } };
walk(paths);
let size = -1; while (size !== used.size) { size = used.size; for (const n of [...used]) walk(src.components.schemas[n]); }
const schemas = Object.fromEntries([...used].sort().map((n) => [n, src.components.schemas[n]]));
const out = { openapi: src.openapi, info: { title: '@podwarden/chat-ui contract', version: '1.0' }, paths, components: { schemas } };
writeFileSync('src/contract/openapi.chat.json', JSON.stringify(out, null, 2) + '\n');
console.log(Object.keys(paths).length, 'paths,', used.size, 'schemas');
