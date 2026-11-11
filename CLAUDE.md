# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What this is

An autonomous UI test agent. It reads a GitHub issue's acceptance criteria (AC), has an LLM plan test scenarios, drives a browser through Playwright MCP against SauceDemo, decides pass or fail **in code**, and writes a report, a log and screenshots to `evidence/`. TypeScript, Node 20 or newer, ESM, vitest.

Design documents: `TEST_PLAN.md` (architecture, prompt strategy, guardrails), `SCENARIOS.md` (criteria and scenarios), `README.md` (setup and usage).

## Commands

```bash
npm ci
npm run build          # tsc
npm run typecheck
npm run test:unit      # vitest, no network, no LLM
npm run check:config   # free: no LLM, GitHub or browser calls  (-- --github to check GitHub too)
npm run read:issue     # read an issue (GitHub, or a local fixture)
npm run plan:issue     # LLM: issue -> evidence/reports/test-plan-*.json
npm run execute:plan   # run a saved plan in a headless browser (--plan <file>, --label <name>)
```

Copy `.env.example` to `.env` first. Key settings: `LLM_PROVIDER` (gemini or anthropic), `LLM_MODEL`, `LLM_API_KEY`, `SELF_HEALING`, `ACTION_TIMEOUT_MS`, `SCENARIO_TIMEOUT_MS`. Without `GITHUB_TOKEN` the agent reads `fixtures/issue-1.md`.

`plan:issue` and `execute:plan` make real LLM requests that cost quota. Run `test:unit` and `check:config` freely; ask before running the other two.

## Architecture

Pipeline: **issue reader -> planner -> executor -> report**.

- `src/github/`: reads the issue and parses the acceptance criteria. `local-issue.ts` is the no-token fallback.
- `src/planner/`: `test-planner.ts` and `planner-prompt.ts` ask the LLM for a plan, validated by the zod schema in `test-plan-schema.ts`. `criteria-coverage.ts` finds criteria the plan only partly asserts and `planning-workflow.ts` re-plans once with feedback. Providers live in `providers/` (`RetryingProvider` retries transient errors only, never quota errors).
- `src/executor/`: `step-executor.ts` runs steps; `semantic-resolver.ts` turns a plain-language target into an element ref from the accessibility snapshot; `assertion-engine.ts` judges assertions; `scenario-runner.ts`, `execution-workflow.ts` and `execution-log.ts` run, report and log; `failure-analysis.ts` classifies failures.
- `.github/workflows/rfqa-agent.yml`: runs plan and execute when an issue gets the `status: RFQA` label (or via `workflow_dispatch`), uploads `evidence/` and comments on the issue. `ci.yml` runs the tests on Windows, Linux and macOS.

## Rules that must not be broken

1. **Pass or fail is decided in code, never by the LLM.** The LLM plans and picks elements. Assertions are compared against the live snapshot by `assertion-engine.ts`.
2. **No hardcoded selectors.** Steps carry semantic targets. The resolver may only return refs that exist in the current snapshot, and its answer is validated before use.
3. **Bounded behavior.** Step, scenario and action limits, one self-healing repair per step, one re-plan, one navigation retry. Do not add unbounded loops.
4. **Only allow-listed Playwright MCP tools.** Blocked: `browser_evaluate`, `browser_run_code_unsafe`, `browser_run_code`, `browser_file_upload`, `browser_route`.
5. **Secrets stay out of output.** Reports and logs go through `captures.redactAndShorten`. In workflows, secrets are set at step level only.
6. **A failure must be actionable.** Keep the "Failure details" content: what happened, what the page showed, what to do. Never turn an assertion failure into a pass to make a run green.

## Conventions

- Expected values in plans are what a user sees on the page, as the criterion writes them, never HTML attribute values.
- The planner prompt still has cart-specific rules (some name AC-05/AC-06). This is a documented limitation in `TEST_PLAN.md`; do not add more.
- Add a unit test with every behavior change (`tests/unit/`). The suite must stay green.
- Keep `README.md`, `TEST_PLAN.md` and `SCENARIOS.md` in step with code changes that alter behavior.
- Windows is a first-class platform. Use `PowerShell` where the Bash tool is unavailable and absolute paths.

## Git

- Branch: `main`. Repo-local identity is set; do not change it.
- Do not put phase numbers in commit messages. Explain what changed and why.
- End commits with the attribution line the user's organization requires.
- Never push without the user's approval. The GitHub account for this repo is `deepithk`.
- Never commit `.env`.
