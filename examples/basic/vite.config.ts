import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Nothing bespoke here on purpose: this app resolves `@podwarden/chat-ui`
// exactly the way a real consumer's bundler would (through `file:../..`'s
// `exports` map in package.json, i.e. `../../dist/index.js` — run
// `npm run build` at the repo root first if that directory doesn't exist
// yet), rather than aliasing straight into `../../src` and quietly testing a
// path no real install ever takes.
export default defineConfig({
  plugins: [react()],
});
