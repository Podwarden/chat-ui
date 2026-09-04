# @podwarden/chat-ui

A persisted, streaming chat UI for React that talks to any backend implementing
its documented contract — markdown, code highlighting, math, attachments, and
theming included.

| Light | Dark |
|---|---|
| ![Light theme: a seeded conversation with a highlighted Python block and a KaTeX formula](docs/assets/chat-light.png) | ![Dark theme: the same conversation](docs/assets/chat-dark.png) |

## Install

```bash
npm install @podwarden/chat-ui
```

## Mount it

```tsx
'use client';
import { ChatApp } from '@podwarden/chat-ui';
import { createHttpAdapters } from '@podwarden/chat-ui/adapters-http';
import { useMemo } from 'react';

export function Chat({ baseUrl }: { baseUrl: string }) {
  // Keep the adapters object stable — a new one on every render remounts the thread.
  const adapters = useMemo(() => createHttpAdapters({ baseUrl, fetch }), [baseUrl]);
  return <ChatApp adapters={adapters} theme="dark" />;
}
```

React 19 (`react`, `react-dom`) is a peer dependency. Import
`@podwarden/chat-ui/theme.css` (or supply the 17 tokens yourself — see
Theming, below the fold) or the chat renders as unstyled HTML.

## Try it with no backend

`examples/basic` wires the full UI to an in-memory `Adapters` implementation —
two seeded chats and a canned, delayed script of streamed tokens — so it
renders a real, working, streaming chat with no server, no port, and no SSE
parsing:

```bash
git clone https://github.com/Podwarden/chat-ui.git && cd chat-ui
npm install && npm run build   # examples/basic depends on the built dist/
cd examples/basic && npm install && npm run dev
```

This is the fastest way to see the library working end to end. It is also CC0
— copy it into your own app with no attribution obligations.

## What you get

- **Streaming** turns over SSE, with mid-stream abort.
- **Markdown**, Shiki-highlighted code blocks, and KaTeX math, rendered safely
  (sanitized HTML, no raw script execution).
- **Attachments** — images in, thumbnails and a lightbox out.
- **Fork and edit** — branch a chat from any past message, or edit and
  regenerate a turn, without losing the original.
- **Theming** through 17 semantic `--chat-*` tokens and a Tailwind preset, so a
  host restyles the whole UI without overriding a single component.

## The backend contract

`openapi.chat.json` describes the wire protocol this package speaks. Any
backend that implements it — not just the ones this package ships adapters
for — can drive `<ChatApp>`. Prove it with the shipped conformance suite
against a live server, one file:

```ts
import { runConformance } from '@podwarden/chat-ui/conformance';

runConformance({ baseUrl: 'http://127.0.0.1:8000/api/chat2', fetch: authedFetch });
```

`runConformance` registers `describe`/`it` blocks in the calling file rather
than running anything itself, talks to the server only through the injected
`fetch`, and cleans up every chat it creates.

## Entry points

| Import | What it is |
|---|---|
| `@podwarden/chat-ui` | The chat UI React components. Carries `'use client'`. |
| `@podwarden/chat-ui/contract` | Request/response types, the SSE event union, `ApiError`, `CONTRACT_VERSION`. React-free. |
| `@podwarden/chat-ui/adapters-http` | `createHttpAdapters({ baseUrl, fetch })` — the contract over HTTP. React-free. |
| `@podwarden/chat-ui/conformance` | `runConformance(...)` — a runnable suite proving a backend speaks the contract. |
| `@podwarden/chat-ui/openapi.chat.json` | The wire protocol as OpenAPI. |

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

"PodWarden" is a trademark of its owner. The licence does not grant permission
to use the trade names, trademarks, or product names of the licensor, except
as required for reasonable and customary use in describing the origin of the
work.

---

## Reference

The sections above are the pitch. What follows is deeper integration detail —
for a host that already knows it wants this package and needs the specifics.

### About this repository

This repository is the public source mirror of the library, published under
Apache-2.0. It carries the source and the build of every module the package
ships — `npm ci && npm run build` here produces the same `dist/` that is
released. The internal test suite, the GitLab CI machinery, the `publish/`
tooling that produces this mirror, `.npmrc.example`, `screenshots/` and
`playwright.config.ts` (the screenshot-generation harness), and
`docs/superpowers/` (internal design docs) stay behind in the private
repository.

### Theming, in full

The package paints exclusively through 17 semantic `--chat-*` CSS variables and
Tailwind classes named after them, so a host restyles it without overriding a
single component. Each variable is a space-separated `R G B` triplet with no
`rgb()` wrapper, so alpha composes onto it (`bg-chat-surface/50`):

```
--chat-page  --chat-surface  --chat-surface-2  --chat-rule  --chat-fg
--chat-muted --chat-dim      --chat-accent     --chat-accent-strong
--chat-user  --chat-warn     --chat-warn-dim   --chat-negative
--chat-negative-dim          --chat-positive   --chat-code  --chat-on-accent
```

`@podwarden/chat-ui/theme.css` ships a complete dark default for all 17.

**Tailwind 3.4 hosts** add the preset and the scan path:

```js
presets: [require('@podwarden/chat-ui/tailwind-preset')],
content: ['./src/**/*.{ts,tsx}', './node_modules/@podwarden/chat-ui/dist/**/*.js'],
```

**Tailwind 4 hosts** have no `presets` or `content`; use `@source` plus a
`@theme` block mapping each `--color-chat-*` to `rgb(var(--chat-*))`:

```css
@import 'tailwindcss';
@source "../node_modules/@podwarden/chat-ui/dist";

@theme {
  --color-chat-page: rgb(var(--chat-page));
  /* …one line per token… */
}
```

Either way the host must define the 17 triplets. Skipping this step renders the
chat as unstyled HTML.

### `vitest` peer

`vitest` is an *optional* peer dependency, needed only by the `./conformance`
entry.
