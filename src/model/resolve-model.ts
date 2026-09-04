import type { ModelInfo } from '../adapters/types';

/**
 * Which loaded model a chat is actually talking to.
 *
 * The exact id is the answer whenever the deployment still has it. The second
 * rule exists for the host that runs ONE deployment-wide model and never shows
 * the user a picker at all: there, a chat row naming something else — an
 * operator who renamed the deployment, a chat forked from an older one, a
 * default that moved — is a stale label on the only model there is, not a
 * missing model. Reporting "not loaded" in that deployment is both wrong and
 * unactionable: the UI would send the user to a Settings panel the host has
 * very likely hidden, to pick from a list of one.
 *
 * With two or more models loaded the miss is real and stays a miss: guessing
 * one of several would put the wrong context window, pricing and vision flag
 * in front of the user.
 *
 * Exported from the package root so a host can apply the same rule to its own
 * chrome (a model name in a header, say) instead of re-deriving it.
 */
export function resolveActiveModel(models: readonly ModelInfo[], chatModel: string | null | undefined): ModelInfo | null {
  const exact = models.find((m) => m.id === chatModel);
  if (exact) return exact;
  return models.length === 1 ? models[0] : null;
}
