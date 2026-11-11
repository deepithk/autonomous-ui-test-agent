import { describe, expect, it } from 'vitest';

import {
  validateGenerationRequest,
  validateProviderSettings,
  wrapProviderError
} from '../../src/planner/providers/provider-support.js';

import type {
  LLMGenerationRequest
} from '../../src/planner/providers/llm-provider.js';

class TestError extends Error {}

const make = (message: string): Error => new TestError(message);

const REQUEST: LLMGenerationRequest = {
  systemInstruction: 'system',
  prompt: 'prompt',
  responseSchema: { type: 'object' },
  maxOutputTokens: 100
};

describe('validateProviderSettings', () => {
  it('returns the trimmed key and model', () => {
    expect(
      validateProviderSettings(
        'Test',
        { apiKey: ' key ', model: ' model ', timeoutMs: 1000 },
        make
      )
    ).toEqual({ apiKey: 'key', model: 'model' });
  });

  it.each([
    [{ apiKey: ' ', model: 'm', timeoutMs: 1 }, 'Test API key is required.'],
    [{ apiKey: 'k', model: ' ', timeoutMs: 1 }, 'Test model name is required.'],
    [
      { apiKey: 'k', model: 'm', timeoutMs: 0 },
      'Test request timeout must be a positive integer.'
    ],
    [
      { apiKey: 'k', model: 'm', timeoutMs: 1.5 },
      'Test request timeout must be a positive integer.'
    ]
  ])('rejects %j', (settings, message) => {
    expect(() => validateProviderSettings('Test', settings, make)).toThrow(
      new TestError(message)
    );
  });
});

describe('validateGenerationRequest', () => {
  it('accepts a complete request', () => {
    expect(() => validateGenerationRequest(REQUEST, make)).not.toThrow();
  });

  it.each([
    [{ systemInstruction: ' ' }, 'System instruction cannot be empty.'],
    [{ prompt: '' }, 'LLM prompt cannot be empty.'],
    [{ maxOutputTokens: 0 }, 'Maximum output tokens must be a positive integer.'],
    [{ maxOutputTokens: 2.5 }, 'Maximum output tokens must be a positive integer.'],
    [{ responseSchema: {} }, 'A valid JSON response schema is required.']
  ])('rejects a request with %j', (change, message) => {
    expect(() =>
      validateGenerationRequest({ ...REQUEST, ...change }, make)
    ).toThrow(message);
  });
});

describe('wrapProviderError', () => {
  it('removes the API key from the message', () => {
    const wrapped = wrapProviderError(
      'Test',
      new Error('failed for secret-key-123 today'),
      'secret-key-123',
      make
    );

    expect(wrapped).toBeInstanceOf(TestError);
    expect(wrapped.message).toBe(
      'Test generation failed: failed for [REDACTED] today'
    );
  });

  it('uses a provider-specific message when the error is not an Error', () => {
    expect(
      wrapProviderError('Test', { weird: true }, 'key', make).message
    ).toBe('Test generation failed: Unknown Test API error');
  });
});
