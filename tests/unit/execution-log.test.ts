import { describe, expect, it } from 'vitest';

import { formatLogEvent } from '../../src/executor/execution-log.js';

import type {
  ExecutionEvent
} from '../../src/executor/scenario-runner.js';

const AT = new Date('2026-11-11T05:00:01.123Z');

const STAMP = '2026-11-11T05:00:01.123Z';

describe('formatLogEvent', () => {
  it('logs the start of a scenario', () => {
    expect(
      formatLogEvent(
        {
          type: 'scenario_started',
          scenarioId: 'SC-001',
          title: 'Verify successful login'
        },
        AT
      )
    ).toBe(`${STAMP} [SC-001] SCENARIO START "Verify successful login"`);
  });

  it('logs a passed step with how its element was found', () => {
    const line = formatLogEvent(
      {
        type: 'step_finished',
        scenarioId: 'SC-001',
        action: 'fill',
        targetDescription: 'Username field',
        result: {
          stepId: 'STEP-02',
          status: 'passed',
          durationMs: 120,
          resolution: {
            method: 'deterministic',
            element: 'textbox "Username"',
            ref: 'e11',
            reason: 'Exactly one element matched the plan fields.'
          }
        }
      },
      AT
    );

    expect(line).toBe(
      `${STAMP} [SC-001] [STEP-02] fill "Username field" -> ` +
      'textbox "Username" (matched by plan fields) PASSED 120 ms'
    );
  });

  it('logs an element chosen by the LLM and a captured value', () => {
    const line = formatLogEvent(
      {
        type: 'step_finished',
        scenarioId: 'SC-002',
        action: 'observe',
        targetDescription: 'First product title',
        result: {
          stepId: 'STEP-05',
          status: 'passed',
          durationMs: 900,
          resolution: {
            method: 'llm',
            element: 'button "View details for Sauce Labs Backpack"',
            ref: 'e49',
            reason: 'First product.'
          },
          captured: {
            key: 'selectedProductName',
            value: 'Sauce Labs Backpack'
          }
        }
      },
      AT
    );

    expect(line).toContain('(chosen by LLM: "First product.")');
    expect(line).toContain(
      'captured selectedProductName="Sauce Labs Backpack"'
    );
  });

  it('marks an answer that was reused', () => {
    const line = formatLogEvent(
      {
        type: 'step_finished',
        scenarioId: 'SC-003',
        action: 'click',
        targetDescription: 'Add to cart',
        result: {
          stepId: 'STEP-07',
          status: 'passed',
          durationMs: 9,
          resolution: {
            method: 'llm',
            element: 'button "Add to cart"',
            ref: 'e54',
            reason: 'Belongs to the Backpack.',
            cached: true
          }
        }
      },
      AT
    );

    expect(line).toContain(
      '(chosen by LLM, answer reused: "Belongs to the Backpack.")'
    );
  });

  it('shortens a long LLM reason', () => {
    const line = formatLogEvent(
      {
        type: 'step_finished',
        scenarioId: 'SC-003',
        action: 'click',
        targetDescription: 'Cart',
        result: {
          stepId: 'STEP-08',
          status: 'passed',
          durationMs: 9,
          resolution: {
            method: 'llm',
            element: 'button "Cart"',
            ref: 'e1',
            reason: 'r'.repeat(500)
          }
        }
      },
      AT
    );

    expect(line).toContain('...');
    expect(line.length).toBeLessThan(400);
  });

  it('logs what the page showed when something went wrong', () => {
    expect(
      formatLogEvent(
        {
          type: 'page_observed',
          scenarioId: 'SC-001',
          context: {
            stepId: 'STEP-04',
            url: 'https://www.saucedemo.com/',
            notes: ['Epic sadface: locked out', 'Second']
          }
        },
        AT
      )
    ).toBe(
      `${STAMP} [SC-001] [STEP-04] PAGE url=https://www.saucedemo.com/ ` +
      'messages: "Epic sadface: locked out"; "Second"'
    );

    expect(
      formatLogEvent(
        {
          type: 'page_observed',
          scenarioId: 'SC-001',
          context: { stepId: 'STEP-04', url: 'u', notes: [] }
        },
        AT
      )
    ).toContain('messages: no alerts or error messages');
  });

  it('logs a failed step on one line', () => {
    const line = formatLogEvent(
      {
        type: 'step_finished',
        scenarioId: 'SC-002',
        action: 'click',
        targetDescription: 'Cart',
        result: {
          stepId: 'STEP-06',
          status: 'failed',
          durationMs: 4,
          error: 'No element matched\n"Cart"   icon'
        }
      },
      AT
    );

    expect(line).toBe(
      `${STAMP} [SC-002] [STEP-06] click "Cart" ` +
      'FAILED: No element matched "Cart" icon 4 ms'
    );

    expect(line).not.toContain('\n');
  });

  it('logs assertions with expected and actual values', () => {
    const passed = formatLogEvent(
      {
        type: 'assertion_finished',
        scenarioId: 'SC-001',
        result: {
          assertionId: 'ASSERT-01',
          acceptanceCriterionId: 'AC-01',
          afterStepId: 'STEP-04',
          type: 'url',
          status: 'passed',
          expected: '/inventory.html',
          actual: 'https://www.saucedemo.com/inventory.html',
          explanation: 'On inventory.',
          durationMs: 5
        }
      },
      AT
    );

    expect(passed).toBe(
      `${STAMP} [SC-001] [ASSERT-01] AC-01 url after STEP-04 ` +
      'expected="/inventory.html" ' +
      'actual="https://www.saucedemo.com/inventory.html" PASSED'
    );

    const errored = formatLogEvent(
      {
        type: 'assertion_finished',
        scenarioId: 'SC-001',
        result: {
          assertionId: 'ASSERT-02',
          acceptanceCriterionId: 'AC-02',
          afterStepId: 'STEP-05',
          type: 'text',
          status: 'error',
          expected: 'x',
          actual: '',
          explanation: 'e',
          durationMs: 0,
          error: 'Not evaluated: STEP-05 failed.'
        }
      },
      AT
    );

    expect(errored).toContain('ERROR: Not evaluated: STEP-05 failed.');
  });

  it('logs screenshots and the end of a scenario', () => {
    expect(
      formatLogEvent(
        {
          type: 'screenshot_saved',
          scenarioId: 'SC-001',
          stepId: 'STEP-04',
          reason: 'checkpoint',
          path: 'screenshots/run/SC-001_STEP-04_checkpoint.png'
        },
        AT
      )
    ).toBe(
      `${STAMP} [SC-001] [STEP-04] SCREENSHOT checkpoint ` +
      'screenshots/run/SC-001_STEP-04_checkpoint.png'
    );

    const finished: ExecutionEvent = {
      type: 'scenario_finished',
      scenarioId: 'SC-001',
      status: 'failed',
      durationMs: 1500,
      error: 'STEP-06 failed: boom'
    };

    expect(formatLogEvent(finished, AT)).toBe(
      `${STAMP} [SC-001] SCENARIO END FAILED 1500 ms STEP-06 failed: boom`
    );
  });
});
