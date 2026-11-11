import type {
  TestAssertion,
  TestScenario
} from '../planner/test-plan-schema.js';

import { AssertionEngine } from './assertion-engine.js';

import type { AssertionResult } from './assertion-engine.js';

import type { McpContentBlock } from './browser-session.js';

import { CaptureStore } from './capture-store.js';

import type { SemanticResolver } from './semantic-resolver.js';

import { StepExecutor } from './step-executor.js';

import type {
  BrowserToolCaller,
  StepResult
} from './step-executor.js';

/**
 * A browser that can be driven and then closed.
 * BrowserSession satisfies this.
 */
export interface ScenarioBrowser extends BrowserToolCaller {
  close(): Promise<void>;
}

export interface ScenarioRunnerOptions {
  /** Opens a fresh, isolated browser for one scenario. */
  openBrowser: () => Promise<ScenarioBrowser>;

  resolver: SemanticResolver;

  /** Values for {{NAME}} placeholders, such as the login details. */
  secrets: Readonly<Record<string, string>>;

  allowedOrigin: string;
  recoveryAttempts: number;
  maxSteps: number;
  scenarioTimeoutMs: number;

  /**
   * Stores a screenshot and returns where it was saved.
   * fileName has no folder and ends in the right extension.
   */
  saveScreenshot: (
    fileName: string,
    bytes: Buffer
  ) => Promise<string>;
}

export interface ScenarioScreenshot {
  stepId: string;
  reason: 'checkpoint' | 'failure';
  path: string;
}

/**
 * passed: every step and assertion passed.
 * failed: a step failed or an assertion did not hold.
 * error:  nothing failed, but the scenario could not be fully checked
 *         (timeout, could not start, or an assertion could not run).
 */
export interface ScenarioResult {
  scenarioId: string;
  title: string;
  acceptanceCriterionIds: string[];
  status: 'passed' | 'failed' | 'error';
  steps: StepResult[];
  skippedStepIds: string[];
  assertions: AssertionResult[];
  screenshots: ScenarioScreenshot[];
  durationMs: number;
  error?: string;
}

class ScenarioTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Scenario exceeded its ${timeoutMs} ms time limit.`);
    this.name = 'ScenarioTimeoutError';
  }
}

/**
 * Rejects when the work does not finish within ms.
 */
async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  timeoutMs: number
): Promise<T> {
  if (ms <= 0) {
    throw new ScenarioTimeoutError(timeoutMs);
  }

  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new ScenarioTimeoutError(timeoutMs)),
      ms
    );
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function extensionFor(mimeType: string | undefined): string {
  return mimeType === 'image/jpeg' ? 'jpg' : 'png';
}

/**
 * Runs scenarios one at a time, each in its own browser.
 */
export class ScenarioRunner {
  constructor(private readonly options: ScenarioRunnerOptions) {}

  async run(scenario: TestScenario): Promise<ScenarioResult> {
    const startedAt = Date.now();

    const {
      maxSteps,
      scenarioTimeoutMs,
      recoveryAttempts,
      resolver,
      secrets,
      allowedOrigin
    } = this.options;

    const result: ScenarioResult = {
      scenarioId: scenario.scenarioId,
      title: scenario.title,
      acceptanceCriterionIds: scenario.acceptanceCriterionIds,
      status: 'passed',
      steps: [],
      skippedStepIds: [],
      assertions: [],
      screenshots: [],
      durationMs: 0
    };

    if (scenario.steps.length > maxSteps) {
      result.status = 'error';

      result.error =
        `Scenario has ${scenario.steps.length} steps, ` +
        `more than the limit of ${maxSteps}.`;

      result.skippedStepIds = scenario.steps.map(step => step.stepId);

      result.assertions = scenario.assertions.map(assertion =>
        this.notEvaluated(assertion, 'the scenario was not run')
      );

      result.durationMs = Date.now() - startedAt;

      return result;
    }

    let browser: ScenarioBrowser | undefined;

    const evaluated = new Map<string, AssertionResult>();

    let failureReason: string | undefined;

    try {
      browser = await this.options.openBrowser();

      const captures = new CaptureStore(secrets);

      const executor = new StepExecutor({
        browser,
        resolver,
        captures,
        allowedOrigin,
        recoveryAttempts
      });

      const assertionEngine = new AssertionEngine({
        browser,
        resolver,
        captures,
        recoveryAttempts
      });

      const remaining = (): number =>
        scenarioTimeoutMs - (Date.now() - startedAt);

      for (const [position, step] of scenario.steps.entries()) {
        const stepResult = await withDeadline(
          executor.execute(step),
          remaining(),
          scenarioTimeoutMs
        );

        result.steps.push(stepResult);

        if (stepResult.status === 'failed') {
          failureReason = `${step.stepId} failed: ${stepResult.error ?? 'unknown error'}`;

          await this.capture(
            browser,
            scenario.scenarioId,
            step.stepId,
            'failure',
            result
          );

          result.skippedStepIds = scenario.steps
            .slice(position + 1)
            .map(next => next.stepId);

          break;
        }

        const checkpoint = scenario.assertions.filter(
          assertion => assertion.afterStepId === step.stepId
        );

        for (const assertion of checkpoint) {
          evaluated.set(
            assertion.assertionId,
            await withDeadline(
              assertionEngine.evaluate(assertion),
              remaining(),
              scenarioTimeoutMs
            )
          );
        }

        if (checkpoint.length > 0) {
          await this.capture(
            browser,
            scenario.scenarioId,
            step.stepId,
            'checkpoint',
            result
          );
        }
      }
    } catch (error) {
      failureReason = new CaptureStore(secrets).redactAndShorten(
        error instanceof Error ? error.message : String(error)
      );

      result.skippedStepIds = scenario.steps
        .map(step => step.stepId)
        .filter(
          stepId => !result.steps.some(done => done.stepId === stepId)
        );
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }

    // Report assertions in plan order, including any that never ran.
    result.assertions = scenario.assertions.map(
      assertion =>
        evaluated.get(assertion.assertionId) ??
        this.notEvaluated(
          assertion,
          failureReason ?? 'an earlier step did not complete'
        )
    );

    const stepFailed = result.steps.some(
      step => step.status === 'failed'
    );

    const assertionFailed = result.assertions.some(
      assertion => assertion.status === 'failed'
    );

    if (stepFailed || assertionFailed) {
      result.status = 'failed';
    } else if (
      failureReason !== undefined ||
      result.assertions.some(assertion => assertion.status === 'error')
    ) {
      result.status = 'error';
    }

    if (failureReason !== undefined) {
      result.error = failureReason;
    }

    result.durationMs = Date.now() - startedAt;

    return result;
  }

  private notEvaluated(
    assertion: TestAssertion,
    reason: string
  ): AssertionResult {
    return {
      assertionId: assertion.assertionId,
      acceptanceCriterionId: assertion.acceptanceCriterionId,
      afterStepId: assertion.afterStepId,
      type: assertion.type,
      status: 'error',
      expected: assertion.expectedValue,
      actual: '',
      explanation: assertion.explanation,
      durationMs: 0,
      error: `Not evaluated: ${reason}.`
    };
  }

  /**
   * Saves a screenshot as evidence. A screenshot problem never
   * changes the test result.
   */
  private async capture(
    browser: ScenarioBrowser,
    scenarioId: string,
    stepId: string,
    reason: ScenarioScreenshot['reason'],
    result: ScenarioResult
  ): Promise<void> {
    try {
      const content: McpContentBlock[] = await browser.callTool(
        'browser_take_screenshot'
      );

      const image = content.find(
        block => block.type === 'image' && block.data
      );

      if (!image?.data) {
        return;
      }

      const fileName =
        `${scenarioId}_${stepId}_${reason}.` +
        extensionFor(image.mimeType);

      const path = await this.options.saveScreenshot(
        fileName,
        Buffer.from(image.data, 'base64')
      );

      result.screenshots.push({ stepId, reason, path });
    } catch {
      // Evidence is best effort.
    }
  }
}
