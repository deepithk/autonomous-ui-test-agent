import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type Anthropic from '@anthropic-ai/sdk';

import {
  AnthropicProvider,
  AnthropicProviderError
} from '../../src/planner/providers/anthropic-provider.js';

import type {
  LLMGenerationRequest
} from '../../src/planner/providers/llm-provider.js';

const TEST_API_KEY = 'test-anthropic-api-key';

const TEST_MODEL = 'claude-test-model';

const responseSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    success: {
      type: 'boolean'
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
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: TEST_MODEL,
  content: [
    {
      type: 'text',
      text: '{"success":true}'
    }
  ],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: {
    input_tokens: 100,
    output_tokens: 50
  }
}) {
  const createMessage = vi.fn().mockResolvedValue(response);

  const client = {
    messages: {
      create: createMessage
    }
  } as unknown as Anthropic;

  return {
    client,
    createMessage
  };
}

describe('AnthropicProvider', () => {

  it('identifies itself as the Anthropic provider', () => {
    const { client } = createMockClient();

    const provider = new AnthropicProvider(
      TEST_API_KEY,
      TEST_MODEL,
      30000,
      client
    );

    expect(provider.providerName).toBe('anthropic');
  });

  it('rejects an empty API key', () => {
    expect(
      () => new AnthropicProvider(
        ' ',
        TEST_MODEL
      )
    ).toThrow('Anthropic API key is required.');
  });

  it('rejects an empty model name', () => {
    const { client } = createMockClient();

    expect(
      () => new AnthropicProvider(
        TEST_API_KEY,
        ' ',
        30000,
        client
      )
    ).toThrow('Anthropic model name is required.');
  });

  it('rejects an invalid request timeout', () => {
    const { client } = createMockClient();

    expect(
      () => new AnthropicProvider(
        TEST_API_KEY,
        TEST_MODEL,
        0,
        client
      )
    ).toThrow(
      'Anthropic request timeout must be a positive integer.'
    );
  });

  it('generates structured JSON successfully', async () => {
    const { client, createMessage } = createMockClient();

    const provider = new AnthropicProvider(
      TEST_API_KEY,
      TEST_MODEL,
      30000,
      client
    );

    const result = await provider.generateStructured(
      createRequest()
    );

    expect(createMessage).toHaveBeenCalledTimes(1);

    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: TEST_MODEL,
        max_tokens: 2048,
        system: 'Generate structured test plans.',

        messages: [
          {
            role: 'user',
            content: 'Generate a test plan for SauceDemo.'
          }
        ],

        output_config: {
          format: {
            type: 'json_schema',
            schema: responseSchema
          }
        },

        temperature: 0.1
      })
    );

    expect(result.text).toBe('{"success":true}');
    expect(result.model).toBe(TEST_MODEL);

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50
    });

    expect(result.finishReason).toBe('end_turn');
  });

  it('rejects an empty system instruction', async () => {
    const { client, createMessage } = createMockClient();

    const provider = new AnthropicProvider(
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

    expect(createMessage).not.toHaveBeenCalled();
  });

  it('rejects an empty prompt', async () => {
    const { client, createMessage } = createMockClient();

    const provider = new AnthropicProvider(
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

    expect(createMessage).not.toHaveBeenCalled();
  });

  it('rejects an invalid maximum output token count', async () => {
    const { client, createMessage } = createMockClient();

    const provider = new AnthropicProvider(
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

    expect(createMessage).not.toHaveBeenCalled();
  });

  it('rejects an empty response schema', async () => {
    const { client, createMessage } = createMockClient();

    const provider = new AnthropicProvider(
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

    expect(createMessage).not.toHaveBeenCalled();
  });

  it('rejects empty Anthropic responses', async () => {
    const { client } = createMockClient({
      content: [],
      usage: {
        input_tokens: 10,
        output_tokens: 0
      }
    });

    const provider = new AnthropicProvider(
      TEST_API_KEY,
      TEST_MODEL,
      30000,
      client
    );

    await expect(
      provider.generateStructured(createRequest())
    ).rejects.toThrow(
      'Anthropic returned an empty response.'
    );
  });

  it('redacts the API key from Anthropic error messages', async () => {
    const { client, createMessage } = createMockClient();

    createMessage.mockRejectedValueOnce(
      new Error(`Request failed for key ${TEST_API_KEY}`)
    );

    const provider = new AnthropicProvider(
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

    expect(capturedError).toBeInstanceOf(
      AnthropicProviderError
    );

    const errorMessage = (capturedError as Error).message;

    expect(errorMessage).toContain('[REDACTED]');
    expect(errorMessage).not.toContain(TEST_API_KEY);
  });

});