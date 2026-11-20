import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const FIREBASE_PROJECT_ID = "ailat-data";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LEGACY_SUPPLIER_TOKEN = ""; // Old supplier credentials are no longer read.
const LEGITDATAWAY_USERNAME = Deno.env.get("LEGITDATAWAY_USERNAME") ?? "";
const LEGITDATAWAY_PASSWORD = Deno.env.get("LEGITDATAWAY_PASSWORD") ?? "";
const LEGITDATAWAY_LIVE_ENABLED = (Deno.env.get("LEGITDATAWAY_LIVE_ENABLED") ?? "").toLowerCase() === "true";

const ALLOWED_ORIGIN = "https://ismailibrahim080699-code.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
  "Content-Type": "application/json",
};

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const firebaseKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

const INTERNAL_NETWORK_IDS: Record<string, number> = {
  mtn: 1,
  airtel: 2,
  glo: 3,
  "9mobile": 4,
  vitel: 5,
};

function internalNetworkId(network: string): number {
  return INTERNAL_NETWORK_IDS[network.toLowerCase()];
}

function validPhone(value: unknown): value is string {
  return typeof value === "string" && /^0[789][01]\d{8}$/.test(value);
}

function validNetwork(value: unknown): value is string {
  return typeof value === "string" && ["mtn", "airtel", "glo", "9mobile", "t2", "vitel"].includes(value.toLowerCase());
}

function calculateExamMarkup(examName: string): number {
  const name = examName.trim().toUpperCase();
  if (/\bWAEC\b/.test(name)) return 650;
  if (/\bNECO\b/.test(name)) return 680;
  if (/\bNABTEB\b/.test(name)) return 640;
  return 0;
}

function calculateCableMarkup(supplierAmount: number): number {
  // Approved AILAT DATA Cable TV pricing: 5% markup, minimum ₦300, rounded to whole Naira.
  return Math.max(300, Math.round(supplierAmount * 0.05));
}

