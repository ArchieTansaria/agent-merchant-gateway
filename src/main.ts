import { demoMerchant } from "./data/demoMerchant.js";
import { auditMerchant } from "./readiness/audit.js";
import { ingestMerchant } from "./readiness/ingest.js";
import { resolveReviewItem, runReadinessImprovements } from "./readiness/workflow.js";
import { ingestCsv, IngestionResult } from "./readiness/ingestCsv.js";
import type { ImprovementRun, ReadinessAudit, ReadinessIssue, ReviewItem, MerchantData } from "./readiness/types.js";

type AppState = "ONBOARDING" | "IMPORT_SUMMARY" | "DASHBOARD";

let currentState: AppState = "ONBOARDING";
let sourceMerchant: MerchantData | null = null;
let initialAudit: ReadinessAudit | null = null;
let improvementRun: ImprovementRun | null = null;
let isProcessing = false;
let progressState = "";
let aiProvider = "Loading provider...";
let ingestionResult: IngestionResult | null = null;

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Dashboard root element was not found.");

fetch("/api/ai/status")
  .then(res => res.json())
  .then(data => {
    aiProvider = data.provider === "llm" && data.hasKey ? "Gemini" : "Deterministic Demo Provider";
    render();
  })
  .catch(() => {
    aiProvider = "Deterministic Demo Provider";
    render();
  });

app.addEventListener("click", async (event) => {
  const target = event.target as Element;

  const demoBtn = target.closest<HTMLButtonElement>("button[data-action='use-demo']");
  if (demoBtn) {
    sourceMerchant = ingestMerchant(demoMerchant);
    initialAudit = auditMerchant(sourceMerchant);
    currentState = "DASHBOARD";
    render();
    return;
  }

  const runAuditBtn = target.closest<HTMLButtonElement>("button[data-action='run-audit']");
  if (runAuditBtn) {
    initialAudit = auditMerchant(sourceMerchant!);
    currentState = "DASHBOARD";
    render();
    return;
  }

  const runImprovBtn = target.closest<HTMLButtonElement>("button[data-action='run-improvements']");
  if (runImprovBtn && !isProcessing && !improvementRun && sourceMerchant) {
    isProcessing = true;
    progressState = "STARTING";
    render();
    
    try {
      improvementRun = await runReadinessImprovements(sourceMerchant, (state) => {
        progressState = state;
        render();
      });
    } catch (err) {
      console.error(err);
      alert("An error occurred running improvements");
    } finally {
      isProcessing = false;
      progressState = "COMPLETE";
      render();
    }
  }
});

app.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();

  if (form.id === "onboarding-form") {
    const formData = new FormData(form);
    const file = formData.get("csvFile") as File;
    
    if (!file || file.size === 0) {
      alert("Please upload a CSV file.");
      return;
    }

    const policies: MerchantData["policies"] = {
      currency: formData.get("currency") as string || null,
      maxQuantityPerItem: formData.get("maxQuantityPerItem") ? Number(formData.get("maxQuantityPerItem")) : null,
      returnPolicy: formData.get("returnWindow") ? { windowDays: Number(formData.get("returnWindow")), summary: "Merchant return policy" } : null,
      autonomousPurchasePolicy: formData.get("approvalThreshold") || formData.get("maxOrderValue") ? {
        requiresApprovalAbove: formData.get("approvalThreshold") ? Number(formData.get("approvalThreshold")) : null,
        maxOrderValue: formData.get("maxOrderValue") ? Number(formData.get("maxOrderValue")) : null,
      } : null,
      shippingPolicy: null
    };

    const text = await file.text();
    ingestionResult = ingestCsv(text, "merchant-uploaded", "Uploaded Merchant", policies);
    sourceMerchant = ingestMerchant(ingestionResult.merchant);
    currentState = "IMPORT_SUMMARY";
    render();
    return;
  }

  if (form.dataset.reviewId && improvementRun) {
    let merchantValue: unknown = new FormData(form).get("merchantValue");
    if (typeof merchantValue === "string" && merchantValue.trim().startsWith("{")) {
      try {
        merchantValue = JSON.parse(merchantValue);
      } catch (e) {
        // ignore
      }
    }
    improvementRun = resolveReviewItem(improvementRun, form.dataset.reviewId, merchantValue);
    render();
  }
});

render();

