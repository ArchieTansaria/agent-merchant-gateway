# AI Commerce Readiness Agent

## Problem

AI buyers are increasingly capable of discovering and purchasing products
autonomously.

However, ordinary merchant data is often not structured, consistent, or
explicit enough for reliable AI commerce.

A merchant may have:

- inconsistent product attributes
- inconsistent categories
- poorly structured variants
- disconnected inventory
- unstructured shipping/return information
- ambiguous autonomous-commerce policies
- missing machine-readable commerce capabilities.

The project turns this messy merchant information into an AI-ready commerce
representation.

## Product Thesis

An AI-ready catalog makes a merchant understandable.

An AI Commerce Interface eventually makes the merchant actionable.

The Readiness Agent is responsible for getting the merchant from ordinary
commerce data to an AI-ready state.

## Readiness Agent Flow

1. Merchant provides commerce information.
2. Agent audits the information.
3. Agent calculates an AI commerce readiness score.
4. Agent identifies issues.
5. Agent automatically fixes safe issues.
6. Agent sends ambiguous/sensitive issues to merchant review.
7. Merchant resolves review items.
8. Agent re-audits the merchant.
9. Readiness score improves.
10. The merchant is marked AI-ready.

## Safe Automatic Corrections

Examples:

- normalize category names when the mapping is unambiguous
- normalize color names such as "blk" → "black"
- extract structured attributes from clear product descriptions
- normalize variant representations
- normalize formatting
- identify and link inventory when the relationship is unambiguous
- convert clearly structured merchant information into machine-readable fields.

## Never Automatically Invent

The agent must never invent or silently modify:

- prices
- discounts
- return windows
- shipping restrictions
- autonomous purchase limits
- approval thresholds
- authorization requirements
- merchant-defined policies.

If a policy is missing or ambiguous, create a merchant review item.

## Example Review Item

Problem:

"Autonomous purchase limit is not defined."

The agent should NOT assume a value.

Instead:

Status: REVIEW_REQUIRED

Reason:
AI buyers need an explicit autonomous purchase boundary.

Merchant must provide the value.

## Readiness Score

The score should be explainable.

Potential categories:

- Product data
- Variant quality
- Inventory quality
- Policy completeness
- Commerce capability readiness

The exact scoring formula should be simple and deterministic.

Example:

Before:
67 / 100

After automatic corrections:
86 / 100

After merchant resolves review items:
94 / 100

## Change Log

Every correction should be visible.

Example:

AUTO-FIXED

Field:
color

Before:
blk

After:
black

Reason:
Recognized standard abbreviation.

Confidence:
High

Another example:

REVIEW REQUIRED

Field:
autonomous purchase limit

Problem:
No explicit value was found.

Action:
Merchant decision required.

## Demo Merchant

The demo merchant should intentionally contain imperfect data so the
readiness agent has meaningful work to perform.

The demo should contain examples of:

- inconsistent categories
- inconsistent attributes
- malformed/unclear variants
- missing structured information
- ambiguous policy information.

Do not make the dataset unrealistically broken.

## Future Architecture

Eventually the system will be:

Merchant
→ Readiness Agent
→ AI-ready merchant
→ AI Commerce Interface
→ external AI buyer
→ merchant commerce execution
→ Razorpay payment.

The current milestone only implements the Readiness Agent portion.

## Future AI Commerce Interface

The eventual interface may expose capabilities such as:

- search products
- get product
- check inventory
- create cart
- add item
- checkout

It will eventually provide a trusted execution boundary for autonomous
commerce and deterministic policy enforcement.

This is NOT part of the current milestone.
