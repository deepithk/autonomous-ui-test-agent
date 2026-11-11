import { describe, expect, it } from 'vitest';

import {
  GeneratedTestPlanSchema,
  validateTestPlan
} from '../../src/planner/test-plan-schema.js';

const validPlan = {
  planTitle: 'SauceDemo Shopping Cart Test Plan',

  summary: 'Validate login and product cart functionality.',

  scenarios: [
    {
      scenarioId: 'SC-001',
      title: 'Login and Add Product',
      objective: 'Verify login and product addition.',

      acceptanceCriterionIds: ['AC-01', 'AC-02'],

      preconditions: [
        'SauceDemo application is accessible.'
      ],

      steps: [
        {
          stepId: 'STEP-01',
          action: 'click',
          instruction: 'Activate the Login button after entering credentials.',

          target: {
            description: 'Login button',
            role: 'button',
            accessibleName: 'Login',
            visibleText: 'Login',
            label: null
          },

          value: null,

          expectedObservation: 'Products inventory page is displayed.'
        }
      ],

      assertions: [
        {
          assertionId: 'ASSERT-01',
          acceptanceCriterionId: 'AC-01',
          type: 'url',
          afterStepId: 'STEP-01',

          target: {
            description: 'Current browser URL',
            role: null,
            accessibleName: null,
            visibleText: null,
            label: null
          },

          expectedValue: 'inventory',
          explanation: 'Verify navigation to the inventory page.'
        },
        {
          assertionId: 'ASSERT-02',
          acceptanceCriterionId: 'AC-02',
          type: 'visibility',
          afterStepId: 'STEP-01',

          target: {
            description: 'Selected product in shopping cart',
            role: null,
            accessibleName: null,
            visibleText: 'Sauce Labs Backpack',
            label: null
          },

          expectedValue: 'visible',
          explanation: 'Verify the selected product is visible.'
        }
      ],

      expectedOutcome: 'Login succeeds and the product is added.'
    }
  ]
};

const sourceCriterionIds = ['AC-01', 'AC-02'];

