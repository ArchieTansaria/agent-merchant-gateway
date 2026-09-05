import { hasWritableField, readIssueValue } from "./fieldAccess.js";
import type {
  CorrectionProposal,
  MerchantData,
  ReadinessAudit,
  ValidatedCorrection,
} from "./types.js";

const AUTO_APPLY_CONFIDENCE = 0.9;
const CANONICAL_CATEGORIES = ["Apparel", "Home", "Electronics"];
const COLOR_BY_SKU_TOKEN: Record<string, string> = {
  BLACK: "black", BLK: "black", WHITE: "white", WHT: "white", BLUE: "blue", BLU: "blue",
};

/** Deterministic safety gate between an AI proposal and any state mutation. */
export function validateCorrectionProposal(
  merchant: MerchantData,
  audit: ReadinessAudit,
  rawProposal: unknown,
): ValidatedCorrection {
  if (!isCorrectionProposal(rawProposal)) {
    return { proposal: null, action: "REJECT", reason: "Proposal is malformed." };
  }

  const proposal = rawProposal;
  const issue = audit.issues.find((candidate) => candidate.id === proposal.issueId);
  if (!issue) return rejected(proposal, "Proposal references an issue that is not in this audit.");
  if (issue.affectedEntity.id !== proposal.entityId) {
    return rejected(proposal, "Proposal entity does not match the audited issue.");
  }
  if (issue.affectedField !== proposal.field || !hasWritableField(issue.affectedEntity, proposal.field)) {
    return rejected(proposal, "Proposal targets a nonexistent or unsupported field.");
  }
  if (!entityExists(merchant, issue.affectedEntity.type, proposal.entityId)) {
    return rejected(proposal, "Proposal targets an entity that does not exist.");
  }
  if (!sameValue(proposal.currentValue, readIssueValue(merchant, issue))) {
    return rejected(proposal, "Proposal no longer matches the current merchant data.");
  }

  if (proposal.action === "REJECT") {
    return rejected(proposal, "The proposal agent marked this correction as unsafe.");
  }

  if (proposal.action === "REVIEW_REQUIRED") {
    return { proposal, action: "REVIEW_REQUIRED", reason: proposal.reason };
  }

  if (issue.affectedEntity.type === "merchant_policy") {
    return rejected(proposal, "Merchant policy fields can never be automatically changed.");
  }
  if (proposal.confidence < AUTO_APPLY_CONFIDENCE) {
    return {
      proposal: { ...proposal, action: "REVIEW_REQUIRED" },
      action: "REVIEW_REQUIRED",
      reason: "Automatic application requires at least 0.90 confidence.",
    };
  }

  const safetyError = validateKnownSafeCorrection(merchant, issue.issueType, proposal);
  if (safetyError) return rejected(proposal, safetyError);
  return { proposal, action: "AUTO_APPLY", reason: "Proposal passed deterministic safety checks." };
}

function validateKnownSafeCorrection(
  merchant: MerchantData,
  issueType: string,
  proposal: CorrectionProposal,
): string | null {
  if (proposal.correctionType === "NORMALIZE_CATEGORY" && issueType === "CATEGORY_NOT_CANONICAL") {
    return typeof proposal.proposedValue === "string" &&
      CANONICAL_CATEGORIES.includes(proposal.proposedValue) &&
      typeof proposal.currentValue === "string" &&
      proposal.currentValue.trim().toLowerCase() === proposal.proposedValue.toLowerCase()
      ? null
      : "Category normalization is not an exact canonical mapping.";
  }

  if (proposal.correctionType === "EXTRACT_ATTRIBUTE_FROM_VARIANTS" && issueType === "REQUIRED_ATTRIBUTE_MISSING") {
    const product = merchant.products.find((candidate) => candidate.id === proposal.entityId);
    const attribute = proposal.field.slice("attributes.".length);
    const values = product?.variants
      ?.flatMap((variant) => typeof variant === "object" && variant?.options?.[attribute] ? [variant.options[attribute]] : [])
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    const expected = [...new Set(values ?? [])].sort().join(", ");
    return proposal.field.startsWith("attributes.") && expected.length > 0 && proposal.proposedValue === expected
      ? null
      : "Attribute value is not fully supported by existing variant data.";
  }

  if (proposal.correctionType === "NORMALIZE_VARIANT_OPTIONS" && issueType === "VARIANT_OPTIONS_MISSING") {
    const product = merchant.products.find((candidate) => candidate.id === proposal.entityId);
    const match = proposal.field.match(/^variants\[(\d+)]\.options$/);
    const variant = match && Array.isArray(product?.variants) ? product.variants[Number(match[1])] : undefined;
    const tokens = typeof variant === "object" && variant?.sku ? variant.sku.toUpperCase().split(/[-_\s]+/) : [];
    const color = tokens.map((token) => COLOR_BY_SKU_TOKEN[token]).find(Boolean);
    return color && isExactColorOption(proposal.proposedValue, color)
      ? null
      : "Variant options are not fully supported by the SKU.";
  }

  if (proposal.correctionType === "LINK_EXISTING_INVENTORY" && issueType === "INVENTORY_LINK_MISSING") {
    const candidates = merchant.inventory.filter((item) => item.productId === proposal.entityId);
    return candidates.length === 1 && proposal.proposedValue === candidates[0].id
      ? null
      : "Inventory link is not unambiguous.";
  }

  return "Correction type is not approved for automatic application.";
}

function isCorrectionProposal(value: unknown): value is CorrectionProposal {
  if (!isRecord(value)) return false;
  return (
    typeof value.issueId === "string" &&
    typeof value.entityId === "string" &&
    typeof value.field === "string" &&
    typeof value.reason === "string" && value.reason.trim().length > 0 &&
    typeof value.confidence === "number" && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1 &&
    (value.action === "AUTO_APPLY" || value.action === "REVIEW_REQUIRED" || value.action === "REJECT") &&
    typeof value.correctionType === "string" && value.correctionType.trim().length > 0 &&
    "currentValue" in value && "proposedValue" in value
  );
}

function entityExists(merchant: MerchantData, type: string, id: string): boolean {
  if (type === "product") return merchant.products.some((product) => product.id === id);
  if (type === "inventory") return merchant.inventory.some((item) => item.id === id);
  return type === "merchant_policy" && merchant.id === id;
}

function isExactColorOption(value: unknown, color: string): boolean {
  return isRecord(value) && Object.keys(value).length === 1 && value.color === color;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejected(proposal: CorrectionProposal, reason: string): ValidatedCorrection {
  return { proposal: { ...proposal, action: "REJECT" }, action: "REJECT", reason };
}
