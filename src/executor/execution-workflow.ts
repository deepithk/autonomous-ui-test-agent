import type {
  AcceptanceCriterion
} from '../github/acceptance-criteria-parser.js';

import type {
  PlanningRunReport
} from '../planner/planning-workflow.js';

import { validateTestPlan } from '../planner/test-plan-schema.js';

import type { TestScenario } from '../planner/test-plan-schema.js';

import type { ScenarioResult } from './scenario-runner.js';

export type RunVerdict = 'PASSED' | 'FAILED' | 'ERROR';

export interface CriterionVerdict {
  id: string;
  title: string;
  verdict: RunVerdict;
  assertionsPassed: number;
  assertionsTotal: number;
}

export interface ExecutionRunReport {
  generatedAt: string;
  planReportPath: string;

  /** Step-by-step log of the run, relative to the evidence folder. */
  executionLogPath?: string;

  source: PlanningRunReport['source'];

  /** The model that wrote the test plan. */
  planningLlm: PlanningRunReport['llm'];

  /** The model that located elements while the plan was executed. */
  executionLlm: PlanningRunReport['llm'];

  verdict: RunVerdict;

  summary: {
    scenarios: Record<'passed' | 'failed' | 'error', number>;
    steps: Record<'passed' | 'failed' | 'skipped', number>;
    assertions: Record<'passed' | 'failed' | 'error', number>;
  };

  criteria: CriterionVerdict[];

  scenarios: ScenarioResult[];
}

export interface ExecutionWorkflowDependencies {
  /** Where the run's log is written, for the report. */
  executionLogPath?: string;

  /** Provider and model used while executing, for the report. */
  executionLlm: PlanningRunReport['llm'];

  /** Loads a saved planning report. */
  loadPlanReport: () => Promise<{
    report: PlanningRunReport;
    path: string;
  }>;

  runScenario: (scenario: TestScenario) => Promise<ScenarioResult>;

  saveReport: (report: ExecutionRunReport) => Promise<string>;

  /** Called after each scenario, for progress output. */
  onScenarioDone?: (result: ScenarioResult) => void;
}

export interface ExecutionWorkflowResult {
  report: ExecutionRunReport;
  reportPath: string;
}

function overallVerdict(
  statuses: Array<'passed' | 'failed' | 'error'>
): RunVerdict {
  if (statuses.includes('failed')) {
    return 'FAILED';
  }

  if (statuses.includes('error') || statuses.length === 0) {
    return 'ERROR';
  }

  return 'PASSED';
}

/**
 * One verdict per acceptance criterion, from the assertions
 * that were written for it.
 */
function summarizeCriteria(
  criteria: readonly AcceptanceCriterion[],
  scenarios: ScenarioResult[]
): CriterionVerdict[] {
  const assertions = scenarios.flatMap(
    scenario => scenario.assertions
  );

  return criteria.map(criterion => {
    const own = assertions.filter(
      assertion => assertion.acceptanceCriterionId === criterion.id
    );

    return {
      id: criterion.id,
      title: criterion.title,
      verdict: overallVerdict(own.map(assertion => assertion.status)),
      assertionsPassed: own.filter(
        assertion => assertion.status === 'passed'
      ).length,
      assertionsTotal: own.length
    };
  });
}

function count<T extends string>(
  values: T[],
  keys: readonly T[]
): Record<T, number> {
  const result = {} as Record<T, number>;

  for (const key of keys) {
    result[key] = values.filter(value => value === key).length;
  }

  return result;
}

/**
 * Runs every scenario of a saved plan, one after another, and
 * builds the evidence report.
 *
 * The plan is validated again first, because the file may have
 * been edited since it was generated.
 */
export async function runExecutionWorkflow(
  dependencies: ExecutionWorkflowDependencies
): Promise<ExecutionWorkflowResult> {
  const { report: plan, path: planReportPath } =
    await dependencies.loadPlanReport();

  const validated = validateTestPlan(
    plan.generatedPlan,
    plan.acceptanceCriteria.map(criterion => criterion.id)
  );

  const results: ScenarioResult[] = [];

  for (const scenario of validated.scenarios) {
    const result = await dependencies.runScenario(scenario);

    results.push(result);

    dependencies.onScenarioDone?.(result);
  }

  const assertions = results.flatMap(result => result.assertions);

  const steps = results.flatMap(result => result.steps);

  const report: ExecutionRunReport = {
    generatedAt: new Date().toISOString(),
    planReportPath,
    ...(dependencies.executionLogPath !== undefined
      ? { executionLogPath: dependencies.executionLogPath }
      : {}),
    source: plan.source,
    planningLlm: plan.llm,
    executionLlm: dependencies.executionLlm,

    verdict: overallVerdict(results.map(result => result.status)),

    summary: {
      scenarios: count(
        results.map(result => result.status),
        ['passed', 'failed', 'error'] as const
      ),

      steps: {
        passed: steps.filter(step => step.status === 'passed').length,
        failed: steps.filter(step => step.status === 'failed').length,
        skipped: results.reduce(
          (total, result) => total + result.skippedStepIds.length,
          0
        )
      },

      assertions: count(
        assertions.map(assertion => assertion.status),
        ['passed', 'failed', 'error'] as const
      )
    },

    criteria: summarizeCriteria(plan.acceptanceCriteria, results),

    scenarios: results
  };

  const reportPath = await dependencies.saveReport(report);

  return { report, reportPath };
}

function cell(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

/**
 * Human-readable version of the report.
 */
export function renderMarkdownReport(
  report: ExecutionRunReport
): string {
  const lines: string[] = [
    `# Test execution report: ${report.verdict}`,
    '',
    `- Issue: #${report.source.issueNumber} ${report.source.issueTitle}`,
    `- Generated: ${report.generatedAt}`,
    `- Plan written by: ${report.planningLlm.provider} / ${report.planningLlm.model}`,
    `- Executed with: ${report.executionLlm.provider} / ${report.executionLlm.model}`,
    ...(report.executionLogPath
      ? [`- Execution log: ${report.executionLogPath}`]
      : []),
    '',
    '## Acceptance criteria',
    '',
    '| Criterion | Verdict | Assertions passed |',
    '| --- | --- | --- |'
  ];

  for (const criterion of report.criteria) {
    lines.push(
      `| ${cell(`${criterion.id} ${criterion.title}`)} | ${criterion.verdict} | ` +
      `${criterion.assertionsPassed}/${criterion.assertionsTotal} |`
    );
  }

  for (const scenario of report.scenarios) {
    lines.push(
      '',
      `## ${scenario.scenarioId}: ${scenario.title} (${scenario.status})`,
      ''
    );

    if (scenario.error) {
      lines.push(`Problem: ${scenario.error}`, '');
    }

    lines.push(
      '| Assertion | Criterion | Result | Expected | Actual |',
      '| --- | --- | --- | --- | --- |'
    );

    for (const assertion of scenario.assertions) {
      lines.push(
        `| ${assertion.assertionId} | ${assertion.acceptanceCriterionId} | ` +
        `${assertion.status} | ${cell(assertion.expected)} | ` +
        `${cell(assertion.error ?? assertion.actual)} |`
      );
    }

    if (scenario.screenshots.length > 0) {
      lines.push('', 'Screenshots:');

      for (const shot of scenario.screenshots) {
        lines.push(`- ${shot.stepId} (${shot.reason}): ${shot.path}`);
      }
    }
  }

  lines.push('');

  return lines.join('\n');
}
