import { SparkModel } from './meta-client.js';

/**
 * Defines model aliases for Claude Code slots.
 */
export interface ModelAliases {
  main: string;
  opus: string;
  sonnet: string;
  haiku: string;
  subagent: string;
}

/**
 * Resolves the provided model into slots used by Claude Code.
 * @param modelId The selected model id.
 * @param isContributor Whether the model is a contributor variant.
 * @returns The resolved model aliases.
 */
export function resolveAliases(modelId: string, isContributor: boolean = false): ModelAliases {
  return {
    main: modelId,
    opus: modelId,
    sonnet: modelId,
    haiku: isContributor && !modelId.includes('contributor') ? `${modelId}-contributor` : modelId,
    subagent: modelId
  };
}

/**
 * Validates whether the given model id exists in the available models.
 * @param modelId The model id to validate.
 * @param available The list of available models.
 * @returns The matched SparkModel, or null if not found.
 */
export function validateModel(modelId: string, available: SparkModel[]): SparkModel | null {
  const matched = available.find(m => m.id === modelId);
  return matched || null;
}

/**
 * Returns a warning message explaining the Contributor tier.
 * @returns The warning string.
 */
export function getContributorWarning(): string {
  return "Warning: You are using a Contributor model variant. This tier may use interactions and data for training purposes according to the Meta Model API terms.";
}
