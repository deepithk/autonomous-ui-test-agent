export class CaptureStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureStoreError';
  }
}

const CAPTURE_PATTERN = /\{\{capture\.([a-z][A-Za-z0-9_]*)\}\}/g;

const SECRET_PATTERN = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/**
 * Holds values captured during one scenario and renders
 * {{capture.key}} and {{SECRET_NAME}} placeholders.
 *
 * Create one store per scenario so values never leak
 * between scenarios.
 */
export class CaptureStore {
  private readonly values = new Map<string, string>();

  constructor(
    private readonly secrets: Readonly<Record<string, string>> = {}
  ) {}

  has(key: string): boolean {
    return this.values.has(key);
  }

  get(key: string): string | undefined {
    return this.values.get(key);
  }

  set(key: string, value: string): void {
    if (this.values.has(key)) {
      throw new CaptureStoreError(
        `Capture "${key}" has already been set in this scenario.`
      );
    }

    this.values.set(key, value);
  }

  /**
   * Replaces placeholders in a template.
   * Unknown captures or secrets throw instead of being left in place.
   */
  render(template: string): string {
    const withCaptures = template.replace(
      CAPTURE_PATTERN,
      (_match, key: string) => {
        const value = this.values.get(key);

        if (value === undefined) {
          throw new CaptureStoreError(
            `Capture "${key}" has not been captured yet.`
          );
        }

        return value;
      }
    );

    return withCaptures.replace(
      SECRET_PATTERN,
      (_match, name: string) => {
        const value = this.secrets[name];

        if (value === undefined) {
          throw new CaptureStoreError(
            `Runtime value "${name}" is not configured.`
          );
        }

        return value;
      }
    );
  }

  /**
   * Removes secret values from text before it is logged or stored.
   */
  redact(text: string): string {
    let result = text;

    for (const secret of Object.values(this.secrets)) {
      if (secret.length > 0) {
        result = result.split(secret).join('[REDACTED]');
      }
    }

    return result;
  }
}
