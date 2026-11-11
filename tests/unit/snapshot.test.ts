import { describe, expect, it } from 'vitest';

import {
  extractSnapshotYaml,
  getElementText,
  parseSnapshot
} from '../../src/executor/snapshot.js';

import { INVENTORY_YAML } from './fixtures/inventory-snapshot.js';


describe('extractSnapshotYaml', () => {
  it('returns the fenced yaml block', () => {
    const yaml = extractSnapshotYaml([
      {
        type: 'text',
        text: '### Page\n- Page URL: x\n### Snapshot\n```yaml\n- main [ref=e1]\n```\n### Events'
      }
    ]);

    expect(yaml).toBe('- main [ref=e1]');
  });

  it('returns an empty string when there is no snapshot', () => {
    expect(
      extractSnapshotYaml([{ type: 'text', text: 'nothing' }])
    ).toBe('');
  });
});

describe('parseSnapshot', () => {
  const elements = parseSnapshot(INVENTORY_YAML);

  it('parses role, name, ref and attributes', () => {
    const button = elements.find(element => element.ref === 'e54');

    expect(button).toMatchObject({
      role: 'button',
      name: 'Add to cart',
      attributes: ['cursor=pointer']
    });
  });

  it('parses inline text and removes quotes', () => {
    expect(
      elements.find(element => element.ref === 'e53')?.text
    ).toBe('$29.99');

    expect(
      elements.find(element => element.ref === 'e125')?.text
    ).toBe('1');
  });

  it('keeps elements without a ref', () => {
    expect(
      elements.find(element => element.name === 'Name (A to Z)')
    ).toMatchObject({ ref: null, attributes: ['selected'] });

    expect(
      elements.find(element => element.text === 'plain text node')
        ?.role
    ).toBe('text');
  });

  it('records nesting depth', () => {
    expect(elements[0]?.depth).toBe(0);

    expect(
      elements.find(element => element.ref === 'e125')?.depth
    ).toBe(3);
  });
});

describe('getElementText', () => {
  const elements = parseSnapshot(INVENTORY_YAML);

  const indexOfRef = (ref: string) =>
    elements.findIndex(element => element.ref === ref);

  it('uses the element text when present', () => {
    expect(getElementText(elements, indexOfRef('e53'))).toBe(
      '$29.99'
    );
  });

  it('falls back to descendant text before the name', () => {
    expect(getElementText(elements, indexOfRef('e49'))).toBe(
      'Sauce Labs Backpack'
    );

    expect(getElementText(elements, indexOfRef('e124'))).toBe('1');
  });

  it('falls back to the name for leaf elements', () => {
    expect(getElementText(elements, indexOfRef('e54'))).toBe(
      'Add to cart'
    );
  });
});
