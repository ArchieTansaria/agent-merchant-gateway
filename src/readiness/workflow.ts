import { auditMerchant } from "./audit.js";
import { readIssueValue, writeMerchantField } from "./fieldAccess.js";
import { ingestMerchant } from "./ingest.js";
import { proposeCorrections } from "./proposals.js";
import { validateCorrectionProposal } from "./validator.js";
import type {
  ChangeLogRecord,
  ImprovementRun,
  MerchantData,
  ReadinessIssue,
  ReviewItem,
  ValidatedCorrection,
} from "./types.js";

/** Runs audit → proposal → validation → safe application → re-audit on clones only. */
export async function runReadinessImprovements(source: MerchantData, onProgress?: (state: string) => void): Promise<ImprovementRun> {
  const sourceMerchant = ingestMerchant(source);
  const beforeAudit = auditMerchant(sourceMerchant);
  
  const proposals = await proposeCorrections(sourceMerchant, beforeAudit, onProgress);
  
  onProgress?.("SAFETY VALIDATION");
  const validations = proposals.map((proposal) =>
    validateCorrectionProposal(sourceMerchant, beforeAudit, proposal),
  );
  const { merchant, changes } = applyValidatedCorrections(sourceMerchant, beforeAudit.issues, validations);
  const afterAudit = auditMerchant(merchant);
  const afterIssueIds = new Set(afterAudit.issues.map((issue) => issue.id));

  return {
    sourceMerchant,
    merchant,
    beforeAudit,
    afterAudit,
    proposals,
    validations,
    changes,
    reviewItems: createReviewItems(beforeAudit.issues, validations, afterIssueIds),
    resolvedIssueIds: beforeAudit.issues
      .filter((issue) => !afterIssueIds.has(issue.id))
      .map((issue) => issue.id),
  };
}

/** Applies only proposals that already passed deterministic validation. */
export function applyValidatedCorrections(
  source: MerchantData,
  issues: ReadinessIssue[],
  validations: ValidatedCorrection[],
): { merchant: MerchantData; changes: ChangeLogRecord[] } {
  const merchant = ingestMerchant(source);
  const changes: ChangeLogRecord[] = [];
  const appliedIssueIds = new Set<string>();

  for (const validation of validations) {
    if (validation.action !== "AUTO_APPLY" || !validation.proposal) continue;
    const proposal = validation.proposal;
    if (appliedIssueIds.has(proposal.issueId)) continue;
    const issue = issues.find((candidate) => candidate.id === proposal.issueId);
    if (!issue) continue;

    const beforeValue = readIssueValue(merchant, issue);
    if (!sameValue(beforeValue, proposal.currentValue)) continue;
    if (!writeMerchantField(merchant, issue.affectedEntity, proposal.field, structuredClone(proposal.proposedValue))) continue;

    appliedIssueIds.add(proposal.issueId);
    changes.push(createChange(issue, proposal.field, beforeValue, proposal.proposedValue, proposal.reason, proposal.confidence, "AUTO_APPLIED"));
  }

  return { merchant, changes };
}

/** Restores the before-values from a change log on a new merchant snapshot. */
export function rollbackChanges(
  source: MerchantData,
  changes: ChangeLogRecord[],
): { merchant: MerchantData; changes: ChangeLogRecord[] } {
  const merchant = ingestMerchant(source);
  const rollbackRecords: ChangeLogRecord[] = [];

  for (const change of [...changes].reverse()) {
    if (writeMerchantField(merchant, change.entity, change.field, structuredClone(change.beforeValue))) {
      rollbackRecords.push({ ...change, status: "ROLLED_BACK", timestamp: new Date().toISOString() });
    }
  }

  return { merchant, changes: rollbackRecords };
}

