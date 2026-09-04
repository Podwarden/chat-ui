# Security Policy

## Supported versions

`@podwarden/chat-ui` is pre-1.0. Only the latest published minor version
receives security fixes; there are no backported patches to older minors.
Once the package reaches 1.0, this policy will be revisited and this file
updated.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a suspected security
vulnerability. Email **security@podwarden.com** with:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a minimal repro if you have one.
- The version of `@podwarden/chat-ui` (and `CONTRACT_VERSION`, if relevant)
  you tested against.

## What to expect

We aim to acknowledge reports within **5 business days**. We don't promise a
fix timeline up front — it depends on severity and complexity — but we will
keep you updated as we triage and work the issue, and we will credit
reporters (unless you'd rather stay anonymous) once a fix ships.

This library ships an HTTP adapter (`@podwarden/chat-ui/adapters-http`) that
carries auth headers on behalf of a host application. Issues in how that
adapter handles credentials, or in the markdown/HTML sanitization pipeline
(`rehype-sanitize`, KaTeX rendering with `trust: false`), are exactly the
kind of report this address is for.
