# FlyRank Usage Metering & Billing Engine

Multi-tenant SaaS backend that meters usage, enforces quotas, calculates costs, and processes payments via Paymob Test Mode.

## Why This Exists

The core engineering challenge is correctness under concurrent requests, retries, quota boundaries, and provider callbacks. Every billable action is idempotent. Quota checks are concurrency-safe. Payment webhooks are HMAC-verified and deduplicated before any state change.

## Features

- Multi-tenant data model with plan-based quotas
- Idempotent usage recording (`UNIQUE(tenant_id, idempotency_key)`)
- Concurrency-safe quota enforcement (`SELECT ... FOR UPDATE`)
- Atomic billable generation: API_CALL + AI_TOKEN in one transaction
- Monthly usage aggregation with cost breakdown
- AI token pricing by category (input, cached_input, output, reasoning)
- Integer microcent arithmetic (no floating point)
- Paymob checkout with server-side pricing
- HMAC-SHA512 webhook verification (timing-safe)
- Payment event deduplication (`UNIQUE(provider, provider_event_id)`)
- Subscription synchronization from verified provider state
- Background reconciliation job (`npm run reconcile`)

**Payment provider:** Paymob Test Mode replaces the original Stripe requirement due to regional availability (Egypt). All architectural goals are preserved: checkout initiation, verified callbacks, event deduplication, subscription sync, provider state as payment truth.

## Architecture

```
Client
  ├─► POST /billing/checkout    → BillingService → PaymobService → Paymob API
  ├─► POST /billing/generate    → GeneratorService → atomic API_CALL + AI_TOKEN
  ├─► GET  /billing/usage       → UsageService → monthly rollup + cost
  ├─► POST /webhooks/paymob     → HMAC verify → dedup → SubscriptionService
  └─► GET  /health              → { status: "ok" }
```

## Data Model

| Table | Purpose |
|-------|---------|
| `plans` | Free / Pro / Premium with API and token limits |
| `tenants` | Multi-tenant accounts |
| `subscriptions` | Tenant plan with provider state |
| `usage_events` | Immutable usage log (source of truth) |
| `payment_events` | Idempotent webhook events |

Key constraints: `UNIQUE(tenant_id, idempotency_key)`, `UNIQUE(provider, provider_event_id)`, `CHECK (quantity > 0)`, `CHECK (type IN ('API_CALL', 'AI_TOKEN'))`.

## Plans

| Plan | API Calls/month | AI Tokens/month |
|------|----------------|-----------------|
| Free | 1,000 | 100,000 |
| Pro | 10,000 | 1,000,000 |
| Premium | 100,000 | 10,000,000 |

Pro checkout: 50,000 EGP cents (500 EGP) via Paymob.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check |
| POST | `/billing/checkout` | Bearer | Initiate Paymob checkout |
| POST | `/billing/generate` | Bearer | Atomic generation + metering |
| GET | `/billing/usage` | Bearer | Monthly usage + cost breakdown |
| POST | `/webhooks/paymob` | HMAC | Verified payment callback |

See [API.md](API.md) for full request/response schemas.

## How It Works

**Metering:** Each `POST /billing/generate` records an `API_CALL` and `AI_TOKEN` event atomically. The idempotency key prevents double-counting on retries.

**Quotas:** Before inserting, the service checks `currentUsage + quantity > plan_limit` within a `SELECT ... FOR UPDATE` transaction. Exceeding returns HTTP 429.

**Cost:** Token costs use integer microcent pricing with configurable markup (NUMERATOR=3, DENOMINATOR=2). No floating point.

**Payments:** Checkout creates a Paymob intention server-side. The client receives a checkout URL. On payment, Paymob sends an HMAC-SHA512 verified webhook. The service deduplicates the event, then synchronizes subscription state.

**Reconciliation:** `npm run reconcile` runs a background job that detects unprocessed payment events and stale pending subscriptions. Exit code 0 = clean, 1 = errors found. Suitable for cron/Task Scheduler.

## Quick Start

```bash
npm install
cp .env.example .env    # configure DATABASE_URL, PAYMOB keys
npm run migrate          # 4 migrations (schema + seed + payment_events + metadata)
npm test                 # 122 tests, 9 suites
npm run reconcile        # background job
node src/server.js       # http://localhost:3000
```

## Authentication

Simplified capstone mechanism: `Authorization: Bearer <tenant_id>`. The token is the numeric tenant ID. Not production-grade. Webhook endpoint uses HMAC-SHA512 instead.

## Limitations

- Paymob Test Mode only (no real payments)
- Simplified auth (token = tenant ID)
- No real AI model calls (simulated tokens)
- No invoicing, proration, or overage billing
- One-time payment flow (Paymob has no native subscription API)
- Reconciliation is detection/reporting only (no automatic repair)

## Tech Stack

Node.js, Express 5, PostgreSQL, pg, node-pg-migrate, axios, Jest, Supertest, CommonJS.

## Further Documentation

- [API.md](API.md) — Full API contract
- [DESIGN.md](DESIGN.md) — Architecture and design decisions
- [DEMO.md](DEMO.md) — Reproducible acceptance probes
- [EVIDENCE.md](EVIDENCE.md) — Requirement evidence matrix
- [BUILDLOG.md](BUILDLOG.md) — Development history
