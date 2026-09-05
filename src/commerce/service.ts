import { v4 as uuidv4 } from "uuid";
import { getPublishedMerchant } from "./store.js";
import type { Product, VariantInput, InventoryItem } from "../readiness/types.js";
import type { Cart, CartItem } from "./types.js";
import { evaluateCheckout, CheckoutContext } from "./policy.js";
import { createRazorpayOrder, RazorpayOrderResult } from "./razorpay.js";

// Session-based cart storage
const carts = new Map<string, Cart>();

export function searchProducts(sessionId: string, query?: string): Product[] {
  const merchant = getPublishedMerchant(sessionId);
  if (!merchant) throw new Error("No active merchant session");

  let results = merchant.products;
  if (query) {
    const q = query.toLowerCase();
    results = results.filter(p => 
      (p.name && p.name.toLowerCase().includes(q)) || 
      (p.description && p.description.toLowerCase().includes(q))
    );
  }
  return results;
}

export function getProduct(sessionId: string, productId: string): Product | undefined {
  const merchant = getPublishedMerchant(sessionId);
  if (!merchant) throw new Error("No active merchant session");
  return merchant.products.find(p => p.id === productId);
}

export function checkInventory(sessionId: string, variantId: string, quantity: number): boolean {
  if (quantity <= 0) return false;
  const merchant = getPublishedMerchant(sessionId);
  if (!merchant) throw new Error("No active merchant session");
  
  // Find the variant
  let foundProduct: Product | undefined;
  let foundVariant: VariantInput | undefined;
  
  for (const p of merchant.products) {
    if (p.variants) {
      for (const v of p.variants) {
        if (typeof v === "object" && v !== null && v.sku === variantId) {
          foundProduct = p;
          foundVariant = v;
          break;
        }
      }
    } else if (p.id === variantId) {
      // If no variants, productId acts as variantId for cart
      foundProduct = p;
      break;
    }
  }

  if (!foundProduct) return false;

  const inventoryItem = merchant.inventory.find(i => {
    if (foundVariant && typeof foundVariant === "object" && i.sku && i.sku === foundVariant.sku) {
      return true;
    }
    // Fallback: match by productId or product's inventoryItemId if the inventory is tracked at the product level
    if (i.productId === foundProduct!.id || (foundProduct!.inventoryItemId && i.id === foundProduct!.inventoryItemId)) {
      return true;
    }
    return false;
  });

  if (!inventoryItem || inventoryItem.quantity === null || inventoryItem.quantity < quantity) {
    return false;
  }
  return true;
}

export function createCart(sessionId: string): Cart {
  const merchant = getPublishedMerchant(sessionId);
  if (!merchant) throw new Error("No active merchant session");

  const cart: Cart = {
    id: uuidv4(),
    merchantId: merchant.id,
    items: []
  };
  carts.set(cart.id, cart);
  return cart;
}

export function addToCart(sessionId: string, cartId: string, productId: string, variantId: string | null, quantity: number): void {
  if (quantity <= 0) throw new Error("Quantity must be positive");
  
  const cart = carts.get(cartId);
  if (!cart) throw new Error("Cart not found");

  const merchant = getPublishedMerchant(sessionId);
  if (!merchant || merchant.id !== cart.merchantId) throw new Error("Invalid session for this cart");

  const effectiveVariantId = variantId || productId;
  if (!checkInventory(sessionId, effectiveVariantId, quantity)) {
    throw new Error("Insufficient inventory");
  }

  const existingItem = cart.items.find(i => i.productId === productId && i.variantId === variantId);
  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    cart.items.push({ productId, variantId, quantity });
  }
}

export function removeFromCart(sessionId: string, cartId: string, productId: string, variantId: string | null): void {
  const cart = carts.get(cartId);
  if (!cart) throw new Error("Cart not found");

  const merchant = getPublishedMerchant(sessionId);
  if (!merchant || merchant.id !== cart.merchantId) throw new Error("Invalid session for this cart");

  const index = cart.items.findIndex(i => i.productId === productId && i.variantId === variantId);
  if (index !== -1) {
    cart.items.splice(index, 1);
  }
}

