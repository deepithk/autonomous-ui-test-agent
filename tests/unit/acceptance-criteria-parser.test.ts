import { describe, expect, it } from 'vitest';

import {
  parseAcceptanceCriteria
} from '../../src/github/acceptance-criteria-parser.js';

const issueDescription = `
## Acceptance Criteria

### AC-01: Successful Login

Given the user is on the login page,
When valid credentials are entered,
Then the products inventory page should be displayed.

### AC-02: Add Product to Cart

Given the user is on the products inventory page,
When the user selects Add to cart,
Then the selected product should be added.

### AC-03: Update Cart Count

Given a product has been added,
Then the cart badge should display the correct count.

### AC-04: Verify Cart Contents

Given a product has been added,
When the user opens the cart,
Then the correct product details should be displayed.

### AC-05: Remove Product

Given the cart contains a product,
When the user selects Remove,
Then the product should be removed.

### AC-06: Verify Empty Cart

Given the product has been removed,
Then the cart should contain no products.

## Out of Scope

Payment processing.
`;

describe('Acceptance Criteria Parser', () => {

  it('extracts all six acceptance criteria', () => {
    const criteria = parseAcceptanceCriteria(issueDescription);

    expect(criteria).toHaveLength(6);

    expect(criteria.map(item => item.id)).toEqual([
      'AC-01',
      'AC-02',
      'AC-03',
      'AC-04',
      'AC-05',
      'AC-06'
    ]);
  });

  it('extracts the correct acceptance criterion titles', () => {
    const criteria = parseAcceptanceCriteria(issueDescription);

    expect(criteria[0]?.title).toBe('Successful Login');
    expect(criteria[1]?.title).toBe('Add Product to Cart');
    expect(criteria[2]?.title).toBe('Update Cart Count');
    expect(criteria[3]?.title).toBe('Verify Cart Contents');
    expect(criteria[4]?.title).toBe('Remove Product');
    expect(criteria[5]?.title).toBe('Verify Empty Cart');
  });

  it('preserves the acceptance criterion descriptions', () => {
    const criteria = parseAcceptanceCriteria(issueDescription);

    expect(criteria[0]?.description).toContain(
      'valid credentials are entered'
    );

    expect(criteria[1]?.description).toContain(
      'selected product should be added'
    );
  });

  it('supports Windows CRLF line endings', () => {
    const windowsMarkdown = issueDescription.replace(
      /\n/g,
      '\r\n'
    );

    const criteria = parseAcceptanceCriteria(windowsMarkdown);

    expect(criteria).toHaveLength(6);
    expect(criteria[0]?.id).toBe('AC-01');
  });

  it('rejects an empty issue description', () => {
    expect(() => parseAcceptanceCriteria('')).toThrow(
      'GitHub issue description is empty'
    );
  });

  it('rejects a null issue description', () => {
    expect(() => parseAcceptanceCriteria(null)).toThrow(
      'GitHub issue description is empty'
    );
  });

  it('rejects malformed acceptance criterion headings', () => {
    const malformedMarkdown = `
### AC-01 Successful Login

Expected result.
`;

    expect(() =>
      parseAcceptanceCriteria(malformedMarkdown)
    ).toThrow('Invalid acceptance criterion heading');
  });

  it('rejects acceptance criteria without descriptions', () => {
    const emptyCriterion = `
### AC-01: Successful Login

### AC-02: Add Product to Cart

Expected result.
`;

    expect(() =>
      parseAcceptanceCriteria(emptyCriterion)
    ).toThrow('has no description');
  });

  it('rejects duplicate acceptance criterion IDs', () => {
    const duplicateCriteria = `
### AC-01: Successful Login

Login works.

### AC-01: Another Login

Another description.
`;

    expect(() =>
      parseAcceptanceCriteria(duplicateCriteria)
    ).toThrow('Duplicate acceptance criterion ID');
  });

  it('rejects descriptions without acceptance criteria', () => {
    const invalidMarkdown = `
## User Story

As a user, I want to add products to my cart.
`;

    expect(() =>
      parseAcceptanceCriteria(invalidMarkdown)
    ).toThrow('No acceptance criteria found');
  });

});