import { z } from 'zod/v4';

/**
 * Allowed semantic browser actions.
 * No raw JavaScript, XPath or CSS selectors.
 */
export const BrowserActionSchema = z.enum([
  'navigate',
  'observe',
  'click',
  'fill',
  'type',
  'press_key',
  'select_option',
  'wait_for'
]);

/** Actions that do nothing without a value (a URL, text or a key). */
const VALUE_REQUIRED_ACTIONS: ReadonlySet<string> = new Set([
  'navigate',
  'fill',
  'type',
  'press_key',
  'select_option',
  'wait_for'
]);

/**
 * Describes a browser target using semantic information.
 */
export const SemanticTargetSchema = z.object({
  description: z.string().min(1).max(300),
  role: z.string().max(100).nullable(),
  accessibleName: z.string().max(200).nullable(),
  visibleText: z.string().max(200).nullable(),
  label: z.string().max(200).nullable()
}).strict();

/**
 * Defines a value captured from an observed browser element.
 */
export const StepCaptureSchema = z.object({
  key: z.string().regex(/^[a-z][A-Za-z0-9_]{0,49}$/),
  source: z.enum([
    'text',
    'input_value'
  ])
}).strict();

/**
 * Individual browser execution step.
 */
export const ExecutionStepSchema = z.object({
  stepId: z.string().regex(/^STEP-\d{2,}$/),
  action: BrowserActionSchema,
  instruction: z.string().min(1).max(500),
  target: SemanticTargetSchema,
  value: z.string().max(500).nullable(),
  expectedObservation: z.string().min(1).max(500),
  capture: StepCaptureSchema.nullable().default(null)
}).strict().superRefine((step, context) => {
  if (step.capture && step.action !== 'observe') {
    context.addIssue({
      code: 'custom',
      path: ['capture'],
      message: 'Values can only be captured during observe actions.'
    });
  }

  // The executor cannot run these actions without a value. Catching it
  // here stops a broken plan before a browser is opened.
  if (
    VALUE_REQUIRED_ACTIONS.has(step.action) &&
    (step.value === null || step.value.trim() === '')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['value'],
      message: `The ${step.action} action requires a value.`
    });
  }
});

/**
 * Supported evidence-based assertion types.
 */
export const AssertionTypeSchema = z.enum([
  'visibility',
  'text',
  'element_count',
  'url',
  'input_value',
  'application_state'
]);

/**
 * Assertion definition with an explicit execution checkpoint.
 *
 * afterStepId identifies the step that must complete before
 * the assertion can be evaluated.
 */
export const TestAssertionSchema = z.object({
  assertionId: z.string().regex(/^ASSERT-\d{2,}$/),

  acceptanceCriterionId: z.string().regex(/^AC-\d{2}$/),

  afterStepId: z.string().regex(/^STEP-\d{2,}$/),

  type: AssertionTypeSchema,

  target: SemanticTargetSchema,

  expectedValue: z.string().min(1).max(300),

  explanation: z.string().min(1).max(300)
}).strict();

/**
 * Dynamically generated test scenario.
 */
export const TestScenarioSchema = z.object({
  scenarioId: z.string().regex(/^SC-\d{3,}$/),

  title: z.string().min(1).max(200),

  objective: z.string().min(1).max(500),

  acceptanceCriterionIds: z.array(
    z.string().regex(/^AC-\d{2}$/)
  ).min(1).max(20),

  preconditions: z.array(
    z.string().min(1).max(300)
  ).max(20),

  steps: z.array(
    ExecutionStepSchema
  ).min(1).max(15),

  assertions: z.array(
    TestAssertionSchema
  ).min(1).max(30),

  expectedOutcome: z.string().min(1).max(500)
}).strict();

/**
 * Complete LLM-generated test plan.
 */
export const GeneratedTestPlanSchema = z.object({
  planTitle: z.string().min(1).max(200),

  summary: z.string().min(1).max(1000),

  scenarios: z.array(
    TestScenarioSchema
  ).min(1).max(50)
}).strict();

/**
 * Inferred TypeScript types.
 */
