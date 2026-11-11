import { describe, expect, it, vi } from 'vitest';

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
    recoveryAttempts: options.recoveryAttempts ?? 0
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
