'use client';
import { useMemo } from 'react';
import type { ModelInfo } from '../adapters/types';
import type { ContextInfo } from '../model/message';
import { computeContext, type ContextMeter } from '../model/context-meter';

export interface ContextMeterArgs {
  context: ContextInfo | null;
  draftText: string;
  draftImages: number;
  model: ModelInfo | null;
  maxTokens: number;
}

/**
 * The composer's context meter: server-reported prompt tokens plus a local
 * estimate for the un-sent draft, against the model's window. The catalog's
 * `context_window` wins over the last streamed `context` frame's `window`
 * (the model may have been switched since).
 */
export function useContextMeter(a: ContextMeterArgs): ContextMeter {
  const { context, draftText, draftImages, model, maxTokens } = a;
  return useMemo(() => computeContext({
    promptTokens: context?.promptTokens ?? 0,
    window: model?.context_window ?? context?.window ?? null,
    draftText,
    draftImages,
    imageTokens: model?.image_tokens_estimate ?? 1000,
    maxTokens,
  }), [context, draftText, draftImages, model, maxTokens]);
}
