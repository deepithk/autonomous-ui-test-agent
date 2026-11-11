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
  assertionStatus: 'passed' | 'failed' | 'error' = 'passed',
  healed = false
): ScenarioResult {
  return {
    scenarioId: scenario.scenarioId,
    title: scenario.title,
    acceptanceCriterionIds: scenario.acceptanceCriterionIds,
    status,
    steps: [
      {
        stepId: 'STEP-01',
        status: 'passed',
        durationMs: 5,
        ...(healed
          ? {
              healed: {
                problem: 'No element matched "Checkout"',
                repair: 'used button "Proceed | pay" instead',
                reason: 'Renamed.'
              }
            }
          : {})
      }
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
    healed?: boolean;
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

      return makeResult(
        scenario,
        outcome.status,
        outcome.assertion,
        outcome.healed
      );
    });

  const onScenarioDone = vi.fn();

  const run = () =>
    runExecutionWorkflow({
      executionLlm: { provider: 'gemini', model: 'exec-model' },
      executionLogPath: 'logs/run.log',
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
    expect(report.failures).toEqual([]);
    expect(report.planReportPath).toBe('reports/plan.json');
    expect(report.planningLlm.model).toBe('test-model');
    expect(report.executionLlm.model).toBe('exec-model');
    expect(report.executionLogPath).toBe('logs/run.log');
    expect(report.summary).toEqual({
      scenarios: { passed: 2, failed: 0, error: 0 },
      steps: { passed: 2, failed: 0, skipped: 0, healed: 0 },
      assertions: { passed: 2, failed: 0, error: 0 }
    });
  });

  it('lists steps that were repaired by self-healing', async () => {
    const { run } = setup([
      { status: 'passed', healed: true },
      { status: 'passed' }
    ]);

    const { report } = await run();

    expect(report.verdict).toBe('PASSED');
    expect(report.summary.steps.healed).toBe(1);

    expect(report.healing).toEqual([
      {
        scenarioId: 'SC-001',
        stepId: 'STEP-01',
        outcome: 'passed',
        problem: 'No element matched "Checkout"',
        repair: 'used button "Proceed | pay" instead',
        reason: 'Renamed.'
      }
    ]);

    const markdown = renderMarkdownReport(report);

    expect(markdown).toContain('## Self-healing');
    expect(markdown).toContain('A repair never decides a result');
    expect(markdown).toContain(
      '| SC-001 STEP-01 | passed | No element matched "Checkout" | ' +
      'used button "Proceed \\| pay" instead | Renamed. |'
    );
  });

  it('has no self-healing section when nothing was repaired', async () => {
    const { run } = setup([{ status: 'passed' }, { status: 'passed' }]);

    const { report } = await run();

    expect(report.healing).toEqual([]);
    expect(renderMarkdownReport(report)).not.toContain('Self-healing');
  });

  it('gives each acceptance criterion its own verdict', async () => {
    const { run } = setup([
      { status: 'passed' },
      { status: 'failed', assertion: 'failed' }
    ]);

    const { report } = await run();

    expect(report.verdict).toBe('FAILED');

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({
      scenarioId: 'SC-002',
      category: 'application',
      criterionIds: ['AC-02']
    });

    expect(report.criteria).toEqual([
      {
        id: 'AC-01',
        title: 'Login works',
        verdict: 'PASSED',
        assertionsPassed: 1,
        assertionsTotal: 1,
        partlyChecked: false
      },
      {
        id: 'AC-02',
        title: 'Cart | badge',
        verdict: 'FAILED',
        assertionsPassed: 0,
        assertionsTotal: 1,
        partlyChecked: false
      }
    ]);
  });

  describe('coverage of the criteria', () => {
    /**
     * AC-02 names the value "7", but the plan's assertion expects a URL,
     * so that condition of AC-02 is never checked.
     */
    const planReportWithGap = (): PlanningRunReport => ({
      ...makePlanReport(),
      acceptanceCriteria: [
        { id: 'AC-01', title: 'Login works', description: 'd' },
        {
          id: 'AC-02',
          title: 'Cart | badge',
          description: 'Given a product,\n\nThen the badge shows "7".'
        }
      ]
    });

    it('marks a criterion with an unchecked condition as partly checked', async () => {
      const { run } = setup(
        [{ status: 'passed' }, { status: 'passed' }],
        planReportWithGap()
      );

      const { report } = await run();

      expect(report.verdict).toBe('PASSED');

      expect(report.criteria.map(c => [c.id, c.partlyChecked])).toEqual([
        ['AC-01', false],
        ['AC-02', true]
      ]);

      expect(report.coverageGaps).toEqual([
        {
          criterionId: 'AC-02',
          kind: 'value-not-checked',
          problem:
            'The value "7" named in the criterion is not checked by any ' +
            'of its assertions.'
        }
      ]);
    });

    it('says so in the report next to the verdict', async () => {
      const { run } = setup(
        [{ status: 'passed' }, { status: 'passed' }],
        planReportWithGap()
      );

      const markdown = renderMarkdownReport((await run()).report);

      expect(markdown).toContain(
        '| AC-02 Cart \\| badge | PASSED (partly checked) | 1/1 |'
      );

      expect(markdown).toContain('| AC-01 Login works | PASSED | 1/1 |');
      expect(markdown).toContain('## Coverage warnings');
      expect(markdown).toContain('- AC-02: The value "7" named');
    });

    it('shows no warning when every condition is checked', async () => {
      const { run } = setup([{ status: 'passed' }, { status: 'passed' }]);

      const { report } = await run();

      expect(report.coverageGaps).toEqual([]);
      expect(renderMarkdownReport(report)).not.toContain('Coverage warnings');
      expect(renderMarkdownReport(report)).not.toContain('partly checked');
    });
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

    expect(markdown).toContain('## Failure details');
    expect(markdown).toContain(
      'Kind: Application behaviour does not match the criterion'
    );
    expect(markdown).toContain('What to do:');
    expect(markdown).toContain('# Test execution report: FAILED');
    expect(markdown).toContain('Plan written by: gemini / test-model');
    expect(markdown).toContain('Executed with: gemini / exec-model');
    expect(markdown).toContain('Execution log: logs/run.log');
    expect(markdown).toContain('| AC-02 Cart \\| badge | FAILED | 0/1 |');
    expect(markdown).toContain('| ASSERT-01 | AC-02 | failed | a \\| b | a \\| c |');
    expect(markdown).toContain('## SC-002: Scenario SC-002 (failed)');
  });
});
