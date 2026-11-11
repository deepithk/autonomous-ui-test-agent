import type { ExecutionStep } from '../planner/test-plan-schema.js';

import type { McpContentBlock } from './browser-session.js';

import type { CaptureStore } from './capture-store.js';

import { errorMessage } from '../util/text.js';

import { SemanticResolverError } from './semantic-resolver.js';

import type {
  ResolvedTarget,
  SemanticResolver
} from './semantic-resolver.js';

import {
  extractSnapshotYaml,
  getElementText,
  parseSnapshot
} from './snapshot.js';

import type { SnapshotElement } from './snapshot.js';

/**
 * The part of BrowserSession the executor needs.
 */
export interface BrowserToolCaller {
  callTool(
    name: string,
    args?: Record<string, unknown>
  ): Promise<McpContentBlock[]>;
}

export interface StepExecutorOptions {
  browser: BrowserToolCaller;
  resolver: SemanticResolver;
  captures: CaptureStore;

  /** Origin navigation is restricted to, e.g. https://www.saucedemo.com */
  allowedOrigin: string;

  /** Extra attempts to find an element after the first one. */
  recoveryAttempts: number;

  /** Wait before the one retry of a navigation that hit a network error. */
  networkRetryDelayMs?: number;
}

const NETWORK_ERROR_PATTERN =
  /net::ERR_(NETWORK_CHANGED|CONNECTION|INTERNET|NAME_NOT_RESOLVED|TIMED_OUT)/i;

export interface StepResult {
  stepId: string;
  status: 'passed' | 'failed';
  durationMs: number;

  error?: string;

  resolution?: {
    method: ResolvedTarget['method'];
    element: string;
    ref: string;
    reason: string;

    /** True when an earlier answer for the same page was reused. */
    cached?: boolean;
  };

  captured?: {
    key: string;
    value: string;
  };
}

interface ResolvedStepTarget {
  resolved: ResolvedTarget;
  elements: SnapshotElement[];
}

export class StepExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepExecutionError';
  }
}

/**
 * Runs plan steps through allow-listed browser tools.
 *
 * It never runs generated code: the plan only names semantic
 * targets, and every ref used comes from a live snapshot.
 */
export class StepExecutor {
  private readonly allowedOrigin: string;

  constructor(private readonly options: StepExecutorOptions) {
    this.allowedOrigin = new URL(options.allowedOrigin).origin;
  }

  async execute(step: ExecutionStep): Promise<StepResult> {
    const startedAt = Date.now();

    const result: StepResult = {
      stepId: step.stepId,
      status: 'passed',
      durationMs: 0
    };

    try {
      await this.run(step, result);
    } catch (error) {
      result.status = 'failed';

      result.error = this.options.captures.redactAndShorten(
        errorMessage(error)
      );
    }

    result.durationMs = Date.now() - startedAt;

    return result;
  }

  private async run(
    step: ExecutionStep,
    result: StepResult
  ): Promise<void> {
    const { browser, captures } = this.options;

    switch (step.action) {
      case 'navigate': {
        const url = this.requireValue(step);

        this.assertAllowedUrl(url);

        await this.navigate(url);

        return;
      }

      case 'press_key': {
        await browser.callTool('browser_press_key', {
          key: this.requireValue(step)
        });

        return;
      }

      case 'wait_for': {
        await browser.callTool('browser_wait_for', {
          text: this.requireValue(step)
        });

        return;
      }

      case 'observe': {
        const { resolved, elements } = await this.resolveTarget(
          step,
          result
        );

        if (step.capture) {
          const value =
            step.capture.source === 'input_value'
              ? (elements[resolved.index]?.text ?? '')
              : getElementText(elements, resolved.index);

          if (step.capture.source === 'text' && value === '') {
            throw new StepExecutionError(
              `Element "${resolved.element}" has no text to capture ` +
              `as "${step.capture.key}".`
            );
          }

          captures.set(step.capture.key, value);

          result.captured = { key: step.capture.key, value };
        }

        return;
      }

      case 'click': {
        const { resolved } = await this.resolveTarget(step, result);

        await browser.callTool('browser_click', {
          element: resolved.element,
          target: resolved.ref
        });

        return;
      }

      case 'fill':
      case 'type': {
        const text = this.requireValue(step);

        const { resolved } = await this.resolveTarget(step, result);

        await browser.callTool('browser_type', {
          element: resolved.element,
          target: resolved.ref,
          text,
          ...(step.action === 'type' ? { slowly: true } : {})
        });

        return;
      }

      case 'select_option': {
        const value = this.requireValue(step);

        const { resolved } = await this.resolveTarget(step, result);

        await browser.callTool('browser_select_option', {
          element: resolved.element,
          target: resolved.ref,
          values: [value]
        });

        return;
      }

      default: {
        const unsupported: never = step.action;

        throw new StepExecutionError(
          `Unsupported action: ${String(unsupported)}`
        );
      }
    }
  }

  /**
   * Opens a page. A network error from the browser (the connection
   * dropped or changed) is retried once after a short wait, because
   * these are usually brief. Any other error is not retried.
   */
  private async navigate(url: string): Promise<void> {
    try {
      await this.options.browser.callTool('browser_navigate', { url });
    } catch (error) {
      if (!NETWORK_ERROR_PATTERN.test(errorMessage(error))) {
        throw error;
      }

      await new Promise(resolve =>
        setTimeout(resolve, this.options.networkRetryDelayMs ?? 1500)
      );

      await this.options.browser.callTool('browser_navigate', { url });
    }
  }

  /**
   * Renders the step value, which may hold capture or secret placeholders.
   */
  private requireValue(step: ExecutionStep): string {
    if (step.value === null || step.value === '') {
      throw new StepExecutionError(
        `Step ${step.stepId} (${step.action}) requires a value.`
      );
    }

    return this.options.captures.render(step.value);
  }

  private assertAllowedUrl(url: string): void {
    let origin: string;

    try {
      origin = new URL(url).origin;
    } catch {
      throw new StepExecutionError(`Invalid navigation URL: ${url}`);
    }

    if (origin !== this.allowedOrigin) {
      throw new StepExecutionError(
        `Navigation to ${origin} is not allowed. ` +
        `Only ${this.allowedOrigin} may be visited.`
      );
    }
  }

  /**
   * Takes a fresh snapshot and resolves the step target.
   * Retries with a new snapshot when the element is not found yet.
   */
  private async resolveTarget(
    step: ExecutionStep,
    result: StepResult
  ): Promise<ResolvedStepTarget> {
    const { browser, resolver, recoveryAttempts } = this.options;

    const target = this.options.captures.renderTarget(step.target);

    let lastError: unknown;

    for (let attempt = 0; attempt <= recoveryAttempts; attempt++) {
      if (attempt > 0) {
        await browser.callTool('browser_wait_for', { time: 1 });
      }

      const yaml = extractSnapshotYaml(
        await browser.callTool('browser_snapshot')
      );

      const elements = parseSnapshot(yaml);

      try {
        const resolved = await resolver.resolve(
          target,
          step.action,
          elements,
          yaml
        );

        result.resolution = {
          method: resolved.method,
          element: resolved.element,
          ref: resolved.ref,
          reason: resolved.reason,
          ...(resolved.cached ? { cached: true } : {})
        };

        return { resolved, elements };
      } catch (error) {
        // Only "element not found" is worth another look at the page.
        // Provider failures such as quota errors would just repeat,
        // and every repeat is another paid LLM call.
        if (!(error instanceof SemanticResolverError)) {
          throw error;
        }

        lastError = error;
      }
    }

    throw lastError;
  }
}