export type BrowserAction = z.infer<
  typeof BrowserActionSchema
>;

export type SemanticTarget = z.infer<
  typeof SemanticTargetSchema
>;

export type StepCapture = z.infer<
  typeof StepCaptureSchema
>;

export type ExecutionStep = z.infer<
  typeof ExecutionStepSchema
>;

export type TestAssertion = z.infer<
  typeof TestAssertionSchema
>;

export type TestScenario = z.infer<
  typeof TestScenarioSchema
>;

export type GeneratedTestPlan = z.infer<
  typeof GeneratedTestPlanSchema
>;

/**
 * Finds dynamic capture references such as:
 * {{capture.selectedProductName}}
 */
function findCaptureReferences(value: string): string[] {
  const references: string[] = [];

  const pattern = /\{\{capture\.([a-z][A-Za-z0-9_]*)\}\}/g;

  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match[1]) {
      references.push(match[1]);
    }
  }

  return references;
}

/**
 * Validates capture references and assertion checkpoints.
 */
function validateStepCaptureReferences(
  scenario: TestScenario
): void {
  const availableCaptures = new Set<string>();

  // Captures available immediately after each step.
  const capturesAfterStep = new Map<string, Set<string>>();

  const stepIds = new Set<string>();

  for (const step of scenario.steps) {

    if (stepIds.has(step.stepId)) {
      throw new Error(
        `Scenario ${scenario.scenarioId} contains duplicate step ID "${step.stepId}".`
      );
    }

    stepIds.add(step.stepId);

    const stepText = [
      step.instruction,
      step.target.description,
      step.target.role ?? '',
      step.target.accessibleName ?? '',
      step.target.visibleText ?? '',
      step.target.label ?? '',
      step.value ?? '',
      step.expectedObservation
    ];
    
    const selectedProductReference =
      '{{capture.selectedProductName}}';

    const stepContext = stepText.join(' ');

    // Product mutations must identify the selected product.
    const isProductMutation =
      step.action === 'click' &&
      /\b(add to cart|remove)\b/i.test(stepContext);

    if (
      isProductMutation &&
      !stepContext.includes(selectedProductReference)
    ) {
      throw new Error(
        `Scenario ${scenario.scenarioId}, step ${step.stepId}: ` +
        'product Add to Cart and Remove actions must reference ' +
        '{{capture.selectedProductName}}.'
      );
    }

    // Price capture must be scoped to the selected product.
    if (
      step.capture?.key === 'selectedProductPrice' &&
      !stepContext.includes(selectedProductReference)
    ) {
      throw new Error(
        `Scenario ${scenario.scenarioId}, step ${step.stepId}: ` +
        'product price capture must reference ' +
        '{{capture.selectedProductName}}.'
      );
    }

    // A step can only use values captured by earlier steps.
    for (const value of stepText) {
      for (const reference of findCaptureReferences(value)) {
        if (!availableCaptures.has(reference)) {
          throw new Error(
            `Scenario ${scenario.scenarioId} references capture "${reference}" before it is available.`
          );
        }
      }
    }

    if (step.capture) {
      if (availableCaptures.has(step.capture.key)) {
        throw new Error(
          `Scenario ${scenario.scenarioId} contains duplicate capture key "${step.capture.key}".`
        );
      }

      availableCaptures.add(step.capture.key);
    }

    capturesAfterStep.set(
      step.stepId,
      new Set(availableCaptures)
    );
  }

  // Preconditions represent initial state, before any capture.
  for (const value of scenario.preconditions) {
    for (const reference of findCaptureReferences(value)) {
      throw new Error(
        `Scenario ${scenario.scenarioId} precondition cannot reference runtime capture "${reference}".`
      );
    }
  }

  // The expected outcome is evaluated after the scenario steps.
  for (const reference of findCaptureReferences(
    scenario.expectedOutcome
  )) {
    if (!availableCaptures.has(reference)) {
      throw new Error(
        `Scenario ${scenario.scenarioId} references unknown capture "${reference}".`
      );
    }
  }

  // Every assertion must reference an existing execution step.
  for (const assertion of scenario.assertions) {
    const checkpointCaptures = capturesAfterStep.get(
      assertion.afterStepId
    );

    if (!checkpointCaptures) {
      throw new Error(
        `Assertion ${assertion.assertionId} references unknown execution checkpoint ${assertion.afterStepId}.`
      );
    }

    const assertionText = [
      assertion.expectedValue,
      assertion.explanation,
      assertion.target.description,
      assertion.target.accessibleName ?? '',
      assertion.target.visibleText ?? '',
      assertion.target.label ?? ''
    ];

    // An assertion can only use captures available
    // at its own execution checkpoint.
    for (const value of assertionText) {
      for (const reference of findCaptureReferences(value)) {
        if (!checkpointCaptures.has(reference)) {
          throw new Error(
            `Assertion ${assertion.assertionId} references capture "${reference}" before it is available.`
          );
        }
      }
    }
  }
}

