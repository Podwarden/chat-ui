'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Modal } from '@/ui/modal';
import { useOptionalAdapters } from '../adapters/context';
import type { AttachmentOut } from '../adapters/types';

// Shows the raster via its signed URL through the shared `Modal` (focus
// trap/restore, Escape-to-close, backdrop click) — no "open in new tab"
// affordance (spec §5). Per controller ruling, `AttachmentOut.url` is `null`
// once the row is evicted — the lightbox must not render in that case
// (nothing to show). The URL is read through
// `adapters.storage.attachmentUrl(a)` rather than off the row, so a host that
// resolves attachment bytes differently is honoured here as well as in
// <AttachmentImage> — falling back to `a.url` when this public building block
// is rendered outside an <AdaptersProvider>.
//
// Zoom & pan (user request, 2026-08-24): plain vertical scroll — mouse wheel
// or two-finger trackpad — zooms continuously around the cursor; holding the
// left button and moving pans (both axes) by scrolling the overflowing
// viewport. The +/- buttons still step through fixed levels for
// keyboard/discoverability, and the viewport stays focusable so arrow keys
// pan too. Zoom resets whenever a different attachment opens.
export interface LightboxProps {
  attachment: AttachmentOut | null;
  onClose: () => void;
  /** Forwarded to `Modal` (which root goes `inert` while it is open). */
  rootInertId?: string;
}

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4] as const;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
/** exp() slope per wheel-delta unit — ~10% zoom per 65px notch. */
const WHEEL_ZOOM_SLOPE = 0.0015;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export function Lightbox({ attachment, onClose, rootInertId }: LightboxProps) {
  const adapters = useOptionalAdapters();
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // A wheel zoom must keep the image point under the cursor stationary; the
  // scroll correction can only run AFTER React re-renders the new width, so
  // the handler parks the anchor here for the layout effect below.
  const anchorRef = useRef<{ cx: number; cy: number; ratio: number } | null>(null);
  const dragLast = useRef<{ x: number; y: number } | null>(null);
  const onWheelRef = useRef((e: WheelEvent) => {
    if (e.deltaY === 0) return; // horizontal-only gesture: let it pan
    e.preventDefault();
    const vp = viewportRef.current;
    if (!vp) return;
    const prev = zoomRef.current;
    const next = clampZoom(prev * Math.exp(-e.deltaY * WHEEL_ZOOM_SLOPE));
    if (next === prev) return;
    const rect = vp.getBoundingClientRect();
    anchorRef.current = { cx: e.clientX - rect.left, cy: e.clientY - rect.top, ratio: next / prev };
    setZoom(next);
  });

  // Reset zoom when the shown attachment changes (or the lightbox reopens).
  const id = attachment?.id;
  useEffect(() => { setZoom(1); }, [id]);

  // React attaches wheel listeners passively, so `preventDefault` inside
  // `onWheel` cannot stop the page scroll — the zoom gesture needs a native
  // non-passive listener. A callback ref (not an effect) attaches it: the
  // shared Modal portals its children after mount, so an effect keyed on the
  // attachment would run before the viewport exists and never re-fire.
  const setViewport = useCallback((vp: HTMLDivElement | null) => {
    viewportRef.current?.removeEventListener('wheel', onWheelRef.current);
    viewportRef.current = vp;
    if (vp) vp.addEventListener('wheel', onWheelRef.current, { passive: false });
  }, []);

  // Apply the parked cursor anchor once the new zoom has been rendered: the
  // content point that was under the cursor (scroll + cursor offset) scales by
  // `ratio`; scrolling to `point*ratio - cursor` keeps it stationary.
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    const a = anchorRef.current;
    anchorRef.current = null;
    if (!vp || !a) return;
    vp.scrollLeft = (vp.scrollLeft + a.cx) * a.ratio - a.cx;
    vp.scrollTop = (vp.scrollTop + a.cy) * a.ratio - a.cy;
  }, [zoom]);

  const stepTo = useCallback((d: 1 | -1) => {
    setZoom((z) => {
      // Snap to the neighbouring fixed level relative to the continuous zoom.
      const next = d === 1
        ? ZOOM_LEVELS.find((l) => l > z + 1e-3)
        : [...ZOOM_LEVELS].reverse().find((l) => l < z - 1e-3);
      return next ?? z;
    });
  }, []);

  const url = attachment ? (adapters ? adapters.storage.attachmentUrl(attachment) : attachment.url) : null;
  if (!attachment || url === null) return null;

  const dims = attachment.width && attachment.height ? `${attachment.width}×${attachment.height} · ` : '';
  return (
    <Modal open onClose={onClose} title="Image preview" size="lg" rootInertId={rootInertId}>
      <div
        ref={setViewport}
        tabIndex={0}
        aria-label="Image viewport — scroll to zoom, drag to pan"
        className={`max-h-[70vh] overflow-auto rounded-[0.25rem] focus:[outline:none] focus:ring-1 focus:ring-chat-accent ${
          zoom > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragLast.current = { x: e.clientX, y: e.clientY };
          setDragging(true);
          // keep receiving moves outside the viewport; absent in jsdom
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const vp = viewportRef.current;
          const last = dragLast.current;
          if (!vp || !last) return;
          vp.scrollLeft -= e.clientX - last.x;
          vp.scrollTop -= e.clientY - last.y;
          dragLast.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => { dragLast.current = null; setDragging(false); }}
        onPointerCancel={() => { dragLast.current = null; setDragging(false); }}
      >
        <img
          src={url}
          alt=""
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          className={zoom === 1 ? 'max-h-[70vh] w-full select-none object-contain' : 'max-w-none select-none'}
          style={zoom === 1 ? undefined : { width: `${zoom * 100}%` }}
        />
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-chat-dim">
        <span>{dims}{(attachment.size_bytes / 1024).toFixed(0)} kB</span>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => stepTo(-1)}
            className="rounded-[0.25rem] p-1 text-chat-muted hover:text-chat-accent disabled:opacity-40">
            <ZoomOut className="h-4 w-4" aria-hidden />
          </button>
          <span className="w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => stepTo(1)}
            className="rounded-[0.25rem] p-1 text-chat-muted hover:text-chat-accent disabled:opacity-40">
            <ZoomIn className="h-4 w-4" aria-hidden />
          </button>
        </span>
      </div>
    </Modal>
  );
}
