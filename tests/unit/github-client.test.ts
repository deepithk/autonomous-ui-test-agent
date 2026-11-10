import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  GitHubApiError,
  GitHubClient
} from '../../src/github/github-client.js';

const validIssue = {
  id: 12345,
  number: 1,
  title: 'Feature: Add and Remove Products from Shopping Cart',
  body: 'AC-01: Successful Login\nAC-02: Add Product to Cart',
  state: 'open' as const,
  html_url: 'https://github.com/deepithk/autonomous-ui-test-agent/issues/1',
  labels: []
};

function createResponse(
  body: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GitHubClient', () => {
  const client = new GitHubClient('test-token');

  it('rejects an empty authentication token', () => {
    expect(() => new GitHubClient(' ')).toThrow(
      'GitHub API token is required.'
    );
  });

  it('retrieves a GitHub issue successfully', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createResponse(validIssue)
    );

    vi.stubGlobal('fetch', fetchMock);

    const issue = await client.getIssue(
      'deepithk',
      'autonomous-ui-test-agent',
      1
    );

    expect(issue.number).toBe(1);
    expect(issue.title).toContain('Shopping Cart');
    expect(issue.state).toBe('open');

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toContain(
      '/repos/deepithk/autonomous-ui-test-agent/issues/1'
    );

    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe(
      'Bearer test-token'
    );
  });

  it('rejects invalid issue numbers', async () => {
    await expect(
      client.getIssue('deepithk', 'autonomous-ui-test-agent', 0)
    ).rejects.toThrow(
      'Issue number must be a positive integer.'
    );
  });

  it('handles GitHub REST API errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createResponse({ message: 'Not Found' }, 404)
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      client.getIssue('deepithk', 'autonomous-ui-test-agent', 999)
    ).rejects.toMatchObject({
      name: 'GitHubApiError',
      statusCode: 404
    });
  });

  it('handles network errors without exposing credentials', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new Error('Network unavailable')
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      client.getIssue('deepithk', 'autonomous-ui-test-agent', 1)
    ).rejects.toThrow('Network unavailable');
  });

  it('executes GraphQL queries successfully', async () => {
    const graphqlData = {
      viewer: {
        login: 'deepithk'
      }
    };

    const fetchMock = vi.fn().mockResolvedValue(
      createResponse({ data: graphqlData })
    );

    vi.stubGlobal('fetch', fetchMock);

    const result = await client.queryGraphQL<{
      viewer: { login: string };
    }>(
      'query { viewer { login } }'
    );

    expect(result.viewer.login).toBe('deepithk');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe('https://api.github.com/graphql');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe(
      'Bearer test-token'
    );
  });

  it('rejects empty GraphQL queries', async () => {
    await expect(
      client.queryGraphQL('')
    ).rejects.toThrow(
      'GraphQL query cannot be empty.'
    );
  });

  it('handles GraphQL errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createResponse({
        errors: [{ message: 'Resource not accessible' }]
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      client.queryGraphQL('query { viewer { login } }')
    ).rejects.toThrow('Resource not accessible');
  });

  it('rejects GraphQL responses without data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createResponse({})
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      client.queryGraphQL('query { viewer { login } }')
    ).rejects.toThrow(
      'GitHub GraphQL response did not contain data.'
    );
  });
});