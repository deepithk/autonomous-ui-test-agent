import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { GoogleGenAI } from '@google/genai';

import { ThinkingLevel } from '@google/genai';

import {
  GeminiProvider,
  GeminiProviderError
} from '../../src/planner/providers/gemini-provider.js';

import type {
  LLMGenerationRequest
} from '../../src/planner/providers/llm-provider.js';

const TEST_API_KEY = 'test-gemini-api-key';

const TEST_MODEL = 'gemini-test-model';

const responseSchema: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    success: {
      type: 'BOOLEAN'
    }
  },
  required: ['success']
};

function createRequest(
  overrides: Partial<LLMGenerationRequest> = {}
): LLMGenerationRequest {
  return {
    systemInstruction: 'Generate structured test plans.',
    prompt: 'Generate a test plan for SauceDemo.',
    responseSchema,
    maxOutputTokens: 2048,
    temperature: 0.1,
    ...overrides
  };
}

function createMockClient(response: unknown = {
  text: '{"success":true}',
  usageMetadata: {
    promptTokenCount: 100,
    candidatesTokenCount: 50
  },
  candidates: [
    {
      finishReason: 'STOP'
    }
  ]
}) {
  const generateContent = vi.fn().mockResolvedValue(response);

  const client = {
    models: {
      generateContent
    }
  } as unknown as GoogleGenAI;

  return {
    client,
    generateContent
  };
}

describe('GeminiProvider', () => {

  it('identifies itself as the Gemini provider', () => {
    const { client } = createMockClient();

    const provider = new GeminiProvider(
      TEST_API_KEY,
      TEST_MODEL,
      30000,
      client
    );

    expect(provider.providerName).toBe('gemini');
  });

  it('rejects an empty API key', () => {
    const { client } = createMockClient();

    expect(
      () => new GeminiProvider(
        ' ',
        TEST_MODEL,
        30000,
        client
      )
    ).toThrow('Gemini API key is required.');
  });

  it('rejects an empty model name', () => {
    const { client } = createMockClient();

    expect(
      () => new GeminiProvider(
        TEST_API_KEY,
        ' ',
        30000,
        client
      )
    ).toThrow('Gemini model name is required.');
  });

  it('rejects an invalid request timeout', () => {
    const { client } = createMockClient();

    expect(
      () => new GeminiProvider(
        TEST_API_KEY,
        TEST_MODEL,
        0,
        client
      )
    ).toThrow(
      'Gemini request timeout must be a positive integer.'
    );
  });

  it('generates structured JSON successfully', async () => {
    const { client, generateContent } = createMockClient();

    const provider = new GeminiProvider(
      TEST_API_KEY,
      TEST_MODEL,
      30000,
      client
    );

    const result = await provider.generateStructured(
      createRequest()
    );

    expect(generateContent).toHaveBeenCalledTimes(1);

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: TEST_MODEL,
        contents: 'Generate a test plan for SauceDemo.',

        config: expect.objectContaining({
          systemInstruction: 'Generate structured test plans.',
          responseMimeType: 'application/json',
          responseJsonSchema: responseSchema,
          maxOutputTokens: 2048,
          temperature: 0.1,

          httpOptions: {
            timeout: 30000
          }
        })
      })
    );

    expect(result.text).toBe('{"success":true}');
    expect(result.model).toBe(TEST_MODEL);

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50
    });

    expect(result.finishReason).toBe('STOP');
  });

  it('rejects an empty system instruction', async () => {
    const { client, generateContent } = createMockClient();

    const provider = new GeminiProvider(
      TEST_API_KEY,
      TEST_MODEL,
      30000,
      client
    );

    await expect(
      provider.generateStructured(
        createRequest({
          systemInstruction: ' '
        })
      )
    ).rejects.toThrow(
      'System instruction cannot be empty.'
    );

    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rejects an empty prompt', async () => {
    const { client, generateContent } = createMockClient();

    const provider = new GeminiProvider(
      TEST_API_KEY,
      TEST_MODEL,
      30000,
      client
    );

    await expect(
      provider.generateStructured(
        createRequest({
          prompt: ' '
        })
      )
    ).rejects.toThrow(
      'LLM prompt cannot be empty.'
    );

    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rejects an invalid maximum output token count', async () => {
    const { client, generateContent } = createMockClient();

    const provider = new GeminiProvider(
      TEST_API_KEY,
      TEST_MODEL,
      30000,
      client
    );

    await expect(
      provider.generateStructured(
        createRequest({
          maxOutputTokens: 0
        })
      )
    ).rejects.toThrow(
      'Maximum output tokens must be a positive integer.'
    );

    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rejects an empty response schema', async () => {
    const { client, generateContent } = createMockClient();

    const provider = new GeminiProvider(
      TEST_API_KEY,
      TEST_MODEL,
      30000,
      client
    );

    await expect(
      provider.generateStructured(
        createRequest({
          responseSchema: {}
        })
      )
    ).rejects.toThrow(
      'A valid JSON response schema is required.'
    );

    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rejects empty Gemini responses', async () => {
    const { client } = createMockClient({
      text: '  '
    });

    const provider = new GeminiProvider(
      TEST_API_KEY,
      TEST_MODEL,
      30000,
      client
    );

    await expect(
      provider.generateStructured(createRequest())
    ).rejects.toBeInstanceOf(GeminiProviderError);

    await expect(
      provider.generateStructured(createRequest())
    ).rejects.toThrow('Gemini returned an empty response.');
  });

  it('redacts the API key from Gemini error messages', async () => {
    const { client, generateContent } = createMockClient();

    generateContent.mockRejectedValueOnce(
      new Error(`Request failed for key ${TEST_API_KEY}`)
    );

    const provider = new GeminiProvider(
      TEST_API_KEY,
      TEST_MODEL,
      30000,
      client
    );

    let capturedError: unknown;

    try {
      await provider.generateStructured(createRequest());
    } catch (error: unknown) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(GeminiProviderError);

    const errorMessage = (capturedError as Error).message;

    expect(errorMessage).toContain('[REDACTED]');
    expect(errorMessage).not.toContain(TEST_API_KEY);
  });

  /**
   * Regression test:
   * Gemini 3 must use LOW thinking and must not receive
   * a temperature parameter.
   *
   * Also verifies the default request timeout of 120 seconds.
   */
  it('uses LOW thinking, omits temperature and applies the default timeout for Gemini 3', async () => {
    const { client, generateContent } = createMockClient();

    const provider = new GeminiProvider(
      TEST_API_KEY,
      'gemini-3.8-flash',
      undefined,
      client
    );

    await provider.generateStructured(
      createRequest({
        temperature: 0.1
      })
    );

    const request = generateContent.mock.calls[0]?.[0];

    expect(request).toBeDefined();

    expect(request.config.thinkingConfig).toEqual({
      thinkingLevel: 'LOW'
    });

    expect(request.config).not.toHaveProperty('temperature');

    expect(request.config.httpOptions).toEqual({
      timeout: 120000
    });

    expect(request.config.thinkingConfig).toEqual({
    thinkingLevel: ThinkingLevel.LOW
    });
  });

});