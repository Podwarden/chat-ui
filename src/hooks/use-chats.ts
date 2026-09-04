'use client';
import useSWR from 'swr';
import { useCallback, useRef } from 'react';
import { chatsKey, useAdapters } from '../adapters/context';
import type { ChatSettings, ChatSummary } from '../adapters/types';

/**
 * The chat sidebar list. Mutations are optimistic where the local edit is
 * obviously correct (rename, delete) and plain otherwise (create, fork),
 * always followed by a revalidation so the server's ordering
 * (`last_message_at DESC`) and derived fields win.
 */
export function useChats() {
  const adapters = useAdapters();
  // Latest-value ref so the mutation callbacks below stay identity-stable when
  // a host re-renders its provider with a freshly-built Adapters object. The
  // SWR key and fetcher are unaffected either way — `chatsKey` serialises to
  // the same array, and SWR only refetches when the KEY changes.
  const adaptersRef = useRef(adapters);
  adaptersRef.current = adapters;
  const { data, error, isLoading, mutate } = useSWR<ChatSummary[]>(chatsKey(adapters), () => adapters.storage.listChats(), {
    revalidateOnFocus: true,
  });
  const chats = data ?? [];

  const create = useCallback(async (body: { model?: string | null; settings?: Partial<ChatSettings> } = {}) => {
    const c = await adaptersRef.current.storage.createChat(body);
    await mutate();
    return c;
  }, [mutate]);

  // The optimistic edit must be rolled back when the request fails, so the
  // revalidation runs from a `finally` — otherwise a failed rename/delete
  // leaves the sidebar showing a change the server never made.
  const rename = useCallback(async (id: string, title: string) => {
    await mutate((prev) => prev?.map((c) => (c.id === id ? { ...c, title, title_source: 'user' as const } : c)), { revalidate: false });
    try { await adaptersRef.current.storage.patchChat(id, { title }); } finally { await mutate(); }
  }, [mutate]);

  const remove = useCallback(async (id: string) => {
    await mutate((prev) => prev?.filter((c) => c.id !== id), { revalidate: false });
    try { await adaptersRef.current.storage.deleteChat(id); } finally { await mutate(); }
  }, [mutate]);

  const removeAll = useCallback(async () => {
    const r = await adaptersRef.current.storage.deleteAllChats();
    await mutate([], { revalidate: true });
    return r.deleted;
  }, [mutate]);

  const fork = useCallback(async (id: string, at_seq: number, edited_text?: string) => {
    const c = await adaptersRef.current.storage.fork(id, { at_seq, edited_text });
    await mutate();
    return c;
  }, [mutate]);

  return { chats, isLoading, error: error as Error | undefined, create, rename, remove, removeAll, fork, mutate };
}
