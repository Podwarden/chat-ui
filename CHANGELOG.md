# Changelog

All notable changes to `@podwarden/chat-ui`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are semver,
and each release is cut as a `vX.Y.Z` git tag.

## [0.1.23] - 2026-09-05

### Added

- **The README shows how to verify a release.** `npm audit signatures` checks the
  provenance attestation that every build now carries.

## [0.1.22] - 2026-09-05

### Changed

- **Releases now carry provenance attestations.** `0.1.21` was the first, published
  from GitHub Actions via trusted publishing — you can verify which commit and
  workflow built it.

## [0.1.21] - 2026-09-05

### Changed

- **Releases are published to npm with trusted publishing (OIDC)**, so builds
  carry provenance attestations you can verify, and no long-lived publish token
  exists anywhere.

## [0.1.20] - 2026-09-05

### Added

- **A live demo at https://podwarden.github.io/chat-ui/** — the `examples/basic`
  app, built from `main` and running entirely in the browser. No install, no
  clone, no backend. The clone-and-build instructions remain for anyone who
  wants to change it.

## [0.1.19] - 2026-09-05

### Added

- **Published to npmjs.com.** `npm install @podwarden/chat-ui` now works without
  any registry configuration.

## [0.1.18] - 2026-09-05

### Fixed

- **`package.json` in this repository now carries the released version.** It read
  `0.0.0` in every release up to 0.1.17: the real number lives in the git tag and
  was only ever written inside the publish container, never committed. The
  published tree is now stamped with the release version.

### Changed

- **The npm tarball ships this README.** npm always packs `README.md` from the
  package root and `files` cannot exclude it, so the tarball previously carried
  an internal integration guide instead of the public documentation.

## [0.1.17] - 2026-09-05

### Fixed

- **Corrected the 0.1.16 note about `test-results/`.** It claimed Playwright's
  output directory had shipped in v0.1.14 and v0.1.15. It had not: the publish
  runs from a fresh clone, so that artifact only ever existed on a developer
  machine. Confirmed by auditing every blob in this repository's history. The
  exclusion added in 0.1.16 stands — it closes a path that a publish from a
  local working copy would open — but it is hardening, not a repair.

## [0.1.16] - 2026-09-04

### Changed

- **The published root went from 21 entries to 15**, so the README sits higher on
  the GitHub landing page instead of below a wall of config files.
  `CONTRIBUTING.md`, `SECURITY.md` and `CODE_OF_CONDUCT.md` moved to `.github/`,
  which GitHub reads community health files from, so every link still resolves;
  `tsup.config.ts`, `vitest.config.ts` and `tailwind-preset.cjs` moved to
  `config/`. **No public interface changed** — the preset is still imported as
  `@podwarden/chat-ui/tailwind-preset`, and only the export map's internal target
  moved. `package.json`, `package-lock.json`, `tsconfig.json` and
  `eslint.config.mjs` stay at the root, where npm and editors need them.

### Fixed

- **The publish staging now excludes Playwright's `test-results/` directory.** It
  is in `.gitignore`, but the staging copies the working directory without
  consulting `.gitignore`, so a local screenshot run would have leaked it from a
  developer machine. CI publishes from a fresh clone, so it never reached this
  repository — the exclusion closes the path rather than repairing damage. The
  published root is now pinned to an exact set by a test.

## [0.1.15] - 2026-09-04

### Fixed

- **The features infographic showed as a broken image.** GitHub's image proxy
  refuses SVG served from repository paths, so it now ships as a PNG rendered
  from the same source.

## [0.1.14] - 2026-09-04

### Changed

- **The README now shows what this does** rather than describing it: screenshots
  of tool calls, the multiple-choice selector, attachments, chat titling and
  forking, and the settings panel — each in both themes — plus a features
  infographic.
- **The demo covers far more of the surface.** `examples/basic` seeds tool calls,
  option prompts, attachments, a fork and real chat titles, so it doubles as a
  reference implementation for integrating the component.

## [0.1.13] - 2026-09-04

### Fixed

- Follow-up to 0.1.12: the publishing job now passes the credential through to
  the step that uses it. Package contents are unchanged.

