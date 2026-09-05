import assert from "node:assert/strict";
import test from "node:test";

import { demoMerchant } from "../dist/data/demoMerchant.js";
import { auditMerchant } from "../dist/readiness/audit.js";
import { ingestMerchant } from "../dist/readiness/ingest.js";
import { proposeCorrections } from "../dist/readiness/proposals.js";
import { validateCorrectionProposal } from "../dist/readiness/validator.js";
import { applyValidatedCorrections, resolveReviewItem, rollbackChanges, runReadinessImprovements } from "../dist/readiness/workflow.js";
import type { CorrectionProposal, MerchantData } from "../src/readiness/types.ts";

function validMerchant(): MerchantData {
  return {
    id: "merchant-test",
    name: "Test Merchant",
    products: [
      {
        id: "prod-1",
        name: "Trail Jacket",
        description:
          "A weather-resistant trail jacket with an adjustable hood, durable shell, and comfortable everyday fit.",
        category: "Apparel",
        attributes: { material: "nylon", color: "green", size: "M" },
        price: 5999,
        inventoryItemId: "inv-1",
        variants: [
          { sku: "JACKET-GREEN-M", options: { color: "green", size: "M" } },
          { sku: "JACKET-GREEN-L", options: { color: "green", size: "L" } },
        ],
      },
    ],
    inventory: [{ id: "inv-1", productId: "prod-1", sku: "JACKET", quantity: 8 }],
    policies: {
      returnPolicy: { windowDays: 30, summary: "Unused products may be returned in original condition." },
      shippingPolicy: { regions: ["India"], processingDays: 2 },
      autonomousPurchasePolicy: { requiresApprovalAbove: 10000 },
    },
  };
}

function issueTypes(merchant: MerchantData): string[] {
  return auditMerchant(merchant).issues.map((issue) => issue.issueType);
}

test("demo merchant produces the documented deterministic readiness audit", () => {
  const audit = auditMerchant(ingestMerchant(demoMerchant));

  assert.equal(audit.overallScore, 60);
  assert.equal(audit.issueCount, 10);
  assert.deepEqual(
    Object.fromEntries(audit.categoryScores.map((score) => [score.category, score.score])),
    {
      productData: 18,
      variantQuality: 16,
      inventoryQuality: 11,
      policyCompleteness: 15,
    },
  );
  assert.deepEqual(
    audit.issues.map((issue) => issue.issueType),
    [
      "CATEGORY_NOT_CANONICAL",
      "PRODUCT_DESCRIPTION_INSUFFICIENT",
      "REQUIRED_ATTRIBUTE_MISSING",
      "PRICE_INVALID",
      "VARIANT_OPTIONS_MISSING",
      "PRODUCT_NAME_MISSING",
      "INVENTORY_LINK_MISSING",
      "INVENTORY_QUANTITY_INVALID",
      "INVENTORY_NOT_LINKED",
      "AUTONOMOUS_PURCHASE_BOUNDARY_MISSING",
    ],
  );
});

test("a complete catalog receives a perfect score with no issues", () => {
  const audit = auditMerchant(validMerchant());

  assert.equal(audit.overallScore, 100);
  assert.equal(audit.issueCount, 0);
  assert.ok(audit.categoryScores.every((score) => score.score === score.maximum));
});

test("product, category, attribute, price, variant, and inventory link checks are reported", () => {
  const merchant = validMerchant();
  const product = merchant.products[0];
  product.name = " ";
  product.description = "Too short";
  product.category = "Unknown category";
  product.attributes = {};
  product.price = -5;
  product.variants = [];
  product.inventoryItemId = "missing-inventory";

  assert.deepEqual(issueTypes(merchant), [
    "PRODUCT_NAME_MISSING",
    "PRODUCT_DESCRIPTION_INSUFFICIENT",
    "CATEGORY_UNRECOGNIZED",
    "PRICE_INVALID",
    "VARIANT_STRUCTURE_INVALID",
    "INVENTORY_RECORD_NOT_FOUND",
    "INVENTORY_NOT_LINKED",
  ]);
});

test("variant option shape and inventory quantity checks are deterministic", () => {
  const merchant = validMerchant();
  merchant.products[0].variants = [
    { sku: "JACKET-GREEN-M", options: { color: "green" } },
    { sku: "JACKET-GREEN-L", options: { size: "L" } },
  ];
  merchant.inventory[0].quantity = -1;

  assert.deepEqual(issueTypes(merchant), [
    "VARIANT_OPTION_KEYS_INCONSISTENT",
    "INVENTORY_QUANTITY_INVALID",
  ]);
});

