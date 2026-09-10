# Usage Metering & Billing Engine

Multi-tenant usage metering and billing system with Paymob payment integration.

## Overview

This backend service provides:
- Multi-tenant usage tracking (API calls, AI tokens)
- Monthly usage quotas based on subscription plans
- Idempotent usage recording
- Concurrency-safe metering
- Paymob payment provider integration
- Webhook-based subscription synchronization

## Tech Stack

- Node.js + Express
- PostgreSQL
- pg (node-postgres)
- node-pg-migrate
- Paymob Test Mode (replaced Stripe due to regional availability)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required variables:
- `DATABASE_URL` - PostgreSQL connection string
- `PAYMOB_SECRET_KEY` - Paymob dashboard secret key
- `PAYMOB_PUBLIC_KEY` - Paymob public key for checkout
- `PAYMOB_HMAC_SECRET` - Paymob HMAC secret for webhook verification
- `PAYMOB_INTEGRATION_ID` - Paymob integration ID for payment method
- `APP_URL` - Public URL for webhook callbacks

### 3. Run migrations

```bash
npm run migrate
```

### 4. Start the server

```bash
node src/server.js
```

### 5. Run tests

```bash
npm test
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| POST | /billing/checkout | Initiate Pro checkout (authenticated) |
| POST | /webhooks/paymob | Paymob webhook callback (public) |

## Paymob Integration

### Flow

1. Tenant sends `POST /billing/checkout` with `plan: "Pro"`
2. Server creates Paymob payment intention (amount determined server-side)
3. Returns Paymob Unified Checkout URL
4. Tenant completes payment on Paymob
5. Paymob sends verified webhook to `POST /webhooks/paymob`
6. Server verifies HMAC signature
7. Subscription status is updated atomically

### Security

- Webhook HMAC is verified using SHA-512 before processing
- Amount/plan is determined server-side, never trusted from client
- Tenant ID comes from authenticated token, not request body
- Payment events are idempotent (UNIQUE constraint on provider_event_id)
- Webhook processing is transaction-safe

### Test Mode

This project uses Paymob Test Mode. The integration ID `5911458` is configured for VPC payment method in EGP currency.

## Known Limitations

- No native Paymob Subscription API (one-time payment flow for plan activation)
- Authentication uses simple token-based auth (tenant ID as token)
- No invoice generation or proration

## Database Schema

Key tables:
- `tenants` - Multi-tenant accounts
- `plans` - Subscription plans (Free, Pro, Premium)
- `subscriptions` - Tenant subscriptions with provider state
- `usage_events` - Immutable usage log (source of truth)
- `payment_events` - Idempotent payment webhook events