## [0.1.12] - 2026-09-04

### Fixed

- **Publishing could not create this repository's CI workflow.** A credential
  limitation on the publishing side prevented `.github/workflows/` from being
  written on the first push. Package contents are unchanged.

## [0.1.11] - 2026-09-04

### Changed

- **This changelog is now curated for the public repository.** It keeps the
  release history and the accounts of what broke and why, and leaves out
  references to internal tracking and release machinery that a consumer of this
  package cannot act on.

## [0.1.10] - 2026-09-04

### Fixed

- **The GitHub publish script aborted once the tree was clean.** It runs under
  `set -euo pipefail`, and its warn-list loop assigned the result of a `grep`
  pipeline; a grep matching nothing exits 1, so the assignment failed and the
  script died silently. The trigger is the ironic part: both warn patterns went
  to zero hits as a result of 0.1.9's sanitation work, so the cleanup that made
  the package publishable is what broke the publisher. Package contents are
  unchanged from 0.1.9.

## [0.1.9] - 2026-09-04

### Changed

- **Relicensed to Apache-2.0**, from AGPL-3.0-only. AGPL on a browser-delivered
  React component would require any application embedding it to release its own
  frontend, which is incompatible with the point of publishing this. Apache-2.0
  adds an explicit patent grant — this package publishes a *contract* others are
  invited to implement — and reserves trademarks (§6). See `LICENSE` and `NOTICE`.

### Added

- **A runnable example with no backend** (`examples/basic`). `Transport.sendTurn`
  delivers events by callback, so an in-memory `Adapters` produces the full
  streaming experience with no server, no port and no SSE parsing. Licensed CC0
  so it can be pasted without attribution obligations.
- **Generated screenshots** in the README, produced by Playwright against that
  example rather than captured by hand, so they cannot drift from the component.
