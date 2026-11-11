import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../../src/util/cli.js';

import {
  collapseWhitespace,
  errorMessage,
  shorten
} from '../../src/util/text.js';

describe('errorMessage', () => {
  it('uses the message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('shows anything else as text', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
  });

  it('uses the fallback for anything that is not an Error', () => {
    expect(errorMessage({ code: 1 }, 'Unknown problem')).toBe(
      'Unknown problem'
    );

    expect(errorMessage(new Error('real'), 'Unknown problem')).toBe(
      'real'
    );
  });
});

describe('collapseWhitespace', () => {
  it('joins lines and trims', () => {
    expect(collapseWhitespace('  a \n  b\t\tc  ')).toBe('a b c');
  });
});

describe('shorten', () => {
  it('keeps short text and collapses its whitespace', () => {
    expect(shorten('a   b', 10)).toBe('a b');
  });

  it('cuts long text and marks the cut', () => {
    expect(shorten('abcdefghij', 4)).toBe('abcd...');
  });

  it('keeps text of exactly the allowed length', () => {
    expect(shorten('abcd', 4)).toBe('abcd');
  });
});

describe('runCli', () => {
  afterEach(() => {
    process.exitCode = undefined;

    vi.restoreAllMocks();
  });

  it('does nothing visible when the command succeeds', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    runCli('It failed.', async () => undefined);

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('prints the problem and sets the exit code when it fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    runCli('It failed.', async () => {
      throw new Error('the reason');
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(error).toHaveBeenCalledWith('\n[ERROR] It failed.');
    expect(error).toHaveBeenCalledWith('the reason');
    expect(process.exitCode).toBe(1);
  });
});
