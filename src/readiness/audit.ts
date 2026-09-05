import type {
  AffectedEntity,
  AuditCategory,
  CategoryScore,
  InventoryItem,
  MerchantData,
  ReadinessAudit,
  ReadinessIssue,
  Severity,
  Variant,
  VariantInput,
} from "./types.js";

interface CategoryDefinition {
  category: AuditCategory;
  label: string;
  maximum: number;
}

interface ProductCategoryDefinition {
  canonicalName: string;
  requiredAttributes: string[];
}

interface IssueInput {
  issueType: string;
  severity: Severity;
  category: AuditCategory;
  entity: AffectedEntity;
  field: string;
  message: string;
  explanation: string;
  scoreImpact: number;
}

export const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  { category: "productData", label: "Product data", maximum: 35 },
  { category: "variantQuality", label: "Variant quality", maximum: 20 },
  { category: "inventoryQuality", label: "Inventory quality", maximum: 25 },
  { category: "policyCompleteness", label: "Policy completeness", maximum: 20 },
];

const PRODUCT_CATEGORIES: ProductCategoryDefinition[] = [
  { canonicalName: "Apparel", requiredAttributes: ["material", "color", "size"] },
  { canonicalName: "Home", requiredAttributes: ["material", "dimensions"] },
  { canonicalName: "Electronics", requiredAttributes: ["brand", "warranty"] },
];

const productCategoryByNormalizedName = new Map(
  PRODUCT_CATEGORIES.map((category) => [
    normalizeCategory(category.canonicalName),
    category,
  ]),
);

/**
 * Audits merchant data without changing it. Every score deduction corresponds
 * to a returned issue, so the score can be independently explained in the UI.
 */
