import type { LLMProvider } from '../../config/env.js';

/**
 * Common request contract for all supported LLM providers.
 *
 * Provider implementations are responsible for translating
 * this request into their respective SDK/API format.
 */
export interface LLMGenerationRequest {
  systemInstruction: string;
  prompt: string;

  /**
   * JSON Schema supplied by the common planning layer.
   * Providers should enforce structured JSON output where supported.
   */
  responseSchema: Record<string, unknown>;

  maxOutputTokens: number;
  temperature?: number;
}

/**
 * Provider-independent response.
 */
export interface LLMGenerationResult {
  text: string;
  model: string;

  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };

  finishReason?: string;
}

/**
 * Contract every LLM provider adapter must implement.
 *
 * No Gemini-specific or Anthropic-specific SDK types
 * should appear in this interface.
 */
export interface ILLMProvider {
  readonly providerName: LLMProvider;

  generateStructured(
    request: LLMGenerationRequest
  ): Promise<LLMGenerationResult>;
}