- **Community files** — `CONTRIBUTING.md` (which states plainly that this
  repository is a mirror and pull requests are ported by hand), `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, issue and pull-request templates, and a public CI
  workflow that builds and typechecks.
- **`publish/scan.sh`**, run on every merge request rather than only at release,
  so a leaked identifier surfaces while it is cheap to fix.

### Fixed

- `NOTICE` is now included in the published package, as Apache-2.0 §4(d)
  requires and the README links to.
- The sanitation scan is case-insensitive, matching what the denylists document,
  and now **fails closed** when a pattern cannot be evaluated — previously a
  malformed regex reported a clean scan.
- Build-output exclusions apply at any depth, so a nested `node_modules` or
  `dist` under `examples/` can no longer reach the published tree.

## [0.1.8] - 2026-09-04

Supersedes 0.1.7, which shipped the same two fixes in a narrower shape: the
model picker only patched the `<select>`, and the reasoning-effort control
hard-coded Qwen3.8's three level names and rendered them for every reasoning
model — including ones whose template never reads `reasoning_effort` (Qwen3.5,
Qwen3.6), where it changed nothing, and ones with a different vocabulary
(gpt-oss: `low`/`medium`/`high`), where it would have sent a value the model
does not know. Nothing pinned 0.1.7; it stays in the registry as history.

### Fixed

- **The settings panel can no longer show a model the chat is not using —
  this is the prod fix.** A chat pins its model by name and nothing keeps
  that name inside the loaded set; `GET /models` lists loaded models only.
  When the pinned model was absent the `<select>` had a value matching no
  option and the browser rendered the *first* option — a loaded model the
  chat was not on, indistinguishable from a real choice — and the turn then
  failed with `Model "X" is not loaded.` on a model the operator could see
  nowhere. Several chats on a client install were found in this state and
  had to be repaired over the API. Now:
  - the chat's own model is **always** an option: when it is not loaded it is
    listed under a *Not loaded* group, disabled and selected, with the loaded
    models grouped apart and selectable, and a status line says what to do;
  - the not-loaded banner offers the way out — **Use \<model\>** when exactly
    one model is loaded (a `PATCH` of the chat's `model`), **Choose a model**
    (opens Settings) when several are. A host running `settings: 'hidden'`
    keeps its own wording and gets no action, as before;
  - the backend's `ChatSummary.model_loaded` (new, optional) is trusted over
    the polled catalog when present: a model unloaded between two polls reads
    as not loaded immediately. Whenever the two disagree, both sides are
    refreshed at once — the catalog *and* the chat detail — so the state also
    heals the other way: a pinned model that is loaded again (from the Models
    page, another tab, the API) stops reading as not loaded on the next
    catalog poll instead of waiting for a remount. Absent (an older backend),
    the lookup is unchanged.

### Added

- **Reasoning effort.** A *Reasoning effort* `<select>` under *Enable thinking*,
  shown for a reasoning model whose `ModelInfo.reasoning_efforts` (new,
  optional) is non-empty and inert while thinking is off. The options are the
  backend's list **verbatim** — the values are the model's own chat-template
  vocabulary (e.g. `xhigh`, `medium`, `low`), so a family with different names
  needs no UI change — plus *Model default*, which writes
  `reasoning_effort: ""`. A level stored under a different model is shown as
  `<level> (not offered by this model)`, disabled, never as one of this
  model's. `ChatSettings.reasoning_effort` is the new optional key; the
  backend forwards it as `chat_template_kwargs.reasoning_effort` only when
  the current model lists it.
- `BannersProps.models` / `onSwitchModel` / `onOpenSettings` — the recovery
  actions above, for hosts assembling their own layout.
- Conformance kit: a `models` group (`GET /models` shape, optional
  `reasoning_efforts` is `string[]`), and `GET /chats/{id}` checks that
  `model_loaded`, when present, is a boolean.
- `openapi.chat.json` re-extracted from the current backend: picks up
  `SettingsPatch.reasoning_effort` as the bounded string it now is (and the
  `scope` key and `_whoami` response shape that had drifted since the last
  extraction).

### Changed

- `ChatSettings.reasoning_effort` is `string`, not 0.1.7's
  `'low' | 'medium' | 'xhigh'` union. The `ReasoningEffort` type 0.1.7
  exported is kept as a deprecated alias of `string` and goes away in 0.2.

## [0.1.7] - 2026-09-04

### Fixed

- **The settings panel showed a model the chat was not using.** A chat pins its
  own `model`, but the catalog feeding the picker carries only *loaded* models.
  When the pinned model was unloaded it was absent from the options, so the
  `<select>` had a value matching no `<option>` and the browser silently
  rendered the **first** one. The panel displayed a model the chat was not
  using — visually identical to a real selection — while the turn went to the
  stored model and failed with `Model "A" is not loaded`. It also left no way
  out from inside the chat: picking the model the panel already claimed to be
  on fired no change event, because nothing had changed. The pinned model is
  now rendered as its own option, marked `— not loaded`, which makes the value
  real and turns every other option back into a genuine change.

### Added

- **`reasoning_effort` on `ChatSettings`, with a control for it.** Some chat
  templates take this alongside `enable_thinking` and default it to the most
  expensive of several levels, so reasoning models ran at maximum with no
  control but the blunt on/off of thinking. Absent still means the template's
  own default, so **no existing chat changes behaviour**; the control shows
  that default without persisting it. Shown only when the model reasons and
  thinking is on, because the template reads the value inside its
  `enable_thinking` branch. The vocabulary is the model family's own, and a
  backend on a different scale must map onto its three levels, since the
  template raises on anything else.

## [0.1.6] - 2026-09-03

### Added

- **LaTeX-style math delimiters render — this is the prod fix.** Models write
  display math as `\[ … \]` and inline math as `\( … \)`; remark-math parses
  only the `$`-forms, and CommonMark unescapes `\[` to a literal bracket — so a
  formula reached the screen as plain text (`[ x_i = \frac{\det(A_i)}{\det(A)} ]`,
  user report). A raw-text pass (`model/math-delimiters.ts`) now rewrites
  balanced LaTeX delimiters to the `$`-forms before parsing: standalone
  `\[ … \]` becomes a `$$` display block, mid-sentence it stays inline so the
  paragraph is not restructured, and `\( … \)` becomes `$ … $`. Fenced blocks
  and inline code are never touched; only balanced pairs convert, so a
  half-streamed `\[` stays literal until its `\]` arrives; a stray unescaped
  `$` inside a converted body is escaped so it cannot terminate the math early.
  Rendering itself is the existing pipeline — sanitize → KaTeX(`trust:false`)
  → safe-math-source — unchanged.

## [0.1.5] - 2026-09-01

### Fixed

- **Typing can no longer go nowhere — this is the prod fix.** Scrolling or
  clicking in the thread moved focus to the scroller or `<body>` (recent
  Chrome makes scrollable containers click-focusable), after which keystrokes
  landed nowhere visible. Nothing ever handed focus back: the composer never
  took focus on mount, on chat switch, or on re-enable, and no key routing
  existed. Two changes in `<Composer>` restore the invariant that keystrokes
  always land in a visible field:
  - **Autofocus.** The textarea takes focus on mount, when `focusKey` changes
    (`<ChatApp>` passes the selected chat id), and when the field re-enables
    after a page-level block — but never by stealing from another editable
    field the user is typing in (the sidebar filter, a rename input, a
    settings field).
  - **Type-anywhere routing.** A printable key or Backspace pressed while
    focus sits on a non-editable target (the thread, `<body>`) focuses the
    textarea so the keystroke lands in it — the Slack/ChatGPT behaviour.
    Editable fields and open dialogs (`role="dialog"`) keep their own keys;
    anything carrying Ctrl/Cmd/Alt (shortcuts, copy/paste) is never touched;
    arrow/Page keys still scroll. The document-level listener is removed on
    unmount.

### Added

- `ComposerProps.focusKey?: string | null` — identity of the surface being
  typed into; a change refocuses the textarea under the no-stealing rule
  above. Hosts rendering `<ChatApp>` get this wired automatically.

## [0.1.4] - 2026-08-26

### Added

- **URLs inside code are now links — this is the prod fix.** An agent that
  hands out an approval URL and formats it as a fenced block (or as inline
  code) — because it is a thing to copy — hit GFM's rule that deliberately
  does not autolink inside code, which is right for source and wrong for this
  chat: the user could see the URL and not click it. `<CodeBlock>` and the
  inline `<code>` renderer now linkify `http(s)://` URLs themselves. Covered
  in all three renderings a fence can have: the plain `<code>` a fence with
  **no info string** produces, `<CodeBlock>`'s un-highlighted fallback, and
  the Shiki-highlighted tree — where the anchors are inserted into Shiki's
  hast *before* `SANITIZE_SCHEMA` + `rehypeChat2Policy` run, so per-token
  colours and `line` classes survive and the anchors are held to the same
  policy as every other link. Monospace styling is unchanged, the code text
  is reproduced character for character, and **the copy button still copies
  the raw source** — the anchors exist only in the rendered tree, never in
  the clipboard. Requires an explicit scheme (no bare `www.` in code, where
  it is more often a config hostname than a link), trims trailing
  `?!.,:;*_~'"` and an unbalanced `)`, and matches `https?://` only — a
  `javascript:` URL in code is never linked. Applies to every fence,
  including a compose file or a JSON blob.
- **Bare URLs in prose keep GFM's rule, now pinned by tests.** `remark-gfm`'s
  autolink literals were already enabled: `http(s)://` + host, `localhost`,
  IPv4, optional port, path/query/fragment, ending at whitespace or `<`, with
  trailing punctuation trimmed and a closing `)` trimmed only when unbalanced
  (`(https://x.io/a)` links `https://x.io/a`). A bare `www.` literal links too,
  promoted to `http://`. An existing `[label](url)` link and an `<https://…>`
  autolink are untouched. Links render as
  `<a href target="_blank" rel="noopener noreferrer">` with the existing
  `[&_a]:text-chat-accent-strong` styling and the URL as their own text, and the
  sanitizer still admits only `http:`, `https:` and `mailto:` hrefs.
- **`remarkAutolinkPolicy`** (internal, `src/model/autolink.ts`), two
  corrections on top of GFM's prose rule:
  - a mixed-case scheme (`HTTPS://…`) used to reach the sanitizer's
    case-sensitive `protocols.href` allowlist and lose its `href` entirely,
    leaving a dead `<a>` — another bare URL that could not be clicked. The
    href's scheme is now lower-cased (visible text untouched, and only the three
    allowed schemes are normalised, so `JAVASCRIPT:` is still dropped);
  - a `>` was read as a path character and percent-encoded into the href
    (`…/a>b` → `…/a%3Eb`); a bare literal now ends at `<`, `>` or `"`, and the
    remainder goes back to the paragraph as text.

