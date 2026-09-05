import type { MerchantPolicies } from "../readiness/types.js";
import type { Cart } from "./types.js";

export type CheckoutStatus = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export interface PolicyEvaluationResult {
  status: CheckoutStatus;
  code: string;
  reason: string;
}

export interface CheckoutContext {
  cart: Cart;
  cartTotal: number;
  totalQuantity: number;
  outOfStock: boolean;
  priceChanged: boolean;
  invalidCart: boolean;
  invalidCurrency: boolean;
  maxItemQuantityExceeded: boolean;
}

export function evaluateCheckout(context: CheckoutContext, policies: MerchantPolicies, forceApprove: boolean = false): PolicyEvaluationResult {
  // Hard failures (DENY)
  if (context.invalidCart) {
    return { status: "DENY", code: "INVALID_CART", reason: "The cart contains invalid items or quantities." };
  }
  
  if (context.outOfStock) {
    return { status: "DENY", code: "OUT_OF_STOCK", reason: "One or more items in the cart are out of stock." };
  }

  if (context.priceChanged) {
    return { status: "DENY", code: "PRICE_CHANGED", reason: "Prices have changed since items were added to the cart." };
  }

  if (context.invalidCurrency) {
    return { status: "DENY", code: "INVALID_CURRENCY", reason: "The merchant currency is not configured or invalid." };
  }

  if (context.maxItemQuantityExceeded || (policies.maxQuantityPerItem != null && context.totalQuantity > policies.maxQuantityPerItem)) {
    return { status: "DENY", code: "MAX_QUANTITY_EXCEEDED", reason: "The order exceeds the maximum allowed quantity per item." };
  }

  // Check missing critical autonomous policies
  if (!policies.autonomousPurchasePolicy || policies.autonomousPurchasePolicy.maxOrderValue == null || policies.autonomousPurchasePolicy.requiresApprovalAbove == null) {
    return { status: "DENY", code: "INCOMPLETE_POLICY", reason: "Merchant configuration for autonomous purchases is incomplete." };
  }

  const { maxOrderValue, requiresApprovalAbove } = policies.autonomousPurchasePolicy;

  // Max order value limit
  if (context.cartTotal > maxOrderValue) {
    return { status: "DENY", code: "MAX_ORDER_VALUE_EXCEEDED", reason: "The order exceeds the maximum allowed autonomous purchase value." };
  }

  // Approval threshold
  if (!forceApprove && context.cartTotal > requiresApprovalAbove) {
    return { status: "REQUIRE_APPROVAL", code: "ORDER_ABOVE_APPROVAL_THRESHOLD", reason: "The order requires manual merchant approval because it exceeds the threshold." };
  }

  return { status: "ALLOW", code: "OK", reason: "The order meets all autonomous commerce policies." };
}