test("incomplete merchant policies are surfaced without assigning policy values", () => {
  const merchant = validMerchant();
  merchant.policies = {};

  assert.deepEqual(issueTypes(merchant), [
    "RETURN_POLICY_INCOMPLETE",
    "SHIPPING_POLICY_INCOMPLETE",
    "AUTONOMOUS_PURCHASE_BOUNDARY_MISSING",
  ]);
});

test("ingestion creates an independent audit snapshot and does not correct data", () => {
  const input = validMerchant();
  const ingested = ingestMerchant(input);
  ingested.products[0].name = "Changed only in snapshot";

  assert.equal(input.products[0].name, "Trail Jacket");
  assert.equal(ingested.products[0].name, "Changed only in snapshot");
});

test("malformed merchant input is normalized into an auditable snapshot", () => {
  const malformed = ingestMerchant({ products: [null, { id: "bad-product", price: -1 }], inventory: "bad" });
  const audit = auditMerchant(malformed);

  assert.equal(malformed.products.length, 2);
  assert.ok(audit.issues.some((issue) => issue.issueType === "PRODUCT_NAME_MISSING"));
  assert.ok(audit.issues.some((issue) => issue.issueType === "PRICE_INVALID"));
});

test("safe proposals are validated, applied to a clone, and improve the audit score", () => {
  const sourceBefore = structuredClone(demoMerchant);
  const run = runReadinessImprovements(demoMerchant);

  assert.equal(run.beforeAudit.overallScore, 60);
  assert.equal(run.afterAudit.overallScore, 75);
  assert.equal(run.changes.length, 3);
  assert.deepEqual(run.changes.map((change) => change.status), ["AUTO_APPLIED", "AUTO_APPLIED", "AUTO_APPLIED"]);
  assert.equal(run.afterAudit.issues.some((issue) => issue.issueType === "CATEGORY_NOT_CANONICAL"), false);
  assert.equal(run.afterAudit.issues.some((issue) => issue.issueType === "VARIANT_OPTIONS_MISSING"), false);
  assert.equal(run.afterAudit.issues.some((issue) => issue.issueType === "INVENTORY_LINK_MISSING"), false);
  assert.deepEqual(demoMerchant, sourceBefore);
});

test("change log retains before values and rollback restores the pre-application snapshot", () => {
  const run = runReadinessImprovements(demoMerchant);
  const rollback = rollbackChanges(run.merchant, run.changes);

  assert.equal(rollback.changes.length, 3);
  assert.ok(rollback.changes.every((change) => change.status === "ROLLED_BACK"));
  assert.deepEqual(rollback.merchant, run.sourceMerchant);
});

test("ambiguous and merchant-sensitive issues enter review without mutation", () => {
  const run = runReadinessImprovements(demoMerchant);
  const policyReview = run.reviewItems.find(
    (item) => item.issue.issueType === "AUTONOMOUS_PURCHASE_BOUNDARY_MISSING",
  );

  assert.equal(run.reviewItems.length, 6);
  assert.ok(policyReview);
  assert.equal(policyReview?.status, "REVIEW_REQUIRED");
  assert.equal(run.merchant.policies.autonomousPurchasePolicy, null);
  assert.equal(run.changes.some((change) => change.entity.type === "merchant_policy"), false);
});

test("merchant-entered policy value resolves only that review issue and re-audits", () => {
  const run = runReadinessImprovements(demoMerchant);
  const policyReview = run.reviewItems.find(
    (item) => item.issue.issueType === "AUTONOMOUS_PURCHASE_BOUNDARY_MISSING",
  );
  assert.ok(policyReview);
  const resolved = resolveReviewItem(run, policyReview!.id, "5000");

  assert.equal(resolved.afterAudit.overallScore, 80);
  assert.equal(resolved.afterAudit.issues.some((issue) => issue.issueType === "AUTONOMOUS_PURCHASE_BOUNDARY_MISSING"), false);
  assert.equal(resolved.merchant.policies.autonomousPurchasePolicy?.requiresApprovalAbove, 5000);
  assert.equal(resolved.changes.at(-1)?.status, "MERCHANT_APPLIED");
  assert.equal(demoMerchant.policies.autonomousPurchasePolicy, undefined);
});

