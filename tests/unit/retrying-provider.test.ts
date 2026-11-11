import { describe, expect, it, vi } from 'vitest';

import {
  RetryingProvider,
  isTransientProviderError
} from '../../src/planner/providers/retrying-provider.js';

import type {
  ILLMProvider
} from '../../src/planner/providers/llm-provider.js';

const REQUEST = {
  systemInstruction: 's',
  prompt: 'p',
  responseSchema: { type: 'object' },
  maxOutputTokens: 10
};

const OK = { text: '{}', model: 'm' };

function createInner(
  ...outcomes: Array<Error | typeof OK>
): ILLMProvider & { generateStructured: ReturnType<typeof vi.fn> } {
  const generateStructured = vi.fn();

  for (const outcome of outcomes) {
    if (outcome instanceof Error) {
      generateStructured.mockRejectedValueOnce(outcome);
    } else {
      generateStructured.mockResolvedValueOnce(outcome);
    }
  }

  return { providerName: 'gemini', generateStructured };
}

describe('isTransientProviderError', () => {
  it.each([
    'Gemini generation failed: {"error":{"code":503,"status":"UNAVAILABLE"}}',
    'The model is currently experiencing high demand.',
    'Anthropic generation failed: 529 overloaded_error',
    'read ECONNRESET',
    'Gemini returned an empty response.'
  ])('treats "%s" as transient', message => {
    expect(isTransientProviderError(new Error(message))).toBe(true);
  });

  it.each([
    'Gemini generation failed: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}',
    'You exceeded your current quota',
    'rate limit reached',
    'API key not valid',
    'Invalid JSON schema'
  ])('does not treat "%s" as transient', message => {
    expect(isTransientProviderError(new Error(message))).toBe(false);
  });

  it('never retries quota errors even when they mention a 503 elsewhere', () => {
    expect(
      isTransientProviderError(
        new Error('quota exceeded, upstream 503')
      )
    ).toBe(false);
  });
});

describe('RetryingProvider', () => {
  it('returns the first successful result without waiting', async () => {
    const inner = createInner(OK);
    const sleep = vi.fn();

    const provider = new RetryingProvider(inner, { sleep });

    await expect(provider.generateStructured(REQUEST)).resolves.toBe(OK);

    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a transient failure with the configured waits', async () => {
    const inner = createInner(
      new Error('503 UNAVAILABLE'),
      new Error('503 UNAVAILABLE'),
      OK
    );

    const sleep = vi.fn().mockResolvedValue(undefined);

    const provider = new RetryingProvider(inner, {
      sleep,
      delaysMs: [10, 20]
    });

    await expect(provider.generateStructured(REQUEST)).resolves.toBe(OK);

    expect(inner.generateStructured).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it('gives up after the maximum attempts', async () => {
    const inner = createInner(
      new Error('503 UNAVAILABLE'),
      new Error('503 UNAVAILABLE'),
      new Error('503 UNAVAILABLE')
    );

    const provider = new RetryingProvider(inner, {
      sleep: vi.fn().mockResolvedValue(undefined)
    });

    await expect(
      provider.generateStructured(REQUEST)
    ).rejects.toThrow(/503/);

    expect(inner.generateStructured).toHaveBeenCalledTimes(3);
  });

  it('does not retry quota errors', async () => {
    const inner = createInner(new Error('429 RESOURCE_EXHAUSTED'));

    const sleep = vi.fn();

    const provider = new RetryingProvider(inner, { sleep });

    await expect(
      provider.generateStructured(REQUEST)
    ).rejects.toThrow(/429/);

    expect(inner.generateStructured).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('exposes the wrapped provider name', () => {
    expect(
      new RetryingProvider(createInner()).providerName
    ).toBe('gemini');
  });
});
