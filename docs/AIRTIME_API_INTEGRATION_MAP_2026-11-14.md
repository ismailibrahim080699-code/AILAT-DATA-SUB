# AILAT DATA — Legitdataway Airtime API Integration Map
Date: 2026-11-14

## Published supplier contract
- Method: POST
- Endpoint: https://legitdataway.com/api/topup
- Authentication header: Authorization: Token <API_KEY> (server-side secret only)
- Content-Type: application/json
- Request fields:
  - network: numeric supplier network ID
  - phone: Nigerian mobile number; supplier's published cURL uses local 11-digit format
  - plan_type: "VTU"
  - amount: integer naira amount
  - bypass: boolean (documented example uses false)
  - request-id: unique client-generated supplier reference

## Documented network IDs
| Network | ID |
|---|---:|
| MTN | 1 |
| Airtel | 2 |
| Glo | 3 |
| 9mobile | 4 |
| Vitel | Not published; disabled |

## Documented response fields
The sample response contains network, request-id, amount, discount, status, message, phone_number, oldbal, newbal, system, plan_type, and wallet_vending. The example shows status "success".
- Do not treat an AILAT DATA request status of "received" as supplier success.
- A supplier response should be validated against its request-id and an explicitly documented status before any future fulfilment state is recorded.
- The documentation supplied so far does not define pending/failed status values, a transaction enquiry endpoint, reversal semantics, or duplicate-reference behaviour beyond advising a unique request-id. These must not be guessed.

## Current AILAT DATA implementation
- Airtime requests are authenticated and recorded in service_order_requests.
- Server builds a provider request preview using the published fields and network IDs.
- Supplier dispatch is intentionally disabled; no HTTP request is sent to Legitdataway.
- No wallet debit or payment is performed.
- Unknown network mappings are rejected before an order record is created.
- Idempotency key protects the AILAT request-recording endpoint from duplicate submissions.
- Frontend receipt says the request was recorded and explicitly does not claim supplier acceptance or airtime delivery.

## Safe next integration requirements
Before any real supplier dispatch is implemented, the backend must use a server-only secret, submit only after the app's payment/fulfilment controls are formally defined, validate the supplier response and request-id, handle pending/failed states, and safely reconcile timeouts/retries. Do not expose supplier credentials or supplier wallet balance fields to the browser.
