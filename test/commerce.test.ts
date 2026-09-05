import test from "node:test";
import assert from "node:assert";
import { publishMerchant } from "../dist/commerce/store.js";
import { 
  searchProducts, 
  getProduct, 
  checkInventory, 
  createCart, 
  addToCart, 
  calculateCartTotal, 
  checkout 
} from "../dist/commerce/service.js";
import { evaluateCheckout } from "../dist/commerce/policy.js";
import type { MerchantData, Product, InventoryItem } from "../src/readiness/types.ts";

const mockMerchant: MerchantData = {
  id: "test-merchant",
  name: "Test Merchant",
  products: [
    {
      id: "prod-1",
      name: "T-Shirt",
      description: "A cool t-shirt",
      price: 100,
      variants: [{ sku: "var-1" }]
    },
    {
      id: "prod-2",
      name: "Jeans",
      description: "Blue jeans",
      price: 200,
      variants: [{ sku: "var-2" }]
    }
  ],
  inventory: [
    { id: "inv-1", productId: "prod-1", sku: "var-1", quantity: 10 },
    { id: "inv-2", productId: "prod-2", sku: "var-2", quantity: 5 }
  ],
  policies: {
    currency: "USD",
    maxQuantityPerItem: 5,
    autonomousPurchasePolicy: {
      maxOrderValue: 1000,
      requiresApprovalAbove: 500
    }
  }
};

test("Commerce domain logic", async (t) => {
  const sessionId = "session-123";

  await t.test("publish merchant", () => {
    publishMerchant(sessionId, mockMerchant);
  });

  await t.test("searchProducts", () => {
    const results = searchProducts(sessionId, "t-shirt");
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, "prod-1");
  });

  await t.test("getProduct", () => {
    const product = getProduct(sessionId, "prod-2");
    assert.strictEqual(product?.name, "Jeans");
  });

  await t.test("checkInventory", () => {
    assert.strictEqual(checkInventory(sessionId, "var-1", 5), true);
    assert.strictEqual(checkInventory(sessionId, "var-1", 11), false);
    assert.strictEqual(checkInventory(sessionId, "var-3", 1), false); // nonexistent
  });

  await t.test("cart operations", () => {
    const cart = createCart(sessionId);
    assert.ok(cart.id);

    addToCart(sessionId, cart.id, "prod-1", "var-1", 2);
    
    // Attempt invalid quantity
    assert.throws(() => addToCart(sessionId, cart.id, "prod-1", "var-1", 0), /Quantity must be positive/);

    // Attempt insufficient inventory
    assert.throws(() => addToCart(sessionId, cart.id, "prod-1", "var-1", 20), /Insufficient inventory/);

    const calc = calculateCartTotal(sessionId, cart.id);
    assert.strictEqual(calc.total, 200); // 2 * 100
    assert.strictEqual(calc.totalQuantity, 2);
    assert.strictEqual(calc.currency, "USD");
  });

  await t.test("policy evaluation - ALLOW", () => {
    const cart = createCart(sessionId);
    addToCart(sessionId, cart.id, "prod-1", "var-1", 2);
    const calc = calculateCartTotal(sessionId, cart.id);
    const evalResult = evaluateCheckout(calc.context, mockMerchant.policies);
    assert.strictEqual(evalResult.status, "ALLOW");
  });

  await t.test("policy evaluation - REQUIRE_APPROVAL", () => {
    const cart = createCart(sessionId);
    // 6 * 100 = 600 > 500 threshold
    // wait, max quantity per item is 5. So we need to buy 3 of prod-1 and 2 of prod-2
    addToCart(sessionId, cart.id, "prod-1", "var-1", 3);
    addToCart(sessionId, cart.id, "prod-2", "var-2", 2); 
    // total = 3*100 + 2*200 = 700
    const calc = calculateCartTotal(sessionId, cart.id);
    const evalResult = evaluateCheckout(calc.context, mockMerchant.policies);
    assert.strictEqual(evalResult.status, "REQUIRE_APPROVAL");
    assert.strictEqual(evalResult.code, "ORDER_ABOVE_APPROVAL_THRESHOLD");
  });

  await t.test("policy evaluation - MAX_QUANTITY_EXCEEDED (DENY)", () => {
    const cart = createCart(sessionId);
    // Max is 5, but let's artificially hack the cart to 6 to see if policy engine catches it
    cart.items.push({ productId: "prod-1", variantId: "var-1", quantity: 6 });
    const calc = calculateCartTotal(sessionId, cart.id);
    const evalResult = evaluateCheckout(calc.context, mockMerchant.policies);
    assert.strictEqual(evalResult.status, "DENY");
    assert.strictEqual(evalResult.code, "MAX_QUANTITY_EXCEEDED");
  });
  
  await t.test("security: client cannot affect server state", () => {
    // If a client attempts to pass a cart with a fake price, the calculateCartTotal ignores it.
    // Our cart interface doesn't even have a price field. The total is rigorously calculated server-side.
    const cart = createCart(sessionId);
    (cart.items as any).push({ productId: "prod-1", variantId: "var-1", quantity: 1, price: 1, total: 1 });
    const calc = calculateCartTotal(sessionId, cart.id);
    assert.strictEqual(calc.total, 100); // Server used real price!
  });
});
