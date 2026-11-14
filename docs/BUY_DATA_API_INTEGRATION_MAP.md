# AILAT DATA — Buy Data API Contract & Integration Readiness

Date: 2026-11-14
Status: Read-only review and integration preparation. No live supplier calls, payments, wallet changes, or database changes are enabled by this document.

## 1. Current request path

1. `data.html` requests `GET /functions/v1/ailat-order-requests?action=plans` with the Supabase publishable key.
2. The Edge Function returns active catalogue entries only when `supplier_mapping_status = verified` and both supplier IDs are present.
3. The customer selects a plan and its details are handed to `order_summary.html` through tab-scoped `sessionStorage`, not URL query parameters.
4. `order_summary.html` reloads the plan catalogue, validates the stored draft identifiers, checks Firebase sign-in and verified email, then sends an authenticated POST.
5. The Edge Function verifies the Firebase ID token, validates the customer details, loads the plan and price from the server-side catalogue, and records an order-request row.
6. The current function explicitly does not contact a supplier and does not charge a wallet.

## 2. Current GET contract

Request:
- Method: GET
- Path: `/functions/v1/ailat-order-requests?action=plans`
- Header: `apikey: <Supabase publishable key>`

Response shape:
```json
{
  "success": true,
  "plans": [
    {
      "id": 123,
      "network": "MTN",
      "internal_network_id": 1,
      "type": "SME",
      "name": "500MB",
      "validity": "30 days",
      "amount": 75
    }
  ]
}
```

The example values above are illustrative, not live catalogue values. The amount is calculated server-side from the catalogue supplier amount plus the current markup rule.

## 3. Current authenticated POST contract

Required headers:
- `apikey: <Supabase publishable key>`
- `Authorization: Bearer <Firebase ID token>`
- `Content-Type: application/json`

Current request body:
```json
{
  "service_key": "data",
  "idempotency_key": "UUID",
  "customer_data": {
    "network": "MTN",
    "internal_network_id": 1,
    "phone": "08000000000",
    "purchase_type": "SME",
    "catalog_plan_id": 123
  }
}
```

The backend independently checks the Firebase token issuer, audience and verified-email claim. It resolves the selected plan and price from `data_plan_catalog`; client-provided prices are not trusted. A repeated idempotency key for the same user returns the existing request record.

Current success response contains `success`, `order_request`, `notice`, and `repeated_request`. The notice explicitly states that no payment was taken and no service was delivered.

## 4. Mapping and readiness observations

- AILAT internal network IDs are MTN=1, Airtel=2, Glo=3, 9mobile=4, Vitel=5.
- The current server code accepts provider network IDs 1–4 for the first four networks. Vitel is deliberately unmapped for supplier dispatch and must remain unavailable for live fulfilment until the provider's official documentation confirms its exact mapping.
- Catalogue rows must be marked verified and contain supplier plan/network IDs before they are shown by the current GET endpoint.
- The server computes the selling price from the catalogue. The client must never supply a trusted price.
- The current margin helper parses bundle labels in MB/GB format and applies the configured ₦50-per-GB rule. The business owner must review and approve the pricing rule before any real commerce feature is enabled.
- The order-request endpoint uses an idempotency key to reduce duplicate request records.
- The current Edge Function has platform `verify_jwt=false`; its own Firebase JWT verification is therefore security-critical and must be independently reviewed before any sensitive live action is considered.

## 5. Provider documentation required before any provider adapter can be specified

Do not guess endpoint URLs, authentication schemes, network IDs, plan IDs, request fields, callback signatures, or status codes. Obtain the provider's official documentation and have the responsible adult/business owner verify:
- Official API base URL and environment separation (sandbox vs production)
- Authentication method and credential rotation procedure
- Exact network and plan catalogue, including Vitel if supported
- Purchase request schema and provider reference/idempotency behavior
- Status inquiry and asynchronous callback/webhook signature verification
- Timeout, retry, duplicate prevention, reversal/refund, and reconciliation rules
- Rate limits, support escalation, and service-level expectations

