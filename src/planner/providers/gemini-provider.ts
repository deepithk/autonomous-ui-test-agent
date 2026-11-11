import {
  GoogleGenAI,
  ThinkingLevel
} from '@google/genai';

import type { ILLMProvider } from './llm-provider.js';

import type {
  LLMGenerationRequest,
  LLMGenerationResult
} from './llm-provider.js';

/**
 * Gemini provider errors.
 *
 * API credentials are never included in error messages.
 */
export class GeminiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiProviderError';
  }
}

/**
 * Google Gemini implementation of the common LLM interface.
 *
 * Uses:
 * - Google Gen AI SDK
 * - Structured JSON output
 * - Configurable model
 * - Configurable request timeout
 * - Gemini 3 thinking-level optimization
 * - Credential-safe error handling
 */
export class GeminiProvider implements ILLMProvider {
  readonly providerName = 'gemini' as const;

  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(
    apiKey: string,
    model: string,
    timeoutMs = 120000,
    client?: GoogleGenAI
  ) {
    if (!apiKey.trim()) {
      throw new GeminiProviderError(
        'Gemini API key is required.'
      );
    }

    if (!model.trim()) {
      throw new GeminiProviderError(
        'Gemini model name is required.'
      );
    }

    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new GeminiProviderError(
        'Gemini request timeout must be a positive integer.'
      );
    }

    this.apiKey = apiKey.trim();
    this.model = model.trim();
    this.timeoutMs = timeoutMs;

    // Optional client injection allows isolated unit testing.
    this.client = client ?? new GoogleGenAI({
      apiKey: this.apiKey
    });
  }

  /**
   * Generates structured JSON using Gemini.
   */
  async generateStructured(
    request: LLMGenerationRequest
  ): Promise<LLMGenerationResult> {

    if (!request.systemInstruction.trim()) {
      throw new GeminiProviderError(
        'System instruction cannot be empty.'
      );
    }

    if (!request.prompt.trim()) {
      throw new GeminiProviderError(
        'LLM prompt cannot be empty.'
      );
    }

    if (
      !Number.isInteger(request.maxOutputTokens) ||
      request.maxOutputTokens <= 0
    ) {
      throw new GeminiProviderError(
        'Maximum output tokens must be a positive integer.'
      );
    }

    if (
      !request.responseSchema ||
      Object.keys(request.responseSchema).length === 0
    ) {
      throw new GeminiProviderError(
        'A valid JSON response schema is required.'
      );
    }

    // Gemini 3 models use thinking levels rather than
    // temperature sampling for reasoning control.
    const isGemini3 = /^gemini-3(?:\.|$)/i.test(this.model);

    try {
      const response =
        await this.client.models.generateContent({
          model: this.model,

          contents: request.prompt,

          config: {
            systemInstruction: request.systemInstruction,

            responseMimeType: 'application/json',

            responseJsonSchema: request.responseSchema,

            maxOutputTokens: request.maxOutputTokens,

            ...(isGemini3
              ? {
                  thinkingConfig: {
                    thinkingLevel: ThinkingLevel.LOW
                  }
                }
              : request.temperature !== undefined
                ? {
                    temperature: request.temperature
                  }
                : {}),

            httpOptions: {
              timeout: this.timeoutMs
            }
          }
        });

      const generatedText = response.text;

      if (!generatedText?.trim()) {
        throw new GeminiProviderError(
          'Gemini returned an empty response.'
        );
      }

      return {
        text: generatedText,

        model: this.model,

        usage: {
          inputTokens:
            response.usageMetadata?.promptTokenCount,

          outputTokens:
            response.usageMetadata?.candidatesTokenCount
        },

        finishReason:
          response.candidates?.[0]?.finishReason?.toString()
      };

    } catch (error: unknown) {

      if (error instanceof GeminiProviderError) {
        throw error;
      }

      const originalMessage =
        error instanceof Error
          ? error.message
          : 'Unknown Gemini API error';

      // Prevent accidental credential disclosure.
      const safeMessage = originalMessage.replaceAll(
        this.apiKey,
        '[REDACTED]'
      );

      throw new GeminiProviderError(
        `Gemini generation failed: ${safeMessage}`
      );
    }
  }
}