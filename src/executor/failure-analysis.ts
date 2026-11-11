import { isQuotaError } from '../planner/providers/retrying-provider.js';

import { shorten } from '../util/text.js';

import type { ScenarioResult } from './scenario-runner.js';

/**
 * application:  the page was checked and did not match the criterion.
 * automation:   the agent could not complete a step on the page.
 * llm-provider: the LLM service failed or refused the request. This says
 *               nothing about the application.
 * environment:  the browser could not reach the site (a network problem).
 *               This says nothing about the application either.
 * limit:        a configured run limit was reached.
 */
export type FailureCategory =
  | 'application'
  | 'automation'
  | 'llm-provider'
  | 'environment'
  | 'limit';

export interface FailureFinding {
  scenarioId: string;
  title: string;
  category: FailureCategory;

  /** What happened, in one sentence. */
  summary: string;

  /** What to do about it. */
  advice: string;

  criterionIds: string[];
  stepId?: string;
  expected?: string;
  actual?: string;

  /** What the page showed when it happened. */
  pageUrl?: string;
  pageNotes?: string[];

  /** Screenshot paths that show the problem. */
  screenshots: string[];
}

// Briefly unavailable services. An empty reply is deliberately not
// here: it is explained below as an unusable answer, not as downtime.
const TEMPORARY_PATTERN =
  /\b(500|502|503|504|529)\b|UNAVAILABLE|overloaded|high demand|ECONNRESET|ETIMEDOUT/i;

const PROVIDER_PATTERN =
  /Gemini generation failed|Anthropic generation failed|LLM_API_KEY|returned invalid JSON|returned an empty response|LLM response/i;

const NOT_FOUND_PATTERN =
  /No element matched|elements matched|not in the snapshot|did not answer for/i;

const NAVIGATION_PATTERN = /Navigation to|Invalid navigation URL/i;

const NETWORK_PATTERN =
  /net::ERR_|ERR_NETWORK|ERR_CONNECTION|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|ENOTFOUND/i;

const LIMIT_PATTERN = /time limit|more than the limit/i;

/**
 * Decides what kind of problem a message describes and what to do.
 */
export function classifyMessage(message: string): {
  category: FailureCategory;
  advice: string;
} {
  if (isQuotaError(message)) {
    return {
      category: 'llm-provider',
      advice:
        'The LLM provider refused the request because a quota or rate ' +
        'limit was reached. Wait for the quota to reset or use another ' +
        'model. This is not an application defect.'
    };
  }

  if (TEMPORARY_PATTERN.test(message)) {
    return {
      category: 'llm-provider',
      advice:
        'The LLM provider was temporarily unavailable. Run the test ' +
        'again. This is not an application defect.'
    };
  }

  if (PROVIDER_PATTERN.test(message)) {
    return {
      category: 'llm-provider',
      advice:
        'The LLM service did not give a usable answer. Check the API ' +
        'key and model name, then run again.'
    };
  }

  if (NETWORK_PATTERN.test(message)) {
    return {
      category: 'environment',
      advice:
        'The browser could not reach the site. This points to a network ' +
        'problem, not the application. Check the connection (and any VPN ' +
        'or proxy) and run again.'
    };
  }

  if (LIMIT_PATTERN.test(message)) {
    return {
      category: 'limit',
      advice:
        'A configured limit was reached. Raise SCENARIO_TIMEOUT_MS or ' +
        'MAX_STEPS_PER_SCENARIO if the application is only slow.'
    };
  }

  if (NAVIGATION_PATTERN.test(message)) {
    return {
      category: 'automation',
      advice:
        'Navigation was blocked because it leaves the target site. ' +
        'Check the plan and TARGET_BASE_URL.'
    };
  }

  if (NOT_FOUND_PATTERN.test(message)) {
    return {
      category: 'automation',
      advice:
        'The element the plan describes was not found on the page. ' +
        'Look at the screenshot and the page notes: the UI may have ' +
        'changed, or an earlier step may have left the page in an ' +
        'unexpected state.'
    };
  }

  return {
    category: 'automation',
    advice:
      'The agent could not complete this step. Look at the screenshot ' +
      'and the execution log for the step.'
  };
}

