import { describe, expect, it, vi } from 'vitest';

import { BrowserSessionError } from '../../src/executor/browser-session.js';

import { CaptureStore } from '../../src/executor/capture-store.js';

import { SemanticResolver } from '../../src/executor/semantic-resolver.js';

import {
  StepExecutor
} from '../../src/executor/step-executor.js';

import type {
  ExecutionStep
} from '../../src/planner/test-plan-schema.js';

import type {
  ILLMProvider
} from '../../src/planner/providers/llm-provider.js';

import { INVENTORY_YAML } from './fixtures/inventory-snapshot.js';

function step(overrides: Partial<ExecutionStep>): ExecutionStep {
  return {
    stepId: 'STEP-01',
    action: 'click',
    instruction: 'Do something',
    target: {
      description: 'Target',
      role: null,
      accessibleName: null,
      visibleText: null,
      label: null
    },
    value: null,
    expectedObservation: 'Something happens',
    capture: null,
    ...overrides
  };
}

function target(
  fields: Partial<ExecutionStep['target']>
): ExecutionStep['target'] {
  return {
    description: 'Target',
    role: null,
    accessibleName: null,
    visibleText: null,
    label: null,
    ...fields
  };
}

function setup(
  options: {
    snapshot?: string;
    llmRef?: string;
    secrets?: Record<string, string>;
    recoveryAttempts?: number;
    selfHeal?: boolean;
  } = {}
) {
  const yaml = options.snapshot ?? INVENTORY_YAML;

  const callTool = vi.fn().mockImplementation(async (name: string) =>
    name === 'browser_snapshot'
      ? [{ type: 'text', text: `### Snapshot\n\`\`\`yaml\n${yaml}\n\`\`\`` }]
      : [{ type: 'text', text: 'ok' }]
  );

  const llm: ILLMProvider = {
    providerName: 'gemini',
    generateStructured: vi.fn().mockResolvedValue({
      text: JSON.stringify({
        ref: options.llmRef ?? '',
        reason: 'test choice'
      }),
      model: 'test'
    })
  };

  const captures = new CaptureStore(options.secrets ?? {});

  const executor = new StepExecutor({
    browser: { callTool },
    resolver: new SemanticResolver(llm),
    captures,
    allowedOrigin: 'https://www.saucedemo.com',
    recoveryAttempts: options.recoveryAttempts ?? 0,
    networkRetryDelayMs: 0,
    selfHeal: options.selfHeal ?? false
  });

  return { executor, callTool, captures, llm };
}