test("invalid, low-confidence, and malicious AI proposals cannot mutate merchant data", () => {
  const merchant = ingestMerchant(demoMerchant);
  const audit = auditMerchant(merchant);
  const categoryProposal = proposeCorrections(merchant, audit).find(
    (proposal) => proposal.correctionType === "NORMALIZE_CATEGORY",
  )!;
  const lowConfidence = { ...categoryProposal, confidence: 0.2 };
  const policyIssue = audit.issues.find((issue) => issue.issueType === "AUTONOMOUS_PURCHASE_BOUNDARY_MISSING")!;
  const maliciousPolicy: CorrectionProposal = {
    issueId: policyIssue.id,
    entityId: policyIssue.affectedEntity.id,
    field: policyIssue.affectedField,
    currentValue: undefined,
    proposedValue: 999999,
    reason: "Invented policy",
    confidence: 1,
    action: "AUTO_APPLY",
    correctionType: "SET_POLICY",
  };

  assert.equal(validateCorrectionProposal(merchant, audit, {}).action, "REJECT");
  assert.equal(validateCorrectionProposal(merchant, audit, { ...categoryProposal, entityId: "missing" }).action, "REJECT");
  assert.equal(validateCorrectionProposal(merchant, audit, { ...categoryProposal, field: "unknown.field" }).action, "REJECT");
  assert.equal(validateCorrectionProposal(merchant, audit, { ...categoryProposal, proposedValue: "Electronics" }).action, "REJECT");
  assert.equal(validateCorrectionProposal(merchant, audit, lowConfidence).action, "REVIEW_REQUIRED");
  assert.equal(validateCorrectionProposal(merchant, audit, maliciousPolicy).action, "REJECT");
  assert.equal(merchant.policies.autonomousPurchasePolicy, null);
  assert.equal(merchant.products[0].category, "apparel ");
});

test("review and reject validation results produce no writes when application is attempted", () => {
  const merchant = ingestMerchant(demoMerchant);
  const audit = auditMerchant(merchant);
  const categoryProposal = proposeCorrections(merchant, audit).find(
    (proposal) => proposal.correctionType === "NORMALIZE_CATEGORY",
  )!;
  const review = validateCorrectionProposal(merchant, audit, { ...categoryProposal, confidence: 0.2 });
  const reject = validateCorrectionProposal(merchant, audit, { ...categoryProposal, proposedValue: "Home" });
  const applied = applyValidatedCorrections(merchant, audit.issues, [review, reject]);

  assert.equal(applied.changes.length, 0);
  assert.deepEqual(applied.merchant, merchant);
});

test("automatic corrections never alter an explicit merchant policy", () => {
  const merchant = validMerchant();
  merchant.products[0].category = "apparel";
  const originalPolicies = structuredClone(merchant.policies);
  const run = runReadinessImprovements(merchant);

  assert.equal(run.changes.length, 1);
  assert.deepEqual(run.merchant.policies, originalPolicies);
});

test("invalid merchant review input leaves the workflow and merchant data unchanged", () => {
  const run = runReadinessImprovements(demoMerchant);
  const priceReview = run.reviewItems.find((item) => item.issue.issueType === "PRICE_INVALID")!;
  const unchanged = resolveReviewItem(run, priceReview.id, "0");

  assert.equal(unchanged, run);
  assert.equal(run.merchant.products.find((product) => product.id === "prod-travel-mug")?.price, 0);
});

test("a second correction run is idempotent and produces no duplicate changes", () => {
  const firstRun = runReadinessImprovements(demoMerchant);
  const secondRun = runReadinessImprovements(firstRun.merchant);

  assert.equal(secondRun.afterAudit.overallScore, firstRun.afterAudit.overallScore);
  assert.equal(secondRun.changes.length, 0);
  assert.equal(secondRun.proposals.some((proposal) => proposal.action === "AUTO_APPLY"), false);
});

test("complete merchant review can resolve the remaining demo issues to an AI-ready score", () => {
  let run = runReadinessImprovements(demoMerchant);
  const values: Record<string, string> = {
    PRODUCT_DESCRIPTION_INSUFFICIENT: "An insulated stainless steel travel mug with a leak-resistant lid for daily commutes and warm drinks.",
    REQUIRED_ATTRIBUTE_MISSING: "8 cm × 8 cm × 15 cm",
    PRICE_INVALID: "1999",
    PRODUCT_NAME_MISSING: "Pocket Speaker",
    INVENTORY_QUANTITY_INVALID: "10",
    AUTONOMOUS_PURCHASE_BOUNDARY_MISSING: "5000",
  };

  for (const item of run.reviewItems) {
    run = resolveReviewItem(run, item.id, values[item.issue.issueType]);
  }

  assert.equal(run.afterAudit.overallScore, 100);
  assert.equal(run.afterAudit.issueCount, 0);
  assert.equal(run.reviewItems.every((item) => item.status === "RESOLVED"), true);
});
