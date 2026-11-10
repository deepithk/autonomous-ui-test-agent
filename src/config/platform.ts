import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface EvidenceDirectories {
  rootDir: string;
  logsDir: string;
  screenshotsDir: string;
  videosDir: string;
  reportsDir: string;
  tmpDir: string;
}

export interface McpSpawnCommand {
  command: string;
  args: string[];
}

/**
 * Determines whether the current ES module is the application entry point.
 * Supports Windows and macOS file paths.
 */
export function isMainModule(
  importMetaUrl: string,
  argvEntry: string | undefined = process.argv[1]
): boolean {
  if (!argvEntry) {
    return false;
  }

  try {
    const modulePath = path.resolve(fileURLToPath(importMetaUrl));
    const entryPath = path.resolve(argvEntry);

    if (process.platform === 'win32') {
      return modulePath.toLowerCase() === entryPath.toLowerCase();
    }

    return (
      modulePath === entryPath ||
      importMetaUrl === pathToFileURL(entryPath).href
    );
  } catch {
    return false;
  }
}

/**
 * Resolves the project root directory.
 */
export function getProjectRoot(
  importMetaUrl: string = import.meta.url
): string {
  const currentFilePath = fileURLToPath(importMetaUrl);
  const currentDir = path.dirname(currentFilePath);

  return path.resolve(currentDir, '..', '..');
}

/**
 * Creates evidence directories recursively.
 */
export async function ensureEvidenceDirectories(
  projectRoot: string = getProjectRoot()
): Promise<EvidenceDirectories> {
  const rootDir = path.join(projectRoot, 'evidence');

  const directories: EvidenceDirectories = {
    rootDir,
    logsDir: path.join(rootDir, 'logs'),
    screenshotsDir: path.join(rootDir, 'screenshots'),
    videosDir: path.join(rootDir, 'videos'),
    reportsDir: path.join(rootDir, 'reports'),
    tmpDir: path.join(rootDir, 'tmp')
  };

  await Promise.all([
    mkdir(directories.logsDir, { recursive: true }),
    mkdir(directories.screenshotsDir, { recursive: true }),
    mkdir(directories.videosDir, { recursive: true }),
    mkdir(directories.reportsDir, { recursive: true }),
    mkdir(directories.tmpDir, { recursive: true })
  ]);

  return directories;
}

/**
 * Resolves the Playwright MCP CLI command.
 *
 * Preferred approach:
 * Resolve the installed package.json and construct its CLI path.
 * Launch using the current Node.js executable.
 *
 * Fallback:
 * Use the OS-appropriate npx command.
 */
export function resolvePlaywrightMcpCommand(
  options: { headless: boolean; caps: string },
  platform: NodeJS.Platform = process.platform,
  resolvePackageJson?: (specifier: string) => string
): McpSpawnCommand {
  const mcpArgs: string[] = [];

  if (options.headless) {
    mcpArgs.push('--headless');
  }

  if (options.caps.trim().length > 0) {
    mcpArgs.push(`--caps=${options.caps.trim()}`);
  }

  try {
    const requireFn =
      resolvePackageJson ?? createRequire(import.meta.url).resolve;

    const packageJsonPath = requireFn(
      '@playwright/mcp/package.json'
    );

    const packageDirectory = path.dirname(packageJsonPath);
    const cliEntryPath = path.join(packageDirectory, 'cli.js');

    if (existsSync(cliEntryPath)) {
      return {
        command: process.execPath,
        args: [cliEntryPath, ...mcpArgs]
      };
    }
  } catch {
    // Use the fallback below if package resolution fails.
  }

  if (platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        'npx.cmd',
        '--no-install',
        '@playwright/mcp',
        ...mcpArgs
      ]
    };
  }

  return {
    command: 'npx',
    args: [
      '--no-install',
      '@playwright/mcp',
      ...mcpArgs
    ]
  };
}