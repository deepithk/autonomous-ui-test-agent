import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  GitHubClient,
  type GitHubIssue
} from '../../src/github/github-client.js';

import {
  IssueReader,
  IssueReaderError,
  type IssueReaderConfig
} from '../../src/github/issue-reader.js';

const validIssue: GitHubIssue = {
  id: 12345,
  number: 1,
  title: 'Feature: Add and Remove Products from Shopping Cart',
  body: `
### AC-01: Successful Login

Given the user is on the login page,
When valid credentials are entered,
Then the products inventory page should be displayed.

### AC-02: Add Product to Cart

Given the user is on the products inventory page,
When the user selects Add to cart,
Then the selected product should be added.
`,
  state: 'open',
  html_url:
    'https://github.com/deepithk/autonomous-ui-test-agent/issues/1',
  labels: []
};

const validProjectResponse = {
  user: {
    projectV2: {
      title: 'Autonomous UI QA Board',
      items: {
        nodes: [
          {
            content: {
              __typename: 'Issue',
              number: 1,
              title: validIssue.title,
              repository: {
                nameWithOwner:
                  'deepithk/autonomous-ui-test-agent'
              }
            },
            fieldValueByName: {
              __typename: 'ProjectV2ItemFieldSingleSelectValue',
              name: 'RFQA'
            }
          }
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: null
        }
      }
    }
  }
};

const validConfig: IssueReaderConfig = {
  owner: 'deepithk',
  repository: 'autonomous-ui-test-agent',
  issueNumber: 1,
  projectNumber: 1,
  expectedStatus: 'RFQA',
  allowLabelFallback: true
};

function createReader(
  options: {
    config?: Partial<IssueReaderConfig>;
    issue?: Partial<GitHubIssue>;
    projectResponse?: unknown;
  } = {}
) {
  const client = new GitHubClient('test-token');

  const issue = {
    ...validIssue,
    ...options.issue
  };

  const getIssueSpy = vi
    .spyOn(client, 'getIssue')
    .mockResolvedValue(issue);

  const queryGraphQLSpy = vi
    .spyOn(client, 'queryGraphQL')
    .mockResolvedValue(
      (options.projectResponse ??
        validProjectResponse) as never
    );

  const reader = new IssueReader(client, {
    ...validConfig,
    ...options.config
  });

  return {
    reader,
    client,
    getIssueSpy,
    queryGraphQLSpy
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IssueReader', () => {

  it('retrieves an eligible GitHub issue with RFQA status', async () => {
    const { reader, getIssueSpy } = createReader();

    const result = await reader.readIssue();

    expect(getIssueSpy).toHaveBeenCalledWith(
      'deepithk',
      'autonomous-ui-test-agent',
      1
    );

    expect(result.issue.number).toBe(1);

    expect(result.project.status).toBe('RFQA');

    expect(result.project.source).toBe('project-v2');

    expect(result.project.projectTitle).toBe(
      'Autonomous UI QA Board'
    );

    expect(result.acceptanceCriteria).toHaveLength(2);
  });

  it('rejects a closed issue', async () => {
    const { reader, queryGraphQLSpy } = createReader({
      issue: {
        state: 'closed'
      }
    });

    await expect(reader.readIssue()).rejects.toThrow(
      'is closed and is not eligible for testing'
    );

    expect(queryGraphQLSpy).not.toHaveBeenCalled();
  });

  it('rejects pull requests returned by the issue endpoint', async () => {
    const { reader, queryGraphQLSpy } = createReader({
      issue: {
        pull_request: {
          url: 'https://api.github.com/repos/example/pulls/1'
        }
      }
    });

    await expect(reader.readIssue()).rejects.toThrow(
      'not an issue'
    );

    expect(queryGraphQLSpy).not.toHaveBeenCalled();
  });

  it('rejects an issue that is not in RFQA', async () => {
    const todoProjectResponse = {
      user: {
        projectV2: {
          ...validProjectResponse.user.projectV2,
          items: {
            nodes: [
              {
                ...validProjectResponse.user.projectV2.items.nodes[0],
                fieldValueByName: {
                  __typename:
                    'ProjectV2ItemFieldSingleSelectValue',
                  name: 'Todo'
                }
              }
            ],
            pageInfo: {
              hasNextPage: false,
              endCursor: null
            }
          }
        }
      }
    };

    const { reader } = createReader({
      projectResponse: todoProjectResponse
    });

    await expect(reader.readIssue()).rejects.toThrow(
      'Expected status "RFQA", but actual status is "Todo"'
    );
  });

  it('uses the issue-label fallback when Projects V2 is unavailable', async () => {
    const { reader, queryGraphQLSpy } = createReader({
      issue: {
        labels: [{ name: 'status: RFQA' }]
      }
    });

    queryGraphQLSpy.mockRejectedValueOnce(
      new Error('GitHub Projects API unavailable')
    );

    const result = await reader.readIssue();

    expect(result.project.status).toBe('RFQA');

    expect(result.project.source).toBe(
      'issue-label-fallback'
    );

    expect(result.project.warning).toContain(
      'Projects V2 could not be verified'
    );
  });

  it('rejects fallback when the RFQA label is missing', async () => {
    const { reader, queryGraphQLSpy } = createReader();

    queryGraphQLSpy.mockRejectedValueOnce(
      new Error('GitHub Projects API unavailable')
    );

    await expect(reader.readIssue()).rejects.toThrow(
      'Projects V2 status could not be verified'
    );
  });

  it('rejects fallback when label fallback is disabled', async () => {
    const { reader, queryGraphQLSpy } = createReader({
      config: {
        allowLabelFallback: false
      },
      issue: {
        labels: [{ name: 'status: RFQA' }]
      }
    });

    queryGraphQLSpy.mockRejectedValueOnce(
      new Error('GitHub Projects API unavailable')
    );

    await expect(reader.readIssue()).rejects.toThrow(
      'GitHub Projects API unavailable'
    );
  });

  it('rejects an issue without acceptance criteria', async () => {
    const { reader, queryGraphQLSpy } = createReader({
      issue: {
        body: 'This issue has no acceptance criteria.'
      }
    });

    await expect(reader.readIssue()).rejects.toThrow(
      'No acceptance criteria found'
    );

    expect(queryGraphQLSpy).not.toHaveBeenCalled();
  });

  it('retrieves the issue from a later project page', async () => {
    const { reader, queryGraphQLSpy } = createReader();

    const firstPage = {
      user: {
        projectV2: {
          title: 'Autonomous UI QA Board',
          items: {
            nodes: [],
            pageInfo: {
              hasNextPage: true,
              endCursor: 'cursor-1'
            }
          }
        }
      }
    };

    queryGraphQLSpy
      .mockResolvedValueOnce(firstPage as never)
      .mockResolvedValueOnce(
        validProjectResponse as never
      );

    const result = await reader.readIssue();

    expect(result.project.status).toBe('RFQA');

    expect(queryGraphQLSpy).toHaveBeenCalledTimes(2);

    expect(queryGraphQLSpy.mock.calls[1]?.[1]).toMatchObject({
      after: 'cursor-1'
    });
  });

  it('rejects invalid issue configuration', async () => {
    const { reader, getIssueSpy } = createReader({
      config: {
        issueNumber: 0
      }
    });

    await expect(reader.readIssue()).rejects.toBeInstanceOf(
      IssueReaderError
    );

    expect(getIssueSpy).not.toHaveBeenCalled();
  });

});