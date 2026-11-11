import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadConfig } from '../config/env.js';

import { GitHubClient } from '../github/github-client.js';
import { IssueReader } from '../github/issue-reader.js';

import { createLLMProvider } from './providers/provider-factory.js';
import { TestPlanner } from './test-planner.js';

import {
  runPlanningWorkflow
} from './planning-workflow.js';

import type {
  PlanningRunReport
} from './planning-workflow.js';

/**
 * Saves the generated test plan as execution evidence.
 */
async function savePlanningReport(
  report: PlanningRunReport
): Promise<string> {
  const reportDirectory = path.resolve(
    process.cwd(),
    'evidence',
    'reports'
  );

  await mkdir(reportDirectory, {
    recursive: true
  });

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  const reportName =
    `test-plan-issue-${report.source.issueNumber}-${timestamp}.json`;

  const reportPath = path.join(
    reportDirectory,
    reportName
  );

  await writeFile(
    reportPath,
    JSON.stringify(report, null, 2),
    'utf8'
  );

  return reportPath;
}

/**
 * Executes GitHub issue retrieval and AI test planning.
 *
 * No browser actions are executed in this phase.
 */
async function main(): Promise<void> {
  console.info('\n========================================');
  console.info(' AUTONOMOUS UI TEST PLAN GENERATION');
  console.info('========================================\n');

  // 1. Load configuration.
  const config = loadConfig();

  // 2. Initialize GitHub client and Issue Reader.
  const githubClient = new GitHubClient(
    config.GITHUB_TOKEN
  );

  const issueReader = new IssueReader(githubClient, {
    owner: config.GITHUB_OWNER,
    repository: config.GITHUB_REPO,
    issueNumber: config.GITHUB_ISSUE_NUMBER,
    projectNumber: config.GITHUB_PROJECT_NUMBER,
    expectedStatus: config.GITHUB_RFQA_STATUS_VALUE,
    allowLabelFallback: config.GITHUB_RFQA_FALLBACK_LABEL
  });

  // 3. Initialize the selected LLM provider.
  const provider = createLLMProvider(config);

  console.info(`[INFO] LLM Provider: ${provider.providerName}`);
  console.info(`[INFO] LLM Model: ${config.LLM_MODEL}`);

  // 4. Initialize the provider-independent planner.
  const planner = new TestPlanner(provider, {
    maxOutputTokens: 8192,
    temperature: 0.1,
    forbiddenValues: [
        config.SAUCEDEMO_USERNAME,
        config.SAUCEDEMO_PASSWORD
    ]
});

  // 5. Execute the centralized planning workflow.
  console.info('\n[INFO] Starting planning workflow...');

  const result = await runPlanningWorkflow(
    {
      repository:
        `${config.GITHUB_OWNER}/${config.GITHUB_REPO}`,

      provider: provider.providerName,

      model: config.LLM_MODEL,

      expectedStatus: config.GITHUB_RFQA_STATUS_VALUE
    },
    {
      readIssue: () => issueReader.readIssue(),

      generatePlan: criteria =>
        planner.generateTestPlan(criteria),

      saveReport: report =>
        savePlanningReport(report)
    }
  );

  const { report, reportPath } = result;

  // 6. Display the execution summary.
  console.info('\n========================================');
  console.info(' TEST PLAN GENERATED SUCCESSFULLY');
  console.info('========================================');

  console.info(
    `Issue              : #${report.source.issueNumber}`
  );

  console.info(
    `Title              : ${report.source.issueTitle}`
  );

  console.info(
    `Project            : ${report.source.projectTitle ?? 'Unknown'}`
  );

  console.info(
    `Project status     : ${report.source.projectStatus}`
  );

  console.info(
    `Status source      : ${report.source.projectStatusSource}`
  );

  console.info(
    `Acceptance criteria: ${report.acceptanceCriteria.length}`
  );

  console.info(
    `Scenarios generated: ${report.generatedPlan.scenarios.length}`
  );

  console.info(
    `LLM Provider       : ${report.llm.provider}`
  );

  console.info(
    `LLM Model          : ${report.llm.model}`
  );

  console.info(
    `Evidence report    : ${reportPath}`
  );

  console.info(
    `Execution status   : ${report.executionStatus}`
  );

  if (report.source.projectStatusWarning) {
    console.warn(
      `[WARNING] ${report.source.projectStatusWarning}`
    );
  }

  console.info('========================================\n');
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : 'Unknown planning workflow error';

  console.error('\n[ERROR] Test plan generation failed.');
  console.error(message);

  process.exitCode = 1;
});