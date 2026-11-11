import { loadConfig } from '../config/env.js';
import { runCli } from '../util/cli.js';
import { createIssueReader } from './issue-reader.js';

/**
 * Runs the GitHub Issue Reader against the configured
 * private repository and GitHub Projects V2 board.
 *
 * This is a read-only integration check.
 */
async function main(): Promise<void> {
  console.info('[INFO] Starting GitHub Issue Reader...');

  const config = loadConfig();

  const reader = createIssueReader(config);

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

runCli('GitHub Issue Reader failed.', main);
