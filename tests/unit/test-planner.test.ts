import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  TestPlanner,
  TestPlannerError
} from '../../src/planner/test-planner.js';

import type {
  ILLMProvider,
  LLMGenerationRequest,
  LLMGenerationResult
} from '../../src/planner/providers/llm-provider.js';

import type {
  AcceptanceCriterion
} from '../../src/github/acceptance-criteria-parser.js';

const validCriteria: AcceptanceCriterion[] = [
  {
    id: 'AC-01',
    title: 'Successful Login',
    description:
      'Given the user is on the login page, valid credentials must display the products inventory page.'
  },
  {
    id: 'AC-02',
    title: 'Add Product to Cart',
    description:
      'When the user selects Add to cart, the selected product must be added to the shopping cart.'
  }
];

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

          expectedObservation:
            'Products inventory page is displayed.'
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

      expectedOutcome:
        'Login succeeds and the selected product is added.'
    }
  ]
};

interface MockProviderOptions {
  text?: string;
  finishReason?: string;
  error?: Error;
}

/**
 * Creates a mocked provider.
 * No actual Gemini or Claude API calls are made.
 */
function createMockProvider(
  options: MockProviderOptions = {}
): {
  provider: ILLMProvider;
  generateStructured: ReturnType<typeof vi.fn>;
} {
  const generateStructured = vi.fn(
    async (
      _request: LLMGenerationRequest
    ): Promise<LLMGenerationResult> => {
      if (options.error) {
        throw options.error;
      }

      return {
        text: options.text ?? JSON.stringify(validPlan),
        model: 'test-model',
        ...(options.finishReason
          ? { finishReason: options.finishReason }
          : {})
      };
    }
  );

  const provider: ILLMProvider = {
    providerName: 'gemini',
    generateStructured
  };

  return {
    provider,
    generateStructured
  };
}

