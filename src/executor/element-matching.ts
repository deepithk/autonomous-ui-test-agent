import type {
  BrowserAction,
  SemanticTarget
} from '../planner/test-plan-schema.js';

import { shorten } from '../util/text.js';

import type { SnapshotElement } from './snapshot.js';

function sameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Elements that satisfy every semantic field the plan provided.
 * Returns an empty list when the plan gave no usable fields.
 */
export function findByFields(
  target: SemanticTarget,
  elements: SnapshotElement[]
): number[] {
  const hasFields =
    target.role !== null ||
    target.accessibleName !== null ||
    target.visibleText !== null ||
    target.label !== null;

  if (!hasFields) {
    return [];
  }

  const matches: number[] = [];

  elements.forEach((element, index) => {
    if (element.ref === null) {
      return;
    }

    if (target.role !== null && !sameText(element.role, target.role)) {
      return;
    }

    if (
      target.accessibleName !== null &&
      !sameText(element.name, target.accessibleName)
    ) {
      return;
    }

    if (
      target.label !== null &&
      !sameText(element.name, target.label)
    ) {
      return;
    }

    if (
      target.visibleText !== null &&
      !sameText(element.name, target.visibleText) &&
      !sameText(element.text, target.visibleText)
    ) {
      return;
    }

    matches.push(index);
  });

  return matches;
}

/**
 * Roles that can receive each action. Used to break ties when the
 * plan fields match several elements, e.g. a form and a button that
 * are both named "Login".
 */
const ACTIONABLE_ROLES: Partial<
  Record<BrowserAction, ReadonlySet<string>>
> = {
  click: new Set([
    'button',
    'link',
    'checkbox',
    'radio',
    'switch',
    'tab',
    'menuitem',
    'option',
    'combobox'
  ]),
  fill: new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']),
  type: new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']),
  select_option: new Set(['combobox', 'listbox'])
};

/**
 * When several elements match, keep only those that can perform the
 * action. If none can, the original matches are returned unchanged.
 */
export function narrowByAction(
  action: BrowserAction,
  elements: SnapshotElement[],
  matches: number[]
): number[] {
  const roles = ACTIONABLE_ROLES[action];

  if (matches.length < 2 || roles === undefined) {
    return matches;
  }

  const narrowed = matches.filter(index =>
    roles.has((elements[index] as SnapshotElement).role)
  );

  return narrowed.length > 0 ? narrowed : matches;
}

/**
 * A short description of an element for tool calls and logs. Elements
 * without a name, such as a price, are described by the text they show.
 */
export function describeElement(element: SnapshotElement): string {
  if (element.name) {
    return `${element.role} "${element.name}"`;
  }

  const text = shorten(element.text, 60);

  return text ? `${element.role} "${text}"` : element.role;
}