export function auditMerchant(merchant: MerchantData, iteration: number = 1): ReadinessAudit {
  const issues: ReadinessIssue[] = [];
  const inventoryById = new Map(
    merchant.inventory.map((inventoryItem) => [inventoryItem.id, inventoryItem]),
  );
  const productsById = new Map(merchant.products.map((product) => [product.id, product]));
  const linkedInventoryIds = new Set<string>();

  const addIssue = (input: IssueInput) => {
    issues.push({
      id: `${input.issueType}:${input.entity.type}:${input.entity.id}:${input.field}`,
      issueType: input.issueType,
      severity: input.severity,
      category: input.category,
      affectedEntity: input.entity,
      affectedField: input.field,
      message: input.message,
      explanation: input.explanation,
      scoreImpact: input.scoreImpact,
    });
  };

  for (const product of merchant.products) {
    const entity: AffectedEntity = {
      type: "product",
      id: product.id,
      name: displayProductName(product.name, product.id),
    };
    const name = product.name?.trim() ?? "";

    if (!name) {
      addIssue({
        issueType: "PRODUCT_NAME_MISSING",
        severity: "critical",
        category: "productData",
        entity,
        field: "name",
        message: "Product name is missing.",
        explanation: "AI buyers need a clear product name to identify this catalog item.",
        scoreImpact: 5,
      });
    } else if (name.length < 3) {
      addIssue({
        issueType: "PRODUCT_NAME_INCOMPLETE",
        severity: "warning",
        category: "productData",
        entity,
        field: "name",
        message: "Product name is too short to be reliably descriptive.",
        explanation: "Names must contain at least three non-whitespace characters.",
        scoreImpact: 3,
      });
    }

    const description = product.description?.trim() ?? "";
    if (!hasQualityDescription(description)) {
      addIssue({
        issueType: "PRODUCT_DESCRIPTION_INSUFFICIENT",
        severity: "warning",
        category: "productData",
        entity,
        field: "description",
        message: "Product description is too brief for reliable interpretation.",
        explanation: "Descriptions must contain at least 40 characters and six words.",
        scoreImpact: 3,
      });
    }

    const categoryName = product.category?.trim() ?? "";
    const matchedCategory = productCategoryByNormalizedName.get(
      normalizeCategory(categoryName),
    );

    if (!categoryName) {
      addIssue({
        issueType: "CATEGORY_MISSING",
        severity: "high",
        category: "productData",
        entity,
        field: "category",
        message: "Product category is missing.",
        explanation: "A category is required to apply consistent product requirements.",
        scoreImpact: 3,
      });
    } else if (!matchedCategory) {
      addIssue({
        issueType: "CATEGORY_UNRECOGNIZED",
        severity: "high",
        category: "productData",
        entity,
        field: "category",
        message: `“${categoryName}” is not in the supported category list.`,
        explanation: "Supported categories are Apparel, Home, and Electronics.",
        scoreImpact: 3,
      });
    } else if (categoryName !== matchedCategory.canonicalName) {
      addIssue({
        issueType: "CATEGORY_NOT_CANONICAL",
        severity: "warning",
        category: "productData",
        entity,
        field: "category",
        message: `Category should use the canonical value “${matchedCategory.canonicalName}”.`,
        explanation: "Category names must use the shared canonical spelling and casing.",
        scoreImpact: 2,
      });
    }

    if (matchedCategory) {
      for (const attribute of matchedCategory.requiredAttributes) {
        if (!isPresent(product.attributes?.[attribute])) {
          addIssue({
            issueType: "REQUIRED_ATTRIBUTE_MISSING",
            severity: "warning",
            category: "productData",
            entity,
            field: `attributes.${attribute}`,
            message: `Required ${attribute} attribute is missing.`,
            explanation: `${matchedCategory.canonicalName} products require a ${attribute} value.`,
            scoreImpact: 2,
          });
        }
      }
    }

    if (!isValidPrice(product.price)) {
      addIssue({
        issueType: "PRICE_INVALID",
        severity: "critical",
        category: "productData",
        entity,
        field: "price",
        message: "Product price must be a positive finite number.",
        explanation: "A product cannot be safely represented for commerce with an absent, zero, or negative price.",
        scoreImpact: 5,
      });
    }

    auditVariants(product.variants, entity, addIssue);

    const inventoryItemId = product.inventoryItemId?.trim() ?? "";
    if (!inventoryItemId) {
      addIssue({
        issueType: "INVENTORY_LINK_MISSING",
        severity: "high",
        category: "inventoryQuality",
        entity,
        field: "inventoryItemId",
        message: "Product is not linked to an inventory record.",
        explanation: "Every sellable product needs an explicit inventory relationship.",
        scoreImpact: 6,
      });
    } else {
      linkedInventoryIds.add(inventoryItemId);
      const inventoryItem = inventoryById.get(inventoryItemId);

      if (!inventoryItem) {
        addIssue({
          issueType: "INVENTORY_RECORD_NOT_FOUND",
          severity: "high",
          category: "inventoryQuality",
          entity,
          field: "inventoryItemId",
          message: `Inventory record “${inventoryItemId}” does not exist.`,
          explanation: "The product's inventory link must point to an available inventory record.",
          scoreImpact: 6,
        });
      } else if (inventoryItem.productId !== product.id) {
        addIssue({
          issueType: "INVENTORY_PRODUCT_MISMATCH",
          severity: "high",
          category: "inventoryQuality",
          entity,
          field: "inventoryItemId",
          message: "Inventory record belongs to a different product.",
          explanation: "A product can only reference inventory assigned to the same product ID.",
          scoreImpact: 5,
        });
      }
    }
  }

  auditInventory(merchant.inventory, productsById, linkedInventoryIds, addIssue);
  auditPolicies(merchant, addIssue);

  const categoryScores = calculateCategoryScores(issues);
  const overallScore = categoryScores.reduce((total, score) => total + score.score, 0);

  return {
    merchantId: merchant.id,
    merchantName: merchant.name,
    iteration,
    overallScore,
    categoryScores,
    issueCount: issues.length,
    issues,
    scoringExplanation:
      "The overall score is the sum of four category scores. Each category begins at its maximum and loses only the listed score impacts, never dropping below zero.",
  };
}

