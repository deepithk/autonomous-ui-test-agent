import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LocalIssueError,
  readLocalIssue
} from '../../src/github/local-issue.js';

const ISSUE = `# Feature: Cart

## Acceptance Criteria

### AC-01: Login

Given the login page,
Then the inventory page is shown.

### AC-02: Add

Given the inventory page,
Then the product is added.
`;

describe('readLocalIssue', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'local-issue-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function write(name: string, content: string): Promise<string> {
    const file = path.join(directory, name);

    await writeFile(file, content, 'utf8');

    return file;
  }

  it('reads title, number and acceptance criteria from the file', async () => {
    const file = await write('issue-7.md', ISSUE);

    const result = await readLocalIssue(file, { status: 'RFQA' });

    expect(result.issue.title).toBe('Feature: Cart');
    expect(result.issue.number).toBe(7);
    expect(result.issue.state).toBe('open');

    expect(result.acceptanceCriteria.map(item => item.id)).toEqual([
      'AC-01',
      'AC-02'
    ]);
  });

  it('treats the issue as being in the expected status and says so', async () => {
    const file = await write('issue-1.md', ISSUE);

    const result = await readLocalIssue(file, { status: 'RFQA' });

    expect(result.project).toMatchObject({
      status: 'RFQA',
      source: 'local-file',
      projectTitle: null
    });

    expect(result.project.warning).toMatch(/local file/);
  });

  it('uses issue number 1 when the file name has no number', async () => {
    const file = await write('feature.md', ISSUE);

    const result = await readLocalIssue(file, { status: 'RFQA' });

    expect(result.issue.number).toBe(1);
  });

  it('falls back to the file name when there is no title heading', async () => {
    const file = await write(
      'cart-issue.md',
      ISSUE.replace('# Feature: Cart\n', '')
    );

    const result = await readLocalIssue(file, { status: 'RFQA' });

    expect(result.issue.title).toBe('cart-issue.md');
  });

  it('explains a missing file', async () => {
    await expect(
      readLocalIssue(path.join(directory, 'nope.md'), { status: 'RFQA' })
    ).rejects.toBeInstanceOf(LocalIssueError);
  });

  it('rejects a file without acceptance criteria', async () => {
    const file = await write('issue-2.md', '# Title\n\nNo criteria here.\n');

    await expect(
      readLocalIssue(file, { status: 'RFQA' })
    ).rejects.toThrow(/No acceptance criteria found/);
  });

  it('parses the committed example issue', async () => {
    const result = await readLocalIssue(
      path.resolve('fixtures', 'issue-1.md'),
      { status: 'RFQA' }
    );

    expect(result.acceptanceCriteria).toHaveLength(6);
    expect(result.issue.title).toBe(
      'Feature: Add and Remove Products from Shopping Cart'
    );
  });
});
