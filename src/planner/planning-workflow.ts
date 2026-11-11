import type { IssueReadResult } from '../github/issue-reader.js';

import type {
  AcceptanceCriterion
} from '../github/acceptance-criteria-parser.js';

import {
  coverageFeedback,
  findCoverageGaps
} from './criteria-coverage.js';

import type { CoverageGap } from './criteria-coverage.js';

import type { PlanRequestOptions } from './test-planner.js';

import type {
  GeneratedTestPlan
} from './test-plan-schema.js';

export interface PlanningWorkflowOptions {
  repository: string;
  provider: string;
  model: string;
  expectedStatus: string;
}

export interface PlanningRunReport {
  generatedAt: string;

  source: {
    repository: string;
    issueNumber: number;
    issueTitle: string;
    issueUrl: string;
    projectTitle: string | null;
    projectStatus: string;
    projectStatusSource: string;
    projectStatusWarning?: string;
  };

  llm: {
    provider: string;
    model: string;
  };

  acceptanceCriteria: AcceptanceCriterion[];

  generatedPlan: GeneratedTestPlan;

  /**
   * Conditions of the acceptance criteria that no assertion checks, and
   * what happened when the planner was asked to fix that.
   */
  coverage: {
    gaps: CoverageGap[];
    replan: ReplanOutcome;
  };

  executionStatus: 'NOT_EXECUTED';
}

/**
 * not-needed:     the first plan checked every condition.
 * improved:       a second attempt, given the gaps, checked more.
 * no-improvement: a second attempt was no better, so the first was kept.
 * failed:         the second attempt failed, so the first was kept.
 */
export type ReplanOutcome =
  | 'not-needed'
  | 'improved'
  | 'no-improvement'
  | 'failed';

export interface PlanningWorkflowDependencies {
  readIssue: () => Promise<IssueReadResult>;

  generatePlan: (
    criteria: readonly AcceptanceCriterion[],
    request?: PlanRequestOptions
  ) => Promise<GeneratedTestPlan>;

  saveReport: (
    report: PlanningRunReport
  ) => Promise<string>;
}

export interface PlanningWorkflowResult {
  report: PlanningRunReport;
  reportPath: string;
}

/**
 * Executes the provider-independent planning workflow.
 *
 * GitHub, LLM and file-system operations are injected
 * so that the workflow can be tested without network calls.
 */
export async function runPlanningWorkflow(
  options: PlanningWorkflowOptions,
  dependencies: PlanningWorkflowDependencies
): Promise<PlanningWorkflowResult> {

  if (
    !options.repository.trim() ||
    !options.provider.trim() ||
    !options.model.trim() ||
    !options.expectedStatus.trim()
  ) {
    throw new Error(
      'Planning workflow configuration is incomplete.'
    );
  }

  // Step 1: Retrieve and validate the GitHub issue.
  const issueResult = await dependencies.readIssue();

  if (issueResult.issue.state !== 'open') {
    throw new Error(
      'Closed issues cannot enter the planning workflow.'
    );
  }

  // Step 2: Independently verify eligibility.
  if (
    issueResult.project.status.toLowerCase() !==
    options.expectedStatus.toLowerCase()
  ) {
    throw new Error(
      `Issue is not eligible for planning. Expected "${options.expectedStatus}", ` +
      `received "${issueResult.project.status}".`
    );
  }

  // Step 3: Verify source requirements exist.
  if (issueResult.acceptanceCriteria.length === 0) {
    throw new Error(
      'Cannot generate a test plan without acceptance criteria.'
    );
  }

  // Step 4: Generate the dynamic test plan.
  const request: PlanRequestOptions = {
    issueTitle: issueResult.issue.title
  };

  let generatedPlan = await dependencies.generatePlan(
    issueResult.acceptanceCriteria,
    request
  );

  // Step 4b: Check that every condition of every criterion is checked.
  // The planner is an LLM and sometimes leaves one out. If it did, it
  // gets one more attempt with the gaps pointed out. Whatever is still
  // missing is recorded, so a PASSED result cannot overstate what was
  // verified.
  let gaps = findCoverageGaps(
    issueResult.acceptanceCriteria,
    generatedPlan
  );

  let replan: ReplanOutcome = 'not-needed';

  if (gaps.length > 0) {
    try {
      const retry = await dependencies.generatePlan(
        issueResult.acceptanceCriteria,
        { ...request, feedback: coverageFeedback(gaps) }
      );

      const retryGaps = findCoverageGaps(
        issueResult.acceptanceCriteria,
        retry
      );

      if (retryGaps.length < gaps.length) {
        generatedPlan = retry;
        gaps = retryGaps;
        replan = 'improved';
      } else {
        replan = 'no-improvement';
      }
    } catch {
      // The first plan is valid; keep it and say what it leaves open.
      replan = 'failed';
    }
  }

  // Step 5: Prepare the evidence report.
  const report: PlanningRunReport = {
    generatedAt: new Date().toISOString(),

    source: {
      repository: options.repository,
      issueNumber: issueResult.issue.number,
      issueTitle: issueResult.issue.title,
      issueUrl: issueResult.issue.html_url,
      projectTitle: issueResult.project.projectTitle,
      projectStatus: issueResult.project.status,
      projectStatusSource: issueResult.project.source,

      ...(issueResult.project.warning
        ? {
            projectStatusWarning:
              issueResult.project.warning
          }
        : {})
    },

    llm: {
      provider: options.provider,
      model: options.model
    },

    acceptanceCriteria: issueResult.acceptanceCriteria,

    generatedPlan,

    coverage: { gaps, replan },

    executionStatus: 'NOT_EXECUTED'
  };

  // Step 6: Save evidence only after successful generation.
  const reportPath = await dependencies.saveReport(report);

  return {
    report,
    reportPath
  };
}