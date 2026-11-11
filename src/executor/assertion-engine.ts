import type {
  SemanticTarget,
  TestAssertion
} from '../planner/test-plan-schema.js';

import { collapseWhitespace, errorMessage } from '../util/text.js';

import type { BrowserToolCaller } from './step-executor.js';

import type { CaptureStore } from './capture-store.js';

import type {
  ResolvedTarget,
  SemanticResolver
} from './semantic-resolver.js';

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

  /**
   * The elements found for the assertion's target, when it needed
   * a lookup. Shows what the LLM pointed at, so a wrong match can be
   * spotted in a report.
   */
  matched?: string[];
}

interface Outcome {
  passed: boolean;
  actual: string;
  matched?: string[];
}

interface PageState {
  url: string;
  yaml: string;
  elements: SnapshotElement[];
}

/** An assertion with its placeholders already filled in. */
interface Prepared {
  index: number;
  assertion: TestAssertion;
  expected: string;
  target: SemanticTarget;
}

const ABSENT_WORDS = new Set([
  'hidden',
  'not visible',
  'invisible',
  'absent',
  'not present'
]);

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
 * Decides pass or fail from the elements that were found.
 */
function judge(
  type: TestAssertion['type'],
  expected: string,
  found: ResolvedTarget[],
  page: PageState
): Outcome {
  const matched = found.map(entry => entry.element);

  switch (type) {
    case 'element_count':
      return {
        passed: found.length === Number(expected),
        actual: String(found.length),
        matched
      };

    case 'visibility': {
      const wantAbsent = ABSENT_WORDS.has(
        expected.trim().toLowerCase()
      );

      return {
        passed: wantAbsent ? found.length === 0 : found.length > 0,
        actual: found.length > 0 ? 'visible' : 'not found',
        matched
      };
    }

    case 'text':
    case 'input_value': {
      if (found.length === 0) {
        return { passed: false, actual: 'element not found', matched };
      }

      const values = found.map(entry =>
        collapseWhitespace(
          type === 'input_value'
            ? (page.elements[entry.index]?.text ?? '')
            : getElementText(page.elements, entry.index)
        )
      );

      return {
        passed: values.includes(collapseWhitespace(expected)),
        actual: values.join(' | '),
        matched
      };
    }

    default:
      throw new Error(`Cannot judge assertion type: ${type}`);
  }
}

/**
 * Checks plan assertions against the live page.
 *
 * Assertions that belong to the same checkpoint are checked together:
 * the page is read once and the elements for all of them are looked up
 * in one LLM request. Each result still records what was expected and
 * what was actually seen.
 */
export class AssertionEngine {
  constructor(private readonly options: AssertionEngineOptions) {}

  async evaluate(assertion: TestAssertion): Promise<AssertionResult> {
    const [result] = await this.evaluateMany([assertion]);

    return result as AssertionResult;
  }

  async evaluateMany(
    assertions: TestAssertion[]
  ): Promise<AssertionResult[]> {
    const startedAt = Date.now();

    const { captures, recoveryAttempts, browser } = this.options;

    const results: AssertionResult[] = assertions.map(assertion => ({
      assertionId: assertion.assertionId,
      acceptanceCriterionId: assertion.acceptanceCriterionId,
      afterStepId: assertion.afterStepId,
      type: assertion.type,
      status: 'error',
      expected: assertion.expectedValue,
      actual: '',
      explanation: assertion.explanation,
      durationMs: 0
    }));

    const fail = (index: number, error: unknown): void => {
      const result = results[index] as AssertionResult;

      result.status = 'error';

      result.error = captures.redactAndShorten(errorMessage(error));
    };

    // Fill in placeholders. A problem here affects only that assertion.
    let pending: Prepared[] = [];

    assertions.forEach((assertion, index) => {
      try {
        if (assertion.type === 'application_state') {
          throw new Error(
            'application_state assertions cannot be checked from the ' +
            'page and need manual review.'
          );
        }

        const expected = captures.render(assertion.expectedValue);

        (results[index] as AssertionResult).expected = expected;

        if (
          assertion.type === 'element_count' &&
          (!Number.isInteger(Number(expected)) || Number(expected) < 0)
        ) {
          throw new Error(
            `element_count expects a whole number, got "${expected}".`
          );
        }

        pending.push({
          index,
          assertion,
          expected,
          target: captures.renderTarget(assertion.target)
        });
      } catch (error) {
        fail(index, error);
      }
    });

    for (
      let attempt = 0;
      attempt <= recoveryAttempts && pending.length > 0;
      attempt++
    ) {
      if (attempt > 0) {
        await browser.callTool('browser_wait_for', { time: 1 });
      }

      let outcomes: Array<Outcome | Error>;

      try {
        // A re-check asks the LLM again instead of reusing its earlier
        // answer, so one wrong answer is not repeated.
        outcomes = await this.checkMany(
          pending,
          await this.readPage(),
          attempt > 0
        );
      } catch (error) {
        // The page could not be read: nothing pending can be checked.
        for (const item of pending) {
          fail(item.index, error);
        }

        pending = [];

        break;
      }

      const stillFailing: Prepared[] = [];

      pending.forEach((item, position) => {
        const outcome = outcomes[position] as Outcome | Error;

        if (outcome instanceof Error) {
          fail(item.index, outcome);

          return;
        }

        const result = results[item.index] as AssertionResult;

        result.actual = outcome.actual;
        result.status = outcome.passed ? 'passed' : 'failed';

        if (outcome.matched !== undefined) {
          result.matched = outcome.matched;
        }

        if (!outcome.passed) {
          stillFailing.push(item);
        }
      });

      pending = stillFailing;
    }

    const durationMs = Date.now() - startedAt;

    for (const result of results) {
      result.durationMs = durationMs;
    }

    return results;
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

  /**
   * One outcome per prepared assertion, in the same order. URL checks
   * need no element lookup; every other type shares one lookup call.
   */
  private async checkMany(
    prepared: Prepared[],
    page: PageState,
    fresh: boolean
  ): Promise<Array<Outcome | Error>> {
    const outcomes: Array<Outcome | Error | undefined> = prepared.map(
      item =>
        item.assertion.type === 'url'
          ? {
              passed: urlsMatch(page.url, item.expected),
              actual: page.url
            }
          : undefined
    );

    const lookups = outcomes.flatMap((outcome, position) =>
      outcome === undefined ? [position] : []
    );

    if (lookups.length > 0) {
      try {
        const found = await this.options.resolver.resolveMany(
          lookups.map(
            position => (prepared[position] as Prepared).target
          ),
          page.elements,
          page.yaml,
          { fresh }
        );

        lookups.forEach((position, order) => {
          const item = prepared[position] as Prepared;

          outcomes[position] = judge(
            item.assertion.type,
            item.expected,
            found[order] as ResolvedTarget[],
            page
          );
        });
      } catch (error) {
        const failure =
          error instanceof Error ? error : new Error(String(error));

        for (const position of lookups) {
          outcomes[position] = failure;
        }
      }
    }

    return outcomes as Array<Outcome | Error>;
  }
}
