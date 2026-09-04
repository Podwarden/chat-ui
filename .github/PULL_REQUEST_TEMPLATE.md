<!--
This repository is a mirror: development happens on a private GitLab repo,
and this GitHub repo is published as a squashed snapshot on release. Please
read that as context before you invest time here — it's explained in full in
CONTRIBUTING.md, but the short version is:

A pull request opened here CANNOT be merged with a button. We read every PR;
the ones we accept are ported by hand onto the private repo, which means your
commit will not appear in this repository's history, and this PR will be
CLOSED rather than merged once it's ported (or if we decide not to take it).
We'd rather you know that before you write the code than after.

For anything larger than a small, well-scoped fix, please open an issue
first — it's much cheaper to discuss than to have a finished PR go unported.
-->

## What does this change?

<!-- What problem it solves, and how. -->

## How was this tested?

<!--
Note: `npm test` isn't available in this public tree (tests/ is excluded —
see CONTRIBUTING.md). Describe how you verified the change manually, and/or
what test coverage you'd expect — we'll add the actual test when we port this
onto the private repo.
-->

## Checklist

- [ ] I've read CONTRIBUTING.md and understand this PR will be ported by hand,
      not merged directly.
- [ ] Commits are signed off (`git commit -s`) per the DCO.
- [ ] `npm run lint && npm run typecheck && npm run build` pass locally.
