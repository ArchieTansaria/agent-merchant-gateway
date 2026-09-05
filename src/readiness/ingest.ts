import type { InventoryItem, MerchantData, MerchantPolicies, Product, VariantInput } from "./types.js";

/**
 * Establishes a non-mutating boundary between merchant-provided data and the
 * readiness engine. Semantic corrections deliberately do not happen here.
 */
export function ingestMerchant(data: unknown): MerchantData {
  const source = isRecord(data) ? data : {};
  return {
    id: asNonBlankString(source.id, "unknown-merchant"),
    name: asNonBlankString(source.name, "Unnamed merchant"),
    products: Array.isArray(source.products)
      ? source.products.map((product, index) => normalizeProduct(product, index))
      : [],
    inventory: Array.isArray(source.inventory)
      ? source.inventory.map((item, index) => normalizeInventory(item, index))
      : [],
    policies: normalizePolicies(source.policies),
  };
}

function normalizeProduct(value: unknown, index: number): Product {
  const source = isRecord(value) ? value : {};
  return {
    id: asNonBlankString(source.id, `malformed-product-${index + 1}`),
    name: asNullableString(source.name),
    description: asNullableString(source.description),
    category: asNullableString(source.category),
    attributes: isRecord(source.attributes) ? structuredClone(source.attributes) : {},
    price: typeof source.price === "number" ? source.price : null,
    inventoryItemId: asNullableString(source.inventoryItemId),
    variants: Array.isArray(source.variants) ? structuredClone(source.variants) as VariantInput[] : undefined,
  };
}

function normalizeInventory(value: unknown, index: number): InventoryItem {
  const source = isRecord(value) ? value : {};
  return {
    id: asNonBlankString(source.id, `malformed-inventory-${index + 1}`),
    productId: asNonBlankString(source.productId, ""),
    sku: asNonBlankString(source.sku, ""),
    quantity: typeof source.quantity === "number" ? source.quantity : null,
  };
}

function normalizePolicies(value: unknown): MerchantPolicies {
  const source = isRecord(value) ? value : {};
  return {
    returnPolicy: isRecord(source.returnPolicy)
      ? { windowDays: asNullableNumber(source.returnPolicy.windowDays), summary: asNullableString(source.returnPolicy.summary) }
      : null,
    shippingPolicy: isRecord(source.shippingPolicy)
      ? {
          regions: Array.isArray(source.shippingPolicy.regions)
            ? source.shippingPolicy.regions.filter((region): region is string => typeof region === "string")
            : null,
          processingDays: asNullableNumber(source.shippingPolicy.processingDays),
        }
      : null,
    autonomousPurchasePolicy: isRecord(source.autonomousPurchasePolicy)
      ? { requiresApprovalAbove: asNullableNumber(source.autonomousPurchasePolicy.requiresApprovalAbove) }
      : null,
  };
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNonBlankString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
