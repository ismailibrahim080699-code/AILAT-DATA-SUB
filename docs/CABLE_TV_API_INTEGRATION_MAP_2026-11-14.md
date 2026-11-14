# AILAT DATA — Cable TV API Integration Map
Date: 2026-11-14

## Current verified supplier documentation

### Provider identifiers
| Provider | Legitdataway cable ID | Purchase `cablename` |
|---|---:|---|
| GOtv | 1 | `gotv` |
| DStv | 2 | `dstv` |
| StarTimes | 3 | `startimes` |

The numeric identifiers above are for IUC validation. The purchase documentation uses a provider-name string in `cablename`. Confirm exact accepted spelling/casing with supplier if rejected; do not guess package identifiers.

### IUC / smartcard validation
- Method: GET
- Endpoint: `https://legitdataway.com/api/cable/cable-validation`
- Query parameters: `iuc`, `cable`
- Authentication: `Authorization: Token <server-side API key>`
- Documented success response: `{ "status": "success", "name": "..." }`
- Validate before any subscription request.

### Cable subscription request
- Method: POST
- Endpoint: `https://legitdataway.com/api/cable`
- Authentication: `Authorization: Token <server-side API key>`
- Documented fields:
  - `cablename`
  - `cableplan`
  - `smart_card_number`
  - `request-id` (unique)
- Documented success response includes `cablename`, `cableplan`, `amount`, `status`, `message`, `smart_card_number`, `request-id`, `oldbal`, `newbal`, and `system`.

## Verified AILAT DATA repository/backend state

- `tv.html` currently accepts provider, smartcard/IUC number, and a free-text package name. It only hands data to a local review page.
- `tv_order_summary.html` is a local review only; it does not submit an order.
- Supabase Edge Function `ailat-order-requests` currently accepts only `data` and `airtime` in its request handler. Cable TV is not implemented there.
- Database table `service_order_requests` has a CHECK constraint limiting `service_key` to `data`, `airtime`, and `electricity`.
- No Cable TV package catalogue/table was found in the public schema.
- No provider call was made; no payment or fulfilment was attempted.

## Required before implementation can safely accept a Cable TV request

1. A verified package catalogue for DStv, GOtv, and StarTimes with exact supplier `cableplan` values and supplier prices.
2. Confirmed purchase `cablename` values and any required package/provider mapping rules.
3. Supplier documentation for failed/pending responses and whether a status lookup endpoint or webhook exists.
4. A server-side design that keeps the supplier API key out of browser code, validates IUC server-side, and stores idempotent order requests.
5. A reviewed schema change to allow a Cable TV service key and a separate server-controlled cable package catalogue. Do not enable provider dispatch or payment as part of this preparatory work.

## Non-negotiable mapping rule

Never infer `cableplan` from the package display name or fabricate package prices. A plan must remain unavailable until its exact supplier code and price are independently verified against supplier-provided data.
