import { readIssueValue } from "./fieldAccess.js";
import type { CorrectionProposal, MerchantData, ReadinessAudit, ReadinessIssue } from "./types.js";

const CANONICAL_CATEGORIES = ["Apparel", "Home", "Electronics"];
const COLOR_BY_SKU_TOKEN: Record<string, string> = {
  BLACK: "black",
  BLK: "black",
  WHITE: "white",
  WHT: "white",
  BLUE: "blue",
  BLU: "blue",
};

/**
 * This is the replaceable AI boundary. It produces proposals only; it never
 * mutates merchant data and a deterministic validator decides what is safe.
 */
export function proposeCorrections(
  merchant: MerchantData,
  audit: ReadinessAudit,
): CorrectionProposal[] {
  return audit.issues.map((issue) => proposeForIssue(merchant, issue));
}

function proposeForIssue(merchant: MerchantData, issue: ReadinessIssue): CorrectionProposal {
  const currentValue = readIssueValue(merchant, issue);
  const base = {
    issueId: issue.id,
    entityId: issue.affectedEntity.id,
    field: issue.affectedField,
    currentValue,
  };

  if (issue.issueType === "CATEGORY_NOT_CANONICAL") {
    const value = typeof currentValue === "string" ? currentValue.trim() : "";
    const canonical = CANONICAL_CATEGORIES.find((category) => category.toLowerCase() === value.toLowerCase());
    if (canonical) {
      return {
        ...base,
        proposedValue: canonical,
        reason: "The supplied category differs only by formatting from a supported canonical category.",
        confidence: 0.99,
        action: "AUTO_APPLY",
        correctionType: "NORMALIZE_CATEGORY",
      };
    }
  }

  if (issue.issueType === "REQUIRED_ATTRIBUTE_MISSING" && issue.affectedField === "attributes.size") {
    const product = merchant.products.find((candidate) => candidate.id === issue.affectedEntity.id);
    const sizes = product?.variants
      ?.flatMap((variant) => (typeof variant === "object" && variant?.options?.size ? [variant.options.size] : []))
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    const distinctSizes = [...new Set(sizes ?? [])].sort();
    if (distinctSizes.length > 0) {
      return {
        ...base,
        proposedValue: distinctSizes.join(", "),
        reason: "The product's existing variants explicitly list these size values.",
        confidence: 0.97,
        action: "AUTO_APPLY",
        correctionType: "EXTRACT_ATTRIBUTE_FROM_VARIANTS",
      };
    }
  }

  if (issue.issueType === "VARIANT_OPTIONS_MISSING") {
    const product = merchant.products.find((candidate) => candidate.id === issue.affectedEntity.id);
    const indexMatch = issue.affectedField.match(/^variants\[(\d+)]\.options$/);
    const variant = indexMatch && Array.isArray(product?.variants) ? product.variants[Number(indexMatch[1])] : undefined;
    const skuTokens = typeof variant === "object" && variant?.sku ? variant.sku.toUpperCase().split(/[-_\s]+/) : [];
    const color = skuTokens.map((token) => COLOR_BY_SKU_TOKEN[token]).find(Boolean);
    if (color) {
      return {
        ...base,
        proposedValue: { color },
        reason: "The variant SKU contains an unambiguous standard color token.",
        confidence: 0.98,
        action: "AUTO_APPLY",
        correctionType: "NORMALIZE_VARIANT_OPTIONS",
      };
    }
  }

  if (issue.issueType === "INVENTORY_LINK_MISSING") {
    const matchingInventory = merchant.inventory.filter(
      (item) => item.productId === issue.affectedEntity.id,
    );
    if (matchingInventory.length === 1) {
      return {
        ...base,
        proposedValue: matchingInventory[0].id,
        reason: "Exactly one inventory record already belongs to this product.",
        confidence: 0.99,
        action: "AUTO_APPLY",
        correctionType: "LINK_EXISTING_INVENTORY",
      };
    }
  }

  const policySensitive = issue.affectedEntity.type === "merchant_policy" ||
    ["PRICE_INVALID", "INVENTORY_QUANTITY_INVALID"].includes(issue.issueType);
  return {
    ...base,
    proposedValue: null,
    reason: policySensitive
      ? "No explicit merchant value was found. The agent must not invent this business-sensitive value."
      : "The issue needs merchant context and has no high-confidence deterministic correction.",
    confidence: 0,
    action: "REVIEW_REQUIRED",
    correctionType: "MERCHANT_DECISION",
  };
}