describe('StepExecutor', () => {
  it('navigates to an allowed URL', async () => {
    const { executor, callTool } = setup();

    const result = await executor.execute(
      step({
        action: 'navigate',
        value: 'https://www.saucedemo.com/'
      })
    );

    expect(result.status).toBe('passed');

    expect(callTool).toHaveBeenCalledWith('browser_navigate', {
      url: 'https://www.saucedemo.com/'
    });
  });

  describe('self-healing', () => {
    const NOT_FOUND = JSON.stringify({ ref: '', reason: 'No such element.' });

    const HEALED = JSON.stringify({
      ref: 'e54',
      reason: 'The button was renamed but does the same thing.'
    });

    const checkoutStep = () =>
      step({
        action: 'click',
        instruction: 'Click the checkout button',
        expectedObservation: 'The checkout page opens',
        target: target({ description: 'Checkout button' })
      });

    const answers = (
      llm: { generateStructured: unknown },
      ...texts: string[]
    ) => {
      const generate = llm.generateStructured as ReturnType<typeof vi.fn>;

      for (const text of texts) {
        generate.mockResolvedValueOnce({ text, model: 'test' });
      }

      return generate;
    };

    const clickCalls = (callTool: ReturnType<typeof vi.fn>) =>
      callTool.mock.calls.filter(call => call[0] === 'browser_click');

    it('uses a replacement element when the planned one is not found', async () => {
      const { executor, callTool, llm } = setup({ selfHeal: true });

      const generate = answers(llm, NOT_FOUND, HEALED);

      const result = await executor.execute(checkoutStep());

      expect(result.status).toBe('passed');

      expect(result.healed).toEqual({
        problem: expect.stringContaining('No element matched'),
        repair: 'used button "Add to cart" instead',
        reason: 'The button was renamed but does the same thing.'
      });

      expect(clickCalls(callTool)[0]?.[1]).toMatchObject({ target: 'e54' });
      expect(generate).toHaveBeenCalledTimes(2);
    });

    it('tells the LLM what the step was for and what went wrong', async () => {
      const { executor, llm } = setup({ selfHeal: true });

      const generate = answers(llm, NOT_FOUND, HEALED);

      await executor.execute(checkoutStep());

      const request = generate.mock.calls[1]?.[0];

      expect(request.prompt).toContain('Click the checkout button');
      expect(request.prompt).toContain('The checkout page opens');
      expect(request.prompt).toContain('Problem: No element matched');
      expect(request.systemInstruction).toContain('different state');
    });

    it('fails with both messages when healing finds nothing', async () => {
      const { executor, callTool, llm } = setup({ selfHeal: true });

      answers(
        llm,
        NOT_FOUND,
        JSON.stringify({ ref: '', reason: 'A login error is showing.' })
      );

      const result = await executor.execute(checkoutStep());

      expect(result.status).toBe('failed');
      expect(result.error).toContain('No element matched');
      expect(result.error).toContain('Self-healing also failed');
      expect(result.error).toContain('A login error is showing.');
      expect(result.healed).toBeUndefined();
      expect(clickCalls(callTool)).toHaveLength(0);
    });

    it('rejects a replacement that is not on the page', async () => {
      const { executor, llm } = setup({ selfHeal: true });

      answers(llm, NOT_FOUND, JSON.stringify({ ref: 'e999', reason: 'Guess.' }));

      const result = await executor.execute(checkoutStep());

      expect(result.status).toBe('failed');
      expect(result.error).toContain('not in the snapshot');
    });

    it('does not heal unless it is switched on', async () => {
      const { executor, llm } = setup();

      const generate = answers(llm, NOT_FOUND, HEALED);

      const result = await executor.execute(checkoutStep());

      expect(result.status).toBe('failed');
      expect(result.healed).toBeUndefined();
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('does not heal when the LLM provider itself fails', async () => {
      const { executor, llm } = setup({ selfHeal: true });

      const generate = llm.generateStructured as ReturnType<typeof vi.fn>;

      generate.mockRejectedValue(new Error('429 quota exceeded'));

      const result = await executor.execute(checkoutStep());

      expect(result.status).toBe('failed');
      expect(result.error).toContain('429 quota exceeded');
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('looks the element up again and retries when the browser refuses the click', async () => {
      const { executor, callTool } = setup({ selfHeal: true });

      let clicks = 0;

      callTool.mockImplementation(async (name: string) => {
        if (name === 'browser_snapshot') {
          return [
            {
              type: 'text',
              text: '```yaml\n- combobox "Sort products" [ref=e38]\n```'
            }
          ];
        }

        if (name === 'browser_click' && ++clicks === 1) {
          throw new BrowserSessionError(
            'Tool "browser_click" failed: element is not visible'
          );
        }

        return [{ type: 'text', text: 'ok' }];
      });

      const result = await executor.execute(
        step({
          action: 'click',
          target: target({ role: 'combobox', accessibleName: 'Sort products' })
        })
      );

      expect(result.status).toBe('passed');
      expect(clicks).toBe(2);

      expect(result.healed).toMatchObject({
        problem: expect.stringContaining('element is not visible'),
        repair: expect.stringContaining('retried on combobox "Sort products"')
      });
    });

    it('fails with the second error when the retried action also fails', async () => {
      const { executor, callTool } = setup({ selfHeal: true });

      callTool.mockImplementation(async (name: string) => {
        if (name === 'browser_snapshot') {
          return [
            {
              type: 'text',
              text: '```yaml\n- button "Login" [ref=e15]\n```'
            }
          ];
        }

        if (name === 'browser_click') {
          throw new BrowserSessionError(
            'Tool "browser_click" failed: covered by a popup'
          );
        }

        return [{ type: 'text', text: 'ok' }];
      });

      const result = await executor.execute(
        step({
          action: 'click',
          target: target({ visibleText: 'Login' })
        })
      );

      expect(result.status).toBe('failed');
      expect(result.error).toContain('covered by a popup');
      expect(clickCalls(callTool)).toHaveLength(2);
    });

    it('does not retry a browser refusal when healing is off', async () => {
      const { executor, callTool } = setup();

      callTool.mockImplementation(async (name: string) => {
        if (name === 'browser_snapshot') {
          return [
            {
              type: 'text',
              text: '```yaml\n- button "Login" [ref=e15]\n```'
            }
          ];
        }

        if (name === 'browser_click') {
          throw new BrowserSessionError('Tool "browser_click" failed: no');
        }

        return [{ type: 'text', text: 'ok' }];
      });

      const result = await executor.execute(
        step({ action: 'click', target: target({ visibleText: 'Login' }) })
      );

      expect(result.status).toBe('failed');
      expect(clickCalls(callTool)).toHaveLength(1);
    });

    it('does not retry an action that failed for another reason', async () => {
      const { executor, callTool } = setup({ selfHeal: true });

      callTool.mockImplementation(async (name: string) => {
        if (name === 'browser_snapshot') {
          return [
            {
              type: 'text',
              text: '```yaml\n- button "Login" [ref=e15]\n```'
            }
          ];
        }

        if (name === 'browser_click') {
          throw new Error('something unexpected in our own code');
        }

        return [{ type: 'text', text: 'ok' }];
      });

      const result = await executor.execute(
        step({ action: 'click', target: target({ visibleText: 'Login' }) })
      );

      expect(result.status).toBe('failed');
      expect(clickCalls(callTool)).toHaveLength(1);
    });

    it('never puts a typed secret into the healing record', async () => {
      const { executor, callTool } = setup({
        selfHeal: true,
        secrets: { SAUCEDEMO_PASSWORD: 'secret_sauce' }
      });

      let typed = 0;

      callTool.mockImplementation(async (name: string) => {
        if (name === 'browser_snapshot') {
          return [
            {
              type: 'text',
              text: '```yaml\n- textbox "Password" [ref=e13]\n```'
            }
          ];
        }

        if (name === 'browser_type' && ++typed === 1) {
          throw new BrowserSessionError(
            'Tool "browser_type" failed: could not type secret_sauce'
          );
        }

        return [{ type: 'text', text: 'ok' }];
      });

      const result = await executor.execute(
        step({
          action: 'fill',
          target: target({ label: 'Password' }),
          value: '{{SAUCEDEMO_PASSWORD}}'
        })
      );

      expect(result.status).toBe('passed');
      expect(result.healed?.problem).toContain('[REDACTED]');
      expect(JSON.stringify(result)).not.toContain('secret_sauce');
    });
  });

  describe('navigation network errors', () => {
    const NETWORK_ERROR = new Error(
      'Tool "browser_navigate" failed: net::ERR_NETWORK_CHANGED'
    );

    const navigateStep = () =>
      step({ action: 'navigate', value: 'https://www.saucedemo.com/' });

    const navigateCalls = (callTool: ReturnType<typeof vi.fn>) =>
      callTool.mock.calls.filter(call => call[0] === 'browser_navigate');

    it('retries once after a network error and then succeeds', async () => {
      const { executor, callTool } = setup();

      callTool.mockRejectedValueOnce(NETWORK_ERROR);

      const result = await executor.execute(navigateStep());

      expect(result.status).toBe('passed');
      expect(navigateCalls(callTool)).toHaveLength(2);
    });

    it('fails after the one retry when the network is still down', async () => {
      const { executor, callTool } = setup();

      callTool.mockRejectedValue(NETWORK_ERROR);

      const result = await executor.execute(navigateStep());

      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/ERR_NETWORK_CHANGED/);
      expect(navigateCalls(callTool)).toHaveLength(2);
    });

    it('does not retry other errors', async () => {
      const { executor, callTool } = setup();

      callTool.mockRejectedValue(new Error('Tool failed: something else'));

      const result = await executor.execute(navigateStep());

      expect(result.status).toBe('failed');
      expect(navigateCalls(callTool)).toHaveLength(1);
    });
  });

  it('refuses to navigate to another origin', async () => {
    const { executor, callTool } = setup();

    const result = await executor.execute(
      step({ action: 'navigate', value: 'https://evil.example/' })
    );

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/not allowed/);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('clicks the element resolved from a fresh snapshot', async () => {
    const { executor, callTool } = setup();

    const result = await executor.execute(
      step({
        action: 'click',
        target: target({
          role: 'combobox',
          accessibleName: 'Sort products'
        })
      })
    );

    expect(result.status).toBe('passed');
    expect(result.resolution?.method).toBe('deterministic');

    expect(callTool).toHaveBeenNthCalledWith(1, 'browser_snapshot');

    expect(callTool).toHaveBeenNthCalledWith(2, 'browser_click', {
      element: 'combobox "Sort products"',
      target: 'e38'
    });
  });

  it('captures observed text and renders it in later steps', async () => {
    const { executor, callTool, captures } = setup({
      llmRef: 'e66'
    });

    const observed = await executor.execute(
      step({
        action: 'observe',
        target: target({ description: 'Price of the bike light' }),
        capture: { key: 'selectedProductPrice', source: 'text' }
      })
    );

    // The fake LLM answers e66 (a button), so its own name is the text.
    expect(observed.captured).toEqual({
      key: 'selectedProductPrice',
      value: 'Add to cart'
    });

    expect(captures.get('selectedProductPrice')).toBe('Add to cart');

    await executor.execute(
      step({ action: 'press_key', value: '{{capture.selectedProductPrice}}' })
    );

    expect(callTool).toHaveBeenLastCalledWith('browser_press_key', {
      key: 'Add to cart'
    });
  });

  it('types a secret into the field without exposing it', async () => {
    const { executor, callTool } = setup({
      snapshot: `- textbox "Username" [ref=e11]\n- button "Login" [ref=e15]`,
      secrets: { SAUCEDEMO_USERNAME: 'standard_user' }
    });

    const result = await executor.execute(
      step({
        action: 'fill',
        target: target({ label: 'Username' }),
        value: '{{SAUCEDEMO_USERNAME}}'
      })
    );

    expect(result.status).toBe('passed');

    expect(callTool).toHaveBeenLastCalledWith('browser_type', {
      element: 'textbox "Username"',
      target: 'e11',
      text: 'standard_user'
    });

    expect(JSON.stringify(result)).not.toContain('standard_user');
  });

  it('redacts secrets from failure messages', async () => {
    const { executor, callTool } = setup({
      snapshot: `- textbox "Password" [ref=e13]`,
      secrets: { SAUCEDEMO_PASSWORD: 'secret_sauce' }
    });

    callTool.mockImplementation(async (name: string) => {
      if (name === 'browser_snapshot') {
        return [
          {
            type: 'text',
            text: '```yaml\n- textbox "Password" [ref=e13]\n```'
          }
        ];
      }

      throw new Error('typing secret_sauce failed');
    });

    const result = await executor.execute(
      step({
        action: 'fill',
        target: target({ label: 'Password' }),
        value: '{{SAUCEDEMO_PASSWORD}}'
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error).toBe('typing [REDACTED] failed');
  });

  it('fails when a required value is missing', async () => {
    const { executor } = setup();

    const result = await executor.execute(
      step({ action: 'press_key', value: null })
    );

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/requires a value/);
  });

  it('fails when a capture is used before it is set', async () => {
    const { executor } = setup();

    const result = await executor.execute(
      step({
        action: 'press_key',
        value: '{{capture.selectedProductName}}'
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/has not been captured/);
  });

  it('does not retry when the LLM provider itself fails', async () => {
    const { executor, callTool, llm } = setup({ recoveryAttempts: 2 });

    (llm.generateStructured as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('429 quota exceeded ' + 'x'.repeat(2000))
    );

    const result = await executor.execute(
      step({
        action: 'click',
        target: target({ description: 'Checkout button' })
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/^429 quota exceeded/);
    expect(result.error).toContain('[truncated]');
    expect(result.error?.length).toBeLessThan(500);

    // One snapshot, one LLM call: no retries.
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  });

  it('retries element lookup with a fresh snapshot', async () => {
    const { executor, callTool } = setup({
      recoveryAttempts: 1,
      llmRef: ''
    });

    const result = await executor.execute(
      step({
        action: 'click',
        target: target({ description: 'Checkout button' })
      })
    );

    expect(result.status).toBe('failed');

    const names = callTool.mock.calls.map(call => call[0]);

    expect(names).toEqual([
      'browser_snapshot',
      'browser_wait_for',
      'browser_snapshot'
    ]);
  });
});
