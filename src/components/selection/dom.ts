// Selection actions — the DOM half: reading a selection out of a rendered
// message, mapping it to stable character offsets and back, placing the
// floating menu, and flashing a passage.
//
// Message bodies are marked by <MessageItem> with `data-message-body`
// (+ `data-message-id`, `data-role`); UI chrome inside them (a code block's
// header, its "Show all" button, a message's action row) carries
// `data-selection-ignore` and is skipped by every text walk here, so offsets
// count only the words the user can read.

import type { Quote } from '../../model/selection';
import { newQuoteId } from '../../model/selection';

export const BODY_SELECTOR = '[data-message-body]';
export const IGNORE_SELECTOR = '[data-selection-ignore]';
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** The element a boundary point sits in (text nodes report their parent). */
export function elementOf(n: Node | null): Element | null {
  if (!n) return null;
  return n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement;
}

/** Text nodes of `body` in document order, chrome excluded. */
export function textNodes(body: Element): Text[] {
  const out: Text[] = [];
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(IGNORE_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** The readable text of a message body (what offsets index into). */
export function bodyText(body: Element): string {
  return textNodes(body).map((t) => t.data).join('');
}

/** Character offset of the boundary point (`container`, `offset`) inside `body`'s readable text. */
export function offsetOf(body: Element, container: Node, offset: number): number {
  const doc = body.ownerDocument;
  const point = doc.createRange();
  point.setStart(container, offset);
  point.collapse(true);
  let n = 0;
  for (const t of textNodes(body)) {
    if (t === container) return n + Math.min(offset, t.length);
    // Only `container` itself can straddle the point; every other text node
    // either ends at/before it (counted whole) or starts after it (done).
    if (point.comparePoint(t, t.length) <= 0) n += t.length;
    else break;
  }
  return n;
}

/** A Range over [start, end) of `body`'s readable text, or null when out of range. */
export function rangeFromOffsets(body: Element, start: number, end: number): Range | null {
  if (start < 0 || end <= start) return null;
  const nodes = textNodes(body);
  let n = 0;
  let r: Range | null = null;
  for (const t of nodes) {
    const next = n + t.length;
    if (!r && start >= n && start < next) {
      r = body.ownerDocument.createRange();
      r.setStart(t, start - n);
    }
    if (r && end > n && end <= next) {
      r.setEnd(t, end - n);
      return r;
    }
    n = next;
  }
  return null;
}

/**
 * Find `needle` in `body`'s readable text: exactly first, then ignoring
 * whitespace differences (a selection's `toString()` puts newlines between
 * blocks where `textContent` has none).
 */
export function findTextRange(body: Element, needle: string): Range | null {
  const hay = bodyText(body);
  const exact = hay.indexOf(needle);
  if (exact >= 0) return rangeFromOffsets(body, exact, exact + needle.length);
  // whitespace-insensitive: compare with all whitespace removed, mapping back
  const map: number[] = [];
  let squashed = '';
  for (let i = 0; i < hay.length; i++) {
    if (!/\s/.test(hay[i]!)) { squashed += hay[i]; map.push(i); }
  }
  const target = needle.replace(/\s+/g, '');
  if (!target) return null;
  const at = squashed.indexOf(target);
  if (at < 0) return null;
  return rangeFromOffsets(body, map[at]!, map[at + target.length - 1]! + 1);
}

/** What the menu captured when it opened — everything an action needs, so a re-render cannot lose it. */
export interface SelectionSnapshot {
  /** Plain text as the user sees it (`Selection.toString()`). */
  text: string;
  /** Sanitised-by-construction HTML of the selected DOM (chrome removed), for the rich clipboard flavour. */
  html: string;
  /** True when the selection spans formatting (any element), i.e. a rich flavour is worth offering. */
  rich: boolean;
  quote: Quote;
  role: string | undefined;
  /** The live range (cloned) the menu is anchored to. */
  range: Range;
}

/**
 * Read the document selection, if it is a non-empty selection inside ONE
 * message body under `root`. Returns null for collapsed/whitespace selections,
 * selections in editable fields (the composer, a code editor), selections that
 * span two messages and selections outside the thread.
 */
export function takeSnapshot(root: Element): SelectionSnapshot | null {
  const doc = root.ownerDocument;
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const text = sel.toString();
  if (!text.trim()) return null;
  const range = sel.getRangeAt(0).cloneRange();
  const startEl = elementOf(range.startContainer);
  let endEl = elementOf(range.endContainer);
  if (!startEl || !endEl || !root.contains(startEl)) return null;
  if (startEl.closest(EDITABLE_SELECTOR) || endEl.closest(EDITABLE_SELECTOR)) return null;
  const body = startEl.closest(BODY_SELECTOR);
  if (!body) return null;
  if (endEl.closest(BODY_SELECTOR) !== body) {
    // A triple-click selects "the paragraph" with the end at offset 0 of the
    // NEXT block — possibly the next message. That is still one message.
    if (range.endOffset !== 0) return null;
    range.setEnd(body, body.childNodes.length);
    endEl = body;
  }
  const messageId = (body as HTMLElement).dataset.messageId;
  if (!messageId) return null;
  const start = offsetOf(body, range.startContainer, range.startOffset);
  const end = offsetOf(body, range.endContainer, range.endOffset);

  const common = elementOf(range.commonAncestorContainer);
  const codeEl = common?.closest('[data-code-block]') as HTMLElement | null;
  const frag = range.cloneContents();
  frag.querySelectorAll(IGNORE_SELECTOR).forEach((n) => n.remove());
  const box = doc.createElement('div');
  box.appendChild(frag);
  const rich = box.querySelector('*') !== null;

  return {
    text,
    html: box.innerHTML,
    rich,
    role: (body as HTMLElement).dataset.role,
    range,
    quote: {
      id: newQuoteId(),
      text: codeEl ? text.replace(/\n+$/, '') : text.trim(),
      kind: codeEl ? 'code' : 'text',
      lang: codeEl?.dataset.lang || undefined,
      source: { messageId, start, end: Math.max(end, start) },
    },
  };
}

export interface Box { top: number; left: number; right: number; bottom: number }

/** The nearest ancestor that clips its content, intersected with the viewport. */
export function clipBoxFor(el: Element): Box {
  const win = el.ownerDocument.defaultView!;
  let box: Box = { top: 0, left: 0, right: win.innerWidth, bottom: win.innerHeight };
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = win.getComputedStyle(p);
    if (/(auto|scroll|hidden|clip)/.test(s.overflowY + s.overflowX)) {
      const r = p.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // jsdom / display:contents
      box = {
        top: Math.max(box.top, r.top),
        left: Math.max(box.left, r.left),
        right: Math.min(box.right, r.right),
        bottom: Math.min(box.bottom, r.bottom),
      };
    }
  }
  return box;
}

/** The rects of `range` that are at least partly inside `clip` (LibreChat #16458: anchor to the VISIBLE part). */
export function visibleRects(range: Range, clip: Box): DOMRect[] {
  const rects = Array.from(range.getClientRects?.() ?? []).filter((r) => r.width > 0 || r.height > 0);
  return rects.filter((r) => r.bottom > clip.top && r.top < clip.bottom && r.right > clip.left && r.left < clip.right);
}

export interface MenuPosition { top: number; left: number; placement: 'above' | 'below' }

const GAP = 8;
const MARGIN = 4;

/**
 * Where the menu goes: centred over the first visible line of the selection,
 * above it when there is room inside the clip box, below the last visible line
 * otherwise; then clamped so it never leaves the clip box or the viewport.
 */
export function computeMenuPosition(rects: readonly Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>[], clip: Box, size: { width: number; height: number }, viewport: { width: number; height: number }): MenuPosition | null {
  if (rects.length === 0) return null;
  const first = rects[0]!;
  const last = rects[rects.length - 1]!;
  const lineLeft = Math.max(first.left, clip.left);
  const lineRight = Math.min(rects.filter((r) => Math.abs(r.top - first.top) < 2).reduce((m, r) => Math.max(m, r.right), first.right), clip.right);
  const cx = (lineLeft + lineRight) / 2;
  const minTop = Math.max(clip.top, 0) + MARGIN;
  const maxTop = Math.min(clip.bottom, viewport.height) - size.height - MARGIN;
  let placement: MenuPosition['placement'] = 'above';
  let top = Math.max(first.top, clip.top) - size.height - GAP;
  if (top < minTop) {
    placement = 'below';
    top = Math.min(last.bottom, clip.bottom) + GAP;
  }
  top = Math.max(minTop, Math.min(top, maxTop));
  const minLeft = Math.max(clip.left, 0) + MARGIN;
  const maxLeft = Math.min(clip.right, viewport.width) - size.width - MARGIN;
  const left = Math.max(minLeft, Math.min(cx - size.width / 2, maxLeft));
  return { top: Math.round(top), left: Math.round(left), placement };
}

const HIGHLIGHT_NAME = 'chat-quote-source';
let stylesInjected = false;
/** The two rules the flash needs, injected once so hosts need no stylesheet of ours. */
export function ensureSelectionStyles(doc: Document): void {
  if (stylesInjected || doc.querySelector('style[data-chat-ui-selection]')) { stylesInjected = true; return; }
  const s = doc.createElement('style');
  s.setAttribute('data-chat-ui-selection', '');
  s.textContent =
    `::highlight(${HIGHLIGHT_NAME}){background-color:rgb(var(--chat-accent,110 231 183)/.35);}` +
    `[data-quote-flash]{outline:2px solid rgb(var(--chat-accent,110 231 183));outline-offset:2px;border-radius:.25rem;transition:outline-color .8s ease-out;}` +
    `[data-quote-flash="fading"]{outline-color:transparent;}` +
    `@media (prefers-reduced-motion:reduce){[data-quote-flash]{transition:none;}}`;
  doc.head.appendChild(s);
  stylesInjected = true;
}

type HighlightCtor = new (...ranges: Range[]) => unknown;
interface HighlightRegistry { set(name: string, h: unknown): void; delete(name: string): void }

/**
 * Briefly mark `range` (CSS Custom Highlight API — no DOM mutation, so React
 * never sees it) and outline `el`. Returns whether a passage highlight was drawn.
 */
export function flash(el: HTMLElement, range: Range | null, ms = 1600): boolean {
  const win = el.ownerDocument.defaultView as (Window & { Highlight?: HighlightCtor; CSS?: { highlights?: HighlightRegistry } }) | null;
  ensureSelectionStyles(el.ownerDocument);
  let drew = false;
  const reg = win?.CSS?.highlights;
  if (range && win?.Highlight && reg) {
    reg.set(HIGHLIGHT_NAME, new win.Highlight(range));
    drew = true;
  }
  el.setAttribute('data-quote-flash', range ? 'passage' : 'message');
  setTimeout(() => el.setAttribute('data-quote-flash', 'fading'), Math.max(0, ms - 800));
  setTimeout(() => {
    el.removeAttribute('data-quote-flash');
    if (drew) reg?.delete(HIGHLIGHT_NAME);
  }, ms);
  return drew;
}
