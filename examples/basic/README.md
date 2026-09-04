# chat-ui basic example

Streaming chat, `@podwarden/chat-ui`'s full UI, and **no backend at all**.

`Transport.sendTurn(req, onEvent, signal)` delivers events by callback, not
over the wire (see `../../src/adapters/types.ts`), so [`src/demo-adapters.ts`](./src/demo-adapters.ts)
implements the whole `Adapters` interface in memory — two seeded chats and a
canned, delayed script of streamed tokens — and that alone is enough for
`<ChatApp>` to render a real, working, streaming chat. No HTTP fixture, no
port, no SSE parsing.

## Run it

From the repo root, build the package once (this example depends on it via
`file:../..`, so it needs a `dist/` to resolve against):

```bash
npm install
npm run build
```

Then, from this directory:

```bash
npm install
npm run dev
```

Open the printed `localhost` URL. Send a message and watch it stream back
token by token; the stop button in the composer ends a turn mid-stream with
an aborted response, same as it would against a real server.

## Query parameters

This example reads two URL parameters at startup:

| Parameter | Values | Effect |
|---|---|---|
| `?theme=` | `light` \| `dark` (default `dark`) | Which look to render. |
| `?seed=` | any non-empty value | Opens the seeded chat that has a fenced code block and a LaTeX expression, deterministically, instead of whichever chat would otherwise sort first. |

`http://localhost:5173/?theme=light&seed=demo` renders a fixed, reproducible
screen — no interaction required — which is what makes this app a stable
target for taking a screenshot of the library.

## What's here

| File | Role |
|---|---|
| `src/demo-adapters.ts` | `createDemoAdapters()` — the in-memory `Adapters` implementation. |
| `src/fixtures.ts` | The seeded chats and the reply script `demo-adapters.ts` streams. |
| `src/main.tsx` | Mounts `<ChatApp>`, reads the two query parameters above. |

`src/demo-adapters.ts` and `src/fixtures.ts` import their types from the
package's source by relative path (`../../../src/adapters/types`, not
`@podwarden/chat-ui`) rather than the package name — that's what lets the
repo's own test suite (`tests/demo-adapters.test.ts`) exercise this module
directly, with no build step and no dependency on this example's own
`node_modules`. `src/main.tsx` imports the package name as normal, since only
this example's own build ever resolves it.

## Licence

Everything under `examples/` is CC0-1.0 (public domain) — see
[`../LICENSE`](../LICENSE) — not the Apache-2.0 licence the rest of this
repository carries. Example code is the most-copied part of any repo; paste
it into your own app with no attribution obligations.