function render(): void {
  let content = "";
  if (currentState === "ONBOARDING") {
    content = renderOnboarding();
  } else if (currentState === "IMPORT_SUMMARY") {
    content = renderImportSummary();
  } else {
    content = renderDashboard();
  }

  app!.innerHTML = `
    <header class="page-header">
      <p class="eyebrow">AI Commerce Readiness Agent</p>
      <h1>${currentState === "ONBOARDING" ? "Connect your merchant data" : escapeHtml(sourceMerchant!.name)}</h1>
      <p class="subtitle">Audit → proposal → deterministic validation → safe application → merchant review</p>
      <div class="provider-badge">AI Provider: ${escapeHtml(aiProvider)}</div>
    </header>
    ${content}
  `;
}

function renderOnboarding(): string {
  return `
    <div class="onboarding-container">
      <h2>Merchant Configuration</h2>
      <form id="onboarding-form">
        <div class="form-group">
          <label>Upload Catalog (CSV)</label>
          <input type="file" name="csvFile" accept=".csv" />
        </div>
        
        <h3>Merchant Policies (Optional)</h3>
        <p class="panel-note">Values entered here are authoritative.</p>
        <div class="form-group">
          <label>Currency</label>
          <input type="text" name="currency" placeholder="e.g. USD, INR" />
        </div>
        <div class="form-group">
          <label>Maximum Quantity Per Item</label>
          <input type="number" name="maxQuantityPerItem" min="1" placeholder="e.g. 5" />
        </div>
        <div class="form-group">
          <label>Approval Threshold (requires approval above)</label>
          <input type="number" name="approvalThreshold" min="0" placeholder="e.g. 1000" />
        </div>
        <div class="form-group">
          <label>Maximum Autonomous Order Value</label>
          <input type="number" name="maxOrderValue" min="0" placeholder="e.g. 5000" />
        </div>
        <div class="form-group">
          <label>Return Window (Days)</label>
          <input type="number" name="returnWindow" min="0" placeholder="e.g. 30" />
        </div>

        <div class="onboarding-actions">
          <button type="submit" class="primary-button">Upload CSV</button>
          <button type="button" class="secondary-button" data-action="use-demo">Use demo merchant</button>
        </div>
      </form>
    </div>
  `;
}

