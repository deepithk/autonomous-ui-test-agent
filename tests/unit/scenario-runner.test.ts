import { describe, expect, it, vi } from 'vitest';

import { ScenarioRunner } from '../../src/executor/scenario-runner.js';

import type {
  ScenarioBrowser,
  ScenarioRunnerOptions
} from '../../src/executor/scenario-runner.js';

import { SemanticResolver } from '../../src/executor/semantic-resolver.js';

import type {
  ExecutionStep,
  TestAssertion,
  TestScenario
} from '../../src/planner/test-plan-schema.js';

const LOGIN_YAML = [
  '- form "Login" [ref=e9]:',
  '  - textbox "Username" [ref=e11]',
  '  - button "Login" [ref=e15]'
].join('\n');

const PNG_BASE64 = Buffer.from('fake-png').toString('base64');

function target(fields: Partial<ExecutionStep['target']> = {}) {
  return {
    description: 'Target',
    role: null,
    accessibleName: null,
    visibleText: null,
    label: null,
    ...fields
  };
}

function step(
  n: number,
  overrides: Partial<ExecutionStep> = {}
): ExecutionStep {
  return {
    stepId: `STEP-${String(n).padStart(2, '0')}`,
    action: 'navigate',
    instruction: 'Step',
    target: target(),
    value: 'https://www.saucedemo.com/',
    expectedObservation: 'ok',
    capture: null,
    ...overrides
  };
}

function urlAssertion(
  n: number,
  afterStepId: string,
  expected: string
): TestAssertion {
  return {
    assertionId: `ASSERT-${String(n).padStart(2, '0')}`,
    acceptanceCriterionId: 'AC-01',
    afterStepId,
    type: 'url',
    target: target(),
    expectedValue: expected,
    explanation: 'URL check.'
  };
}

function scenario(
  steps: ExecutionStep[],
  assertions: TestAssertion[]
): TestScenario {
  return {
    scenarioId: 'SC-001',
    title: 'Login',
    objective: 'Log in',
    acceptanceCriterionIds: ['AC-01'],
    preconditions: [],
    steps,
    assertions,
    expectedOutcome: 'Logged in'
  };
}

function createBrowser(
  options: { navigateDelayMs?: number; screenshots?: boolean } = {}
) {
  let url = 'about:blank';

  const close = vi.fn().mockResolvedValue(undefined);

  const callTool = vi.fn().mockImplementation(
    async (name: string, args?: Record<string, unknown>) => {
      if (name === 'browser_navigate') {
        if (options.navigateDelayMs) {
          await new Promise(resolve =>
            setTimeout(resolve, options.navigateDelayMs)
          );
        }

        url = String(args?.url);

        return [{ type: 'text', text: 'ok' }];
      }

      if (name === 'browser_click') {
        url = 'https://www.saucedemo.com/inventory.html';

        return [{ type: 'text', text: 'ok' }];
      }

      if (name === 'browser_snapshot') {
        return [
          {
            type: 'text',
            text: `- Page URL: ${url}\n### Snapshot\n\`\`\`yaml\n${LOGIN_YAML}\n\`\`\``
          }
        ];
      }

      if (name === 'browser_take_screenshot') {
        return options.screenshots === false
          ? [{ type: 'text', text: 'no image' }]
          : [
              {
                type: 'image',
                data: PNG_BASE64,
                mimeType: 'image/png'
              }
            ];
      }

      return [{ type: 'text', text: 'ok' }];
    }
  );

  const browser: ScenarioBrowser = { callTool, close };

  return { browser, callTool, close };
}

function createRunner(
  browser: ScenarioBrowser,
  overrides: Partial<ScenarioRunnerOptions> = {}
) {
  const saveScreenshot = vi
    .fn()
    .mockImplementation(async (fileName: string) => `shots/${fileName}`);

  const openBrowser = vi.fn().mockResolvedValue(browser);

  const runner = new ScenarioRunner({
    openBrowser,
    resolver: new SemanticResolver(null),
    secrets: {},
    allowedOrigin: 'https://www.saucedemo.com',
    recoveryAttempts: 0,
    maxSteps: 15,
    scenarioTimeoutMs: 5000,
    saveScreenshot,
    ...overrides
  });

  return { runner, saveScreenshot, openBrowser };
}

