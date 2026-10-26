import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// This config lives in config/, but every path in it — the `@` alias, the
// setup file, the test glob — is written relative to the REPO root. Vite
// defaults `root` to the config file's own directory, which would resolve
// them against config/ and find nothing, so pin it explicitly.
const root = path.resolve(__dirname, '..');

export default defineConfig({
  root,
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  // testTimeout: the component tests drive whole flows (render, load, type,
  // stream, open dialogs) and take 1–3 s on a quiet machine; the shared CI
  // runner under load doubled that and the 5 s default failed them on time
  // alone (2026-10-26). A hung test still fails, just later.
  test: { environment: 'jsdom', globals: true, setupFiles: ['tests/setup.ts'], include: ['tests/**/*.test.{ts,tsx}'], css: false, testTimeout: 15_000 },
});
