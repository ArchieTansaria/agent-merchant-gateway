import { auditMerchant } from "./src/readiness/audit.ts";
const merchant = {
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
        attributes: {},
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
  };
    // Fix absolutely everything
    merchant.products[0].price = 1099;
    merchant.products[0].variants[0].price = 1099;
    merchant.products[0].variants[0].options = { "Size": "M" };
    merchant.products[0].description = "This description is absolutely long enough to pass the check.";
    merchant.inventory[0].quantity = 10;
    merchant.policies.currency = "USD";
    merchant.policies.maxQuantityPerItem = 5;
    merchant.policies.shippingPolicy = { regions: ["US"], processingDays: 2 };
    merchant.policies.autonomousPurchasePolicy = { maxOrderValue: 500, requiresApprovalAbove: 100 };
    merchant.policies.returnPolicy = { windowDays: 30, summary: "valid" };

console.log(JSON.stringify(auditMerchant(merchant, 1), null, 2));
