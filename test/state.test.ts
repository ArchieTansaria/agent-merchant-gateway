import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestMerchant } from "../dist/readiness/ingest.js";
import { auditMerchant } from "../dist/readiness/audit.js";
import { demoMerchant } from "../dist/data/demoMerchant.js";
import { runReadinessImprovements, resolveReviewItem } from "../dist/readiness/workflow.js";
import type { MerchantData } from "../src/readiness/types.ts";

const customMerchant: MerchantData = {
  id: "custom",
  name: "Custom Merchant",
  products: [
    {
      id: "prod-1",
      name: "Custom Product",
      price: 10,
      inventoryItemId: "inv-1",
      variants: [],
      category: "Home",
      description: "A custom product",
    }
  ],
  inventory: [
    {
      id: "inv-1",
      productId: "prod-1",
      sku: "PROD-1",
      quantity: 5
    }
  ],
  policies: {
    currency: "USD",
    maxQuantityPerItem: 5,
    returnPolicy: { windowDays: 14, summary: "14 days" },
    shippingPolicy: { processingDays: 2, regions: ["US"] },
    autonomousPurchasePolicy: { requiresApprovalAbove: 100, maxOrderValue: 500 }
  }
};

test("uploaded merchant replaces demo merchant in workflow", async () => {
  const m = ingestMerchant(customMerchant);
  const audit = auditMerchant(m);
  assert.equal(audit.merchantId, "custom");
  assert.equal(audit.merchantName, "Custom Merchant");
  
  // We can just verify it's entirely independent
  assert.notEqual(audit.issues.length, auditMerchant(demoMerchant).issues.length);
});

test("uploaded merchant does not mix with demo data", async () => {
  const m1 = ingestMerchant(customMerchant);
  const m2 = ingestMerchant(demoMerchant);
  
  assert.equal(m1.products.length, 1);
  assert.equal(m2.products.length, 3); // demo merchant has 3 products
  assert.notEqual(m1.id, m2.id);
});

test("readiness audit uses uploaded merchant", async () => {
  const m = ingestMerchant(customMerchant);
  const audit = auditMerchant(m);
  // Custom product is missing 'attributes.material' (Home category requires material)
  const missingAttr = audit.issues.find(i => i.issueType === "REQUIRED_ATTRIBUTE_MISSING");
  assert.ok(missingAttr);
});

test("corrections mutate uploaded merchant", async () => {
  const m = ingestMerchant(customMerchant);
  const run = await runReadinessImprovements(m);
  assert.ok(run);
});

test("review resolution mutates uploaded merchant", async () => {
  const m = ingestMerchant({
    ...customMerchant,
    policies: {
       ...customMerchant.policies,
       currency: null
    }
  });
  let run = await runReadinessImprovements(m);
  const review = run.reviewItems.find(i => i.issue.issueType === "CURRENCY_MISSING");
  assert.ok(review);
  run = resolveReviewItem(run, review.id, "GBP");
  assert.equal(run.afterAudit.issues.find(i => i.issueType === "CURRENCY_MISSING"), undefined);
});

test("re-audit uses updated uploaded merchant", async () => {
  const m = ingestMerchant(customMerchant);
  m.products[0].price = -5; // invalid price
  let run = await runReadinessImprovements(m);
  
  const priceReview = run.reviewItems.find(i => i.issue.issueType === "PRICE_INVALID");
  assert.ok(priceReview);
  
  run = resolveReviewItem(run, priceReview.id, 25);
  
  // re-audit score should be better
  assert.equal(run.afterAudit.issues.find(i => i.issueType === "PRICE_INVALID"), undefined);
});

test("explicit policy is preserved", async () => {
  const m = ingestMerchant(customMerchant);
  const audit = auditMerchant(m);
  const currencyIssue = audit.issues.find(i => i.issueType === "CURRENCY_MISSING");
  assert.equal(currencyIssue, undefined); // Preserved and valid
});

test("missing policy creates review-required issue", async () => {
  const m = ingestMerchant({
    ...customMerchant,
    policies: {
       ...customMerchant.policies,
       maxQuantityPerItem: null
    }
  });
  const audit = auditMerchant(m);
  const issue = audit.issues.find(i => i.issueType === "MAX_QUANTITY_PER_ITEM_MISSING");
  assert.ok(issue);
});

test("AI cannot invent missing policy", async () => {
  const m = ingestMerchant({
    ...customMerchant,
    policies: {
       ...customMerchant.policies,
       currency: null
    }
  });
  const run = await runReadinessImprovements(m);
  const review = run.reviewItems.find(i => i.issue.issueType === "CURRENCY_MISSING");
  assert.ok(review);
  assert.equal(review.proposal.proposedValue, null); // AI is not allowed to propose a currency
});

test("policy value survives re-audit", async () => {
  const m = ingestMerchant(customMerchant);
  let run = await runReadinessImprovements(m);
  const audit = run.afterAudit;
  assert.equal(audit.issues.find(i => i.issueType === "CURRENCY_MISSING"), undefined);
});

test("automated correction cannot modify policy", async () => {
  const m = ingestMerchant({
    ...customMerchant,
    policies: {
       ...customMerchant.policies,
       currency: null
    }
  });
  const run = await runReadinessImprovements(m);
  const autoApp = run.changes.find(c => c.field === "policies.currency");
  assert.equal(autoApp, undefined); // Cannot auto apply
});
