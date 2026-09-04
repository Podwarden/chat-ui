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
  test: { environment: 'jsdom', globals: true, setupFiles: ['tests/setup.ts'], include: ['tests/**/*.test.{ts,tsx}'], css: false },
});
