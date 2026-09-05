import type { MerchantData } from "../readiness/types.js";

// In-memory store for published AI-ready merchants
const publishedMerchants = new Map<string, MerchantData>();

export function publishMerchant(sessionId: string, merchant: MerchantData): void {
  // Validate the snapshot
  if (!merchant || !merchant.id || !merchant.name) {
    throw new Error("Invalid merchant snapshot: Missing basic identity");
  }

  if (!merchant.policies || !merchant.policies.currency) {
    throw new Error("Invalid merchant snapshot: Missing required policy (currency)");
  }

  // Validate products and variants
  for (const product of merchant.products) {
    if (!product.id || !product.name || product.price === undefined || product.price === null || product.price < 0) {
      throw new Error(`Invalid product data for product ${product.id}`);
    }
  }

  // Deep clone to prevent any accidental reference mutations
  const snapshot = JSON.parse(JSON.stringify(merchant));
  publishedMerchants.set(sessionId, snapshot);
}

export function getPublishedMerchant(sessionId: string): MerchantData | undefined {
  return publishedMerchants.get(sessionId);
}