describe('ScenarioRunner', () => {
  it('passes when steps run and assertions hold', async () => {
    const { browser, close } = createBrowser();

    const { runner, saveScreenshot } = createRunner(browser);

    const result = await runner.run(
      scenario(
        [
          step(1),
          step(2, {
            action: 'click',
            value: null,
            target: target({ visibleText: 'Login' })
          })
        ],
        [
          urlAssertion(1, 'STEP-02', '/inventory.html')
        ]
      )
    );

    expect(result.status).toBe('passed');
    expect(result.steps.map(entry => entry.status)).toEqual([
      'passed',
      'passed'
    ]);
    expect(result.assertions[0]?.status).toBe('passed');
    expect(result.error).toBeUndefined();

    expect(saveScreenshot).toHaveBeenCalledWith(
      'SC-001_STEP-02_checkpoint.png',
      Buffer.from('fake-png')
    );

    expect(result.screenshots).toEqual([
      {
        stepId: 'STEP-02',
        reason: 'checkpoint',
        path: 'shots/SC-001_STEP-02_checkpoint.png'
      }
    ]);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('fails when an assertion does not hold', async () => {
    const { browser } = createBrowser();

    const { runner } = createRunner(browser);

    const result = await runner.run(
      scenario([step(1)], [urlAssertion(1, 'STEP-01', '/cart.html')])
    );

    expect(result.status).toBe('failed');
    expect(result.assertions[0]).toMatchObject({
      status: 'failed',
      actual: 'https://www.saucedemo.com/'
    });
  });

  it('stops at a failed step and reports what did not run', async () => {
    const { browser, close } = createBrowser();

    const { runner } = createRunner(browser);

    const result = await runner.run(
      scenario(
        [
          step(1, { value: 'https://evil.example/' }),
          step(2),
          step(3)
        ],
        [urlAssertion(1, 'STEP-03', '/')]
      )
    );

    expect(result.status).toBe('failed');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe('failed');
    expect(result.skippedStepIds).toEqual(['STEP-02', 'STEP-03']);

    expect(result.assertions[0]).toMatchObject({
      status: 'error',
      error: expect.stringContaining('Not evaluated')
    });

    expect(result.screenshots[0]).toMatchObject({
      stepId: 'STEP-01',
      reason: 'failure'
    });

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('refuses scenarios with too many steps without opening a browser', async () => {
    const { browser } = createBrowser();

    const { runner, openBrowser } = createRunner(browser, {
      maxSteps: 1
    });

    const result = await runner.run(
      scenario([step(1), step(2)], [urlAssertion(1, 'STEP-02', '/')])
    );

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/limit of 1/);
    expect(result.skippedStepIds).toEqual(['STEP-01', 'STEP-02']);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('reports an error when the browser cannot start', async () => {
    const { browser } = createBrowser();

    const { runner } = createRunner(browser, {
      openBrowser: vi.fn().mockRejectedValue(new Error('no browser'))
    });

    const result = await runner.run(
      scenario([step(1)], [urlAssertion(1, 'STEP-01', '/')])
    );

    expect(result.status).toBe('error');
    expect(result.error).toBe('no browser');
    expect(result.skippedStepIds).toEqual(['STEP-01']);
  });

  it('stops with an error when the time limit is exceeded', async () => {
    const { browser, close } = createBrowser({ navigateDelayMs: 300 });

    const { runner } = createRunner(browser, {
      scenarioTimeoutMs: 50
    });

    const result = await runner.run(
      scenario([step(1)], [urlAssertion(1, 'STEP-01', '/')])
    );

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/time limit/);
    expect(result.skippedStepIds).toEqual(['STEP-01']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps the result when screenshots are unavailable', async () => {
    const { browser } = createBrowser({ screenshots: false });

    const { runner } = createRunner(browser);

    const result = await runner.run(
      scenario([step(1)], [urlAssertion(1, 'STEP-01', '/')])
    );

    expect(result.status).toBe('passed');
    expect(result.screenshots).toEqual([]);
  });

  it('keeps the result when saving a screenshot throws', async () => {
    const { browser } = createBrowser();

    const { runner } = createRunner(browser, {
      saveScreenshot: vi.fn().mockRejectedValue(new Error('disk full'))
    });

    const result = await runner.run(
      scenario([step(1)], [urlAssertion(1, 'STEP-01', '/')])
    );

    expect(result.status).toBe('passed');
    expect(result.screenshots).toEqual([]);
  });

  it('emits events in the order things happen', async () => {
    const { browser } = createBrowser();

    const events: string[] = [];

    const { runner } = createRunner(browser, {
      onEvent: event =>
        events.push(
          event.type === 'step_finished'
            ? `step:${event.result.stepId}`
            : event.type === 'assertion_finished'
              ? `assert:${event.result.assertionId}`
              : event.type
        )
    });

    await runner.run(
      scenario([step(1)], [urlAssertion(1, 'STEP-01', '/')])
    );

    expect(events).toEqual([
      'scenario_started',
      'step:STEP-01',
      'assert:ASSERT-01',
      'screenshot_saved',
      'scenario_finished'
    ]);
  });

  it('emits not-evaluated assertions when a step fails', async () => {
    const { browser } = createBrowser();

    const events: string[] = [];

    const { runner } = createRunner(browser, {
      onEvent: event =>
        events.push(
          event.type === 'assertion_finished'
            ? `assert:${event.result.status}`
            : event.type
        )
    });

    await runner.run(
      scenario(
        [step(1, { value: 'https://evil.example/' })],
        [urlAssertion(1, 'STEP-01', '/')]
      )
    );

    expect(events).toEqual([
      'scenario_started',
      'step_finished',
      'screenshot_saved',
      'assert:error',
      'scenario_finished'
    ]);
  });

  it('is not affected by a listener that throws', async () => {
    const { browser } = createBrowser();

    const { runner } = createRunner(browser, {
      onEvent: () => {
        throw new Error('disk full');
      }
    });

    const result = await runner.run(
      scenario([step(1)], [urlAssertion(1, 'STEP-01', '/')])
    );

    expect(result.status).toBe('passed');
  });

  it('reports assertions in plan order', async () => {
    const { browser } = createBrowser();

    const { runner } = createRunner(browser);

    const result = await runner.run(
      scenario(
        [step(1), step(2)],
        [
          urlAssertion(1, 'STEP-02', '/'),
          urlAssertion(2, 'STEP-01', '/')
        ]
      )
    );

    expect(result.assertions.map(entry => entry.assertionId)).toEqual([
      'ASSERT-01',
      'ASSERT-02'
    ]);
  });
});