Streaming is unchanged: the buffer is re-parsed per delta, a half-arrived URL —
including one inside a still-open fence — may link the prefix that is already
there and settles on the full href when the last delta lands, and no delta
throws.

## [0.1.3] - 2026-08-25

Three additive host capabilities. No wire-contract change (`CONTRACT_VERSION`
stays `'1.0'`; `ChatSettings.scope` was already an opaque host object), and
every new capability defaults to today's behaviour — a 0.1.2 host bumps with no
code changes and no observable difference.

### Added

- **`capabilities.settings`** (`'editable' | 'hidden'`, default `'editable'`).
  `'hidden'` renders neither the header's Settings toggle nor the
  `<SettingsPanel>` behind it, for a host that has already decided every
  per-chat knob. Rename, fork, delete and regenerate are untouched.
- **`capabilities.modelSelection`** (`'user' | 'host'`, default `'user'`).
  `'host'` states that the host chooses the model system-wide and never shows
  the user a picker, which makes a chat's stored `model` informational: a stale
  or absent id then resolves to the single listed model instead of reading as
  "not loaded". Under the default `'user'` the chat's stored id stays
  authoritative and every render path is identical to 0.1.2.
- **`capabilities.scopes`** (`{ label, list(): Promise<ScopeOption[]> }`,
  default absent) plus the exported **`ScopeOption`** type. Lets the user bind
  each NEW chat to one of the host's scopes. The host supplies the options and
  the exact opaque object to persist, which the package round-trips into
  `ChatSettings.scope`; it never learns a host's scope keys, and treats the
  option objects as frozen (a shallow copy is what reaches the adapter). Two
  or more options render a `<select>` above the sidebar's New-chat button,
  captioned by a real `<label for>`; the collapsed rail shows no picker but
  names the current choice in that button's tooltip. One option renders no
  picker and still binds. A `list()` that rejects *or throws synchronously*
  is logged once and treated as "no scopes", and chat creation keeps working.
  `scopeLabel` still owns the per-row badge on existing chats.
