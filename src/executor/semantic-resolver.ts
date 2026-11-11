import { createHash } from 'node:crypto';

import type {
  BrowserAction,
  SemanticTarget
} from '../planner/test-plan-schema.js';

import type {
  ILLMProvider
} from '../planner/providers/llm-provider.js';

import {
  describeElement,
  findByFields,
  narrowByAction
} from './element-matching.js';

import {
  ALL_RESPONSE_SCHEMA,
  ALL_SYSTEM_INSTRUCTION,
  BATCH_RESPONSE_SCHEMA,
  BATCH_SYSTEM_INSTRUCTION,
  HEAL_SYSTEM_INSTRUCTION,
  ONE_RESPONSE_SCHEMA,
  ONE_SYSTEM_INSTRUCTION
} from './resolver-prompts.js';

import type { SnapshotElement } from './snapshot.js';

export interface ResolvedTarget {
  /** Snapshot ref to pass to Playwright MCP tools. */
  ref: string;

  /** Human-readable element description for tool calls and logs. */
  element: string;

  /** Index of the element in the parsed snapshot. */
  index: number;

  method: 'deterministic' | 'llm';

  reason: string;

  /** True when an earlier answer for the same page and question was reused. */
  cached?: boolean;
}

/**
 * How many LLM requests the resolver made, and how many answers it
 * reused instead.
 */
export interface LlmUsage {
  requests: number;
  reused: number;
}

/**
 * What a step was trying to do and why its target could not be used,
 * given to the LLM when self-healing.
 */
export interface HealRequest {
  target: SemanticTarget;
  action: BrowserAction;
  instruction: string;
  expectedObservation: string;

  /** What went wrong, for example "No element matched ...". */
  problem: string;
}

export interface LookupOptions {
  /**
   * Ask the LLM again even if it already answered for this page and
   * question. Used when re-checking a failed assertion, so that one
   * wrong answer is not repeated.
   */
  fresh?: boolean;
}

export class SemanticResolverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SemanticResolverError';
  }
}

export interface SemanticResolverOptions {
  maxOutputTokens?: number;
  temperature?: number;
}

/**
 * Reads the JSON an LLM answered with. Anything else is an error that
 * says what the agent was doing at the time.
 */
function parseLlmJson<T>(text: string, whileDoing: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SemanticResolverError(
      `The LLM returned invalid JSON while ${whileDoing}.`
    );
  }
}

/**
 * Resolves a semantic plan target to a ref in the live snapshot.
 *
 * Exactly one deterministic match is used directly. Otherwise the
 * LLM chooses, and its answer is only accepted when the ref really
 * exists in the snapshot.
 */
export class SemanticResolver {
  private readonly maxOutputTokens: number;
  private readonly temperature: number;

  /**
   * Answers the LLM already gave. The key contains the question and
   * the full page snapshot, so an answer is only reused for exactly
   * the same page and the same question, and it was already checked
   * against that page when it was first given.
   */
  private readonly cache = new Map<
    string,
    ResolvedTarget | ResolvedTarget[]
  >();

  private requests = 0;
  private reused = 0;

  constructor(
    private readonly llm: ILLMProvider | null,
    options: SemanticResolverOptions = {}
  ) {
    this.maxOutputTokens = options.maxOutputTokens ?? 512;
    this.temperature = options.temperature ?? 0;
  }

  getUsage(): LlmUsage {
    return { requests: this.requests, reused: this.reused };
  }

  private cacheKey(
    kind: 'one' | 'all',
    target: SemanticTarget,
    action: string,
    snapshotYaml: string
  ): string {
    return createHash('sha256')
      .update(JSON.stringify([kind, target, action, snapshotYaml]))
      .digest('hex');
  }

  /**
   * Turns refs given by the LLM into resolved elements, rejecting any
   * ref that is not in the snapshot.
   */
  private toResolved(
    refs: string[],
    reason: string,
    elements: SnapshotElement[],
    description: string
  ): ResolvedTarget[] {
    const resolved: ResolvedTarget[] = [];

    for (const ref of new Set(refs)) {
      const index = elements.findIndex(
        element => element.ref === ref
      );

      if (index === -1) {
        throw new SemanticResolverError(
          `The LLM chose ref "${ref}" for "${description}", ` +
          'but that ref is not in the snapshot.'
        );
      }

      resolved.push({
        ref,
        element: describeElement(elements[index] as SnapshotElement),
        index,
        method: 'llm',
        reason
      });
    }

    return resolved;
  }

