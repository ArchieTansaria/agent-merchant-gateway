import type { AffectedEntity, MerchantData, ReadinessIssue } from "./types.js";

const VARIANT_OPTIONS_FIELD = /^variants\[(\d+)]\.options$/;

export function readIssueValue(merchant: MerchantData, issue: ReadinessIssue): unknown {
  return readMerchantField(merchant, issue.affectedEntity, issue.affectedField);
}

export function readMerchantField(
  merchant: MerchantData,
  entity: AffectedEntity,
  field: string,
): unknown {
  if (entity.type === "product") {
    const product = merchant.products.find((candidate) => candidate.id === entity.id);
    if (!product) return undefined;
    if (field === "name" || field === "description" || field === "category" || field === "price" || field === "inventoryItemId") {
      return product[field];
    }
    if (field.startsWith("attributes.")) {
      return product.attributes?.[field.slice("attributes.".length)];
    }
    const variantMatch = field.match(VARIANT_OPTIONS_FIELD);
    if (variantMatch && Array.isArray(product.variants)) {
      const variant = product.variants[Number(variantMatch[1])];
      return typeof variant === "object" && variant !== null ? variant.options : undefined;
    }
    return undefined;
  }

  if (entity.type === "inventory") {
    const inventory = merchant.inventory.find((candidate) => candidate.id === entity.id);
    if (!inventory) return undefined;
    return field === "quantity" || field === "productId" || field === "sku" ? inventory[field] : undefined;
  }

  if (entity.type === "merchant_policy") {
    if (field === "policies.currency") return merchant.policies.currency;
    if (field === "policies.maxQuantityPerItem") return merchant.policies.maxQuantityPerItem;
    if (field === "policies.autonomousPurchasePolicy") {
      return merchant.policies.autonomousPurchasePolicy;
    }
    if (field === "policies.autonomousPurchasePolicy.requiresApprovalAbove") {
      return merchant.policies.autonomousPurchasePolicy?.requiresApprovalAbove;
    }
    if (field === "policies.returnPolicy") return merchant.policies.returnPolicy;
    if (field === "policies.shippingPolicy") return merchant.policies.shippingPolicy;
  }

  return undefined;
}

export function hasWritableField(entity: AffectedEntity, field: string): boolean {
  if (entity.type === "product") {
    return (
      ["name", "description", "category", "price", "inventoryItemId"].includes(field) ||
      /^attributes\.[A-Za-z][A-Za-z0-9_-]*$/.test(field) ||
      VARIANT_OPTIONS_FIELD.test(field)
    );
  }
  if (entity.type === "inventory") return field === "quantity";
  return entity.type === "merchant_policy" && (
    field === "policies.currency" ||
    field === "policies.maxQuantityPerItem" ||
    field === "policies.returnPolicy" ||
    field === "policies.shippingPolicy" ||
    field === "policies.autonomousPurchasePolicy" ||
    field === "policies.autonomousPurchasePolicy.requiresApprovalAbove" ||
    field === "policies.autonomousPurchasePolicy.maxOrderValue"
  );
}

export function writeMerchantField(
  merchant: MerchantData,
  entity: AffectedEntity,
  field: string,
  value: unknown,
): boolean {
  if (!hasWritableField(entity, field)) return false;

  if (entity.type === "product") {
    const product = merchant.products.find((candidate) => candidate.id === entity.id);
    if (!product) return false;
    if (["name", "description", "category", "price", "inventoryItemId"].includes(field)) {
      const writableProduct = product as unknown as Record<string, unknown>;
      writableProduct[field] = value;
      return true;
    }
    if (field.startsWith("attributes.")) {
      product.attributes ??= {};
      product.attributes[field.slice("attributes.".length)] = value;
      return true;
    }
    const variantMatch = field.match(VARIANT_OPTIONS_FIELD);
    if (variantMatch && Array.isArray(product.variants)) {
      const index = Number(variantMatch[1]);
      const variant = product.variants[index];
      if (typeof variant !== "object" || variant === null) return false;
      if (value === undefined) {
        delete variant.options;
      } else {
        variant.options = value as Record<string, string>;
      }
      return true;
    }
    return false;
  }

  if (entity.type === "inventory") {
    const inventory = merchant.inventory.find((candidate) => candidate.id === entity.id);
    if (!inventory || field !== "quantity") return false;
    inventory.quantity = value as number;
    return true;
  }

  if (entity.type === "merchant_policy") {
    if (field === "policies.currency") {
      merchant.policies.currency = value as string;
      return true;
    }
    if (field === "policies.maxQuantityPerItem") {
      merchant.policies.maxQuantityPerItem = Number(value);
      return true;
    }
    if (field === "policies.autonomousPurchasePolicy") {
      merchant.policies.autonomousPurchasePolicy = value as any;
      return true;
    }
    if (field === "policies.autonomousPurchasePolicy.requiresApprovalAbove") {
      merchant.policies.autonomousPurchasePolicy ??= {};
      merchant.policies.autonomousPurchasePolicy.requiresApprovalAbove = Number(value);
      return true;
    }
    if (field === "policies.autonomousPurchasePolicy.maxOrderValue") {
      merchant.policies.autonomousPurchasePolicy ??= {};
      merchant.policies.autonomousPurchasePolicy.maxOrderValue = Number(value);
      return true;
    }
    if (field === "policies.returnPolicy") {
      merchant.policies.returnPolicy = value as any;
      return true;
    }
    if (field === "policies.shippingPolicy") {
      merchant.policies.shippingPolicy = value as any;
      return true;
    }
  }

  return false;
}
