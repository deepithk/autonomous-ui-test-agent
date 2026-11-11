import { describe, expect, it, vi } from 'vitest';

import {
  runPlanningWorkflow
} from '../../src/planner/planning-workflow.js';

import type {
  PlanningWorkflowDependencies,
  PlanningWorkflowOptions
} from '../../src/planner/planning-workflow.js';

import type {
  IssueReadResult
} from '../../src/github/issue-reader.js';

import type {
  AcceptanceCriterion
} from '../../src/github/acceptance-criteria-parser.js';

import type {
  GeneratedTestPlan
} from '../../src/planner/test-plan-schema.js';

const criteria: AcceptanceCriterion[] = [
  {
    id: 'AC-01',
    title: 'Successful Login',
    description: 'Valid credentials display the inventory page.'
  },
  {
    id: 'AC-02',
    title: 'Add Product to Cart',
    description: 'The selected product is added to the cart.'
  }
];

const validPlan = {
  planTitle: 'Shopping Cart Test Plan',
  summary: 'Validate shopping cart functionality.',
  scenarios: [
    {
      scenarioId: 'SC-001',
      title: 'Login and add a product',
      objective: 'Verify login and product addition.',
      acceptanceCriterionIds: ['AC-01', 'AC-02'],
      preconditions: ['Application is available.'],
      
        steps: [
        {
            stepId: 'STEP-01',
            action: 'observe',
            instruction: 'Observe the login page.',
            target: {
            description: 'Login page',
            role: null,
            accessibleName: null,
            visibleText: null,
            label: null
            },
            value: null,
            expectedObservation: 'Login page is displayed.',
            capture: null
        }
        ],
      assertions: [
        {
          assertionId: 'ASSERT-01',
          acceptanceCriterionId: 'AC-01',
          type: 'url',
          afterStepId: 'STEP-01',
          target: {
            description: 'Browser URL',
            role: null,
            accessibleName: null,
            visibleText: null,
            label: null
          },
          expectedValue: 'inventory',
          explanation: 'Verify successful login.'
        },
        {
          assertionId: 'ASSERT-02',
          acceptanceCriterionId: 'AC-02',
          type: 'visibility',
          afterStepId: 'STEP-01',
          target: {
            description: 'Shopping cart',
            role: null,
            accessibleName: null,
            visibleText: 'Sauce Labs Backpack',
            label: null
          },
          expectedValue: 'visible',
          explanation: 'Verify product addition.'
        }
      ],
      expectedOutcome: 'Product is added successfully.'
    }
  ]
} satisfies GeneratedTestPlan;

const issueResult: IssueReadResult = {
  issue: {
    id: 12345,
    number: 1,
    title: 'Feature: Add and Remove Products',
    body: 'Acceptance criteria...',
    state: 'open',
    html_url:
      'https://github.com/deepithk/autonomous-ui-test-agent/issues/1',
    labels: []
  },
  acceptanceCriteria: criteria,
  project: {
    projectTitle: 'Autonomous UI QA Board',
    status: 'RFQA',
    source: 'project-v2'
  }
};

const options: PlanningWorkflowOptions = {
  repository: 'deepithk/autonomous-ui-test-agent',
  provider: 'gemini',
  model: 'gemini-test-model',
  expectedStatus: 'RFQA'
};

function createDependencies(
  overrides: Partial<PlanningWorkflowDependencies> = {}
): PlanningWorkflowDependencies {
  return {
    readIssue: vi.fn().mockResolvedValue(issueResult),

    generatePlan: vi.fn().mockResolvedValue(validPlan),

    saveReport: vi.fn().mockResolvedValue(
      'evidence/reports/test-plan.json'
    ),

    ...overrides
  };
}

/**
 * AC-02 names a value in quotation marks. validPlan never checks it,
 * so it has a coverage gap; fixedPlan checks it.
 */
