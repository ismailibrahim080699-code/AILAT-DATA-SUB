# AILAT DATA — Existing Services Integration Readiness
Date: 2026-11-14

This document records what is implemented in the repository and what evidence is still required before each existing service can be described as live.

## Service readiness

| Service | Current implementation | Evidence still required before live |
|---|---|---|
| Buy Data | Authenticated request recording, server catalogue validation, idempotency, supplier request preview | Verified supplier plan IDs/prices for all enabled plans, supplier response/status contract, controlled fulfilment and payment reconciliation |
| Buy Airtime | Authenticated request recording, amount/network validation, idempotency, documented Legitdataway request preview | Supplier status/error contract and safe reconciliation design; dispatch is currently disabled |
| Airtime to Cash | Validated local review; details passed using sessionStorage | A real conversion partner, API contract, verified conversion rates, payout/reversal process and fraud controls |
| Electricity | Validated local review and summary | Named electricity provider, API documentation, disco/meter validation contract, vend response and reversal semantics |
| Cable TV | Validated local review and summary | Named TV provider, API documentation, smartcard validation, package catalogue/pricing and subscription response contract |
| Exam PIN / Result | Validated local review and summary | Official supplier/API, exam product catalogue, pricing, fulfilment and result-check response contract |
| Wallet funding / withdrawal | Wallet display/request surfaces exist; funding and withdrawal are not enabled | Approved payment provider integration, server-side verification, ledger/reconciliation and withdrawal controls |
| Airtime to Cash | No partner dispatch | Do not accept or solicit airtime until partner and conversion process are verified |

## Security and correctness rules already applied
- Browser pages do not contain supplier credentials.
- Customer details for Data, Airtime and Airtime-to-Cash review are not placed in URL query parameters.
- Order requests require a verified Firebase email and are associated with the authenticated user.
- Request idempotency keys are bound to the submitted service and order details; reusing a key for different details is rejected.
- Unknown supplier mappings must fail closed rather than guessing IDs.
- A request recorded by AILAT DATA must not be described as supplier acceptance, payment, or successful delivery.
- Supplier dispatch remains disabled in the deployed order-request function.

## Required supplier evidence for the remaining services
For each service, the integration must be based on the supplier's own current documentation and should establish:
1. Base URL and HTTP method.
2. Authentication method and server-only credential name.
3. Exact request schema, accepted identifiers, and number formats.
4. Catalogue/validation endpoints and authoritative prices.
5. Success, pending, failure, timeout and duplicate-reference response semantics.
6. Transaction enquiry/status endpoint or webhook, if available.
7. Reversal/refund and reconciliation behaviour.
8. Sandbox/test procedure that does not debit a real wallet or deliver a paid product.

Do not enable a service by guessing an endpoint, network ID, price, or response status. The current review pages intentionally do not submit provider orders.
