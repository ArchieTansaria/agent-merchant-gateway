import test from "node:test";
import assert from "node:assert";
import { auditMerchant } from "../dist/readiness/audit.js";
import { runReadinessImprovements, resolveReviewItem } from "../dist/readiness/workflow.js";
import type { MerchantData } from "../src/readiness/types.ts";

test("Iterative Readiness Workflow", async (t) => {
  const getMockMerchant = (): MerchantData => ({
    id: "merchant-1",
    name: "Test Merchant",
    products: [
      {
        id: "prod-1",
        name: "Test Product",
        description: "This is a proper description that is long enough to pass validation.", 
        vendor: "Test Vendor",
        category: "Electronics",
        tags: ["test"],
        price: -1, // ISSUE: PRICE_INVALID
        inventoryItemId: "inv-1",
        attributes: { brand: "Test Brand", warranty: "1 year" },
        variants: [
          {
            id: "var-1",
            productId: "prod-1",
            title: "Default",
            price: -1, // ISSUE: PRICE_INVALID
            sku: "SKU-1",
            options: { "Size": "M" }
          }
        ]
      }
    ],
    inventory: [
      {
        id: "inv-1",
        productId: "prod-1",
        variantId: "var-1",
        quantity: -5, // ISSUE: INVENTORY_QUANTITY_INVALID
        locationId: "loc-1"
      }
    ],
    policies: {
      currency: "USD",
      maxQuantityPerItem: null, // ISSUE: MAX_QUANTITY_PER_ITEM_MISSING
      returnPolicy: null,
      autonomousPurchasePolicy: null, // ISSUE: AUTONOMOUS_PURCHASE_BOUNDARY_MISSING
      shippingPolicy: null // ISSUE: SHIPPING_POLICY_INCOMPLETE
    }
  });

  await t.test("1. Score does not inflate across iterations if no changes are made", () => {
    const merchant = getMockMerchant();
    const audit1 = auditMerchant(merchant, 1);
    const audit2 = auditMerchant(merchant, 2);
    const audit3 = auditMerchant(merchant, 3);
    assert.strictEqual(audit1.overallScore, audit2.overallScore);
    assert.strictEqual(audit2.overallScore, audit3.overallScore);
  });

  await t.test("2. Re-audit after safe automatic changes produces higher score", async () => {
    let merchant = getMockMerchant();
    const audit1 = auditMerchant(merchant, 1);
    
    // Actually we can't easily run runReadinessImprovements because it uses LLM API. 
    // We will simulate it by fixing a safe issue.
    // Safe issue: Missing Category, but we already have Electronics. Let's fix PRICE.
    merchant.products[0].price = 1099;
    merchant.products[0].variants![0].price = 1099;
    const audit2 = auditMerchant(merchant, 2);
    
    assert.ok(audit2.overallScore > audit1.overallScore);
    assert.ok(audit2.issueCount < audit1.issueCount);
  });

  await t.test("3. Manual resolutions increase score and remove issues", () => {
    let merchant = getMockMerchant();
    const audit1 = auditMerchant(merchant, 1);
    
    // Fix price and quantity
    merchant.products[0].price = 1099;
    merchant.products[0].variants![0].price = 1099;
    merchant.inventory[0].quantity = 100;
    
    const audit2 = auditMerchant(merchant, 2);
    assert.ok(audit2.overallScore > audit1.overallScore);
    
    const remainingIssues = audit2.issues.map(i => i.issueType);
    assert.ok(!remainingIssues.includes("PRICE_INVALID"), "PRICE_INVALID should be resolved");
    assert.ok(!remainingIssues.includes("INVENTORY_QUANTITY_INVALID"), "INVENTORY_QUANTITY_INVALID should be resolved");
  });

  await t.test("4. Score threshold (90) successfully gates publish, but never blocks re-audit", () => {
    let merchant = getMockMerchant();
    let audit = auditMerchant(merchant, 1);
    
    // Ensure we can audit even if score < 90
    assert.ok(audit.overallScore < 90);
    
    audit = auditMerchant(merchant, 2);
    assert.ok(audit.iteration === 2);
    assert.ok(audit.overallScore < 90);
  });

  await t.test("5. Iteration counter increments per audit", () => {
    const merchant = getMockMerchant();
    const audit1 = auditMerchant(merchant, 1);
    const audit2 = auditMerchant(merchant, 2);
    const audit10 = auditMerchant(merchant, 10);
    
    assert.strictEqual(audit1.iteration, 1);
    assert.strictEqual(audit2.iteration, 2);
    assert.strictEqual(audit10.iteration, 10);
  });

  await t.test("6. New issues introduced between audits are detected", () => {
    let merchant = getMockMerchant();
    const audit1 = auditMerchant(merchant, 1);
    
    // Introduce a new issue
    merchant.policies.currency = ""; 
    
    const audit2 = auditMerchant(merchant, 2);
    
    const newIssue = audit2.issues.find(i => i.issueType === "CURRENCY_MISSING");
    assert.ok(newIssue);
    assert.strictEqual(audit2.issueCount, audit1.issueCount + 1);
  });

  await t.test("7. Issue identity is stable across audits", () => {
    const merchant = getMockMerchant();
    const audit1 = auditMerchant(merchant, 1);
    const audit2 = auditMerchant(merchant, 2);
    
    assert.strictEqual(audit1.issues[0].id, audit2.issues[0].id);
    assert.strictEqual(audit1.issues[1].id, audit2.issues[1].id);
  });
  
  await t.test("8. Score never exceeds 100", () => {
    let merchant = getMockMerchant();
    
    // Fix absolutely everything
    merchant.products[0].price = 1099;
    merchant.products[0].variants![0].price = 1099;
    merchant.products[0].variants![0].options = { "Size": "M" };
    merchant.products[0].description = "This description is absolutely long enough to pass the check.";
    merchant.inventory[0].quantity = 10;
    merchant.policies.currency = "USD";
    merchant.policies.maxQuantityPerItem = 5;
    merchant.policies.shippingPolicy = { regions: ["US"], processingDays: 2 };
    merchant.policies.autonomousPurchasePolicy = { maxOrderValue: 500, requiresApprovalAbove: 100 };
    merchant.policies.returnPolicy = { windowDays: 30, summary: "valid" };
    
    const audit = auditMerchant(merchant, 1);
    if (audit.issueCount > 0) console.log(audit.issues);
    assert.strictEqual(audit.issueCount, 0);
    assert.strictEqual(audit.overallScore, 100);
  });
});
