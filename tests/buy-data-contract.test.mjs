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
  assert.ok(backend.includes('providerDispatchStatus = "disabled_safe_mode"'));
  assert.ok(backend.includes('provider_dispatch_status: providerDispatchStatus'));
  assert.ok(backend.includes("Request record only. No payment was taken and no service was delivered."));
  assert.ok(!backend.includes('fetch("https://legitdataway.com/api/data"'));
});

const airtime = readFileSync(new URL("../airtime.html", import.meta.url), "utf8");
const airtimeSummary = readFileSync(new URL("../airtime_order_summary.html", import.meta.url), "utf8");
test("Airtime customer details are handed off through session storage, not URL parameters", () => {
  assert.ok(airtime.includes('sessionStorage.setItem("ailat_airtime_draft_v1"'));
  assert.ok(airtime.includes("window.location.href='airtime_order_summary.html'"));
  assert.ok(!airtime.includes("airtime_order_summary.html?"));
  assert.ok(airtimeSummary.includes('sessionStorage.getItem("ailat_airtime_draft_v1")'));
  assert.ok(!airtimeSummary.includes("new URLSearchParams(window.location.search)"));
});
test("Airtime request remains clearly request-only and requires verified email", () => {
  assert.ok(airtimeSummary.includes("!user.emailVerified"));
  assert.ok(airtimeSummary.includes('service_key:"airtime"'));
  assert.ok(airtimeSummary.includes("No payment was taken and no airtime was sent."));
  assert.ok(airtime.includes("Supplier dispatch disabled"));
});

test("Airtime provider preview uses documented Legitdataway VTU contract in safe mode", () => {
  assert.ok(backend.includes('const airtimeProviderNetworkIds: Record<string, number | null>'));
  assert.ok(backend.includes('plan_type: "VTU"'));
  assert.match(backend, /phone,\s*plan_type: "VTU"/);
  assert.ok(backend.includes("supplierNetworkId === null || supplierNetworkId === undefined"));
  assert.ok(backend.includes("No request was recorded."));
  assert.ok(backend.includes('mtn: 1'));
  assert.ok(backend.includes('airtel: 2'));
  assert.ok(backend.includes('glo: 3'));
  assert.ok(backend.includes('"9mobile": 4'));
  assert.ok(backend.includes('"request-id": reference'));
  assert.ok(backend.includes('providerDispatchStatus = "disabled_safe_mode"'));
  assert.ok(!backend.includes('providerDispatchStatus = "provider_mapping_missing"'));
  assert.ok(backend.includes('provider_request_preview: providerRequestPreview'));
  assert.ok(!backend.includes('fetch("https://legitdataway.com/api/topup"'));
  assert.ok(!backend.includes('fetch("https://legitdataway.com/api/data"'));
});

test("Airtime UI does not offer Vitel without a documented supplier network ID", () => {
  assert.ok(airtime.includes('class="network unavailable"'));
  assert.ok(airtime.includes("Not available yet"));
  assert.ok(!airtime.includes("chooseNetwork(this,'Vitel')"));
});

test("Airtime receipt distinguishes AILAT request recording from supplier fulfilment", () => {
  assert.ok(airtimeSummary.includes("Request recording only"));
  assert.ok(airtimeSummary.includes("does not mean Legitdataway has accepted or delivered airtime"));
  assert.ok(backend.includes('status: "received"'));
  assert.ok(backend.includes("Request record only. No payment was taken and no service was delivered."));
});

test("Idempotency key cannot be reused for different Airtime or Data details", () => {
  assert.ok(backend.includes("const sameRequest ="));
  assert.ok(backend.includes("existing.service_key === serviceKey"));
  assert.ok(backend.includes("existingData.phone === phone"));
  assert.ok(backend.includes("Number(existing.requested_amount) === Number(requestedAmount)"));
  assert.ok(backend.includes("This request key was already used for different order details"));
  assert.ok(backend.includes("}, 409);"));
});