function renderImportSummary(): string {
  if (!ingestionResult) return "";
  const productsCount = ingestionResult.merchant.products.length;
  const variantsCount = ingestionResult.merchant.products.reduce((acc, p) => acc + (p.variants?.length || 0), 0);
  const inventoryCount = ingestionResult.merchant.inventory.length;

  return `
    <div class="onboarding-container import-summary">
      <h2>Merchant imported</h2>
      
      <div class="metric-group">
        <div>
          <div class="metric">${productsCount}</div>
          <div>Products</div>
        </div>
        <div>
          <div class="metric">${variantsCount}</div>
          <div>Variants</div>
        </div>
        <div>
          <div class="metric">${inventoryCount}</div>
          <div>Inventory records</div>
        </div>
      </div>

      <p>Imported: ${ingestionResult.imported} rows</p>
      
      ${ingestionResult.errors.length > 0 ? `
        <div class="error-list">
          <strong>Errors (${ingestionResult.errors.length}):</strong>
          <ul>${ingestionResult.errors.map(e => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
        </div>
      ` : ""}
      
      ${ingestionResult.warnings.length > 0 ? `
        <div class="warning-list">
          <strong>Warnings (${ingestionResult.warnings.length}):</strong>
          <ul>${ingestionResult.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
        </div>
      ` : ""}

      <button class="primary-button" data-action="run-audit">Run AI Readiness Audit</button>
    </div>
  `;
}

function renderDashboard(): string {
  if (!initialAudit) return "";
  const currentAudit = improvementRun?.afterAudit ?? initialAudit;
  return `
    ${renderFlow(currentAudit)}
    ${renderScores(currentAudit, improvementRun?.beforeAudit)}
    ${improvementRun ? renderWorkflow(improvementRun) : renderInitialAudit(currentAudit)}
  `;
}

function renderFlow(audit: ReadinessAudit): string {
  const state = isProcessing ? "processing" : improvementRun ? "complete" : "idle";
  const btnText = isProcessing ? progressState : improvementRun ? "AI Improvements Applied" : "Run AI Improvements";
  return `<section class="flow-strip state-${state}" aria-label="Readiness workflow">
    <span>1. Audit</span><span>2. AI proposals</span><span>3. Safety validation</span><span>4. Apply safe changes</span><span>5. Merchant review</span><span>6. Re-audit</span>
    <button class="primary-button" data-action="run-improvements" ${state === "idle" ? "" : "disabled"}>${escapeHtml(btnText)}</button>
    <span class="flow-score">Current: ${audit.overallScore}/100</span>
  </section>`;
}

function renderScores(result: ReadinessAudit, before?: ReadinessAudit): string {
  return `<section class="summary-grid" aria-label="Readiness summary">
    ${before ? `<article class="metric-card"><p class="card-label">Before</p><p class="metric">${before.overallScore}<small>/100</small></p><p class="metric-note">Original audit</p></article>` : ""}
    <article class="score-card"><p class="card-label">${before ? "After safe changes" : "Overall readiness"}</p><p class="score"><span>${result.overallScore}</span> / 100</p><p class="score-note">${readinessLabel(result.overallScore)}</p></article>
    <article class="metric-card"><p class="card-label">Detected issues</p><p class="metric">${result.issueCount}</p><p class="metric-note">${severitySummary(result.issues)}</p></article>
    ${before ? `<article class="metric-card"><p class="card-label">Score movement</p><p class="metric positive">${result.overallScore >= before.overallScore ? '+' : ''}${result.overallScore - before.overallScore}</p><p class="metric-note">From actual re-audit results</p></article>` : ""}
  </section>
  <section class="panel" aria-labelledby="category-scores-heading"><div class="panel-heading"><div><p class="eyebrow">Scoring breakdown</p><h2 id="category-scores-heading">Category scores</h2></div><p class="panel-note">Every deduction is tied to a visible audit issue. Scores never fall below zero.</p></div><div class="category-grid">${result.categoryScores.map((category) => `<article class="category-card"><div class="category-topline"><h3>${escapeHtml(category.label)}</h3><strong>${category.score}/${category.maximum}</strong></div><div class="meter"><span style="width:${(category.score / category.maximum) * 100}%"></span></div><p>${category.deductions ? `${category.deductions} point deductions` : "No deductions"}</p></article>`).join("")}</div></section>`;
}

function renderInitialAudit(audit: ReadinessAudit): string {
  return `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">Initial audit</p><h2>Detected issues</h2></div><p class="panel-note">Run improvements to generate proposals. The source merchant data is never changed directly.</p></div>${renderIssues(audit.issues)}</section>`;
}

function renderWorkflow(run: ImprovementRun): string {
  const reviewRequired = run.reviewItems.filter((item) => item.status === "REVIEW_REQUIRED").length;
  return `<section class="workflow-metrics" aria-label="Improvement outcome">
    <article class="outcome outcome-auto"><strong>✓ ${run.changes.filter((change) => change.status === "AUTO_APPLIED").length} automatically fixed</strong><span>High-confidence proposals passed deterministic validation.</span></article>
    <article class="outcome outcome-review"><strong>⚠ ${reviewRequired} merchant decisions required</strong><span>Sensitive or ambiguous values were not invented.</span></article>
    <article class="outcome outcome-blocked"><strong>✗ ${run.afterAudit.issueCount - reviewRequired} unresolved / blocking</strong><span>Issues remain until a valid merchant value is supplied.</span></article>
  </section>
  <section class="panel"><div class="panel-heading"><div><p class="eyebrow">AI corrections</p><h2>Applied change log</h2></div><p class="panel-note">Every automatic write has a before value, after value, reason, confidence, timestamp, and rollback-ready record.</p></div>${renderChanges(run)}</section>
  <section class="panel"><div class="panel-heading"><div><p class="eyebrow">Merchant review queue</p><h2>Decisions the agent cannot make</h2></div><p class="panel-note">Policy and commercial decisions require explicit merchant input. The agent never chooses their value.</p></div>${renderReviewQueue(run.reviewItems)}</section>
  <section class="panel"><div class="panel-heading"><div><p class="eyebrow">Re-audit</p><h2>Remaining issues</h2></div><p class="panel-note">${run.resolvedIssueIds.length} initial issue${run.resolvedIssueIds.length === 1 ? "" : "s"} resolved after corrections.</p></div>${renderIssues(run.afterAudit.issues)}</section>`;
}

function renderChanges(run: ImprovementRun): string {
  if (!run.changes.length) return '<p class="empty-state">No safe corrections were applied.</p>';
  return `<div class="change-list">${run.changes.map((change) => `<article class="change-row"><span class="status-badge status-${change.status.toLowerCase()}">${change.status === "AUTO_APPLIED" ? "✓ Automatically fixed" : "Merchant applied"}</span><div><strong>${escapeHtml(change.entity.name)} · <code>${escapeHtml(change.field)}</code></strong><p><span class="value-before">${escapeHtml(formatValue(change.beforeValue))}</span> → <span class="value-after">${escapeHtml(formatValue(change.afterValue))}</span></p><small>${escapeHtml(change.reason)} · ${(change.confidence * 100).toFixed(0)}% confidence · ${escapeHtml(change.timestamp)}</small></div></article>`).join("")}</div>`;
}

function renderReviewQueue(items: ReviewItem[]): string {
  if (!items.length) return '<p class="empty-state">No merchant decisions are currently required.</p>';
  return `<div class="review-list">${items.map((item) => `<article class="review-card ${item.status === "RESOLVED" ? "review-resolved" : ""}"><div><span class="status-badge status-review">${item.status === "RESOLVED" ? "✓ Resolved by merchant" : "⚠ Review required"}</span><h3>${escapeHtml(item.issue.message)}</h3><p><code>${escapeHtml(item.issue.affectedField)}</code> · Current value: <strong>${escapeHtml(formatValue(item.currentValue))}</strong></p><p>${escapeHtml(item.reason)}</p><small>AI proposed: ${escapeHtml(formatValue(item.proposedValue))} · Confidence: ${(item.confidence * 100).toFixed(0)}%</small></div>${item.status === "REVIEW_REQUIRED" ? renderReviewForm(item) : ""}</article>`).join("")}</div>`;
}

function renderReviewForm(item: ReviewItem): string {
  const numberInput = ["PRICE_INVALID", "INVENTORY_QUANTITY_INVALID", "AUTONOMOUS_PURCHASE_BOUNDARY_MISSING", "CURRENCY_MISSING", "MAX_QUANTITY_PER_ITEM_MISSING"].includes(item.issue.issueType);
  return `<form class="review-form" data-review-id="${escapeHtml(item.id)}"><label>Merchant value<input required name="merchantValue" type="${numberInput && item.issue.issueType !== "CURRENCY_MISSING" ? "number" : "text"}" ${numberInput && item.issue.issueType !== "CURRENCY_MISSING" ? "min=\"0\" step=\"any\"" : ""} placeholder="${escapeHtml(reviewPlaceholder(item))}" /></label><button type="submit">Apply merchant decision</button></form>`;
}

function reviewPlaceholder(item: ReviewItem): string {
  if (item.issue.issueType === "AUTONOMOUS_PURCHASE_BOUNDARY_MISSING") return "e.g. { requiresApprovalAbove: 1000, maxOrderValue: 5000 }"; // Wait, in fieldAccess it expects JSON for the policy object if we resolve it this way, or just one value?
  // Let me just say "e.g. 1000" if the field is the specific property
  if (item.issue.affectedField === "policies.autonomousPurchasePolicy.requiresApprovalAbove") return "e.g. 1000";
  if (item.issue.affectedField === "policies.autonomousPurchasePolicy") return 'e.g. {"requiresApprovalAbove": 100, "maxOrderValue": 500}';
  if (item.issue.issueType === "PRICE_INVALID") return "e.g. 1999";
  if (item.issue.issueType === "INVENTORY_QUANTITY_INVALID") return "e.g. 10";
  if (item.issue.issueType === "PRODUCT_DESCRIPTION_INSUFFICIENT") return "Provide at least six words and 40 characters";
  if (item.issue.issueType === "CURRENCY_MISSING") return "e.g. USD";
  if (item.issue.issueType === "MAX_QUANTITY_PER_ITEM_MISSING") return "e.g. 5";
  return "Enter an explicit merchant value";
}

function renderIssues(issues: ReadinessIssue[]): string {
  if (!issues.length) return '<p class="empty-state">No readiness issues found.</p>';
  return `<div class="table-wrapper"><table><thead><tr><th>Severity</th><th>Issue</th><th>Entity</th><th>Field</th><th>Impact</th></tr></thead><tbody>${issues.map((issue) => `<tr><td><span class="severity severity-${issue.severity}">${issue.severity}</span></td><td><strong>${escapeHtml(issue.message)}</strong><span class="issue-type">${escapeHtml(issue.issueType)}</span><span class="issue-explanation">${escapeHtml(issue.explanation)}</span></td><td>${escapeHtml(issue.affectedEntity.name)}</td><td><code>${escapeHtml(issue.affectedField)}</code></td><td>−${issue.scoreImpact}</td></tr>`).join("")}</tbody></table></div>`;
}

function severitySummary(issues: ReadinessIssue[]): string {
  return (["critical", "high", "warning"] as const).map((severity) => `${issues.filter((issue) => issue.severity === severity).length} ${severity}`).filter((part) => !part.startsWith("0")).join(" · ") || "No issues";
}

function readinessLabel(score: number): string {
  if (score >= 90) return "AI-ready data foundation";
  if (score >= 70) return "Mostly ready; targeted improvements needed";
  return "Readiness work required before autonomous commerce";
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Not provided";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
