'use client';
// Where the package's overlays (Modal, and through it the confirm dialogs, the
// fork dialog and the lightbox) portal to. `null` — the default, and what every
// component sees outside a provider — is `document.body`, as before 0.1.27.
//
// A host element instead keeps the overlays inside the box the chat lives in:
// a widget panel, an iframe's root. The overlay is then `absolute`, so that
// element must be positioned (`relative`, `fixed`, …) for it to fill it.
import { createContext, useContext } from 'react';

const PortalContainerContext = createContext<HTMLElement | null>(null);
/**
 * `true` while the host has the chat out of sight (a closed widget panel that
 * stays mounted). Every Modal renders closed meanwhile — no inert page, no
 * document key listener — and comes back with the panel.
 */
const OverlaysSuspendedContext = createContext(false);
export const OverlaysSuspendedProvider = OverlaysSuspendedContext.Provider;
export function useOverlaysSuspended(): boolean {
  return useContext(OverlaysSuspendedContext);
}

export const PortalContainerProvider = PortalContainerContext.Provider;

/** The element overlays portal into, or `null` for `document.body`. */
export function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContainerContext);
}