const airtimeToCash = readFileSync(new URL("../airtime_to_cash.html", import.meta.url), "utf8");
const airtimeToCashSummary = readFileSync(new URL("../airtime_to_cash_summary.html", import.meta.url), "utf8");
test("Airtime-to-Cash customer details stay in session storage, not URL parameters", () => {
  assert.ok(airtimeToCash.includes('sessionStorage.setItem("ailat_airtime_to_cash_review"'));
  assert.ok(airtimeToCash.includes('window.location.href="airtime_to_cash_summary.html"'));
  assert.ok(!airtimeToCash.includes("airtime_to_cash_summary.html?"));
  assert.ok(airtimeToCashSummary.includes('sessionStorage.getItem("ailat_airtime_to_cash_review")'));
  assert.ok(!airtimeToCashSummary.includes("new URLSearchParams(window.location.search)"));
});

const electricity = readFileSync(new URL("../electricity.html", import.meta.url), "utf8");
const electricitySummary = readFileSync(new URL("../electricity_order_summary.html", import.meta.url), "utf8");
const electricityBackend = readFileSync(new URL("../supabase/functions/ailat-electricity-orders/index.ts", import.meta.url), "utf8");
test("Electricity form uses documented Legitdataway DISCO identifiers and meter types", () => {
  for (const id of ["1","2","3","4","5","6","7","8","9","10"]) assert.ok(electricity.includes(`value="${id}"`));
  assert.ok(electricity.includes('value="prepaid"'));
  assert.ok(electricity.includes('value="postpaid"'));
  assert.ok(electricity.includes('sessionStorage.setItem("ailat_electricity_review"'));
  assert.ok(electricity.includes('window.location.href="electricity_order_summary.html"'));
  assert.ok(!electricity.includes("electricity_order_summary.html?"));
});
test("Electricity summary validates local review details and does not claim payment", () => {
  assert.ok(electricitySummary.includes('sessionStorage.getItem("ailat_electricity_review")'));
  assert.ok(electricitySummary.includes("Electricity Payment Not Enabled"));
  assert.ok(electricitySummary.includes("no provider request is sent"));
});
test("Electricity supplier adapter matches documented Legitdataway bill contract but stays disabled", () => {
  assert.ok(electricityBackend.includes('Deno.env.get("LEGITDATAWAY_API_KEY")'));
  assert.ok(electricityBackend.includes('const LIVE_ENABLED = false;'));
  assert.ok(electricityBackend.includes('https://legitdataway.com/api/bill'));
  assert.ok(electricityBackend.includes('`Token ${LEGIT_API_KEY}`'));
  assert.ok(electricityBackend.includes('disco, meter_type: meterType, meter_number: meter, amount, bypass: false'));
  assert.ok(electricityBackend.includes('"request-id": vendorRequestId'));
  assert.ok(electricityBackend.includes('if (!LIVE_ENABLED || !LEGIT_API_KEY)'));
  assert.ok(!electricityBackend.includes("LEGITDATAWAY_USERNAME"));
  assert.ok(!electricityBackend.includes("getLegitAccessToken"));
});

test("Electricity summary submits an authenticated request-only record", () => {
  assert.ok(electricitySummary.includes("ailat-electricity-orders"));
  assert.ok(electricitySummary.includes("idempotency_key:key"));
  assert.ok(electricitySummary.includes("meter_number:meter"));
  assert.ok(electricitySummary.includes("!user.emailVerified"));
  assert.ok(electricitySummary.includes("No payment was taken"));
  assert.ok(electricitySummary.includes("no provider was contacted"));
});
test("Electricity backend records requests only and never calls the supplier", () => {
  assert.ok(electricityBackend.includes('status:"received"'));
  assert.ok(electricityBackend.includes('provider_dispatch_status:"disabled_safe_mode"'));
  assert.ok(electricityBackend.includes("idempotency_key:key"));
  assert.ok(electricityBackend.includes("This request key was already used for different electricity details"));
  assert.ok(!electricityBackend.includes("LEGITDATAWAY_API_KEY"));
  assert.ok(!electricityBackend.includes("legitdataway.com/api/bill"));
  assert.ok(!electricityBackend.includes("fetch("));
});
