// Mirrors spec §context meter: history + in-flight draft + reserve vs. the
// model's context window. `window` is null until the backend reports one
// (e.g. before the first turn's usage frame), in which case we still show
// the draft estimate but cannot compute a fraction.
import { CONTEXT_AMBER, RESERVE_CAP_TOKENS } from './limits';

export interface ContextInput {
  promptTokens: number;
  window: number | null;
  draftText: string;
  draftImages: number;
  imageTokens: number;
  maxTokens: number;
}

export interface ContextMeter {
  state: 'unknown' | 'ok' | 'warn' | 'full';
  history: number;
  draft: number;
  reserve: number;
  window: number | null;
  fraction: number | null;
}

export function estimateDraftTokens(text: string, images: number, imageTokens: number): number {
  return Math.ceil(text.length / 4) + images * imageTokens;
}

export function computeContext(i: ContextInput): ContextMeter {
  const draft = estimateDraftTokens(i.draftText, i.draftImages, i.imageTokens);
  const reserve = Math.min(i.maxTokens, RESERVE_CAP_TOKENS);
  if (i.window === null || i.window <= 0) {
    return { state: 'unknown', history: i.promptTokens, draft, reserve, window: null, fraction: null };
  }
  const fraction = (i.promptTokens + draft + reserve) / i.window;
  const state = fraction >= 1 ? 'full' : fraction >= CONTEXT_AMBER ? 'warn' : 'ok';
  return { state, history: i.promptTokens, draft, reserve, window: i.window, fraction };
}
