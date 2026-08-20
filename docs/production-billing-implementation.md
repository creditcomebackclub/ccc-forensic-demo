# CCC Production Billing Implementation

Status: architecture locked; gateway disabled; awaiting Zen/NMI gateway access and compliance approval.

## Non-negotiable release rules

1. Vaulting a payment method never charges the client.
2. A charge is created only for a specifically defined, fully performed service milestone.
3. The service agreement, cancellation window, invoice description, earned timestamp, and charge trigger must agree.
4. Raw PAN, CVV, bank credentials, and unfiltered gateway payloads never enter CCC, Supabase, Netlify logs, or analytics.
5. A retry of the same request cannot create a second charge.
6. Browser success is provisional. Signed gateway events and reconciliation determine the final transaction state.
7. Affiliate commission becomes payable only from a settled payment and is reversed or adjusted for refunds and chargebacks.
8. Production charging stays disabled until the controlled live pilot is explicitly approved.

## Current pricing baseline

Until the business approves a replacement matrix, implementation uses the prices already present throughout CCC:

| Plan | Monthly fee | First Work Fee | Paid-in-full fee |
|---|---:|---:|---:|
| Standard | $79 | $75 | — |
| VIP | $149 | $99 | — |
| Paid in Full | — | waived | $499 / 6 months |

Pricing must move to one database-backed configuration before activation. Contracts, public pages, onboarding, affiliate emails, invoices, dashboards, and charge creation must read from the same versioned price record. A price change applies prospectively and never rewrites an existing client's agreed terms.

## Why the old NMI branch is reference-only

`origin/cursor/live-nmi-billing-abb1` contains useful prototypes but must not be merged wholesale into current `main`:

- It modifies the audit worker from before PDF chunking, bureau merge, and Recovery Blueprint delivery were completed.
- It can trigger first billing from both staff activation and audit-delivery paths.
- It writes gateway activity back into the JSON client ledger, creating concurrent-update and double-accounting risk.
- It stores the NMI vault id on `client_profiles`; client access is restricted mostly by application convention instead of structural separation.
- Its webhook accepts a custom header or query-string secret. Production must validate the gateway's supported signed webhook format and deduplicate its event id.
- Its fallback webhook reconciliation can automatically apply an unknown payment to oldest invoices by amount. Production reconciliation must require an explicit invoice or CCC charge reference.
- It stores broad webhook payloads as `raw_response`; production persistence must use an allowlist of non-sensitive fields.

Reusable concepts are limited to Collect.js tokenization, Customer Vault usage, decline classification, and unique charge-attempt keys.

## Target data model

### `billing_customers`

Server-only gateway identity, separated from portal-readable client profiles.

- `client_id` unique foreign key
- `gateway` (`nmi`)
- encrypted or server-restricted `customer_vault_id`
- safe display metadata: card brand, last four, expiry
- stored-credential consent timestamp and agreement version
- initial customer-initiated transaction reference, when required
- created/updated timestamps

No authenticated browser receives the vault identifier.

### `billing_price_versions`

- plan name and immutable version
- monthly fee, First Work Fee, flat fee, service period
- effective dates
- contract copy/version
- active flag

### `billing_subscriptions`

- client, plan, and price version
- lifecycle: `pending`, `active`, `past_due`, `paused`, `cancelled`, `completed`
- service-period dates
- next service review date
- cancellation timestamp and reason
- no card details

### `billing_invoices`

- client and subscription
- service milestone/type
- service period
- amount and immutable line items
- `service_completed_at`
- `charge_eligible_at`
- state: `draft`, `earned`, `open`, `paid`, `void`, `refunded`, `uncollectible`
- explicit links to the audit, Blueprint, mailing, or completed service evidence that earned it

Invoices cannot become chargeable without `service_completed_at` and the applicable contract/cancellation gate.

### `billing_payment_attempts`

- invoice and client
- unique CCC idempotency key
- NMI transaction id
- amount and attempt number
- origin: client, staff, scheduled retry, reconciliation
- state: `created`, `submitted`, `approved`, `declined`, `error`, `voided`, `refunded`, `chargeback`
- allowlisted processor response code, AVS/CVV result, and safe error text
- next retry time

### `billing_gateway_events`

- unique gateway event id
- signature verification result
- event type and transaction id
- received/processed timestamps
- allowlisted payload only
- processing outcome and error

Every event is insert-once and safe to replay.

### `affiliate_commission_entries`

- affiliate, client, payment attempt, and invoice
- earned, payable, paid, reversed states
- rate snapshot and calculated amount
- adjustment relationship for refunds/chargebacks

