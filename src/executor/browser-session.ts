import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
  ALLOWED_PLAYWRIGHT_MCP_TOOLS,
  BLOCKED_PLAYWRIGHT_MCP_TOOLS
} from '../config/env.js';

import { resolvePlaywrightMcpCommand } from '../config/platform.js';

/**
 * Content block returned by an MCP tool call.
 */
export interface McpContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

/**
 * Result of an MCP tool call.
 */
export interface McpToolResult {
  isError?: boolean | undefined;
  content?: unknown;
}

/**
 * Minimal MCP client surface used by the browser session.
 * Keeps the session testable without launching a browser.
 */
export interface McpClientLike {
  listTools(): Promise<{ tools: Array<{ name: string }> }>;

  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    resultSchema?: undefined,
    options?: { timeout?: number }
  ): Promise<McpToolResult>;

  close(): Promise<void>;
}

export interface BrowserSessionOptions {
  headless: boolean;
  caps: string;
  actionTimeoutMs: number;

  /**
   * Overrides how the MCP client is created.
   * Used by unit tests.
   */
  connect?: (options: {
    headless: boolean;
    caps: string;
  }) => Promise<McpClientLike>;
}

export class BrowserSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserSessionError';
  }
}

/** The least time a page load may take before it is given up on. */
const NAVIGATION_TIMEOUT_MS = 30000;

const ALLOWED_TOOLS: ReadonlySet<string> = new Set(
  ALLOWED_PLAYWRIGHT_MCP_TOOLS
);

const BLOCKED_TOOLS: ReadonlySet<string> = new Set(
  BLOCKED_PLAYWRIGHT_MCP_TOOLS
);

/**
 * Starts a Playwright MCP server over stdio and connects to it.
 *
 * --isolated keeps the browser profile in memory, so every
 * session starts with clean cookies and storage.
 */
async function connectToPlaywrightMcp(options: {
  headless: boolean;
  caps: string;
}): Promise<McpClientLike> {
  const spawn = resolvePlaywrightMcpCommand(options);

  const transport = new StdioClientTransport({
    command: spawn.command,
    args: [...spawn.args, '--isolated']
  });

  const client = new Client({
    name: 'autonomous-ui-test-agent',
    version: '0.1.0'
  });

  await client.connect(transport);

  return client as unknown as McpClientLike;
}

/**
 * One isolated browser, controlled only through allow-listed
 * Playwright MCP tools. Create one session per scenario.
 */
export class BrowserSession {
  private closed = false;

  private constructor(
    private readonly client: McpClientLike,
    private readonly actionTimeoutMs: number,
    private readonly availableTools: ReadonlySet<string>
  ) {}

  /**
   * Opens a session and verifies that every allowed tool exists.
   */
  static async open(
    options: BrowserSessionOptions
  ): Promise<BrowserSession> {
    const connect = options.connect ?? connectToPlaywrightMcp;

    const client = await connect({
      headless: options.headless,
      caps: options.caps
    });

    try {
      const { tools } = await client.listTools();

      const serverTools = new Set(tools.map(tool => tool.name));

      const missing = ALLOWED_PLAYWRIGHT_MCP_TOOLS.filter(
        name => !serverTools.has(name)
      );

      if (missing.length > 0) {
        throw new BrowserSessionError(
          'Playwright MCP is missing required tools: ' +
          `${missing.join(', ')}.`
        );
      }

      // Only allow-listed tools are ever made available.
      const available = new Set(
        [...serverTools].filter(name => ALLOWED_TOOLS.has(name))
      );

      return new BrowserSession(
        client,
        options.actionTimeoutMs,
        available
      );
    } catch (error) {
      await client.close().catch(() => undefined);

      throw error;
    }
  }

  /**
   * Names of the tools this session can call.
   */
  getAvailableTools(): string[] {
    return [...this.availableTools].sort();
  }

  /**
   * How long a call may take. Opening a page is allowed longer than a
   * click: the first page load in a fresh browser on a slow machine, such
   * as a hosted CI runner, can take far more than a normal action.
   */
  private timeoutFor(toolName: string): number {
    return toolName === 'browser_navigate'
      ? Math.max(this.actionTimeoutMs, NAVIGATION_TIMEOUT_MS)
      : this.actionTimeoutMs;
  }

  /**
   * Calls an allow-listed tool with the configured timeout.
   * Tool errors are thrown as BrowserSessionError.
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<McpContentBlock[]> {
    if (this.closed) {
      throw new BrowserSessionError(
        'Browser session is already closed.'
      );
    }

    if (BLOCKED_TOOLS.has(name)) {
      throw new BrowserSessionError(
        `Tool "${name}" is blocked and can never be called.`
      );
    }

    if (!this.availableTools.has(name)) {
      throw new BrowserSessionError(
        `Tool "${name}" is not in the allowed tool list.`
      );
    }

    const result = await this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: this.timeoutFor(name) }
    );

    const content = Array.isArray(result.content)
      ? (result.content as McpContentBlock[])
      : [];

    if (result.isError) {
      const message = content
        .filter(block => block.type === 'text')
        .map(block => block.text ?? '')
        .join('\n')
        .trim();

      throw new BrowserSessionError(
        `Tool "${name}" failed: ${message || 'unknown error'}`
      );
    }

    return content;
  }

  /**
   * Closes the browser and the MCP connection.
   * Safe to call more than once.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    // browser_close is best effort; the process is stopped anyway.
    await this.client
      .callTool({ name: 'browser_close' }, undefined, {
        timeout: this.actionTimeoutMs
      })
      .catch(() => undefined);

    await this.client.close().catch(() => undefined);
  }
}
