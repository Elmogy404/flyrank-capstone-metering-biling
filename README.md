# FlyRank Usage Metering & Billing Engine

Multi-tenant SaaS billing backend with usage metering, quota enforcement, and payment provider integration.

## Overview

This system provides:

- Multi-tenant data model with plan-based quotas
- Idempotent usage recording with concurrency-safe metering
- Monthly quota enforcement for API calls and AI tokens
- Paymob Test Mode checkout and webhook integration
- HMAC-SHA512 verified provider callbacks
- Idempotent webhook event processing with database-level deduplication
- Subscription synchronization from verified provider state
- PostgreSQL persistence with automated migrations

**Engineering goal:** Correctness under retries, quota boundaries, payment callbacks, and concurrent requests.

**Payment provider:** Paymob Test Mode, replacing the Stripe Test Mode requirement from the original capstone due to regional availability (Egypt). The architectural goals are preserved: checkout initiation, verified provider callbacks, event deduplication, subscription synchronization, and provider state as payment truth.

## Features

### Implemented (Phases 1-3)

- Multi-tenant data model (tenants, plans, subscriptions)
- Three plan tiers: Free, Pro, Premium
- API-call and AI-token usage tracking via `usage_events` table
- Idempotent usage recording (`UNIQUE(tenant_id, idempotency_key)`)
- Concurrency-safe quota enforcement (`SELECT ... FOR UPDATE`)
- Monthly usage aggregation from event logs
- Quota exceeded error handling (QuotaExceededError)
- Paymob Unified Checkout (one-time payment for plan activation)
- HMAC-SHA512 webhook signature verification (timing-safe)
- Payment event deduplication (`UNIQUE(provider, provider_event_id)`)
- Subscription synchronization from provider webhook events
- Server-side plan pricing (client cannot control amount or tenant ID)
- PostgreSQL migrations (001 schema, 002 seed, 003 payment_events)
- 43 automated tests across 4 test suites

### Not Implemented (Phase 4 / Stretch)

- Cost calculation / rollup
- AI token pricing rules
- Invoice generation
- Overage billing
- Proration
- Reconciliation jobs
- Alerts

## Architecture

```
Client
  │
  ├─► POST /billing/checkout (authenticated)
  │       │
  │       v
  │   BillingController
  │       │
  │       v
  │   BillingService
  │       │
  │       ├─► PaymobService.createIntention()
  │       │       │
  │       │       v
  │       │   Paymob API (POST /v1/intention/)
  │       │
  │       └─► Returns checkout URL to client
  │
  ├─► POST /webhooks/paymob (public)
  │       │
  │       v
  │   PaymobWebhookController
  │       │
  │       v
  │   BillingService.processWebhook()
  │       │
  │       ├─► HMAC-SHA512 verification
  │       ├─► Event deduplication (payment_events table)
  │       ├─► Tenant ID extracted from merchant_order_id
  │       ├─► Subscription synchronization (DB transaction)
  │       └─► Subscription status updated atomically
  │
  ├─► Usage Metering (service layer, unit-tested)
  │       │
  │       v
  │   MeterService.recordUsage()
  │       │
  │       ├─► Idempotency check (UNIQUE constraint)
  │       ├─► Quota check (SELECT ... FOR UPDATE)
  │       └─► Record usage_event
  │
  └─► GET /health
          │
          v
      { status: "ok" }
```

## Data Model

### Tables

| Table | Purpose |
|-------|---------|
| `plans` | Plan definitions (Free, Pro, Premium) with API/token limits |
| `tenants` | Multi-tenant accounts |
| `subscriptions` | Tenant subscriptions with provider state |
| `usage_events` | Immutable usage log (source of truth) |
| `payment_events` | Idempotent payment webhook events |

### Key Constraints