/**
 * Messages in a finding are cut at this many characters. It matches the
 * limit on step errors, so a step that failed and then failed to heal
 * shows both messages in full.
 */
const SUMMARY_LENGTH = 400;

/**
 * Turns a scenario that did not pass into findings, each with a
 * category and advice. A scenario that passed has none.
 *
 * Assertions that were "not evaluated" because a step failed are a
 * consequence, not a separate problem, so they are not listed.
 */
export function analyzeFailures(
  scenario: ScenarioResult
): FailureFinding[] {
  if (scenario.status === 'passed') {
    return [];
  }

  const findings: FailureFinding[] = [];

  const context = scenario.failureContext;

  const shotsFor = (...reasons: string[]): string[] =>
    scenario.screenshots
      .filter(shot => reasons.includes(shot.reason))
      .map(shot => shot.path);

  const contextFor = (stepId: string) =>
    context && context.stepId === stepId
      ? {
          pageUrl: context.url,
          pageNotes: context.notes
        }
      : {};

  for (const step of scenario.steps) {
    if (step.status !== 'failed') {
      continue;
    }

    const message = step.error ?? 'unknown error';

    const { category, advice } = classifyMessage(message);

    findings.push({
      scenarioId: scenario.scenarioId,
      title: scenario.title,
      category,
      summary: `${step.stepId} failed: ${shorten(message, SUMMARY_LENGTH)}`,
      advice,
      criterionIds: scenario.acceptanceCriterionIds,
      stepId: step.stepId,
      ...contextFor(step.stepId),
      screenshots: shotsFor('failure')
    });
  }

  for (const assertion of scenario.assertions) {
    if (assertion.status === 'failed') {
      findings.push({
        scenarioId: scenario.scenarioId,
        title: scenario.title,
        category: 'application',
        summary:
          `${assertion.assertionId} (${assertion.acceptanceCriterionId}) ` +
          `expected "${shorten(assertion.expected, SUMMARY_LENGTH)}" ` +
          `but the page showed ` +
          `"${shorten(assertion.actual, SUMMARY_LENGTH)}"` +
          (assertion.matched && assertion.matched.length > 0
            ? ` (elements found: ${assertion.matched
                .slice(0, 3)
                .map(entry => shorten(entry, 80))
                .join('; ')})`
            : ''),
        advice:
          'The page was checked and does not match the acceptance ' +
          `criterion ${assertion.acceptanceCriterionId}. If the ` +
          'messages on the page explain it, fix the cause; otherwise ' +
          'compare the screenshot with the criterion.',
        criterionIds: [assertion.acceptanceCriterionId],
        stepId: assertion.afterStepId,
        expected: assertion.expected,
        actual: assertion.actual,
        ...contextFor(assertion.afterStepId),
        screenshots: shotsFor('checkpoint', 'step').filter(path =>
          path.includes(`_${assertion.afterStepId}_`)
        )
      });

      continue;
    }

    const consequence =
      assertion.status === 'error' &&
      (assertion.error ?? '').startsWith('Not evaluated');

    if (assertion.status === 'error' && !consequence) {
      const { category, advice } = classifyMessage(
        assertion.error ?? ''
      );

      findings.push({
        scenarioId: scenario.scenarioId,
        title: scenario.title,
        category,
        summary:
          `${assertion.assertionId} (${assertion.acceptanceCriterionId}) ` +
          `could not be checked: ${shorten(
            assertion.error ?? '',
            SUMMARY_LENGTH
          )}`,
        advice,
        criterionIds: [assertion.acceptanceCriterionId],
        stepId: assertion.afterStepId,
        screenshots: []
      });
    }
  }

  // The scenario itself stopped (time limit, browser did not start)
  // without a step or assertion explaining it.
  if (findings.length === 0 && scenario.error) {
    const { category, advice } = classifyMessage(scenario.error);

    findings.push({
      scenarioId: scenario.scenarioId,
      title: scenario.title,
      category,
      summary: shorten(scenario.error, SUMMARY_LENGTH),
      advice,
      criterionIds: scenario.acceptanceCriterionIds,
      screenshots: shotsFor('failure')
    });
  }

  return findings;
}
