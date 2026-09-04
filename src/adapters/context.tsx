'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { Adapters } from './types';

const Ctx = createContext<Adapters | null>(null);

/**
 * The single injection point for everything outside the UI. The host builds
 * one `Adapters` (usually `createHttpAdapters`, with its own authenticated
 * `fetch`) and mounts it here; nothing under this provider reaches for a
 * module-level singleton.
 *
 * Keep the `adapters` object STABLE across renders — build it at module level,
 * or memoize it on `baseUrl` — so consumers are not re-rendered for nothing.
 * The hooks are written to survive a churning object regardless (they read it
 * through a latest-value ref rather than a dependency), so a host that gets
 * this wrong loses a little render work, never a live stream.
 */
export function AdaptersProvider({ adapters, children }: { adapters: Adapters; children: ReactNode }) {
  return <Ctx.Provider value={adapters}>{children}</Ctx.Provider>;
}

export function useAdapters(): Adapters {
  const a = useContext(Ctx);
  if (!a) throw new Error('chat-ui: wrap the tree in <AdaptersProvider>');
  return a;
}

/**
 * The same context, read without the throw.
 *
 * The hooks (`useChats`, `useChatThread`, `useAttachments`) genuinely cannot do
 * anything without adapters, so `useAdapters` failing loudly is the right
 * behaviour for them. The presentational building blocks are different: a host
 * is invited to mount `<Markdown>`, `<AttachmentImage>` or `<Lightbox>` on
 * their own — to render a stored transcript, a preview, a design-system page —
 * and there is nothing for adapters to do in those cases. They consult the
 * context when it is there and fall back to the package defaults when it is
 * not, rather than turning a standalone render into a crash.
 */
export function useOptionalAdapters(): Adapters | null {
  return useContext(Ctx);
}

/**
 * The SWR key for the chat list. Every key this package creates is namespaced
 * by `adapters.id`, so two providers pointed at different backends never share
 * a cache entry — and a `mutate(chatsKey(adapters))` from the thread hook hits
 * exactly the list its own provider populated.
 */
export const chatsKey = (a: Adapters) => ['chat-ui', a.id, 'chats'] as const;