Never place provider secrets, Supabase service-role keys, or Firebase Admin credentials in browser code, GitHub files, screenshots, chat messages, or logs. Privileged credential provisioning and any real-money activation must be handled by the responsible adult/business owner.

## 6. Next safe engineering steps

1. Obtain the provider's official API documentation (no credentials needed for initial mapping).
2. Build a non-production adapter contract and mock fixtures from that documentation.
3. Add automated validation tests for request schema, catalogue mapping, idempotency, and provider status parsing without sending purchases.
4. Have the responsible adult/business owner and an independent reviewer approve security, pricing, payment, refund, and fulfilment design before considering any live activation.

## 7. Scope boundary

This document does not enable supplier dispatch, payment collection, wallet debit/credit, withdrawals, or live fulfilment. Existing request-only behavior remains unchanged.

## 8. Supplier catalogue provenance audit (2026-11-13)

- A recursive inspection of the repository's default-branch file tree found no supplier-catalogue importer, scheduled sync job, or source import script. The root `data-plans.js` file contains public plan metadata only; it explicitly does not contain supplier prices.
- The `public.legitdataway_data_plan_catalog` source rows were imported in one batch timestamp. 160 of 170 rows have NULL `amount`; all 170 are flagged `source_verified=true`. Therefore that flag alone cannot be treated as price verification.
- No importer was modified and no catalogue rows were changed. The next safe step is to obtain the exact official supplier catalogue response/export or the original import payload, then identify the actual price field and validate the parser against that source before any database changes.

## 9. Follow-up read-only Supabase audit (2026-11-14)

- The live `public.data_plan_catalog` table contains 170 rows, 169 active. Ten rows currently satisfy the Edge Function's visibility filter: active, `supplier_mapping_status='verified'`, non-null supplier plan/network IDs, and non-null `supplier_amount`. All ten are Glo SME plans with supplier plan IDs 220–229.
- The displayed supplier catalogue also includes Glo SME plan ID 230 (10GB, 14 days, ₦3,480). The current application row for ID 230 still has `supplier_amount=3560` and `supplier_mapping_status='unmapped'`. It is therefore excluded from the verified plan list. Do not change it until the responsible operator confirms the authoritative supplier price and mapping.
- Forty Vitel rows have no supplier network mapping. The other networks' rows are not currently verified for supplier mapping, so they remain excluded from the verified plan list.
- Security Advisor reports RLS enabled with no policies on several public tables. A separate grants check found only `service_role` table grants (no `anon` or `authenticated` grants) on the inspected catalogue, order-request, transaction, wallet, and referral tables. This is a deny-by-default configuration for direct client table access; Edge Functions using privileged service credentials still require careful authorization checks.
- These checks were read-only. No catalogue rows, policies, credentials, wallet balances, or order dispatch settings were changed.

## 10. Defensive provider mapping validation (2026-11-14)

- Deployed `ailat-order-requests` Edge Function version 22 as a fail-closed validation hardening change. The plan-list response now omits rows unless the supplier plan ID is a positive safe integer, the supplier network ID is a positive safe integer matching the documented provider network ID, the network is one of the four documented networks (Vitel remains excluded), and the supplier amount is finite and greater than zero.
- The authenticated request path now rejects non-positive supplier plan/network IDs and non-positive or invalid supplier amounts. This closes a JavaScript coercion edge case where `Number(null)` becomes `0` and can pass `Number.isSafeInteger`.
- This deployment does not add provider calls, payment handling, wallet debits, or fulfilment. Existing request-only behavior remains unchanged.
- Post-deployment metadata check confirmed function version 22 is ACTIVE. A live browser/GET endpoint smoke test and the GitHub contract workflow were not run in this step; do not treat deployment metadata as proof of end-to-end behavior.
