import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseAcceptanceCriteria } from './acceptance-criteria-parser.js';

import type { IssueReadResult } from './issue-reader.js';

export class LocalIssueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalIssueError';
  }
}

export interface LocalIssueOptions {
  /**
   * The board status the planning workflow expects. A local file has
   * no board, so the issue is treated as being in this status.
   */
  status: string;
}

/**
 * Reads an issue from a Markdown file instead of GitHub, so the agent
 * can be tried without a GitHub token, repository or project board.
 *
 * The file has the same layout as a GitHub issue:
 *
 *   # Issue title
 *   ...description...
 *   ### AC-01: First criterion
 *   Given ... When ... Then ...
 *
 * The first "# " heading is the title. The issue number is taken from
 * the first number in the file name (issue-1.md gives 1), or is 1.
 * Acceptance criteria are parsed by the same code as for GitHub.
 */
export async function readLocalIssue(
  filePath: string,
  options: LocalIssueOptions
): Promise<IssueReadResult> {
  let markdown: string;

  try {
    markdown = await readFile(filePath, 'utf8');
  } catch {
    throw new LocalIssueError(
      `Cannot read the issue file "${filePath}". ` +
      'Check that the path is correct.'
    );
  }

  const name = path.basename(filePath);

  const titleLine = markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .find(line => /^#\s+\S/.test(line));

  const title = titleLine
    ? titleLine.replace(/^#\s+/, '').trim()
    : name;

  const number = Number(/\d+/.exec(name)?.[0] ?? 1);

  // Throws a clear error when the file has no valid criteria.
  const acceptanceCriteria = parseAcceptanceCriteria(markdown);

  return {
    issue: {
      id: number,
      number,
      title,
      body: markdown,
      state: 'open',
      html_url: filePath.replace(/\\/g, '/'),
      labels: []
    },
    acceptanceCriteria,
    project: {
      projectTitle: null,
      status: options.status,
      source: 'local-file',
      warning:
        'The issue was read from a local file. No GitHub project ' +
        'status was checked.'
    }
  };
}