- `usage_events`: `UNIQUE(tenant_id, idempotency_key)` — prevents duplicate billing
- `usage_events`: `CHECK (type IN ('API_CALL', 'AI_TOKEN'))` — type safety
- `usage_events`: `CHECK (quantity > 0)` — positive quantities only
- `payment_events`: `UNIQUE (provider, provider_event_id)` — idempotent event processing
- `subscriptions`: Foreign keys to `tenants` and `plans`
- Indexes on `(tenant_id, created_at)` and `(provider, provider_event_id)`

### Relationships

```
Tenant 1 ────< Subscription >──── 1 Plan
Tenant 1 ────< UsageEvent
PaymentEvent (standalone, keyed by provider + event ID)
```

## Plans and Quotas

| Plan | API Calls/month | AI Tokens/month |
|------|----------------|-----------------|
| Free | 1,000 | 100,000 |
| Pro | 10,000 | 1,000,000 |
| Premium | 100,000 | 10,000,000 |

Plans are seeded by migration `002_seed.sql`. Pro checkout costs 50,000 EGP cents (500 EGP) via Paymob.

## API Endpoints

### `GET /health`

Health check. No authentication.

```json
{ "status": "ok" }
```

### `POST /billing/checkout`

Initiate Paymob checkout for Pro plan. Requires authentication.

**Headers:**
```
Authorization: Bearer <tenant_id>
Content-Type: application/json
```

**Request:**
```json
{ "plan": "Pro" }
```

**Response (200):**
```json
{
  "checkoutUrl": "https://accept.paymob.com/unifiedcheckout/?publicKey=...&clientSecret=...",
  "intentionId": "intention_..."
}
```

**Errors:**
- `400` — `plan is required`
- `401` — `Access token required` / `Invalid token`
- `404` — `Plan not found` / `No subscription found`
- `409` — `Already subscribed to Pro`
- `500` — `Internal server error`

### `POST /webhooks/paymob`

Paymob webhook callback. **Public endpoint** — no authentication (Paymob must reach it directly).

**Query parameter:** `hmac` — HMAC-SHA512 signature for verification.

**Request body:** Paymob transaction callback payload with `obj` containing transaction details.

**Response (200):**
```json
{ "received": true }
```

**Errors:**
- `400` — `Invalid signature` (HMAC verification failed) / `Invalid payload` (missing `obj`)
- `500` — `Internal server error`

**Behavior:**
- Invalid HMAC signatures are rejected with 400; no database changes occur
- Duplicate events are idempotent (return 200 without reprocessing)
- Webhook processing is transaction-safe (BEGIN/COMMIT/ROLLBACK)

See [API.md](API.md) for full request/response schemas.

## Authentication

The current authentication mechanism is a simplified capstone implementation:

```
Authorization: Bearer <tenant_id>
```

The token is parsed as an integer tenant ID and looked up in the `tenants` table. This is **not production-grade authentication** — it is a simplified mechanism for the capstone to isolate tenant data.

**Important:** The webhook endpoint (`POST /webhooks/paymob`) does not use this authentication. It is verified by HMAC-SHA512 signature instead.

## Webhook Security

The webhook endpoint implements multiple security layers:

1. **HMAC-SHA512 verification** — Payload is verified using 20 fields from the transaction object, concatenated in lexicographic key order
2. **Timing-safe comparison** — Uses `crypto.timingSafeEqual` to prevent timing attacks
3. **Event deduplication** — `UNIQUE(provider, provider_event_id)` constraint prevents duplicate processing
4. **Transaction safety** — Subscription updates occur within a database transaction
5. **Server-side tenant resolution** — Tenant ID is extracted from `merchant_order_id`, not trusted from client
6. **Server-side pricing** — Plan and amount are determined server-side; client input is ignored

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `PAYMOB_SECRET_KEY` | Paymob dashboard secret key |
| `PAYMOB_PUBLIC_KEY` | Paymob public key for checkout URL |
| `PAYMOB_HMAC_SECRET` | Paymob HMAC secret for webhook verification |
| `PAYMOB_INTEGRATION_ID` | Paymob integration ID (VPC, EGP) |
| `APP_URL` | Public URL for webhook callbacks (default: `http://localhost:3000`) |
| `PORT` | Server port (default: `3000`) |

