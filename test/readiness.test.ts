import assert from "node:assert/strict";
import test from "node:test";

import { demoMerchant } from "../src/data/demoMerchant.ts";
import { auditMerchant } from "../src/readiness/audit.ts";
import { ingestMerchant } from "../src/readiness/ingest.ts";
import type { MerchantData } from "../src/readiness/types.ts";

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

  assert.equal(audit.overallScore, 61);
  assert.equal(audit.issueCount, 10);
  assert.deepEqual(
    Object.fromEntries(audit.categoryScores.map((score) => [score.category, score.score])),
    {
      productData: 16,
      variantQuality: 16,
      inventoryQuality: 14,
      policyCompleteness: 15,
    },
  );
  assert.deepEqual(
    audit.issues.map((issue) => issue.issueType),
    [
      "CATEGORY_NOT_CANONICAL",
      "REQUIRED_ATTRIBUTE_MISSING",
      "PRODUCT_DESCRIPTION_INSUFFICIENT",
      "REQUIRED_ATTRIBUTE_MISSING",
      "PRICE_INVALID",
      "VARIANT_OPTIONS_MISSING",
      "PRODUCT_NAME_MISSING",
      "INVENTORY_LINK_MISSING",
      "INVENTORY_QUANTITY_INVALID",
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
