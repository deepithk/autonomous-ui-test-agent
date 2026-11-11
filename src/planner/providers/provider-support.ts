import { errorMessage } from '../../util/text.js';

import type { LLMGenerationRequest } from './llm-provider.js';

/**
 * Builds the error a provider throws, so each provider keeps its own
 * error class while sharing the checks below.
 */
type MakeError = (message: string) => Error;

/**
 * Checks the settings every provider needs and returns the trimmed key
 * and model name. Messages read "<Label> API key is required." and so on.
 */
export function validateProviderSettings(
  label: string,
  settings: { apiKey: string; model: string; timeoutMs: number },
  makeError: MakeError
): { apiKey: string; model: string } {
  if (!settings.apiKey.trim()) {
    throw makeError(`${label} API key is required.`);
  }

  if (!settings.model.trim()) {
    throw makeError(`${label} model name is required.`);
  }

  if (!Number.isInteger(settings.timeoutMs) || settings.timeoutMs <= 0) {
    throw makeError(
      `${label} request timeout must be a positive integer.`
    );
  }

  return {
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim()
  };
}

/**
 * Rejects a request that no provider could answer.
 */
export function validateGenerationRequest(
  request: LLMGenerationRequest,
  makeError: MakeError
): void {
  if (!request.systemInstruction.trim()) {
    throw makeError('System instruction cannot be empty.');
  }

  if (!request.prompt.trim()) {
    throw makeError('LLM prompt cannot be empty.');
  }

  if (
    !Number.isInteger(request.maxOutputTokens) ||
    request.maxOutputTokens <= 0
  ) {
    throw makeError('Maximum output tokens must be a positive integer.');
  }

  if (
    !request.responseSchema ||
    Object.keys(request.responseSchema).length === 0
  ) {
    throw makeError('A valid JSON response schema is required.');
  }
}

/**
 * Turns an error from a provider SDK into the provider's own error.
 * The API key is removed from the message, so it can never reach a log
 * or a report.
 */
export function wrapProviderError(
  label: string,
  error: unknown,
  apiKey: string,
  makeError: MakeError
): Error {
  const original = errorMessage(error, `Unknown ${label} API error`);

  return makeError(
    `${label} generation failed: ${original.replaceAll(apiKey, '[REDACTED]')}`
  );
}
