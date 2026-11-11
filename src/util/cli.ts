import { errorMessage } from './text.js';

/**
 * Runs the main function of a command-line entry point. If it fails,
 * the problem is printed and the process exits with code 1.
 */
export function runCli(
  failureTitle: string,
  main: () => Promise<void>
): void {
  main().catch((error: unknown) => {
    console.error(`\n[ERROR] ${failureTitle}`);
    console.error(errorMessage(error));

    process.exitCode = 1;
  });
}