- **`labels.noModelAvailable`** (default *"No model is available right now —
  contact your administrator"*), used for the no-model banner when
  `settings: 'hidden'`, so the UI never sends a user to a panel the host has
  removed. With settings editable the 0.1.2 wording is unchanged.
- **`resolveActiveModel(models, chatModel)`** exported from the package root —
  the rule behind `modelSelection: 'host'` (exact id match, else the only
  loaded model, else `null`), so a host's own chrome can agree with the
  composer, the banners and the settings panel.

### Changed

- **The single-model fallback is opt-in.** With `modelSelection: 'host'`, a
  deployment that has loaded exactly one model no longer reports
  `Model "X" is not loaded.` over a stale or absent `chat.model` — that model
  is resolved as the chat's, the banner stays quiet and the composer stays
  enabled. Without the opt-in (and for any deployment with two or more models
  loaded) the behaviour is exactly as before: banner, and a composer disabled
  with "Model is not loaded". This is deliberately not the default — a turn
  route can 404 on both a null and a stale model id, so guessing there would
  move a pre-flight refusal into a server error.
- `<ChatSidebar>` gained three optional props (`scopeOptions`,
  `selectedScopeId`, `onScopeChange`) and `<Banners>` one (`noModelText`), for
  hosts that assemble their own layout. Omitting them renders exactly as before.

## [0.1.2] - 2026-08-25

### Added

- **`LIMITS` namespace export** on the package root (`export * as LIMITS from
  './model/limits'`) — `LIMITS.MAX_IMAGE_BYTES`, `LIMITS.MAX_IMAGES_PER_MESSAGE`,
  `LIMITS.ALLOWED_IMAGE_MIMES`, `LIMITS.RESERVE_CAP_TOKENS`,
  `LIMITS.SIGNED_URL_TTL_S`, `LIMITS.TITLE_MAX_CHARS`, and the rest of
  `src/model/limits.ts`, so a host's own contract tests can assert against
  these numbers directly instead of duplicating them.

### Fixed

- **`createHttpAdapters` normalises a trailing slash in `baseUrl`.** Trailing
  slashes are stripped once, up front, and the normalised value is what `id`
  and every request path use — `{ baseUrl: '/api/chat2/' }` now behaves
  identically to `{ baseUrl: '/api/chat2' }`.

### Docs

- Reworded the `SanitizeOptions.attachmentPathPrefix` doc comment to spell out
  that an absolute `baseUrl` (scheme + host) admits that specific origin's
  attachment path, not just same-origin relative paths.
- Fixed two stale `useAdapters().id` mentions (`src/model/sanitize-schema.ts`,
  this file) — `<Markdown>` has derived the prefix from
  `useOptionalAdapters().id` since 0.1.1.

## [0.1.1] - 2026-08-24

Host-neutrality fixes found by the whole-branch review of 0.1.0. No API
removals; the only behaviour change a host can observe is in the sidebar's
shared-chat mode, which that host does not turn on.

### Fixed

- **The conformance kit accepts a string `user_id`.** `GET /_whoami` is
  asserted as `string | number`, since different backends key their users
  differently (integer primary keys, UUIDs) and the contract never picked a
  representation.

- **Attachment URLs are host-neutral.** `<AttachmentImage>` and `<Lightbox>` read
  the URL through `adapters.storage.attachmentUrl(a)` instead of off
  `attachment.url`, honouring the adapter seam a host uses to proxy or rewrite
  attachment routes. The markdown sanitizer's image-src allowlist is no longer
  pinned to a single fixed path: `rehypeChat2Policy({ attachmentPathPrefix })`
  takes the prefix (defaulting to the old value), `createImageSrcPolicy` /
  `isAllowedImageSrc` expose it, and `<Markdown>` derives it from
  `useOptionalAdapters().id`. On a host mounted anywhere else, every inline
  attachment image was previously deleted by the policy plugin.

- **Sidebar shared-chat polish.** On a colleague's row, Fork — the only action
  that row offers — is permanently visible rather than hover-revealed (it stays
  hover-revealed on your own rows, where it is one of three). The scope chip uses
  `bg-chat-surface`, so it no longer disappears into the selected row's
  `bg-chat-surface-2`. "Delete all" counts and enables on the caller's **own**
  rows only, matching a `DELETE /chats` that the backend scopes to the caller.

- **KaTeX stylesheet retention.** `sideEffects` names the katex side-effect
  module by its **source** path as well as its built one — esbuild resolves
  that list against source paths while bundling, so without the `.ts` entry
  the stylesheet import survived only by accident.

### Added

- **`useOptionalAdapters()`** — the adapters context read without the throw,
  exported beside `AdaptersProvider` / `useAdapters`. `<Markdown>`,
  `<AttachmentImage>` and `<Lightbox>` are public building blocks a host may mount
  on their own, so they consult the context when it is there and fall back to the
  package defaults (the default attachment route, and `attachment.url`) when it is
  not, rather than turning a standalone render into a crash. `useAdapters()` still
  throws, and the hooks still use it.

### Changed

- `src/hooks/use-chat-thread.ts` imports its event types from `../contract/events`
  directly rather than through the `../model/events` re-export shim.

### Documentation

- **README, theming.** The Tailwind 4 snippet uses `@theme inline`, which emits
  `rgb(var(--chat-*))` into the utility instead of resolving it once at `:root` —
  the difference between a `[data-theme]` set below `<html>` re-theming the
  subtree and inheriting `:root`'s value. Both dialect sections now say to import
  `theme.css` *before* your own overrides, and a new section covers the CSS mock
  (`css: false`) a host's test runner needs for the katex import.
- **README, backend contract.** `openapi.chat.json` carries the paths and request
  schemas; the TypeScript types in `@podwarden/chat-ui/contract` are normative for
  responses and SSE events. States plainly that there is no client-side contract
  handshake — hosts run the conformance kit in CI, and its `whoami` group is what
  asserts `_whoami.contract`.

## [0.1.0] - 2026-08-24

First release. The chat2 experience — persisted, streaming, tool-aware LLM chat —
extracted into a standalone, installable React library that any host can mount,
with the backend contract it speaks promoted to a shipped, testable artefact.

### Added

- **Backend contract as its own entry** (`@podwarden/chat-ui/contract`). Wire
  types, the streamed `ChatEvent` union, `isChatEvent`, `ApiError` and
  `CONTRACT_VERSION` (`'1.0'`), React-free so a server or a non-React host can
  import them. Adds the `notice` event — a keyed, level-tagged banner the server
  can raise mid-turn, where a repeat replaces rather than stacks and `turn:`-
  prefixed keys are dropped when the turn ends — and two error codes the
  multi-tenant hosts need: `forbidden` and `instance_offline`.
  `dist/contract/openapi.chat.json` describes the same protocol for
  non-TypeScript implementers.

- **Injected adapters** (`@podwarden/chat-ui/adapters-http`). Every I/O path the
  UI takes goes through an `Adapters` object supplied by the host —
  `AdaptersProvider` / `useAdapters` — instead of a fetch singleton imported at
  module scope. `createHttpAdapters({ baseUrl, fetch })` is the HTTP
  implementation; a host that authenticates differently, proxies, or talks to
  something other than HTTP substitutes its own. The hooks read the adapters
  through a latest-value ref, so a host that rebuilds the object on every render
  does not tear down and re-subscribe the live chat.

- **Bundled UI primitives and a theme context.** `Button`, `Modal`, `cn` and
  `copyToClipboard` ship with the package rather than being imported from the
  host, and `ChatThemeProvider` / `useChatTheme` replace a host-specific theme
  hook. The package no longer reaches for any host-framework module.

- **`<ChatApp>`** — sidebar, thread, composer, settings and dialogs in one
  component, taking `adapters`, `theme`, and optional `capabilities`, `labels`
  and routing callbacks. Everything it is built from is exported beside it for
  hosts that assemble their own layout.

- **17 semantic `--chat-*` tokens and a Tailwind 3.4 preset.** No component names
  a literal palette colour; every colour resolves through a token, published as
  `R G B` triplets so alpha composes (`bg-chat-surface/50`).
  `@podwarden/chat-ui/theme.css` carries a complete dark default,
  `@podwarden/chat-ui/tailwind-preset` maps the `chat-*` scale for Tailwind 3.4,
  and Tailwind 4 hosts declare the same scale in `@theme` (README has both).
  Includes `--chat-on-accent` for text sitting on a coloured fill, which stays
  legible when a host flips to a light theme.

- **Tailwind 3/4 dialect guard.** Utilities whose meaning diverges between the
  two majors are written as arbitrary values so the same built class works under
  either dialect, with a test that fails if a divergent shorthand creeps back in.

- **Shared-chat support in the sidebar** — grouping by owner, a running-turn
  hint, and a scope chip — all behind a capability flag, so a single-tenant host
  sees exactly the list it had before.

- **Conformance kit** (`@podwarden/chat-ui/conformance`). `runConformance()`
  registers `describe`/`it` blocks in the caller's own test file, so a backend
  proves it speaks the contract using its own runner, reporter and CI. It reaches
  the server only through the injected `fetch` and `baseUrl`, keeps every wait
  short enough for a live server, asserts only on wire facts, and cleans up every
  chat it creates. An in-memory mock backend in this repo runs the whole suite
  green, which is what keeps the kit honest.

- **Packaging.** ESM build via tsup with five entries, `.d.ts` per entry, source
  maps, `'use client'` stamped on the React entry only, and `sideEffects` covering
  the KaTeX stylesheet.
