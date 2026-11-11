import type { ExecutionEvent } from './scenario-runner.js';

/**
 * One log entry must stay on one line, so line breaks and runs of
 * spaces inside values are collapsed.
 */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

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

      const found = result.resolution
        ? ` -> ${oneLine(result.resolution.element)} ` +
          `(${METHOD_TEXT[result.resolution.method]}` +
          `${result.resolution.cached ? ', answer reused' : ''})`
        : '';

      const captured = result.captured
        ? ` captured ${result.captured.key}=${quote(result.captured.value)}`
        : '';

      const outcome =
        result.status === 'passed'
          ? 'PASSED'
          : `FAILED: ${oneLine(result.error ?? 'unknown error')}`;

      return (
        `${stamp} [${event.scenarioId}] [${result.stepId}] ` +
        `${event.action} ${quote(event.targetDescription)}${found}` +
        `${captured} ${outcome} ${result.durationMs} ms`
      );
    }

    case 'assertion_finished': {
      const { result } = event;

      const detail =
        result.status === 'error'
          ? `ERROR: ${oneLine(result.error ?? 'could not be checked')}`
          : `expected=${quote(result.expected)} ` +
            `actual=${quote(result.actual)} ` +
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
