import { describe, expect, it } from 'vitest';

import {
  ExecutionStepSchema
} from '../../src/planner/test-plan-schema.js';

function step(action: string, value: string | null) {
  return {
    stepId: 'STEP-01',
    action,
    instruction: 'Do it',
    target: {
      description: 'Target',
      role: null,
      accessibleName: null,
      visibleText: null,
      label: null
    },
    value,
    expectedObservation: 'It happens',
    capture: null
  };
}

describe('a step that needs a value', () => {
  it.each(['navigate', 'fill', 'type', 'press_key', 'select_option', 'wait_for'])(
    'is rejected for %s without one',
    action => {
      for (const missing of [null, '', '   ']) {
        const result = ExecutionStepSchema.safeParse(step(action, missing));

        expect(result.success).toBe(false);

        expect(JSON.stringify(result.error?.issues)).toContain(
          `The ${action} action requires a value.`
        );
      }
    }
  );

  it.each(['navigate', 'fill', 'type', 'press_key', 'select_option', 'wait_for'])(
    'is accepted for %s with one',
    action => {
      expect(
        ExecutionStepSchema.safeParse(step(action, 'something')).success
      ).toBe(true);
    }
  );

  it.each(['click', 'observe'])(
    'is accepted for %s without a value',
    action => {
      expect(
        ExecutionStepSchema.safeParse(step(action, null)).success
      ).toBe(true);
    }
  );
});
