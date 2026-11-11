import { describe, expect, it } from 'vitest';

import {
  CaptureStore,
  CaptureStoreError
} from '../../src/executor/capture-store.js';

describe('CaptureStore', () => {
  it('renders capture placeholders', () => {
    const store = new CaptureStore();

    store.set('selectedProductName', 'Sauce Labs Backpack');

    expect(
      store.render('Add {{capture.selectedProductName}} to cart')
    ).toBe('Add Sauce Labs Backpack to cart');
  });

  it('renders secrets from the configured values', () => {
    const store = new CaptureStore({
      SAUCEDEMO_USERNAME: 'standard_user'
    });

    expect(store.render('{{SAUCEDEMO_USERNAME}}')).toBe(
      'standard_user'
    );
  });

  it('throws for captures that were never set', () => {
    expect(() =>
      new CaptureStore().render('{{capture.missing}}')
    ).toThrow(CaptureStoreError);
  });

  it('throws for unconfigured secrets', () => {
    expect(() =>
      new CaptureStore().render('{{SAUCEDEMO_PASSWORD}}')
    ).toThrow(/not configured/);
  });

  it('refuses to overwrite a capture', () => {
    const store = new CaptureStore();

    store.set('price', '$9.99');

    expect(() => store.set('price', '$1.00')).toThrow(
      /already been set/
    );
  });

  it('keeps captures separate between stores', () => {
    const first = new CaptureStore();
    const second = new CaptureStore();

    first.set('price', '$9.99');

    expect(second.has('price')).toBe(false);
  });

  it('renders every field of a plan target and keeps empty ones empty', () => {
    const store = new CaptureStore({ SAUCEDEMO_USERNAME: 'standard_user' });

    store.set('selectedProductName', 'Sauce Labs Backpack');

    expect(
      store.renderTarget({
        description: 'Add to cart for {{capture.selectedProductName}}',
        role: null,
        accessibleName: 'Cart of {{SAUCEDEMO_USERNAME}}',
        visibleText: 'Add to cart',
        label: null
      })
    ).toEqual({
      description: 'Add to cart for Sauce Labs Backpack',
      role: null,
      accessibleName: 'Cart of standard_user',
      visibleText: 'Add to cart',
      label: null
    });
  });

  it('refuses to render a target that uses a missing capture', () => {
    expect(() =>
      new CaptureStore().renderTarget({
        description: '{{capture.unknown}}',
        role: null,
        accessibleName: null,
        visibleText: null,
        label: null
      })
    ).toThrow(CaptureStoreError);
  });

  it('shortens long text after redacting', () => {
    const store = new CaptureStore({ PASSWORD: 'secret_sauce' });

    const text = store.redactAndShorten(
      'secret_sauce ' + 'y'.repeat(1000),
      50
    );

    expect(text.startsWith('[REDACTED] yyy')).toBe(true);
    expect(text.endsWith('... [truncated]')).toBe(true);
    expect(text).not.toContain('secret_sauce');
  });

  it('redacts secret values', () => {
    const store = new CaptureStore({ PASSWORD: 'secret_sauce' });

    expect(store.redact('typed secret_sauce into field')).toBe(
      'typed [REDACTED] into field'
    );
  });
});