const gapCriteria: AcceptanceCriterion[] = [
  criteria[0] as AcceptanceCriterion,
  {
    id: 'AC-02',
    title: 'Default Sort Order',
    description:
      'Given the inventory page,\n\nThen the selector should show "Name (A to Z)".'
  }
];

const fixedPlan: GeneratedTestPlan = {
  ...validPlan,
  scenarios: [
    {
      ...validPlan.scenarios[0],
      assertions: [
        validPlan.scenarios[0].assertions[0],
        {
          ...validPlan.scenarios[0].assertions[1],
          expectedValue: 'Name (A to Z)'
        }
      ]
    }
  ]
} as GeneratedTestPlan;

function withGapCriteria(
  generatePlan: PlanningWorkflowDependencies['generatePlan']
): PlanningWorkflowDependencies {
  return createDependencies({
    readIssue: vi.fn().mockResolvedValue({
      ...issueResult,
      acceptanceCriteria: gapCriteria
    }),
    generatePlan
  });
}

describe('Planning Workflow coverage check', () => {
  it('plans once when every condition is checked', async () => {
    const dependencies = createDependencies();

    const { report } = await runPlanningWorkflow(options, dependencies);

    expect(dependencies.generatePlan).toHaveBeenCalledTimes(1);

    expect(report.coverage).toEqual({ gaps: [], replan: 'not-needed' });
  });

  it('asks again with the gaps and keeps the better plan', async () => {
    const generatePlan = vi
      .fn()
      .mockResolvedValueOnce(validPlan)
      .mockResolvedValueOnce(fixedPlan);

    const { report } = await runPlanningWorkflow(
      options,
      withGapCriteria(generatePlan)
    );

    expect(generatePlan).toHaveBeenCalledTimes(2);

    const retryRequest = generatePlan.mock.calls[1]?.[1];

    expect(retryRequest.issueTitle).toBe('Feature: Add and Remove Products');
    expect(retryRequest.feedback).toContain('AC-02');
    expect(retryRequest.feedback).toContain('Name (A to Z)');

    expect(report.generatedPlan).toEqual(fixedPlan);
    expect(report.coverage).toEqual({ gaps: [], replan: 'improved' });
  });

  it('keeps the first plan and records the gap when asking again does not help', async () => {
    const generatePlan = vi.fn().mockResolvedValue(validPlan);

    const { report } = await runPlanningWorkflow(
      options,
      withGapCriteria(generatePlan)
    );

    expect(generatePlan).toHaveBeenCalledTimes(2);
    expect(report.generatedPlan).toEqual(validPlan);
    expect(report.coverage.replan).toBe('no-improvement');

    expect(report.coverage.gaps).toEqual([
      {
        criterionId: 'AC-02',
        kind: 'value-not-checked',
        problem:
          'The value "Name (A to Z)" named in the criterion is not ' +
          'checked by any of its assertions.'
      }
    ]);
  });

  it('keeps the first plan when the second attempt fails', async () => {
    const generatePlan = vi
      .fn()
      .mockResolvedValueOnce(validPlan)
      .mockRejectedValueOnce(new Error('503 UNAVAILABLE'));

    const { report } = await runPlanningWorkflow(
      options,
      withGapCriteria(generatePlan)
    );

    expect(report.generatedPlan).toEqual(validPlan);
    expect(report.coverage.replan).toBe('failed');
    expect(report.coverage.gaps).toHaveLength(1);
  });

  it('never asks a third time', async () => {
    const generatePlan = vi.fn().mockResolvedValue(validPlan);

    await runPlanningWorkflow(options, withGapCriteria(generatePlan));

    expect(generatePlan).toHaveBeenCalledTimes(2);
  });
});