  async resolve(
    target: SemanticTarget,
    action: BrowserAction,
    elements: SnapshotElement[],
    snapshotYaml: string,
    options: LookupOptions = {}
  ): Promise<ResolvedTarget> {
    const matches = narrowByAction(
      action,
      elements,
      findByFields(target, elements)
    );

    if (matches.length === 1) {
      const index = matches[0] as number;
      const element = elements[index] as SnapshotElement;

      return {
        ref: element.ref as string,
        element: describeElement(element),
        index,
        method: 'deterministic',
        reason: 'Exactly one element matched the plan fields.'
      };
    }

    if (this.llm === null) {
      throw new SemanticResolverError(
        matches.length === 0
          ? `No element matched "${target.description}" and no LLM is configured.`
          : `${matches.length} elements matched "${target.description}" ` +
            'and no LLM is configured to choose between them.'
      );
    }

    const key = this.cacheKey('one', target, action, snapshotYaml);

    const known = options.fresh
      ? undefined
      : (this.cache.get(key) as ResolvedTarget | undefined);

    if (known) {
      this.reused++;

      return { ...known, cached: true };
    }

    const resolved = await this.resolveWithLlm(
      target,
      action,
      elements,
      snapshotYaml
    );

    this.cache.set(key, resolved);

    return resolved;
  }

  /**
   * Finds every element that matches the target, possibly none.
   * Used to count elements and to check that something is absent.
   *
   * With an LLM, the model decides from the description, because the
   * description often narrows more than the plan fields do. Without
   * one, only the plan fields are used.
   */
  async resolveAll(
    target: SemanticTarget,
    elements: SnapshotElement[],
    snapshotYaml: string,
    options: LookupOptions = {}
  ): Promise<ResolvedTarget[]> {
    if (this.llm === null) {
      return findByFields(target, elements).map(index => {
        const element = elements[index] as SnapshotElement;

        return {
          ref: element.ref as string,
          element: describeElement(element),
          index,
          method: 'deterministic' as const,
          reason: 'Matched the plan fields.'
        };
      });
    }

    const key = this.cacheKey('all', target, '', snapshotYaml);

    const known = options.fresh
      ? undefined
      : (this.cache.get(key) as ResolvedTarget[] | undefined);

    if (known) {
      this.reused++;

      return known.map(entry => ({ ...entry, cached: true }));
    }

    this.requests++;

    const result = await this.llm.generateStructured({
      systemInstruction: ALL_SYSTEM_INSTRUCTION,
      prompt: [
        'Target element:',
        JSON.stringify(target, null, 2),
        '',
        'Accessibility snapshot:',
        snapshotYaml
      ].join('\n'),
      responseSchema: ALL_RESPONSE_SCHEMA,
      maxOutputTokens: this.maxOutputTokens,
      temperature: this.temperature
    });

    const parsed = parseLlmJson<{ refs?: unknown; reason?: unknown }>(
      result.text,
      `searching for "${target.description}"`
    );

    if (
      !Array.isArray(parsed.refs) ||
      !parsed.refs.every(ref => typeof ref === 'string')
    ) {
      throw new SemanticResolverError(
        `The LLM response for "${target.description}" has no refs list.`
      );
    }

    const reason =
      typeof parsed.reason === 'string' ? parsed.reason : '';

    const resolved = this.toResolved(
      parsed.refs as string[],
      reason,
      elements,
      target.description
    );

    this.cache.set(key, resolved);

    return resolved;
  }

  /**
   * Like resolveAll for several targets on the same page, but the
   * targets that are not already known are sent in one LLM request.
   *
   * Every target must be answered. A missing answer is an error,
   * never an empty result, because "nothing found" can mean a pass.
   */
  async resolveMany(
    targets: SemanticTarget[],
    elements: SnapshotElement[],
    snapshotYaml: string,
    options: LookupOptions = {}
  ): Promise<ResolvedTarget[][]> {
    if (this.llm === null) {
      return Promise.all(
        targets.map(target =>
          this.resolveAll(target, elements, snapshotYaml)
        )
      );
    }

    const answers: Array<ResolvedTarget[] | undefined> = targets.map(
      target => {
        // A fresh lookup ignores earlier answers, so the LLM is asked
        // again about everything.
        const known = options.fresh
          ? undefined
          : (this.cache.get(
              this.cacheKey('all', target, '', snapshotYaml)
            ) as ResolvedTarget[] | undefined);

        if (known) {
          this.reused++;

          return known.map(entry => ({ ...entry, cached: true }));
        }

        return undefined;
      }
    );

    const missing = answers.flatMap((answer, index) =>
      answer === undefined ? [index] : []
    );

    if (missing.length === 1) {
      const index = missing[0] as number;

      answers[index] = await this.resolveAll(
        targets[index] as SemanticTarget,
        elements,
        snapshotYaml,
        options
      );
    } else if (missing.length > 1) {
      const asked = missing.map(index => targets[index] as SemanticTarget);

      this.requests++;

      const result = await this.llm.generateStructured({
        systemInstruction: BATCH_SYSTEM_INSTRUCTION,
        prompt: [
          'Targets:',
          ...asked.map(
            (target, position) =>
              `T${position + 1}: ${JSON.stringify(target)}`
          ),
          '',
          'Accessibility snapshot:',
          snapshotYaml
        ].join('\n'),
        responseSchema: BATCH_RESPONSE_SCHEMA,
        maxOutputTokens: Math.max(
          this.maxOutputTokens,
          asked.length * 256
        ),
        temperature: this.temperature
      });

      const parsed = parseLlmJson<{ results?: unknown }>(
        result.text,
        'searching for several targets'
      );

      if (!Array.isArray(parsed.results)) {
        throw new SemanticResolverError(
          'The LLM response for several targets has no results list.'
        );
      }

      const byId = new Map<
        string,
        { refs: string[]; reason: string }
      >();

      for (const entry of parsed.results as Array<{
        id?: unknown;
        refs?: unknown;
        reason?: unknown;
      }>) {
        if (
          typeof entry?.id === 'string' &&
          Array.isArray(entry.refs) &&
          entry.refs.every(ref => typeof ref === 'string') &&
          !byId.has(entry.id)
        ) {
          byId.set(entry.id, {
            refs: entry.refs as string[],
            reason: typeof entry.reason === 'string' ? entry.reason : ''
          });
        }
      }

      missing.forEach((index, position) => {
        const target = targets[index] as SemanticTarget;

        const answer = byId.get(`T${position + 1}`);

        if (!answer) {
          throw new SemanticResolverError(
            `The LLM did not answer for "${target.description}".`
          );
        }

        const resolved = this.toResolved(
          answer.refs,
          answer.reason,
          elements,
          target.description
        );

        this.cache.set(
          this.cacheKey('all', target, '', snapshotYaml),
          resolved
        );

        answers[index] = resolved;
      });
    }

    return answers as ResolvedTarget[][];
  }

