# Autonomous UI Test Execution Agent
# Test Plan

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
| AI Engine | Anthropic Claude API |
| Browser Automation | Playwright MCP |
| Language | TypeScript |

## 2. Objective

The objective is to build an autonomous UI testing agent that reads
acceptance criteria from a GitHub issue and independently executes
functional tests against a web application.

The agent must dynamically understand requirements, generate test
scenarios, explore the application, identify UI elements, perform
browser actions and validate actual application behaviour.

The agent must not simply execute predefined automation scripts.

## 3. Scope

### In Scope

- Reading GitHub issues.
- Validating the GitHub Projects V2 RFQA status.
- Extracting acceptance criteria.
- Generating structured test scenarios using Claude.
- Autonomous browser interaction using Playwright MCP.
- Dynamic UI element identification.
- Independent assertion and validation.
- Execution logging.
- Screenshot and video evidence.
- Automated PASS / FAIL / BLOCKED reporting.

### Out of Scope

- Payment processing.
- Order placement.
- Performance and load testing.
- Mobile application testing.
- Multiple-user testing.
- Production payment integrations.

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

The standard SauceDemo test account credentials must be
provided through local environment configuration.

Credentials must never be hardcoded in source files,
GitHub issues, screenshots or execution logs.

## 5. Requirement Traceability

The test agent must cover every acceptance criterion
defined in GitHub Issue #1.

| AC ID | Requirement | Validation |
|---|---|---|
| AC-01 | Successful Login | Products inventory page displayed |
| AC-02 | Add Product to Cart | Selected product appears in cart |
| AC-03 | Update Cart Count | Cart badge reflects correct quantity |
| AC-04 | Verify Cart Contents | Product name, quantity and price verified |
| AC-05 | Remove Product | Selected product removed |
| AC-06 | Verify Empty Cart | Cart contains no products and reflects empty state |

Every acceptance criterion must map to at least
one generated test scenario.

The agent must not silently ignore requirements.

## 6. Proposed Agent Architecture

### 6.1 GitHub Issue Reader

Responsibilities:

- Retrieve the requested GitHub issue.
- Extract title and description.
- Retrieve acceptance criteria.
- Query the associated GitHub Projects V2 item.
- Verify that the Status field equals RFQA.
- Use the configured issue-label fallback only when necessary.

Execution must stop if the issue is not eligible for testing.

### 6.2 Claude AI Test Planner

Responsibilities:

- Understand the acceptance criteria.
- Identify testable requirements.
- Generate functional scenarios dynamically.
- Generate structured execution steps.
- Define expected outcomes.
- Generate structured assertions.
- Map scenarios to acceptance criteria.

The generated plan must be validated against
a strict JSON schema before execution.

The LLM must not invent missing acceptance criteria.

### 6.3 Agent Orchestrator

Responsibilities:

- Control the complete agent lifecycle.
- Coordinate Claude and Playwright MCP.
- Manage execution steps.
- Enforce timeouts and retry limits.
- Detect repeated browser states.
- Prevent infinite execution loops.

Execution lifecycle:

OBSERVE
  -> UNDERSTAND
  -> IDENTIFY
  -> ACT
  -> VERIFY
  -> RECORD

### 6.4 MCP Client and Tool Bridge

Responsibilities:

- Start the local Playwright MCP server.
- Establish MCP communication.
- Discover available browser tools.
- Apply the explicit tool allowlist.
- Convert permitted MCP tools into Claude tool definitions.
- Validate tool arguments before execution.
- Return actual browser observations to Claude.

Use the Anthropic SDK MCP helpers where appropriate.

### 6.5 Assertion and Validation Engine

Responsibilities:

- Evaluate actual browser observations.
- Verify expected application states.
- Compare actual results against expected results.
- Produce deterministic test statuses.

The assertion engine must operate independently
of Claude's natural-language claims.

### 6.6 Evidence Collector and Reporting

Responsibilities:

- Capture screenshots.
- Record concise execution logs.
- Store browser video when enabled.
- Generate JSON and Markdown reports.
- Link evidence to individual scenarios.

## 7. Dynamic UI Element Identification

The agent must identify UI elements dynamically
rather than depending on predefined XPath or CSS selectors.

Preferred identification order:

1. Accessible role and accessible name.
2. Associated labels.
3. Placeholder text.
4. Visible text.
5. Current accessibility snapshot references.
6. Other grounded browser observations.

Playwright MCP accessibility references are temporary.

