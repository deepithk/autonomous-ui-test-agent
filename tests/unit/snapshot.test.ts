import { describe, expect, it } from 'vitest';

import {
  extractPageUrl,
  extractSnapshotYaml,
  findPageNotes,
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

describe('extractPageUrl', () => {
  it('reads the page url line', () => {
    expect(
      extractPageUrl([
        {
          type: 'text',
          text: '### Page\n- Page URL: https://www.saucedemo.com/cart.html\n- Page Title: Swag Labs'
        }
      ])
    ).toBe('https://www.saucedemo.com/cart.html');
  });

  it('returns an empty string when absent', () => {
    expect(extractPageUrl([{ type: 'text', text: 'none' }])).toBe('');
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

describe('findPageNotes', () => {
  it('finds a failed-login message and alerts', () => {
    const notes = findPageNotes(
      parseSnapshot(
        [
          '- textbox "Username" [ref=e11]',
          '- heading "Epic sadface: Sorry, this user has been locked out." [level=3] [ref=e20]',
          '- alert [ref=e30]: Something went wrong'
        ].join('\n')
      )
    );

    expect(notes).toEqual([
      'Epic sadface: Sorry, this user has been locked out.',
      'Something went wrong'
    ]);
  });

  it('ignores run-together text that only happens to contain a problem word', () => {
    const notes = findPageNotes(
      parseSnapshot(
        [
          '- generic [ref=e1]: standard_userlocked_out_userproblem_user',
          '- generic [ref=e2]: Epic sadface: this user has been locked out.'
        ].join('\n')
      )
    );

    expect(notes).toEqual(['Epic sadface: this user has been locked out.']);
  });

  it('ignores ordinary page content', () => {
    expect(findPageNotes(parseSnapshot(INVENTORY_YAML))).toEqual([]);
  });

  it('limits and shortens notes and removes duplicates', () => {
    const long = `Error: ${'x'.repeat(300)}`;

    const yaml = [
      `- generic [ref=e1]: ${long}`,
      '- generic [ref=e2]: Error one',
      '- generic [ref=e3]: Error one',
      '- generic [ref=e4]: Error two',
      '- generic [ref=e5]: Error three'
    ].join('\n');

    const notes = findPageNotes(parseSnapshot(yaml), 3);

    expect(notes).toHaveLength(3);
    expect(notes[0]?.endsWith('...')).toBe(true);
    expect(notes[0]?.length).toBeLessThanOrEqual(163);
    expect(notes.filter(note => note === 'Error one')).toHaveLength(1);
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
