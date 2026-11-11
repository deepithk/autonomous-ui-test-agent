import {
  loadConfig,
  redactConfigForLogging
} from './env.js';

import {
  ensureEvidenceDirectories,
  isMainModule
} from './platform.js';

/**
 * Checks that .env is complete and valid, and creates the evidence
 * folders. It makes no LLM, GitHub or browser requests, so it costs
 * nothing to run before a real plan or execution.
 */
export async function checkConfig(): Promise<void> {
  const config = loadConfig();

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

  console.info('[INFO] Configuration check completed successfully.');
}

// Run only when this file is the entry point.
if (isMainModule(import.meta.url, process.argv[1])) {
  checkConfig().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : String(error);

    console.error(`[ERROR] Configuration check failed:\n${message}`);

    process.exitCode = 1;
  });
}
