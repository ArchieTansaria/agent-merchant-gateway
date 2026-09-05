# AGENTS.md

## Project

This repository contains a hackathon project called "AI Commerce Readiness Agent".

The goal is to make an ordinary merchant ready for autonomous AI commerce.

The core product flow is:

Merchant data
→ AI readiness audit
→ safe autonomous corrections
→ merchant review for ambiguous/sensitive issues
→ re-audit
→ AI-ready merchant
→ AI buyer can eventually transact through a standardized commerce interface
→ Razorpay handles payment.

## Current Priority

The immediate priority is ONLY the AI Commerce Readiness Agent.

Do not implement the AI buyer, Razorpay integration, MCP, formal JSON schemas, multi-merchant support, Shopify/WooCommerce integrations, or production authentication until explicitly requested.

The current milestone is:

Upload/ingest merchant data
→ analyze readiness
→ identify issues
→ automatically fix safe issues
→ send ambiguous/sensitive issues to merchant review
→ show before/after changes
→ re-audit and show improved readiness score.

## Core Product Principles

1. The readiness agent must DO work, not merely produce recommendations.

2. Safe, deterministic or high-confidence corrections may be applied automatically.

3. Ambiguous, sensitive, or business-policy decisions must NOT be invented by the AI.
   These should be sent to a merchant review queue.

4. Explicit merchant rules are authoritative.
   The agent must never silently modify or optimize them.

5. Never invent:
   - prices
   - discounts
   - return policies
   - shipping restrictions
   - autonomous spending limits
   - authorization rules
   - other merchant business policies.

6. LLM reasoning should propose semantic corrections, classifications, and
   interpretations. Deterministic application/validation code should decide
   whether a proposed change is structurally safe to apply.

7. Keep the architecture simple and hackathon-focused.
   Prefer a single application and simple modules over microservices or
   unnecessary infrastructure.

8. Do not over-engineer abstractions for future integrations.

## Development Principles

- Inspect the existing repository before modifying it.
- Reuse existing dependencies and patterns where reasonable.
- Do not add dependencies unless necessary.
- Keep changes focused on the requested milestone.
- After implementation, run the relevant tests/build/type checks.
- Do not silently change unrelated functionality.
- Do not create fake implementations that merely look complete.
- Prefer a small working vertical slice over broad incomplete functionality.

## Important Terminology

Readiness Agent:
The AI-powered component that audits merchant commerce data, fixes safe issues,
and escalates ambiguous decisions.

AI Commerce Interface:
The future standardized interface through which external AI buyers will
interact with the merchant.

Policy Engine:
The future deterministic layer that enforces merchant rules during autonomous
commerce actions.

Razorpay:
The payment infrastructure. Do not implement Razorpay integration during the
initial readiness-agent milestone.

## Current Non-Goals

Do not build:

- MCP
- Razorpay integration
- payment processing
- AI buyer
- merchant discovery
- Shopify/WooCommerce connectors
- multi-merchant infrastructure
- production auth
- distributed services
- formal AI Commerce Contract/JSON Schema system

These may be added later.

## Quality Bar

Every agentic behavior should be explainable.

For each automatic correction, record:

- what changed
- before value
- after value
- why it was changed
- confidence/reason
- whether it was automatically applied or requires review.

The merchant should always be able to understand what the agent changed.
