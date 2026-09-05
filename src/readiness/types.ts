export const AUDIT_CATEGORIES = [
  "productData",
  "variantQuality",
  "inventoryQuality",
  "policyCompleteness",
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
export type Severity = "critical" | "high" | "warning";

export interface Variant {
  sku?: string | null;
  options?: Record<string, string | null | undefined> | null;
}

export type VariantInput = Variant | string | null;

export interface Product {
  id: string;
  name?: string | null;
  description?: string | null;
  category?: string | null;
  attributes?: Record<string, unknown>;
  price?: number | null;
  inventoryItemId?: string | null;
  variants?: VariantInput[] | null;
}

export interface InventoryItem {
  id: string;
  productId: string;
  sku: string;
  quantity: number | null;
}

export interface ReturnPolicy {
  windowDays?: number | null;
  summary?: string | null;
}

export interface ShippingPolicy {
  regions?: string[] | null;
  processingDays?: number | null;
}

export interface AutonomousPurchasePolicy {
  requiresApprovalAbove?: number | null;
}

export interface MerchantPolicies {
  returnPolicy?: ReturnPolicy | null;
  shippingPolicy?: ShippingPolicy | null;
  autonomousPurchasePolicy?: AutonomousPurchasePolicy | null;
}

export interface MerchantData {
  id: string;
  name: string;
  products: Product[];
  inventory: InventoryItem[];
  policies: MerchantPolicies;
}

export interface AffectedEntity {
  type: "product" | "inventory" | "merchant_policy";
  id: string;
  name: string;
}

export interface ReadinessIssue {
  id: string;
  issueType: string;
  severity: Severity;
  category: AuditCategory;
  affectedEntity: AffectedEntity;
  affectedField: string;
  message: string;
  explanation: string;
  scoreImpact: number;
}

export interface CategoryScore {
  category: AuditCategory;
  label: string;
  maximum: number;
  score: number;
  deductions: number;
}

export interface ReadinessAudit {
  merchantId: string;
  merchantName: string;
  overallScore: number;
  categoryScores: CategoryScore[];
  issueCount: number;
  issues: ReadinessIssue[];
  scoringExplanation: string;
}