describe('Test Plan Schema', () => {

  it('accepts a structurally valid generated test plan', () => {
    const result = GeneratedTestPlanSchema.safeParse(validPlan);

    expect(result.success).toBe(true);
  });

  it('validates a plan with complete acceptance criteria coverage', () => {
    const result = validateTestPlan(
      validPlan,
      sourceCriterionIds
    );

    expect(result.planTitle).toBe(
      'SauceDemo Shopping Cart Test Plan'
    );

    expect(result.scenarios).toHaveLength(1);

    expect(result.scenarios[0]?.acceptanceCriterionIds).toEqual([
      'AC-01',
      'AC-02'
    ]);
  });

  it('rejects missing required plan properties', () => {
    const result = GeneratedTestPlanSchema.safeParse({
      planTitle: 'Incomplete Plan'
    });

    expect(result.success).toBe(false);
  });

  it('rejects unsupported browser actions', () => {
    const invalidPlan = {
      ...validPlan,
      scenarios: [
        {
          ...validPlan.scenarios[0],
          steps: [
            {
              ...validPlan.scenarios[0].steps[0],
              action: 'execute_javascript'
            }
          ]
        }
      ]
    };

    const result = GeneratedTestPlanSchema.safeParse(
      invalidPlan
    );

    expect(result.success).toBe(false);
  });

  it('rejects unknown acceptance criterion references', () => {
    const invalidPlan = {
      ...validPlan,
      scenarios: [
        {
          ...validPlan.scenarios[0],
          acceptanceCriterionIds: ['AC-01', 'AC-99']
        }
      ]
    };

    expect(() =>
      validateTestPlan(
        invalidPlan,
        sourceCriterionIds
      )
    ).toThrow('references unknown acceptance criterion AC-99');
  });

  it('rejects plans with missing acceptance criteria coverage', () => {
    expect(() =>
      validateTestPlan(
        validPlan,
        ['AC-01', 'AC-02', 'AC-03']
      )
    ).toThrow('Test plan does not cover: AC-03');
  });

  it('rejects criteria without a corresponding assertion', () => {
    const invalidPlan = {
      ...validPlan,
      scenarios: [
        {
          ...validPlan.scenarios[0],
          assertions: [
            validPlan.scenarios[0].assertions[0]
          ]
        }
      ]
    };

    expect(() =>
      validateTestPlan(
        invalidPlan,
        sourceCriterionIds
      )
    ).toThrow('has no assertion for AC-02');
  });

  it('rejects duplicate scenario IDs', () => {
    const scenario = validPlan.scenarios[0];

    const invalidPlan = {
      ...validPlan,
      scenarios: [
        scenario,
        { ...scenario }
      ]
    };

    expect(() =>
      validateTestPlan(
        invalidPlan,
        sourceCriterionIds
      )
    ).toThrow('Duplicate scenario ID');
  });

  it('rejects duplicate assertion IDs', () => {
    const firstAssertion = validPlan.scenarios[0].assertions[0];
    const secondAssertion = validPlan.scenarios[0].assertions[1];

    const invalidPlan = {
      ...validPlan,
      scenarios: [
        {
          ...validPlan.scenarios[0],
          assertions: [
            firstAssertion,
            {
              ...secondAssertion,
              assertionId: firstAssertion.assertionId
            }
          ]
        }
      ]
    };

    expect(() =>
      validateTestPlan(
        invalidPlan,
        sourceCriterionIds
      )
    ).toThrow('Duplicate assertion ID');
  });

  
it('rejects Add to Cart actions without a selected product reference', () => {
  const baseScenario = validPlan.scenarios[0];

  const invalidPlan = {
    ...validPlan,
    scenarios: [
      {
        ...baseScenario,
        steps: [
          {
            ...baseScenario.steps[0],
            action: 'observe' as const,
            capture: {
              key: 'selectedProductName',
              source: 'text' as const
            }
          },
          {
            ...baseScenario.steps[0],
            stepId: 'STEP-02',
            action: 'click' as const,
            instruction: 'Click Add to Cart.',
            target: {
              ...baseScenario.steps[0].target,
              description: 'Add to Cart button'
            },
            capture: null
          }
        ],
        assertions: baseScenario.assertions.map(assertion => ({
          ...assertion,
          afterStepId: 'STEP-02'
        }))
      }
    ]
  };

  expect(() =>
    validateTestPlan(invalidPlan, sourceCriterionIds)
  ).toThrow(
    'product Add to Cart and Remove actions must reference'
  );
});

it('rejects product price capture without selected product scoping', () => {
  const baseScenario = validPlan.scenarios[0];

  const invalidPlan = {
    ...validPlan,
    scenarios: [
      {
        ...baseScenario,
        steps: [
          {
            ...baseScenario.steps[0],
            action: 'observe' as const,
            capture: {
              key: 'selectedProductName',
              source: 'text' as const
            }
          },
          {
            ...baseScenario.steps[0],
            stepId: 'STEP-02',
            action: 'observe' as const,
            instruction: 'Capture product price.',
            target: {
              ...baseScenario.steps[0].target,
              description: 'First available product price'
            },
            capture: {
              key: 'selectedProductPrice',
              source: 'text' as const
            }
          }
        ],
        assertions: baseScenario.assertions.map(assertion => ({
          ...assertion,
          afterStepId: 'STEP-02'
        }))
      }
    ]
  };

    expect(() =>
        validateTestPlan(invalidPlan, sourceCriterionIds)
    ).toThrow(
        'product price capture must reference'
    );
  });

  it('rejects duplicate source acceptance criteria IDs', () => {
    expect(() =>
      validateTestPlan(
        validPlan,
        ['AC-01', 'AC-01']
      )
    ).toThrow('Source acceptance criteria contain duplicate IDs');
  });

  it('rejects duplicate criterion mappings in a scenario', () => {
    const invalidPlan = {
      ...validPlan,
      scenarios: [
        {
          ...validPlan.scenarios[0],
          acceptanceCriterionIds: [
            'AC-01',
            'AC-01'
          ]
        }
      ]
    };

    expect(() =>
      validateTestPlan(
        invalidPlan,
        sourceCriterionIds
      )
    ).toThrow('contains duplicate acceptance criterion IDs');
  });

  // New test 12: Maximum execution steps

  it('rejects scenarios exceeding the maximum step count', () => {
    const baseStep = validPlan.scenarios[0].steps[0];

    const invalidPlan = {
      ...validPlan,
      scenarios: [
        {
          ...validPlan.scenarios[0],
          steps: Array.from(
            { length: 16 },
            (_, index) => ({
              ...baseStep,
              stepId: `STEP-${String(index + 1).padStart(2, '0')}`
            })
          )
        }
      ]
    };

    expect(
      GeneratedTestPlanSchema.safeParse(invalidPlan).success
    ).toBe(false);
  });

  // New test 13: Maximum scenario count

  it('rejects plans exceeding the maximum scenario count', () => {
    const baseScenario = validPlan.scenarios[0];

    const invalidPlan = {
      ...validPlan,
      scenarios: Array.from(
        { length: 51 },
        (_, index) => ({
          ...baseScenario,
          scenarioId: `SC-${String(index + 1).padStart(3, '0')}`
        })
      )
    };

    expect(
      GeneratedTestPlanSchema.safeParse(invalidPlan).success
    ).toBe(false);
  });

  
it('accepts valid dynamic data capture references', () => {
  const capturePlan = {
    ...validPlan,
    scenarios: [
      {
        ...validPlan.scenarios[0],
        steps: [
          {
            ...validPlan.scenarios[0].steps[0],
            action: 'observe' as const,
            capture: {
              key: 'selectedProductName',
              source: 'text' as const
            }
          }
        ],
        assertions: [
          {
            ...validPlan.scenarios[0].assertions[0],
            expectedValue:
              '{{capture.selectedProductName}}'
          },
          validPlan.scenarios[0].assertions[1]
        ]
      }
    ]
  };

  expect(() =>
    validateTestPlan(capturePlan, sourceCriterionIds)
  ).not.toThrow();
});


it('rejects assertions referencing unknown execution checkpoints', () => {
  const invalidPlan = {
    ...validPlan,
    scenarios: [
      {
        ...validPlan.scenarios[0],
        assertions: [
          {
            ...validPlan.scenarios[0].assertions[0],
            afterStepId: 'STEP-99'
          },
          validPlan.scenarios[0].assertions[1]
        ]
      }
    ]
  };

  expect(() =>
    validateTestPlan(invalidPlan, sourceCriterionIds)
  ).toThrow(
    'Assertion ASSERT-01 references unknown execution checkpoint STEP-99.'
  );
});

it('rejects assertions using captures before the capture step', () => {
  const invalidPlan = {
    ...validPlan,
    scenarios: [
      {
        ...validPlan.scenarios[0],
        steps: [
          validPlan.scenarios[0].steps[0],
          {
            ...validPlan.scenarios[0].steps[0],
            stepId: 'STEP-02',
            action: 'observe' as const,
            instruction: 'Capture the product name.',
            capture: {
              key: 'selectedProductName',
              source: 'text' as const
            }
          }
        ],
        assertions: [
          {
            ...validPlan.scenarios[0].assertions[0],
            afterStepId: 'STEP-01',
            expectedValue:
              '{{capture.selectedProductName}}'
          },
          validPlan.scenarios[0].assertions[1]
        ]
      }
    ]
  };

  expect(() =>
    validateTestPlan(invalidPlan, sourceCriterionIds)
  ).toThrow(
    'Assertion ASSERT-01 references capture "selectedProductName" before it is available.'
  );
});

it('rejects references to undefined captures', () => {
  const invalidPlan = {
    ...validPlan,
    scenarios: [
        {
            ...validPlan.scenarios[0],
            assertions: [
            {
                ...validPlan.scenarios[0].assertions[0],
                expectedValue:
                '{{capture.unknownProduct}}'
            },
            validPlan.scenarios[0].assertions[1]
            ]
        }
    ]
  };

    expect(() =>
        validateTestPlan(invalidPlan, sourceCriterionIds)
    ).toThrow(
        'references capture "unknownProduct" before it is available.'
    );
    });
});