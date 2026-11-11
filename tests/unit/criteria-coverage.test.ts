import { describe, expect, it } from 'vitest';

import {
  coverageFeedback,
  findCoverageGaps,
  outcomeText,
  quotedValues,
  splitConditions
} from '../../src/planner/criteria-coverage.js';

import type {
  GeneratedTestPlan
} from '../../src/planner/test-plan-schema.js';

function criterion(id: string, description: string) {
  return { id, title: `Criterion ${id}`, description };
}

/** A plan with only the fields the coverage check reads. */
function plan(
  assertions: Array<{
    criterion: string;
    expected: string;
    target?: string;
  }>
): GeneratedTestPlan {
  return {
    planTitle: 'Plan',
    summary: 'Summary',
    scenarios: [
      {
        assertions: assertions.map((assertion, index) => ({
          assertionId: `ASSERT-0${index + 1}`,
          acceptanceCriterionId: assertion.criterion,
          expectedValue: assertion.expected,
          explanation: 'Checks something.',
          target: {
            description: assertion.target ?? 'Some element',
            role: null,
            accessibleName: null,
            visibleText: null,
            label: null
          }
        }))
      }
    ]
  } as unknown as GeneratedTestPlan;
}

const SORT_DEFAULT = criterion(
  'AC-02',
  'Given the user is on the products inventory page,\n\n' +
    'Then the sort selector should show "Name (A to Z)" and the first ' +
    'product listed should be "Sauce Labs Backpack".'
);

describe('outcomeText', () => {
  it('takes the text after Then', () => {
    expect(
      outcomeText('Given a,\n\nWhen b,\n\nThen the page opens.')
    ).toBe('the page opens.');
  });

  it('takes a criterion without Then as a whole', () => {
    expect(outcomeText('The page opens.')).toBe('The page opens.');
  });
});

describe('quotedValues', () => {
  it('finds straight and curly quoted values', () => {
    expect(
      quotedValues('show "Name (A to Z)" and “Backpack”')
    ).toEqual(['Name (A to Z)', 'Backpack']);
  });

  it('finds none in text without quotes', () => {
    expect(quotedValues('the cart is empty')).toEqual([]);
  });
});

describe('splitConditions', () => {
  it.each([
    ['the products inventory page should be displayed.', 1],
    ['the shopping cart badge should display the correct item count.', 1],
    [
      'the cart should display the correct product name, quantity and price.',
      3
    ],
    [
      'the shopping cart should contain no products and the cart badge should reflect the empty state.',
      2
    ],
    [
      'the sort selector should show "Name (A to Z)" and the first product listed should be "Sauce Labs Backpack".',
      2
    ],
    ['the user sees "Salt and Pepper" in the list.', 1],
    ['the cart opens. The badge shows 1.', 2]
  ])('counts the conditions in "%s"', (outcome, count) => {
    expect(splitConditions(outcome)).toHaveLength(count);
  });
});

describe('findCoverageGaps', () => {
  it('finds a quoted value that no assertion checks', () => {
    const gaps = findCoverageGaps(
      [SORT_DEFAULT],
      plan([{ criterion: 'AC-02', expected: 'Sauce Labs Backpack' }])
    );

    expect(gaps).toEqual([
      {
        criterionId: 'AC-02',
        kind: 'value-not-checked',
        problem:
          'The value "Name (A to Z)" named in the criterion is not ' +
          'checked by any of its assertions.'
      }
    ]);
  });

  it('is satisfied when every quoted value is checked', () => {
    expect(
      findCoverageGaps(
        [SORT_DEFAULT],
        plan([
          { criterion: 'AC-02', expected: 'Name (A to Z)' },
          { criterion: 'AC-02', expected: 'Sauce Labs Backpack' }
        ])
      )
    ).toEqual([]);
  });

  it('accepts a value that appears in the assertion target instead', () => {
    expect(
      findCoverageGaps(
        [SORT_DEFAULT],
        plan([
          {
            criterion: 'AC-02',
            expected: 'selected',
            target: 'Sort selector showing "name (a to z)"'
          },
          { criterion: 'AC-02', expected: 'Sauce Labs Backpack' }
        ])
      )
    ).toEqual([]);
  });

  it('finds a criterion that lists more conditions than it has assertions', () => {
    const cartContents = criterion(
      'AC-04',
      'Given a product has been added,\n\nWhen the user opens the shopping ' +
        'cart,\n\nThen the cart should display the correct product name, ' +
        'quantity and price.'
    );

    const gaps = findCoverageGaps(
      [cartContents],
      plan([
        { criterion: 'AC-04', expected: 'Backpack' },
        { criterion: 'AC-04', expected: '1' }
      ])
    );

    expect(gaps).toEqual([
      {
        criterionId: 'AC-04',
        kind: 'too-few-assertions',
        problem:
          'The criterion states 3 separate conditions, but only 2 ' +
          'assertions check it.'
      }
    ]);
  });

  it('uses the singular for one assertion', () => {
    const empty = criterion(
      'AC-06',
      'Given the product has been removed,\n\nThen the shopping cart ' +
        'should contain no products and the cart badge should reflect ' +
        'the empty state.'
    );

    expect(
      findCoverageGaps([empty], plan([{ criterion: 'AC-06', expected: '0' }]))[0]
        ?.problem
    ).toBe(
      'The criterion states 2 separate conditions, but only 1 assertion check it.'
    );
  });

  it('has no gaps for single-condition criteria checked once', () => {
    expect(
      findCoverageGaps(
        [
          criterion(
            'AC-01',
            'Given the login page,\n\nWhen valid credentials are entered,\n\n' +
              'Then the products inventory page should be displayed.'
          )
        ],
        plan([{ criterion: 'AC-01', expected: '/inventory.html' }])
      )
    ).toEqual([]);
  });

  it('counts assertions from every scenario', () => {
    const tworows = {
      planTitle: 'p',
      summary: 's',
      scenarios: [
        {
          assertions: [
            {
              acceptanceCriterionId: 'AC-06',
              expectedValue: '0',
              explanation: 'e',
              target: { description: 'cart items' }
            }
          ]
        },
        {
          assertions: [
            {
              acceptanceCriterionId: 'AC-06',
              expectedValue: '0',
              explanation: 'e',
              target: { description: 'cart badge' }
            }
          ]
        }
      ]
    } as unknown as GeneratedTestPlan;

    expect(
      findCoverageGaps(
        [
          criterion(
            'AC-06',
            'Then the cart has no products and the badge is empty.'
          )
        ],
        tworows
      )
    ).toEqual([]);
  });

  it('reports a missing value only once per value, not also as too few', () => {
    const gaps = findCoverageGaps(
      [SORT_DEFAULT],
      plan([{ criterion: 'AC-02', expected: 'nothing relevant' }])
    );

    expect(gaps.map(gap => gap.kind)).toEqual([
      'value-not-checked',
      'value-not-checked'
    ]);
  });
});

describe('coverageFeedback', () => {
  it('lists each gap in the words of the check', () => {
    const feedback = coverageFeedback([
      {
        criterionId: 'AC-02',
        kind: 'value-not-checked',
        problem: 'The value "X" named in the criterion is not checked.'
      }
    ]);

    expect(feedback).toContain(
      '- AC-02: The value "X" named in the criterion is not checked.'
    );

    expect(feedback).toContain('Return the complete plan again.');
  });
});
