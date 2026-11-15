import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const FIREBASE_PROJECT_ID = "ailat-data";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
  return typeof value === "string" && ["mtn", "airtel", "glo", "9mobile", "vitel"].includes(value.toLowerCase());
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

    if (req.method === "GET" && new URL(req.url).searchParams.get("action") === "plans") {
      const { data: plans, error: plansError } = await supabase
        .from("data_plan_catalog")
        .select("id,network,purchase_type,bundle_name,supplier_amount,validity,supplier_plan_id,supplier_network_id,supplier_mapping_status")
        .eq("active", true)
        .eq("supplier_mapping_status", "verified")
        .not("supplier_plan_id", "is", null)
        .not("supplier_network_id", "is", null)
        .order("supplier_amount", { ascending: true });
      if (plansError) throw plansError;
      const publicPlans = (plans ?? []).map((plan) => {
        const providerNetworkIds: Record<string, number | null> = {
          mtn: 1, airtel: 2, glo: 3, "9mobile": 4, vitel: null,
        };
        const network = String(plan.network).toLowerCase();
        const expectedProviderNetworkId = providerNetworkIds[network];
        const supplierPlanId = Number(plan.supplier_plan_id);
        const supplierNetworkId = Number(plan.supplier_network_id);
        const pricing = calculateProfit(plan.bundle_name);
        const supplierAmount = Number(plan.supplier_amount);
        if (
          expectedProviderNetworkId === undefined ||
          expectedProviderNetworkId === null ||
          !Number.isSafeInteger(supplierPlanId) || supplierPlanId <= 0 ||
          !Number.isSafeInteger(supplierNetworkId) || supplierNetworkId !== expectedProviderNetworkId ||
          !pricing || !Number.isFinite(supplierAmount) || supplierAmount <= 0
        ) return null;
        return {
          id: plan.id,
          network: plan.network,
          internal_network_id: internalNetworkId(String(plan.network)),
          type: plan.purchase_type,
          name: plan.bundle_name,
          validity: plan.validity,
          amount: Math.round((supplierAmount + pricing.profit) * 100) / 100,
        };
      }).filter((plan) => plan !== null);
      return reply({ success: true, plans: publicPlans });
    }

    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
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

      const planId = Number((customerData as Record<string, unknown>).catalog_plan_id);
      if (!Number.isSafeInteger(planId) || planId <= 0) {
        return reply({ success: false, error: "A valid data plan is required" }, 400);
      }

      // Price is resolved only from the server-controlled catalogue. Ignore all
      // client-supplied supplier_amount / selling_amount values.
      const { data: plan, error: planError } = await supabase
        .from("data_plan_catalog")
        .select("id,network,purchase_type,bundle_name,supplier_amount,validity,supplier_plan_id,supplier_network_id,supplier_mapping_status")
        .eq("id", planId)
        .eq("active", true)
        .maybeSingle();

      if (planError) throw planError;
      if (!plan ||
          String(plan.network).toLowerCase() !== network ||
          String(plan.purchase_type).toUpperCase() !== purchaseType) {
        return reply({ success: false, error: "Selected data plan is not available for this network and type" }, 400);
      }

      // Never accept an order as provider-ready until the exact provider plan
      // and network IDs have been independently verified in the catalogue.
      if (plan.supplier_mapping_status !== "verified" ||
          !Number.isSafeInteger(Number(plan.supplier_plan_id)) ||
          Number(plan.supplier_plan_id) <= 0 ||
          !Number.isSafeInteger(Number(plan.supplier_network_id)) ||
          Number(plan.supplier_network_id) <= 0) {
        return reply({
          success: false,
          error: "This data bundle is not yet verified against the provider catalogue. No order was placed."
        }, 409);
      }

      const expectedProviderNetworkIds: Record<string, number | null> = {
        mtn: 1,
        airtel: 2,
        glo: 3,
        "9mobile": 4,
        vitel: null
      };
      if (expectedProviderNetworkIds[network] === null ||
          Number(plan.supplier_network_id) !== expectedProviderNetworkIds[network]) {
        return reply({
          success: false,
          error: "Provider network mapping is missing or does not match. No order was placed."
        }, 409);
      }

      const supplierAmount = Number(plan.supplier_amount);
      const pricing = calculateProfit(plan.bundle_name);
      if (!pricing || !Number.isFinite(supplierAmount) || supplierAmount <= 0) {
        return reply({ success: false, error: "Could not verify the data plan price" }, 400);
      }
      const sellingAmount = Math.round((supplierAmount + pricing.profit) * 100) / 100;
      if (!Number.isFinite(sellingAmount)) {
        return reply({ success: false, error: "Could not calculate the data plan price" }, 400);
      }

      requestedAmount = sellingAmount;
      const providerNetworkIds: Record<string, number | null> = {
        mtn: 1,
        airtel: 2,
        glo: 3,
        "9mobile": 4,
        vitel: null
      };
      cleanCustomerData = {
        network,
        internal_network_id: expectedInternalId,
        provider_network_id: providerNetworkIds[network],
        phone,
        bundle: String(plan.bundle_name),
        purchase_type: purchaseType,
        catalog_plan_id: Number(plan.id),
        supplier_plan_id: Number(plan.supplier_plan_id),
        validity: String(plan.validity),
        supplier_amount: supplierAmount,
        data_size_gb: pricing.dataSizeGb,
        profit_amount: pricing.profit,
        selling_amount: sellingAmount,
        pricing_rule: "ngn_50_per_gb",
        fulfillment_status: "provider_mapping_verified_but_live_fulfillment_disabled"
      };
    } else if (serviceKey === "airtime") {
      const amount = Number((customerData as Record<string, unknown>).amount);
      if (!Number.isSafeInteger(amount) || amount < 50 || amount > 100000) {
        return reply({ success: false, error: "Airtime amount must be between ₦50 and ₦100,000" }, 400);
      }
      requestedAmount = amount;
      const airtimeProviderNetworkIds: Record<string, number | null> = {
        mtn: 1,
        airtel: 2,
        glo: 3,
        "9mobile": 4,
        vitel: null,
      };
      supplierNetworkId = airtimeProviderNetworkIds[network];
      if (supplierNetworkId === null || supplierNetworkId === undefined) {
        return reply({
          success: false,
          error: "Airtime is not available for this network because the supplier network ID is not documented. No request was recorded."
        }, 409);
      }
      cleanCustomerData = {
        network,
        phone,
        amount,
        plan_type: "VTU",
        provider_network_id: supplierNetworkId,
      };
    } else {
      return reply({ success: false, error: "This service is not enabled for order requests yet" }, 400);
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
            catalog_plan_id: Number((cleanCustomerData as Record<string, unknown>).catalog_plan_id),
          },
        }
      : {
          service_key: "airtime",
          idempotency_key: idempotencyKey,
          details: {
            network,
            phone,
            amount: Number(requestedAmount),
            plan_type: "VTU",
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
    const { data: authorization, error: authorizationError } = await supabase
      .from("transaction_authorizations")
      .select("id,transaction_intent,expires_at,consumed_at")
      .eq("user_id", userId)
      .eq("token_hash", tokenHash)
      .eq("intent_hash", expectedIntentHash)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (authorizationError) throw authorizationError;
    if (!authorization || canonical(authorization.transaction_intent) !== expectedIntentText) {
      return reply({ success: false, error: "Biometric approval is missing, expired, or does not match these transaction details. Please approve again." }, 403);
    }
    const { data: consumed, error: consumeError } = await supabase
      .from("transaction_authorizations")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", authorization.id)
      .eq("user_id", userId)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle();
    if (consumeError) throw consumeError;
    if (!consumed) return reply({ success: false, error: "This biometric approval has already been used or has expired. Approve again." }, 409);

    const reference = `AIL-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;

    // Prepare provider-format previews for review only. No external supplier
    // request is sent and no purchase is fulfilled by this endpoint.
    if (serviceKey === "data") {
      providerRequestPreview = {
        network: Number((cleanCustomerData as Record<string, unknown>).provider_network_id),
        phone: `234${phone.slice(1)}`,
        data_plan: Number((cleanCustomerData as Record<string, unknown>).supplier_plan_id),
        bypass: false,
        "request-id": reference
      };
      providerDispatchStatus = "disabled_safe_mode";
      (cleanCustomerData as Record<string, unknown>).provider_request_preview = providerRequestPreview;
      (cleanCustomerData as Record<string, unknown>).provider_dispatch_status = "not_sent";
    } else if (serviceKey === "airtime") {
      providerRequestPreview = {
        network: supplierNetworkId,
        // Legitdataway's published cURL example uses the local 11-digit phone format.
        phone,
        plan_type: "VTU",
        amount: requestedAmount,
        bypass: false,
        "request-id": reference
      };
      providerDispatchStatus = "disabled_safe_mode";
      (cleanCustomerData as Record<string, unknown>).provider_request_preview = providerRequestPreview;
      (cleanCustomerData as Record<string, unknown>).provider_dispatch_status = "not_sent";
    }
    const { data: inserted, error: insertError } = await supabase
      .from("service_order_requests")
      .insert({
        user_id: userId,
        reference,
        idempotency_key: idempotencyKey,
        service_key: serviceKey,
        requested_amount: requestedAmount,
        currency: "NGN",
        customer_data: cleanCustomerData,
        supplier_network_id: serviceKey === "data" ? Number((cleanCustomerData as Record<string, unknown>).provider_network_id) : supplierNetworkId,
        supplier_plan_id: serviceKey === "data" ? Number((cleanCustomerData as Record<string, unknown>).supplier_plan_id) : null,
        provider_request_id: providerRequestPreview ? reference : null,
        provider_dispatch_status: providerDispatchStatus,
        provider_request_preview: providerRequestPreview,
        status: "received",
      })
      .select("id,reference,service_key,requested_amount,currency,status,created_at")
      .single();

    if (insertError?.code === "23505") {
      const { data: existing, error: lookupError } = await supabase
        .from("service_order_requests")
        .select("id,reference,service_key,requested_amount,currency,status,customer_data,created_at")
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) {
        const existingData = (existing.customer_data ?? {}) as Record<string, unknown>;
        const sameRequest =
          existing.service_key === serviceKey &&
          Number(existing.requested_amount) === Number(requestedAmount) &&
          existingData.network === network &&
          existingData.phone === phone &&
          (serviceKey !== "data" ||
            Number(existingData.catalog_plan_id) === Number((cleanCustomerData as Record<string, unknown>).catalog_plan_id)) &&
          (serviceKey !== "airtime" ||
            Number(existingData.amount) === Number(requestedAmount));
        if (!sameRequest) {
          return reply({
            success: false,
            error: "This request key was already used for different order details. Start a new request."
          }, 409);
        }
        return reply({
          success: true,
          order_request: {
            id: existing.id,
            reference: existing.reference,
            service_key: existing.service_key,
            requested_amount: existing.requested_amount,
            currency: existing.currency,
            status: existing.status,
            created_at: existing.created_at,
          },
          notice: "Request record only. No payment was taken and no service was delivered.",
          repeated_request: true,
        });
      }
    }
    if (insertError) throw insertError;

    return reply({
      success: true,
      order_request: inserted,
      notice: "Request record only. No payment was taken and no service was delivered.",
      repeated_request: false,
    }, 201);
  } catch (error) {
    console.error("AILAT ORDER REQUEST ERROR:", error instanceof Error ? error.message : "Unknown error");
    return reply({ success: false, error: "Could not save the request. Please try again." }, 500);
  }
});
