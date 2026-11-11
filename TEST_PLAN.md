# Autonomous UI Test Execution Agent
# Test Plan

This document describes what the agent tests, how it is built and how its
results are decided. It reflects the implemented system. Items that were
considered but are not built are listed in section 14.

## 1. Document Information

| Field | Details |
|---|---|
| Project | Autonomous UI Test Execution Agent |
| GitHub Repository | deepithk/autonomous-ui-test-agent |
| GitHub Issue | #1 |
| GitHub Project | Autonomous UI QA Board |
| Project Status | RFQA |
| Application Under Test | SauceDemo |
| Application URL | https://www.saucedemo.com/ |
| Feature | Add and Remove Products from Shopping Cart |
| AI Engine | Provider-agnostic LLM: Gemini or Anthropic, chosen in `.env` |
| Browser Automation | Playwright MCP |
| Language | TypeScript |

## 2. Objective

The objective is an autonomous UI testing agent that reads acceptance
criteria from a GitHub issue and independently executes functional tests
against a web application.

The agent generates its test scenarios from the issue each time it runs,
describes UI elements in plain words instead of selectors, finds them on
the live page, performs the browser actions and checks the actual
behaviour of the application.

The agent does not run predefined automation scripts. If the issue
changes, the next plan changes with it.

## 3. Scope

### In Scope

- Reading GitHub issues.
- Validating the GitHub Projects V2 RFQA status.
- Extracting acceptance criteria.
- Generating structured test scenarios with an LLM.
- Validating the generated plan before any browser is opened.
- Autonomous browser interaction using Playwright MCP.
- Dynamic UI element identification.
- Independent assertions checked against the live page.
- Screenshot evidence at every assertion checkpoint.
- JSON and Markdown reports with passed / failed / error results and a
  verdict for each acceptance criterion.

### Out of Scope

- Payment processing.
- Order placement.
- Performance and load testing.
- Mobile application testing.
- Multiple-user testing.
- Production payment integrations.
- Browser video and a separate execution log file (see section 14).

## 4. Application Under Test

Application: SauceDemo

URL: https://www.saucedemo.com/

Feature under test:

Product selection and shopping cart management.

The test journey includes:

1. Successful login.
2. Adding a product to the shopping cart.
3. Verifying the cart badge.
4. Verifying cart contents.
5. Removing a product.
6. Verifying the empty cart state.

The standard SauceDemo test account credentials are provided through local
environment configuration.

Credentials are never hardcoded in source files, GitHub issues, plans,
reports or logs. The planner rejects any plan that contains them, and
reports have them redacted.

## 5. Requirement Traceability

The agent covers every acceptance criterion defined in GitHub Issue #1.

| AC ID | Requirement | Validation |
|---|---|---|
| AC-01 | Successful Login | Products inventory page displayed |
| AC-02 | Add Product to Cart | Selected product appears in cart |
| AC-03 | Update Cart Count | Cart badge reflects correct quantity |
| AC-04 | Verify Cart Contents | Product name, quantity and price verified |
| AC-05 | Remove Product | Selected product removed |
| AC-06 | Verify Empty Cart | Cart contains no products and reflects empty state |

Traceability is enforced in code, not by convention. A plan is rejected
before execution if any acceptance criterion has no scenario, or if a
scenario lists a criterion without at least one assertion for it. The
execution report then gives one verdict for each criterion.

## 6. Agent Architecture

Planning and execution are two separate commands that share a saved plan:

```
GitHub issue -> Issue reader -> LLM test planner -> validated plan (saved)
                                                         |
                                                         v
report + screenshots <- Scenario runner <- loads and re-validates the plan
                           |-- Step executor ----> Playwright MCP
                           '-- Assertion engine -> live page
```

### 6.1 GitHub Issue Reader (`src/github`)

- Retrieves the requested GitHub issue, its title and description.
- Extracts the acceptance criteria.
- Queries the associated GitHub Projects V2 item and verifies that the
  Status field equals RFQA.
- Uses the configured issue-label fallback only when the board status
  cannot be read.

Execution stops if the issue is closed, not in the required status, or has
no acceptance criteria.

### 6.2 LLM Test Planner (`src/planner`)

- Turns the acceptance criteria into scenarios, execution steps, expected
  outcomes and assertions.
- Maps every scenario and assertion to acceptance criteria.
- Treats the issue text as untrusted data and ignores instructions inside it.
- Is given a strict response schema, and the result is validated again
  locally by Zod and extra rules (see below) before it is saved.

Local validation checks, independently of the LLM:

