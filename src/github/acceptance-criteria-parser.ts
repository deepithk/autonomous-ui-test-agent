export interface AcceptanceCriterion {
  id: string;
  title: string;
  description: string;
}

interface PendingCriterion {
  id: string;
  title: string;
  descriptionLines: string[];
}

const CRITERION_HEADING_REGEX =
  /^###\s+(AC-\d+)\s*:\s*(.+?)\s*$/i;

const MARKDOWN_HEADING_REGEX = /^#{1,6}\s+/;

/**
 * Extracts acceptance criteria from GitHub issue Markdown.
 *
 * Expected heading format:
 * ### AC-01: Successful Login
 *
 * All acceptance criteria are extracted deterministically.
 * No LLM is involved in this process.
 */
export function parseAcceptanceCriteria(
  markdown: string | null | undefined
): AcceptanceCriterion[] {
  if (!markdown?.trim()) {
    throw new Error(
      'GitHub issue description is empty. Cannot extract acceptance criteria.'
    );
  }

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  const criteria: AcceptanceCriterion[] = [];
  const seenIds = new Set<string>();

  let current: PendingCriterion | null = null;

  function finishCurrent(): void {
    if (!current) {
      return;
    }

    const description =
      current.descriptionLines.join('\n').trim();

    if (!description) {
      throw new Error(
        `Acceptance criterion ${current.id} has no description.`
      );
    }

    if (seenIds.has(current.id)) {
      throw new Error(
        `Duplicate acceptance criterion ID found: ${current.id}.`
      );
    }

    seenIds.add(current.id);

    criteria.push({
      id: current.id,
      title: current.title,
      description
    });

    current = null;
  }

  for (const line of lines) {
    const headingMatch = line.match(
      CRITERION_HEADING_REGEX
    );

    
    if (headingMatch) {
    finishCurrent();

    const criterionId = headingMatch[1];
    const criterionTitle = headingMatch[2];

    if (!criterionId || !criterionTitle) {
        throw new Error(
        `Invalid acceptance criterion heading: "${line.trim()}".`
        );
    }

    current = {
        id: criterionId.toUpperCase(),
        title: criterionTitle.trim(),
        descriptionLines: []
    };

    continue;
    }

    // Reject malformed AC headings instead of silently ignoring them.
    if (/^###\s+AC-/i.test(line)) {
      throw new Error(
        `Invalid acceptance criterion heading: "${line.trim()}". ` +
        'Expected format: ### AC-01: Criterion title.'
      );
    }

    // A different Markdown heading ends the current criterion.
    if (current && MARKDOWN_HEADING_REGEX.test(line)) {
      finishCurrent();
      continue;
    }

    if (current) {
      current.descriptionLines.push(line);
    }
  }

  finishCurrent();

  if (criteria.length === 0) {
    throw new Error(
      'No acceptance criteria found. Expected headings such as ### AC-01: Login.'
    );
  }

  return criteria;
}