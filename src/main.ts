import { demoMerchant } from "./data/demoMerchant.js";
import { auditMerchant } from "./readiness/audit.js";
import { ingestMerchant } from "./readiness/ingest.js";
import { resolveReviewItem, runReadinessImprovements } from "./readiness/workflow.js";
import { CsvCatalogSource } from "./readiness/source.js";
import type { IngestionResult } from "./readiness/ingestCsv.js";
import type { ImprovementRun, ReadinessAudit, ReadinessIssue, ReviewItem, MerchantData } from "./readiness/types.js";

type AppState = "ONBOARDING" | "ONBOARDING_CSV" | "IMPORT_SUMMARY" | "DASHBOARD" | "COMMERCE";

let currentState: AppState = "ONBOARDING";
let sourceMerchant: MerchantData | null = null;
let initialAudit: ReadinessAudit | null = null;
let improvementRun: ImprovementRun | null = null;
let isProcessing = false;
let progressState = "";
let aiProvider = "Loading provider...";
let ingestionResult: IngestionResult | null = null;
let commerceSessionId: string | null = null;

// Commerce state
let commerceProducts: any[] = [];
let commerceCartId: string | null = null;
let commerceCart: any = null;
let commerceCheckoutResult: any = null;
let commerceSearchQuery = "";

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
    return;
  }

  const publishBtn = target.closest<HTMLButtonElement>("button[data-action='publish']");
  if (publishBtn && sourceMerchant && improvementRun) {
    publishBtn.disabled = true;
    publishBtn.textContent = "Publishing...";
    try {
      const payload = improvementRun.merchant;
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

  const selectSourceBtn = target.closest<HTMLButtonElement>("button[data-source]");
  if (selectSourceBtn) {
    const source = selectSourceBtn.dataset.source;
    if (source === "csv") {
      currentState = "ONBOARDING_CSV";
      render();
    } else {
      alert(source + " integration is coming soon!");
    }
    return;
  }
  
  const backBtn = target.closest<HTMLButtonElement>("button[data-action='back']");
  if (backBtn) {
    currentState = "ONBOARDING";
    render();
    return;
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
    const source = new CsvCatalogSource(text);
    ingestionResult = await source.import({ merchantId: "merchant-uploaded", merchantName: "Uploaded Merchant" });
    
    // Explicitly apply authoritative merchant policies to the canonical merchant state
    ingestionResult.merchant.policies = policies;

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

// COMMERCE API HELPERS
async function commerceApi(path: string, options: RequestInit = {}) {
  const headers = { ...options.headers, "x-merchant-session-id": commerceSessionId! } as any;
  if (options.body) headers["Content-Type"] = "application/json";
  
  const res = await fetch(`/api/commerce${path}`, { ...options, headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadCommerceState() {
  try {
    commerceProducts = await commerceApi("/products");
    if (!commerceCartId) {
      const cart = await commerceApi("/carts", { method: "POST" });
      commerceCartId = cart.id;
      commerceCart = cart;
    } else {
      commerceCart = await commerceApi(`/carts/${commerceCartId}`);
    }
    render();
  } catch (e) {
    console.error("Failed to load commerce state", e);
  }
}

app.addEventListener("click", async (event) => {
  const target = event.target as Element;
  
  const addBtn = target.closest<HTMLButtonElement>("button[data-commerce-action='add-to-cart']");
  if (addBtn && commerceCartId) {
    const productId = addBtn.dataset.productId;
    const variantId = addBtn.dataset.variantId || null;
    const quantity = parseInt(addBtn.dataset.quantity || "1", 10);
    
    try {
      addBtn.disabled = true;
      addBtn.textContent = "Adding...";
      await commerceApi(`/carts/${commerceCartId}/items`, {
        method: "POST",
        body: JSON.stringify({ productId, variantId, quantity })
      });
      // reload cart
      commerceCart = await commerceApi(`/carts/${commerceCartId}`);
      commerceCheckoutResult = null; // reset previous checkout status
      render();
    } catch (e: any) {
      alert("Failed to add to cart: " + JSON.parse(e.message).error);
    } finally {
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.textContent = "Add to Cart";
      }
    }
    return;
  }

  const removeBtn = target.closest<HTMLButtonElement>("button[data-commerce-action='remove-from-cart']");
  if (removeBtn && commerceCartId) {
    const productId = removeBtn.dataset.productId;
    const variantId = removeBtn.dataset.variantId || null;
    
    try {
      removeBtn.disabled = true;
      await commerceApi(`/carts/${commerceCartId}/items`, {
        method: "DELETE",
        body: JSON.stringify({ productId, variantId })
      });
      // reload cart
      commerceCart = await commerceApi(`/carts/${commerceCartId}`);
      commerceCheckoutResult = null; // reset previous checkout status
      render();
    } catch (e: any) {
      alert("Failed to remove from cart: " + (e.message.startsWith("{") ? JSON.parse(e.message).error : e.message));
      removeBtn.disabled = false;
    }
    return;
  }

  const checkoutBtn = target.closest<HTMLButtonElement>("button[data-commerce-action='checkout']");
  if (checkoutBtn && commerceCartId) {
    try {
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = "Checking out...";
      commerceCheckoutResult = await commerceApi("/checkout", {
        method: "POST",
        body: JSON.stringify({ cartId: commerceCartId })
      });
      
      if (commerceCheckoutResult.status === "ALLOW" && commerceCheckoutResult.razorpayOrderId) {
        initiateRazorpay(commerceCheckoutResult);
      }
      
      render();
    } catch (e: any) {
      alert("Checkout error: " + e.message);
    } finally {
      if (checkoutBtn) {
        checkoutBtn.disabled = false;
        checkoutBtn.textContent = "Checkout Server Cart";
      }
    }
    return;
  }

  const checkoutApproveBtn = target.closest<HTMLButtonElement>("button[data-commerce-action='checkout-approve']");
  if (checkoutApproveBtn && commerceCartId) {
    try {
      checkoutApproveBtn.disabled = true;
      checkoutApproveBtn.textContent = "Approving & Checking out...";
      commerceCheckoutResult = await commerceApi("/checkout", {
        method: "POST",
        body: JSON.stringify({ cartId: commerceCartId, forceApprove: true })
      });
      
      if (commerceCheckoutResult.status === "ALLOW" && commerceCheckoutResult.razorpayOrderId) {
        initiateRazorpay(commerceCheckoutResult);
      }
      
      render();
    } catch (e: any) {
      alert("Checkout error: " + e.message);
      checkoutApproveBtn.disabled = false;
      checkoutApproveBtn.textContent = "Manually Approve & Checkout";
    }
    return;
  }
});

app.addEventListener("input", async (event) => {
  const target = event.target as Element;
  if (target.id === "commerce-search") {
    commerceSearchQuery = (target as HTMLInputElement).value;
    try {
      commerceProducts = await commerceApi(`/products?query=${encodeURIComponent(commerceSearchQuery)}`);
      render();
    } catch (e) {
      console.error(e);
    }
  }
});

function initiateRazorpay(result: any) {
  const options = {
    key: "rzp_test_TYP6kyGg9ZJh2q", // Test mode public key
    amount: result.amount,
    currency: result.currency,
    name: "AI Commerce Demo",
    description: "Test Transaction",
    order_id: result.razorpayOrderId,
    handler: async function (response: any) {
      try {
        const verify = await commerceApi("/payment/verify", {
          method: "POST",
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
          })
        });
        if (verify.verified) {
          alert("Payment verified successfully!");
          // Reset cart
          commerceCartId = null;
          commerceCheckoutResult = null;
          await loadCommerceState();
        } else {
          alert("Payment verification failed!");
        }
      } catch (e) {
        alert("Verification error!");
      }
    },
    theme: {
      color: "#5d5fef"
    }
  };
  const rzp = new (window as any).Razorpay(options);
  rzp.open();
}

render();

function render(): void {
  let content = "";
  if (currentState === "ONBOARDING") {
    content = renderOnboardingSource();
  } else if (currentState === "ONBOARDING_CSV") {
    content = renderOnboardingCsv();
  } else if (currentState === "IMPORT_SUMMARY") {
    content = renderImportSummary();
  } else if (currentState === "DASHBOARD") {
    content = renderDashboard();
  } else if (currentState === "COMMERCE") {
    if (!commerceCartId) {
      // First render of commerce state, we kick off load and show loading state
      loadCommerceState();
      content = `<p style="text-align:center; padding: 40px;">Loading commerce state...</p>`;
    } else {
      content = renderCommercePlayground();
    }
  }

  app!.innerHTML = `
    <header class="page-header">
      <p class="eyebrow">AI Commerce Readiness Agent</p>
      <h1>${(currentState === "ONBOARDING" || currentState === "ONBOARDING_CSV") ? "Connect your commerce stack" : escapeHtml(sourceMerchant!.name)}</h1>
      <p class="subtitle">Audit → proposal → deterministic validation → safe application → merchant review</p>
      <div class="provider-badge">AI Provider: ${escapeHtml(aiProvider)}</div>
    </header>
    ${content}
  `;
}

function renderOnboardingSource(): string {
  return `
    <div class="onboarding-container" style="max-width: 860px; padding: 56px 48px; border: none; box-shadow: 0 8px 32px rgba(0,0,0,0.03);">
      <h2 style="text-align: center; margin-bottom: 12px; font-size: 1.35rem; color: #101828;">Connect your commerce stack</h2>
      <p class="panel-note" style="text-align: center; margin: 0 auto 40px; font-size: 0.95rem; line-height: 1.5; max-width: 520px; color: #667085;">
        Make your existing catalog ready for AI buyers. Your existing commerce systems remain the source of truth.
      </p>
      
      <div class="source-cards">
        <button type="button" class="source-card" data-source="Shopify">
          <strong>Shopify</strong>
          <span class="subtext">Auto-sync catalog</span>
          <span class="action-text">Connect</span>
        </button>

        <button type="button" class="source-card" data-source="Merchant API">
          <strong>Merchant API</strong>
          <span class="subtext">Connect your existing API</span>
          <span class="action-text">Connect</span>
        </button>

        <button type="button" class="source-card" data-source="csv">
          <strong>Import Catalog CSV</strong>
          <span class="subtext">Use an existing catalog export</span>
          <span class="action-text">Import</span>
        </button>
      </div>

      <div style="text-align: center; margin-top: 48px;">
        <button type="button" class="secondary-button" data-action="use-demo" style="border:none; background:none; color: #344054; font-weight: 700; padding: 0;">Use demo merchant instead</button>
      </div>
    </div>
  `;
}

function renderOnboardingCsv(): string {
  return `
    <div class="onboarding-container">
      <div style="margin-bottom: 24px;">
        <button type="button" data-action="back" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font:inherit; padding:0;">← Back to sources</button>
      </div>
      <h2>Import Catalog (CSV)</h2>
      
      <form id="onboarding-form">
        <div class="form-group">
          <label>Upload CSV File</label>
          <input type="file" name="csvFile" accept=".csv" required />
        </div>
        
        <h3 style="margin-top: 2rem;">Merchant Policies (Optional)</h3>
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

        <div class="onboarding-actions" style="margin-top: 2rem;">
          <button type="submit" class="primary-button">Connect Integration</button>
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
  
  let actionBtn = `<button class="primary-button" data-action="run-improvements" ${state === "idle" ? "" : "disabled"}>${escapeHtml(btnText)}</button>`;
  
  if (state === "complete" && audit.overallScore >= 90) {
    actionBtn = `<button class="primary-button" style="background:#039855; border-color:#039855;" data-action="publish">Publish to AI Commerce</button>`;
  } else if (state === "complete") {
     actionBtn = `<button class="primary-button" disabled>Resolve issues to publish</button>`;
  }

  return `<section class="flow-strip state-${state}" aria-label="Readiness workflow">
    <span>1. Audit</span><span>2. AI proposals</span><span>3. Safety validation</span><span>4. Apply safe changes</span><span>5. Merchant review</span><span>6. Re-audit</span>
    ${actionBtn}
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
  const numberInput = ["PRICE_INVALID", "INVENTORY_QUANTITY_INVALID", "CURRENCY_MISSING", "MAX_QUANTITY_PER_ITEM_MISSING", "INVENTORY_LINK_MISSING"].includes(item.issue.issueType);
  return `<form class="review-form" data-review-id="${escapeHtml(item.id)}"><label>Merchant value<input required name="merchantValue" type="${numberInput && item.issue.issueType !== "CURRENCY_MISSING" ? "number" : "text"}" ${numberInput && item.issue.issueType !== "CURRENCY_MISSING" ? "min=\"0\" step=\"any\"" : ""} placeholder="${escapeHtml(reviewPlaceholder(item))}" /></label><button type="submit">Apply merchant decision</button></form>`;
}

function reviewPlaceholder(item: ReviewItem): string {
  if (item.issue.issueType === "AUTONOMOUS_PURCHASE_BOUNDARY_MISSING") return "e.g. {\"requiresApprovalAbove\":1000,\"maxOrderValue\":5000}";
  if (item.issue.affectedField === "policies.autonomousPurchasePolicy.requiresApprovalAbove") return "e.g. 1000";
  if (item.issue.affectedField === "policies.autonomousPurchasePolicy") return 'e.g. {"requiresApprovalAbove": 100, "maxOrderValue": 500}';
  if (item.issue.issueType === "PRICE_INVALID") return "e.g. 1999";
  if (item.issue.issueType === "INVENTORY_QUANTITY_INVALID") return "e.g. 10";
  if (item.issue.issueType === "PRODUCT_DESCRIPTION_INSUFFICIENT") return "Provide at least six words and 40 characters";
  if (item.issue.issueType === "CURRENCY_MISSING") return "e.g. USD";
  if (item.issue.issueType === "MAX_QUANTITY_PER_ITEM_MISSING") return "e.g. 5";
  if (item.issue.issueType === "INVENTORY_LINK_MISSING") return "Enter starting stock quantity (e.g. 10)";
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

function renderCommercePlayground(): string {
  // Products HTML
  const productsHtml = commerceProducts.map(p => {
    // If it has variants, we show them, else we just use the product as the variant
    const options = p.variants && p.variants.length > 0 
      ? p.variants.map((v: any) => `
        <div style="margin-top: 8px; padding: 8px; border: 1px solid #e4e7ec; border-radius: 4px;">
          <small>${escapeHtml(JSON.stringify(v.options || v.sku))}</small>
          <div style="margin-top: 4px;">
            <button class="secondary-button" data-commerce-action="add-to-cart" data-product-id="${escapeHtml(p.id)}" data-variant-id="${escapeHtml(v.sku)}">Add 1</button>
            <button class="secondary-button" data-commerce-action="add-to-cart" data-product-id="${escapeHtml(p.id)}" data-variant-id="${escapeHtml(v.sku)}" data-quantity="10">Try Add 10 (Violate Max Qty)</button>
          </div>
        </div>
      `).join("")
      : `
        <div style="margin-top: 8px;">
          <button class="secondary-button" data-commerce-action="add-to-cart" data-product-id="${escapeHtml(p.id)}">Add 1</button>
        </div>
      `;

    return `
      <article class="source-card" style="cursor: default;">
        <strong>${escapeHtml(p.name)}</strong>
        <p class="subtext">${escapeHtml(p.description || "No description")}</p>
        <p><strong>${p.price}</strong></p>
        <div style="width: 100%;">
          ${options}
        </div>
      </article>
    `;
  }).join("");

  // Cart HTML
  let cartHtml = "<p>Cart is empty</p>";
  if (commerceCart && commerceCart.items && commerceCart.items.length > 0) {
    cartHtml = commerceCart.items.map((item: any) => `
      <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eaecf0; align-items: center;">
        <div>
          <span>${escapeHtml(item.productId)} (${escapeHtml(item.variantId || "default")})</span>
          <br/>
          <strong>x${item.quantity}</strong>
        </div>
        <button class="secondary-button" style="padding: 4px 8px; font-size: 12px; color: #b42318; border-color: #fca5a5;" data-commerce-action="remove-from-cart" data-product-id="${escapeHtml(item.productId)}" data-variant-id="${escapeHtml(item.variantId || "")}">Remove</button>
      </div>
    `).join("");
  }

  // Checkout Result HTML
  let checkoutHtml = "";
  if (commerceCheckoutResult) {
    const statusColor = commerceCheckoutResult.status === "ALLOW" ? "#027a48" : commerceCheckoutResult.status === "DENY" ? "#b42318" : "#b54708";
    const statusBg = commerceCheckoutResult.status === "ALLOW" ? "#ecfdf3" : commerceCheckoutResult.status === "DENY" ? "#fef3f2" : "#fffaeb";
    checkoutHtml = `
      <div style="margin-top: 16px; padding: 16px; border-radius: 8px; background: ${statusBg}; color: ${statusColor};">
        <strong>${commerceCheckoutResult.status}</strong>: ${escapeHtml(commerceCheckoutResult.reason || "")}
        <br/>
        <small>${escapeHtml(commerceCheckoutResult.code || "")}</small>
        ${commerceCheckoutResult.status === "REQUIRE_APPROVAL" ? `
        <div style="margin-top: 12px;">
          <button class="primary-button" style="width: 100%; justify-content: center; background: #e04f16; border-color: #e04f16;" data-commerce-action="checkout-approve">Manually Approve & Checkout</button>
        </div>` : ""}
      </div>
    `;
  }

  return `
    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px; padding: 24px;">
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Commerce API</p>
            <h2>Products Search</h2>
          </div>
        </div>
        <div style="padding: 16px;">
          <input type="text" id="commerce-search" placeholder="Search products..." value="${escapeHtml(commerceSearchQuery)}" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #d0d5dd; margin-bottom: 16px; font: inherit;" />
          <div class="source-cards" style="grid-template-columns: 1fr 1fr; gap: 16px;">
            ${productsHtml || "<p>No products found.</p>"}
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Server-side Cart</p>
            <h2>Current Cart</h2>
          </div>
        </div>
        <div style="padding: 16px;">
          ${cartHtml}
          <div style="margin-top: 24px;">
            <button class="primary-button" style="width: 100%; justify-content: center;" data-commerce-action="checkout" ${!commerceCart || !commerceCart.items || commerceCart.items.length === 0 ? "disabled" : ""}>Checkout Server Cart</button>
          </div>
          ${checkoutHtml}
        </div>
      </section>
    </div>
  `;
}
