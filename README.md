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

- [Report](evidence/reports/test-execution-issue-1-2026-11-11T07-04-34-758Z.md) (expected and actual value for every assertion)
- [Execution log](evidence/logs/test-execution-2026-11-11T07-04-34-758Z.log) (every step, how its element was found and why, every assertion)
- [Screenshots](evidence/screenshots/2026-11-11T07-04-34-758Z/) (one after every step)

This run made 7 LLM requests, with 3 more answers reused.

### What a failure looks like

A second run shows how the agent reports a failing test. It used the SauceDemo account `locked_out_user`, which cannot log in, so the acceptance criteria cannot be met:

- [Failure report](evidence/reports/test-execution-issue-1-failure-demo-2026-11-11T07-02-18-567Z.md), with a **Failure details** section that says what happened, what the page showed, and what to do
- [Failure log](evidence/logs/test-execution-failure-demo-2026-11-11T07-02-18-567Z.log)
- [Screenshots](evidence/screenshots/failure-demo-2026-11-11T07-02-18-567Z/)

Design documents: [TEST_PLAN.md](TEST_PLAN.md) (architecture, prompt strategy, guardrails) and [SCENARIOS.md](SCENARIOS.md) (acceptance criteria and scenarios).

## Quick start (about 5 minutes, no GitHub needed)