- Every acceptance criterion is covered, and none is invented.
- Step and assertion IDs are unique, and assertions point at real steps.
- Captured values are only used after the step that captures them.
- Add to cart and Remove steps must name the selected product.
- No credentials appear anywhere in the plan.
- A step can only use the eight allowed actions (navigate, observe, click,
  fill, type, press_key, select_option, wait_for), so the plan can never
  contain raw JavaScript, XPath or CSS.

### 6.3 Scenario Runner (`src/executor`)

Runs one scenario at a time in its own isolated browser:

1. Open a fresh browser profile.
2. For each step, in order: read the page, locate the target, perform the
   action.
3. After a step, evaluate the assertions assigned to that step and save a
   screenshot.
4. If a step fails, take a failure screenshot, skip the remaining steps and
   report unevaluated assertions as "not evaluated".
5. Always close the browser.

The runner enforces the step limit and the scenario time limit.

### 6.4 Browser Session and Tool Allow-list

- Starts the local Playwright MCP server over stdio.
- Verifies that every allowed tool exists in the installed version.
- Exposes only allow-listed tools. Blocked tools are rejected even though
  the server offers them.
- Applies the per-action timeout to every call.
- Reports tool errors with the tool's own message.

### 6.5 Semantic Resolver

Turns a plan target such as "Add to cart button for the selected product"
into one element of the live page. See section 7.

### 6.6 Assertion Engine

Evaluates plan assertions against a fresh page snapshot (section 8). It
works from what is actually on the page and never from an LLM's statement
that something passed.

### 6.7 Evidence and Reporting

- Saves a screenshot at each assertion checkpoint and at a failed step.
- Writes a JSON report and a Markdown report.
- Records the model that wrote the plan and the model that executed it.
- Redacts credentials from everything it writes.

## 7. Dynamic UI Element Identification

The agent identifies elements from the page's accessibility snapshot, not
from predefined XPath or CSS selectors.

Order of identification:

1. If the plan gives an accessible role, accessible name, label or visible
   text, and exactly one element matches, that element is used. If several
   match, the agent narrows them to elements that can perform the action
   (for example a button rather than a form that shares its name).
2. Otherwise the LLM chooses the element from the snapshot, using the
   target description and the page hierarchy to tell similar elements
   apart (for example the Add to cart button that belongs to one product).
   The page text is treated as untrusted and never followed as an
   instruction.
3. The chosen element is accepted only if its reference really exists in
   that snapshot.

Playwright MCP element references are temporary, so a fresh snapshot is
taken before every action and every assertion. A reference is never reused
from an earlier page state.

If an element is not found, the agent waits one second, reads a fresh
snapshot and tries again, up to `MAX_ELEMENT_RECOVERY_ATTEMPTS` times. LLM
provider failures are not retried this way. Temporary provider errors (such
as "model is busy") are retried with short waits. Quota errors are never
retried.

Values shown on the page, such as the first product's name and price, are
captured and reused in later steps and assertions, so scenarios do not
depend on a fixed product.

## 8. Assertion Strategy

| Assertion | What it checks |
|---|---|
| url | The current page URL equals the expected URL or path |
| text | An element's displayed text equals the expected text |
| element_count | The number of matching elements equals the expected number, including 0 |
| visibility | A matching element is present, or absent when the expectation is "hidden" |
| input_value | The value in an input field |
| application_state | Not checkable from the page; always reported as needing manual review |

The current page is read again before each assertion. If an assertion does
not hold, it is checked again after a short wait before the failure is
final, because pages can update late.

### Result Classification

Assertions end as:

- **passed**: the page matched the expectation.
- **failed**: the page was checked and did not match.
- **error**: the assertion could not be checked at all.

Scenarios end as:

- **passed**: every step ran and every assertion passed.
- **failed**: a step failed or an assertion failed.
- **error**: nothing failed, but the scenario could not be fully checked,
  for example a time limit, a browser that would not start, or an
  assertion that could not run. This is the equivalent of "blocked".

Each acceptance criterion gets a verdict of PASSED, FAILED or ERROR from the
assertions written for it. The whole run is FAILED if any scenario failed,
otherwise ERROR if any scenario errored, otherwise PASSED. An assertion that
never ran is never counted as a pass.

## 9. Execution Guardrails

| Guardrail | Default | Setting |
|---|---:|---|
| Maximum steps per scenario | 15 | `MAX_STEPS_PER_SCENARIO` |
| Scenario timeout | 60 seconds | `SCENARIO_TIMEOUT_MS` |
| Individual action timeout | 10 seconds | `ACTION_TIMEOUT_MS` |
| Element recovery attempts | 2 | `MAX_ELEMENT_RECOVERY_ATTEMPTS` |

Additional controls:

