import re

with open("/Users/archietans/Developer/projects/agent-merchant-gateway/src/main.ts", "r") as f:
    content = f.read()

# I will find the renderWorkflow function and replace it up to renderChanges
def replace_everything(match):
    return """function renderWorkflow(): string {
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

content = re.sub(r'function renderWorkflow\(\): string \{.*?function renderChanges\([^\)]*\): string \{.*?\}', replace_everything, content, flags=re.DOTALL)

with open("/Users/archietans/Developer/projects/agent-merchant-gateway/src/main.ts", "w") as f:
    f.write(content)
print("Done")
