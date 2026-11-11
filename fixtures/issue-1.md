# Feature: Add and Remove Products from Shopping Cart

## User Story

As a shopping user, I want to add products to my shopping cart and remove them when necessary, so that my cart accurately reflects the products I intend to purchase.

## Application Under Test

- Application: SauceDemo
- URL: https://www.saucedemo.com/
- Feature: Product selection and shopping cart management

## Acceptance Criteria

### AC-01: Successful Login

Given the user is on the login page,

When valid credentials are entered,

Then the products inventory page should be displayed.

### AC-02: Add Product to Cart

Given the user is on the products inventory page,

When the user selects Add to cart for a product,

Then the selected product should be added to the shopping cart.

### AC-03: Update Cart Count

Given a product has been added,

Then the shopping cart badge should display the correct item count.

### AC-04: Verify Cart Contents

Given a product has been added,

When the user opens the shopping cart,

Then the cart should display the correct product name, quantity and price.

### AC-05: Remove Product

Given the shopping cart contains a product,

When the user selects Remove,

Then the product should be removed from the cart.

### AC-06: Verify Empty Cart

Given the product has been removed,

Then the shopping cart should contain no products and the cart badge should reflect the empty state.

## Out of Scope

- Payment processing.
- Order placement.
- Multiple-user scenarios.
- Performance and load testing.
- Mobile testing.

## Testing Expectations

The autonomous testing agent should read these acceptance criteria dynamically, generate test scenarios, interact with the application through a browser and validate the actual application behaviour.

The agent must not rely on predefined test scripts for this feature.