async function getLegitdatawayAccessToken(): Promise<string> {
  if (!LEGITDATAWAY_USERNAME || !LEGITDATAWAY_PASSWORD) throw new Error("Legitdataway credentials are missing");
  const basic = btoa(`${LEGITDATAWAY_USERNAME}:${LEGITDATAWAY_PASSWORD}`);
  const response = await fetch("https://legitdataway.com/api/user", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json", "Authorization": `Basic ${basic}` },
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let result: Record<string, unknown> = {};
  try { result = JSON.parse(raw); } catch { /* supplier response was not JSON */ }
  if (!response.ok || String(result.status ?? "").toLowerCase() !== "success" || typeof result.AccessToken !== "string" || !result.AccessToken) {
    console.error("Legitdataway authentication rejected", { http_status: response.status, supplier_status: result.status ?? null });
    throw new Error("Legitdataway authentication failed");
  }
  return result.AccessToken;
}

function calculateProfit(bundleName: unknown): { dataSizeGb: number; profit: number } | null {
  if (typeof bundleName !== "string") return null;
  const match = bundleName.trim().match(/^(\d+(?:\.\d+)?)\s*(MB|GB)$/i);
  if (!match) return null;
  const size = Number(match[1]);
  const unit = match[2].toUpperCase();
  if (!Number.isFinite(size) || size <= 0) return null;
  // 1000 MB = 1 GB. Profit is ₦50 per GB, so 500MB earns ₦25.
  const dataSizeGb = unit === "MB" ? size / 1000 : size;
  const profit = Math.round(dataSizeGb * 50 * 100) / 100;
  return { dataSizeGb, profit };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return reply({ success: false, error: "Method not allowed" }, 405);

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error("Order request function is missing required Supabase secrets.");
      return reply({ success: false, error: "Backend configuration error" }, 500);
    }

    // Recharge-card catalogue from the provider documentation supplied for AILAT DATA.
    // Read-only: this route never calls the paid recharge_card endpoint or debits any wallet.
    if (req.method === "GET" && new URL(req.url).searchParams.get("action") === "recharge_card_plans") {
      const plans = [
        { plan_id: 1, network: "MTN", provider_amount: 97, face_value: 100, selling_price: 100, profit: 3, load_code: "*556#", balance_code: "*556#" },
        { plan_id: 3, network: "MTN", provider_amount: 485, face_value: 500, selling_price: 500, profit: 15, load_code: "*555*PIN#", balance_code: "*556#" },
        { plan_id: 5, network: "GLO", provider_amount: 196, face_value: 200, selling_price: 200, profit: 4, load_code: "*777#", balance_code: "*777#" },
        { plan_id: 6, network: "GLO", provider_amount: 490, face_value: 500, selling_price: 500, profit: 10, load_code: "*777#", balance_code: "*777#" },
        { plan_id: 8, network: "AIRTEL", provider_amount: 196, face_value: 200, selling_price: 200, profit: 4, load_code: "*126*PIN#", balance_code: "*126*PIN#" },
      ];
      return reply({
        success: true,
        plans,
        quantity_min: 1,
        quantity_max: 100,
        price_basis: "confirmed_face_value_selling_price_with_per_plan_profit",
        face_denominations_confirmed: true,
        purchase_enabled: false,
        source: "AILAT DATA read-only recharge-card catalogue",
        notice: "This is a read-only catalogue. It does not generate PINs or debit any wallet."
      });
    }

    if (req.method === "GET" && new URL(req.url).searchParams.get("action") === "cash_rates") {
      return reply({
        success: false,
        code: "AIRTIME_TO_CASH_SUPPLIER_MIGRATION_PENDING",
        error: "Airtime to Cash is temporarily unavailable while AILAT DATA moves to its approved supplier. No OTP was requested and no wallet was credited."
      }, 503);
    }

    if (req.method === "GET" && new URL(req.url).searchParams.get("action") === "plans") {
      const { data: catalogue, error: catalogueError } = await supabase.from("data_plan_catalog")
        .select("id,network,purchase_type,bundle_name,supplier_amount,selling_price,validity,supplier_plan_id,supplier_network_id")
        .eq("active", true).eq("supplier_mapping_status", "verified").order("supplier_amount", { ascending: true });
      if (catalogueError) return reply({ success: false, error: "Could not load verified data bundles" }, 500);
      const plans = (catalogue ?? []).flatMap((row: Record<string, unknown>) => {
        const supplierAmount = Number(row.supplier_amount);
        const sellingAmount = Number(row.selling_price);
        if (!Number.isFinite(supplierAmount) || supplierAmount <= 0 ||
            !Number.isFinite(sellingAmount) || sellingAmount < supplierAmount) return [];
        return [{ id: String(row.supplier_plan_id), network: row.network, internal_network_id: internalNetworkId(String(row.network)),
          type: row.purchase_type, name: row.bundle_name, validity: row.validity, supplier_amount: supplierAmount,
          supplier_plan_id: String(row.supplier_plan_id), amount: sellingAmount }];
      });
      return reply({ success: true, plans, source: "Legitdataway verified catalogue" });
    }

    // Read-only Airtime quote. MTN uses the observed 97/100 supplier debit
    // as a provisional 3% gross margin; this is an estimate beyond the
    // single confirmed ₦100 sample. Other networks remain unquoted.
    if (req.method === "GET" && new URL(req.url).searchParams.get("action") === "airtime_quote") {
      const quoteUrl = new URL(req.url);
      const quoteNetwork = String(quoteUrl.searchParams.get("network") ?? "").trim().toLowerCase();
      const quoteAmount = Number(quoteUrl.searchParams.get("amount"));
      if (!Number.isSafeInteger(quoteAmount) || quoteAmount < 50 || quoteAmount > 50000) {
        return reply({ success: false, error: "Airtime amount must be between ₦50 and ₦50,000." }, 400);
      }
      if (quoteNetwork !== "mtn") {
        return reply({ success: false, code: "AIRTIME_RATE_NOT_CONFIRMED",
          error: "A confirmed Legitdataway Airtime rate is not available for this network yet. No transaction was made." }, 409);
      }
      const supplierAmount = Math.round(quoteAmount * 0.97 * 100) / 100;
      const profitAmount = Math.round((quoteAmount - supplierAmount) * 100) / 100;
      return reply({
        success: true, network: "MTN", amount: quoteAmount,
        customer_pays: quoteAmount, supplier_estimated_cost: supplierAmount,
        estimated_profit: profitAmount, currency: "NGN",
        pricing_basis: "provisional_3_percent_margin_from_confirmed_100_naira_sample",
        confirmed_sample: { face_value: 100, supplier_debit: 97, gross_profit: 3 },
        live_purchase_enabled: false,
        notice: "Read-only estimate. Supplier cost must be reconciled against the actual Legitdataway balance change; no wallet was charged and no airtime was sent."
      });
    }


    // Cable TV read-only catalogue. Only manually verified supplier mappings are public.
    const requestUrl = new URL(req.url);
    const cableAction = requestUrl.searchParams.get("action");
    if (req.method === "GET" && cableAction === "cable_plans") {
      const { data: rows, error: cablePlansError } = await supabase
        .from("cable_tv_plan_catalog")
        .select("id,provider,supplier_cable_id,cableplan,display_name,supplier_amount,active,mapping_verified")
        .eq("active", true).eq("mapping_verified", true)
        .not("supplier_amount", "is", null)
        .order("supplier_amount", { ascending: true });
      if (cablePlansError) {
        console.error("Cable catalogue read failed:", cablePlansError.message);
        return reply({ success: false, error: "Could not load verified Cable TV plans." }, 500);
      }
      const plans = (rows ?? []).flatMap((row: Record<string, unknown>) => {
        const cost = Number(row.supplier_amount);
        const cableId = Number(row.supplier_cable_id);
        if (!Number.isFinite(cost) || cost <= 0 || ![1,2,3].includes(cableId) ||
            typeof row.cableplan !== "string" || !row.cableplan.trim()) return [];
        const markup = calculateCableMarkup(cost);
        return [{ id: Number(row.id), provider: row.provider, supplier_cable_id: cableId,
          cableplan: row.cableplan, name: row.display_name, supplier_amount: cost,
          markup_amount: markup, amount: cost + markup }];
      });
      return reply({ success: true, plans, pricing_rule: "5_percent_minimum_300_ngn",
        purchase_enabled: false, wallet_charge_enabled: false,
        notice: plans.length ? "Verified plan prices only. Cable purchase and wallet charging remain disabled pending supplier plan-ID and smart-card validation confirmation." : "No Cable TV plans have been activated. Add only plans whose exact Legitdataway cableplan values and supplier prices have been verified. No payment or subscription was made." });
    }
    if (req.method === "GET" && cableAction === "cable_validate") {
      return reply({
        success: false,
        code: "CABLE_VALIDATION_PENDING",
        error: "Smart Card validation is paused until Legitdataway confirms the official validation endpoint. No payment or subscription was made."
      }, 503);
    }

    // Legacy exam catalogue and JAMB verification are intentionally disabled during migration.
    const educationUrl = new URL(req.url);
    const educationAction = educationUrl.searchParams.get("action");
    if (req.method === "GET" && educationAction === "exam_plans") {
      return reply({ success: false, code: "EXAM_SUPPLIER_MIGRATION_PENDING",
        error: "Exam services are temporarily unavailable while the Legitdataway integration is being verified. No payment or PIN was issued." }, 503);
    }
    if (req.method === "POST" && educationAction === "verify_jamb") {
      return reply({ success: false, code: "EXAM_SUPPLIER_MIGRATION_PENDING",
        error: "JAMB profile verification is temporarily unavailable during supplier migration. No verification request was sent." }, 503);
    }

    const requestAuthorization = req.headers.get("Authorization") ?? "";
    const token = requestAuthorization.startsWith("Bearer ") ? requestAuthorization.slice(7) : "";
    if (!token) return reply({ success: false, error: "Login required" }, 401);

    let userId: string;
    try {
      const { payload } = await jwtVerify(token, firebaseKeys, {
        issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
        audience: FIREBASE_PROJECT_ID,
      });
      if (typeof payload.sub !== "string" || !payload.sub) {
        return reply({ success: false, error: "Invalid user session" }, 401);
      }
      if (payload.email_verified !== true) {
        return reply({ success: false, error: "Verified email required" }, 403);
      }
      userId = payload.sub;
    } catch {
      return reply({ success: false, error: "Invalid or expired login session" }, 401);
    }

    if (req.method === "GET") {
      const requestedReference = new URL(req.url).searchParams.get("reference");
      if (requestedReference) {
        if (!/^AIL-[A-Z0-9]{12}$/.test(requestedReference)) {
          return reply({ success: false, error: "Invalid order reference" }, 400);
        }
        const { data: order, error: orderError } = await supabase
          .from("service_order_requests")
          .select("id,reference,service_key,requested_amount,currency,status,provider_dispatch_status,created_at,updated_at")
          .eq("user_id", userId)
          .eq("reference", requestedReference)
          .maybeSingle();
        if (orderError) throw orderError;
        if (!order) return reply({ success: false, error: "Order not found" }, 404);
        const { data: charge, error: chargeError } = await supabase
          .from("order_wallet_charges")
          .select("amount,status,refunded_at,created_at")
          .eq("order_request_id", order.id)
          .maybeSingle();
        if (chargeError) throw chargeError;
        const paymentStatus = charge?.status ?? "not_charged";
        return reply({
          success: true,
          order,
          payment_taken: paymentStatus === "charged",
          payment_status: paymentStatus,
          charged_amount: charge?.amount ?? null,
          refunded_at: charge?.refunded_at ?? null,
          status_source: "AILAT DATA internal order record",
          supplier_status_checked: false,
          notice: "This reports AILAT DATA's recorded order and wallet-charge state only; it does not query Legacy supplier."
        });
      }
      const { data: requests, error: listError } = await supabase
        .from("service_order_requests")
        .select("id,reference,service_key,requested_amount,currency,status,customer_data,supplier_network_id,supplier_plan_id,provider_request_id,provider_dispatch_status,provider_request_preview,created_at,updated_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (listError) throw listError;
      return reply({ success: true, order_requests: requests ?? [] });
    }

    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    if (declaredLength > 8192) return reply({ success: false, error: "Request is too large" }, 413);

    const rawBody = await req.text();
    if (rawBody.length > 8192) return reply({ success: false, error: "Request is too large" }, 413);

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return reply({ success: false, error: "Invalid JSON request" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply({ success: false, error: "Invalid request data" }, 400);
    }

    // GLOBAL SAFE MODE: prevent every real order, supplier dispatch, and wallet charge.
    // Read-only requests and quote-only validation remain available.
    if (body.action !== "bulk_sms_quote") {
      return reply({ success: false, code: "LIVE_TRANSACTIONS_DISABLED", error: "AILAT DATA is in safe testing mode. No order was submitted and no wallet charge was made." }, 503);
    }

    // Bulk SMS quote/validation only. No supplier dispatch, wallet charge, or SMS delivery.
    if (body.action === "bulk_sms_quote") {
      const sms = body.customer_data as Record<string, unknown> | undefined;
      const senderId = typeof sms?.sender_id === "string" ? sms.sender_id.trim() : "";
      const message = typeof sms?.message === "string" ? sms.message.trim() : "";
      const rawPhones = Array.isArray(sms?.phones) ? sms.phones : [];
      if (!senderId || senderId.length > 11 || /^\d+$/.test(senderId) || !/^[A-Za-z0-9 ]+$/.test(senderId)) {
        return reply({ success: false, error: "Enter an approved Sender ID (1–11 characters; digits only are not allowed)." }, 400);
      }
      if (!message || message.length > 5000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(message)) {
        return reply({ success: false, error: "Enter a valid SMS message (maximum 5,000 characters)." }, 400);
      }
      if (!rawPhones.length || rawPhones.length > 500) {
        return reply({ success: false, error: "Enter between 1 and 500 recipient numbers per campaign." }, 400);
      }
      const phones = rawPhones.map((value) => typeof value === "string" ? value.trim() : "");
      if (phones.some((phone) => !validPhone(phone))) {
        return reply({ success: false, error: "Every recipient must be a valid 11-digit Nigerian mobile number." }, 400);
      }
      if (new Set(phones).size !== phones.length) {
        return reply({ success: false, error: "Duplicate recipient numbers are not allowed." }, 400);
      }
      const gsmBasic = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
      const gsmExtension = "^{}\\[~]|€";
      const isGsm = Array.from(message).every((char) => gsmBasic.includes(char) || gsmExtension.includes(char));
      const units = isGsm
        ? Array.from(message).reduce((total, char) => total + (gsmExtension.includes(char) ? 2 : 1), 0)
        : Array.from(message).length;
      const pagesPerRecipient = units === 0 ? 0 : isGsm
        ? (units <= 160 ? 1 : Math.ceil(units / 153))
        : (units <= 70 ? 1 : Math.ceil(units / 67));
      const totalPages = pagesPerRecipient * phones.length;
      const { data: smsPricing, error: smsPricingError } = await supabase
        .from("bulk_sms_pricing")
        .select("supplier_cost_per_sms_page, customer_price_per_sms_page, is_active, currency, pricing_basis, verified_source, verified_at")
        .eq("id", 1)
        .maybeSingle();
      if (smsPricingError) {
        console.error("Bulk SMS pricing lookup failed", smsPricingError.message);
      }
      const priceAvailable = !smsPricingError && smsPricing?.is_active === true
        && smsPricing.supplier_cost_per_sms_page !== null
        && smsPricing.customer_price_per_sms_page !== null
        && Boolean(smsPricing.verified_source) && Boolean(smsPricing.verified_at);
      const supplierCost = priceAvailable
        ? Math.round(Number(smsPricing.supplier_cost_per_sms_page) * totalPages * 100) / 100
        : null;
      const customerCharge = priceAvailable
        ? Math.round(Number(smsPricing.customer_price_per_sms_page) * totalPages * 100) / 100
        : null;
      const grossProfit = priceAvailable
        ? Math.round((customerCharge - supplierCost) * 100) / 100
        : null;
      return reply({
        success: true,
        quote_status: priceAvailable ? "priced_read_only" : "pricing_unavailable",
        sender_id: senderId,
        recipients: phones.length,
        message_units: units,
        encoding: isGsm ? "GSM-7" : "Unicode",
        pages_per_recipient: pagesPerRecipient,
        total_pages: totalPages,
        price_available: priceAvailable,
        currency: priceAvailable ? smsPricing.currency : "NGN",
        supplier_cost: supplierCost,
        customer_charge: customerCharge,
        gross_profit: grossProfit,
        pricing_basis: priceAvailable ? smsPricing.pricing_basis : "awaiting_supplier_confirmation",
        pricing_verified_at: priceAvailable ? smsPricing.verified_at : null,
        supplier: "Legitdataway",
        supplier_endpoint: "https://legitdataway.com/api/bulksms",
        supplier_method: "POST",
        supplier_authentication: "Authorization: Token <server-side API key>",
        supplier_payload_fields: ["sender", "number", "message", "request-id"],
        supplier_multi_recipient_format: "not documented; one recipient per request until confirmed",
        supplier_cost_status: priceAvailable ? "verified_rate_configured" : "not_confirmed",
        customer_price_status: priceAvailable ? "configured" : "not_configured",
        sending_enabled: false,
        wallet_charge_enabled: false,
        request_id_format: "BULKSMS_<unique_id>",
        message: priceAvailable
          ? "Read-only price estimate calculated from the verified SMS-page rates. No SMS was sent and no wallet charge was made."
          : "Campaign validated. Legitdataway has not supplied a confirmed SMS-page rate, so no customer charge or profit estimate is shown. No SMS was sent and no wallet charge was made."
      });
    }

    // Airtime-to-Cash OTP Step 1. Supplier session data is stored server-side only.
    if (body.action === "cash_otp_start") {
      if (!LEGACY_SUPPLIER_TOKEN) return reply({ success: false, error: "Supplier configuration error" }, 503);
      const cashNetwork = String(body.network ?? "").toLowerCase();
      const cashPhone = body.phone;
      const cashAmount = Number(body.amount);
      const cashNetworkIds: Record<string, number> = { mtn: 1, airtel: 2, glo: 3, t2: 4 };
      if (!Object.hasOwn(cashNetworkIds, cashNetwork) || !validPhone(cashPhone) ||
          !Number.isSafeInteger(cashAmount) || cashAmount < 50 || cashAmount > 50000) {
        return reply({ success: false, error: "Check the network, phone number and airtime amount (₦50–₦50,000)." }, 400);
      }
      let supplierResponse: Response;
      let supplierResult: Record<string, unknown> = {};
      try {
        supplierResponse = await fetch("https://disabled.invalid/api/cash", {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": "Token " + LEGACY_SUPPLIER_TOKEN,
          },
          body: JSON.stringify({
            step: 1,
            phone: cashPhone,
            network: cashNetworkIds[cashNetwork],
            token: LEGACY_SUPPLIER_TOKEN,
          }),
          signal: AbortSignal.timeout(20000),
        });
        const parsedSupplier: unknown = await supplierResponse.json();
        if (parsedSupplier && typeof parsedSupplier === "object" && !Array.isArray(parsedSupplier)) {
          supplierResult = parsedSupplier as Record<string, unknown>;
        }
      } catch (error) {
        console.error("Cash OTP request outcome unknown:", error instanceof Error ? error.message : "network error");
        return reply({ success: false, error: "OTP request outcome could not be confirmed. Check your phone before trying again." }, 202);
      }
      const supplierStatus = String(supplierResult.status ?? "").toLowerCase();
      const supplierData = supplierResult.data;
      const supplierFailed = !supplierResponse.ok ||
        ["fail", "failed", "failure", "error"].includes(supplierStatus) ||
        supplierData === undefined || supplierData === null;
      if (supplierFailed) {
        const message = String(supplierResult.message ?? "Legacy supplier could not start OTP verification.").slice(0, 180);
        return reply({ success: false, error: message }, 502);
      }
      const { data: session, error: sessionError } = await supabase
        .from("airtime_cash_sessions")
        .insert({
          user_id: userId,
          network: cashNetwork,
          phone: cashPhone,
          airtime_amount: cashAmount,
          supplier_data: supplierData,
        })
        .select("id,expires_at")
        .single();
      if (sessionError) {
        console.error("Could not save private cash OTP session:", sessionError.message);
        return reply({ success: false, error: "OTP may have been sent, but the secure session could not be saved. Contact support before retrying." }, 202);
      }
      return reply({
        success: true,
        otp_sent: true,
        session_id: session.id,
        expires_at: session.expires_at,
        message: "OTP request accepted. Check the phone number registered with your network.",
      }, 200);
    }

    // Exam PIN purchase: server verifies live price and JAMB profile, then requires one-time approval.
    if (body.service_key === "exam") {
      if (!LEGACY_SUPPLIER_TOKEN) return reply({ success: false, error: "Supplier configuration error" }, 503);
      const examData = body.customer_data as Record<string, unknown> | undefined;
      const examId = Number(examData?.exam_id);
      const quantity = Number(examData?.quantity);
      const profileCode = String(examData?.profile_code ?? "").trim();
      const jambType = String(examData?.jamb_type ?? "").trim().toUpperCase();
      const phoneValue = String(examData?.phone ?? "").trim();
      const isJamb = [4, 5, 6].includes(examId);
      if (!Number.isSafeInteger(examId) || examId <= 0 ||
          (phoneValue && !validPhone(phoneValue)) ||
          (isJamb && (!/^\d{10}$/.test(profileCode) || !["UTME", "MOCK", "DE"].includes(jambType))) ||
          (!isJamb && (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10))) {
        return reply({ success: false, error: "Check the exam product, quantity, JAMB profile ID and phone number." }, 400);
      }
      const idempotencyKey = body.idempotency_key;
      if (typeof idempotencyKey !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
        return reply({ success: false, error: "A valid request key is required." }, 400);
      }
      const supplierHeaders = { "Accept": "application/json", "Authorization": "Token " + LEGACY_SUPPLIER_TOKEN };
      try {
        const { data: prior, error: priorError } = await supabase.from("service_order_requests")
          .select("id,reference,service_key,requested_amount,currency,status,customer_data,provider_dispatch_status,created_at")
          .eq("user_id", userId).eq("idempotency_key", idempotencyKey).maybeSingle();
        if (priorError) throw priorError;
        if (prior) {
          const pd = (prior.customer_data ?? {}) as Record<string, unknown>;
          if (prior.service_key !== "exam" || Number(pd.exam_id) !== examId ||
              Number(pd.quantity) !== (isJamb ? 1 : quantity) ||
              String(pd.profile_code ?? "") !== (isJamb ? profileCode : "") ||
              String(pd.jamb_type ?? "") !== (isJamb ? jambType : "") ||
              String(pd.phone ?? "") !== phoneValue) {
            return reply({ success: false, error: "This request key belongs to different exam details. Start a new request." }, 409);
          }
          const { data: priorCharge, error: chargeLookupError } = await supabase.from("order_wallet_charges")
            .select("amount,status").eq("order_request_id", prior.id).maybeSingle();
          if (chargeLookupError) throw chargeLookupError;
          return reply({ success: true, order_request: prior, payment_status: priorCharge?.status ?? "not_charged",
            charged_amount: priorCharge?.amount ?? null, fulfillment_status: prior.provider_dispatch_status,
            issued_pins: Array.isArray(pd.issued_pins) ? pd.issued_pins : (pd.issued_pin ? [pd.issued_pin] : []),
            notice: "Existing exam order returned; it was not charged or dispatched again.", repeated_request: true }, 200);
        }

        const catalogueResponse = await fetch("https://disabled.invalid/api/v1/plans/exams", {
          headers: supplierHeaders, signal: AbortSignal.timeout(15000),
        });
        const catalogue: unknown = await catalogueResponse.json();
        if (!catalogueResponse.ok || !catalogue || typeof catalogue !== "object" ||
            String((catalogue as Record<string, unknown>).status ?? "").toLowerCase() !== "success" ||
            !Array.isArray((catalogue as Record<string, unknown>).data)) {
          return reply({ success: false, error: "Could not refresh the live exam catalogue. No payment was taken." }, 502);
        }
        const liveExam = ((catalogue as { data: Record<string, unknown>[] }).data)
          .find(item => Number(item.exam_id) === examId);
        const examName = String(liveExam?.exam_name ?? "").trim();
        const supplierAmount = Number(liveExam?.amount);
        const mode = String(liveExam?.mode ?? "").toLowerCase();
        if (!liveExam || !examName || !Number.isFinite(supplierAmount) || supplierAmount <= 0 ||
            mode !== (isJamb ? "profile_code" : "quantity")) {
          return reply({ success: false, error: "This exam product is unavailable or its details changed. Refresh and review again." }, 409);
        }
        const finalQuantity = isJamb ? 1 : quantity;
        const expectedJambType: Record<number, string> = { 4: "UTME", 5: "MOCK", 6: "DE" };
        if (isJamb && jambType !== expectedJambType[examId]) {
          return reply({ success: false, error: "The selected JAMB type does not match this exam product." }, 400);
        }
        const markupAmount = calculateExamMarkup(examName);
        const sellingUnitAmount = Math.round((supplierAmount + markupAmount) * 100) / 100;
        const sellingAmount = Math.round(sellingUnitAmount * finalQuantity * 100) / 100;
        let verifiedName = "";
        if (isJamb) {
          const verifyForm = new URLSearchParams({ profile_id: profileCode, token: LEGACY_SUPPLIER_TOKEN });
          const verifyResponse = await fetch("https://disabled.invalid/api/app/verify_jamb", {
            method: "POST",
            headers: { "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" },
            body: verifyForm.toString(), signal: AbortSignal.timeout(15000),
          });
          const verified: unknown = await verifyResponse.json();
          if (!verifyResponse.ok || !verified || typeof verified !== "object" ||
              String((verified as Record<string, unknown>).status ?? "").toLowerCase() !== "success" ||
              typeof (verified as Record<string, unknown>).name !== "string" ||
              String((verified as Record<string, unknown>).profile_id ?? profileCode) !== profileCode) {
            return reply({ success: false, error: "JAMB profile could not be verified immediately before purchase. No payment was taken." }, 422);
          }
          verifiedName = String((verified as Record<string, unknown>).name).trim();
        }

        const expectedIntent = {
          service_key: "exam", idempotency_key: idempotencyKey,
          details: {
            exam_id: examId, exam_name: examName, mode, quantity: finalQuantity,
            supplier_amount: supplierAmount, markup_amount: markupAmount, selling_unit_amount: sellingUnitAmount, selling_amount: sellingAmount,
            phone: phoneValue, profile_code: isJamb ? profileCode : "",
            jamb_type: isJamb ? jambType : "", verified_name: verifiedName,
          },
        };
        const authorizationToken = typeof body.authorization_token === "string" ? body.authorization_token : "";
        if (!authorizationToken || authorizationToken.length > 200) {
          return reply({ success: false, error: "Approve this exact exam purchase with fingerprint or your Transaction PIN first." }, 403);
        }
        const canonical = (value: unknown): string => {
          if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
          if (value && typeof value === "object") {
            const obj = value as Record<string, unknown>;
            return "{" + Object.keys(obj).sort().map(k => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
          }
          return JSON.stringify(value);
        };
        const toB64url = (bytes: Uint8Array) => {
          let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
          return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        };
        const intentText = canonical(expectedIntent);
        const intentHash = toB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(intentText))));
        const tokenHash = toB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(authorizationToken))));
        const { data: approval, error: approvalError } = await supabase.from("transaction_authorizations")
          .select("id,transaction_intent").eq("user_id", userId).eq("token_hash", tokenHash)
          .eq("intent_hash", intentHash).is("consumed_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
        if (approvalError) throw approvalError;
        if (!approval || canonical(approval.transaction_intent) !== intentText) {
          return reply({ success: false, error: "Fingerprint/PIN approval is missing, expired, or does not match this exam and price. Approve again." }, 403);
        }

        const reference = "AIL-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
        const customerRecord: Record<string, unknown> = {
          exam_id: examId, exam_name: examName, mode, quantity: finalQuantity, phone: phoneValue || null,
          supplier_amount: supplierAmount, selling_amount: sellingAmount,
          profile_code: isJamb ? profileCode : null, jamb_type: isJamb ? jambType : null,
          verified_name: verifiedName || null, issued_pins: [], fulfillment_status: "awaiting_wallet_charge",
        };
        const { data: inserted, error: createError } = await supabase.rpc("ailat_create_order_with_authorization", {
          p_authorization_id: approval.id, p_user_id: userId, p_token_hash: tokenHash,
          p_intent_hash: intentHash, p_expected_intent: expectedIntent,
          p_order: {
            reference, idempotency_key: idempotencyKey, service_key: "exam",
            requested_amount: sellingAmount, currency: "NGN", customer_data: customerRecord,
            supplier_network_id: null, supplier_plan_id: examId, provider_request_id: reference,
            provider_dispatch_status: "not_sent",
            provider_request_preview: isJamb
              ? { exam_id: examId, profile_code: profileCode, jamb_type: jambType, phone: phoneValue || undefined, "request-id": reference }
              : { exam_id: examId, quantity: finalQuantity, phone: phoneValue || undefined, "request-id": reference },
            status: "received",
          },
        });
        if (createError) {
          if (createError.code === "23505") return reply({ success: false, error: "This exam request was already submitted. Check Transaction History before retrying." }, 409);
          throw createError;
        }
        const order = inserted as Record<string, unknown>;
        const orderId = String(order.id);
        const { error: chargeError } = await supabase.rpc("ailat_charge_order_wallet", {
          p_order_request_id: orderId, p_user_id: userId, p_reference: reference, p_amount: sellingAmount,
        });
        if (chargeError) {
          return reply({ success: false, order_request: order, payment_status: "not_charged",
            error: chargeError.message.includes("Insufficient wallet balance") ? "Insufficient wallet balance. No exam PIN was requested." : "Wallet payment failed. No exam PIN was requested." }, 402);
        }
        const { error: dispatchError } = await supabase.rpc("ailat_mark_order_dispatching", { p_order_request_id: orderId });
        if (dispatchError) return reply({ success: false, order_request: order, payment_status: "charged",
          fulfillment_status: "pending_review", error: "Payment reserved but exam PIN dispatch did not start. Contact support; do not retry." }, 202);

        const purchasePayload: Record<string, unknown> = isJamb
          ? { exam_id: examId, profile_code: profileCode, jamb_type: jambType, quantity: 1,
              token: LEGACY_SUPPLIER_TOKEN, "request-id": reference }
          : { exam_id: examId, quantity: finalQuantity, "request-id": reference };
        if (phoneValue) purchasePayload.phone = phoneValue;
        let supplierResponse: Response;
        let supplierResult: Record<string, unknown> = {};
        try {
          supplierResponse = await fetch("https://disabled.invalid/api/exam", {
            method: "POST", headers: { ...supplierHeaders, "Content-Type": "application/json" },
            body: JSON.stringify(purchasePayload), signal: AbortSignal.timeout(30000),
          });
          const parsed: unknown = await supplierResponse.json();
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) supplierResult = parsed as Record<string, unknown>;
        } catch (dispatchError) {
          await supabase.rpc("ailat_mark_order_processing", {
            p_order_request_id: orderId, p_provider_message: "Exam supplier response unknown after dispatch; reconciliation required.",
          });
          return reply({ success: true, order_request: order, payment_status: "charged", fulfillment_status: "processing",
            notice: "Supplier confirmation is pending. Do not submit this order again." }, 202);
        }
        const supplierStatus = String(supplierResult.status ?? "").toLowerCase();
        const supplierMessage = String(supplierResult.message ?? "Exam supplier response received").slice(0, 220);
        const issuedPins = isJamb
          ? (supplierResult.pin ? [{ pin: String(supplierResult.pin), serial: String(supplierResult.serial ?? "") }] : [])
          : (Array.isArray(supplierResult.pins) ? supplierResult.pins.filter((p: unknown) => p && typeof p === "object" && typeof (p as Record<string, unknown>).pin === "string") : []);
        if (supplierResponse.ok && ["success", "successful", "completed"].includes(supplierStatus) && issuedPins.length > 0) {
          customerRecord.issued_pins = issuedPins;
          customerRecord.fulfillment_status = "success";
          await supabase.from("service_order_requests").update({ customer_data: customerRecord }).eq("id", orderId);
          const { error: successError } = await supabase.rpc("ailat_mark_order_success", { p_order_request_id: orderId });
          if (successError) return reply({ success: true, order_request: order, payment_status: "charged",
            fulfillment_status: "processing", notice: "Supplier issued the PIN, but final order update is pending. Contact support; do not retry." }, 202);
          return reply({ success: true, order_request: { ...order, status: "completed" }, payment_status: "charged",
            fulfillment_status: "success", supplier_message: supplierMessage, issued_pins: issuedPins }, 200);
        }
        if (["fail", "failed", "failure", "error"].includes(supplierStatus)) {
          const { error: failError } = await supabase.rpc("ailat_mark_order_failure", {
            p_order_request_id: orderId, p_failure_reason: supplierMessage,
          });
          if (failError) return reply({ success: false, order_request: order, payment_status: "charged",
            fulfillment_status: "refund_pending", error: "Supplier rejected the exam request; refund needs support review." }, 202);
          return reply({ success: false, order_request: { ...order, status: "refunded" }, payment_status: "refunded",
            fulfillment_status: "failed", error: "Supplier could not issue the exam PIN. Your wallet has been refunded.", supplier_message: supplierMessage }, 502);
        }
        await supabase.rpc("ailat_mark_order_processing", { p_order_request_id: orderId, p_provider_message: supplierMessage });
        return reply({ success: true, order_request: { ...order, status: "processing" }, payment_status: "charged",
          fulfillment_status: "processing", notice: "Supplier has not confirmed the PIN yet. Do not submit again.",
          supplier_message: supplierMessage }, 202);
      } catch (error) {
        const err = error as Record<string, unknown> | null;
        console.error("Exam PIN purchase flow diagnostic:", JSON.stringify({
          type: error instanceof Error ? error.name : typeof error,
          message: error instanceof Error ? error.message : String(error),
          code: err && typeof err === "object" ? err.code ?? null : null,
          details: err && typeof err === "object" ? err.details ?? null : null,
          hint: err && typeof err === "object" ? err.hint ?? null : null,
        }));
        return reply({ success: false, error: "Exam PIN order could not be completed. Check Transaction History before retrying." }, 500);
      }
    }

    // Cable TV: server-verified catalogue + IUC + one-time biometric authorization,
    // atomic wallet charge, then idempotent supplier dispatch.
    if (body.service_key === "cable_tv") {
      return reply({
        success: false,
        code: "CABLE_PURCHASE_PENDING",
        error: "Cable TV purchase is temporarily disabled until Legitdataway confirms the exact cableplan code and official Smart Card validation endpoint. No wallet charge was made and no supplier request was sent."
      }, 503);
    }

    const serviceKey = body.service_key;
    const idempotencyKey = body.idempotency_key;
    const customerData = body.customer_data;

    if (typeof idempotencyKey !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      return reply({ success: false, error: "A valid request key is required" }, 400);
    }
    if (!customerData || typeof customerData !== "object" || Array.isArray(customerData)) {
      return reply({ success: false, error: "Invalid customer details" }, 400);
    }
    if (!validNetwork((customerData as Record<string, unknown>).network) ||
        !validPhone((customerData as Record<string, unknown>).phone)) {
      return reply({ success: false, error: "Check the network and Nigerian phone number" }, 400);
    }

    const network = String((customerData as Record<string, unknown>).network).toLowerCase();
    const phone = String((customerData as Record<string, unknown>).phone);
    let cleanCustomerData: Record<string, unknown>;
    let requestedAmount: number | null = null;
    let supplierNetworkId: number | null = null;
    let providerDispatchStatus = "not_sent";
    let providerRequestPreview: Record<string, unknown> | null = null;
    let legitAccessToken: string | null = null;

    if (serviceKey === "data") {
      const purchaseType = String((customerData as Record<string, unknown>).purchase_type ?? "SME").toUpperCase();
      if (!["SME", "GIFTING", "CORPORATE"].includes(purchaseType)) {
        return reply({ success: false, error: "Choose a valid data purchase type" }, 400);
      }

      const suppliedInternalId = Number((customerData as Record<string, unknown>).internal_network_id);
      const expectedInternalId = internalNetworkId(network);
      if (!Number.isSafeInteger(suppliedInternalId) || suppliedInternalId !== expectedInternalId) {
        return reply({ success: false, error: "Network selection does not match AILAT DATA network ID" }, 400);
      }

      const requestedSupplierPlanId = Number((customerData as Record<string, unknown>).supplier_plan_id);
      if (!Number.isSafeInteger(requestedSupplierPlanId) || requestedSupplierPlanId <= 0) {
        return reply({ success: false, error: "A valid live supplier plan is required" }, 400);
      }

      if (!LEGITDATAWAY_LIVE_ENABLED) return reply({ success: false, error: "Legitdataway data vending is currently disabled. No wallet charge was made." }, 503);
      const requestedPlanId = Number((customerData as Record<string, unknown>).supplier_plan_id);
      const catalogueNetwork = network === "t2" ? "9mobile" : network;
      const { data: plan, error: planError } = await supabase.from("data_plan_catalog")
        .select("supplier_plan_id,supplier_network_id,network,purchase_type,bundle_name,supplier_amount,selling_price,validity,active,supplier_mapping_status")
        .eq("supplier_plan_id", requestedPlanId).eq("network", catalogueNetwork)
        .eq("purchase_type", purchaseType).eq("active", true).eq("supplier_mapping_status", "verified").maybeSingle();
      if (planError || !plan) return reply({ success: false, error: "This bundle is not in the verified Legitdataway catalogue. Refresh and choose another bundle." }, 409);
      const liveName = String(plan.bundle_name ?? "");
      const supplierAmount = Number(plan.supplier_amount);
      const sellingAmount = Number(plan.selling_price);
      const profitAmount = Math.round((sellingAmount - supplierAmount) * 100) / 100;
      const supplierPlanId = Number(plan.supplier_plan_id);
      const verifiedNetworkId = Number(plan.supplier_network_id);
      if (Number(plan.supplier_plan_id) !== requestedPlanId || !Number.isSafeInteger(verifiedNetworkId) || verifiedNetworkId < 1 ||
          !Number.isFinite(supplierAmount) || supplierAmount <= 0 ||
          !Number.isFinite(sellingAmount) || sellingAmount < supplierAmount || profitAmount < 0) {
        return reply({ success: false, error: "This bundle has no valid approved selling price. No request was placed." }, 409);
      }
      supplierNetworkId = verifiedNetworkId;
      try { legitAccessToken = await getLegitdatawayAccessToken(); }
      catch { return reply({ success: false, error: "Legitdataway authentication failed. No wallet charge was made." }, 502); }
      requestedAmount = sellingAmount;
      cleanCustomerData = {
        network, internal_network_id: expectedInternalId, provider_network_id: supplierNetworkId, phone,
        bundle: liveName, purchase_type: purchaseType, supplier_plan_id: supplierPlanId,
        validity: String(plan.validity ?? "As listed by supplier"), supplier_amount: supplierAmount,
        profit_amount: profitAmount, selling_amount: sellingAmount,
        pricing_rule: "catalogue_selling_price", fulfillment_status: "live_supplier_dispatch_enabled",
      };
    } else if (serviceKey === "airtime") {
      // Airtime live vending must remain disabled unless the explicit supplier flag is enabled.
      if (!LEGITDATAWAY_LIVE_ENABLED) {
        return reply({ success: false, code: "LEGITDATAWAY_LIVE_DISABLED",
          error: "Legitdataway airtime vending is disabled. No wallet charge or supplier request was made." }, 503);
      }
      const amount = Number((customerData as Record<string, unknown>).amount);
      const planType = String((customerData as Record<string, unknown>).plan_type ?? "VTU").toUpperCase();
      if (!Number.isSafeInteger(amount) || amount < 50 || amount > 50000) {
        return reply({ success: false, error: "Airtime amount must be between ₦50 and ₦50,000" }, 400);
      }
      if (!["VTU", "SNS"].includes(planType)) {
        return reply({ success: false, error: "Choose VTU or SNS airtime" }, 400);
      }
      requestedAmount = amount;
      const airtimeProviderNetworkIds: Record<string, number> = {
        mtn: 1, airtel: 2, glo: 3, "9mobile": 4, t2: 4, vitel: 5,
      };
      supplierNetworkId = airtimeProviderNetworkIds[network];
      if (!Number.isSafeInteger(supplierNetworkId) || supplierNetworkId < 1) {
        return reply({ success: false, error: "This network is not supported by Legitdataway." }, 400);
      }
      if (network !== "mtn") {
        return reply({ success: false, code: "AIRTIME_RATE_NOT_CONFIRMED",
          error: "AILAT DATA has not confirmed its Legitdataway Airtime cost for this network yet. No wallet charge or supplier request was made." }, 409);
      }
      try { legitAccessToken = await getLegitdatawayAccessToken(); }
      catch { return reply({ success: false, error: "Legitdataway authentication failed. No wallet charge was made." }, 502); }
      const estimatedSupplierCost = Math.round(amount * 0.97 * 100) / 100;
      const estimatedProfit = Math.round((amount - estimatedSupplierCost) * 100) / 100;
      cleanCustomerData = {
        network, phone, amount, plan_type: planType,
        provider_network_id: supplierNetworkId,
        supplier_amount_estimate: estimatedSupplierCost,
        profit_amount_estimate: estimatedProfit,
        pricing_basis: "provisional_3_percent_margin_from_confirmed_100_naira_mtn_sample",
      };
    } else {
      return reply({ success: false, error: "This service is not enabled for order requests yet" }, 400);
    }


    // Idempotent replay check BEFORE consuming biometric approval.
    // A retry of an already-recorded identical request returns the original
    // record and does not require or consume another one-time authorization.
    const { data: priorOrder, error: priorOrderError } = await supabase
      .from("service_order_requests")
      .select("id,reference,service_key,requested_amount,currency,status,customer_data,created_at")
      .eq("user_id", userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (priorOrderError) throw priorOrderError;
    if (priorOrder) {
      const priorData = (priorOrder.customer_data ?? {}) as Record<string, unknown>;
      const sameRequest =
        priorOrder.service_key === serviceKey &&
        Number(priorOrder.requested_amount) === Number(requestedAmount) &&
        priorData.network === network &&
        priorData.phone === phone &&
        (serviceKey !== "data" ||
          Number(priorData.supplier_plan_id) === Number((cleanCustomerData as Record<string, unknown>).supplier_plan_id)) &&
        (serviceKey !== "airtime" ||
          Number(priorData.amount) === Number(requestedAmount));
      if (!sameRequest) {
        return reply({ success: false, error: "This request key was already used for different order details. Start a new request." }, 409);
      }
      return reply({
        success: true,
        order_request: {
          id: priorOrder.id,
          reference: priorOrder.reference,
          service_key: priorOrder.service_key,
          requested_amount: priorOrder.requested_amount,
          currency: priorOrder.currency,
          status: priorOrder.status,
          created_at: priorOrder.created_at,
        },
        notice: "This identical request was already recorded. No new payment or supplier dispatch was made.",
        repeated_request: true,
      });
    }

    // A biometric authorization is mandatory for every data/airtime request.
    // The signed-in user, exact reviewed intent, expiry and one-time use are
    // all checked on the server; a client-side "verified" flag is never trusted.
    const authorizationToken = typeof body.authorization_token === "string" ? body.authorization_token : "";
    if (!authorizationToken || authorizationToken.length > 200) {
      return reply({ success: false, error: "Approve this transaction with your fingerprint or device unlock first." }, 403);
    }
    const expectedIntent = serviceKey === "data"
      ? {
          service_key: "data",
          idempotency_key: idempotencyKey,
          details: {
            network,
            phone,
            purchase_type: String((cleanCustomerData as Record<string, unknown>).purchase_type),
            catalog_plan_id: Number((cleanCustomerData as Record<string, unknown>).supplier_plan_id),
          },
        }
      : {
          service_key: "airtime",
          idempotency_key: idempotencyKey,
          details: {
            network,
            phone,
            amount: Number(requestedAmount),
            plan_type: String((cleanCustomerData as Record<string, unknown>).plan_type),
          },
        };
    const canonical = (value: unknown): string => {
      if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
      if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        return "{" + Object.keys(obj).sort().map(k => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
      }
      return JSON.stringify(value);
    };
    const toB64url = (bytes: Uint8Array) => {
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    };
    const expectedIntentText = canonical(expectedIntent);
    const expectedIntentHash = toB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expectedIntentText))));
    const tokenHash = toB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(authorizationToken))));
    const { data: approvedAuthorization, error: authorizationError } = await supabase
      .from("transaction_authorizations")
      .select("id,transaction_intent,expires_at,consumed_at")
      .eq("user_id", userId)
      .eq("token_hash", tokenHash)
      .eq("intent_hash", expectedIntentHash)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (authorizationError) throw authorizationError;
    if (!approvedAuthorization || canonical(approvedAuthorization.transaction_intent) !== expectedIntentText) {
      return reply({ success: false, error: "Biometric approval is missing, expired, or does not match these transaction details. Please approve again." }, 403);
    }
    const reference = `AIL-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;

    // Prepare provider-format previews for review only. No external supplier
    // request is sent and no purchase is fulfilled by this endpoint.
    if (serviceKey === "data") {
      const supplierNetworkNames: Record<string, string> = {
        mtn: "MTN", airtel: "AIRTEL", glo: "GLO", "9mobile": "T2", vitel: "VITEL"
      };
      // Match Legacy supplier's published POST /api/data example:
      // network name, local Nigerian phone, data_plan and unique request-id.
      providerRequestPreview = {
        network: supplierNetworkNames[network],
        data_plan: String((cleanCustomerData as Record<string, unknown>).supplier_plan_id),
        phone,
        "request-id": reference
      };
      providerDispatchStatus = "ready";
      (cleanCustomerData as Record<string, unknown>).provider_request_preview = providerRequestPreview;
      (cleanCustomerData as Record<string, unknown>).provider_dispatch_status = "not_sent";
    } else if (serviceKey === "airtime") {
      providerRequestPreview = {
        network: supplierNetworkId,
        phone,
        plan_type: String((cleanCustomerData as Record<string, unknown>).plan_type),
        amount: requestedAmount,
        bypass: false,
        "request-id": reference
      };
      providerDispatchStatus = "ready";
      (cleanCustomerData as Record<string, unknown>).provider_request_preview = providerRequestPreview;
      (cleanCustomerData as Record<string, unknown>).provider_dispatch_status = "not_sent";
    }
    const { data: inserted, error: insertError } = await supabase.rpc(
      "ailat_create_order_with_authorization",
      {
        p_authorization_id: approvedAuthorization.id,
        p_user_id: userId,
        p_token_hash: tokenHash,
        p_intent_hash: expectedIntentHash,
        p_expected_intent: expectedIntent,
        p_order: {
          reference,
          idempotency_key: idempotencyKey,
          service_key: serviceKey,
          requested_amount: requestedAmount,
          currency: "NGN",
          customer_data: cleanCustomerData,
          supplier_network_id: serviceKey === "data"
            ? Number((cleanCustomerData as Record<string, unknown>).provider_network_id)
            : supplierNetworkId,
          supplier_plan_id: serviceKey === "data"
            ? Number((cleanCustomerData as Record<string, unknown>).supplier_plan_id)
            : null,
          provider_request_id: providerRequestPreview ? reference : null,
          provider_dispatch_status: "not_sent",
          provider_request_preview: providerRequestPreview,
          status: "received",
        },
      },
    );
    if (insertError?.code === "23505") {
      return reply({
        success: false,
        error: "This request was submitted at the same time as another attempt. Check Transaction History before retrying."
      }, 409);
    }
    if (insertError) throw insertError;

    // Keep unsupported service types request-only; data and airtime use verified supplier flows.
    if (serviceKey !== "data" && serviceKey !== "airtime") {
      return reply({
        success: true, order_request: inserted,
        notice: "Request record only. This service is not connected to live fulfillment; no payment was taken.",
      }, 201);
    }

    // Legitdataway fulfillment. Wallet debit is atomic and idempotent.
    if (serviceKey === "data" || serviceKey === "airtime") {
      const orderId = String((inserted as Record<string, unknown>).id ?? "");
      const orderReference = String((inserted as Record<string, unknown>).reference ?? reference);
      if (!orderId) throw new Error("Created order did not return an ID");
      const { error: chargeError } = await supabase.rpc("ailat_charge_order_wallet", {
        p_order_request_id: orderId, p_user_id: userId, p_reference: orderReference, p_amount: requestedAmount,
      });
      if (chargeError) {
        console.error("Wallet charge blocked:", chargeError.message);
        return reply({ success: false, order_request: inserted, payment_status: "not_charged",
          error: chargeError.message.includes("Insufficient wallet balance") ? "Insufficient wallet balance." : "Wallet payment failed; no supplier request was sent." }, 402);
      }
      const { error: dispatchError } = await supabase.rpc("ailat_mark_order_dispatching", { p_order_request_id: orderId });
      if (dispatchError) {
        console.error("Dispatch state update failed:", dispatchError.message);
        return reply({ success: false, order_request: inserted, payment_status: "charged",
          fulfillment_status: "pending_review", error: "Payment reserved but dispatch did not start. Contact support; do not retry." }, 202);
      }

      let supplierResponse: Response;
      let supplierResult: Record<string, unknown> = {};
      try {
        const isAirtime = serviceKey === "airtime";
        const airtimePayload = {
          network: Number((cleanCustomerData as Record<string, unknown>).provider_network_id),
          phone, amount: requestedAmount,
          plan_type: String((cleanCustomerData as Record<string, unknown>).plan_type),
          bypass: false, "request-id": orderReference,
        };
        const dataPayload = {
          network: Number((cleanCustomerData as Record<string, unknown>).provider_network_id),
          phone,
          data_plan: Number((cleanCustomerData as Record<string, unknown>).supplier_plan_id),
          bypass: false, "request-id": orderReference,
        };
        if (isAirtime) {
          if (!legitAccessToken) throw new Error("Legitdataway authentication token unavailable");
          supplierResponse = await fetch("https://legitdataway.com/api/topup", {
            method: "POST",
            headers: { "Accept": "application/json", "Content-Type": "application/json",
              "Authorization": "Token " + legitAccessToken },
            body: JSON.stringify(airtimePayload),
            signal: AbortSignal.timeout(25000),
          });
        } else {
          if (!legitAccessToken) throw new Error("Legitdataway access token unavailable");
          const legitPayload = { ...dataPayload, phone: "234" + phone.slice(1) };
          supplierResponse = await fetch("https://legitdataway.com/api/data", {
            method: "POST",
            headers: { "Accept": "application/json", "Content-Type": "application/json",
              "Authorization": "Token " + legitAccessToken },
            body: JSON.stringify(legitPayload),
            signal: AbortSignal.timeout(25000),
          });
        }
        const parsed: unknown = await supplierResponse.json();
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) supplierResult = parsed as Record<string, unknown>;
      } catch (dispatchError) {
        console.error("Supplier result unknown; keep charge reserved:", dispatchError instanceof Error ? dispatchError.message : "network error");
        return reply({ success: true, order_request: inserted, payment_status: "charged",
          fulfillment_status: "processing", notice: "Supplier confirmation pending. Do not submit this order again." }, 202);
      }

      const supplierStatus = String(supplierResult.status ?? "").toLowerCase();
      const supplierMessage = String(supplierResult.message ?? "Supplier response received").slice(0, 220);
      const providerTxn = String(supplierResult.transid ?? supplierResult.transaction_id ?? supplierResult["request-id"] ?? "");
      if (supplierResponse.ok && ["success", "successful", "completed"].includes(supplierStatus)) {
        // Airtime: record supplier's actual wallet debit only when the provider
        // returns both balance snapshots and a matching charged amount.
        if (isAirtime) {
          const oldBalance = Number(supplierResult.oldbal);
          const newBalance = Number(supplierResult.newbal);
          const reportedAmount = Number(supplierResult.discount);
          const sellingAmount = Number(requestedAmount);
          const supplierCost = Math.round((oldBalance - newBalance) * 100) / 100;
          if (Number.isFinite(oldBalance) && Number.isFinite(newBalance) &&
              Number.isFinite(reportedAmount) && Number.isFinite(sellingAmount) &&
              sellingAmount > 0 && oldBalance > newBalance &&
              supplierCost > 0 && supplierCost <= sellingAmount &&
              Math.abs(supplierCost - reportedAmount) <= 0.01) {
            const profitAmount = Math.round((sellingAmount - supplierCost) * 100) / 100;
            const currentDetails = ((inserted as Record<string, unknown>).customer_data ??
              cleanCustomerData) as Record<string, unknown>;
            const reconciledDetails = {
              ...currentDetails,
              supplier_amount: supplierCost,
              selling_amount: sellingAmount,
              profit_amount: profitAmount,
              supplier_cost_source: "legitdataway_wallet_balance_delta",
            };
            const { error: costSaveError } = await supabase.from("service_order_requests")
              .update({ customer_data: reconciledDetails })
              .eq("id", orderId)
              .eq("provider_dispatch_status", "dispatching");
            if (costSaveError) {
              console.error("Airtime supplier cost could not be recorded; order will require profit review:", costSaveError.message);
            }
          } else {
            console.warn("Airtime succeeded but provider balance delta was not verifiable; profit excluded pending review.");
          }
        }
        const { data: completed, error: completeError } = await supabase.rpc("ailat_mark_order_success", { p_order_request_id: orderId });
        if (completeError) {
          console.error("Supplier success received; completion update pending:", completeError.message);
          return reply({ success: true, order_request: inserted, payment_status: "charged",
            fulfillment_status: "processing", notice: "Supplier accepted the order; final status is pending. Do not retry." }, 202);
        }
        if (providerTxn) await supabase.from("service_order_requests").update({ provider_transaction_id: providerTxn }).eq("id", orderId);
        return reply({ success: true, order_request: { ...inserted, status: "completed" },
          payment_status: "charged", fulfillment_status: "success", supplier_message: supplierMessage, result: completed }, 200);
      }
      if (["fail", "failed", "failure", "error"].includes(supplierStatus)) {
        const { data: failed, error: failError } = await supabase.rpc("ailat_mark_order_failure", {
          p_order_request_id: orderId, p_failure_reason: supplierMessage,
        });
        if (failError) {
          console.error("Supplier failure refund requires review:", failError.message);
          return reply({ success: false, order_request: inserted, payment_status: "charged",
            fulfillment_status: "refund_pending", error: "Supplier rejected the order; refund needs support review." }, 202);
        }
        return reply({ success: false, order_request: { ...inserted, status: "refunded" },
          payment_status: "refunded", fulfillment_status: "failed",
          error: "Supplier could not deliver this data. Your wallet has been refunded.", supplier_message: supplierMessage, supplier_http_status: supplierResponse.status, supplier_status: supplierStatus || "missing", result: failed }, 502);
      }

      if (providerTxn) await supabase.from("service_order_requests").update({ provider_transaction_id: providerTxn }).eq("id", orderId);
      await supabase.rpc("ailat_mark_order_processing", { p_order_request_id: orderId, p_provider_message: supplierMessage });
      return reply({ success: true, order_request: { ...inserted, status: "processing" },
        payment_status: "charged", fulfillment_status: "processing",
        notice: "Supplier has not returned a final status. Order is being checked; do not submit again.",
        supplier_message: supplierMessage }, 202);
    }

    return reply({ success: false, error: "Unsupported order flow" }, 400);
  } catch (error) {
    console.error("AILAT ORDER REQUEST ERROR:", error instanceof Error ? error.message : "Unknown error");
    return reply({ success: false, error: "Could not save the request. Please try again." }, 500);
  }
});
