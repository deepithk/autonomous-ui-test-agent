import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from the local .env file.
dotenv.config({ quiet: true });

// Tools the autonomous agent is permitted to use.
// The MCP bridge will filter discovered tools against this list.
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

// Tools that must never be exposed to the autonomous agent.
export const BLOCKED_PLAYWRIGHT_MCP_TOOLS = [
  'browser_run_code_unsafe',
  'browser_run_code',
  'browser_evaluate',
  'browser_file_upload',
  'browser_route'
] as const;

// Validate application configuration.
const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),

  GITHUB_TOKEN: z.string().min(1),
  GITHUB_OWNER: z.string().min(1),
  GITHUB_REPO: z.string().min(1),

  GITHUB_ISSUE_NUMBER: z.coerce.number().int().positive(),

  GITHUB_RFQA_STATUS_VALUE: z.string().default('RFQA'),

  GITHUB_PROJECT_NUMBER: z.coerce.number().int().positive(),

  GITHUB_RFQA_FALLBACK_LABEL: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),

  TARGET_BASE_URL: z
    .string()
    .url()
    .refine(value => {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    }, 'TARGET_BASE_URL must use HTTP or HTTPS.'),

  PLAYWRIGHT_MCP_HEADLESS: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),

  PLAYWRIGHT_MCP_CAPS: z.string().default('testing'),

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
  
  SAUCEDEMO_USERNAME: z.string().min(1),
  SAUCEDEMO_PASSWORD: z.string().min(1)
});

export type AppConfig = z.infer<typeof envSchema>;

// Validate environment variables and return typed configuration.
export function loadConfig(
  rawEnv: NodeJS.ProcessEnv = process.env
): AppConfig {
  const result = envSchema.safeParse(rawEnv);

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

// Never expose API credentials in application logs.
export function redactConfigForLogging(
  config: AppConfig
): Record<string, unknown> {
  return {
    ...config,
    ANTHROPIC_API_KEY: '[REDACTED]',
    GITHUB_TOKEN: '[REDACTED]',
    SAUCEDEMO_PASSWORD: '[REDACTED]'
  };
}