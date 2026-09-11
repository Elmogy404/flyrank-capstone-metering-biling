# Design

## Problem

Backend service for multi-tenant usage metering and billing:
- Track tenant usage (API calls, AI tokens)
- Enforce monthly quotas per plan
- Calculate usage costs with markup
- Process payments via Paymob
- Prevent duplicate records on retries

AI usage is simulated. No real model integration required.

## Scope

**In:** Multi-tenant metering, monthly quotas, idempotent recording, quota enforcement, monthly rollups, AI token cost calculation, Paymob checkout, webhook verification, subscription sync.

**Out:** Real payments, invoicing, proration, overage billing, real AI calls.

## Data Model

```
Tenant 1 ────< Subscription >──── 1 Plan
Tenant 1 ────< UsageEvent
PaymentEvent (standalone, keyed by provider + event ID)
```

- `usage_events` is the source of truth for usage
- Usage is rolled up from events for the current billing month
- Counters are not stored in `subscriptions`

## Architecture

```
Client → HTTP API → Services → Repositories → PostgreSQL
Paymob → Webhook → HMAC verify → Dedup → Subscription sync
```

Services: MeterService, GeneratorService, UsageService, BillingService, PaymobService, SubscriptionService, ReconciliationJob.

## Metering Strategy

Every billable request provides an `Idempotency-Key`. Flow:

1. Query for existing event (outside transaction)
2. If found, return existing (idempotent)
3. BEGIN transaction
4. `SELECT ... FOR UPDATE` on subscription
5. Read current usage
6. Check: `currentUsage + quantity <= limit`
7. INSERT usage event
8. COMMIT

The `UNIQUE(tenant_id, idempotency_key)` constraint is the final protection. Concurrent duplicates that pass the query check are caught by the constraint (code 23505) and resolved to the existing event.

GeneratorService uses the same pattern but records both API_CALL and AI_TOKEN in a single transaction with derived idempotency keys (`generate_{key}` and `generate_tokens_{key}`).

## Quota Strategy

```
currentUsage + requestedUsage > limit  →  reject (HTTP 429)
currentUsage + requestedUsage <= limit →  allow
```

`SELECT ... FOR UPDATE` locks the subscription row within the transaction, preventing concurrent requests from exceeding the limit.

Exact boundary (usage + quantity = limit) is allowed. One unit over is rejected.

## Pricing Model

All values in integer microcents (1/100,000 of a cent):

| Category | Cost |
|----------|------|
| input | 100 |
| cached_input | 10 |
| output | 300 |
| reasoning | 300 |

Markup: NUMERATOR=3, DENOMINATOR=2 (1.5x). Applied via `Math.ceil()`.

Client price = raw cost × markup. No floating point anywhere.

## Payment Provider: Paymob

The original capstone specified Stripe Test Mode. This implementation uses Paymob Test Mode due to regional availability (Egypt).

**What changed:** Payment provider, webhook signature (Stripe Ed25519 → HMAC-SHA512), checkout flow (Stripe Sessions → Paymob Unified Checkout), webhook body format, tenant resolution (Stripe metadata → Paymob merchant_order_id), column name (`stripe_subscription_id` → `provider_subscription_id`).

**What was preserved:** Server-side checkout, server-side pricing, signed provider callbacks, event deduplication, subscription synchronization, provider state as payment truth, transaction-safe state changes.

Paymob has no native subscription API. Checkout is a one-time payment for plan activation.

## Webhook Security

1. HMAC-SHA512 verification (20 fields, lexicographic order)
2. Timing-safe comparison (`crypto.timingSafeEqual`)
3. Event deduplication (`UNIQUE(provider, provider_event_id)`)
4. No state change before verification
5. Subscription updates within a database transaction

## Reconciliation Job

Runs outside the HTTP request path via `npm run reconcile`.

**Responsibility:** Detect unprocessed payment events and stale pending subscriptions.

**Behavior:** Read-only diagnostic checks with retry on transient DB failures. Structured logging for failure reporting. Does not modify billing state.

**Execution:** CLI entry point suitable for cron, Task Scheduler, or Docker. Exit 0 = clean, 1 = errors.

## Architecture Invariants

1. Every usage event belongs to exactly one tenant
2. Tenants cannot access another tenant's usage
3. Usage events are the source of truth
4. Same billable operation must not be counted twice
5. Database constraints protect against duplicate idempotency keys
6. Quota checks must be concurrency-safe
7. Money uses integer units
8. Paymob webhook signatures must be verified
9. Paymob events must be processed idempotently
10. Paymob is the payment source of truth; PostgreSQL mirrors verified events
