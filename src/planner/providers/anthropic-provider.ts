import Anthropic from '@anthropic-ai/sdk';

import type {
  ILLMProvider,
  LLMGenerationRequest,
  LLMGenerationResult
} from './llm-provider.js';

import {
  validateGenerationRequest,
  validateProviderSettings,
  wrapProviderError
} from './provider-support.js';

/**
 * Anthropic provider errors.
 *
 * API credentials are never included in error messages.
 */
export class AnthropicProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnthropicProviderError';
  }
}

const fail = (message: string): Error =>
  new AnthropicProviderError(message);

/**
 * Anthropic Claude implementation of the common LLM interface.
 *
 * Uses:
 * - Official Anthropic TypeScript SDK
 * - Structured JSON output
 * - Configurable model
 * - Request timeout
 * - Disabled automatic retries to avoid unexpected
 *   repeated API requests
 */
export class AnthropicProvider implements ILLMProvider {
  readonly providerName = 'anthropic' as const;

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(
    apiKey: string,
    model: string,
    timeoutMs = 120000,
    client?: Anthropic
  ) {
    const settings = validateProviderSettings(
      'Anthropic',
      { apiKey, model, timeoutMs },
      fail
    );

    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.timeoutMs = timeoutMs;

    // Optional client injection allows isolated unit testing.
    this.client = client ?? new Anthropic({
      apiKey: this.apiKey,
      timeout: this.timeoutMs,
      maxRetries: 0
    });
  }

  /**
   * Generates structured JSON using Claude.
   */
  async generateStructured(
    request: LLMGenerationRequest
  ): Promise<LLMGenerationResult> {

    validateGenerationRequest(request, fail);

    try {
      const response = await this.client.messages.create({
        model: this.model,

        max_tokens: request.maxOutputTokens,

        system: request.systemInstruction,

        messages: [
          {
            role: 'user',
            content: request.prompt
          }
        ],

        output_config: {
          format: {
            type: 'json_schema',
            schema: request.responseSchema
          }
        },

        ...(request.temperature !== undefined
          ? { temperature: request.temperature }
          : {})
      });

      const generatedText = response.content
        .filter(
          (block): block is Anthropic.TextBlock =>
            block.type === 'text'
        )
        .map(block => block.text)
        .join('\n')
        .trim();

      if (!generatedText) {
        throw new AnthropicProviderError(
          'Anthropic returned an empty response.'
        );
      }

      return {
        text: generatedText,

        model: response.model || this.model,

        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens
        },

        finishReason: response.stop_reason ?? undefined
      };

    } catch (error: unknown) {

      if (error instanceof AnthropicProviderError) {
        throw error;
      }

      // The key is removed from the message before it is rethrown.
      throw wrapProviderError('Anthropic', error, this.apiKey, fail);
    }
  }
}