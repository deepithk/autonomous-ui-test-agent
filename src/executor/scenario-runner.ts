import type {
  TestAssertion,
  TestScenario
} from '../planner/test-plan-schema.js';

import { AssertionEngine } from './assertion-engine.js';

import type { AssertionResult } from './assertion-engine.js';

import type { McpContentBlock } from './browser-session.js';

import { CaptureStore } from './capture-store.js';

import type { SemanticResolver } from './semantic-resolver.js';

import {
  extractPageUrl,
  extractSnapshotYaml,
  findPageNotes,
  parseSnapshot
} from './snapshot.js';

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

/**
 * Things that happen while a scenario runs, in the order they happen.
 * Used to write the execution log.
 */
export type ExecutionEvent =
  | {
      type: 'scenario_started';
      scenarioId: string;
      title: string;
    }
  | {
      type: 'step_finished';
      scenarioId: string;
      action: string;
      targetDescription: string;
      result: StepResult;
    }
  | {
      type: 'assertion_finished';
      scenarioId: string;
      result: AssertionResult;
    }
  | {
      type: 'screenshot_saved';
      scenarioId: string;
      stepId: string;
      reason: 'step' | 'checkpoint' | 'failure';
      path: string;
    }
  | {
      type: 'page_observed';
      scenarioId: string;
      context: {
        stepId: string;
        url: string;
        notes: string[];
      };
    }
  | {
      type: 'scenario_finished';
      scenarioId: string;
      status: 'passed' | 'failed' | 'error';
      durationMs: number;
      error?: string;
    };

export interface ScenarioRunnerOptions {
  /** Opens a fresh, isolated browser for one scenario. */
  openBrowser: () => Promise<ScenarioBrowser>;

  /**
   * Receives events as the scenario runs. A listener that throws
   * never affects the test result.
   */
  onEvent?: (event: ExecutionEvent) => void;

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

/**
 * step:       taken after a step that has no assertions.
 * checkpoint: taken after the assertions of a step were checked.
 * failure:    taken when a step failed.
 */
export type ScreenshotReason = 'step' | 'checkpoint' | 'failure';

export interface ScenarioScreenshot {
  stepId: string;
  reason: ScreenshotReason;
  path: string;
}

/**
 * What the page showed when something went wrong, so a failure can be
 * explained without opening the browser.
 */
export interface FailureContext {
  stepId: string;
  url: string;

  /** Alerts and error-like messages found on the page. */
  notes: string[];
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

  /** Set when a step failed or an assertion did not hold. */
  failureContext?: FailureContext;

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

    this.emit({
      type: 'scenario_started',
      scenarioId: scenario.scenarioId,
      title: scenario.title
    });

