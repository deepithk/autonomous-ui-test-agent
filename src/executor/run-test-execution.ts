import {
  mkdir,
  readdir,
  readFile,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import { loadConfig } from '../config/env.js';

import { ensureEvidenceDirectories } from '../config/platform.js';

import { createLLMProvider } from '../planner/providers/provider-factory.js';

import {
  RetryingProvider
} from '../planner/providers/retrying-provider.js';

import type {
  PlanningRunReport
} from '../planner/planning-workflow.js';

import { BrowserSession } from './browser-session.js';

import { CaptureStore } from './capture-store.js';

import {
  renderMarkdownReport,
  runExecutionWorkflow
} from './execution-workflow.js';

import type { ExecutionRunReport } from './execution-workflow.js';

import { ScenarioRunner } from './scenario-runner.js';

import { SemanticResolver } from './semantic-resolver.js';

/**
 * Reads --plan <file> from the command line, if given.
 */
function readPlanArgument(argv: string[]): string | undefined {
  const index = argv.indexOf('--plan');

  return index === -1 ? undefined : argv[index + 1];
}

/**
 * The newest saved test plan. Report names contain an ISO
 * timestamp, so sorting by name sorts by time.
 */
async function findLatestPlanReport(
  reportsDir: string
): Promise<string> {
  const names = (await readdir(reportsDir))
    .filter(name => /^test-plan-issue-.*\.json$/.test(name))
    .sort();

  const latest = names.at(-1);

  if (!latest) {
    throw new Error(
      `No saved test plan found in ${reportsDir}. ` +
      'Run "npm run plan:issue" first.'
    );
  }

  return path.join(reportsDir, latest);
}

async function main(): Promise<void> {
  console.info('\n========================================');
  console.info(' AUTONOMOUS UI TEST EXECUTION');
  console.info('========================================\n');

  const config = loadConfig();

  const evidence = await ensureEvidenceDirectories();

  const provider = createLLMProvider(config);

  console.info(`[INFO] LLM Provider: ${provider.providerName}`);
  console.info(`[INFO] LLM Model: ${config.LLM_MODEL}`);

  const secrets = {
    SAUCEDEMO_USERNAME: config.SAUCEDEMO_USERNAME,
    SAUCEDEMO_PASSWORD: config.SAUCEDEMO_PASSWORD
  };

  const redactor = new CaptureStore(secrets);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const screenshotDir = path.join(evidence.screenshotsDir, timestamp);

  const runner = new ScenarioRunner({
    openBrowser: () =>
      BrowserSession.open({
        headless: config.PLAYWRIGHT_MCP_HEADLESS,
        caps: config.PLAYWRIGHT_MCP_CAPS,
        actionTimeoutMs: config.ACTION_TIMEOUT_MS
      }),

    // Temporary provider trouble (such as a 503) is retried;
    // quota errors are not.
    resolver: new SemanticResolver(new RetryingProvider(provider), {
      maxOutputTokens: 2048,
      temperature: 0
    }),

    secrets,
    allowedOrigin: config.TARGET_BASE_URL,
    recoveryAttempts: config.MAX_ELEMENT_RECOVERY_ATTEMPTS,
    maxSteps: config.MAX_STEPS_PER_SCENARIO,
    scenarioTimeoutMs: config.SCENARIO_TIMEOUT_MS,

    saveScreenshot: async (fileName, bytes) => {
      await mkdir(screenshotDir, { recursive: true });

      const filePath = path.join(screenshotDir, fileName);

      await writeFile(filePath, bytes);

      return path.relative(evidence.rootDir, filePath);
    }
  });

  const planFile =
    readPlanArgument(process.argv.slice(2)) ??
    (await findLatestPlanReport(evidence.reportsDir));

  console.info(`[INFO] Test plan: ${planFile}\n`);

  const { report, reportPath } = await runExecutionWorkflow({
    executionLlm: {
      provider: provider.providerName,
      model: config.LLM_MODEL
    },

    loadPlanReport: async () => ({
      report: JSON.parse(
        await readFile(planFile, 'utf8')
      ) as PlanningRunReport,
      path: path.relative(evidence.rootDir, planFile)
    }),

    runScenario: scenario => runner.run(scenario),

    onScenarioDone: result => {
      console.info(
        `[${result.status.toUpperCase()}] ${result.scenarioId}: ` +
        `${result.title} (${result.durationMs} ms)`
      );

      if (result.error) {
        console.info(`        ${redactor.redact(result.error)}`);
      }
    },

    saveReport: async (finished: ExecutionRunReport) => {
      const base = path.join(
        evidence.reportsDir,
        `test-execution-issue-${finished.source.issueNumber}-${timestamp}`
      );

      // Secrets never go into evidence files.
      await writeFile(
        `${base}.json`,
        redactor.redact(JSON.stringify(finished, null, 2)),
        'utf8'
      );

      await writeFile(
        `${base}.md`,
        redactor.redact(renderMarkdownReport(finished)),
        'utf8'
      );

      return `${base}.json`;
    }
  });

  console.info('\n========================================');
  console.info(` EXECUTION ${report.verdict}`);
  console.info('========================================');

  for (const criterion of report.criteria) {
    console.info(
      `${criterion.id}  ${criterion.verdict.padEnd(6)} ` +
      `${criterion.assertionsPassed}/${criterion.assertionsTotal} ` +
      `${criterion.title}`
    );
  }

  console.info(`\nReport: ${reportPath}`);
  console.info('========================================\n');

  if (report.verdict !== 'PASSED') {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : 'Unknown execution error';

  console.error('\n[ERROR] Test execution failed.');
  console.error(message);

  process.exitCode = 1;
});