You need Node.js 20 or newer, npm, Git, and an API key for Gemini or Anthropic (see [Getting an API key](#getting-an-api-key)). The repository already contains a generated test plan, so you can run the agent without a GitHub token or project board.

```bash
git clone https://github.com/deepithk/autonomous-ui-test-agent.git
cd autonomous-ui-test-agent
npm ci
npx playwright install chromium
```

Create your settings file. Everything is pre-filled for the public SauceDemo site except the API key:

```bash
cp .env.example .env
```

On Windows PowerShell use `Copy-Item .env.example .env` instead.

Open `.env` and set `LLM_API_KEY` (and `LLM_PROVIDER` and `LLM_MODEL` if you do not use Gemini). Then check the settings and run:

```bash
npm run check:config
npm run execute:plan
```

`check:config` is free: it makes no LLM, GitHub or browser requests. `execute:plan` runs the saved plan in a headless browser, prints what the agent is doing as it goes, and ends with a verdict for each acceptance criterion. It makes about 7 LLM requests and takes one to two minutes. The report, log and screenshots appear in `evidence/`.

To see the browser while it runs, set `PLAYWRIGHT_MCP_HEADLESS=false` in `.env`.

## Getting an API key

The agent needs one LLM provider. Set these three values in `.env`:

| Provider | Where to get a key | `LLM_PROVIDER` | Example `LLM_MODEL` |
| --- | --- | --- | --- |
| Gemini | [Google AI Studio](https://aistudio.google.com/apikey) (free tier available) | `gemini` | `gemini-3.5-flash-lite` |
| Anthropic (Claude) | [Anthropic Console](https://console.anthropic.com/) (API keys page) | `anthropic` | `claude-sonnet-5-5` |

```
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.5-flash-lite
LLM_API_KEY=<your key>
```

Never commit `.env`; it is ignored by git. OpenAI is not built in. Adding another provider means implementing the small `ILLMProvider` interface in `src/planner/providers/`.

## Planning from your own issue

The quick start runs the plan that is already saved. To generate a new plan from an issue, use either source.

**From a local file (no GitHub):** the file has the layout of a GitHub issue. [`fixtures/issue-1.md`](fixtures/issue-1.md) is the example.

```bash
npm run plan:issue -- --issue-file fixtures/issue-1.md
```

**From GitHub:** this also checks that the issue is in the "Ready for QA" (RFQA) state on a GitHub Projects (V2) board. Fill in the GitHub section of `.env`:

| Setting | Meaning |
| --- | --- |
| `GITHUB_TOKEN` | A token that can read the repository's issues and the project |
| `GITHUB_OWNER`, `GITHUB_REPO` | Where the issue lives |
| `GITHUB_ISSUE_NUMBER` | The issue to test |
| `GITHUB_PROJECT_NUMBER` | The project board number (a user project) |
| `GITHUB_RFQA_STATUS_VALUE` | The Status value that means ready for QA (default `RFQA`) |
| `GITHUB_RFQA_FALLBACK_LABEL` | If the board status cannot be read, accept an issue label instead |

```bash
npm run check:config -- --github
npm run plan:issue
```

### How the issue must be written

Acceptance criteria are read from headings of the form `### AC-01: Title`, followed by the criterion text. Any other heading ends the criterion. The ID must be unique and the text must not be empty, otherwise the agent stops with a clear message.

```markdown
## Acceptance Criteria

### AC-01: Successful Login

Given the user is on the login page,
When valid credentials are entered,
Then the products inventory page should be displayed.

### AC-02: Add Product to Cart

Given the user is on the products inventory page,
When the user selects Add to cart for a product,
Then the selected product should be added to the shopping cart.
```

## Run it from GitHub (RFQA trigger)

The workflow [`.github/workflows/rfqa-agent.yml`](.github/workflows/rfqa-agent.yml) runs the whole agent in GitHub Actions when an issue is moved to "Ready for QA", and comments the result on the issue.

GitHub Actions cannot start from a Projects board column change, so the trigger is the issue label **`status: RFQA`**. That is the same label the agent accepts as proof of the RFQA state when it cannot read the board.

**One-time setup**

```bash
gh secret set LLM_API_KEY
gh label create "status: RFQA" --color 0E8A16 --description "Ready for QA: starts the test agent"
```

`gh secret set` asks you for the key, so it never appears in a command or a file. These are optional:

| Name | Kind | Meaning |
| --- | --- | --- |
| `LLM_PROVIDER`, `LLM_MODEL` | variable | Defaults: `gemini` and `gemini-3.5-flash-lite` |
| `PROJECT_NUMBER` | variable | Project board number (default 1) |
| `TARGET_BASE_URL`, `SAUCEDEMO_USERNAME` | variable | Defaults: the public SauceDemo site and `standard_user` |
| `SAUCEDEMO_PASSWORD` | secret | Default: the public demo password |
| `PROJECT_READ_TOKEN` | secret | A token that can read the Projects board. With it the agent checks the real board status; without it, it relies on the label |

**Use it**

1. Add the label `status: RFQA` to the issue.
2. The **Actions** tab shows a run named "RFQA Test Agent". After a minute or two the issue gets a comment with the report, and the run has an evidence artifact (screenshots, log and reports, kept 30 days).
3. Or start a run by hand: `gh workflow run rfqa-agent.yml -f issue_number=1`.

The run is red if any criterion fails, and the comment is posted either way. Each run makes about 8 LLM requests.

If an issue cannot be tested, the run stops before any browser opens and the comment says why: for example the issue is not in RFQA (the board or the label says otherwise), or its acceptance criteria are not written as `### AC-01: Title` headings. Only evidence from the run itself is ever reported.

## How it works

```
issue (GitHub or file) -> Issue reader -> LLM test planner -> validated plan (saved)
                                                                   |
                                                                   v
 report + log + screenshots <- Scenario runner <- loads and re-validates the plan
                                  |-- Step executor ----> Playwright MCP (allow-listed tools)
                                  '-- Assertion engine -> checks the live page
```

1. **Plan** (`npm run plan:issue`): reads the issue and its acceptance criteria, asks the LLM for scenarios, and validates the plan with Zod and extra rules before saving it. Every criterion must be covered by at least one assertion.
2. **Execute** (`npm run execute:plan`): loads the newest saved plan, validates it again, and runs each scenario in its own isolated browser. Steps run in order; assertions run right after the step they belong to, and a screenshot is saved after every step.
3. **Report**: writes a JSON and a Markdown report with a verdict per acceptance criterion and per assertion, and an explanation of anything that did not pass.

### How the agent finds elements

The plan describes targets in plain words ("Add to cart button for the selected product"), never as CSS or XPath. At run time the agent reads the page's accessibility snapshot:

- If the plan's fields identify exactly one element, it is used directly.
- Otherwise the LLM picks the element from the snapshot. Its answer is only accepted if the element reference really exists in that snapshot.

Values seen on the page (for example the first product's name and price) are captured and reused in later steps and assertions, so scenarios do not depend on a hard-coded product.

### Self-healing

If the page changed a little since the plan was written, a step can fail although the application still works. Before failing a step, the agent makes one repair attempt: if the planned element is not found, the LLM may name a different element that serves the same purpose (and must refuse if the page is in a different state, such as a login error); if the browser refuses an action, the element is looked up again and the action retried once.

A repair never decides a result, because the assertions still check the page. Every repair is shown in the log (`SELF-HEAL`), in a **Self-healing** table in the report and in the console. Switch it off with `SELF_HEALING=false`. Details: [TEST_PLAN.md](TEST_PLAN.md#93-self-healing-one-repair-per-step).

### How the agent avoids made-up results

The LLM never decides pass or fail. It only says where to look; the comparison with the expected value is done in code. See the prompt strategy in [TEST_PLAN.md](TEST_PLAN.md#9-prompt-engineering-loop-prevention-and-guardrails).

### Safety rules

- Only an allow-list of Playwright MCP tools can be called. `browser_evaluate`, `browser_run_code_unsafe` and file upload are blocked even though the server offers them.
- The LLM never writes code, selectors or scripts that get executed.
- Navigation is limited to the `TARGET_BASE_URL` origin.
- Each scenario gets a fresh browser profile, so scenarios cannot affect each other.
- Login details are injected at run time and redacted from logs and reports.
- Step count, scenario time and per-action time are limited (see configuration below).
- Temporary LLM errors (such as "model is busy") are retried; quota errors are not, so a limit is never made worse.

## Configuration

All settings live in `.env`. Never commit it.

| Setting | Purpose | Needed for |
| --- | --- | --- |
| `LLM_PROVIDER` | `gemini` or `anthropic` | plan and execute |
| `LLM_MODEL` | Model name for the chosen provider | plan and execute |
| `LLM_API_KEY` | API key for the chosen provider | plan and execute |
| `TARGET_BASE_URL` | The web app to test (`https://www.saucedemo.com`) | plan and execute |
| `SAUCEDEMO_USERNAME`, `SAUCEDEMO_PASSWORD` | Login used by the scenarios (public demo account) | plan and execute |
| `PLAYWRIGHT_MCP_HEADLESS` | `true` to hide the browser window | execute |
| `PLAYWRIGHT_MCP_CAPS` | Extra Playwright MCP capabilities (default `testing`) | execute |
| `MAX_STEPS_PER_SCENARIO` | Step limit per scenario (default 15) | execute |
| `SCENARIO_TIMEOUT_MS` | Time limit per scenario, not counting time spent saving evidence (default 60000) | execute |
| `ACTION_TIMEOUT_MS` | Time limit per browser action (default 10000) | execute |
| `MAX_ELEMENT_RECOVERY_ATTEMPTS` | Extra tries to find an element or re-check an assertion (default 2) | execute |
| `SELF_HEALING` | `true` (default) to repair a step once before failing it (see below) | execute |
| `GITHUB_*` | See "Planning from your own issue" | only to plan from GitHub |

### Choosing an LLM

The same provider and model are used for planning and for finding elements.

- A full execution makes about 7 LLM requests for this issue. The agent reuses an earlier answer only when the page and the question are exactly the same, and assertions checked at the same point share one request. The count is printed at the end of each run and saved in the report. Quotas are usually per model, so check the limits shown for your key.
- Gemini Flash-Lite (`gemini-3.5-flash-lite`) produced the passing run shown above.
- A larger model may locate elements more reliably. A smaller model can occasionally make a wrong choice, so the report lists which elements each assertion found and a screenshot is saved after every step.

## Usage

```bash
npm run check:config                          # validate .env, no requests made
npm run check:config -- --github              # also validate the GitHub settings
npm run plan:issue -- --issue-file <file>     # plan from a local issue file
npm run plan:issue                            # plan from the GitHub issue
npm run execute:plan                          # run the newest saved plan
npm run execute:plan -- --plan <file>         # run a specific saved plan
npm run execute:plan -- --label my-run        # put a label in the evidence file names
npm run build                                 # type-check and compile
npm test                                      # all unit tests (no network or browser)
```

`execute:plan` exits with code 1 unless every scenario passed.

### Reading the results

Each scenario ends as one of:

- **passed**: every step ran and every assertion held.
- **failed**: a step failed or an assertion did not hold.
- **error**: nothing failed, but it could not be fully checked (time limit, browser did not start, or an assertion the page cannot answer).

If a step fails, the remaining steps are skipped and assertions that never ran are reported as "not evaluated", never as passes.

Anything that did not pass is explained in the report's **Failure details** section: what kind of problem it is (the application, the agent, the LLM service, or a run limit), what happened, the page's URL and any error message it showed, and what to do next.

### Trying a failure

Use another SauceDemo account to see a failing run. `locked_out_user` cannot log in:

```bash
SAUCEDEMO_USERNAME=locked_out_user npm run execute:plan -- --label failure-demo
```

On Windows PowerShell:

```powershell
$env:SAUCEDEMO_USERNAME = "locked_out_user"; npm run execute:plan -- --label failure-demo
```

## Evidence

Everything produced by a run goes in [`evidence/`](evidence/):

- `evidence/reports/test-plan-issue-<n>-<time>.json`: the generated plan
- `evidence/reports/test-execution-issue-<n>-<time>.json` and `.md`: the execution report
- `evidence/logs/test-execution-<time>.log`: one line per step, assertion and screenshot, including how each element was found and the LLM's reason. The same lines are printed to the console while the run happens.
- `evidence/screenshots/<run>/`: a screenshot after every step

## Project structure

```
src/
  config/      settings validation, platform helpers
  github/      issue reader (GitHub or local file), acceptance-criteria parser
  planner/     LLM test planner and its prompt, plan schema,
               Gemini and Anthropic providers
  executor/    browser session, step executor, assertion engine,
               scenario runner, element resolver and its prompts,
               failure analysis, report workflow
  util/        small shared helpers (error text, text shortening, CLI wrapper)
tests/unit/    unit tests (no network and no browser needed)
fixtures/      an example issue
evidence/      plans, reports, logs and screenshots
```

## Known limitations

- When the LLM chooses an element, it can be wrong. The framework only accepts elements that exist on the page, and a failed assertion is checked again with a fresh question to the LLM, but a wrong choice on a "nothing is there" check could still hide a problem. That is why screenshots, the matched elements and the LLM's reasons are recorded.
- `application_state` assertions cannot be read from the page and are reported as needing manual review.
- The planner prompt and plan validator contain rules for the shopping-cart flow (see [TEST_PLAN.md](TEST_PLAN.md#14-known-limitations-and-future-work)).
- Scenarios run one after another in a single browser engine.
- Only the SauceDemo shopping-cart issue has been exercised so far.

## Security

- Never commit `.env`.
- Never expose API keys or GitHub tokens.
- Reports and logs redact the SauceDemo login details.