    if (scenario.steps.length > maxSteps) {
      result.status = 'error';

      result.error =
        `Scenario has ${scenario.steps.length} steps, ` +
        `more than the limit of ${maxSteps}.`;

      result.skippedStepIds = scenario.steps.map(step => step.stepId);

      result.assertions = scenario.assertions.map(assertion =>
        this.notEvaluated(assertion, 'the scenario was not run')
      );

      for (const assertion of result.assertions) {
        this.emit({
          type: 'assertion_finished',
          scenarioId: scenario.scenarioId,
          result: assertion
        });
      }

      result.durationMs = Date.now() - startedAt;

      this.emitFinished(result);

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

      // Time spent saving evidence is not test time, so it does not
      // count against the scenario's time limit.
      let evidenceMs = 0;

      const remaining = (): number =>
        scenarioTimeoutMs - (Date.now() - startedAt - evidenceMs);

      for (const [position, step] of scenario.steps.entries()) {
        const stepResult = await withDeadline(
          executor.execute(step),
          remaining(),
          scenarioTimeoutMs
        );

        result.steps.push(stepResult);

        this.emit({
          type: 'step_finished',
          scenarioId: scenario.scenarioId,
          action: step.action,
          targetDescription: step.target.description,
          result: stepResult
        });

        if (stepResult.status === 'failed') {
          failureReason = `${step.stepId} failed: ${stepResult.error ?? 'unknown error'}`;

          evidenceMs += await this.observeFailure(
            browser,
            scenario.scenarioId,
            step.stepId,
            result
          );

          evidenceMs += await this.capture(
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

        if (checkpoint.length > 0) {
          // Assertions at one checkpoint share one page read and one
          // element lookup request.
          const checked = await withDeadline(
            assertionEngine.evaluateMany(checkpoint),
            remaining(),
            scenarioTimeoutMs
          );

          for (const assertionResult of checked) {
            evaluated.set(
              assertionResult.assertionId,
              assertionResult
            );

            this.emit({
              type: 'assertion_finished',
              scenarioId: scenario.scenarioId,
              result: assertionResult
            });
          }

          // Record what the page showed when an assertion did not hold.
          if (checked.some(entry => entry.status !== 'passed')) {
            evidenceMs += await this.observeFailure(
              browser,
              scenario.scenarioId,
              step.stepId,
              result
            );
          }
        }

        // Every step leaves a screenshot: a checkpoint after its
        // assertions were checked, or a plain step screenshot.
        evidenceMs += await this.capture(
          browser,
          scenario.scenarioId,
          step.stepId,
          checkpoint.length > 0 ? 'checkpoint' : 'step',
          result
        );
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
    result.assertions = scenario.assertions.map(assertion => {
      const done = evaluated.get(assertion.assertionId);

      if (done) {
        return done;
      }

      const skipped = this.notEvaluated(
        assertion,
        failureReason ?? 'an earlier step did not complete'
      );

      this.emit({
        type: 'assertion_finished',
        scenarioId: scenario.scenarioId,
        result: skipped
      });

      return skipped;
    });

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

    this.emitFinished(result);

    return result;
  }

  /**
   * Sends an event to the listener. Logging problems never change
   * the test result.
   */
  private emit(event: ExecutionEvent): void {
    try {
      this.options.onEvent?.(event);
    } catch {
      // Ignored on purpose.
    }
  }

  private emitFinished(result: ScenarioResult): void {
    this.emit({
      type: 'scenario_finished',
      scenarioId: result.scenarioId,
      status: result.status,
      durationMs: result.durationMs,
      ...(result.error !== undefined ? { error: result.error } : {})
    });
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
  /**
   * Notes the page URL and any alert or error-like text, once per
   * scenario (the first problem is the one worth explaining).
   * Returns the milliseconds spent.
   */
  private async observeFailure(
    browser: ScenarioBrowser,
    scenarioId: string,
    stepId: string,
    result: ScenarioResult
  ): Promise<number> {
    if (result.failureContext) {
      return 0;
    }

    const startedAt = Date.now();

    try {
      const content = await browser.callTool('browser_snapshot');

      const context: FailureContext = {
        stepId,
        url: extractPageUrl(content),
        notes: findPageNotes(
          parseSnapshot(extractSnapshotYaml(content))
        )
      };

      result.failureContext = context;

      this.emit({ type: 'page_observed', scenarioId, context });
    } catch {
      // Evidence is best effort.
    }

    return Date.now() - startedAt;
  }

  private async capture(
    browser: ScenarioBrowser,
    scenarioId: string,
    stepId: string,
    reason: ScenarioScreenshot['reason'],
    result: ScenarioResult
  ): Promise<number> {
    const startedAt = Date.now();

    try {
      const content: McpContentBlock[] = await browser.callTool(
        'browser_take_screenshot'
      );

      const image = content.find(
        block => block.type === 'image' && block.data
      );

      if (!image?.data) {
        return Date.now() - startedAt;
      }

      const fileName =
        `${scenarioId}_${stepId}_${reason}.` +
        extensionFor(image.mimeType);

      const path = await this.options.saveScreenshot(
        fileName,
        Buffer.from(image.data, 'base64')
      );

      result.screenshots.push({ stepId, reason, path });

      this.emit({
        type: 'screenshot_saved',
        scenarioId,
        stepId,
        reason,
        path
      });
    } catch {
      // Evidence is best effort.
    }

    return Date.now() - startedAt;
  }
}