function auditVariants(
  variants: VariantInput[] | null | undefined,
  entity: AffectedEntity,
  addIssue: (input: IssueInput) => void,
): void {
  if (variants === undefined || variants === null) {
    return;
  }

  if (!Array.isArray(variants) || variants.length === 0) {
    addIssue({
      issueType: "VARIANT_STRUCTURE_INVALID",
      severity: "high",
      category: "variantQuality",
      entity,
      field: "variants",
      message: "Variants must be a non-empty list when supplied.",
      explanation: "Products without variants may omit this field; products with variants need structured entries.",
      scoreImpact: 5,
    });
    return;
  }

  const optionKeyShapes: string[] = [];

  variants.forEach((variant, index) => {
    const fieldPrefix = `variants[${index}]`;
    if (!isVariantObject(variant)) {
      addIssue({
        issueType: "VARIANT_STRUCTURE_INVALID",
        severity: "high",
        category: "variantQuality",
        entity,
        field: fieldPrefix,
        message: "Variant is not a structured object.",
        explanation: "Each variant must provide a SKU and a set of named options.",
        scoreImpact: 5,
      });
      return;
    }

    if (!variant.sku?.trim()) {
      addIssue({
        issueType: "VARIANT_SKU_MISSING",
        severity: "high",
        category: "variantQuality",
        entity,
        field: `${fieldPrefix}.sku`,
        message: "Variant SKU is missing.",
        explanation: "Each sellable variant needs a stable SKU identifier.",
        scoreImpact: 4,
      });
    }

    if (!hasValidOptions(variant.options)) {
      addIssue({
        issueType: "VARIANT_OPTIONS_MISSING",
        severity: "high",
        category: "variantQuality",
        entity,
        field: `${fieldPrefix}.options`,
        message: "Variant options are missing or incomplete.",
        explanation: "Each variant needs at least one named option with a value, such as color or size.",
        scoreImpact: 4,
      });
      return;
    }

    optionKeyShapes.push(Object.keys(variant.options).sort().join("|"));
  });

  if (new Set(optionKeyShapes).size > 1) {
    addIssue({
      issueType: "VARIANT_OPTION_KEYS_INCONSISTENT",
      severity: "warning",
      category: "variantQuality",
      entity,
      field: "variants.options",
      message: "Variants do not use a consistent set of option names.",
      explanation: "All variants for a product must use the same option keys so they can be compared reliably.",
      scoreImpact: 4,
    });
  }
}

function auditInventory(
  inventory: InventoryItem[],
  productsById: Map<string, unknown>,
  linkedInventoryIds: Set<string>,
  addIssue: (input: IssueInput) => void,
): void {
  for (const inventoryItem of inventory) {
    const entity: AffectedEntity = {
      type: "inventory",
      id: inventoryItem.id,
      name: `Inventory ${inventoryItem.id}`,
    };

    if (!productsById.has(inventoryItem.productId)) {
      addIssue({
        issueType: "INVENTORY_PRODUCT_NOT_FOUND",
        severity: "high",
        category: "inventoryQuality",
        entity,
        field: "productId",
        message: "Inventory record references a product that does not exist.",
        explanation: "Inventory must be attached to a catalog product.",
        scoreImpact: 5,
      });
    } else if (!linkedInventoryIds.has(inventoryItem.id)) {
      addIssue({
        issueType: "INVENTORY_NOT_LINKED",
        severity: "warning",
        category: "inventoryQuality",
        entity,
        field: "id",
        message: "Inventory record is not linked from its product.",
        explanation: "The owning product must explicitly reference this inventory record.",
        scoreImpact: 3,
      });
    }

    if (!isValidInventoryQuantity(inventoryItem.quantity)) {
      addIssue({
        issueType: "INVENTORY_QUANTITY_INVALID",
        severity: "critical",
        category: "inventoryQuality",
        entity,
        field: "quantity",
        message: "Inventory quantity must be a whole number of zero or more.",
        explanation: "Negative or fractional stock cannot be used for availability decisions.",
        scoreImpact: 5,
      });
    }
  }
}

