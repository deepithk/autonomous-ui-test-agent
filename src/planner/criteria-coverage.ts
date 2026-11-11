import type {
  AcceptanceCriterion
} from '../github/acceptance-criteria-parser.js';

import { collapseWhitespace } from '../util/text.js';

import type { GeneratedTestPlan } from './test-plan-schema.js';

/**
 * A condition of an acceptance criterion that no assertion checks, so a
 * PASSED verdict for the criterion would claim more than was verified.
 *
 * value-not-checked: a value written in quotation marks in the criterion,
 *                    such as "Name (A to Z)", appears in none of its
 *                    assertions.
 * too-few-assertions: the criterion states several separate conditions,
 *                    but fewer assertions check it.
 */
export interface CoverageGap {
  criterionId: string;
  kind: 'value-not-checked' | 'too-few-assertions';
  problem: string;
}

const QUOTED_VALUE = /"([^"]+)"|“([^”]+)”/g;

/**
 * The outcome part of a criterion: the text after "Then". A criterion
 * written without Given/When/Then is taken as a whole.
 */
export function outcomeText(description: string): string {
  const match = /(?:^|\n)\s*Then\b([\s\S]*)$/i.exec(description);

  return (match?.[1] ?? description).trim();
}

/**
 * Values the criterion writes in quotation marks.
 */
export function quotedValues(text: string): string[] {
  return [...text.matchAll(QUOTED_VALUE)]
    .map(match => (match[1] ?? match[2] ?? '').trim())
    .filter(value => value !== '');
}

/**
 * The separate conditions an outcome states. Sentences, comma lists and
 * "and" each separate conditions. Text in quotation marks is set aside
 * first, so an "and" or a comma inside a quoted value is not a split.
 */
export function splitConditions(outcome: string): string[] {
  return outcome
    .replace(QUOTED_VALUE, ' VALUE ')
    .split(/(?<=[.!?])\s+/)
    .flatMap(sentence =>
      sentence
        .replace(/[.!?\s]+$/, '')
        .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    )
    .map(part => part.trim())
    .filter(part => part !== '');
}

function normalize(text: string): string {
  return collapseWhitespace(text).toLowerCase();
}

/**
 * Finds acceptance criteria whose conditions are not all checked by the
 * plan's assertions.
 *
 * This is a check on what the plan covers, written to have no false
 * alarms on well-formed criteria: it only demands that quoted values are
 * checked, and that a criterion listing N conditions has N assertions.
 */
export function findCoverageGaps(
  criteria: readonly AcceptanceCriterion[],
  plan: GeneratedTestPlan
): CoverageGap[] {
  const assertions = plan.scenarios.flatMap(
    scenario => scenario.assertions
  );

  const gaps: CoverageGap[] = [];

  for (const criterion of criteria) {
    const own = assertions.filter(
      assertion => assertion.acceptanceCriterionId === criterion.id
    );

    const checked = normalize(
      own
        .map(assertion =>
          [
            assertion.expectedValue,
            assertion.explanation,
            assertion.target.description,
            assertion.target.visibleText,
            assertion.target.accessibleName,
            assertion.target.label
          ]
            .filter(part => part)
            .join(' ')
        )
        .join(' | ')
    );

    const outcome = outcomeText(criterion.description);

    const missingValues = quotedValues(outcome).filter(
      value => !checked.includes(normalize(value))
    );

    for (const value of missingValues) {
      gaps.push({
        criterionId: criterion.id,
        kind: 'value-not-checked',
        problem:
          `The value "${value}" named in the criterion is not ` +
          'checked by any of its assertions.'
      });
    }

    // Missing values already explain an under-checked criterion.
    if (missingValues.length > 0) {
      continue;
    }

    const conditions = splitConditions(outcome);

    if (conditions.length > own.length) {
      gaps.push({
        criterionId: criterion.id,
        kind: 'too-few-assertions',
        problem:
          `The criterion states ${conditions.length} separate ` +
          `conditions, but only ${own.length} ` +
          `assertion${own.length === 1 ? '' : 's'} check it.`
      });
    }
  }

  return gaps;
}

/**
 * Feedback for asking the planner to try again: what was missed, in the
 * words of the criterion.
 */
export function coverageFeedback(gaps: readonly CoverageGap[]): string {
  return [
    'The previous plan did not fully check these acceptance criteria:',
    ...gaps.map(gap => `- ${gap.criterionId}: ${gap.problem}`),
    '',
    'Return the complete plan again. Keep what was correct, and add an ' +
      'assertion for every condition that was missed.'
  ].join('\n');
}
