# Autonomous UI Test Execution Agent

An agent that reads the acceptance criteria of a GitHub issue, plans functional test scenarios with an LLM, and then drives a real browser on its own to test a web app. Every acceptance criterion gets a pass/fail verdict backed by evidence.

The target application is [SauceDemo](https://www.saucedemo.com/). The issue under test is "Add and Remove Products from Shopping Cart" (6 acceptance criteria).

## Latest result

All six acceptance criteria passed in the most recent run (LLM: Gemini Flash-Lite).

| Criterion | Verdict |
| --- | --- |
| AC-01 Successful Login | PASSED |
| AC-02 Add Product to Cart | PASSED |
| AC-03 Update Cart Count | PASSED |
| AC-04 Verify Cart Contents | PASSED |
| AC-05 Remove Product | PASSED |
| AC-06 Verify Empty Cart | PASSED |

Evidence for that run:

- [Report](evidence/reports/test-execution-issue-1-2026-11-11T05-20-46-600Z.md) (expected and actual value for every assertion)
- [Execution log](evidence/logs/test-execution-2026-11-11T05-20-46-600Z.log) (every step, how its element was found, every assertion)
- [Screenshots](evidence/screenshots/2026-11-11T05-20-46-600Z/) taken at each assertion checkpoint

This run made 7 LLM requests, with 3 more answers reused.

Design documents: [TEST_PLAN.md](TEST_PLAN.md) and [SCENARIOS.md](SCENARIOS.md).

## How it works

```
GitHub issue ──► Issue reader ──► LLM test planner ──► validated test plan
                                                              │
                                                              ▼
 evidence report ◄── scenario runner ◄── (fresh browser per scenario)
 + screenshots            │
                          ├─ step executor ──► Playwright MCP (allow-listed tools)
                          └─ assertion engine ─► checks the live page
```

1. **Plan** (`npm run plan:issue`): reads the issue and its acceptance criteria from GitHub, checks it is ready for testing, asks the LLM for scenarios, and validates the plan with Zod and extra rules before saving it. Every criterion must be covered by at least one assertion.
2. **Execute** (`npm run execute:plan`): loads the newest saved plan, validates it again, and runs each scenario in its own isolated browser. Steps run in order; assertions run right after the step they belong to, and a screenshot is saved as evidence.
3. **Report**: writes a JSON and a Markdown report with a verdict per acceptance criterion and per assertion.

### How the agent finds elements

The plan describes targets in plain words ("Add to cart button for the selected product"), never as CSS or XPath. At run time the agent reads the page's accessibility snapshot:

- If the plan's fields identify exactly one element, it is used directly.
- Otherwise the LLM picks the element from the snapshot. Its answer is only accepted if the element reference really exists in that snapshot.

Values seen on the page (for example the first product's name and price) are captured and reused in later steps and assertions, so scenarios do not depend on a hard-coded product.

### Safety rules

- Only an allow-list of Playwright MCP tools can be called. `browser_evaluate`, `browser_run_code_unsafe` and file upload are blocked even though the server offers them.
- The LLM never writes code, selectors or scripts that get executed.
- Navigation is limited to the `TARGET_BASE_URL` origin.
- Each scenario gets a fresh browser profile, so scenarios cannot affect each other.
- Login details are injected at run time and redacted from logs and reports.
- Step count, scenario time and per-action time are limited (see configuration below).
- Temporary LLM errors (such as "model is busy") are retried; quota errors are not, so a limit is never made worse.

## Prerequisites

- Node.js 24.22+ or 26.13+ (the repo enforces this with `engine-strict`).
- npm and Git.
- A GitHub token that can read the issue and its project.
- An LLM API key for Gemini or Anthropic.
- Windows 11+ or macOS 14+.

## Setup

```bash
git clone https://github.com/deepithk/autonomous-ui-test-agent.git
cd autonomous-ui-test-agent
npm ci
npx playwright install chromium
```

Create the local environment file and fill in the values:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

## Configuration

All settings live in `.env`. Never commit it.

| Setting | Purpose |
| --- | --- |
| `LLM_PROVIDER` | `gemini` or `anthropic` |
| `LLM_MODEL` | Model name for the chosen provider |
| `LLM_API_KEY` | API key for the chosen provider |
| `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` | Where the issue lives |
| `GITHUB_ISSUE_NUMBER`, `GITHUB_PROJECT_NUMBER` | Which issue and project board to read |
| `GITHUB_RFQA_STATUS_VALUE` | Board status an issue must have to be tested (default `RFQA`) |
| `GITHUB_RFQA_FALLBACK_LABEL` | Use an issue label if the board status cannot be read |
| `TARGET_BASE_URL` | The web app to test, e.g. `https://www.saucedemo.com` |
| `SAUCEDEMO_USERNAME`, `SAUCEDEMO_PASSWORD` | Login used by the scenarios |
| `PLAYWRIGHT_MCP_HEADLESS` | `true` to hide the browser window |
| `PLAYWRIGHT_MCP_CAPS` | Extra Playwright MCP capabilities (default `testing`) |
| `MAX_STEPS_PER_SCENARIO` | Step limit per scenario (default 15) |
| `SCENARIO_TIMEOUT_MS` | Time limit per scenario (default 60000) |
| `ACTION_TIMEOUT_MS` | Time limit per browser action (default 10000) |
| `MAX_ELEMENT_RECOVERY_ATTEMPTS` | Extra tries to find an element (default 2) |

### Choosing an LLM

The same provider and model are used for planning and for finding elements.

- A full execution makes about 7 LLM requests for this issue. The agent reuses an earlier answer only when the page and the question are exactly the same, and assertions checked at the same point share one request. The count is printed at the end of each run and saved in the report. Quotas are usually per model, so check the limits shown for your key.
- Gemini Flash-Lite (`gemini-3.5-flash-lite`) produced the passing run shown above.
- A larger model may locate elements more reliably. A smaller model can occasionally pick the wrong element, so spot-check the screenshots.

## Usage

Generate a test plan from the issue (uses the LLM, runs no browser):

```bash
npm run plan:issue
```

Execute the newest saved plan (uses the browser and the LLM):

```bash
npm run execute:plan
```

To run a specific saved plan:

```bash
npm run execute:plan -- --plan evidence/reports/test-plan-issue-1-<timestamp>.json
```

The command prints a verdict per acceptance criterion and exits with code 1 unless everything passed.

Other commands:

```bash
npm run check:config # validate .env and create evidence folders (no LLM or browser use)
npm run build        # type-check and compile
npm test             # all unit tests
```

`check:config` is a free way to confirm `.env` is complete before spending LLM requests on a plan or an execution.

### Reading the results

Each scenario ends as one of:

- **passed**: every step ran and every assertion held.
- **failed**: a step failed or an assertion did not hold.
- **error**: nothing failed, but it could not be fully checked (time limit, browser did not start, or an assertion the page cannot answer).

If a step fails, the remaining steps are skipped and assertions that never ran are reported as "not evaluated", never as passes.

## Evidence

Everything produced by a run goes in [`evidence/`](evidence/):

- `evidence/reports/test-plan-issue-<n>-<time>.json`: the generated plan
- `evidence/reports/test-execution-issue-<n>-<time>.json` and `.md`: the execution report
- `evidence/logs/test-execution-<time>.log`: one line per step, assertion and screenshot, including how each element was found
- `evidence/screenshots/<run>/`: screenshots per scenario and step

## Project structure

```
src/
  config/      settings validation, platform helpers
  github/      issue reader and acceptance-criteria parser
  planner/     LLM test planner, plan schema, Gemini and Anthropic providers
  executor/    browser session, step executor, assertion engine,
               scenario runner, report workflow
tests/unit/    unit tests (no network and no browser needed)
evidence/      plans, reports and screenshots
```

## Known limitations

- When the LLM chooses an element, it can be wrong. The framework only accepts elements that exist on the page, but a wrong choice on a "nothing is there" check could still hide a problem, which is why screenshots are saved at every checkpoint.
- `application_state` assertions cannot be read from the page and are reported as needing manual review.
- Scenarios run one after another in a single browser engine.
- Only the SauceDemo shopping-cart issue has been exercised so far.

## Security

- Never commit `.env`.
- Never expose API keys or GitHub tokens.
- Reports redact the SauceDemo login details.
