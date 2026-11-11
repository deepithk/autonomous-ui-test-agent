import {
  loadConfig,
  loadLocalConfig,
  redactConfigForLogging
} from './env.js';

import {
  ensureEvidenceDirectories,
  isMainModule
} from './platform.js';

export interface CheckConfigOptions {
  /** Also require the GitHub settings that plan:issue needs. */
  includeGitHub?: boolean;
}

/**
 * Checks that .env is complete and valid, and creates the evidence
 * folders. It makes no LLM, GitHub or browser requests, so it costs
 * nothing to run before a real plan or execution.
 *
 * By default it checks what running a saved plan needs. With
 * includeGitHub it also checks the settings for reading an issue
 * from GitHub.
 */
export async function checkConfig(
  options: CheckConfigOptions = {}
): Promise<void> {
  const config = options.includeGitHub
    ? loadConfig()
    : loadLocalConfig();

  const directories = await ensureEvidenceDirectories();

  const safeConfig = redactConfigForLogging(config);

  console.info(
    '[INFO] Environment configuration validated:',
    JSON.stringify(safeConfig)
  );

  console.info(
    '[INFO] Evidence directories initialized:',
    directories.rootDir
  );

  if (config.LLM_API_KEY.trim() === '') {
    console.warn(
      '[WARNING] LLM_API_KEY is empty. Planning and executing need it.'
    );
  }

  console.info(
    options.includeGitHub
      ? '[INFO] Configuration check completed (including GitHub settings).'
      : '[INFO] Configuration check completed. GitHub settings were not ' +
        'checked; add --github to check them.'
  );
}

// Run only when this file is the entry point.
if (isMainModule(import.meta.url, process.argv[1])) {
  checkConfig({ includeGitHub: process.argv.includes('--github') }).catch(
    (error: unknown) => {
      const message =
        error instanceof Error ? error.message : String(error);

      console.error(`[ERROR] Configuration check failed:\n${message}`);

      process.exitCode = 1;
    }
  );
}