/** Applies a value explicitly entered by a merchant for one queued review item. */
export function resolveReviewItem(
  run: ImprovementRun,
  reviewId: string,
  rawValue: unknown,
): ImprovementRun {
  const reviewItem = run.reviewItems.find((item) => item.id === reviewId && item.status === "REVIEW_REQUIRED");
  if (!reviewItem) return run;
  const merchant = ingestMerchant(run.merchant);
  const merchantValue = validateMerchantValue(merchant, reviewItem.issue, rawValue);
  if (!merchantValue.valid) return run;

  const beforeValue = readIssueValue(merchant, reviewItem.issue);
  if (!writeMerchantField(merchant, reviewItem.issue.affectedEntity, reviewItem.issue.affectedField, merchantValue.value)) {
    return run;
  }

  const change = createChange(
    reviewItem.issue,
    reviewItem.issue.affectedField,
    beforeValue,
    merchantValue.value,
    "Value explicitly supplied by the merchant during review.",
    1,
    "MERCHANT_APPLIED",
  );
  const afterAudit = auditMerchant(merchant);
  const afterIssueIds = new Set(afterAudit.issues.map((issue) => issue.id));
  const reviewItems = run.reviewItems.map((item) =>
    item.id === reviewId ? { ...item, status: "RESOLVED" as const, proposedValue: merchantValue.value } : item,
  );

  return {
    ...run,
    merchant,
    afterAudit,
    changes: [...run.changes, change],
    reviewItems,
    resolvedIssueIds: run.beforeAudit.issues
      .filter((issue) => !afterIssueIds.has(issue.id))
      .map((issue) => issue.id),
  };
}

function createReviewItems(
  issues: ReadinessIssue[],
  validations: ValidatedCorrection[],
  afterIssueIds: Set<string>,
): ReviewItem[] {
  return validations.flatMap((validation) => {
    if (validation.action !== "REVIEW_REQUIRED" || !validation.proposal) return [];
    const issue = issues.find((candidate) => candidate.id === validation.proposal?.issueId);
    if (!issue || !afterIssueIds.has(issue.id)) return [];
    return [{
      id: `review:${issue.id}`,
      issue,
      proposal: validation.proposal,
      currentValue: validation.proposal.currentValue,
      proposedValue: validation.proposal.proposedValue,
      reason: validation.reason,
      confidence: validation.proposal.confidence,
      status: "REVIEW_REQUIRED" as const,
    }];
  });
}

function validateMerchantValue(
  merchant: MerchantData,
  issue: ReadinessIssue,
  rawValue: unknown,
): { valid: true; value: unknown } | { valid: false } {
  const text = typeof rawValue === "string" ? rawValue.trim() : "";
  if (issue.issueType === "PRODUCT_NAME_MISSING" || issue.issueType === "PRODUCT_NAME_INCOMPLETE") {
    return text.length >= 3 ? { valid: true, value: text } : { valid: false };
  }
  if (issue.issueType === "PRODUCT_DESCRIPTION_INSUFFICIENT") {
    return text.length >= 40 && text.split(/\s+/).filter(Boolean).length >= 6
      ? { valid: true, value: text }
      : { valid: false };
  }
  if (issue.issueType === "REQUIRED_ATTRIBUTE_MISSING") {
    return text ? { valid: true, value: text } : { valid: false };
  }
  if (issue.issueType === "PRICE_INVALID") {
    const value = Number(rawValue);
    return Number.isFinite(value) && value > 0 ? { valid: true, value } : { valid: false };
  }
  if (issue.issueType === "INVENTORY_QUANTITY_INVALID") {
    const value = Number(rawValue);
    return Number.isInteger(value) && value >= 0 ? { valid: true, value } : { valid: false };
  }
  if (issue.issueType === "INVENTORY_LINK_MISSING") {
    const inventory = merchant.inventory.find((item) => item.id === text && item.productId === issue.affectedEntity.id);
    return inventory ? { valid: true, value: inventory.id } : { valid: false };
  }
  if (issue.issueType === "AUTONOMOUS_PURCHASE_BOUNDARY_MISSING") {
    const value = Number(rawValue);
    return Number.isFinite(value) && value >= 0 ? { valid: true, value } : { valid: false };
  }
  return { valid: false };
}

function createChange(
  issue: ReadinessIssue,
  field: string,
  beforeValue: unknown,
  afterValue: unknown,
  reason: string,
  confidence: number,
  status: ChangeLogRecord["status"],
): ChangeLogRecord {
  return {
    id: `${status}:${issue.id}:${field}`,
    issueId: issue.id,
    entity: issue.affectedEntity,
    field,
    beforeValue: structuredClone(beforeValue),
    afterValue: structuredClone(afterValue),
    reason,
    confidence,
    timestamp: new Date().toISOString(),
    status,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
