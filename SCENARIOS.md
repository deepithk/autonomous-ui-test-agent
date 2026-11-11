# Autonomous UI Test Execution Agent
# Functional Test Scenarios

This document defines the functional coverage the agent must achieve, as six
reference scenarios (RS-001 to RS-006). The agent does not read this file. It
generates its own executable plan from the GitHub issue every time it runs,
and it may group the work differently. Section 3 shows how the generated
plan relates to these reference scenarios, and section 9 shows the latest
result.

## 1. Document Information

| Field | Details |
|---|---|
| Project | Autonomous UI Test Execution Agent |
| GitHub Repository | deepithk/autonomous-ui-test-agent |
| GitHub Issue | #1 |
| GitHub Project | Autonomous UI QA Board |
| Project Status | RFQA |
| Application | SauceDemo |
| Application URL | https://www.saucedemo.com/ |
| Feature | Add and Remove Products from Shopping Cart |

## 2. Test Data

| Data | Value / Source |
|---|---|
| Application URL | https://www.saucedemo.com/ |
| Username | Local environment configuration |
| Password | Local environment configuration |
| Test Product | The first product listed (Sauce Labs Backpack in the latest run) |
| Expected Quantity | 1 |

Credentials come from local environment variables and are never hardcoded in
source code, plans or reports.

The agent identifies product details from the actual page, rather than
assuming a fixed product or page structure. The product name and price it
reads are reused in later steps and assertions.

## 3. Reference Scenarios and the Generated Plan

### Reference scenarios

| ID | Scenario Name | Acceptance Criteria | Priority |
|---|---|---|---|
| RS-001 | Successful Login | AC-01 | High |
| RS-002 | Add Product to Cart | AC-02 | High |
| RS-003 | Verify Cart Count | AC-03 | High |
| RS-004 | Verify Cart Contents | AC-04 | High |
| RS-005 | Remove Product from Cart | AC-05 | High |
| RS-006 | Verify Empty Cart | AC-06 | High |

Total reference scenarios: 6

### What the agent actually generates

Each generated scenario must start from a fresh browser, so the planner
combines reference scenarios that depend on the same state. The latest plan
has three scenarios:

| Generated ID | Generated scenario | Acceptance criteria | Covers reference scenarios |
|---|---|---|---|
| SC-001 | Verify successful login | AC-01 | RS-001 |
| SC-002 | Add product to shopping cart and verify badge update | AC-02, AC-03 | RS-002, RS-003 |
| SC-003 | Verify cart contents and remove product from cart | AC-04, AC-05, AC-06 | RS-004, RS-005, RS-006 |

The grouping can change when the plan is regenerated. What does not change
is the coverage rule: every acceptance criterion needs at least one
assertion, and a plan that misses one is rejected before any browser opens.

## 4. Reference Scenario Details

### RS-001: Successful Login

**Acceptance Criteria:** AC-01

**Objective:**

Verify that a user can successfully log in using valid credentials.

**Preconditions:**
- SauceDemo application is accessible.
- User is on the login page.
- Valid credentials are available through environment configuration.

**Execution Steps:**
1. Open the login page.
2. Identify the username input.
3. Enter the configured username.
4. Identify the password input.
5. Enter the configured password.
6. Identify and activate the Login button.

**Expected Results:**
- Login succeeds.
- Products inventory page is displayed.

**Assertions:**
- Current URL corresponds to the inventory page.

---

### RS-002: Add Product to Cart

**Acceptance Criteria:** AC-02

**Objective:**

Verify that a selected product can be added to the shopping cart.

**Preconditions:**
- User is successfully logged in.
- Products inventory page is displayed.
- Shopping cart is initially empty.

**Execution Steps:**
1. Observe the product inventory and note the first product's name and price.
2. Locate the Add to cart button that belongs to that product.
3. Activate the button.

**Expected Results:**
- Selected product is added to the cart.
- The product action changes to Remove.

**Assertions:**
- The product's action button now reads Remove.

---

### RS-003: Verify Shopping Cart Count

**Acceptance Criteria:** AC-03

**Objective:**

Verify that the shopping cart badge reflects the correct number of items.

**Preconditions:**
- User is successfully logged in.
- Products inventory page is displayed.
- Shopping cart is initially empty.

**Execution Steps:**
1. Add one product to the shopping cart.
2. Read the shopping cart badge.

**Expected Results:**
- Cart badge displays 1 after adding one product.

**Assertions:**
- Displayed count equals 1.

---

### RS-004: Verify Shopping Cart Contents

**Acceptance Criteria:** AC-04

**Objective:**

Verify that the shopping cart displays the correct product details.

**Preconditions:**
- User is successfully logged in.
- One product has been added to the cart.

**Execution Steps:**
1. Identify and open the shopping cart.
2. Read the product name, quantity and price.

**Expected Results:**
- Shopping cart displays the selected product.
- Product name is correct.
- Quantity is 1.
- Price matches the price displayed in the inventory.

**Assertions:**
- Product name equals the name captured from the inventory.
- Quantity equals 1.
- Price equals the price captured from the inventory.

