import { collapseWhitespace as oneLine, shorten } from '../util/text.js';

import type { ExecutionEvent } from './scenario-runner.js';

// One log entry must stay on one line, so line breaks and runs of
// spaces inside values are collapsed (oneLine).

function quote(value: string): string {
  return `"${oneLine(value)}"`;
}

const METHOD_TEXT = {
  deterministic: 'matched by plan fields',
  llm: 'chosen by LLM'
} as const;

/**
 * Turns one event into a single readable log line, such as:
 *
 * 2026-11-11T05:00:01.123Z [SC-001] [STEP-02] fill "Username field" ->
 * textbox "Username" (matched by plan fields) PASSED 120 ms
 *
 * Values typed into fields are never part of an event, so they cannot
 * reach the log.
 */
export function formatLogEvent(
  event: ExecutionEvent,
  at: Date = new Date()
): string {
  const stamp = at.toISOString();

  switch (event.type) {
    case 'scenario_started':
      return `${stamp} [${event.scenarioId}] SCENARIO START ${quote(event.title)}`;

    case 'step_finished': {
      const { result } = event;

      // For an LLM choice, the log shows the LLM's own reason, which
      // is the closest thing to its thought process.
      const why =
        result.resolution?.method === 'llm' && result.resolution.reason
          ? `: ${quote(shorten(result.resolution.reason, 140))}`
          : '';

      const found = result.resolution
        ? ` -> ${oneLine(result.resolution.element)} ` +
          `(${METHOD_TEXT[result.resolution.method]}` +
          `${result.resolution.cached ? ', answer reused' : ''}${why})`
        : '';

      const captured = result.captured
        ? ` captured ${result.captured.key}=${quote(result.captured.value)}`
        : '';

      const outcome =
        result.status === 'passed'
          ? 'PASSED'
          : `FAILED: ${oneLine(result.error ?? 'unknown error')}`;

      // A step that was repaired says what went wrong and what was done.
      const healed = result.healed
        ? ` [SELF-HEAL: ${quote(shorten(result.healed.problem, 120))} ` +
          `-> ${oneLine(result.healed.repair)}: ` +
          `${quote(shorten(result.healed.reason, 120))}]`
        : '';

      return (
        `${stamp} [${event.scenarioId}] [${result.stepId}] ` +
        `${event.action} ${quote(event.targetDescription)}${found}` +
        `${captured}${healed} ${outcome} ${result.durationMs} ms`
      );
    }

    case 'assertion_finished': {
      const { result } = event;

      // The elements the lookup found, so a wrong match is visible.
      const found =
        result.matched && result.matched.length > 0
          ? ` matched=[${result.matched
              .slice(0, 3)
              .map(oneLine)
              .join('; ')}${result.matched.length > 3 ? '; ...' : ''}]`
          : '';

      const detail =
        result.status === 'error'
          ? `ERROR: ${oneLine(result.error ?? 'could not be checked')}`
          : `expected=${quote(result.expected)} ` +
            `actual=${quote(result.actual)}${found} ` +
            result.status.toUpperCase();

      return (
        `${stamp} [${event.scenarioId}] [${result.assertionId}] ` +
        `${result.acceptanceCriterionId} ${result.type} ` +
        `after ${result.afterStepId} ${detail}`
      );
    }

    case 'screenshot_saved':
      return (
        `${stamp} [${event.scenarioId}] [${event.stepId}] ` +
        `SCREENSHOT ${event.reason} ${event.path}`
      );

    case 'page_observed': {
      const { context } = event;

      const notes =
        context.notes.length > 0
          ? context.notes.map(note => quote(note)).join('; ')
          : 'no alerts or error messages';

      return (
        `${stamp} [${event.scenarioId}] [${context.stepId}] PAGE ` +
        `url=${context.url} messages: ${notes}`
      );
    }

    case 'scenario_finished':
      return (
        `${stamp} [${event.scenarioId}] SCENARIO END ` +
        `${event.status.toUpperCase()} ${event.durationMs} ms` +
        (event.error ? ` ${oneLine(event.error)}` : '')
      );

    default: {
      const unsupported: never = event;

      return `${stamp} UNKNOWN EVENT ${JSON.stringify(unsupported)}`;
    }
  }
}