describe('TestPlanner', () => {

  it('generates a valid test plan successfully', async () => {
    const { provider, generateStructured } =
      createMockProvider();

    const planner = new TestPlanner(provider);

    const result = await planner.generateTestPlan(
      validCriteria
    );

    expect(result.planTitle).toBe(
      'SauceDemo Shopping Cart Test Plan'
    );

    expect(result.scenarios).toHaveLength(1);

    expect(
      result.scenarios[0]?.acceptanceCriterionIds
    ).toEqual(['AC-01', 'AC-02']);

    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it('includes actual GitHub requirements in the prompt', async () => {
    const { provider, generateStructured } =
      createMockProvider();

    const planner = new TestPlanner(provider);

    await planner.generateTestPlan(validCriteria);

    const request = generateStructured.mock.calls[0]?.[0];

    expect(request).toBeDefined();

    expect(request.prompt).toContain('AC-01');
    expect(request.prompt).toContain('AC-02');
    expect(request.prompt).toContain('Successful Login');
    expect(request.prompt).toContain('Add Product to Cart');

    expect(request.systemInstruction).toContain(
      'Never invent additional business requirements'
    );
  });

  it('rejects empty acceptance criteria', async () => {
    const { provider, generateStructured } =
      createMockProvider();

    const planner = new TestPlanner(provider);

    await expect(
      planner.generateTestPlan([])
    ).rejects.toThrow(
      'At least one acceptance criterion is required.'
    );

    expect(generateStructured).not.toHaveBeenCalled();
  });

  it('rejects invalid source criterion IDs', async () => {
    const { provider, generateStructured } =
      createMockProvider();

    const planner = new TestPlanner(provider);

    const invalidCriteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        title: 'Successful Login',
        description: 'Valid credentials should work.'
      }
    ];

    await expect(
      planner.generateTestPlan(invalidCriteria)
    ).rejects.toThrow(
      'Source contains an invalid acceptance criterion ID.'
    );

    expect(generateStructured).not.toHaveBeenCalled();
  });

  it('rejects duplicate source criterion IDs', async () => {
    const { provider, generateStructured } =
      createMockProvider();

    const planner = new TestPlanner(provider);

    const duplicateCriteria = [
      validCriteria[0]!,
      {
        ...validCriteria[1]!,
        id: 'AC-01'
      }
    ];

    await expect(
      planner.generateTestPlan(duplicateCriteria)
    ).rejects.toThrow(
      'Duplicate source acceptance criterion ID: AC-01'
    );

    expect(generateStructured).not.toHaveBeenCalled();
  });

  it('rejects acceptance criteria with incomplete content', async () => {
    const { provider, generateStructured } =
      createMockProvider();

    const planner = new TestPlanner(provider);

    const incompleteCriteria: AcceptanceCriterion[] = [
      {
        id: 'AC-01',
        title: '',
        description: 'Expected behaviour.'
      }
    ];

    await expect(
      planner.generateTestPlan(incompleteCriteria)
    ).rejects.toThrow(
      'Acceptance criterion AC-01 has incomplete content.'
    );

    expect(generateStructured).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON returned by the provider', async () => {
    const { provider } = createMockProvider({
      text: '{"planTitle": "Incomplete JSON"'
    });

    const planner = new TestPlanner(provider);

    await expect(
      planner.generateTestPlan(validCriteria)
    ).rejects.toThrow(
      'LLM returned invalid JSON.'
    );
  });

  it('rejects responses truncated by the output token limit', async () => {
    const { provider } = createMockProvider({
      text: '{"planTitle":',
      finishReason: 'MAX_TOKENS'
    });

    const planner = new TestPlanner(provider);

    await expect(
      planner.generateTestPlan(validCriteria)
    ).rejects.toThrow(
      'LLM response was truncated'
    );
  });

  it('rejects structurally invalid generated plans', async () => {
    const { provider } = createMockProvider({
      text: JSON.stringify({
        planTitle: 'Incomplete Plan'
      })
    });

    const planner = new TestPlanner(provider);

    await expect(
      planner.generateTestPlan(validCriteria)
    ).rejects.toThrow(
      'Generated test plan validation failed'
    );
  });

  it('rejects generated plans with missing AC coverage', async () => {
    const incompletePlan = {
      ...validPlan,
      scenarios: [
        {
          ...validPlan.scenarios[0],
          acceptanceCriterionIds: ['AC-01'],
          assertions: [
            validPlan.scenarios[0].assertions[0]
          ]
        }
      ]
    };

    const { provider } = createMockProvider({
      text: JSON.stringify(incompletePlan)
    });

    const planner = new TestPlanner(provider);

    await expect(
      planner.generateTestPlan(validCriteria)
    ).rejects.toThrow(
      'Test plan does not cover: AC-02'
    );
  });

  it('rejects fabricated acceptance criterion references', async () => {
    const invalidPlan = {
      ...validPlan,
      scenarios: [
        {
          ...validPlan.scenarios[0],
          acceptanceCriterionIds: ['AC-01', 'AC-99'],
          assertions: [
            validPlan.scenarios[0].assertions[0],
            {
              ...validPlan.scenarios[0].assertions[1],
              acceptanceCriterionId: 'AC-99'
            }
          ]
        }
      ]
    };

    const { provider } = createMockProvider({
      text: JSON.stringify(invalidPlan)
    });

    const planner = new TestPlanner(provider);

    await expect(
      planner.generateTestPlan(validCriteria)
    ).rejects.toThrow(
      'references unknown acceptance criterion AC-99'
    );
  });

  it('wraps provider failures in TestPlannerError', async () => {
    const { provider } = createMockProvider({
      error: new Error('Provider unavailable')
    });

    const planner = new TestPlanner(provider);

    await expect(
      planner.generateTestPlan(validCriteria)
    ).rejects.toBeInstanceOf(TestPlannerError);

    await expect(
      planner.generateTestPlan(validCriteria)
    ).rejects.toThrow(
      'Test plan generation failed: Provider unavailable'
    );
  });

  it('rejects empty provider responses', async () => {
    const { provider } = createMockProvider({
      text: '   '
    });

    const planner = new TestPlanner(provider);

    await expect(
      planner.generateTestPlan(validCriteria)
    ).rejects.toThrow(
      'LLM returned an empty test plan.'
    );
  });

  it('rejects invalid planner output token configuration', () => {
    const { provider } = createMockProvider();

    expect(
      () => new TestPlanner(provider, {
        maxOutputTokens: 0
      })
    ).toThrow(
      'Maximum output tokens must be a positive integer.'
    );
  });

  
it('rejects configured credentials appearing in generated JSON', async () => {
  const unsafePlan = {
    ...validPlan,
    scenarios: [
      {
        ...validPlan.scenarios[0],
        steps: [
          {
            ...validPlan.scenarios[0].steps[0],
            instruction: 'Enter standard_user into the login field.'
          }
        ]
      }
    ]
  };

  const { provider } = createMockProvider({
    text: JSON.stringify(unsafePlan)
  });

  const planner = new TestPlanner(provider, {
    forbiddenValues: [
      'standard_user',
      'secret_sauce'
    ]
  });

  await expect(
    planner.generateTestPlan(validCriteria)
  ).rejects.toThrow(
    'Generated test plan contains configured sensitive data and was rejected.'
  );
});


it('rejects hardcoded username values in fill actions', async () => {
  const baseScenario = validPlan.scenarios[0];

  const unsafePlan = {
    ...validPlan,
    scenarios: [
      {
        ...baseScenario,

        // Preserve STEP-01 because existing assertions
        // reference this execution checkpoint.
        steps: [
          ...baseScenario.steps,

          {
            ...baseScenario.steps[0],
            stepId: 'STEP-02',
            action: 'fill' as const,
            instruction: 'Enter username.',
            target: {
              description: 'Username input field',
              role: 'textbox',
              accessibleName: 'Username',
              visibleText: null,
              label: 'Username'
            },
            value: 'literal-username',
            expectedObservation: 'Username entered.',
            capture: null
          }
        ]
      }
    ]
  };

  const { provider } = createMockProvider({
    text: JSON.stringify(unsafePlan)
  });

  const planner = new TestPlanner(provider);

  await expect(
    planner.generateTestPlan(validCriteria)
  ).rejects.toThrow(
    'contains an unsafe username value'
  );
});
});