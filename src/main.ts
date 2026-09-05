import { demoMerchant } from "./data/demoMerchant.js";
import { auditMerchant } from "./readiness/audit.js";
import { ingestMerchant } from "./readiness/ingest.js";
import { resolveReviewItem, runReadinessImprovements } from "./readiness/workflow.js";
import type { ImprovementRun, ReadinessAudit, ReadinessIssue, ReviewItem } from "./readiness/types.js";

const sourceMerchant = ingestMerchant(demoMerchant);
const initialAudit = auditMerchant(sourceMerchant);
const app = document.querySelector<HTMLElement>("#app");
let improvementRun: ImprovementRun | null = null;
let isProcessing = false;
let progressState = "";
let aiProvider = "Loading provider...";

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
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-action='run-improvements']");
  if (!button || isProcessing || improvementRun) return;
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
});

app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.reviewId || !improvementRun) return;
  event.preventDefault();
  improvementRun = resolveReviewItem(improvementRun, form.dataset.reviewId, new FormData(form).get("merchantValue"));
  render();
});

render();

function render(): void {
  const currentAudit = improvementRun?.afterAudit ?? initialAudit;
  app!.innerHTML = `
    <header class="page-header">
      <p class="eyebrow">AI Commerce Readiness Agent</p>
      <h1>${escapeHtml(currentAudit.merchantName)}</h1>
      <p class="subtitle">Audit → proposal → deterministic validation → safe application → merchant review</p>
      <div class="provider-badge">AI Provider: ${escapeHtml(aiProvider)}</div>
    </header>
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
    ${before ? `<article class="metric-card"><p class="card-label">Score movement</p><p class="metric positive">+${result.overallScore - before.overallScore}</p><p class="metric-note">From actual re-audit results</p></article>` : ""}
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
  const numberInput = ["PRICE_INVALID", "INVENTORY_QUANTITY_INVALID", "AUTONOMOUS_PURCHASE_BOUNDARY_MISSING"].includes(item.issue.issueType);
  return `<form class="review-form" data-review-id="${escapeHtml(item.id)}"><label>Merchant value<input required name="merchantValue" type="${numberInput ? "number" : "text"}" ${numberInput ? "min=\"0\" step=\"any\"" : ""} placeholder="${escapeHtml(reviewPlaceholder(item))}" /></label><button type="submit">Apply merchant decision</button></form>`;
}

function reviewPlaceholder(item: ReviewItem): string {
  if (item.issue.issueType === "AUTONOMOUS_PURCHASE_BOUNDARY_MISSING") return "e.g. 5000";
  if (item.issue.issueType === "PRICE_INVALID") return "e.g. 1999";
  if (item.issue.issueType === "INVENTORY_QUANTITY_INVALID") return "e.g. 10";
  if (item.issue.issueType === "PRODUCT_DESCRIPTION_INSUFFICIENT") return "Provide at least six words and 40 characters";
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
