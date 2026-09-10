# Build Log

## Phase 1 — Foundation

**What was built:**
- Database schema (plans, tenants, subscriptions, usage_events)
- Seed data (3 plans, demo tenant)
- Multi-tenant data model with foreign keys
- `usage_events` table with idempotency constraint

**AI assistance:**
- Architecture discussion and data model design
- Schema SQL generation and review
- Migration file structure
- Documentation generation (README, API, DESIGN)

**Human decisions:**
- Plan names and quota limits
- Authentication mechanism (simplified Bearer token = tenant ID)
- Technology choices (Express 5, pg, node-pg-migrate)

---

## Phase 2 — Metering & Quotas

**What was built:**
- `MeterService` — idempotent usage recording with concurrency-safe quota enforcement
- `QuotaService` — quota checking logic
- `UsageRepository` — monthly aggregation queries
- `SubscriptionRepository` — active subscription lookup with `SELECT ... FOR UPDATE`
- 11 unit tests for metering (idempotency, quota boundaries, concurrency, tenant isolation)

**AI assistance:**
- Idempotency strategy design (database uniqueness as final protection)
- Concurrency-safe quota enforcement approach (`SELECT ... FOR UPDATE`)
- Quota exceeded error handling
- Test design for concurrent scenarios
- Monthly usage aggregation queries

**Human decisions:**
- Using database constraints as the primary idempotency mechanism
- Rolling up usage from events (not stored counters)
- `FOR UPDATE` locking strategy for quota checks

---

## Phase 3 — Paymob Integration

**What was built:**
- `PaymobService` — API client (createIntention, checkoutUrl, HMAC verification)
- `BillingService` — checkout creation, webhook processing with transaction safety
- `SubscriptionService` — subscription synchronization from provider events
- `PaymentEventRepository` — idempotent event storage
- `BillingController` and `PaymobWebhookController` — HTTP endpoints
- Auth middleware
- Routes and app factory
- Migration 003 (payment_events table, provider column)
- 32 tests across 3 test files (paymob, billing, integration)

**AI assistance:**
- Paymob API research (Unified Checkout, intention flow, HMAC verification)
- HMAC-SHA512 verification implementation (20 fields, lexicographic order, timing-safe)
- Webhook event deduplication strategy
- Subscription synchronization from provider state
- Server-side pricing design
- Test design for checkout, webhook, and security scenarios

**Human decisions:**
- Adapting from Stripe to Paymob (regional requirement)
- Using Paymob Unified Checkout (one-time payment for plan activation)
- Merchant order ID format `tenant_{id}_{plan}_{timestamp}` for tenant resolution
- Webhook HMAC passed as query parameter (Paymob convention)
- Dependency injection refactor for testability

---

## AI Mistakes / Corrections

### Mistake 1: Module-level singleton prevented mocking

**Problem:** The initial `BillingController` created a `BillingService` singleton at module load time:
```javascript
const billingService = new BillingService();
```

This meant `jest.mock` could not intercept `PaymobService` when `app.js` loaded the module tree. Integration tests returned HTTP 500 for all checkout endpoints because the real `PaymobService` was instantiated before the mock was applied.

**Fix:** Refactored to dependency injection — controllers accept optional `billingService` in constructor, routes and app accept optional `billingService` factory parameter. Integration test creates a mock `BillingService` and passes it to `createApp()`.

### Mistake 2: DESIGN.md references Stripe

**Problem:** DESIGN.md was written during Phase 1 planning when the capstone brief specified Stripe. After adapting to Paymob, DESIGN.md was not updated.

**Status:** DESIGN.md is kept as a historical document. README.md, API.md, and EVIDENCE.md are updated to accurately reflect Paymob. DESIGN.md explicitly notes it references the original Stripe design.

### Mistake 3: API.md documented non-existent endpoints

**Problem:** API.md originally documented `POST /generate` and `GET /usage` endpoints. These endpoints were never implemented — `MeterService` and `QuotaService` exist as service classes with unit tests but no HTTP routes or controllers.

**Fix:** API.md updated to document only the 3 actually-implemented HTTP endpoints (`GET /health`, `POST /billing/checkout`, `POST /webhooks/paymob`). The service-layer methods are documented separately with a clear note that they are unit-tested only.

---

## Adaptation Notes

### Stripe → Paymob

The original capstone brief specifies Stripe Test Mode. This project uses Paymob Test Mode because Stripe Payments is not available for the developer's Egyptian account.

**What changed:**
- Payment provider: Stripe → Paymob
- Webhook signature: Stripe Ed25519 → Paymob HMAC-SHA512
- Checkout flow: Stripe Checkout Sessions → Paymob Unified Checkout (v1/intention)
- Webhook body: Stripe event types → Paymob transaction callbacks
- Tenant resolution: Stripe metadata → Paymob merchant_order_id
- Column name: `stripe_subscription_id` → `provider_subscription_id`

**What was preserved:**
- Checkout/payment initiation
- Verified provider callbacks
- Event deduplication
- Subscription synchronization
- Provider state as payment truth
- Server-side pricing
- Transaction-safe state changes

### No Native Subscription API

Paymob does not have a native subscription/recurring billing API equivalent to Stripe Subscriptions. The implementation uses a one-time payment flow for plan activation. This means:
- No automatic recurring billing
- No subscription lifecycle management (cancel, pause, resume)
- Plan renewal requires a new checkout flow

This is documented as a known limitation.

---

## Files Created/Modified

| File | Phase | Purpose |
|------|-------|---------|
| `migrations/001_initial_schema.sql` | 1 | Schema creation |
| `migrations/002_seed.sql` | 1 | Plan and tenant seeding |
| `migrations/003_add_payment_events_and_provider.js` | 3 | Payment events table |
| `src/db/index.js` | 1 | Database connection pool |
| `src/middleware/auth.js` | 3 | Authentication middleware |
| `src/repositories/tenant.repository.js` | 1 | Tenant data access |
| `src/repositories/subscription.repository.js` | 1-3 | Subscription data access |
| `src/repositories/usage.repository.js` | 2 | Usage data access |
| `src/repositories/payment-event.repository.js` | 3 | Payment event data access |
| `src/services/meter.service.js` | 2 | Usage recording and quota enforcement |
| `src/services/quota.service.js` | 2 | Quota checking |
| `src/services/paymob.service.js` | 3 | Paymob API client |
| `src/services/billing.service.js` | 3 | Checkout and webhook processing |
| `src/services/subscription.service.js` | 3 | Subscription synchronization |
| `src/controllers/billing.controller.js` | 3 | Checkout HTTP handler |
| `src/controllers/paymob-webhook.controller.js` | 3 | Webhook HTTP handler |
| `src/routes/billing.routes.js` | 3 | Route definitions |
| `src/app.js` | 3 | Express app factory |
| `src/server.js` | 3 | Server entry point |
| `tests/helpers.js` | 2 | Test utilities |
| `tests/metering/meter.service.test.js` | 2 | Metering unit tests |
| `tests/billing/paymob.service.test.js` | 3 | Paymob service tests |
| `tests/billing/billing.service.test.js` | 3 | Billing service tests |
| `tests/billing/integration.test.js` | 3 | HTTP integration tests |
