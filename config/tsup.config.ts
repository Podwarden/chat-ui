import { defineConfig } from 'tsup';
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'contract/index': 'src/contract/index.ts',
    'adapters/http': 'src/adapters/http.ts',
    'conformance/index': 'src/conformance/index.ts',
    // Side-effect-only module carrying `import 'katex/dist/katex.min.css'`.
    // It is an entry so the import lands at the stable path
    // `dist/theme/katex.js` that package.json's `sideEffects` can name; see
    // src/theme/katex.ts for why the bare import could not stay in markdown.tsx.
    'theme/katex': 'src/theme/katex.ts',
  },
  format: ['esm'], dts: true, sourcemap: true, clean: true, splitting: true, treeshake: true,
  // `vitest` is a devDependency here, so tsup would otherwise INLINE the whole
  // runner into dist/conformance/index.js (587 KB of it). The conformance entry
  // imports `describe`/`it`/`expect` from it and the host running the suite
  // always has vitest itself — hence external, plus the optional
  // peerDependency in package.json that says so.
  //
  // `katex/dist/katex.min.css` is external for a different reason: it must stay
  // a bare specifier in the output so the HOST's bundler resolves and loads it
  // (katex is a runtime dependency of this package, so it is on disk either
  // way). Bundling it here would need a CSS pipeline we do not have.
  external: ['react', 'react-dom', 'react/jsx-runtime', 'vitest', 'katex/dist/katex.min.css'],
});