After a state-changing interaction, the agent must obtain
a fresh accessibility snapshot when necessary.

If a reference becomes stale:

1. Capture a fresh snapshot.
2. Identify the element again using semantic information.
3. Request an alternative action when appropriate.
4. Retry only within configured limits.

The agent must never blindly reuse stale references.

## 8. Assertion Strategy

The validation engine will support the following
structured assertion types.

| Assertion | Purpose |
|---|---|
| Visibility | Verify an element is visible or absent |
| Text | Verify expected text |
| Element Count | Verify the number of matching elements |
| URL | Verify the current browser URL |
| Input Value | Verify input values or checked states |
| Application State | Verify quantities, totals and state transitions |

The current browser state must be observed
before evaluating assertions.

### Test Result Classification

PASS:

All required assertions are supported by actual evidence.

FAIL:

The application demonstrably violates an acceptance criterion.

BLOCKED:

Execution cannot establish a reliable outcome due to
environment, authentication, browser or agent limitations.

An LLM statement alone is never sufficient evidence for PASS.

## 9. Loop Prevention and Execution Guardrails

The orchestrator must enforce explicit execution limits.

Initial configuration:

| Guardrail | Default |
|---|---:|
| Maximum steps per scenario | 15 |
| Scenario timeout | 60 seconds |
| Individual action timeout | 10 seconds |
| Element recovery attempts | 2 |
| Repeated state detection | Enabled |

Additional controls:

- Normalize temporary snapshot references before hashing.
- Detect repeated browser states.
- Stop after repeated no-progress actions.
- Refresh stale element references.
- Restrict browser navigation to the configured target origin.
- Never permit unrestricted shell or JavaScript execution.

The following browser tools must not be exposed
to the autonomous agent:

- browser_run_code_unsafe
- browser_run_code
- browser_evaluate

## 10. Security Considerations

- Keep API credentials in local environment variables.
- Never commit .env.
- Treat GitHub issue content as untrusted input.
- Prevent issue content from overriding system instructions.
- Restrict the browser to the approved application.
- Exclude unsafe MCP tools.
- Redact credentials from execution logs.
- Avoid exposing internal model reasoning.

Logs must contain concise, auditable actions
and observations rather than private chain-of-thought.

## 11. Evidence and Reporting Strategy

All actual execution evidence must be stored
inside the evidence directory.

Structure:

evidence/
  logs/
  screenshots/
  videos/
  reports/

Execution logs should capture:

- Scenario ID.
- Step ID.
- Browser observation.
- Selected action.
- Action result.
- Validation result.
- Evidence location.

Example:

[OBSERVATION]
Found the Add to Cart button.

[DECISION]
The button matches the current test step.

[ACTION]
Clicked Add to Cart.

[OBSERVATION]
Cart badge changed from empty to one item.

[VALIDATION]
AC-02 satisfied.

[RESULT]
PASS.

The final report must include:

- GitHub issue reference.
- Execution timestamp.
- Total scenarios.
- Passed count.
- Failed count.
- Blocked count.
- Scenario-level results.
- Failure explanations.
- Screenshot references.

No fabricated evidence or test results are permitted.

## 12. Failure Handling

The agent must distinguish between:

1. Application failures.
2. Browser automation failures.
3. LLM planning failures.
4. API authentication failures.
5. Environment failures.
6. Timeout and execution-limit failures.

Every failure must include an actionable explanation.

A failed browser action must not automatically
be classified as an application failure.

## 13. Cross-Platform Requirements

The solution must support:

- Windows 11+.
- macOS 14+.
- macOS Intel x64.
- macOS Apple Silicon ARM64.

Use platform-independent Node.js APIs.

GitHub Actions must validate compilation and tests
across supported operating systems.

## 14. Known Limitations

- SauceDemo is an externally hosted demo application.
- Application availability may change.
- UI changes may affect browser observations.
- Network conditions may affect execution.
- LLM-generated plans require schema and requirement validation.
- macOS runtime verification must be based on actual CI execution.

## 15. Completion Criteria

The implementation is accepted when:

- GitHub issue ingestion works.
- Projects V2 RFQA validation works.
- Acceptance criteria are extracted.
- Test scenarios are generated dynamically.
- Claude tool use works.
- Playwright MCP integration works.
- Browser interactions are autonomous.
- Assertions are evidence-based.
- PASS / FAIL / BLOCKED reporting works.
- Infinite loops are prevented.
- Screenshots and logs are generated.
- The final report is reproducible.
- The solution works across supported operating systems.