describe('Planning Workflow', () => {

  it('executes the complete planning workflow successfully', async () => {
    const dependencies = createDependencies();

    const result = await runPlanningWorkflow(
      options,
      dependencies
    );

    expect(dependencies.readIssue).toHaveBeenCalledTimes(1);

    // The planner is told which feature the issue is about.
    expect(dependencies.generatePlan).toHaveBeenCalledWith(criteria, {
      issueTitle: 'Feature: Add and Remove Products'
    });

    expect(dependencies.saveReport).toHaveBeenCalledTimes(1);

    expect(result.reportPath).toBe(
      'evidence/reports/test-plan.json'
    );

    expect(result.report.executionStatus).toBe(
      'NOT_EXECUTED'
    );
  });

  it('records correct GitHub and LLM metadata', async () => {
    const dependencies = createDependencies();

    const result = await runPlanningWorkflow(
      options,
      dependencies
    );

    expect(result.report.source.issueNumber).toBe(1);

    expect(result.report.source.projectStatus).toBe('RFQA');

    expect(result.report.source.projectStatusSource).toBe(
      'project-v2'
    );

    expect(result.report.llm.provider).toBe('gemini');

    expect(result.report.generatedPlan).toEqual(validPlan);
  });

  it('preserves project status fallback warnings', async () => {
    const fallbackIssue: IssueReadResult = {
      ...issueResult,
      project: {
        projectTitle: null,
        status: 'RFQA',
        source: 'issue-label-fallback',
        warning: 'Projects V2 unavailable.'
      }
    };

    const dependencies = createDependencies({
      readIssue: vi.fn().mockResolvedValue(fallbackIssue)
    });

    const result = await runPlanningWorkflow(
      options,
      dependencies
    );

    expect(
      result.report.source.projectStatusWarning
    ).toBe('Projects V2 unavailable.');

    expect(result.report.source.projectStatusSource).toBe(
      'issue-label-fallback'
    );
  });

  it('rejects an issue with an incorrect project status', async () => {
    const todoIssue: IssueReadResult = {
      ...issueResult,
      project: {
        ...issueResult.project,
        status: 'Todo'
      }
    };

    const dependencies = createDependencies({
      readIssue: vi.fn().mockResolvedValue(todoIssue)
    });

    await expect(
      runPlanningWorkflow(options, dependencies)
    ).rejects.toThrow('Issue is not eligible for planning');

    expect(dependencies.generatePlan).not.toHaveBeenCalled();

    expect(dependencies.saveReport).not.toHaveBeenCalled();
  });

  it('stops when GitHub issue retrieval fails', async () => {
    const dependencies = createDependencies({
      readIssue: vi.fn().mockRejectedValue(
        new Error('GitHub unavailable')
      )
    });

    await expect(
      runPlanningWorkflow(options, dependencies)
    ).rejects.toThrow('GitHub unavailable');

    expect(dependencies.generatePlan).not.toHaveBeenCalled();

    expect(dependencies.saveReport).not.toHaveBeenCalled();
  });

  it('does not save a report when planning fails', async () => {
    const dependencies = createDependencies({
      generatePlan: vi.fn().mockRejectedValue(
        new Error('LLM unavailable')
      )
    });

    await expect(
      runPlanningWorkflow(options, dependencies)
    ).rejects.toThrow('LLM unavailable');

    expect(dependencies.saveReport).not.toHaveBeenCalled();
  });

  it('propagates report storage failures', async () => {
    const dependencies = createDependencies({
      saveReport: vi.fn().mockRejectedValue(
        new Error('Report storage failed')
      )
    });

    await expect(
      runPlanningWorkflow(options, dependencies)
    ).rejects.toThrow('Report storage failed');
  });

  it('rejects incomplete workflow configuration', async () => {
    const dependencies = createDependencies();

    await expect(
      runPlanningWorkflow(
        {
          ...options,
          model: ''
        },
        dependencies
      )
    ).rejects.toThrow(
      'Planning workflow configuration is incomplete.'
    );

    expect(dependencies.readIssue).not.toHaveBeenCalled();
  });

});