/**
 * Validates the generated plan and verifies that every
 * source acceptance criterion is covered.
 *
 * This validation is independent of the LLM.
 */
export function validateTestPlan(
  input: unknown,
  sourceCriterionIds: string[]
): GeneratedTestPlan {
  const plan = GeneratedTestPlanSchema.parse(input);

  const sourceIds = new Set(sourceCriterionIds);

  if (sourceIds.size !== sourceCriterionIds.length) {
    throw new Error(
      'Source acceptance criteria contain duplicate IDs.'
    );
  }

  const scenarioIds = new Set<string>();

  const coveredCriteria = new Set<string>();

  for (const scenario of plan.scenarios) {

    if (scenarioIds.has(scenario.scenarioId)) {
      throw new Error(
        `Duplicate scenario ID: ${scenario.scenarioId}`
      );
    }

    scenarioIds.add(scenario.scenarioId);

    const scenarioCriteria = new Set(
      scenario.acceptanceCriterionIds
    );

    if (
      scenarioCriteria.size !==
      scenario.acceptanceCriterionIds.length
    ) {
      throw new Error(
        `Scenario ${scenario.scenarioId} contains duplicate acceptance criterion IDs.`
      );
    }

    for (const criterionId of scenario.acceptanceCriterionIds) {
      if (!sourceIds.has(criterionId)) {
        throw new Error(
          `Scenario ${scenario.scenarioId} references unknown acceptance criterion ${criterionId}.`
        );
      }

      coveredCriteria.add(criterionId);
    }

    // Validate step IDs, captures and assertion checkpoints.
    validateStepCaptureReferences(scenario);

    const assertionIds = new Set<string>();

    for (const assertion of scenario.assertions) {

      if (assertionIds.has(assertion.assertionId)) {
        throw new Error(
          `Duplicate assertion ID: ${assertion.assertionId}`
        );
      }

      assertionIds.add(assertion.assertionId);

      if (!sourceIds.has(assertion.acceptanceCriterionId)) {
        throw new Error(
          `Assertion ${assertion.assertionId} references an unknown acceptance criterion.`
        );
      }

      if (
        !scenarioCriteria.has(
          assertion.acceptanceCriterionId
        )
      ) {
        throw new Error(
          `Assertion ${assertion.assertionId} references an acceptance criterion not assigned to its scenario.`
        );
      }
    }

    // Every mapped criterion must have at least one assertion.
    for (const criterionId of scenarioCriteria) {
      const hasAssertion = scenario.assertions.some(
        assertion =>
          assertion.acceptanceCriterionId === criterionId
      );

      if (!hasAssertion) {
        throw new Error(
          `Scenario ${scenario.scenarioId} has no assertion for ${criterionId}. ` +
            'Setup actions alone do not satisfy acceptance criteria coverage.'
        );
      }
    }
  }

  const missingCriteria = sourceCriterionIds.filter(
    criterionId => !coveredCriteria.has(criterionId)
  );

  if (missingCriteria.length > 0) {
    throw new Error(
      `Test plan does not cover: ${missingCriteria.join(', ')}`
    );
  }

  return plan;
}