---

### RS-005: Remove Product from Cart

**Acceptance Criteria:** AC-05

**Objective:**

Verify that a product can be removed from the shopping cart.

**Preconditions:**
- User is successfully logged in.
- Shopping cart contains one product.
- Cart page is displayed.

**Execution Steps:**
1. Locate the Remove button that belongs to the selected product.
2. Activate Remove.

**Expected Results:**
- Selected product is removed successfully.
- Product is no longer displayed in the cart.

**Assertions:**
- The selected product is absent from the cart (zero matching items).

---

### RS-006: Verify Empty Shopping Cart

**Acceptance Criteria:** AC-06

**Objective:**

Verify that the shopping cart reflects an empty state after removing the product.

**Preconditions:**
- User is successfully logged in.
- A product was previously added to the cart.
- Product has been removed.

**Execution Steps:**
1. Observe the shopping cart after removal.

**Expected Results:**
- No products are displayed in the cart.
- Cart badge is absent when the cart is empty, consistent with SauceDemo behaviour.

**Assertions:**
- The cart contains zero product items.
- The cart badge is absent (zero matching elements).

---

## 5. Scenario Execution Rules

1. Scenarios are generated dynamically from the GitHub acceptance criteria.
2. Predefined executable automation scripts are not used.
3. Elements are identified from the actual page, using accessible roles, names, labels and visible text, and the page hierarchy when the plan alone is ambiguous.
4. A fresh page snapshot is read before every action and every assertion; old element references are never reused.
5. Every scenario runs in its own fresh browser.
6. Assertions run right after the step they belong to, and a screenshot is saved.
7. If a step fails, the scenario stops, the remaining steps are skipped and assertions that did not run are reported as "not evaluated".
8. Step, scenario-time and action-time limits apply, and element lookup is retried only within the configured limit.

## 6. Test Result Classification

Each scenario ends with one of three results.

**passed**
- Every step ran and every assertion was supported by what the page actually showed.

**failed**
- A step failed, or the application demonstrably did not match an assertion.

**error**
- Nothing failed, but the scenario could not be fully checked: a time limit was reached, the browser could not start, or an assertion could not be evaluated. This is the equivalent of "blocked".

Each acceptance criterion also gets a PASSED, FAILED or ERROR verdict from the assertions written for it. An LLM response alone never determines a pass.

## 7. Evidence Requirements

For each scenario the run records:

- Scenario ID.
- Acceptance criteria IDs.
- Execution timestamp (in the report).
- Step results: status, duration, and how the element was found (also written line by line to the execution log).
- Screenshot references.
- Expected and actual value of every assertion.
- Final status.
- Failure explanation, where applicable.

Evidence is stored under:

```
evidence/
  reports/       plan and execution reports (JSON and Markdown)
  logs/          one step-by-step execution log per run
  screenshots/   one folder per run
```

Browser video is not produced.

## 8. Acceptance Criteria Coverage

| AC ID | Reference scenario | Generated scenario (latest plan) | Coverage |
|---|---|---|---|
| AC-01 | RS-001 | SC-001 | Login validation |
| AC-02 | RS-002 | SC-002 | Product addition |
| AC-03 | RS-003 | SC-002 | Cart badge validation |
| AC-04 | RS-004 | SC-003 | Cart contents validation |
| AC-05 | RS-005 | SC-003 | Product removal |
| AC-06 | RS-006 | SC-003 | Empty cart validation |

Total Acceptance Criteria: 6

Mapped Acceptance Criteria: 6

Coverage: 100%

## 9. Latest Execution Result

Run of 2026-11-11 05:20 UTC. The plan was written by `gemini-3.6-flash`; the
execution used `gemini-3.5-flash-lite` and made 7 LLM requests (3 answers
were reused).

| Scenario | Result | Assertions |
|---|---|---|
| SC-001 Verify successful login | passed | 1 of 1 |
| SC-002 Add product to shopping cart and verify badge update | passed | 2 of 2 |
| SC-003 Verify cart contents and remove product from cart | passed | 6 of 6 |

| AC ID | Verdict | Assertions passed |
|---|---|---|
| AC-01 | PASSED | 1/1 |
| AC-02 | PASSED | 1/1 |
| AC-03 | PASSED | 1/1 |
| AC-04 | PASSED | 3/3 |
| AC-05 | PASSED | 1/1 |
| AC-06 | PASSED | 2/2 |

Evidence:

- [Execution report](evidence/reports/test-execution-issue-1-2026-11-11T05-20-46-600Z.md)
- [Execution log](evidence/logs/test-execution-2026-11-11T05-20-46-600Z.log)
- [Screenshots](evidence/screenshots/2026-11-11T05-20-46-600Z/)

## 10. Important Implementation Note

The reference scenarios define the expected functional coverage and
validation outcomes. They are not executable test scripts.

The agent independently retrieves the GitHub issue, understands its
acceptance criteria and generates the executable plan dynamically.

If the GitHub issue changes, the agent uses the updated issue content, not
this document, as its source of truth at run time.