## Running the Project

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your PostgreSQL and Paymob credentials
```

### 3. Run migrations

```bash
npm run migrate
```

This runs all three migrations:
- `001_initial_schema.sql` — Creates tables (plans, tenants, subscriptions, usage_events)
- `002_seed.sql` — Seeds plan data and demo tenant
- `003_add_payment_events_and_provider.js` — Adds `payment_events` table and `provider` column

### 4. Start the server

```bash
node src/server.js
```

Server runs on `http://localhost:3000` by default.

### 5. Run tests

```bash
npm test
```

Expected result: **43 tests passed across 4 test suites.**

## Testing

Tests are organized into 4 suites:

| Suite | File | Tests | Coverage |
|-------|------|-------|----------|
| Metering | `tests/metering/meter.service.test.js` | 9 | Usage recording, idempotency, quota enforcement, concurrency, tenant isolation |
| Paymob | `tests/billing/paymob.service.test.js` | 6 | HMAC verification, checkout URL generation |
| Billing | `tests/billing/billing.service.test.js` | 12 | Checkout creation, webhook processing, deduplication, subscription sync, tenant isolation, concurrency, security |
| Integration | `tests/billing/integration.test.js` | 16 | HTTP endpoint tests for checkout and webhook, auth, error handling, tenant isolation, concurrency, security |

### Test Categories

- **Idempotency** — Duplicate idempotency keys return original event; duplicate webhook events are ignored
- **Quota boundaries** — Usage within limit allowed; usage at exact limit allowed; usage exceeding limit rejected
- **Concurrency** — Concurrent duplicate requests produce one event; concurrent quota competition respects limits
- **HMAC verification** — Valid HMAC accepted; invalid/tampered/forged HMAC rejected
- **Checkout** — Authenticated checkout works; unauthenticated rejected; unknown plan rejected; client cannot control amount or tenant ID
- **Webhook processing** — Valid webhook accepted; invalid signature rejected; forged callback rejected; duplicate webhook deduplicated
- **Subscription sync** — Successful payment activates subscription; failed payment marks expired
- **Tenant isolation** — Usage, subscriptions, and webhooks are scoped to individual tenants
- **Security** — Invalid webhooks cannot upgrade tenants; secrets not exposed in responses

## Limitations

### Current Limitations

- **Paymob Test Mode only** — No real payment processing; uses Paymob's test environment
- **Simplified authentication** — Token is a plain tenant ID, not a secure JWT or session token
- **No `/generate` or `/usage` HTTP endpoints** — MeterService and QuotaService exist as service classes with unit tests, but are not wired into HTTP routes
- **No real AI model calls** — AI token quantities are simulated values, not actual model usage
- **No Phase 4 cost calculation** — No pricing rules, cost rollups, or billing calculations
- **No invoicing** — No invoice generation or PDF creation
- **No proration** — Plan changes are not prorated
- **No overage billing** — Quota exceeded returns an error; no overage charges
- **No reconciliation jobs** — No automated reconciliation of provider state
- **One-time payment flow** — Paymob does not have a native subscription API; checkout is a one-time payment for plan activation

### What Phase 4 Would Add

- Cost calculation and pricing rules
- AI token pricing by category (input, output, cached, reasoning)
- Invoice generation
- Overage billing
- Monthly cost rollups
- Reconciliation jobs
- Alerts

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express 5
- **Database:** PostgreSQL
- **DB Driver:** pg (node-postgres)
- **Migrations:** node-pg-migrate
- **HTTP Client:** axios
- **Testing:** Jest + Supertest
- **Payment:** Paymob Test Mode (Unified Checkout API)
- **Module System:** CommonJS
