# Contributing to @podwarden/chat-ui

**This repository is a mirror.** `@podwarden/chat-ui` is developed in a
private GitLab repository and published here as a squashed snapshot on every
release. That has a consequence worth knowing before you write any code: a
pull request here **cannot be merged with a button**. We read every PR, and
we port the ones we accept by hand — which means your change can land, but
your commit will not appear in this repository's history, and the PR will be
closed rather than merged. We would rather tell you that up front than have
you find out afterwards.

Issues and discussion are the highest-bandwidth way to help. For anything
larger than a small fix, open an issue first — it avoids the case where you
write a whole feature we can't take, or that overlaps with work already in
flight on the private side.

## Getting set up

```
git clone https://github.com/Podwarden/chat-ui.git
cd chat-ui
npm ci
npm run build
```

`npm run build` is not optional here: `examples/basic` depends on the built
`dist/` via the package's `exports`, and without it the example fails to
resolve `@podwarden/chat-ui`.

There is no backend required to work on the UI. `examples/basic` runs the
component library against an in-memory mock adapter:

```
cd examples/basic
npm install
npm run dev
```

## Before you open a PR

```
npm run lint
npm run typecheck
npm run build
```

These are the same checks `.github/workflows/ci.yml` runs. Note what's
**not** there: `npm test`. This public tree excludes the `tests/` directory
(it's ~5k lines of fixtures whose job is gating merges on the private
GitLab repo), so there is no test suite to run here. If your change needs
test coverage, describe the behavior you'd expect tested in the PR
description — we'll write the actual test on the private side when we port
the change.

## Sign off your commits (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/)
instead of a CLA — it's a statement that you wrote the change (or otherwise
have the right to submit it), not an assignment of copyright. Sign off every
commit:

```
git commit -s -m "your message"
```

That appends a `Signed-off-by: Your Name <you@example.com>` trailer. Use your
real name and a real, reachable email address.

## Licensing

The package is Apache-2.0; by contributing you agree your changes are
licensed under it too. Everything under `examples/` is dedicated to the
public domain under CC0 — paste it freely, no attribution required, and feel
free to add more examples under the same terms.

## What's likely to be accepted

Bug fixes with a clear repro, documentation fixes, and small, well-scoped
improvements to `src/contract` or `src/conformance` (the parts of this
library other implementations depend on) are the easiest things to port by
hand. Large refactors or new features are best discussed in an issue first,
since porting a large hand-written diff onto a private tree that has moved
on is exactly the kind of work a mirror makes expensive.
