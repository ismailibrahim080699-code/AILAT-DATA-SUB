import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const data = readFileSync(new URL("../data.html", import.meta.url), "utf8");
const summary = readFileSync(new URL("../order_summary.html", import.meta.url), "utf8");
const backend = readFileSync(new URL("../supabase/functions/ailat-order-requests/index.ts", import.meta.url), "utf8");
test("server catalogue supplies Buy Data plans and prices", () => {
  assert.ok(data.includes('"?action=plans"'));
  assert.ok(data.includes("result.plans"));
  assert.ok(data.includes("item.amount"));
});
test("order handoff uses session storage rather than URL query parameters", () => {
  assert.ok(data.includes('sessionStorage.setItem("ailat_data_order_draft"'));
  assert.ok(data.includes('window.location.href="order_summary.html"'));
  assert.ok(!/[?&](?:phone|plan_id|network)=/i.test(data));
});
test("Buy Data validates the Nigerian phone and selected plan", () => {
  assert.ok(data.includes("/^0[789][01]\\d{8}$/"));
  assert.ok(data.includes("if(!selected)"));
});
test("summary re-loads catalogue and validates draft identifiers", () => {
  assert.ok(summary.includes('sessionStorage.getItem("ailat_data_order_draft")'));
  assert.ok(summary.includes("selectedPlan = DATA_PLANS.find"));
  assert.ok(summary.includes("suppliedNetworkId!==expectedNetworkId"));
});
test("submission requires verified email and stable idempotency key", () => {
  assert.ok(summary.includes("!user.emailVerified"));
  assert.ok(summary.includes("crypto.randomUUID()"));
  assert.ok(summary.includes("idempotency_key:requestKey"));
});
test("client request does not send price or supplier credentials", () => {
  const start = summary.indexOf("body:JSON.stringify(");
  const end = summary.indexOf("\n  });", start);
  assert.ok(start >= 0 && end > start);
  const body = summary.slice(start, end);
  assert.ok(body.includes("catalog_plan_id:selectedPlan.id"));
  assert.ok(!/(?:amount|price|api[_-]?key|supplier[_-]?token)\\s*:/i.test(body));
});

test("backend plan list fails closed on invalid provider mappings and prices", () => {
  assert.ok(backend.includes("Number.isSafeInteger(supplierPlanId) || supplierPlanId <= 0"));
  assert.ok(backend.includes("Number.isSafeInteger(supplierNetworkId) || supplierNetworkId !== expectedProviderNetworkId"));
  assert.ok(backend.includes("expectedProviderNetworkId === null"));
  assert.ok(backend.includes("!Number.isFinite(supplierAmount) || supplierAmount <= 0"));
  assert.ok(backend.includes('vitel: null'));
});
test("authenticated order path rejects invalid provider IDs and prices", () => {
  assert.ok(backend.includes("Number(plan.supplier_plan_id) <= 0"));
  assert.ok(backend.includes("Number(plan.supplier_network_id) <= 0"));
  assert.ok(backend.includes("!Number.isFinite(supplierAmount) || supplierAmount <= 0"));
  assert.ok(backend.includes("No order was placed."));
});
test("Buy Data request endpoint remains request-only", () => {
  assert.ok(backend.includes('provider_dispatch_status: serviceKey === "data" ? "disabled_safe_mode"'));
  assert.ok(backend.includes("Request record only. No payment was taken and no service was delivered."));
  assert.ok(!backend.includes('fetch("https://legitdataway.com/api/data"'));
});
