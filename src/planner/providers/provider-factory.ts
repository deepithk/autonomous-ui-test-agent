import type { AppConfig } from '../../config/env.js';

import { GeminiProvider } from './gemini-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';

import type { ILLMProvider } from './llm-provider.js';

/**
 * Configuration required to initialize an LLM provider.
 */
export type LLMProviderConfig = Pick<
  AppConfig,
  'LLM_PROVIDER' | 'LLM_MODEL' | 'LLM_API_KEY'
>;

export class LLMProviderFactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMProviderFactoryError';
  }
}

/**
 * Creates the configured LLM provider.
 *
 * Provider selection is controlled exclusively
 * through LLM_PROVIDER.
 */
export function createLLMProvider(
  config: LLMProviderConfig
): ILLMProvider {
  const apiKey = config.LLM_API_KEY.trim();
  const model = config.LLM_MODEL.trim();

  if (!apiKey) {
    throw new LLMProviderFactoryError(
      'LLM_API_KEY is required to initialize the selected provider.'
    );
  }

  if (!model) {
    throw new LLMProviderFactoryError(
      'LLM_MODEL is required to initialize the selected provider.'
    );
  }

  switch (config.LLM_PROVIDER) {
    case 'gemini':
      return new GeminiProvider(apiKey, model);

    case 'anthropic':
      return new AnthropicProvider(apiKey, model);

    default: {
      const unsupportedProvider: never = config.LLM_PROVIDER;

      throw new LLMProviderFactoryError(
        `Unsupported LLM provider: ${unsupportedProvider}`
      );
    }
  }
}