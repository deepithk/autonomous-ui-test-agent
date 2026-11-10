import {
  loadConfig,
  redactConfigForLogging
} from './config/env.js';

import {
  ensureEvidenceDirectories,
  isMainModule
} from './config/platform.js';

/**
 * Phase 2 bootstrap.
 *
 * Validates configuration and initializes evidence directories.
 * Full agent execution will be implemented in later phases.
 */
export async function bootstrap(): Promise<void> {
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

  console.info('[INFO] Phase 2 bootstrap completed successfully.');
}

// Execute bootstrap only when this file is the application entry point.
if (isMainModule(import.meta.url, process.argv[1])) {
  bootstrap().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : String(error);

    console.error(`[ERROR] Application startup failed:\n${message}`);

    process.exitCode = 1;
  });
}