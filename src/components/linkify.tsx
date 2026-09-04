'use client';

import { Fragment, isValidElement, type ReactNode } from 'react';
import { splitCodeUrls } from '../model/autolink';

/**
 * The React half of "URLs inside code are clickable" — inline `<code>` and the
 * un-highlighted fence fallback, both of which render React children rather
 * than the hast tree `linkifyCodeHast` rewrites for Shiki's output.
 *
 * These anchors do NOT pass through `rehypeSanitize`, so this function is the
 * one that has to be trustworthy: `splitCodeUrls` only ever matches an explicit
 * `http://` / `https://` literal, and the guard below re-checks that on the way
 * out, so no other scheme (a `javascript:` URL above all) can reach `href`.
 *
 * Strings are split; anything already an element is left exactly as it is, so
 * a highlighted or emphasised run inside the fence is untouched.
 */
export function linkifyCode(children: ReactNode): ReactNode {
  if (typeof children === 'string') return linkifyString(children);
  if (Array.isArray(children)) {
    return children.map((child, i) => <Fragment key={i}>{linkifyCode(child)}</Fragment>);
  }
  if (isValidElement(children)) return children;
  return children;
}

/** Kept in step with `SANITIZE_SCHEMA.protocols.href` minus `mailto`. */
const SAFE = /^https?:\/\//i;

function linkifyString(text: string): ReactNode {
  const segments = splitCodeUrls(text);
  if (segments.length === 1 && segments[0].url === undefined) return text;
  return segments.map((seg, i) =>
    seg.url !== undefined && SAFE.test(seg.url) ? (
      <a key={i} href={seg.url} target="_blank" rel="noopener noreferrer">
        {seg.value}
      </a>
    ) : (
      <Fragment key={i}>{seg.value}</Fragment>
    ),
  );
}
