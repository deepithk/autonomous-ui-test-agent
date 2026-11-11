import type { McpContentBlock } from './browser-session.js';

/**
 * One element from a Playwright MCP accessibility snapshot.
 */
export interface SnapshotElement {
  ref: string | null;
  role: string;
  name: string;
  text: string;
  depth: number;
  attributes: string[];
}

const LINE_PATTERN =
  /^(\s*)- ([A-Za-z]+)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]+\])*)(?::(?: (.*))?)?$/;

const REF_PATTERN = /^ref=(.+)$/;

/**
 * Extracts the YAML snapshot from browser_snapshot output.
 */
export function extractSnapshotYaml(
  content: McpContentBlock[]
): string {
  const text = content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('\n');

  const match = /```yaml\n([\s\S]*?)```/.exec(text);

  return match?.[1]?.trimEnd() ?? '';
}

/**
 * Reads the "Page URL" line that Playwright MCP prints above a snapshot.
 */
export function extractPageUrl(content: McpContentBlock[]): string {
  const text = content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('\n');

  return /^- Page URL: (\S+)\s*$/m.exec(text)?.[1] ?? '';
}

function unquote(value: string): string {
  const trimmed = value.trim();

  if (
    trimmed.length >= 2 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"')
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }

  return trimmed;
}

/**
 * Parses snapshot YAML into a flat, ordered element list.
 * Lines that are not elements are ignored.
 */
export function parseSnapshot(yaml: string): SnapshotElement[] {
  const elements: SnapshotElement[] = [];

  for (const line of yaml.split(/\r?\n/)) {
    const match = LINE_PATTERN.exec(line);

    if (!match) {
      continue;
    }

    const attributes = [
      ...(match[4] ?? '').matchAll(/\[([^\]]+)\]/g)
    ].map(entry => entry[1] ?? '');

    const ref =
      attributes
        .map(attribute => REF_PATTERN.exec(attribute)?.[1])
        .find(value => value !== undefined) ?? null;

    elements.push({
      ref,
      role: match[2] ?? '',
      name: (match[3] ?? '').replace(/\\"/g, '"'),
      text: unquote(match[5] ?? ''),
      depth: Math.floor((match[1] ?? '').length / 2),
      attributes: attributes.filter(
        attribute => !REF_PATTERN.test(attribute)
      )
    });
  }

  return elements;
}

const ALERT_ROLES = new Set(['alert', 'alertdialog', 'status']);

const MESSAGE_ROLES = new Set([
  'heading',
  'generic',
  'text',
  'paragraph'
]);

const PROBLEM_WORDS =
  /error|sorry|invalid|denied|locked|failed|not found|unavailable|sadface/i;

/**
 * Alerts and error-like messages shown on the page, such as a failed
 * login message. Used to explain a failure without opening the browser.
 * At most maxNotes short notes are returned, without duplicates.
 */
export function findPageNotes(
  elements: SnapshotElement[],
  maxNotes = 3
): string[] {
  const notes: string[] = [];

  for (const element of elements) {
    const text = (element.text || element.name).replace(/\s+/g, ' ').trim();

    if (text === '') {
      continue;
    }

    const isAlert = ALERT_ROLES.has(element.role);

    // A message is a sentence. Text without a space, such as a list of
    // user names run together, only happens to contain a problem word.
    const looksLikeProblem =
      MESSAGE_ROLES.has(element.role) &&
      /\s/.test(text) &&
      PROBLEM_WORDS.test(text);

    if (!isAlert && !looksLikeProblem) {
      continue;
    }

    const note = text.length > 160 ? `${text.slice(0, 160)}...` : text;

    if (!notes.includes(note)) {
      notes.push(note);
    }

    if (notes.length >= maxNotes) {
      break;
    }
  }

  return notes;
}

/**
 * The value of a form field. A dropdown's value is the option it shows;
 * any other field's value is the text the snapshot gives it.
 */
export function getFieldValue(
  elements: SnapshotElement[],
  index: number
): string {
  const element = elements[index];

  if (element?.role === 'combobox' || element?.role === 'listbox') {
    return getElementText(elements, index);
  }

  return element?.text ?? '';
}

/**
 * The text of each node inside an element: its own text, or its name when
 * it has none. Used to tell whether a value is displayed as a node of its
 * own inside a container, such as a product name inside a product card.
 */
export function getDescendantTexts(
  elements: SnapshotElement[],
  index: number
): string[] {
  const element = elements[index];

  if (!element) {
    return [];
  }

  const texts: string[] = [];

  for (let next = index + 1; next < elements.length; next++) {
    const candidate = elements[next];

    if (!candidate || candidate.depth <= element.depth) {
      break;
    }

    const text = candidate.text || candidate.name;

    if (text) {
      texts.push(text);
    }
  }

  return texts;
}

/**
 * Text shown by an element: its own text, otherwise the text of
 * its descendants, otherwise its accessible name.
 */
export function getElementText(
  elements: SnapshotElement[],
  index: number
): string {
  const element = elements[index];

  if (!element) {
    return '';
  }

  if (element.text) {
    return element.text;
  }

  // A dropdown shows its selected option. Its own name is only a label
  // such as "Sort products", which is not what the page displays.
  if (element.role === 'combobox' || element.role === 'listbox') {
    for (let next = index + 1; next < elements.length; next++) {
      const candidate = elements[next];

      if (!candidate || candidate.depth <= element.depth) {
        break;
      }

      if (
        candidate.role === 'option' &&
        candidate.attributes.includes('selected')
      ) {
        return candidate.name;
      }
    }
  }

  const descendants: string[] = [];

  for (let next = index + 1; next < elements.length; next++) {
    const candidate = elements[next];

    if (!candidate || candidate.depth <= element.depth) {
      break;
    }

    if (candidate.text) {
      descendants.push(candidate.text);
    }
  }

  if (descendants.length > 0) {
    return descendants.join(' ');
  }

  return element.name;
}