## Billing state machine

```text
Agreement completed
  -> cancellation gate satisfied
  -> payment method tokenized and vaulted (no charge)
  -> contracted service milestone fully performed
  -> invoice marked earned
  -> charge eligibility check
  -> idempotent NMI sale submitted
       -> approved -> webhook/reconciliation -> paid -> commission payable
       -> soft decline -> notified -> controlled retry schedule
       -> hard decline -> payment method update required
       -> unknown/error -> reconciliation queue; never blind retry
       -> refund/chargeback -> invoice/commission adjustment
```

The exact event that constitutes a fully performed service is a business/legal decision, not a technical inference. The current branch's generic `audit_delivery` trigger is therefore not carried forward.

## Security and gateway integration

- NMI Collect.js runs in the browser using only the browser-safe tokenization key.
- CCC receives a short-lived payment token, not card data.
- A server-only function exchanges the token for a Customer Vault record.
- Gateway security keys and webhook signing keys live only in Netlify secret environment variables.
- Webhook validation follows the format enabled in the NMI portal; query-string secrets are prohibited.
- Logs redact authorization headers, tokens, vault ids, and gateway bodies.
- All billing write endpoints require server-side identity and client ownership/admin authorization.
- Rate limits apply to vaulting, manual charges, refunds, and retries.

## Feature flags

Use one fail-closed mode variable:

- `BILLING_MODE=disabled`: card UI hidden; no vault or charge calls accepted.
- `BILLING_MODE=test`: test gateway only; production keys rejected.
- `BILLING_MODE=pilot`: live gateway limited to allowlisted client ids.
- `BILLING_MODE=live`: approved production rollout.

Changing modes requires a new deploy and must be visible in the Operations control center. `BILLING_AUTO_CHARGE=true` is not sufficiently expressive for production rollout.

## Credential checklist from Zen/NMI

- Browser-safe Collect.js tokenization key
- Server-only NMI security/API key
- Gateway account/merchant identifier
- Test or sandbox credentials, if offered
- Webhook signing key and supported event format
- Customer Vault enabled
- Stored credential / merchant-initiated transaction support enabled
- AVS and CVV policy confirmed
- Refund, void, settlement, and chargeback access confirmed
- ACH credentials only if ACH is intentionally added later

Secrets are entered directly into Netlify/local secret storage and never committed or pasted into documentation.

## Migration from the manual ledger

1. Freeze a read-only export of every current client ledger.
2. Create normalized historical invoices and payments with `source=manual_import`.
3. Preserve original dates, notes, and amounts.
4. Reconcile imported balances with the existing Billing dashboard.
5. Require staff review for ambiguous or unmatched rows.
6. Switch dashboard reporting to normalized tables.
7. Retain the old JSON ledger read-only for an audit period; do not dual-write indefinitely.

Existing clients are not automatically vaulted or charged. They receive a secure payment-method update flow and are migrated in a separate, monitored cohort.

## Required tests before live mode

- Collect.js tokenization without PAN/CVV reaching CCC
- New vault and vault update
- Invalid/expired token
- Exact one-time charge
- Simultaneous duplicate requests
- Network timeout after processor approval
- Soft and hard declines
- Retry schedule and retry cancellation after payment
- Signed, invalid, duplicate, delayed, and out-of-order webhooks
- Refund, partial refund, void, and chargeback
- No automatic matching of unknown transactions
- No commission before settlement
- Commission reversal after refund/chargeback
- Cancellation and paid-in-full completion
- Billing pause without stopping statutory dispute tracking
- Test credentials rejected in live mode and live credentials rejected in test mode

## Rollout gates

1. Compliance review approves the service milestones and agreement language.
2. All tests pass in NMI test mode.
3. Manual reconciliation matches the Billing dashboard.
4. One owner-approved internal live transaction is charged and refunded.
5. One consenting pilot client completes the full cycle.
6. Three-to-five client cohort completes without manual database repair.
7. Ten-client cohort completes with alerts and daily reconciliation.
8. `BILLING_MODE=live` is enabled only after explicit approval.

## Operations control-center additions

When billing implementation begins, the Operations queue will add:

- gateway disabled/misconfigured
- vault setup failed
- earned invoice not charged
- payment attempt stuck or unknown
- soft decline retry due
- hard decline requiring client action
- webhook signature failure
- gateway event processing failure
- transaction/invoice reconciliation mismatch
- refund or chargeback requiring commission adjustment

No retry action may bypass invoice eligibility, idempotency, or the active rollout mode.