- A scenario with more steps than the limit is not run at all.
- A step that fails stops its scenario, so a broken step cannot loop.
- Navigation is limited to the configured target origin.
- Only allow-listed browser tools can be called.
- The agent never runs shell commands or LLM-written JavaScript.

These browser tools are blocked and can never be called:

- browser_run_code_unsafe
- browser_run_code
- browser_evaluate
- browser_file_upload
- browser_route

## 10. Security Considerations

- API credentials stay in local environment variables; `.env` is never
  committed.
- GitHub issue content is untrusted input and cannot override the planner's
  instructions.
- Page content is untrusted input and cannot override the element
  resolver's instructions.
- The LLM never produces code that is executed.
- The browser is restricted to the approved application.
- Unsafe MCP tools are blocked.
- Credentials are injected only at run time, never put into plans, and are
  redacted from reports and error messages.
- Long provider error text is shortened in reports.

## 11. Evidence and Reporting Strategy

Evidence is stored inside the `evidence` directory:

```
evidence/
  reports/                         plan and execution reports
  screenshots/<run timestamp>/     checkpoint and failure screenshots
```

`evidence/logs` and `evidence/videos` exist as placeholders and are not
written to yet (section 14).

Files for one execution:

- `evidence/reports/test-execution-issue-<n>-<timestamp>.json`
- `evidence/reports/test-execution-issue-<n>-<timestamp>.md`
- `evidence/screenshots/<timestamp>/<scenario>_<step>_<checkpoint|failure>.png`

The report contains:

- GitHub issue reference.
- Execution timestamp and the saved plan it ran.
- The model that wrote the plan and the model that executed it.
- The overall verdict and a verdict per acceptance criterion.
- Counts of scenarios, steps and assertions by result.
- For every scenario: each step's result, how its element was found
  (matched by plan fields or chosen by the LLM), and how long it took.
- For every assertion: expected value, actual value and result.
- Failure explanations and the screenshot paths.

No fabricated evidence or results are produced. A result is based on what
was actually read from the page.

## 12. Failure Handling

Failures are reported with an explanation. The result type separates the
main causes:

| Situation | Reported as |
|---|---|
| Application did not match the expectation | assertion **failed** |
| A step could not be performed (element not found, navigation blocked, browser tool error) | step **failed**, scenario failed, remaining steps skipped |
| Assertion could not be checked, or the scenario hit its time limit or could not start | **error** |
| LLM provider failure | the step or assertion reports the provider's message; temporary errors are retried first, quota errors are not |

A failed browser action is not described as an application failure. The
report says which step failed and why.

## 13. Cross-Platform Requirements

The solution supports:

- Windows 11+.
- macOS 14+, on both Intel x64 and Apple Silicon ARM64.

It uses platform-independent Node.js APIs. The GitHub Actions workflow
builds the project and runs the unit tests on Windows x64, macOS Intel x64
and macOS Apple Silicon ARM64. Browser runs are not part of CI because they
need an LLM key and the live site.

## 14. Known Limitations and Future Work

### Known limitations

- SauceDemo is an externally hosted demo application, and its availability
  or look may change.
- Network conditions may affect execution.
- When the LLM chooses an element it can be wrong. The framework only
  accepts elements that exist on the page, but a wrong choice on an
  "is it absent" check could hide a problem. This is why screenshots are
  saved at every checkpoint.
- Free LLM tiers have daily request limits. A full run uses roughly 15 to 20
  requests.
- Application State assertions need manual review.
- Scenarios run one after another, not in parallel.
- Only the shopping cart issue has been run so far.

### Not implemented (future work)

- A step-by-step execution log file in `evidence/logs`.
- Browser video in `evidence/videos`.
- Repeated browser-state and no-progress detection. Loops are currently
  prevented by the step limit, the time limits and by stopping at the first
  failed step.
- Placeholder text as an element hint.
- Checking checkbox and radio states in input assertions.

## 15. Completion Criteria

| Criterion | Status |
|---|---|
| GitHub issue ingestion works | Done |
| Projects V2 RFQA validation works | Done |
| Acceptance criteria are extracted | Done |
| Test scenarios are generated dynamically | Done |
| Playwright MCP integration works | Done |
| Browser interactions are autonomous | Done |
| Assertions are evidence-based | Done |
| Passed / failed / error reporting works, with a verdict per criterion | Done |
| Infinite loops are prevented | Done through limits; repeated-state detection is not built |
| Screenshots are generated | Done |
| Execution logs are generated | Not done (the JSON report holds step results) |
| The run can be repeated | Done with `npm run execute:plan` (results can vary with the LLM's choices, so the screenshots are kept as evidence) |
| The solution builds and tests on supported operating systems | CI covers Windows and both macOS architectures for build and unit tests |
