import {
  GitHubClient,
  type GitHubIssue
} from './github-client.js';

import {
  parseAcceptanceCriteria,
  type AcceptanceCriterion
} from './acceptance-criteria-parser.js';

export interface IssueReaderConfig {
  owner: string;
  repository: string;
  issueNumber: number;
  projectNumber: number;
  expectedStatus: string;
  allowLabelFallback: boolean;
}

export interface ProjectStatusResult {
  projectTitle: string | null;
  status: string;
  source: 'project-v2' | 'issue-label-fallback' | 'local-file';
  warning?: string;
}

export interface IssueReadResult {
  issue: GitHubIssue;
  acceptanceCriteria: AcceptanceCriterion[];
  project: ProjectStatusResult;
}

interface ProjectItemContent {
  __typename: string;
  number?: number;
  title?: string;
  repository?: {
    nameWithOwner: string;
  } | null;
}

interface ProjectSingleSelectValue {
  __typename: string;
  name?: string | null;
}

interface ProjectItemNode {
  content: ProjectItemContent | null;
  fieldValueByName: ProjectSingleSelectValue | null;
}

interface ProjectGraphQLData {
  user: {
    projectV2: {
      title: string;
      items: {
        nodes: ProjectItemNode[];
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
      };
    } | null;
  } | null;
}

// Explicitly derive the non-null Project V2 type.
type ProjectV2 = NonNullable<
  NonNullable<ProjectGraphQLData['user']>['projectV2']
>;

const PROJECT_STATUS_QUERY = `
  query GetProjectIssueStatus(
    $owner: String!
    $projectNumber: Int!
    $after: String
  ) {
    user(login: $owner) {
      projectV2(number: $projectNumber) {
        title
        items(first: 100, after: $after) {
          nodes {
            content {
              __typename
              ... on Issue {
                number
                title
                repository {
                  nameWithOwner
                }
              }
            }
            fieldValueByName(name: "Status") {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

export class IssueReaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IssueReaderError';
  }
}

export class IssueReader {
  constructor(
    private readonly client: GitHubClient,
    private readonly config: IssueReaderConfig
  ) {}

  /**
   * Retrieves the issue, validates its eligibility,
   * extracts acceptance criteria and verifies RFQA status.
   */
  async readIssue(): Promise<IssueReadResult> {
    this.validateConfiguration();

    // Retrieve the actual GitHub issue.
    const issue = await this.client.getIssue(
      this.config.owner,
      this.config.repository,
      this.config.issueNumber
    );

    if (issue.number !== this.config.issueNumber) {
      throw new IssueReaderError(
        'GitHub returned an unexpected issue number.'
      );
    }

    // GitHub issue endpoints can also return pull requests.
    if (issue.pull_request) {
      throw new IssueReaderError(
        'The requested resource is a pull request, not an issue.'
      );
    }

    // Only open issues are eligible for testing.
    if (issue.state !== 'open') {
      throw new IssueReaderError(
        `Issue #${issue.number} is closed and is not eligible for testing.`
      );
    }

    // Extract acceptance criteria deterministically.
    const acceptanceCriteria =
      parseAcceptanceCriteria(issue.body);

    let project: ProjectStatusResult;

    try {
      project = await this.readProjectStatus();

    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown Projects V2 error';

      // Label fallback is permitted only when configured
      // and the actual issue contains the expected label.
      if (!this.config.allowLabelFallback) {
        throw error;
      }

      const expectedLabel =
        `status: ${this.config.expectedStatus}`.toLowerCase();

      const hasFallbackLabel = issue.labels.some(
        label => label.name.toLowerCase() === expectedLabel
      );

      if (!hasFallbackLabel) {
        throw new IssueReaderError(
          `Projects V2 status could not be verified and ` +
          `the fallback label "${expectedLabel}" is absent. ` +
          `Original error: ${message}`
        );
      }

      project = {
        projectTitle: null,
        status: this.config.expectedStatus,
        source: 'issue-label-fallback',
        warning:
          `Projects V2 could not be verified. ` +
          `Status was obtained from the issue label. Reason: ${message}`
      };
    }

    // A label must never override a known, different
    // Projects V2 status.
    if (
      project.status.toLowerCase() !==
      this.config.expectedStatus.toLowerCase()
    ) {
      throw new IssueReaderError(
        `Issue #${issue.number} is not ready for testing. ` +
        `Expected status "${this.config.expectedStatus}", ` +
        `but actual status is "${project.status}".`
      );
    }

    return {
      issue,
      acceptanceCriteria,
      project
    };
  }

  /**
   * Retrieves the actual status from GitHub Projects V2.
   *
   * Supports pagination when the project contains
   * more than 100 items.
   */
  private async readProjectStatus(): Promise<ProjectStatusResult> {
    let after: string | null = null;

    while (true) {
      const data: ProjectGraphQLData =
        await this.client.queryGraphQL<ProjectGraphQLData>(
          PROJECT_STATUS_QUERY,
          {
            owner: this.config.owner,
            projectNumber: this.config.projectNumber,
            after
          }
        );

      const project: ProjectV2 | null | undefined =
        data.user?.projectV2;

      if (!project) {
        throw new IssueReaderError(
          `GitHub Project #${this.config.projectNumber} ` +
          `was not found or is inaccessible.`
        );
      }

      const matchingItem: ProjectItemNode | undefined =
        project.items.nodes.find(
          (item: ProjectItemNode): boolean => {
            const content = item.content;

            if (!content || content.__typename !== 'Issue') {
              return false;
            }

            const repositoryName =
              content.repository?.nameWithOwner;

            return (
              content.number === this.config.issueNumber &&
              repositoryName?.toLowerCase() ===
                `${this.config.owner}/${this.config.repository}`.toLowerCase()
            );
          }
        );

      if (matchingItem) {
        const statusValue = matchingItem.fieldValueByName;
        const statusName = statusValue?.name;

        if (
          !statusValue ||
          statusValue.__typename !==
            'ProjectV2ItemFieldSingleSelectValue' ||
          !statusName
        ) {
          throw new IssueReaderError(
            'The matching project item does not have a valid single-select Status value.'
          );
        }

        return {
          projectTitle: project.title,
          status: statusName,
          source: 'project-v2'
        };
      }

      // Stop when there are no more project items.
      if (!project.items.pageInfo.hasNextPage) {
        break;
      }

      const nextCursor: string | null =
        project.items.pageInfo.endCursor;

      // Prevent invalid or repeated pagination.
      if (!nextCursor || nextCursor === after) {
        throw new IssueReaderError(
          'Project pagination could not advance safely.'
        );
      }

      after = nextCursor;
    }

    throw new IssueReaderError(
      `Issue #${this.config.issueNumber} was not found ` +
      `in GitHub Project #${this.config.projectNumber}.`
    );
  }

  /**
   * Validates the Issue Reader configuration.
   */
  private validateConfiguration(): void {
    const {
      owner,
      repository,
      issueNumber,
      projectNumber,
      expectedStatus
    } = this.config;

    if (!owner.trim() || !repository.trim()) {
      throw new IssueReaderError(
        'GitHub owner and repository are required.'
      );
    }

    if (
      !Number.isInteger(issueNumber) ||
      issueNumber <= 0 ||
      !Number.isInteger(projectNumber) ||
      projectNumber <= 0
    ) {
      throw new IssueReaderError(
        'Issue number and project number must be positive integers.'
      );
    }

    if (!expectedStatus.trim()) {
      throw new IssueReaderError(
        'Expected project status is required.'
      );
    }
  }
}