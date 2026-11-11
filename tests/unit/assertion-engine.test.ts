import { describe, expect, it, vi } from 'vitest';

import { AssertionEngine } from '../../src/executor/assertion-engine.js';

import { CaptureStore } from '../../src/executor/capture-store.js';

import { SemanticResolver } from '../../src/executor/semantic-resolver.js';

import type {
  ILLMProvider
} from '../../src/planner/providers/llm-provider.js';

import type {
  TestAssertion
} from '../../src/planner/test-plan-schema.js';

import { INVENTORY_YAML } from './fixtures/inventory-snapshot.js';

const EMPTY_CART_YAML = [
  '- banner [ref=e24]:',
  '  - button "Cart, empty" [ref=e32]',
  '- generic [ref=e40]: Your Cart'
].join('\n');

function assertion(
  overrides: Partial<TestAssertion>
): TestAssertion {
  return {
    assertionId: 'ASSERT-01',
    acceptanceCriterionId: 'AC-01',
    afterStepId: 'STEP-01',
    type: 'text',
    target: {
      description: 'Target',
      role: null,
      accessibleName: null,
      visibleText: null,
      label: null
    },
    expectedValue: 'x',
    explanation: 'Checks something.',
    ...overrides
  };
}

function setup(options: {
  yaml?: string;
  url?: string;
  refs?: string[];
  recoveryAttempts?: number;
  captured?: Record<string, string>;
}) {
  const yaml = options.yaml ?? INVENTORY_YAML;

  const callTool = vi.fn().mockImplementation(async (name: string) =>
    name === 'browser_snapshot'
      ? [
          {
            type: 'text',
            text:
              `### Page\n- Page URL: ${options.url ?? 'https://www.saucedemo.com/inventory.html'}\n` +
              `### Snapshot\n\`\`\`yaml\n${yaml}\n\`\`\``
          }
        ]
      : [{ type: 'text', text: 'ok' }]
  );

  const llm: ILLMProvider = {
    providerName: 'gemini',
    generateStructured: vi.fn().mockResolvedValue({
      text: JSON.stringify({
        refs: options.refs ?? [],
        reason: 'test'
      }),
      model: 'test'
    })
  };

  const captures = new CaptureStore();

  for (const [key, value] of Object.entries(options.captured ?? {})) {
    captures.set(key, value);
  }

  const engine = new AssertionEngine({
    browser: { callTool },
    resolver: new SemanticResolver(llm),
    captures,
    recoveryAttempts: options.recoveryAttempts ?? 0
  });

  return { engine, callTool, llm };
}

describe('AssertionEngine', () => {
  it('passes a url assertion', async () => {
    const { engine } = setup({});

    const result = await engine.evaluate(
      assertion({
        type: 'url',
        expectedValue: 'https://www.saucedemo.com/inventory.html'
      })
    );

    expect(result.status).toBe('passed');
    expect(result.actual).toBe(
      'https://www.saucedemo.com/inventory.html'
    );
  });

  it('accepts a path-only url expectation', async () => {
    const { engine } = setup({});

    const result = await engine.evaluate(
      assertion({ type: 'url', expectedValue: '/inventory.html' })
    );

    expect(result.status).toBe('passed');
  });

  it('fails a url assertion and reports the actual url', async () => {
    const { engine } = setup({ url: 'https://www.saucedemo.com/' });

    const result = await engine.evaluate(
      assertion({
        type: 'url',
        expectedValue: 'https://www.saucedemo.com/inventory.html'
      })
    );

    expect(result.status).toBe('failed');
    expect(result.actual).toBe('https://www.saucedemo.com/');
  });

  it('compares element text, using captured values', async () => {
    const { engine } = setup({
      refs: ['e53'],
      captured: { selectedProductPrice: '$29.99' }
    });

    const result = await engine.evaluate(
      assertion({
        type: 'text',
        expectedValue: '{{capture.selectedProductPrice}}'
      })
    );

    expect(result.status).toBe('passed');
    expect(result.expected).toBe('$29.99');
  });

  it('fails a text assertion with the text that was found', async () => {
    const { engine } = setup({ refs: ['e65'] });

    const result = await engine.evaluate(
      assertion({ type: 'text', expectedValue: '$29.99' })
    );

    expect(result.status).toBe('failed');
    expect(result.actual).toBe('$9.99');
  });

  it('fails a text assertion when the element is missing', async () => {
    const { engine } = setup({ refs: [] });

    const result = await engine.evaluate(
      assertion({ type: 'text', expectedValue: '1' })
    );

    expect(result.status).toBe('failed');
    expect(result.actual).toBe('element not found');
  });

  it('passes element_count 0 when nothing matches', async () => {
    const { engine } = setup({ yaml: EMPTY_CART_YAML, refs: [] });

    const result = await engine.evaluate(
      assertion({ type: 'element_count', expectedValue: '0' })
    );

    expect(result.status).toBe('passed');
    expect(result.actual).toBe('0');
  });

  it('fails element_count 0 when elements are present', async () => {
    const { engine } = setup({ refs: ['e54', 'e66'] });

    const result = await engine.evaluate(
      assertion({ type: 'element_count', expectedValue: '0' })
    );

    expect(result.status).toBe('failed');
    expect(result.actual).toBe('2');
  });

  it('reports an error for a non-numeric element_count', async () => {
    const { engine } = setup({});

    const result = await engine.evaluate(
      assertion({ type: 'element_count', expectedValue: 'many' })
    );

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/whole number/);
  });

  it('checks visibility, and absence for hidden expectations', async () => {
    const present = setup({ refs: ['e54'] });

    expect(
      (
        await present.engine.evaluate(
          assertion({ type: 'visibility', expectedValue: 'visible' })
        )
      ).status
    ).toBe('passed');

    const absent = setup({ refs: [] });

    expect(
      (
        await absent.engine.evaluate(
          assertion({ type: 'visibility', expectedValue: 'hidden' })
        )
      ).status
    ).toBe('passed');
  });

  it('reads the typed value for input_value', async () => {
    const { engine } = setup({
      yaml: '- textbox "Username" [ref=e11]: standard_user',
      refs: ['e11']
    });

    const result = await engine.evaluate(
      assertion({ type: 'input_value', expectedValue: 'standard_user' })
    );

    expect(result.status).toBe('passed');
  });

  it('reports application_state as needing manual review', async () => {
    const { engine, callTool } = setup({});

    const result = await engine.evaluate(
      assertion({ type: 'application_state' })
    );

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/manual review/);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('reports an error when a capture is missing', async () => {
    const { engine } = setup({});

    const result = await engine.evaluate(
      assertion({ expectedValue: '{{capture.unknown}}' })
    );

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/has not been captured/);
  });

  it('re-checks with a fresh snapshot before failing', async () => {
    const { engine, callTool } = setup({
      refs: [],
      recoveryAttempts: 1
    });

    const result = await engine.evaluate(
      assertion({ type: 'element_count', expectedValue: '1' })
    );

    expect(result.status).toBe('failed');

    expect(callTool.mock.calls.map(call => call[0])).toEqual([
      'browser_snapshot',
      'browser_wait_for',
      'browser_snapshot'
    ]);
  });
});
