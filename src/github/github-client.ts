/**
 * GitHub API Client
 *
 * Provides authenticated access to:
 * 1. GitHub REST API
 * 2. GitHub GraphQL API
 *
 * Uses Node.js native fetch to avoid additional dependencies.
 */

import { errorMessage } from '../util/text.js';

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
    const response = await this.send(
      'REST',
      `${this.apiBaseUrl}${endpoint}`,
      { method: 'GET', headers: this.getHeaders() }
    );

    return (await response.json()) as T;
  }

  /**
   * Sends a request with the common timeout and turns a network
   * problem or an HTTP error into a GitHubApiError.
   */
  private async send(
    kind: 'REST' | 'GraphQL',
    url: string,
    init: RequestInit
  ): Promise<Response> {
    let response: Response;

    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      });
    } catch (error: unknown) {
      throw new GitHubApiError(
        `GitHub ${kind} request failed: ` +
        errorMessage(error, 'Unknown network error')
      );
    }

    if (!response.ok) {
      throw new GitHubApiError(
        `GitHub ${kind} request failed with HTTP ${response.status}.`,
        response.status
      );
    }

    return response;
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

    const response = await this.send(
      'GraphQL',
      `${this.apiBaseUrl}/graphql`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ query, variables })
      }
    );

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