import type { LLMProvider } from '../../config/env.js';

import { errorMessage } from '../../util/text.js';

import type {
  ILLMProvider,
  LLMGenerationRequest,
  LLMGenerationResult
} from './llm-provider.js';

/**
 * Quota and rate-limit errors. Waiting a few seconds does not help,
 * and every repeat is another counted request.
 */
const QUOTA_PATTERN =
  /RESOURCE_EXHAUSTED|\b429\b|quota|rate.?limit/i;

/**
 * True when a provider error means a quota or rate limit was reached.
 * Shared with the failure explanations, so that what is retried and
 * what is reported as a quota problem always agree.
 */
export function isQuotaError(message: string): boolean {
  return QUOTA_PATTERN.test(message);
}

/**
 * Temporary provider trouble that usually clears within seconds.
 */
const TRANSIENT_PATTERN =
  /\b(500|502|503|504|529)\b|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED|overloaded|high demand|ECONNRESET|ETIMEDOUT|empty response/i;

/**
 * Providers report errors as message text only, so detection is
 * based on that text.
 */
export function isTransientProviderError(error: unknown): boolean {
  const message = errorMessage(error);

  if (isQuotaError(message)) {
    return false;
  }

  return TRANSIENT_PATTERN.test(message);
}

export interface RetryingProviderOptions {
  /** Total attempts, including the first. */
  maxAttempts?: number;

  /** Wait before each retry, in milliseconds. */
  delaysMs?: number[];

  sleep?: (ms: number) => Promise<void>;
}

/**
 * Wraps a provider and retries temporary failures, such as
 * "model is experiencing high demand". Anything else is thrown
 * immediately.
 */
export class RetryingProvider implements ILLMProvider {
  private readonly maxAttempts: number;
  private readonly delaysMs: number[];
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly inner: ILLMProvider,
    options: RetryingProviderOptions = {}
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.delaysMs = options.delaysMs ?? [2000, 6000];

    this.sleep =
      options.sleep ??
      (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  get providerName(): LLMProvider {
    return this.inner.providerName;
  }

  async generateStructured(
    request: LLMGenerationRequest
  ): Promise<LLMGenerationResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.inner.generateStructured(request);
      } catch (error) {
        lastError = error;

        if (
          attempt === this.maxAttempts ||
          !isTransientProviderError(error)
        ) {
          throw error;
        }

        await this.sleep(
          this.delaysMs[attempt - 1] ?? this.delaysMs.at(-1) ?? 0
        );
      }
    }

    throw lastError;
  }
}
