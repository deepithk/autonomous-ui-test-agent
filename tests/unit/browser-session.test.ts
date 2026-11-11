import { describe, expect, it, vi } from 'vitest';

import {
  BrowserSession,
  BrowserSessionError
} from '../../src/executor/browser-session.js';

import type {
  McpClientLike
} from '../../src/executor/browser-session.js';

import {
  ALLOWED_PLAYWRIGHT_MCP_TOOLS,
  BLOCKED_PLAYWRIGHT_MCP_TOOLS
} from '../../src/config/env.js';

function createClient(
  toolNames: string[] = [
    ...ALLOWED_PLAYWRIGHT_MCP_TOOLS,
    ...BLOCKED_PLAYWRIGHT_MCP_TOOLS,
    'browser_close'
  ]
): McpClientLike & {
  callTool: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    listTools: vi.fn().mockResolvedValue({
      tools: toolNames.map(name => ({ name }))
    }),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }]
    }),
    close: vi.fn().mockResolvedValue(undefined)
  };
}

async function openSession(client: McpClientLike) {
  return BrowserSession.open({
    headless: true,
    caps: 'testing',
    actionTimeoutMs: 5000,
    connect: async () => client
  });
}

describe('BrowserSession', () => {
  it('exposes only allow-listed tools', async () => {
    const session = await openSession(createClient());

    const tools = session.getAvailableTools();

    expect(tools).toHaveLength(ALLOWED_PLAYWRIGHT_MCP_TOOLS.length);

    for (const blocked of BLOCKED_PLAYWRIGHT_MCP_TOOLS) {
      expect(tools).not.toContain(blocked);
    }
  });

  it('fails and closes the client when allowed tools are missing', async () => {
    const client = createClient(['browser_navigate']);

    await expect(openSession(client)).rejects.toThrow(
      /missing required tools/
    );

    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('calls an allowed tool with the configured timeout', async () => {
    const client = createClient();

    const session = await openSession(client);

    const content = await session.callTool('browser_click', {
      target: 'e1'
    });

    expect(content).toEqual([{ type: 'text', text: 'ok' }]);

    expect(client.callTool).toHaveBeenCalledWith(
      {
        name: 'browser_click',
        arguments: { target: 'e1' }
      },
      undefined,
      { timeout: 5000 }
    );
  });

  it('allows opening a page longer than a normal action', async () => {
    const client = createClient();

    const session = await openSession(client);

    await session.callTool('browser_navigate', {
      url: 'https://www.saucedemo.com/'
    });

    expect(client.callTool).toHaveBeenCalledWith(
      {
        name: 'browser_navigate',
        arguments: { url: 'https://www.saucedemo.com/' }
      },
      undefined,
      { timeout: 30000 }
    );
  });

  it('never shortens a page load below the configured action timeout', async () => {
    const client = createClient();

    const session = await BrowserSession.open({
      headless: true,
      caps: 'testing',
      actionTimeoutMs: 90000,
      connect: async () => client
    });

    await session.callTool('browser_navigate', {
      url: 'https://www.saucedemo.com/'
    });

    expect(client.callTool).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      { timeout: 90000 }
    );
  });

  it.each([...BLOCKED_PLAYWRIGHT_MCP_TOOLS])(
    'never calls blocked tool %s',
    async blocked => {
      const client = createClient();

      const session = await openSession(client);

      await expect(session.callTool(blocked)).rejects.toThrow(
        /blocked/
      );

      expect(client.callTool).not.toHaveBeenCalled();
    }
  );

  it('rejects tools outside the allow-list', async () => {
    const client = createClient();

    const session = await openSession(client);

    await expect(
      session.callTool('browser_drag')
    ).rejects.toBeInstanceOf(BrowserSessionError);

    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('throws the tool message when a call reports an error', async () => {
    const client = createClient();

    client.callTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: 'text', text: 'Element not found' }]
    });

    const session = await openSession(client);

    await expect(
      session.callTool('browser_click', { ref: 'e1' })
    ).rejects.toThrow(/Element not found/);
  });

  it('closes once, is idempotent and blocks later calls', async () => {
    const client = createClient();

    const session = await openSession(client);

    await session.close();
    await session.close();

    expect(client.close).toHaveBeenCalledTimes(1);

    expect(client.callTool).toHaveBeenCalledTimes(1);

    expect(client.callTool).toHaveBeenCalledWith(
      { name: 'browser_close' },
      undefined,
      { timeout: 5000 }
    );

    await expect(
      session.callTool('browser_snapshot')
    ).rejects.toThrow(/already closed/);
  });

  it('still closes the client when browser_close fails', async () => {
    const client = createClient();

    client.callTool.mockRejectedValueOnce(new Error('crashed'));

    const session = await openSession(client);

    await expect(session.close()).resolves.toBeUndefined();

    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
