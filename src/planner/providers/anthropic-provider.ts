import Anthropic from '@anthropic-ai/sdk';

import type {
  ILLMProvider,
  LLMGenerationRequest,
  LLMGenerationResult
} from './llm-provider.js';

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
    if (!apiKey.trim()) {
      throw new AnthropicProviderError(
        'Anthropic API key is required.'
      );
    }

    if (!model.trim()) {
      throw new AnthropicProviderError(
        'Anthropic model name is required.'
      );
    }

    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new AnthropicProviderError(
        'Anthropic request timeout must be a positive integer.'
      );
    }

    this.apiKey = apiKey.trim();
    this.model = model.trim();
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

    if (!request.systemInstruction.trim()) {
      throw new AnthropicProviderError(
        'System instruction cannot be empty.'
      );
    }

    if (!request.prompt.trim()) {
      throw new AnthropicProviderError(
        'LLM prompt cannot be empty.'
      );
    }

    if (
      !Number.isInteger(request.maxOutputTokens) ||
      request.maxOutputTokens <= 0
    ) {
      throw new AnthropicProviderError(
        'Maximum output tokens must be a positive integer.'
      );
    }

    if (
      !request.responseSchema ||
      Object.keys(request.responseSchema).length === 0
    ) {
      throw new AnthropicProviderError(
        'A valid JSON response schema is required.'
      );
    }

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

      const originalMessage =
        error instanceof Error
          ? error.message
          : 'Unknown Anthropic API error';

      // Prevent accidental credential disclosure.
      const safeMessage = originalMessage.replaceAll(
        this.apiKey,
        '[REDACTED]'
      );

      throw new AnthropicProviderError(
        `Anthropic generation failed: ${safeMessage}`
      );
    }
  }
}