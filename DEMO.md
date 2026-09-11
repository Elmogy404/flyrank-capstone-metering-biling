# Demo Guide

Step-by-step reproduction of all capstone acceptance probes.

## Prerequisites

```bash
# 1. Start PostgreSQL (ensure it's running on localhost:5432)

# 2. Configure environment
cp .env.example .env
# Edit .env with your PostgreSQL credentials and Paymob test keys

# 3. Install dependencies
npm install

# 4. Run migrations (creates tables + seeds 3 plans + demo tenant)
npm run migrate

# 5. Start the server
node src/server.js
# Server runs on http://localhost:3000
```

## Authentication

All authenticated endpoints use:
```
Authorization: Bearer <tenant_id>
```

The demo tenant created by migration 002 has `tenant_id = 1`.

---

## A. Quota Boundary

**Goal:** Demonstrate exact boundary succeeds, over boundary returns 429, rejected usage is not persisted.

### Step 1: Fill quota to limit (999 of 1000 API calls)

```bash
curl -s -X POST http://localhost:3000/billing/generate \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "fill", "idempotency_key": "demo-fill-1"}'
```

Repeat with keys `demo-fill-2` through `demo-fill-999` (or use the test suite which proves this).

**Proven by test:** `meter.service.test.js` — "succeeds when usage + quantity equals exactly the limit"

### Step 2: Exact boundary succeeds (1000th request)

```bash
curl -s -X POST http://localhost:3000/billing/generate \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "boundary", "idempotency_key": "demo-boundary-ok"}'
```

**Expected:** `{"recorded": true, "usage": {...}, "total_tokens": ...}`

**Proven by test:** `meter.service.test.js` — "succeeds when usage + quantity equals exactly the limit"

### Step 3: Over boundary returns 429

```bash
curl -s -w "\nHTTP_STATUS: %{http_code}\n" -X POST http://localhost:3000/billing/generate \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "over", "idempotency_key": "demo-over-limit"}'
```

**Expected:** HTTP 429 with `{"error": "Quota exceeded", "type": "API_CALL", "used": 1001, "limit": 1000}`

**Proven by test:** `meter.service.test.js` — "rejects one unit over the boundary"

### Step 4: Rejected usage is not persisted

```bash
# Check usage is still exactly 1000
curl -s http://localhost:3000/billing/usage \
  -H "Authorization: Bearer 1"
```

**Expected:** `api_calls.used` is 1000 (not 1001)

**Proven by test:** `meter.service.test.js` — "rejected operation leaves no persisted usage"

---

## B. Idempotency / Retry

**Goal:** Same idempotency key → first records, second returns existing without double-counting.

### Step 1: First request records usage

```bash
curl -s -X POST http://localhost:3000/billing/generate \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "idempotency test", "idempotency_key": "demo-idem-1"}'
```

**Expected:** `{"recorded": true, "usage": {...}, "total_tokens": ...}`

### Step 2: Second request with same key returns existing

```bash
curl -s -X POST http://localhost:3000/billing/generate \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "idempotency test", "idempotency_key": "demo-idem-1"}'
```

**Expected:** `{"recorded": false, "usage": {...}, "total_tokens": ...}`

### Step 3: Verify no double-counting

```bash
curl -s http://localhost:3000/billing/usage \
  -H "Authorization: Bearer 1"
```

**Expected:** `api_calls.used` increased by only 1 (not 2)

**Proven by tests:**
- `integration.test.js` — "duplicate idempotency key returns existing result"
- `meter.service.test.js` — "returns existing event on duplicate idempotency key"

---

## C. GET /billing/usage

**Goal:** Returns period, usage, limits, remaining, breakdown, cost, pricing.

```bash
curl -s http://localhost:3000/billing/usage \
  -H "Authorization: Bearer 1"
```

**Expected response:**
```json
{
  "period": { "month": 9, "year": 2026 },
  "usage": {
    "api_calls": {
      "used": <number>,
      "limit": 1000,
      "remaining": <number>
    },
    "ai_tokens": {
      "used": <number>,
      "limit": 100000,
      "remaining": <number>,
      "breakdown": {
        "input": <number>,
        "cached_input": <number>,
        "output": <number>,
        "reasoning": <number>
      }
    }
  },
  "cost": {
    "micro_units": <number>,
    "markup": { "numerator": 3, "denominator": 2 },
    "token_pricing": {
      "input": { "cost": 100, "price": 150 },
      "cached_input": { "cost": 10, "price": 15 },
      "output": { "cost": 300, "price": 450 },
      "reasoning": { "cost": 300, "price": 450 }
    }
  }
}
```

