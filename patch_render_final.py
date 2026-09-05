import re

with open("/Users/archietans/Developer/projects/agent-merchant-gateway/src/main.ts", "r") as f:
    content = f.read()

# I will find the range from function renderFlow to the end of renderChanges and replace it entirely.
# Let's use regex to find start of renderFlow and end of renderChanges.
start = content.find("function renderFlow(audit: ReadinessAudit): string {")
end_str = "\nfunction renderReviewQueue(items: ReviewItem[]): string {"
end = content.find(end_str)

if start != -1 and end != -1:
    new_content = """function renderFlow(audit: ReadinessAudit): string {
  const state = isProcessing ? "processing" : auditHistory.length > 1 ? "complete" : "idle";
  
  let aiBtnText = "Run AI readiness pass";
  if (isProcessing) aiBtnText = progressState;
  
  let actionBtn = `<button class="primary-button" data-action="run-improvements" ${isProcessing ? "disabled" : ""}>${escapeHtml(aiBtnText)}</button>`;
  
  let reauditBtn = `<button class="secondary-button" data-action="re-audit" ${isProcessing ? "disabled" : ""}>Re-audit</button>`;
  
  let publishBtn = `<button class="primary-button" disabled>Publishing requires 90+</button>`;
  if (audit.overallScore >= 90) {
    publishBtn = `<button class="primary-button" style="background:#039855; border-color:#039855;" data-action="publish">Publish to AI Commerce</button>`;
  }

  return `<section class="flow-strip state-${state}" aria-label="Readiness workflow">
    <div style="display: flex; gap: 8px;">
      ${actionBtn}
      ${auditHistory.length > 1 ? reauditBtn : ""}
      ${publishBtn}
    </div>
    <span class="flow-score">Current Score: ${audit.overallScore}/100</span>
  </section>`;
}

function renderScores(result: ReadinessAudit): string {
  const before = auditHistory.length > 1 ? auditHistory[0] : null;
  return `<section class="summary-grid" aria-label="Readiness summary">
    ${before ? `<article class="metric-card"><p class="card-label">Initial audit</p><p class="metric">${before.overallScore}<small>/100</small></p><p class="metric-note">Before any changes</p></article>` : ""}
    <article class="score-card"><p class="card-label">Current readiness</p><p class="score"><span>${result.overallScore}</span> / 100</p><p class="score-note">${readinessLabel(result.overallScore)}</p></article>
    <article class="metric-card"><p class="card-label">Current issues</p><p class="metric">${result.issueCount}</p><p class="metric-note">${severitySummary(result.issues)}</p></article>
    ${before ? `<article class="metric-card"><p class="card-label">Score movement</p><p class="metric positive">${result.overallScore >= before.overallScore ? '+' : ''}${result.overallScore - before.overallScore}</p><p class="metric-note">Since initial audit</p></article>` : ""}
  </section>
  <section class="panel" aria-labelledby="category-scores-heading"><div class="panel-heading"><div><p class="eyebrow">Scoring breakdown</p><h2 id="category-scores-heading">Category scores</h2></div><p class="panel-note">Every deduction is tied to a visible audit issue. Scores never fall below zero.</p></div><div class="category-grid">${result.categoryScores.map((category) => `<article class="category-card"><div class="category-topline"><h3>${escapeHtml(category.label)}</h3><strong>${category.score}/${category.maximum}</strong></div><div class="meter"><span style="width:${(category.score / category.maximum) * 100}%"></span></div><p>${category.deductions ? `${category.deductions} point deductions` : "No deductions"}</p></article>`).join("")}</div></section>`;
}

function renderInitialAudit(audit: ReadinessAudit): string {
  return `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">Initial audit</p><h2>Detected issues</h2></div><p class="panel-note">Run improvements to generate proposals. The source merchant data is never changed directly.</p></div>${renderIssues(audit.issues)}</section>`;
}

function renderWorkflow(): string {
  if (!initialAudit || !currentAudit) return "";
  
  const initialIssueIds = new Set(initialAudit.issues.map(i => i.id));
  const currentIssueIds = new Set(currentAudit.issues.map(i => i.id));
  
  let originallyResolved = 0;
  let originallyRemain = 0;
  let newIssues = 0;
  
  for (const id of initialIssueIds) {
    if (currentIssueIds.has(id)) originallyRemain++;
    else originallyResolved++;
  }
  for (const id of currentIssueIds) {
    if (!initialIssueIds.has(id)) newIssues++;
  }
  
  const reviewRequired = currentReviewQueue.filter(i => i.status === "REVIEW_REQUIRED").length;
  
  return `<section class="workflow-metrics" aria-label="Improvement outcome">
    <article class="outcome outcome-auto">
      <strong>Initial audit: ${initialAudit.issues.length} issues</strong>
      <span>Resolved: ${originallyResolved}</span>
    </article>
    <article class="outcome outcome-review">
      <strong>Re-audit: ${currentAudit.issues.length} remaining</strong>
      <span>${originallyRemain} original, ${newIssues} new</span>
    </article>
    <article class="outcome outcome-blocked">
      <strong>${reviewRequired > 0 ? `${reviewRequired} need review` : "No pending AI reviews"}</strong>
      <span>${currentAudit.issues.length > 0 ? "Issues remain." : "Ready to publish!"}</span>
    </article>
  </section>
  <section class="panel"><div class="panel-heading"><div><p class="eyebrow">Audit iterations</p><h2>Audit history</h2></div><p class="panel-note">Every audit and iteration of the workflow.</p></div>
    <div style="padding:16px;">
      ${auditHistory.map(a => `<div style="margin-bottom:8px;"><strong>Audit #${a.iteration}</strong> — Score: ${a.overallScore}/100 — ${a.issues.length} issues</div>`).join("")}
    </div>
  </section>
  <section class="panel"><div class="panel-heading"><div><p class="eyebrow">Merchant review queue</p><h2>Decisions the agent cannot make</h2></div><p class="panel-note">Policy and commercial decisions require explicit merchant input. The agent never chooses their value.</p></div>${renderReviewQueue(currentReviewQueue)}</section>
  <section class="panel"><div class="panel-heading"><div><p class="eyebrow">AI corrections</p><h2>Applied change log</h2></div><p class="panel-note">Every automatic write has a before value, after value, reason, confidence, timestamp, and rollback-ready record.</p></div>${renderChanges()}</section>`;
}

function renderChanges(): string {
  if (!changeLog.length) return '<p class="empty-state">No safe corrections were applied.</p>';
  return `<div class="change-list">${changeLog.map((change) => `<article class="change-row"><span class="status-badge status-${change.status.toLowerCase()}">${change.status === "AUTO_APPLIED" ? "Automatically fixed" : "Merchant applied"}</span><div><strong>${escapeHtml(change.entity.name)} · <code>${escapeHtml(change.field)}</code></strong><p><span class="value-before">${escapeHtml(formatValue(change.beforeValue))}</span> → <span class="value-after">${escapeHtml(formatValue(change.afterValue))}</span></p><small>${escapeHtml(change.reason)} · ${(change.confidence * 100).toFixed(0)}% confidence · ${escapeHtml(change.timestamp)}</small></div></article>`).join("")}</div>`;
}"""
    content = content[:start] + new_content + content[end:]
    with open("/Users/archietans/Developer/projects/agent-merchant-gateway/src/main.ts", "w") as f:
        f.write(content)
    print("Replaced safely")
else:
    print("Could not find boundaries")
