'use client';
import { useEffect, useState } from 'react';

/**
 * The visual viewport's height and top, while `on`: the part of the screen the
 * browser's toolbars and the on-screen keyboard actually leave. Mobile Safari
 * resizes neither `100vh` nor the layout viewport for either, so a box sized
 * by them runs under the keyboard and under an expanded toolbar; a `fixed` box
 * set to this follows both. `null` when off, on the server, and where the API
 * is missing — the caller's own sizing then applies.
 */
export function useVisualViewport(on: boolean): { height: number; top: number } | null {
  const [vv, setVv] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const v = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!on || !v) { setVv(null); return; }
    const update = () => setVv({ height: v.height, top: v.offsetTop });
    update();
    v.addEventListener('resize', update);
    v.addEventListener('scroll', update);
    return () => { v.removeEventListener('resize', update); v.removeEventListener('scroll', update); };
  }, [on]);
  return vv;
}
