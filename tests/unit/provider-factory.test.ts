import { describe, expect, it } from 'vitest';

import {
  createLLMProvider,
  LLMProviderFactoryError,
  type LLMProviderConfig
} from '../../src/planner/providers/provider-factory.js';

const validConfig: LLMProviderConfig = {
  LLM_PROVIDER: 'gemini',
  LLM_MODEL: 'gemini-test-model',
  LLM_API_KEY: 'test-gemini-api-key'
};

describe('LLM Provider Factory', () => {

  it('creates the Gemini provider', () => {
    const provider = createLLMProvider(validConfig);

    expect(provider.providerName).toBe('gemini');
  });

  it('rejects a missing API key', () => {
    expect(() =>
      createLLMProvider({
        ...validConfig,
        LLM_API_KEY: ''
      })
    ).toThrow(
      'LLM_API_KEY is required to initialize the selected provider.'
    );
  });

  it('rejects a missing model name', () => {
    expect(() =>
      createLLMProvider({
        ...validConfig,
        LLM_MODEL: ''
      })
    ).toThrow(
      'LLM_MODEL is required to initialize the selected provider.'
    );
  });

  
  it('creates the Anthropic provider', () => {
    const provider = createLLMProvider({
        ...validConfig,
        LLM_PROVIDER: 'anthropic'
    });

    expect(provider.providerName).toBe('anthropic');
  });

  it('throws a typed factory error for invalid configuration', () => {
    try {
      createLLMProvider({
        ...validConfig,
        LLM_API_KEY: ''
      });

      throw new Error('Expected factory initialization to fail.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(LLMProviderFactoryError);
    }
  });

});