### Tenant isolation

```bash
# Create a second tenant (via test helper or direct SQL)
# Query usage for tenant 1 — should NOT include tenant 2's usage
curl -s http://localhost:3000/billing/usage \
  -H "Authorization: Bearer 1"
```

**Proven by tests:**
- `integration.test.js` — "authenticated tenant can get usage"
- `integration.test.js` — "reflects usage from generate calls"
- `integration.test.js` — "includes plan limits"
- `integration.test.js` — "calculates remaining quota"
- `integration.test.js` — "includes cost breakdown with pricing info"

---

## D. Paymob Checkout

**Goal:** Authenticated tenant starts checkout, server determines price, client cannot override.

### Step 1: Initiate checkout

```bash
curl -s -X POST http://localhost:3000/billing/checkout \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"plan": "Pro"}'
```

**Expected:**
```json
{
  "checkoutUrl": "https://accept.paymob.com/unifiedcheckout/?publicKey=...&clientSecret=...",
  "intentionId": "intention_..."
}
```

### Step 2: Client cannot control price

```bash
curl -s -X POST http://localhost:3000/billing/checkout \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"plan": "Pro", "amount": 1}'
```

**Expected:** Still returns 200 with correct server-side price (50,000 EGP cents). The `amount: 1` is ignored.

### Step 3: Client cannot control tenant ID

```bash
curl -s -X POST http://localhost:3000/billing/checkout \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"plan": "Pro", "tenant_id": 999}'
```

**Expected:** Still returns 200 for tenant 1. The `tenant_id: 999` is ignored.

**Proven by tests:**
- `integration.test.js` — "authenticated tenant can initiate Pro checkout"
- `integration.test.js` — "client cannot control amount"
- `integration.test.js` — "client cannot control tenant ID"

---

## E. Verified Paymob Webhook

**Goal:** Valid webhook accepted, HMAC verified, forged webhook rejected with 400, no state change.

### Step 1: Valid webhook accepted

This requires constructing a valid Paymob payload with correct HMAC. The test suite proves this:

```bash
# The test constructs a payload with known fields, computes HMAC-SHA512,
# and sends it to POST /webhooks/paymob?hmac=<computed_hmac>
```

**Proven by test:** `integration.test.js` — "valid provider callback is accepted"

### Step 2: Forged webhook rejected

```bash
curl -s -X POST "http://localhost:3000/webhooks/paymob?hmac=invalid_signature" \
  -H "Content-Type: application/json" \
  -d '{"type": "TRANSACTION", "obj": {"id": 123, "success": true}}'
```

**Expected:** HTTP 400 with `{"error": "Invalid signature"}`

### Step 3: Forged webhook causes no state change

```bash
# Check subscription status is unchanged after forged webhook
curl -s http://localhost:3000/billing/usage \
  -H "Authorization: Bearer 1"
```

**Proven by tests:**
- `integration.test.js` — "invalid signature is rejected with 400"
- `integration.test.js` — "forged callback does not change subscription"

---

## F. Paymob Event Deduplication

**Goal:** Same event sent twice → first processed, second deduplicated, 1 row in payment_events.

**Proven by tests:**
- `integration.test.js` — "duplicate callback does not create duplicate event rows"
- `integration.test.js` — "concurrent duplicate webhooks do not double-process"

The test sends the same webhook twice and verifies only 1 row exists in `payment_events` with the matching `provider_event_id`.

---

## G. Free → Pro Upgrade

**Goal:** Complete test-mode upgrade flow.

### Flow

1. Tenant starts on Free plan (seeded by migration 002)
2. `POST /billing/checkout` with `{"plan": "Pro"}` → returns Paymob checkout URL
3. **Manual step:** Complete payment in Paymob test dashboard (or simulate via webhook)
4. Paymob sends verified webhook to `POST /webhooks/paymob`
5. Webhook handler verifies HMAC, deduplicates event, synchronizes subscription
6. Subscription status changes from `pending`/`active` to `active` with Pro plan limits

**Note:** The actual Paymob checkout requires a real Paymob Test Mode dashboard interaction. The webhook processing that follows is fully automated and tested.

**Proven by tests:**
- `integration.test.js` — "successful payment activates Pro subscription"
- `billing.service.test.js` — "activated subscription after successful payment"

---

## Final Test Command

```bash
npm test
```

**Expected result:**
```
Test Suites: 7 passed, 7 total
Tests:       112 passed, 112 total
```
