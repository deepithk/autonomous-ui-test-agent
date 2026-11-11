import { appendFileSync } from 'node:fs';

import {
  mkdir,
  readdir,
  readFile,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import { loadLocalConfig } from '../config/env.js';

import { runCli } from '../util/cli.js';

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

import { formatLogEvent } from './execution-log.js';

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
 * Reads --label <name> from the command line. The label becomes part
 * of the evidence file names, so a special run (for example a
 * demonstration of a failure) can be told apart from a normal one.
 */
function readLabelArgument(argv: string[]): string {
  const index = argv.indexOf('--label');

  const raw = index === -1 ? '' : (argv[index + 1] ?? '');

  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
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

  // Executing a saved plan needs no GitHub settings.
  const config = loadLocalConfig();

  const evidence = await ensureEvidenceDirectories();

  const provider = createLLMProvider(config);

  console.info(`[INFO] LLM Provider: ${provider.providerName}`);
  console.info(`[INFO] LLM Model: ${config.LLM_MODEL}`);

  const secrets = {
    SAUCEDEMO_USERNAME: config.SAUCEDEMO_USERNAME,
    SAUCEDEMO_PASSWORD: config.SAUCEDEMO_PASSWORD
  };

  const redactor = new CaptureStore(secrets);

  const label = readLabelArgument(process.argv.slice(2));

  // Names every evidence file of this run, e.g. 2026-11-11T05-20-46-600Z
  // or failure-demo-2026-11-11T05-20-46-600Z.
  const timestamp =
    (label ? `${label}-` : '') +
    new Date().toISOString().replace(/[:.]/g, '-');

  const screenshotDir = path.join(evidence.screenshotsDir, timestamp);

  // One log file per run. Every line is redacted before it is written,
  // and a logging problem never stops the run.
  const logPath = path.join(
    evidence.logsDir,
    `test-execution-${timestamp}.log`
  );

  // Every log line is also printed, so the console shows what the
  // agent is doing as it happens.
  const writeLog = (line: string): void => {
    const text = redactor.redactAndShorten(line, 2000);

    console.info(text);

    try {
      appendFileSync(logPath, `${text}\n`, 'utf8');
    } catch {
      // Ignored on purpose.
    }
  };

  // Temporary provider trouble (such as a 503) is retried;
  // quota errors are not.
  const resolver = new SemanticResolver(new RetryingProvider(provider), {
    maxOutputTokens: 2048,
    temperature: 0
  });

  const runner = new ScenarioRunner({
    onEvent: event => writeLog(formatLogEvent(event)),

    openBrowser: () =>
      BrowserSession.open({
        headless: config.PLAYWRIGHT_MCP_HEADLESS,
        caps: config.PLAYWRIGHT_MCP_CAPS,
        actionTimeoutMs: config.ACTION_TIMEOUT_MS
      }),

    resolver,

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

  writeLog(
    `${new Date().toISOString()} RUN START plan=${path.basename(planFile)} ` +
    `llm=${provider.providerName}/${config.LLM_MODEL}`
  );

  const { report, reportPath } = await runExecutionWorkflow({
    executionLogPath: path.relative(evidence.rootDir, logPath),

    getLlmUsage: () => resolver.getUsage(),

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

  for (const criterion of report.criteria) {
    writeLog(
      `${new Date().toISOString()} [${criterion.id}] CRITERION ` +
      `${criterion.verdict} ${criterion.assertionsPassed}/` +
      `${criterion.assertionsTotal}`
    );
  }

  const usage = resolver.getUsage();

  writeLog(
    `${new Date().toISOString()} LLM requests=${usage.requests} ` +
    `answers_reused=${usage.reused}`
  );

  writeLog(
    `${new Date().toISOString()} RUN END ${report.verdict} ` +
    `report=${path.basename(reportPath)}`
  );

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

  console.info(
    `\nLLM requests while executing: ${usage.requests} ` +
    `(${usage.reused} answers reused)`
  );

  console.info(`Report: ${reportPath}`);
  console.info(`Log   : ${logPath}`);
  console.info('========================================\n');

  if (report.verdict !== 'PASSED') {
    process.exitCode = 1;
  }
}

runCli('Test execution failed.', main);
