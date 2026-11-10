import { loadConfig } from '../config/env.js';
import { GitHubClient } from './github-client.js';
import { IssueReader } from './issue-reader.js';

/**
 * Runs the GitHub Issue Reader against the configured
 * private repository and GitHub Projects V2 board.
 *
 * This is a read-only integration check.
 */
async function main(): Promise<void> {
  console.info('[INFO] Starting GitHub Issue Reader...');

  const config = loadConfig();

  const client = new GitHubClient(config.GITHUB_TOKEN);

  const reader = new IssueReader(client, {
    owner: config.GITHUB_OWNER,
    repository: config.GITHUB_REPO,
    issueNumber: config.GITHUB_ISSUE_NUMBER,
    projectNumber: config.GITHUB_PROJECT_NUMBER,
    expectedStatus: config.GITHUB_RFQA_STATUS_VALUE,
    allowLabelFallback: config.GITHUB_RFQA_FALLBACK_LABEL
  });

  console.info(
    `[INFO] Retrieving issue #${config.GITHUB_ISSUE_NUMBER}...`
  );

  const result = await reader.readIssue();

  console.info('\n========== GITHUB ISSUE ==========');
  console.info(`Issue Number : #${result.issue.number}`);
  console.info(`Title        : ${result.issue.title}`);
  console.info(`State        : ${result.issue.state}`);
  console.info(`URL          : ${result.issue.html_url}`);

  console.info('\n========== PROJECT STATUS ==========');
  console.info(`Project      : ${result.project.projectTitle ?? 'Fallback label'}`);
  console.info(`Status       : ${result.project.status}`);
  console.info(`Source       : ${result.project.source}`);

  if (result.project.warning) {
    console.warn(`[WARNING] ${result.project.warning}`);
  }

  console.info('\n========== ACCEPTANCE CRITERIA ==========');
  console.info(`Total criteria: ${result.acceptanceCriteria.length}`);

  for (const criterion of result.acceptanceCriteria) {
    console.info(`\n${criterion.id}: ${criterion.title}`);
    console.info(criterion.description);
  }

  console.info('\n========== ELIGIBILITY ==========');
  console.info(
    `[SUCCESS] Issue #${result.issue.number} is eligible for testing.`
  );

  console.info(
    `[SUCCESS] Verified status: ${result.project.status}`
  );

  console.info(
    '[SUCCESS] Acceptance criteria extracted successfully.'
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : 'Unknown GitHub Issue Reader error';

  console.error('\n[ERROR] GitHub Issue Reader failed.');
  console.error(message);

  process.exitCode = 1;
});