'use client';

import { X } from 'lucide-react';
import type { Draft } from '../hooks/use-attachments';

/**
 * Composer draft thumbnails.
 *
 * Every draft is shown, including the ones that will never be sendable
 * (`error`, `missing`) — a chip that silently vanishes is indistinguishable
 * from a bug, and the user needs to know *which* image blocked the send. The
 * "why" is repeated as a one-line reason above the composer input; the chip
 * carries the short form plus the full text in `title`.
 */
export function AttachmentTray({ drafts, onRemove }: { drafts: Draft[]; onRemove: (localId: string) => void }) {
  if (drafts.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 px-2 pt-2" aria-label="Attached images">
      {drafts.map((d) => {
        const bad = d.status === 'error' || d.status === 'missing';
        return (
          <li
            key={d.localId}
            className={`relative h-16 w-16 overflow-hidden rounded-[0.25rem] border ${bad ? 'border-chat-negative/30' : 'border-chat-rule'}`}
            title={d.error ?? d.file.name}
          >
            {/* next/image needs a configured loader for blob: URLs and buys us
                nothing for a 64 px local preview — same call as attachment-image.tsx. */}
            <img
              src={d.previewUrl}
              alt={d.file.name}
              className={`h-full w-full object-cover ${d.status === 'uploading' ? 'opacity-50' : ''}`}
            />
            {d.status === 'uploading' && (
              <span className="absolute inset-x-0 bottom-0 bg-chat-surface/80 text-center text-[10px] text-chat-muted">
                uploading…
              </span>
            )}
            {bad && (
              <span className="absolute inset-x-0 bottom-0 truncate bg-chat-negative px-1 text-center text-[10px] text-chat-on-accent">
                {d.status === 'missing' ? 'expired' : 'failed'}
              </span>
            )}
            <button
              type="button"
              aria-label={`Remove ${d.file.name}`}
              onClick={() => onRemove(d.localId)}
              className="absolute right-0.5 top-0.5 rounded-full bg-chat-surface/80 p-0.5 text-chat-muted hover:text-chat-fg"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
