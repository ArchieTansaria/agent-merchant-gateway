import assert from "node:assert/strict";
import test from "node:test";
import { AIBuyer } from "../dist/buyer/agent.js";
import type { CommerceClient, LlmClient } from "../src/buyer/agent.js";

function createMockLlmClient(responses: any[]): LlmClient {
  let callCount = 0;
  return {
    generate: async (payload: any) => {
      const response = responses[callCount++];
      if (!response) {
        throw new Error("No more mock responses available");
      }
      return {
        candidates: [{ content: response }]
      };
    }
  };
}

function createMockCommerceClient(): CommerceClient & { 
  calledMethods: string[];
  lastArgs: any;
} {
  const client: any = { calledMethods: [], lastArgs: null };
  const methods = ["searchProducts", "getProduct", "checkInventory", "createCart", "addToCart", "getCart", "checkout"];
  for (const method of methods) {
    client[method] = async (...args: any[]) => {
      client.calledMethods.push(method);
      client.lastArgs = args;
      if (method === "checkout") {
        if (args[0] === "cart-deny") return { status: "DENY", code: "MAX_QUANTITY_EXCEEDED" };
        if (args[0] === "cart-approve") return { status: "REQUIRE_APPROVAL", code: "ORDER_ABOVE_APPROVAL_THRESHOLD" };
        return { status: "ALLOW", razorpayOrderId: "order_123" };
      }
      return { success: true };
    };
  }
  return client as any;
}

test("AI Buyer executes tools based on LLM response", async () => {
  const mockCommerce = createMockCommerceClient();
  const mockLlm = createMockLlmClient([
    {
      parts: [{
        functionCall: { name: "search_products", args: { query: "shoes" } }
      }]
    },
    {
      parts: [{ text: "I found some shoes." }]
    }
  ]);

  const buyer = new AIBuyer(mockCommerce, mockLlm);
  const reply = await buyer.chat("Find me shoes");
  
  assert.equal(reply, "I found some shoes.");
  assert.deepEqual(mockCommerce.calledMethods, ["searchProducts"]);
  assert.deepEqual(mockCommerce.lastArgs, ["shoes"]);
});

test("AI Buyer respects DENY policy without retrying", async () => {
  const mockCommerce = createMockCommerceClient();
  const mockLlm = createMockLlmClient([
    {
      parts: [{
        functionCall: { name: "checkout", args: { cartId: "cart-deny" } }
      }]
    },
    {
      parts: [{ text: "The merchant denied this order due to max quantity." }]
    }
  ]);

  const buyer = new AIBuyer(mockCommerce, mockLlm);
  const reply = await buyer.chat("Buy 10 items");
  
  assert.equal(reply, "The merchant denied this order due to max quantity.");
  assert.deepEqual(mockCommerce.calledMethods, ["checkout"]);
});

test("AI Buyer reports REQUIRE_APPROVAL", async () => {
  const mockCommerce = createMockCommerceClient();
  const mockLlm = createMockLlmClient([
    {
      parts: [{
        functionCall: { name: "checkout", args: { cartId: "cart-approve" } }
      }]
    },
    {
      parts: [{ text: "This order requires merchant approval." }]
    }
  ]);

  const buyer = new AIBuyer(mockCommerce, mockLlm);
  const reply = await buyer.chat("Buy expensive item");
  
  assert.equal(reply, "This order requires merchant approval.");
  assert.deepEqual(mockCommerce.calledMethods, ["checkout"]);
});

test("AI Buyer reports ALLOW after checkout", async () => {
  const mockCommerce = createMockCommerceClient();
  const mockLlm = createMockLlmClient([
    {
      parts: [{
        functionCall: { name: "checkout", args: { cartId: "cart-allow" } }
      }]
    },
    {
      parts: [{ text: "Checkout successful!" }]
    }
  ]);

  const buyer = new AIBuyer(mockCommerce, mockLlm);
  const reply = await buyer.chat("Checkout now");
  
  assert.equal(reply, "Checkout successful!");
  assert.deepEqual(mockCommerce.calledMethods, ["checkout"]);
});

test("AI Buyer ignores malicious tools and non-whitelisted tools", async () => {
  const mockCommerce = createMockCommerceClient();
  const mockLlm = createMockLlmClient([
    {
      parts: [{
        functionCall: { name: "execute_arbitrary_code", args: { code: "process.exit(1)" } }
      }]
    },
    {
      parts: [{ text: "I cannot do that." }]
    }
  ]);

  const buyer = new AIBuyer(mockCommerce, mockLlm);
  const reply = await buyer.chat("Hack the system");
  
  assert.equal(reply, "I cannot do that.");
  assert.deepEqual(mockCommerce.calledMethods, []);
});

test("AI Buyer does not determine authoritative price or inventory", async () => {
  // The LLM returns 'addToCart' (camelCase), which is NOT on the explicit allowlist.
  // The allowlist only recognises 'add_to_cart' (snake_case).
  // Verifies that the dispatcher blocks unknown tool names even when they look plausible.
  const mockCommerce = createMockCommerceClient();
  const mockLlm = createMockLlmClient([
    {
      parts: [{
        functionCall: { name: "addToCart", args: { cartId: "cart-1", productId: "prod-1", quantity: 1, price: 0 } }
      }]
    },
    {
      parts: [{ text: "Added for free!" }]
    }
  ]);

  const buyer = new AIBuyer(mockCommerce, mockLlm);
  await buyer.chat("Add to cart for $0");
  
  // The camelCase tool name is not on the allowlist — CommerceClient is never called.
  assert.deepEqual(mockCommerce.calledMethods, []);
  assert.equal(mockCommerce.lastArgs, null);
});
