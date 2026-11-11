import { describe, expect, it } from 'vitest';

import {
  analyzeFailures,
  classifyMessage
} from '../../src/executor/failure-analysis.js';

import type {
  ScenarioResult
} from '../../src/executor/scenario-runner.js';

function scenario(overrides: Partial<ScenarioResult>): ScenarioResult {
  return {
    scenarioId: 'SC-001',
    title: 'Verify login',
    acceptanceCriterionIds: ['AC-01'],
    status: 'failed',
    steps: [],
    skippedStepIds: [],
    assertions: [],
    screenshots: [],
    durationMs: 10,
    ...overrides
  };
}

const failedAssertion = {
  assertionId: 'ASSERT-01',
  acceptanceCriterionId: 'AC-01',
  afterStepId: 'STEP-04',
  type: 'url' as const,
  status: 'failed' as const,
  expected: '/inventory.html',
  actual: 'https://www.saucedemo.com/',
  explanation: 'On inventory.',
  durationMs: 1
};

describe('classifyMessage', () => {
  it.each([
    ['Gemini generation failed: 429 RESOURCE_EXHAUSTED quota', 'llm-provider', /quota/],
    ['Gemini generation failed: 503 UNAVAILABLE', 'llm-provider', /again/],
    ['Gemini returned an empty response.', 'llm-provider', /API key/],
    ['Scenario exceeded its 60000 ms time limit.', 'limit', /SCENARIO_TIMEOUT_MS/],
    ['Tool "browser_navigate" failed: net::ERR_NETWORK_CHANGED at https://x', 'environment', /network problem, not the application/],
    ['MCP error -32001: Request timed out', 'environment', /ACTION_TIMEOUT_MS/],
    ['Tool "browser_click" failed: Timeout 5000ms exceeded.', 'environment', /slow to respond/],
    ['Navigation to https://evil.example is not allowed.', 'automation', /blocked/],
    ['No element matched "Cart"', 'automation', /not found on the page/],
    ['something unexpected', 'automation', /execution log/]
  ] as const)('classifies "%s" as %s', (message, category, advice) => {
    const result = classifyMessage(message);

    expect(result.category).toBe(category);
    expect(result.advice).toMatch(advice);
  });

  it('treats a quota error as not an application defect', () => {
    expect(
      classifyMessage('429 quota exceeded 503').advice
    ).toMatch(/not an application defect/);
  });
});

describe('analyzeFailures', () => {
  it('has nothing to say about a passing scenario', () => {
    expect(
      analyzeFailures(scenario({ status: 'passed' }))
    ).toEqual([]);
  });

  it('explains a failed assertion with expected, actual and page context', () => {
    const findings = analyzeFailures(
      scenario({
        assertions: [failedAssertion],
        failureContext: {
          stepId: 'STEP-04',
          url: 'https://www.saucedemo.com/',
          notes: ['Epic sadface: this user has been locked out.']
        },
        screenshots: [
          {
            stepId: 'STEP-04',
            reason: 'checkpoint',
            path: 'screenshots/run/SC-001_STEP-04_checkpoint.png'
          }
        ]
      })
    );

    expect(findings).toHaveLength(1);

    expect(findings[0]).toMatchObject({
      category: 'application',
      criterionIds: ['AC-01'],
      expected: '/inventory.html',
      actual: 'https://www.saucedemo.com/',
      pageUrl: 'https://www.saucedemo.com/',
      pageNotes: ['Epic sadface: this user has been locked out.'],
      screenshots: ['screenshots/run/SC-001_STEP-04_checkpoint.png']
    });

    expect(findings[0]?.summary).toContain(
      'expected "/inventory.html" but the page showed'
    );
  });

  it('explains a failed step and does not list the assertions it blocked', () => {
    const findings = analyzeFailures(
      scenario({
        steps: [
          {
            stepId: 'STEP-05',
            status: 'failed',
            durationMs: 5,
            error: 'No element matched "First product"'
          }
        ],
        assertions: [
          {
            ...failedAssertion,
            status: 'error',
            error: 'Not evaluated: STEP-05 failed: boom.'
          }
        ],
        screenshots: [
          {
            stepId: 'STEP-05',
            reason: 'failure',
            path: 'screenshots/run/SC-001_STEP-05_failure.png'
          }
        ]
      })
    );

    expect(findings).toHaveLength(1);

    expect(findings[0]).toMatchObject({
      category: 'automation',
      stepId: 'STEP-05',
      screenshots: ['screenshots/run/SC-001_STEP-05_failure.png']
    });
  });

  it('keeps both the original problem and the failed self-healing in the summary', () => {
    const message =
      'No element matched "First product": the inventory is not visible. ' +
      'Self-healing also failed: No alternative element found for ' +
      '"First product": the page shows a login error.';

    const findings = analyzeFailures(
      scenario({
        steps: [
          { stepId: 'STEP-05', status: 'failed', durationMs: 5, error: message }
        ]
      })
    );

    expect(findings[0]?.summary).toContain(message);
    expect(findings[0]?.summary).not.toContain('...');
  });

  it('reports a provider problem as not an application defect', () => {
    const findings = analyzeFailures(
      scenario({
        steps: [
          {
            stepId: 'STEP-06',
            status: 'failed',
            durationMs: 5,
            error: 'Gemini generation failed: 429 RESOURCE_EXHAUSTED'
          }
        ]
      })
    );

    expect(findings[0]?.category).toBe('llm-provider');
    expect(findings[0]?.advice).toMatch(/not an application defect/);
  });

  it('explains an assertion that could not be checked', () => {
    const findings = analyzeFailures(
      scenario({
        status: 'error',
        assertions: [
          {
            ...failedAssertion,
            status: 'error',
            error: 'application_state assertions need manual review.'
          }
        ]
      })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.summary).toContain('could not be checked');
  });

  it('explains a scenario that stopped without a step or assertion to blame', () => {
    const findings = analyzeFailures(
      scenario({
        status: 'error',
        error: 'Scenario exceeded its 60000 ms time limit.',
        assertions: [
          {
            ...failedAssertion,
            status: 'error',
            error: 'Not evaluated: Scenario exceeded its time limit.'
          }
        ]
      })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe('limit');
  });
});
