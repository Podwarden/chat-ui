'use client';

import { ImageOff } from 'lucide-react';
import { useOptionalAdapters } from '../adapters/context';
import type { AttachmentOut } from '../adapters/types';

/**
 * Renders an image attachment by its signed URL, or an "image expired"
 * placeholder — sized from the row's stored `width`/`height` (falling back to
 * a 4:3 box when neither is known) — when the attachment is missing, has
 * been evicted, or its signed `url` has gone `null` (evicted rows never keep
 * a servable URL; see `app/chat2/routes_attachments.py:_serialize`).
 *
 * The URL comes from `adapters.storage.attachmentUrl(a)`, never from
 * `a.url` directly: that method is the adapter seam for hosts whose attachment
 * bytes do not live at the URL the row carries (a proxy, a rewritten
 * instance-scoped path, a blob the host resolves itself). The HTTP adapter's
 * implementation is `a => a.url`, so nothing changes for the default host —
 * and rendered outside an <AdaptersProvider> (this is a public building block)
 * the component falls back to `a.url` itself, which is what that adapter would
 * have returned anyway.
 */
export function AttachmentImage({
  attachment,
  attachmentId,
  onOpen,
  className,
}: {
  attachment?: AttachmentOut;
  attachmentId: string;
  onOpen?: (a: AttachmentOut) => void;
  className?: string;
}) {
  const adapters = useOptionalAdapters();
  const url = attachment ? (adapters ? adapters.storage.attachmentUrl(attachment) : attachment.url) : null;
  if (!attachment || attachment.evicted || url === null) {
    const w = attachment?.width ?? 4;
    const h = attachment?.height ?? 3;
    return (
      <div
        data-testid="expired-placeholder"
        style={{ aspectRatio: `${w} / ${h}` }}
        className={`flex max-w-xs items-center justify-center rounded-[0.25rem] border border-dashed border-chat-rule bg-chat-surface/50 text-xs text-chat-dim ${className ?? ''}`}
      >
        <ImageOff className="mr-1 h-4 w-4" aria-hidden /> image expired
      </div>
    );
  }
  const img = (
    // Signed attachment URLs are short-lived and backend-signed, not next/image-loader
    // friendly; a plain <img> matches the existing pattern in godmode-media.tsx.
    <img
      src={url}
      alt="attached image"
      width={attachment.width ?? undefined}
      height={attachment.height ?? undefined}
      loading="lazy"
      decoding="async"
      className={`max-h-64 max-w-xs rounded-[0.25rem] border border-chat-rule object-contain ${className ?? ''}`}
      data-attachment-id={attachmentId}
    />
  );
  return onOpen ? (
    <button type="button" aria-label="Open image" onClick={() => onOpen(attachment)} className="block">
      {img}
    </button>
  ) : (
    img
  );
}
