/**
 * The message of a caught error. Anything that is not an Error is
 * shown as text, or replaced by the fallback when one is given.
 */
export function errorMessage(
  error: unknown,
  fallback?: string
): string {
  if (error instanceof Error) {
    return error.message;
  }

  return fallback ?? String(error);
}

/**
 * Replaces every run of whitespace, including line breaks, with one
 * space and trims the ends. Keeps a value on a single line.
 */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * One-line text no longer than length, ending in "..." when it was cut.
 */
export function shorten(value: string, length: number): string {
  const text = collapseWhitespace(value);

  return text.length > length ? `${text.slice(0, length)}...` : text;
}
