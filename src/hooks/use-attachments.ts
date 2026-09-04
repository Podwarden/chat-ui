'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react';
import { useAdapters } from '../adapters/context';
import { ApiError, type AttachmentOut } from '../adapters/types';
import { ALLOWED_IMAGE_MIMES, MAX_IMAGES_PER_MESSAGE, MAX_IMAGE_BYTES } from '../model/limits';

export interface Draft {
  localId: string;
  file: File;
  status: 'uploading' | 'ready' | 'error' | 'missing';
  attachment?: AttachmentOut;
  error?: string;
  previewUrl: string;
}

const NO_CHAT = 'Pick a chat first';
const BAD_TYPE = 'Only PNG, JPEG or WebP images are supported';
const TOO_MANY = `Only ${MAX_IMAGES_PER_MESSAGE} images per message`;

/**
 * Composer image drafts for one chat.
 *
 * Uploads start the moment a file is picked/dropped/pasted so the composer can
 * show progress and the turn request only has to carry attachment ids. The
 * backend requires `chat_id` on the multipart upload, so a null `chatId`
 * cannot upload at all — the files are surfaced as error drafts instead of
 * being silently dropped. Same for files past `MAX_IMAGES_PER_MESSAGE`: a
 * silently vanishing drop is indistinguishable from a bug. Drafts are
 * per-chat: switching chats clears them.
 */
export function useAttachments(chatId: string | null) {
  const adapters = useAdapters();
  // Latest-value ref: `add`/`remove` are handed straight to the (memo'd)
  // composer, so they must not change identity because a host re-rendered its
  // provider with a freshly-built Adapters object.
  const adaptersRef = useRef(adapters);
  adaptersRef.current = adapters;
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const draftsRef = useRef<Draft[]>(drafts);
  draftsRef.current = drafts;
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  const patch = useCallback((localId: string, p: Partial<Draft>) => {
    setDrafts((ds) => ds.map((d) => (d.localId === localId ? { ...d, ...p } : d)));
  }, []);

  const add = useCallback((files: File[]) => {
    if (!files.length) return;
    // only drafts that could actually be sent occupy a slot — a rejected file
    // still shown as an error chip, or one whose upload has since been evicted,
    // must not eat the user's remaining budget
    const taken = draftsRef.current.filter((d) => d.status !== 'error' && d.status !== 'missing').length;
    const room = Math.max(0, MAX_IMAGES_PER_MESSAGE - taken);
    const mk = (file: File): Draft => ({
      localId: crypto.randomUUID(), file, status: 'uploading', previewUrl: URL.createObjectURL(file),
    });
    const accepted = files.slice(0, room).map(mk);
    const overflow = files.slice(room).map((f) => ({ ...mk(f), status: 'error' as const, error: TOO_MANY }));
    setDrafts((ds) => [...ds, ...accepted, ...overflow]);

    const chat = chatIdRef.current;
    for (const d of accepted) {
      if (chat === null) { patch(d.localId, { status: 'error', error: NO_CHAT }); continue; }
      if (!(ALLOWED_IMAGE_MIMES as readonly string[]).includes(d.file.type)) {
        patch(d.localId, { status: 'error', error: BAD_TYPE });
        continue;
      }
      if (d.file.size > MAX_IMAGE_BYTES) {
        patch(d.localId, { status: 'error', error: `Image exceeds ${MAX_IMAGE_BYTES / 1024 ** 2} MB` });
        continue;
      }
      void adaptersRef.current.storage.uploadAttachment(d.file, chat)
        .then((a) => patch(d.localId, { status: 'ready', attachment: a, error: undefined }))
        .catch((e: unknown) => patch(d.localId, { status: 'error', error: e instanceof ApiError ? e.message : 'Upload failed' }));
    }
  }, [patch]);

  const remove = useCallback((localId: string) => {
    const d = draftsRef.current.find((x) => x.localId === localId);
    setDrafts((ds) => ds.filter((x) => x.localId !== localId));
    if (!d) return;
    URL.revokeObjectURL(d.previewUrl);
    if (d.attachment) void adaptersRef.current.storage.deleteDraft(d.attachment.id).catch(() => undefined);
  }, []);

  // `revokeObjectURL` is a side effect and must never run inside a setState
  // updater — React may call an updater more than once (StrictMode, a
  // discarded render), which would revoke a URL a live draft still points at.
  // Every call site below reads `draftsRef` and revokes outside the updater.
  const clear = useCallback(() => {
    for (const d of draftsRef.current) URL.revokeObjectURL(d.previewUrl);
    setDrafts([]);
  }, []);

  const markMissing = useCallback((attachmentId: string) => {
    setDrafts((ds) => ds.map((d) => (d.attachment?.id === attachmentId
      ? { ...d, status: 'missing', error: 'This image expired — remove it and attach again' }
      : d)));
  }, []);

  // drafts belong to one chat (the upload binds them to `chat_id`)
  useEffect(() => {
    const stale = draftsRef.current;
    if (!stale.length) return;
    for (const d of stale) URL.revokeObjectURL(d.previewUrl);
    setDrafts([]);
  }, [chatId]);

  // release the object URLs on unmount
  useEffect(() => () => { for (const d of draftsRef.current) URL.revokeObjectURL(d.previewUrl); }, []);

  const filesFrom = (items: DataTransferItemList | null | undefined): File[] =>
    Array.from(items ?? [])
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f && f.type.startsWith('image/'));

  const acceptDrop = useCallback((e: DragEvent | ReactDragEvent) => {
    // always swallow the drop: letting a non-image file through makes the
    // browser navigate away from the chat and lose the composer draft
    e.preventDefault();
    const fs = filesFrom(e.dataTransfer?.items);
    if (fs.length) add(fs);
  }, [add]);

  const acceptPaste = useCallback((e: ClipboardEvent | ReactClipboardEvent) => {
    // conditional: a plain text paste must still reach the textarea
    const fs = filesFrom(e.clipboardData?.items);
    if (fs.length) { e.preventDefault(); add(fs); }
  }, [add]);

  const busy = drafts.some((d) => d.status === 'uploading');
  const missing = drafts.some((d) => d.status === 'missing');
  const ready = drafts.filter((d) => d.status === 'ready' && d.attachment).map((d) => d.attachment!);
  const readyIds = ready.map((a) => a.id);

  return { drafts, readyIds, ready, add, remove, clear, markMissing, busy, missing, acceptDrop, acceptPaste };
}
