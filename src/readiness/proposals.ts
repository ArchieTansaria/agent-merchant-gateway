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

let globalProviderConfig: { provider: string, hasKey: boolean } | null = null;

export function __resetProviderConfigForTesting() {
  globalProviderConfig = null;
}

async function checkProvider(): Promise<{ provider: string, hasKey: boolean }> {
  if (globalProviderConfig) return globalProviderConfig;
  try {
    const res = await fetch("/api/ai/status");
    if (!res.ok) throw new Error("Status API failed");
    globalProviderConfig = await res.json();
  } catch (err) {
    // Fallback if no server or during tests
    globalProviderConfig = { provider: "deterministic", hasKey: false };
  }
  return globalProviderConfig!;
}

/**
 * This is the replaceable AI boundary. It produces proposals only; it never
 * mutates merchant data and a deterministic validator decides what is safe.
 */
export async function proposeCorrections(
  merchant: MerchantData,
  audit: ReadinessAudit,
  onProgress?: (state: string) => void
): Promise<CorrectionProposal[]> {
  const config = await checkProvider();
  
  if (config.provider === "llm") {
    if (!config.hasKey) {
      console.warn("LLM provider selected but GEMINI_API_KEY is missing. Failing gracefully to deterministic provider.");
      return audit.issues.map((issue) => proposeForIssue(merchant, issue));
    }
    
    const proposals: CorrectionProposal[] = [];
    for (const issue of audit.issues) {
      onProgress?.("AI ANALYZING");
      
      const relevantEntity = merchant.products.find(p => p.id === issue.affectedEntity.id) || 
                             merchant.inventory.find(i => i.id === issue.affectedEntity.id) ||
                             merchant.policies;
      
      const payload = {
        issue,
        relevantEntity,
        relevantContext: `The deterministic validator handles applying safe semantic normalization, but never invent pricing or policies.
Canonical categories are: ${CANONICAL_CATEGORIES.join(", ")}.
If resolving a CATEGORY_NOT_CANONICAL issue by matching a canonical category, set action to AUTO_APPLY and correctionType to NORMALIZE_CATEGORY.
If extracting a missing size from variants, set action to AUTO_APPLY and correctionType to EXTRACT_ATTRIBUTE_FROM_VARIANTS.
If extracting a missing variant option (like color) from a SKU, set action to AUTO_APPLY and correctionType to EXTRACT_ATTRIBUTE_FROM_SKU.
For other ambiguous changes, use REVIEW_REQUIRED.`
      };
      
      try {
        const res = await fetch("/api/ai/proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`API error ${res.status}`);
        
        onProgress?.("PROPOSAL GENERATED");
        const proposal = await res.json();
        
        // Basic shape validation to protect downstream validator
        if (!proposal || typeof proposal !== "object" || !proposal.issueId || !proposal.action) {
          throw new Error("Malformed LLM response");
        }
        proposals.push(proposal as CorrectionProposal);
      } catch (err) {
        console.error("LLM failed for issue:", issue.id, err);
        // Fallback to safe reject proposal
        proposals.push({
          issueId: issue.id,
          entityId: issue.affectedEntity.id,
          field: issue.affectedField,
          currentValue: readIssueValue(merchant, issue),
          proposedValue: null,
          reason: "LLM API failed",
          confidence: 0,
          action: "REJECT",
          correctionType: "LLM_ERROR"
        });
      }
    }
    return proposals;
  }

  // Deterministic Fallback
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
