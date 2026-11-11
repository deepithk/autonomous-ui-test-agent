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
  loadLocalConfig,
  redactConfigForLogging
} from '../../src/config/env.js';

import {
  ensureEvidenceDirectories,
  isMainModule,
  resolvePlaywrightMcpCommand
} from '../../src/config/platform.js';

describe('Phase 2 Environment and Cross-Platform Utilities', () => {

  const validEnv: NodeJS.ProcessEnv = {
    LLM_PROVIDER: 'gemini',
    LLM_MODEL: 'test-model',
    LLM_API_KEY: 'test-llm-placeholder',
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

    expect(config.LLM_PROVIDER).toBe('gemini');
    expect(config.LLM_MODEL).toBe('test-model');
    expect(config.LLM_API_KEY).toBe('test-llm-placeholder');
    expect(config.GITHUB_ISSUE_NUMBER).toBe(42);
    expect(config.PLAYWRIGHT_MCP_CAPS).toBe('testing');
    expect(config.MAX_STEPS_PER_SCENARIO).toBe(15);
    expect(config.GITHUB_PROJECT_NUMBER).toBe(1);
  });

  it('loads the local configuration without any GitHub settings', () => {
    const { LLM_PROVIDER, LLM_MODEL, LLM_API_KEY, TARGET_BASE_URL,
      SAUCEDEMO_USERNAME, SAUCEDEMO_PASSWORD } = validEnv;

    const config = loadLocalConfig({
      LLM_PROVIDER,
      LLM_MODEL,
      LLM_API_KEY,
      TARGET_BASE_URL,
      SAUCEDEMO_USERNAME,
      SAUCEDEMO_PASSWORD
    });

    expect(config.LLM_MODEL).toBe('test-model');
    expect(config.MAX_STEPS_PER_SCENARIO).toBe(15);
    expect('GITHUB_TOKEN' in config).toBe(false);
  });

  it('still requires the target app and login for the local configuration', () => {
    expect(() => loadLocalConfig({ LLM_PROVIDER: 'gemini' })).toThrow(
      /TARGET_BASE_URL[\s\S]*SAUCEDEMO_USERNAME/
    );
  });

  it('keeps GitHub settings required for the full configuration', () => {
    const { GITHUB_TOKEN: _removed, ...withoutToken } = validEnv;

    expect(() => loadConfig(withoutToken)).toThrow(/GITHUB_TOKEN/);
  });

  it('redacts secrets from the local configuration too', () => {
    const config = loadLocalConfig({
      LLM_PROVIDER: 'gemini',
      LLM_API_KEY: 'key-value',
      TARGET_BASE_URL: 'https://example.com',
      SAUCEDEMO_USERNAME: 'user',
      SAUCEDEMO_PASSWORD: 'password-value'
    });

    const safe = JSON.stringify(redactConfigForLogging(config));

    expect(safe).not.toContain('key-value');
    expect(safe).not.toContain('password-value');
    expect(safe).not.toContain('GITHUB_TOKEN');
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

    expect(redacted.LLM_API_KEY).toBe('[REDACTED]');
    expect(redacted.GITHUB_TOKEN).toBe('[REDACTED]');
    expect(redacted.SAUCEDEMO_PASSWORD).toBe('[REDACTED]');
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