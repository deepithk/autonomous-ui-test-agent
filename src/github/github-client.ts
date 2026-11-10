/**
 * GitHub API Client
 *
 * Provides authenticated access to:
 * 1. GitHub REST API
 * 2. GitHub GraphQL API
 *
 * Uses Node.js native fetch to avoid additional dependencies.
 */

export interface GitHubIssueLabel {
  name: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  html_url: string;
  labels: GitHubIssueLabel[];
  pull_request?: {
    url: string;
  };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
  }>;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export class GitHubClient {
  private readonly token: string;

  private readonly apiBaseUrl = 'https://api.github.com';

  private readonly requestTimeoutMs = 15000;

  constructor(token: string) {
    if (!token.trim()) {
      throw new Error('GitHub API token is required.');
    }

    this.token = token;
  }

  /**
   * Common authenticated request headers.
   */
  private getHeaders(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'autonomous-ui-test-agent'
    };
  }

  /**
   * Makes an authenticated REST API request.
   */
  private async get<T>(endpoint: string): Promise<T> {
    const url = `${this.apiBaseUrl}${endpoint}`;

    let response: Response;

    try {
      response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown network error';

      throw new GitHubApiError(
        `GitHub REST request failed: ${message}`
      );
    }

    if (!response.ok) {
      throw new GitHubApiError(
        `GitHub REST request failed with HTTP ${response.status}.`,
        response.status
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Retrieves a GitHub issue.
   */
  async getIssue(
    owner: string,
    repository: string,
    issueNumber: number
  ): Promise<GitHubIssue> {
    if (!owner.trim() || !repository.trim()) {
      throw new Error(
        'GitHub owner and repository are required.'
      );
    }

    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      throw new Error('Issue number must be a positive integer.');
    }

    const endpoint =
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repository)}` +
      `/issues/${issueNumber}`;

    return this.get<GitHubIssue>(endpoint);
  }

  /**
   * Executes a GitHub GraphQL query.
   */
  async queryGraphQL<T>(
    query: string,
    variables: Record<string, unknown> = {}
  ): Promise<T> {
    if (!query.trim()) {
      throw new Error('GraphQL query cannot be empty.');
    }

    let response: Response;

    try {
      response = await fetch(`${this.apiBaseUrl}/graphql`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          query,
          variables
        }),
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown network error';

      throw new GitHubApiError(
        `GitHub GraphQL request failed: ${message}`
      );
    }

    if (!response.ok) {
      throw new GitHubApiError(
        `GitHub GraphQL request failed with HTTP ${response.status}.`,
        response.status
      );
    }

    const result =
      (await response.json()) as GraphQLResponse<T>;

    if (result.errors?.length) {
      const messages = result.errors
        .map(error => error.message)
        .join('; ');

      throw new GitHubApiError(
        `GitHub GraphQL query failed: ${messages}`
      );
    }

    if (result.data === undefined) {
      throw new GitHubApiError(
        'GitHub GraphQL response did not contain data.'
      );
    }

    return result.data;
  }
}