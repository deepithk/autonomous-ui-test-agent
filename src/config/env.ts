import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

/**
 * Supported LLM providers.
 * Add another provider here when its adapter is implemented.
 */
export const LLM_PROVIDERS = [
  'gemini',
  'anthropic'
] as const;

export type LLMProvider = typeof LLM_PROVIDERS[number];

/**
 * Tools the autonomous agent is permitted to use.
 */
export const ALLOWED_PLAYWRIGHT_MCP_TOOLS = [
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_tabs',
  'browser_find',
  'browser_wait_for',
  'browser_click',
  'browser_type',
  'browser_fill_form',
  'browser_select_option',
  'browser_press_key',
  'browser_hover',
  'browser_handle_dialog',
  'browser_take_screenshot',
  'browser_verify_element_visible',
  'browser_verify_text_visible',
  'browser_verify_list_visible',
  'browser_verify_value'
] as const;

/**
 * Tools that must never be exposed to the autonomous agent.
 */
export const BLOCKED_PLAYWRIGHT_MCP_TOOLS = [
  'browser_run_code_unsafe',
  'browser_run_code',
  'browser_evaluate',
  'browser_file_upload',
  'browser_route'
] as const;

/**
 * Application environment schema.
 */
const envSchema = z.object({
  // Common LLM configuration
  LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('gemini'),

  // Model and key are optional until an LLM request is made.
  LLM_MODEL: z.string().default(''),

  LLM_API_KEY: z.string().default(''),

  // GitHub integration
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_OWNER: z.string().min(1),
  GITHUB_REPO: z.string().min(1),

  GITHUB_ISSUE_NUMBER: z.coerce
    .number()
    .int()
    .positive(),

  GITHUB_PROJECT_NUMBER: z.coerce
    .number()
    .int()
    .positive(),

  GITHUB_RFQA_STATUS_VALUE: z.string().default('RFQA'),

  GITHUB_RFQA_FALLBACK_LABEL: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),

  // Target application
  TARGET_BASE_URL: z
    .string()
    .url()
    .refine(value => {
      const protocol = new URL(value).protocol;

      return (
        protocol === 'http:' ||
        protocol === 'https:'
      );
    }, 'TARGET_BASE_URL must use HTTP or HTTPS.'),

  // SauceDemo credentials
  SAUCEDEMO_USERNAME: z.string().min(1),
  SAUCEDEMO_PASSWORD: z.string().min(1),

  // Playwright MCP
  PLAYWRIGHT_MCP_HEADLESS: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),

  PLAYWRIGHT_MCP_CAPS: z.string().default('testing'),

  // Execution guardrails
  MAX_STEPS_PER_SCENARIO: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(15),

  SCENARIO_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5000)
    .max(300000)
    .default(60000),

  ACTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(10000),

  MAX_ELEMENT_RECOVERY_ATTEMPTS: z.coerce
    .number()
    .int()
    .min(0)
    .max(5)
    .default(2),

  // Repair a step once before failing it. See TEST_PLAN.md, 9.3.
  SELF_HEALING: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true')
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * The settings that only reading an issue from GitHub needs.
 */
const GITHUB_SETTINGS = {
  GITHUB_TOKEN: true,
  GITHUB_OWNER: true,
  GITHUB_REPO: true,
  GITHUB_ISSUE_NUMBER: true,
  GITHUB_PROJECT_NUMBER: true,
  GITHUB_RFQA_STATUS_VALUE: true,
  GITHUB_RFQA_FALLBACK_LABEL: true
} as const;

/**
 * Everything except the GitHub settings. Executing a saved plan, and
 * planning from a local issue file, need no GitHub access.
 */
const localEnvSchema = envSchema.omit(GITHUB_SETTINGS);

export type LocalAppConfig = z.infer<typeof localEnvSchema>;

function parseEnvironment<Schema extends z.ZodType>(
  schema: Schema,
  rawEnv: NodeJS.ProcessEnv
): z.infer<Schema> {
  const result = schema.safeParse(rawEnv);

  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${issues}`
    );
  }

  return result.data;
}

/**
 * Validate the full environment configuration, including the
 * GitHub settings needed to read an issue from GitHub.
 */
export function loadConfig(
  rawEnv: NodeJS.ProcessEnv = process.env
): AppConfig {
  return parseEnvironment(envSchema, rawEnv);
}

/**
 * Validate the configuration for running without GitHub: executing
 * a saved plan, or planning from a local issue file.
 */
export function loadLocalConfig(
  rawEnv: NodeJS.ProcessEnv = process.env
): LocalAppConfig {
  return parseEnvironment(localEnvSchema, rawEnv);
}

/**
 * Redact sensitive configuration before logging.
 */
export function redactConfigForLogging(
  config: AppConfig | LocalAppConfig
): Record<string, unknown> {
  const safe: Record<string, unknown> = {
    ...config,
    LLM_API_KEY: '[REDACTED]',
    SAUCEDEMO_PASSWORD: '[REDACTED]'
  };

  if ('GITHUB_TOKEN' in config) {
    safe.GITHUB_TOKEN = '[REDACTED]';
  }

  return safe;
}