  /**
   * Self-healing: a step could not use its planned target. Asks the LLM
   * whether a different element on the current page serves the same
   * purpose, and accepts the answer only if that element is really in
   * the snapshot. The answer is never cached, because it depends on the
   * failure it was given.
   *
   * Throws SemanticResolverError when there is no suitable element.
   */
  async heal(
    request: HealRequest,
    elements: SnapshotElement[],
    snapshotYaml: string
  ): Promise<ResolvedTarget> {
    const description = request.target.description;

    if (this.llm === null) {
      throw new SemanticResolverError(
        `Self-healing for "${description}" needs an LLM, and none is configured.`
      );
    }

    this.requests++;

    const result = await this.llm.generateStructured({
      systemInstruction: HEAL_SYSTEM_INSTRUCTION,
      prompt: [
        'A test step could not use its planned target.',
        `Step: ${request.action}: ${request.instruction}`,
        `Expected result of the step: ${request.expectedObservation}`,
        '',
        'Planned target:',
        JSON.stringify(request.target, null, 2),
        '',
        `Problem: ${request.problem}`,
        '',
        'Accessibility snapshot of the current page:',
        snapshotYaml
      ].join('\n'),
      responseSchema: ONE_RESPONSE_SCHEMA,
      maxOutputTokens: this.maxOutputTokens,
      temperature: this.temperature
    });

    const parsed = parseLlmJson<{ ref?: unknown; reason?: unknown }>(
      result.text,
      `healing "${description}"`
    );

    const ref = typeof parsed.ref === 'string' ? parsed.ref.trim() : '';

    const reason = typeof parsed.reason === 'string' ? parsed.reason : '';

    if (ref === '') {
      throw new SemanticResolverError(
        `No alternative element found for "${description}": ` +
        (reason || 'no reason given')
      );
    }

    const [resolved] = this.toResolved(
      [ref],
      reason,
      elements,
      description
    );

    return resolved as ResolvedTarget;
  }

  private async resolveWithLlm(
    target: SemanticTarget,
    action: BrowserAction,
    elements: SnapshotElement[],
    snapshotYaml: string
  ): Promise<ResolvedTarget> {
    const llm = this.llm as ILLMProvider;

    const prompt = [
      `Action to perform: ${action}`,
      '',
      'Target element:',
      JSON.stringify(target, null, 2),
      '',
      'Accessibility snapshot:',
      snapshotYaml
    ].join('\n');

    this.requests++;

    const result = await llm.generateStructured({
      systemInstruction: ONE_SYSTEM_INSTRUCTION,
      prompt,
      responseSchema: ONE_RESPONSE_SCHEMA,
      maxOutputTokens: this.maxOutputTokens,
      temperature: this.temperature
    });

    const parsed = parseLlmJson<unknown>(
      result.text,
      `resolving "${target.description}"`
    );

    const ref =
      typeof (parsed as { ref?: unknown }).ref === 'string'
        ? (parsed as { ref: string }).ref.trim()
        : '';

    const reason =
      typeof (parsed as { reason?: unknown }).reason === 'string'
        ? (parsed as { reason: string }).reason
        : '';

    if (ref === '') {
      throw new SemanticResolverError(
        `No element matched "${target.description}": ${reason || 'no reason given'}`
      );
    }

    const index = elements.findIndex(element => element.ref === ref);

    if (index === -1) {
      throw new SemanticResolverError(
        `The LLM chose ref "${ref}" for "${target.description}", ` +
        'but that ref is not in the snapshot.'
      );
    }

    return {
      ref,
      element: describeElement(elements[index] as SnapshotElement),
      index,
      method: 'llm',
      reason
    };
  }
}
