import { describe, expect, it, vi } from 'vitest';

import {
  SemanticResolver,
  SemanticResolverError
} from '../../src/executor/semantic-resolver.js';

import { parseSnapshot } from '../../src/executor/snapshot.js';

import type {
  ILLMProvider
} from '../../src/planner/providers/llm-provider.js';

import type {
  SemanticTarget
} from '../../src/planner/test-plan-schema.js';

import { INVENTORY_YAML } from './fixtures/inventory-snapshot.js';

const elements = parseSnapshot(INVENTORY_YAML);

function target(
  overrides: Partial<SemanticTarget> = {}
): SemanticTarget {
  return {
    description: 'Some element',
    role: null,
    accessibleName: null,
    visibleText: null,
    label: null,
    ...overrides
  };
}

function createLlm(text: string) {
  const generateStructured = vi.fn().mockResolvedValue({
    text,
    model: 'test'
  });

  const llm: ILLMProvider = {
    providerName: 'gemini',
    generateStructured
  };

  return { llm, generateStructured };
}

describe('SemanticResolver', () => {
  it('resolves a unique match without calling the LLM', async () => {
    const { llm, generateStructured } = createLlm('{}');

    const resolved = await new SemanticResolver(llm).resolve(
      target({ role: 'combobox', accessibleName: 'Sort products' }),
      'select_option',
      elements,
      INVENTORY_YAML
    );

    expect(resolved).toMatchObject({
      ref: 'e38',
      method: 'deterministic',
      element: 'combobox "Sort products"'
    });

    expect(generateStructured).not.toHaveBeenCalled();
  });

  it('uses the action to pick between a form and a button with the same name', async () => {
    const yaml = [
      '- form "Login" [ref=e9]:',
      '  - textbox "Username" [ref=e11]',
      '  - button "Login" [ref=e15] [cursor=pointer]'
    ].join('\n');

    const { llm, generateStructured } = createLlm('{}');

    const resolved = await new SemanticResolver(llm).resolve(
      target({ visibleText: 'Login' }),
      'click',
      parseSnapshot(yaml),
      yaml
    );

    expect(resolved).toMatchObject({
      ref: 'e15',
      method: 'deterministic'
    });

    expect(generateStructured).not.toHaveBeenCalled();
  });

  it('asks the LLM when several elements match', async () => {
    const { llm, generateStructured } = createLlm(
      JSON.stringify({
        ref: 'e66',
        reason: 'Belongs to Sauce Labs Bike Light.'
      })
    );

    const resolved = await new SemanticResolver(llm).resolve(
      target({
        description: 'Add to cart button for Sauce Labs Bike Light',
        visibleText: 'Add to cart'
      }),
      'click',
      elements,
      INVENTORY_YAML
    );

    expect(resolved).toMatchObject({ ref: 'e66', method: 'llm' });

    expect(generateStructured).toHaveBeenCalledTimes(1);

    const request = generateStructured.mock.calls[0]?.[0];

    expect(request.prompt).toContain('Sauce Labs Bike Light');
    expect(request.prompt).toContain(INVENTORY_YAML);
  });

  it('asks the LLM when the plan gave no semantic fields', async () => {
    const { llm } = createLlm(
      JSON.stringify({ ref: 'e124', reason: 'Cart button.' })
    );

    const resolved = await new SemanticResolver(llm).resolve(
      target({ description: 'Shopping cart icon' }),
      'click',
      elements,
      INVENTORY_YAML
    );

    expect(resolved.ref).toBe('e124');
  });

  it('describes an unnamed element by the text it shows', async () => {
    const { llm } = createLlm(
      JSON.stringify({ ref: 'e53', reason: 'The price.' })
    );

    const resolved = await new SemanticResolver(llm).resolve(
      target({ description: 'Price tag' }),
      'observe',
      elements,
      INVENTORY_YAML
    );

    expect(resolved.element).toBe('generic "$29.99"');
  });

  it('rejects a ref that is not in the snapshot', async () => {
    const { llm } = createLlm(
      JSON.stringify({ ref: 'e999', reason: 'Guess.' })
    );

    await expect(
      new SemanticResolver(llm).resolve(
        target(),
        'click',
        elements,
        INVENTORY_YAML
      )
    ).rejects.toThrow(/not in the snapshot/);
  });

  it('fails when the LLM finds no match', async () => {
    const { llm } = createLlm(
      JSON.stringify({ ref: '', reason: 'Nothing like it.' })
    );

    await expect(
      new SemanticResolver(llm).resolve(
        target({ description: 'Checkout button' }),
        'click',
        elements,
        INVENTORY_YAML
      )
    ).rejects.toThrow(/Nothing like it/);
  });

  it('fails on invalid LLM JSON', async () => {
    const { llm } = createLlm('not json');

    await expect(
      new SemanticResolver(llm).resolve(
        target(),
        'click',
        elements,
        INVENTORY_YAML
      )
    ).rejects.toBeInstanceOf(SemanticResolverError);
  });

  describe('reusing answers', () => {
    it('reuses an answer for the same page and question', async () => {
      const { llm, generateStructured } = createLlm(
        JSON.stringify({ ref: 'e124', reason: 'Cart button.' })
      );

      const resolver = new SemanticResolver(llm);

      const first = await resolver.resolve(
        target({ description: 'Shopping cart icon' }),
        'click',
        elements,
        INVENTORY_YAML
      );

      const second = await resolver.resolve(
        target({ description: 'Shopping cart icon' }),
        'click',
        elements,
        INVENTORY_YAML
      );

      expect(first.cached).toBeUndefined();
      expect(second).toMatchObject({ ref: 'e124', cached: true });
      expect(generateStructured).toHaveBeenCalledTimes(1);
      expect(resolver.getUsage()).toEqual({ requests: 1, reused: 1 });
    });

    it('asks again for a single element when a fresh answer is requested', async () => {
      const { llm, generateStructured } = createLlm(
        JSON.stringify({ ref: 'e124', reason: 'Cart button.' })
      );

      const resolver = new SemanticResolver(llm);

      const cart = target({ description: 'Shopping cart icon' });

      await resolver.resolve(cart, 'click', elements, INVENTORY_YAML);

      await resolver.resolve(cart, 'click', elements, INVENTORY_YAML, {
        fresh: true
      });

      expect(generateStructured).toHaveBeenCalledTimes(2);
    });

    it('asks again when the page is different', async () => {
      const { llm, generateStructured } = createLlm(
        JSON.stringify({ ref: 'e124', reason: 'Cart button.' })
      );

      const resolver = new SemanticResolver(llm);

      const changed = `${INVENTORY_YAML}\n  - text: another line`;

      await resolver.resolve(
        target({ description: 'Shopping cart icon' }),
        'click',
        elements,
        INVENTORY_YAML
      );

      await resolver.resolve(
        target({ description: 'Shopping cart icon' }),
        'click',
        parseSnapshot(changed),
        changed
      );

      expect(generateStructured).toHaveBeenCalledTimes(2);
    });

    it('asks again when the question is different', async () => {
      const { llm, generateStructured } = createLlm(
        JSON.stringify({ ref: 'e124', reason: 'Cart button.' })
      );

      const resolver = new SemanticResolver(llm);

      await resolver.resolve(
        target({ description: 'Shopping cart icon' }),
        'click',
        elements,
        INVENTORY_YAML
      );

      await resolver.resolve(
        target({ description: 'Cart badge' }),
        'click',
        elements,
        INVENTORY_YAML
      );

      expect(generateStructured).toHaveBeenCalledTimes(2);
    });

    it('asks again when a fresh answer is requested, and remembers the newest', async () => {
      const generateStructured = vi
        .fn()
        .mockResolvedValueOnce({
          text: JSON.stringify({ refs: ['e124'], reason: 'Cart.' }),
          model: 'test'
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({ refs: [], reason: 'No badge.' }),
          model: 'test'
        });

      const resolver = new SemanticResolver({
        providerName: 'gemini',
        generateStructured
      });

      const badge = target({ description: 'Cart badge' });

      const first = await resolver.resolveAll(
        badge,
        elements,
        INVENTORY_YAML
      );

      const second = await resolver.resolveAll(
        badge,
        elements,
        INVENTORY_YAML,
        { fresh: true }
      );

      const third = await resolver.resolveAll(
        badge,
        elements,
        INVENTORY_YAML
      );

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);

      // A normal lookup now reuses the corrected answer.
      expect(third).toHaveLength(0);
      expect(generateStructured).toHaveBeenCalledTimes(2);
    });

    it('does not remember failures', async () => {
      const { llm, generateStructured } = createLlm(
        JSON.stringify({ ref: '', reason: 'Nothing.' })
      );

      const resolver = new SemanticResolver(llm);

      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(
          resolver.resolve(target(), 'click', elements, INVENTORY_YAML)
        ).rejects.toThrow(/Nothing/);
      }

      expect(generateStructured).toHaveBeenCalledTimes(2);
    });
  });

  describe('heal', () => {
    const planned = target({ description: 'Checkout button' });

    const request = {
      target: planned,
      action: 'click' as const,
      instruction: 'Click checkout',
      expectedObservation: 'Checkout opens',
      problem: 'No element matched "Checkout button"'
    };

    it('returns the replacement the LLM names', async () => {
      const { llm, generateStructured } = createLlm(
        JSON.stringify({ ref: 'e54', reason: 'Renamed button.' })
      );

      const resolver = new SemanticResolver(llm);

      const healed = await resolver.heal(request, elements, INVENTORY_YAML);

      expect(healed).toMatchObject({
        ref: 'e54',
        method: 'llm',
        reason: 'Renamed button.'
      });

      expect(generateStructured.mock.calls[0]?.[0].prompt).toContain(
        'Problem: No element matched "Checkout button"'
      );

      expect(resolver.getUsage().requests).toBe(1);
    });

    it('fails when the LLM names no replacement', async () => {
      const { llm } = createLlm(
        JSON.stringify({ ref: '', reason: 'The page shows a login error.' })
      );

      await expect(
        new SemanticResolver(llm).heal(request, elements, INVENTORY_YAML)
      ).rejects.toThrow(
        'No alternative element found for "Checkout button": ' +
          'The page shows a login error.'
      );
    });

    it('rejects a replacement that is not in the snapshot', async () => {
      const { llm } = createLlm(
        JSON.stringify({ ref: 'e999', reason: 'Guess.' })
      );

      await expect(
        new SemanticResolver(llm).heal(request, elements, INVENTORY_YAML)
      ).rejects.toThrow(/not in the snapshot/);
    });

    it('needs an LLM', async () => {
      await expect(
        new SemanticResolver(null).heal(request, elements, INVENTORY_YAML)
      ).rejects.toThrow(/needs an LLM/);
    });

    it('never remembers a healing answer', async () => {
      const { llm, generateStructured } = createLlm(
        JSON.stringify({ ref: 'e54', reason: 'Renamed.' })
      );

      const resolver = new SemanticResolver(llm);

      await resolver.heal(request, elements, INVENTORY_YAML);
      await resolver.heal(request, elements, INVENTORY_YAML);

      expect(generateStructured).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolveMany', () => {
    const first = target({ description: 'Add to cart for Backpack' });
    const second = target({ description: 'Cart badge' });

    it('answers several targets in one request', async () => {
      const { llm, generateStructured } = createLlm(
        JSON.stringify({
          results: [
            { id: 'T1', refs: ['e54'], reason: 'Backpack button.' },
            { id: 'T2', refs: [], reason: 'No badge.' }
          ]
        })
      );

      const resolver = new SemanticResolver(llm);

      const found = await resolver.resolveMany(
        [first, second],
        elements,
        INVENTORY_YAML
      );

      expect(found.map(list => list.map(entry => entry.ref))).toEqual([
        ['e54'],
        []
      ]);

      expect(generateStructured).toHaveBeenCalledTimes(1);

      const request = generateStructured.mock.calls[0]?.[0];

      expect(request.prompt).toContain('T1:');
      expect(request.prompt).toContain('T2:');
      expect(resolver.getUsage().requests).toBe(1);
    });

    it('only asks about targets it does not already know', async () => {
      const { llm, generateStructured } = createLlm(
        JSON.stringify({
          results: [
            { id: 'T1', refs: ['e54'], reason: 'Backpack button.' },
            { id: 'T2', refs: [], reason: 'No badge.' }
          ]
        })
      );

      const resolver = new SemanticResolver(llm);

      await resolver.resolveMany([first, second], elements, INVENTORY_YAML);

      const again = await resolver.resolveMany(
        [first, second],
        elements,
        INVENTORY_YAML
      );

      expect(again[0]?.[0]).toMatchObject({ ref: 'e54', cached: true });
      expect(generateStructured).toHaveBeenCalledTimes(1);
      expect(resolver.getUsage()).toEqual({ requests: 1, reused: 2 });
    });

    it('treats a missing answer as an error, not as "nothing found"', async () => {
      const { llm } = createLlm(
        JSON.stringify({
          results: [{ id: 'T1', refs: ['e54'], reason: 'Backpack.' }]
        })
      );

      await expect(
        new SemanticResolver(llm).resolveMany(
          [first, second],
          elements,
          INVENTORY_YAML
        )
      ).rejects.toThrow(/did not answer for "Cart badge"/);
    });

    it('rejects refs that are not in the snapshot', async () => {
      const { llm } = createLlm(
        JSON.stringify({
          results: [
            { id: 'T1', refs: ['e999'], reason: 'Guess.' },
            { id: 'T2', refs: [], reason: 'None.' }
          ]
        })
      );

      await expect(
        new SemanticResolver(llm).resolveMany(
          [first, second],
          elements,
          INVENTORY_YAML
        )
      ).rejects.toThrow(/not in the snapshot/);
    });

    it('does not cache anything when the batch is rejected', async () => {
      const { llm, generateStructured } = createLlm(
        JSON.stringify({
          results: [{ id: 'T1', refs: [], reason: 'None.' }]
        })
      );

      const resolver = new SemanticResolver(llm);

      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(
          resolver.resolveMany([first, second], elements, INVENTORY_YAML)
        ).rejects.toThrow();
      }

      expect(generateStructured).toHaveBeenCalledTimes(2);
    });

    it('uses the single-target request when only one is unknown', async () => {
      const { llm, generateStructured } = createLlm(
        JSON.stringify({ refs: ['e54'], reason: 'Backpack button.' })
      );

      const found = await new SemanticResolver(llm).resolveMany(
        [first],
        elements,
        INVENTORY_YAML
      );

      expect(found[0]?.[0]?.ref).toBe('e54');
      expect(generateStructured).toHaveBeenCalledTimes(1);
    });

    it('uses the plan fields when there is no LLM', async () => {
      const found = await new SemanticResolver(null).resolveMany(
        [target({ visibleText: 'Add to cart' }), target()],
        elements,
        INVENTORY_YAML
      );

      expect(found.map(list => list.length)).toEqual([2, 0]);
    });
  });

  describe('resolveAll', () => {
    it('returns every ref the LLM lists', async () => {
      const { llm } = createLlm(
        JSON.stringify({ refs: ['e54', 'e66'], reason: 'Both buttons.' })
      );

      const found = await new SemanticResolver(llm).resolveAll(
        target({ description: 'Add to cart buttons' }),
        elements,
        INVENTORY_YAML
      );

      expect(found.map(entry => entry.ref)).toEqual(['e54', 'e66']);
    });

    it('returns an empty list when nothing matches', async () => {
      const { llm } = createLlm(
        JSON.stringify({ refs: [], reason: 'No badge.' })
      );

      await expect(
        new SemanticResolver(llm).resolveAll(
          target(),
          elements,
          INVENTORY_YAML
        )
      ).resolves.toEqual([]);
    });

    it('rejects refs that are not in the snapshot', async () => {
      const { llm } = createLlm(
        JSON.stringify({ refs: ['e999'], reason: 'Guess.' })
      );

      await expect(
        new SemanticResolver(llm).resolveAll(
          target(),
          elements,
          INVENTORY_YAML
        )
      ).rejects.toThrow(/not in the snapshot/);
    });

    it('rejects a response without a refs list', async () => {
      const { llm } = createLlm(JSON.stringify({ ref: 'e54' }));

      await expect(
        new SemanticResolver(llm).resolveAll(
          target(),
          elements,
          INVENTORY_YAML
        )
      ).rejects.toThrow(/no refs list/);
    });

    it('uses the plan fields when there is no LLM', async () => {
      const found = await new SemanticResolver(null).resolveAll(
        target({ visibleText: 'Add to cart' }),
        elements,
        INVENTORY_YAML
      );

      expect(found).toHaveLength(2);
    });
  });

  it('fails without an LLM when a match is not unique', async () => {
    await expect(
      new SemanticResolver(null).resolve(
        target({ visibleText: 'Add to cart' }),
        'click',
        elements,
        INVENTORY_YAML
      )
    ).rejects.toThrow(/2 elements matched/);
  });
});
