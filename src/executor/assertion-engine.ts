import type {
  SemanticTarget,
  TestAssertion
} from '../planner/test-plan-schema.js';

import type { BrowserToolCaller } from './step-executor.js';

import type { CaptureStore } from './capture-store.js';

import type { SemanticResolver } from './semantic-resolver.js';

import {
  extractPageUrl,
  extractSnapshotYaml,
  getElementText,
  parseSnapshot
} from './snapshot.js';

import type { SnapshotElement } from './snapshot.js';

export interface AssertionEngineOptions {
  browser: BrowserToolCaller;
  resolver: SemanticResolver;
  captures: CaptureStore;

  /** Extra evaluations, one second apart, before a failure is final. */
  recoveryAttempts: number;
}

/**
 * passed: the page matched the expectation.
 * failed: the page was checked and did not match.
 * error:  the assertion could not be checked at all.
 */
export interface AssertionResult {
  assertionId: string;
  acceptanceCriterionId: string;
  afterStepId: string;
  type: TestAssertion['type'];
  status: 'passed' | 'failed' | 'error';
  expected: string;
  actual: string;
  explanation: string;
  durationMs: number;
  error?: string;
}

interface Outcome {
  passed: boolean;
  actual: string;
}

interface PageState {
  url: string;
  yaml: string;
  elements: SnapshotElement[];
}

const ABSENT_WORDS = new Set([
  'hidden',
  'not visible',
  'invisible',
  'absent',
  'not present'
]);

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function urlsMatch(actual: string, expected: string): boolean {
  const strip = (value: string): string => value.replace(/\/+$/, '');

  if (expected.startsWith('/')) {
    try {
      return strip(new URL(actual).pathname) === strip(expected);
    } catch {
      return false;
    }
  }

  return strip(actual) === strip(expected);
}

/**
 * Checks plan assertions against the live page.
 *
 * Every assertion reads a fresh snapshot, and its result records
 * what was expected and what was actually seen.
 */
export class AssertionEngine {
  constructor(private readonly options: AssertionEngineOptions) {}

  async evaluate(assertion: TestAssertion): Promise<AssertionResult> {
    const startedAt = Date.now();

    const { captures, recoveryAttempts, browser } = this.options;

    const result: AssertionResult = {
      assertionId: assertion.assertionId,
      acceptanceCriterionId: assertion.acceptanceCriterionId,
      afterStepId: assertion.afterStepId,
      type: assertion.type,
      status: 'error',
      expected: assertion.expectedValue,
      actual: '',
      explanation: assertion.explanation,
      durationMs: 0
    };

    try {
      if (assertion.type === 'application_state') {
        throw new Error(
          'application_state assertions cannot be checked from the ' +
          'page and need manual review.'
        );
      }

      const expected = captures.render(assertion.expectedValue);

      const target = this.renderTarget(assertion.target);

      result.expected = expected;

      let outcome: Outcome | undefined;

      for (let attempt = 0; attempt <= recoveryAttempts; attempt++) {
        if (attempt > 0) {
          await browser.callTool('browser_wait_for', { time: 1 });
        }

        outcome = await this.check(
          assertion.type,
          target,
          expected,
          await this.readPage()
        );

        if (outcome.passed) {
          break;
        }
      }

      const final = outcome as Outcome;

      result.actual = final.actual;
      result.status = final.passed ? 'passed' : 'failed';
    } catch (error) {
      result.status = 'error';

      result.error = captures.redact(
        error instanceof Error ? error.message : String(error)
      );
    }

    result.durationMs = Date.now() - startedAt;

    return result;
  }

  private renderTarget(target: SemanticTarget): SemanticTarget {
    const { captures } = this.options;

    const render = (value: string | null): string | null =>
      value === null ? null : captures.render(value);

    return {
      description: captures.render(target.description),
      role: render(target.role),
      accessibleName: render(target.accessibleName),
      visibleText: render(target.visibleText),
      label: render(target.label)
    };
  }

  private async readPage(): Promise<PageState> {
    const content = await this.options.browser.callTool(
      'browser_snapshot'
    );

    const yaml = extractSnapshotYaml(content);

    return {
      url: extractPageUrl(content),
      yaml,
      elements: parseSnapshot(yaml)
    };
  }

  private async check(
    type: TestAssertion['type'],
    target: SemanticTarget,
    expected: string,
    page: PageState
  ): Promise<Outcome> {
    const { resolver } = this.options;

    switch (type) {
      case 'url':
        return {
          passed: urlsMatch(page.url, expected),
          actual: page.url
        };

      case 'element_count': {
        const wanted = Number(expected);

        if (!Number.isInteger(wanted) || wanted < 0) {
          throw new Error(
            `element_count expects a whole number, got "${expected}".`
          );
        }

        const found = await resolver.resolveAll(
          target,
          page.elements,
          page.yaml
        );

        return {
          passed: found.length === wanted,
          actual: String(found.length)
        };
      }

      case 'visibility': {
        const found = await resolver.resolveAll(
          target,
          page.elements,
          page.yaml
        );

        const wantAbsent = ABSENT_WORDS.has(
          expected.trim().toLowerCase()
        );

        return {
          passed: wantAbsent ? found.length === 0 : found.length > 0,
          actual: found.length > 0 ? 'visible' : 'not found'
        };
      }

      case 'text':
      case 'input_value': {
        const found = await resolver.resolveAll(
          target,
          page.elements,
          page.yaml
        );

        if (found.length === 0) {
          return { passed: false, actual: 'element not found' };
        }

        const values = found.map(entry =>
          normalize(
            type === 'input_value'
              ? (page.elements[entry.index]?.text ?? '')
              : getElementText(page.elements, entry.index)
          )
        );

        return {
          passed: values.includes(normalize(expected)),
          actual: values.join(' | ')
        };
      }

      case 'application_state':
        // Rejected in evaluate() before the page is read.
        throw new Error(
          'application_state assertions need manual review.'
        );

      default: {
        const unsupported: never = type;

        throw new Error(`Unsupported assertion type: ${unsupported}`);
      }
    }
  }
}
