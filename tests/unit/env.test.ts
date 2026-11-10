import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_PLAYWRIGHT_MCP_TOOLS,
  BLOCKED_PLAYWRIGHT_MCP_TOOLS,
  loadConfig,
  redactConfigForLogging
} from '../../src/config/env.js';

import {
  ensureEvidenceDirectories,
  isMainModule,
  resolvePlaywrightMcpCommand
} from '../../src/config/platform.js';

describe('Phase 2 Environment and Cross-Platform Utilities', () => {

  const validEnv: NodeJS.ProcessEnv = {
    ANTHROPIC_API_KEY: 'sk-ant-test-placeholder',
    ANTHROPIC_MODEL: 'claude-sonnet-5-5',
    GITHUB_TOKEN: 'ghp-test-placeholder',
    GITHUB_OWNER: 'test-owner',
    GITHUB_REPO: 'test-repo',
    GITHUB_ISSUE_NUMBER: '42',
    GITHUB_PROJECT_NUMBER: '1',
    TARGET_BASE_URL: 'https://example.com',
    SAUCEDEMO_USERNAME: 'test-user',
    SAUCEDEMO_PASSWORD: 'test-password'
  };

  it('validates environment configuration and applies defaults', () => {
    const config = loadConfig(validEnv);

    expect(config.ANTHROPIC_MODEL).toBe('claude-sonnet-5-5');
    expect(config.GITHUB_ISSUE_NUMBER).toBe(42);
    expect(config.PLAYWRIGHT_MCP_CAPS).toBe('testing');
    expect(config.MAX_STEPS_PER_SCENARIO).toBe(15);
    expect(config.GITHUB_PROJECT_NUMBER).toBe(1);
  });

  it('rejects missing required environment variables', () => {
    expect(() => loadConfig({})).toThrow(
      /Invalid environment configuration/
    );
  });

  it('rejects URLs that do not use HTTP or HTTPS', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        TARGET_BASE_URL: 'javascript:alert(1)'
      })
    ).toThrow();
  });

  it('redacts API keys and GitHub tokens from logs', () => {
    const config = loadConfig(validEnv);
    const redacted = redactConfigForLogging(config);

    expect(redacted.ANTHROPIC_API_KEY).toBe('[REDACTED]');
    expect(redacted.GITHUB_TOKEN).toBe('[REDACTED]');
  });

  it('allows browser_tabs and excludes unsafe browser tools', () => {
    expect(ALLOWED_PLAYWRIGHT_MCP_TOOLS).toContain('browser_tabs');

    expect(ALLOWED_PLAYWRIGHT_MCP_TOOLS).not.toContain(
      'browser_check'
    );

    expect(ALLOWED_PLAYWRIGHT_MCP_TOOLS).not.toContain(
      'browser_uncheck'
    );

    for (const tool of BLOCKED_PLAYWRIGHT_MCP_TOOLS) {
      expect(ALLOWED_PLAYWRIGHT_MCP_TOOLS).not.toContain(tool);
    }
  });

  it('detects the main module entry point correctly', () => {
    const samplePath = path.resolve('src', 'index.ts');
    const sampleFileUrl = pathToFileURL(samplePath).href;

    expect(isMainModule(sampleFileUrl, samplePath)).toBe(true);

    expect(
      isMainModule(sampleFileUrl, path.resolve('src', 'other.ts'))
    ).toBe(false);

    expect(isMainModule(sampleFileUrl, undefined)).toBe(false);
  });

  it('resolves the installed Playwright MCP CLI', () => {
    const command = resolvePlaywrightMcpCommand({
      headless: true,
      caps: 'testing'
    });

    expect(command.command).toBe(process.execPath);
    expect(command.args[0]).toMatch(/cli\.js$/);
    expect(command.args).toContain('--headless');
    expect(command.args).toContain('--caps=testing');
  });

  it('uses platform-specific fallback commands', () => {
    const throwingResolver = (): string => {
      throw new Error('Package resolution failed');
    };

    const windowsCommand = resolvePlaywrightMcpCommand(
      { headless: true, caps: 'testing' },
      'win32',
      throwingResolver
    );

    expect(windowsCommand.command.toLowerCase()).toContain('cmd');

    expect(windowsCommand.args.slice(0, 4)).toEqual([
      '/d',
      '/s',
      '/c',
      'npx.cmd'
    ]);

    const macCommand = resolvePlaywrightMcpCommand(
      { headless: true, caps: 'testing' },
      'darwin',
      throwingResolver
    );

    expect(macCommand.command).toBe('npx');
    expect(macCommand.args[0]).toBe('--no-install');
  });

  it('creates evidence directories recursively', async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), 'agent-phase2-')
    );

    try {
      const directories = await ensureEvidenceDirectories(tempRoot);

      expect(existsSync(directories.logsDir)).toBe(true);
      expect(existsSync(directories.screenshotsDir)).toBe(true);
      expect(existsSync(directories.videosDir)).toBe(true);
      expect(existsSync(directories.reportsDir)).toBe(true);
      expect(existsSync(directories.tmpDir)).toBe(true);

    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

});