function auditPolicies(
  merchant: MerchantData,
  addIssue: (input: IssueInput) => void,
): void {
  const entity: AffectedEntity = {
    type: "merchant_policy",
    id: merchant.id,
    name: merchant.name,
  };
  const { currency, maxQuantityPerItem, returnPolicy, shippingPolicy, autonomousPurchasePolicy } = merchant.policies;

  if (!currency || typeof currency !== "string" || currency.trim() === "") {
    addIssue({
      issueType: "CURRENCY_MISSING",
      severity: "high",
      category: "policyCompleteness",
      entity,
      field: "policies.currency",
      message: "Merchant currency is missing.",
      explanation: "A currency must be specified for autonomous purchasing.",
      scoreImpact: 5,
    });
  }

  if (!isNonNegativeInteger(maxQuantityPerItem)) {
    addIssue({
      issueType: "MAX_QUANTITY_PER_ITEM_MISSING",
      severity: "high",
      category: "policyCompleteness",
      entity,
      field: "policies.maxQuantityPerItem",
      message: "Maximum quantity per item is missing or invalid.",
      explanation: "A maximum quantity per item must be explicitly defined.",
      scoreImpact: 5,
    });
  }

  if (
    !returnPolicy ||
    !isNonNegativeInteger(returnPolicy.windowDays) ||
    !hasNonBlankText(returnPolicy.summary)
  ) {
    addIssue({
      issueType: "RETURN_POLICY_INCOMPLETE",
      severity: "high",
      category: "policyCompleteness",
      entity,
      field: "policies.returnPolicy",
      message: "Return policy is missing required details.",
      explanation: "Return policies require a non-negative return window and a human-readable summary.",
      scoreImpact: 5,
    });
  }

  if (
    !shippingPolicy ||
    !hasShippingRegions(shippingPolicy.regions) ||
    !isNonNegativeInteger(shippingPolicy.processingDays)
  ) {
    addIssue({
      issueType: "SHIPPING_POLICY_INCOMPLETE",
      severity: "high",
      category: "policyCompleteness",
      entity,
      field: "policies.shippingPolicy",
      message: "Shipping policy is missing required details.",
      explanation: "Shipping policies require at least one service region and a non-negative processing time.",
      scoreImpact: 5,
    });
  }

  if (
    !autonomousPurchasePolicy ||
    !isNonNegativeFiniteNumber(autonomousPurchasePolicy.requiresApprovalAbove) ||
    !isNonNegativeFiniteNumber(autonomousPurchasePolicy.maxOrderValue)
  ) {
    addIssue({
      issueType: "AUTONOMOUS_PURCHASE_BOUNDARY_MISSING",
      severity: "high",
      category: "policyCompleteness",
      entity,
      field: "policies.autonomousPurchasePolicy",
      message: "Autonomous purchase policy is missing required boundaries.",
      explanation: "Merchants must explicitly define an approval threshold and maximum order value.",
      scoreImpact: 5,
    });
  }
}

function calculateCategoryScores(issues: ReadinessIssue[]): CategoryScore[] {
  return CATEGORY_DEFINITIONS.map((definition) => {
    const deductions = issues
      .filter((issue) => issue.category === definition.category)
      .reduce((total, issue) => total + issue.scoreImpact, 0);

    return {
      category: definition.category,
      label: definition.label,
      maximum: definition.maximum,
      deductions,
      score: Math.max(0, definition.maximum - deductions),
    };
  });
}

function normalizeCategory(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function displayProductName(name: string | null | undefined, id: string): string {
  return name?.trim() || `Unnamed product (${id})`;
}

function hasQualityDescription(value: string): boolean {
  return value.length >= 40 && value.split(/\s+/).filter(Boolean).length >= 6;
}

function isPresent(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
}

function isValidPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isVariantObject(value: VariantInput): value is Variant {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidOptions(
  value: Variant["options"],
): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, optionValue]) => key.trim().length > 0 && typeof optionValue === "string" && optionValue.trim().length > 0,
    )
  );
}

function isValidInventoryQuantity(value: unknown): value is number {
  return isNonNegativeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasNonBlankText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasShippingRegions(value: unknown): value is string[] {
  return Array.isArray(value) && value.some((region) => hasNonBlankText(region));
}
