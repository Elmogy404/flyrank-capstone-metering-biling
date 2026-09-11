# Build Log

## Phase 1 — Foundation

**Built:** Database schema (plans, tenants, subscriptions, usage_events), seed data (3 plans, demo tenant), multi-tenant model with foreign keys, idempotency constraint.

**AI:** Architecture discussion, schema SQL generation, migration structure, documentation.

**Human:** Plan names/limits, auth mechanism (Bearer = tenant ID), tech choices (Express 5, pg, node-pg-migrate).

---

## Phase 2 — Metering & Quotas

**Built:** MeterService (idempotent recording, concurrency-safe quota enforcement), UsageRepository (monthly aggregation), SubscriptionRepository (FOR UPDATE locking), 11 tests.

**AI:** Idempotency strategy (DB uniqueness as final protection), quota enforcement (SELECT ... FOR UPDATE), test design for concurrent scenarios.

**Human:** DB constraints as primary idempotency, rolling up from events (not stored counters), FOR UPDATE locking.

---

## Phase 3 — Paymob Integration

**Built:** PaymobService (API client, HMAC-SHA512 verification), BillingService (checkout, webhook processing), SubscriptionService (sync from provider events), PaymentEventRepository, controllers, routes, migration 003, 32 tests.

**AI:** Paymob API research, HMAC verification, dedup strategy, subscription sync, server-side pricing, test design.

**Human:** Stripe → Paymob adaptation (regional), one-time payment flow, merchant_order_id format, webhook HMAC as query param, DI refactor for testability.

---

## Phase 4 — Generate & Usage Endpoints + Cost

**Built:** pricing.js (token categories, integer microcent arithmetic, markup), GeneratorService (atomic API_CALL + AI_TOKEN), UsageService (monthly rollup + cost), controllers for POST /billing/generate and GET /billing/usage, migration 004, 50 tests.

**AI:** Pricing design (integer arithmetic), atomic metering strategy, token simulation, cost aggregation from JSONB metadata.

**Human:** Token pricing tiers, 1.5x markup, atomic generation as single operation, simulated tokens, JSONB for breakdown storage.

---

## Phase 5 — MeterService Quota Fix

**Built:** Restructured MeterService quota check to pre-insert validation (`currentUsage + quantity > limit` before INSERT), rewrote meter.service.test.js with 14 tests (exact boundary, one-over, cumulative, rejected-no-persist, concurrent), updated generator.service.test.js to use direct SQL for quota tests, added `--runInBand` to test script.

**AI:** Quota formula fix, test rewrite.

**Human:** Verification of test behavior.

---

## AI Mistakes / Corrections

### Module-level singleton prevented mocking
BillingController created BillingService at module load time. `jest.mock` couldn't intercept PaymobService. Fix: dependency injection.

### DESIGN.md referenced Stripe
Written during Phase 1 planning. After Paymob adaptation, not updated. Status: now updated to reflect Paymob as current provider.

### API.md documented non-existent endpoints
Originally documented `POST /generate` and `GET /usage` without HTTP routes. Fix: updated to actual paths `/billing/generate` and `/billing/usage`.

---

## Adaptation: Stripe → Paymob

Original capstone specifies Stripe Test Mode. Uses Paymob Test Mode (Egypt regional availability).

**Changed:** Provider, webhook signature (Ed25519 → HMAC-SHA512), checkout flow, webhook body, tenant resolution, column name (`stripe_subscription_id` → `provider_subscription_id`).

**Preserved:** Server-side checkout, signed callbacks, event dedup, subscription sync, provider as payment truth, transaction safety.

**Limitation:** Paymob has no native subscription API. One-time payment for plan activation.

---

## Final Audit / Submission Preparation

- Background job: ReconciliationJob with CLI entry point (`npm run reconcile`), retry, failure reporting
- Documentation refactor: all files updated for consistency, reduced duplication
- DESIGN.md updated: Paymob throughout, current API paths, removed QuotaService from diagram
- Dead code removed: QuotaService (never imported)
- Test count: 122 tests across 9 suites
