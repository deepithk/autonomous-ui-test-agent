import { describe, expect, it } from 'vitest';

import {
  describeElement,
  findByFields,
  narrowByAction
} from '../../src/executor/element-matching.js';

import { parseSnapshot } from '../../src/executor/snapshot.js';

import type {
  SemanticTarget
} from '../../src/planner/test-plan-schema.js';

const YAML = [
  '- form "Login" [ref=e9]:',
  '  - textbox "Username" [ref=e11]',
  '  - button "Login" [ref=e15]',
  '- generic [ref=e20]: $29.99',
  '- generic: no ref here',
  '- img'
].join('\n');

const elements = parseSnapshot(YAML);

function target(fields: Partial<SemanticTarget> = {}): SemanticTarget {
  return {
    description: 'Target',
    role: null,
    accessibleName: null,
    visibleText: null,
    label: null,
    ...fields
  };
}

describe('findByFields', () => {
  it('finds nothing when the plan gives no fields', () => {
    expect(findByFields(target(), elements)).toEqual([]);
  });

  it('matches role, name and text without caring about case', () => {
    expect(
      findByFields(target({ role: 'BUTTON', accessibleName: 'login' }), elements)
    ).toEqual([2]);
  });

  it('matches a label against the element name', () => {
    expect(findByFields(target({ label: 'Username' }), elements)).toEqual([1]);
  });

  it('matches visible text against either name or text', () => {
    expect(findByFields(target({ visibleText: '$29.99' }), elements)).toEqual([
      3
    ]);

    expect(findByFields(target({ visibleText: 'Login' }), elements)).toEqual([
      0, 2
    ]);
  });

  it('never matches an element without a ref', () => {
    expect(
      findByFields(target({ visibleText: 'no ref here' }), elements)
    ).toEqual([]);
  });

  it('requires every given field to match', () => {
    expect(
      findByFields(
        target({ role: 'button', accessibleName: 'Username' }),
        elements
      )
    ).toEqual([]);
  });
});

describe('narrowByAction', () => {
  it('keeps a single match as it is', () => {
    expect(narrowByAction('click', elements, [0])).toEqual([0]);
  });

  it('keeps only elements that can perform the action', () => {
    expect(narrowByAction('click', elements, [0, 2])).toEqual([2]);
  });

  it('keeps all matches when none can perform the action', () => {
    expect(narrowByAction('click', elements, [0, 3])).toEqual([0, 3]);
  });

  it('does not narrow actions that have no role rule', () => {
    expect(narrowByAction('observe', elements, [0, 2])).toEqual([0, 2]);
  });
});

describe('describeElement', () => {
  it('uses the role and name', () => {
    expect(describeElement(elements[2] as never)).toBe('button "Login"');
  });

  it('describes an unnamed element by its text', () => {
    expect(describeElement(elements[3] as never)).toBe('generic "$29.99"');
  });

  it('shortens long text', () => {
    const [long] = parseSnapshot(`- generic [ref=e1]: ${'x'.repeat(100)}`);

    const description = describeElement(long as never);

    expect(description).toBe(`generic "${'x'.repeat(60)}..."`);
  });

  it('uses only the role when there is nothing else to show', () => {
    expect(describeElement(elements[5] as never)).toBe('img');
  });
});