export function getCart(cartId: string): Cart | undefined {
  return carts.get(cartId);
}

// Calculated totals and revalidation
export interface CalculatedCart {
  cart: Cart;
  total: number;
  totalQuantity: number;
  currency: string;
  context: CheckoutContext;
}

export function calculateCartTotal(sessionId: string, cartId: string): CalculatedCart {
  const cart = carts.get(cartId);
  if (!cart) throw new Error("Cart not found");

  const merchant = getPublishedMerchant(sessionId);
  if (!merchant) throw new Error("No active merchant session");

  let total = 0;
  let totalQuantity = 0;
  let outOfStock = false;
  let invalidCart = false;
  let maxItemQuantityExceeded = false;
  
  const maxQtyPolicy = merchant.policies.maxQuantityPerItem;

  for (const item of cart.items) {
    const product = merchant.products.find(p => p.id === item.productId);
    if (!product || product.price == null) {
      invalidCart = true;
      continue;
    }

    const effectiveVariantId = item.variantId || product.id;
    let foundVariant: any = null;
    if (item.variantId && product.variants) {
      foundVariant = product.variants.find(v => typeof v === "object" && v !== null && v.sku === item.variantId);
    }

    const inventoryItem = merchant.inventory.find(i => {
      if (foundVariant && typeof foundVariant === "object" && i.sku && i.sku === foundVariant.sku) {
        return true;
      }
      // Fallback: match by productId or product's inventoryItemId if the inventory is tracked at the product level
      if (i.productId === product.id || (product.inventoryItemId && i.id === product.inventoryItemId)) {
        return true;
      }
      return false;
    });
    
    if (!inventoryItem || inventoryItem.quantity === null || inventoryItem.quantity < item.quantity) {
      outOfStock = true;
    }

    if (maxQtyPolicy != null && item.quantity > maxQtyPolicy) {
      maxItemQuantityExceeded = true;
    }

    total += product.price * item.quantity;
    totalQuantity += item.quantity;
  }

  const currency = merchant.policies.currency;
  const invalidCurrency = !currency;

  return {
    cart,
    total,
    totalQuantity,
    currency: currency || "",
    context: {
      cart,
      cartTotal: total,
      totalQuantity,
      outOfStock,
      priceChanged: false, // In this demo, we validate strictly on the fly, so caller-supplied prices don't exist in cart state. If we passed old prices, we would flag true.
      invalidCart,
      invalidCurrency,
      maxItemQuantityExceeded
    }
  };
}

export async function checkout(sessionId: string, cartId: string, forceApprove: boolean = false): Promise<any> {
  const merchant = getPublishedMerchant(sessionId);
  if (!merchant) throw new Error("No active merchant session");

  const calc = calculateCartTotal(sessionId, cartId);
  const evaluation = evaluateCheckout(calc.context, merchant.policies, forceApprove);

  if (evaluation.status === "ALLOW") {
    // Generate razorpay order
    // Subunits for INR
    let subunits = 100; // default multiplier
    // Add Razorpay order
    try {
      const order = await createRazorpayOrder({
        amount: Math.round(calc.total * subunits),
        currency: calc.currency,
        receipt: `receipt_${calc.cart.id}`,
        notes: {
          cartId: calc.cart.id,
          merchantId: merchant.id
        }
      });
      return {
        status: evaluation.status,
        code: evaluation.code,
        reason: evaluation.reason,
        razorpayOrderId: order.id,
        amount: order.amount,
        currency: order.currency
      };
    } catch (e: any) {
      return {
        status: "DENY",
        code: "PAYMENT_GATEWAY_ERROR",
        reason: e.message
      };
    }
  }

  return evaluation; // DENY or REQUIRE_APPROVAL
}
