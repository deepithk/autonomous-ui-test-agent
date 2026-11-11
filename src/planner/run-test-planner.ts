import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadConfig, loadLocalConfig } from '../config/env.js';

import type { AppConfig, LocalAppConfig } from '../config/env.js';

import { runCli } from '../util/cli.js';

import { createIssueReader } from '../github/issue-reader.js';
import type { IssueReader } from '../github/issue-reader.js';
import { readLocalIssue } from '../github/local-issue.js';

/** The board status an issue must have, when no GitHub setting says otherwise. */
const DEFAULT_RFQA_STATUS = 'RFQA';

/**
 * Reads --issue-file <path> from the command line, if given.
 */
function readIssueFileArgument(argv: string[]): string | undefined {
  const index = argv.indexOf('--issue-file');

  return index === -1 ? undefined : argv[index + 1];
}

import { createLLMProvider } from './providers/provider-factory.js';
import { RetryingProvider } from './providers/retrying-provider.js';
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

  // 1. Load configuration. With --issue-file no GitHub settings
  //    are needed, so only the local settings are validated.
  const issueFile = readIssueFileArgument(process.argv.slice(2));

  const github: AppConfig | undefined = issueFile
    ? undefined
    : loadConfig();

  // Both kinds of configuration have every non-GitHub setting.
  const config: LocalAppConfig = github ?? loadLocalConfig();

  // 2. Choose where the issue comes from.
  let readIssue: () => ReturnType<IssueReader['readIssue']>;

  let repository: string;
  let expectedStatus: string;

  if (github) {
    const issueReader = createIssueReader(github);

    readIssue = () => issueReader.readIssue();

    repository = `${github.GITHUB_OWNER}/${github.GITHUB_REPO}`;
    expectedStatus = github.GITHUB_RFQA_STATUS_VALUE;
  } else {
    const file = issueFile as string;

    expectedStatus = DEFAULT_RFQA_STATUS;

    readIssue = () =>
      readLocalIssue(file, { status: DEFAULT_RFQA_STATUS });

    repository = `local file ${file}`;

    console.info(`[INFO] Issue source: local file ${file}`);
  }

  // 3. Initialize the selected LLM provider.
  // Temporary provider trouble (such as a 503 "high demand") is
  // retried; quota errors are not.
  const provider = new RetryingProvider(createLLMProvider(config));

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
      repository,

      provider: provider.providerName,

      model: config.LLM_MODEL,

      expectedStatus
    },
    {
      readIssue,

      generatePlan: (criteria, request) =>
        planner.generateTestPlan(criteria, request),

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

runCli('Test plan generation failed.', main);