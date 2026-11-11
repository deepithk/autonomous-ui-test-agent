import { describe, expect, it, vi } from 'vitest';

import {
  renderMarkdownReport,
  runExecutionWorkflow
} from '../../src/executor/execution-workflow.js';

import type {
  ExecutionRunReport
} from '../../src/executor/execution-workflow.js';

import type {
  ScenarioResult
} from '../../src/executor/scenario-runner.js';

import type {
  PlanningRunReport
} from '../../src/planner/planning-workflow.js';

import type {
  GeneratedTestPlan,
  TestScenario
} from '../../src/planner/test-plan-schema.js';

function makeScenario(id: string, criterion: string): TestScenario {
  return {
    scenarioId: id,
    title: `Scenario ${id}`,
    objective: 'Objective',
    acceptanceCriterionIds: [criterion],
    preconditions: [],
    steps: [
      {
        stepId: 'STEP-01',
        action: 'navigate',
        instruction: 'Open the site',
        target: {
          description: 'Site',
          role: null,
          accessibleName: null,
          visibleText: null,
          label: null
        },
        value: 'https://www.saucedemo.com/',
        expectedObservation: 'Site opens',
        capture: null
      }
    ],
    assertions: [
      {
        assertionId: 'ASSERT-01',
        acceptanceCriterionId: criterion,
        afterStepId: 'STEP-01',
        type: 'url',
        target: {
          description: 'Page',
          role: null,
          accessibleName: null,
          visibleText: null,
          label: null
        },
        expectedValue: 'https://www.saucedemo.com/',
        explanation: 'On the site.'
      }
    ],
    expectedOutcome: 'Site is open'
  };
}

function makePlanReport(
  plan: GeneratedTestPlan | unknown = {
    planTitle: 'Plan',
    summary: 'Summary',
    scenarios: [
      makeScenario('SC-001', 'AC-01'),
      makeScenario('SC-002', 'AC-02')
    ]
  }
): PlanningRunReport {
  return {
    generatedAt: '2026-11-11T00:00:00.000Z',
    source: {
      repository: 'owner/repo',
      issueNumber: 1,
      issueTitle: 'Cart feature',
      issueUrl: 'https://github.com/owner/repo/issues/1',
      projectTitle: 'Board',
      projectStatus: 'RFQA',
      projectStatusSource: 'project-v2'
    },
    llm: { provider: 'gemini', model: 'test-model' },
    acceptanceCriteria: [
      { id: 'AC-01', title: 'Login works', description: 'd' },
      { id: 'AC-02', title: 'Cart | badge', description: 'd' }
    ],
    generatedPlan: plan as GeneratedTestPlan,
    executionStatus: 'NOT_EXECUTED'
  };
}

function makeResult(
  scenario: TestScenario,
  status: ScenarioResult['status'],
  assertionStatus: 'passed' | 'failed' | 'error' = 'passed'
): ScenarioResult {
  return {
    scenarioId: scenario.scenarioId,
    title: scenario.title,
    acceptanceCriterionIds: scenario.acceptanceCriterionIds,
    status,
    steps: [
      { stepId: 'STEP-01', status: 'passed', durationMs: 5 }
    ],
    skippedStepIds: status === 'error' ? ['STEP-02'] : [],
    assertions: scenario.assertions.map(assertion => ({
      assertionId: assertion.assertionId,
      acceptanceCriterionId: assertion.acceptanceCriterionId,
      afterStepId: assertion.afterStepId,
      type: assertion.type,
      status: assertionStatus,
      expected: 'a | b',
      actual: 'a | c',
      explanation: assertion.explanation,
      durationMs: 3
    })),
    screenshots: [],
    durationMs: 10
  };
}

function setup(
  statuses: Array<{
    status: ScenarioResult['status'];
    assertion?: 'passed' | 'failed' | 'error';
  }>,
  planReport: PlanningRunReport = makePlanReport()
) {
  let index = 0;

  const saveReport = vi
    .fn()
    .mockImplementation(async (_report: ExecutionRunReport) => 'saved.json');

  const runScenario = vi
    .fn()
    .mockImplementation(async (scenario: TestScenario) => {
      const outcome = statuses[index++] as (typeof statuses)[number];

      return makeResult(scenario, outcome.status, outcome.assertion);
    });

  const onScenarioDone = vi.fn();

  const run = () =>
    runExecutionWorkflow({
      loadPlanReport: async () => ({
        report: planReport,
        path: 'reports/plan.json'
      }),
      runScenario,
      saveReport,
      onScenarioDone
    });

  return { run, saveReport, runScenario, onScenarioDone };
}

describe('runExecutionWorkflow', () => {
  it('runs every scenario in order and saves the report', async () => {
    const { run, runScenario, saveReport, onScenarioDone } = setup([
      { status: 'passed' },
      { status: 'passed' }
    ]);

    const { report, reportPath } = await run();

    expect(
      runScenario.mock.calls.map(call => call[0].scenarioId)
    ).toEqual(['SC-001', 'SC-002']);

    expect(reportPath).toBe('saved.json');
    expect(saveReport).toHaveBeenCalledWith(report);
    expect(onScenarioDone).toHaveBeenCalledTimes(2);

    expect(report.verdict).toBe('PASSED');
    expect(report.planReportPath).toBe('reports/plan.json');
    expect(report.summary).toEqual({
      scenarios: { passed: 2, failed: 0, error: 0 },
      steps: { passed: 2, failed: 0, skipped: 0 },
      assertions: { passed: 2, failed: 0, error: 0 }
    });
  });

  it('gives each acceptance criterion its own verdict', async () => {
    const { run } = setup([
      { status: 'passed' },
      { status: 'failed', assertion: 'failed' }
    ]);

    const { report } = await run();

    expect(report.verdict).toBe('FAILED');

    expect(report.criteria).toEqual([
      {
        id: 'AC-01',
        title: 'Login works',
        verdict: 'PASSED',
        assertionsPassed: 1,
        assertionsTotal: 1
      },
      {
        id: 'AC-02',
        title: 'Cart | badge',
        verdict: 'FAILED',
        assertionsPassed: 0,
        assertionsTotal: 1
      }
    ]);
  });

  it('reports ERROR when nothing failed but a scenario could not be checked', async () => {
    const { run } = setup([
      { status: 'passed' },
      { status: 'error', assertion: 'error' }
    ]);

    const { report } = await run();

    expect(report.verdict).toBe('ERROR');
    expect(report.summary.steps.skipped).toBe(1);
  });

  it('refuses an invalid plan before running anything', async () => {
    const edited = makePlanReport({
      planTitle: 'Plan',
      summary: 'Summary',
      scenarios: [makeScenario('SC-001', 'AC-01')]
    });

    const { run, runScenario, saveReport } = setup([], edited);

    await expect(run()).rejects.toThrow(/does not cover: AC-02/);

    expect(runScenario).not.toHaveBeenCalled();
    expect(saveReport).not.toHaveBeenCalled();
  });
});

describe('renderMarkdownReport', () => {
  it('shows the verdict, criteria and assertions with escaped cells', async () => {
    const { run } = setup([
      { status: 'passed' },
      { status: 'failed', assertion: 'failed' }
    ]);

    const { report } = await run();

    const markdown = renderMarkdownReport(report);

    expect(markdown).toContain('# Test execution report: FAILED');
    expect(markdown).toContain('| AC-02 Cart \\| badge | FAILED | 0/1 |');
    expect(markdown).toContain('| ASSERT-01 | AC-02 | failed | a \\| b | a \\| c |');
    expect(markdown).toContain('## SC-002: Scenario SC-002 (failed)');
  });
});
