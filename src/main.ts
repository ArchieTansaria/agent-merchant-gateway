import { demoMerchant } from "./data/demoMerchant.js";
import { auditMerchant } from "./readiness/audit.js";
import { ingestMerchant } from "./readiness/ingest.js";
import type { ReadinessAudit, ReadinessIssue } from "./readiness/types.js";

const audit = auditMerchant(ingestMerchant(demoMerchant));
const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("Dashboard root element was not found.");
}

app.innerHTML = renderDashboard(audit);

function renderDashboard(result: ReadinessAudit): string {
  return `
    <header class="page-header">
      <p class="eyebrow">AI Commerce Readiness Agent</p>
      <h1>${escapeHtml(result.merchantName)}</h1>
      <p class="subtitle">Demo merchant audit · deterministic checks only</p>
    </header>

    <section class="summary-grid" aria-label="Readiness summary">
      <article class="score-card">
        <p class="card-label">Overall readiness</p>
        <p class="score"><span>${result.overallScore}</span> / 100</p>
        <p class="score-note">${readinessLabel(result.overallScore)}</p>
      </article>
      <article class="metric-card">
        <p class="card-label">Detected issues</p>
        <p class="metric">${result.issueCount}</p>
        <p class="metric-note">${severitySummary(result.issues)}</p>
      </article>
    </section>

    <section class="panel" aria-labelledby="category-scores-heading">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Scoring breakdown</p>
          <h2 id="category-scores-heading">Category scores</h2>
        </div>
        <p class="panel-note">Each score starts at its category maximum; issue impacts are deducted.</p>
      </div>
      <div class="category-grid">
        ${result.categoryScores
          .map(
            (category) => `
              <article class="category-card">
                <div class="category-topline">
                  <h3>${escapeHtml(category.label)}</h3>
                  <strong>${category.score}/${category.maximum}</strong>
                </div>
                <div class="meter" aria-label="${escapeHtml(category.label)} score ${category.score} out of ${category.maximum}">
                  <span style="width: ${(category.score / category.maximum) * 100}%"></span>
                </div>
                <p>${category.deductions === 0 ? "No deductions" : `${category.deductions} point deduction`}${category.deductions === 1 ? "" : category.deductions === 0 ? "" : "s"}</p>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>

    <section class="panel" aria-labelledby="issues-heading">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Audit findings</p>
          <h2 id="issues-heading">Detected issues</h2>
        </div>
        <p class="panel-note">${escapeHtml(result.scoringExplanation)}</p>
      </div>
      ${renderIssues(result.issues)}
    </section>
  `;
}

function renderIssues(issues: ReadinessIssue[]): string {
  if (issues.length === 0) {
    return '<p class="empty-state">No readiness issues found.</p>';
  }

  return `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Severity</th>
            <th scope="col">Issue</th>
            <th scope="col">Affected product / entity</th>
            <th scope="col">Field</th>
            <th scope="col">Score impact</th>
          </tr>
        </thead>
        <tbody>
          ${issues
            .map(
              (issue) => `
                <tr>
                  <td><span class="severity severity-${issue.severity}">${issue.severity}</span></td>
                  <td>
                    <strong>${escapeHtml(issue.message)}</strong>
                    <span class="issue-type">${escapeHtml(issue.issueType)}</span>
                    <span class="issue-explanation">${escapeHtml(issue.explanation)}</span>
                  </td>
                  <td>${escapeHtml(issue.affectedEntity.name)}</td>
                  <td><code>${escapeHtml(issue.affectedField)}</code></td>
                  <td>−${issue.scoreImpact}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function severitySummary(issues: ReadinessIssue[]): string {
  const count = (severity: ReadinessIssue["severity"]) =>
    issues.filter((issue) => issue.severity === severity).length;
  const parts = (["critical", "high", "warning"] as const)
    .map((severity) => ({ severity, total: count(severity) }))
    .filter(({ total }) => total > 0)
    .map(({ severity, total }) => `${total} ${severity}`);

  return parts.join(" · ") || "No issues";
}

function readinessLabel(score: number): string {
  if (score >= 90) return "AI-ready data foundation";
  if (score >= 70) return "Mostly ready; targeted improvements needed";
  return "Readiness work required before autonomous commerce";
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ] ?? character,
  );
}
