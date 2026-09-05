import re

with open("/Users/archietans/Developer/projects/agent-merchant-gateway/src/main.ts", "r") as f:
    content = f.read()

# First, let's fix the event listeners logic
event_listeners_regex = re.compile(r'app\.addEventListener\("click", async \(event\) => \{.*?(?=const searchInput = )', re.DOTALL)
def replace_listeners(match):
    return """app.addEventListener("click", async (event) => {
  const target = event.target as Element;

  const demoBtn = target.closest<HTMLButtonElement>("button[data-action='use-demo']");
  if (demoBtn) {
    sourceMerchant = ingestMerchant(demoMerchant);
    currentMerchantState = sourceMerchant;
    initialAudit = auditMerchant(currentMerchantState, 1);
    currentAudit = initialAudit;
    auditHistory = [initialAudit];
    changeLog = [];
    currentReviewQueue = [];
    currentState = "DASHBOARD";
    render();
    return;
  }

  const runAuditBtn = target.closest<HTMLButtonElement>("button[data-action='run-audit']");
  if (runAuditBtn) {
    currentState = "AUDIT_LOADING";
    auditLoadingStep = "Preparing your imported catalog";
    render();
    await delay(550);
    auditLoadingStep = "Checking products, variants, inventory, and policies";
    render();
    await delay(650);
    currentMerchantState = sourceMerchant!;
    initialAudit = auditMerchant(currentMerchantState, 1);
    currentAudit = initialAudit;
    auditHistory = [initialAudit];
    changeLog = [];
    currentReviewQueue = [];
    auditLoadingStep = "Calculating your readiness score";
    render();
    await delay(550);
    currentState = "DASHBOARD";
    render();
    return;
  }

  const runImprovBtn = target.closest<HTMLButtonElement>("button[data-action='run-improvements']");
  if (runImprovBtn && !isProcessing && currentMerchantState) {
    isProcessing = true;
    progressState = "STARTING";
    render();
    
    try {
      const run = await runReadinessImprovements(currentMerchantState, (state) => {
        progressState = state;
        render();
      });
      // run is an ImprovementRun. Update our iterative state.
      currentMerchantState = run.merchant;
      
      // Merge changes
      changeLog = [...changeLog, ...run.changes];
      // Replace review queue entirely
      currentReviewQueue = run.reviewItems;
      
      // Update audit
      currentAudit = auditMerchant(currentMerchantState, auditHistory.length + 1);
      auditHistory.push(currentAudit);

    } catch (err) {
      console.error(err);
      alert("An error occurred running improvements");
    } finally {
      isProcessing = false;
      progressState = "COMPLETE";
      render();
    }
    return;
  }
  
  const reAuditBtn = target.closest<HTMLButtonElement>("button[data-action='re-audit']");
  if (reAuditBtn && !isProcessing && currentMerchantState) {
    isProcessing = true;
    progressState = "Re-auditing...";
    render();
    try {
      currentAudit = auditMerchant(currentMerchantState, auditHistory.length + 1);
      auditHistory.push(currentAudit);
      // Clear the active review queue, as the fresh audit provides the new ground truth
      currentReviewQueue = [];
    } finally {
      isProcessing = false;
      progressState = "COMPLETE";
      render();
    }
    return;
  }

  const publishBtn = target.closest<HTMLButtonElement>("button[data-action='publish']");
  if (publishBtn && currentMerchantState && currentAudit && currentAudit.overallScore >= 90) {
    publishBtn.disabled = true;
    publishBtn.textContent = "Publishing...";
    try {
      const payload = currentMerchantState;
      const res = await fetch("/api/merchant/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-merchant-session-id": "sess-" + Math.random().toString(36).substring(2, 9)
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      commerceSessionId = data.sessionId;
      currentState = "COMMERCE";
      await loadCommerceState();
    } catch (e: any) {
      alert("Failed to publish: " + e.message);
      publishBtn.disabled = false;
      publishBtn.textContent = "Publish to AI Commerce";
    }
    return;
  }

  """

content = event_listeners_regex.sub(replace_listeners, content)


# 2. Fix the review item submission handler
submit_review_regex = re.compile(r'const submitReviewBtn = target\.closest<HTMLButtonElement>\("button\[data-action=\'submit-review\'\]"\);.*?render\(\);\n\s*return;\n\s*\}', re.DOTALL)
def replace_submit_review(match):
    return """const submitReviewBtn = target.closest<HTMLButtonElement>("button[data-action='submit-review']");
  if (submitReviewBtn && currentMerchantState) {
    const itemEl = submitReviewBtn.closest(".review-card");
    const inputEl = itemEl?.querySelector<HTMLInputElement | HTMLSelectElement>("input.review-input, select.review-input");
    const reviewId = itemEl?.getAttribute("data-review-id");
    
    if (reviewId && inputEl) {
      // Create a dummy ImprovementRun so we can reuse resolveReviewItem
      const dummyRun = {
        sourceMerchant: currentMerchantState,
        merchant: currentMerchantState,
        beforeAudit: currentAudit!,
        afterAudit: currentAudit!,
        proposals: [],
        validations: [],
        changes: [],
        reviewItems: currentReviewQueue,
        resolvedIssueIds: []
      };
      
      const newRun = resolveReviewItem(dummyRun, reviewId, inputEl.value);
      
      // Sync state back
      currentMerchantState = newRun.merchant;
      currentReviewQueue = newRun.reviewItems;
      
      // Update changes log with any newly applied change
      if (newRun.changes.length > 0) {
        changeLog = [...changeLog, ...newRun.changes];
      }
      
      // Re-audit implicitly since merchant state changed
      currentAudit = auditMerchant(currentMerchantState, auditHistory.length + 1);
      auditHistory.push(currentAudit);
      
      render();
    }
    return;
  }"""
content = submit_review_regex.sub(replace_submit_review, content)

# 3. renderDashboard
dashboard_regex = re.compile(r'function renderDashboard\(\): string \{.*?\}', re.DOTALL)
def replace_dashboard(match):
    return """function renderDashboard(): string {
  if (!initialAudit || !currentAudit) return "";
  return `
    ${renderFlow(currentAudit)}
    ${renderScores(currentAudit)}
    ${auditHistory.length > 1 ? renderWorkflow() : renderInitialAudit(currentAudit)}
  `;
}"""
content = dashboard_regex.sub(replace_dashboard, content)

with open("/Users/archietans/Developer/projects/agent-merchant-gateway/src/main.ts", "w") as f:
    f.write(content)
print("Done")
