# Evidence

Concrete proof per Definition of Done requirement.

---

## Metering

### Billable action creates usage
**Proof:** `meter.service.test.js` — "records usage successfully"
**Result:** Usage event persisted with correct tenant_id, type, quantity, idempotency_key.

### Duplicate prevention
**Proof:** `meter.service.test.js` — "returns existing event on duplicate idempotency key"
**Result:** Second call returns `recorded: false` and original event. `UNIQUE(tenant_id, idempotency_key)` enforced.

### Concurrent duplicates
**Proof:** `meter.service.test.js` — "concurrent duplicate requests produce one event"
**Result:** 5 concurrent same-key requests → 1 recorded, 4 rejected.

---

## Quotas

### Within limit
**Proof:** `meter.service.test.js` — "allows usage within quota"
**Result:** 999 calls on Free plan (limit 1000) → allowed.

### Exact boundary
**Proof:** `meter.service.test.js` — "allows usage exactly at quota"
**Result:** 999 + 1 = 1000 → allowed.

### Over limit
**Proof:** `meter.service.test.js` — "rejects usage exceeding quota"
**Result:** 999 + 2 = 1001 → throws `QuotaExceededError`.

### Rejected usage not persisted
**Proof:** `meter.service.test.js` — "rejected operation leaves no persisted usage"
**Result:** No row inserted for rejected request.

### Concurrent quota competition
**Proof:** `meter.service.test.js` — "concurrent requests competing for quota respect the limit"
**Result:** 10 × 100 = 1000 concurrent requests → total usage ≤ 1000. `SELECT ... FOR UPDATE` prevents races.

---

## Pricing

### Token categories
**Proof:** `pricing.test.js` — "has all four token categories"
**Result:** input, cached_input, output, reasoning all defined.

### Cached input cheaper
**Proof:** `pricing.test.js` — "cached_input is cheaper than input"
**Result:** 10 < 100.

### Markup
**Proof:** `pricing.test.js` — "applies markup to cost"
**Result:** Client price = raw cost × 1.5 via `Math.ceil()`.

### Integer arithmetic
**Proof:** `pricing.test.js` — "all costs are integers"
**Result:** No floating point. All values are integer microcents.

---

## Generate Endpoint

### Authenticated generation
**Proof:** `integration.test.js` — "authenticated tenant can generate"
**Result:** 200 with token breakdown and total count.

### Atomic metering
**Proof:** `generator.service.test.js` — "records API_CALL and AI_TOKEN usage atomically"
**Result:** Both events created in single transaction.

### Quota enforcement on generate
**Proof:** `generator.service.test.js` — "rejects usage exceeding API_CALL quota"
**Result:** QuotaExceededError when limit exceeded.

---

## Usage Endpoint

### Monthly usage with cost
**Proof:** `integration.test.js` — "reflects usage from generate calls"
**Result:** Usage reflects recorded events; cost breakdown included.

### Plan limits
**Proof:** `integration.test.js` — "includes plan limits"
**Result:** Plan limits returned alongside usage.

---

## Database

### Migrations
**Proof:** `npm run migrate` runs 4 migrations successfully.
1. `001_initial_schema.sql` — plans, tenants, subscriptions, usage_events
2. `002_seed.sql` — 3 plans + demo tenant
3. `003_add_payment_events_and_provider.js` — payment_events, provider column
4. `004_add_usage_metadata.js` — metadata JSONB

### Constraints

**usage_events:**
```sql
CONSTRAINT unique_tenant_idempotency UNIQUE (tenant_id, idempotency_key)
CONSTRAINT chk_usage_type CHECK (type IN ('API_CALL', 'AI_TOKEN'))
CONSTRAINT chk_usage_quantity CHECK (quantity > 0)
```

**payment_events:**
```sql
CONSTRAINT unique_provider_event UNIQUE (provider, provider_event_id)
```

**Enforced by:** `meter.service.test.js` (idempotency), `integration.test.js` (dedup)

### Tenant isolation
**Proven by:** `meter.service.test.js` — "isolates usage between tenants", `integration.test.js` — "tenant isolation is preserved", `billing.service.test.js` — tenant isolation during webhook processing

---

## Payment Integration

**Note:** Original capstone specifies Stripe. This uses Paymob (regional: Egypt). Architectural goals preserved.

### Checkout
**Proof:** `integration.test.js` — "authenticated tenant can initiate Pro checkout"
**Result:** 200 with Paymob checkout URL.

### Server-side pricing
**Proof:** `integration.test.js` — "client cannot control amount"
**Result:** Sending `amount: 1` is ignored. Server uses 50,000 EGP cents.

### Tenant isolation
**Proof:** `integration.test.js` — "client cannot control tenant ID"
**Result:** Sending `tenant_id` is ignored. Tenant from auth token.

### HMAC verification
**Proof:** `paymob.service.test.js` — "returns true for valid HMAC"
**Result:** SHA-512 with 20 fields, lexicographic order, timing-safe comparison.

### Invalid webhook rejected
**Proof:** `integration.test.js` — "invalid signature is rejected with 400"
**Result:** 400 returned, no database changes.

### Forged callback no state change
**Proof:** `integration.test.js` — "forged callback does not change subscription"
**Result:** Subscription remains "active" after forged attempt.

### Event deduplication
**Proof:** `integration.test.js` — "duplicate callback does not create duplicate event rows"
**Result:** Two identical webhooks → 1 row in payment_events.

### Concurrent webhook dedup
**Proof:** `integration.test.js` — "concurrent duplicate webhooks do not double-process"
**Result:** 5 concurrent → all 200, but 1 row inserted.

### Subscription sync (success)
**Proof:** `integration.test.js` — "successful payment activates Pro subscription"
**Result:** Status changes to "active" after verified payment.

### Subscription sync (failure)
**Proof:** `integration.test.js` — "failed payment marks subscription as expired"
**Result:** Status changes to "expired" after verified failure.

---

## Background Job

### ReconciliationJob
**Proof:** `tests/jobs/reconciliation.job.test.js` — 8 tests
**Result:** Detects unprocessed payment events, stale pending subscriptions. Retry on transient failures. Structured error logging. CLI via `npm run reconcile`.

### CLI entry point
**Proof:** `tests/jobs/run-reconciliation.test.js` — exit 0 on clean state, valid importable script
**Result:** `npm run reconcile` exits 0 (success) or 1 (errors).

---

## Tests

```
Test Suites: 9 passed, 9 total
Tests:       122 passed, 122 total
```

| Suite | Tests |
|-------|-------|
| `tests/metering/meter.service.test.js` | 14 |
| `tests/billing/paymob.service.test.js` | 6 |
| `tests/billing/billing.service.test.js` | 12 |
| `tests/billing/integration.test.js` | 35 |
| `tests/pricing.test.js` | 15 |
| `tests/generator/generator.service.test.js` | 16 |
| `tests/usage/usage.service.test.js` | 14 |
| `tests/jobs/reconciliation.job.test.js` | 8 |
| `tests/jobs/run-reconciliation.test.js` | 2 |

---

## Documentation

- **README.md** — Project overview, architecture, setup, limitations
- **API.md** — Full API contract (5 endpoints)
- **DESIGN.md** — Architecture, metering/quota/pricing strategy, invariants
- **DEMO.md** — Reproducible acceptance probes
- **EVIDENCE.md** — This document
- **BUILDLOG.md** — Development history
- **capstone.yaml** — run, seed, test, base_url, endpoints

---

## Not Claimed

- Invoice generation
- Overage billing
- Proration
- Real payment processing (Test Mode only)
- Production-grade authentication
- Automatic repair (reconciliation is detection/reporting only)
