# Demo Guide

Step-by-step reproduction of all acceptance probes.

## Setup

```bash
npm install
cp .env.example .env    # configure DATABASE_URL, PAYMOB keys
npm run migrate
node src/server.js       # http://localhost:3000
```

All examples use `Authorization: Bearer 1` (demo tenant, Free plan: 1K API calls, 100K tokens).

---

## A. Quota Boundary

**Goal:** Exact boundary succeeds, over boundary returns 429, rejected usage not persisted.

```bash
# Fill to 999 of 1000 API calls (use test suite for speed)
# Then exact boundary (1000th):
curl -s -X POST http://localhost:3000/billing/generate \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "boundary", "idempotency_key": "demo-boundary"}'
# → {"recorded": true, ...}

# Over boundary (1001st):
curl -s -w "\nHTTP: %{http_code}\n" -X POST http://localhost:3000/billing/generate \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "over", "idempotency_key": "demo-over"}'
# → HTTP 429
```

**Proven by:** `meter.service.test.js` — boundary tests

---

## B. Idempotency

**Goal:** Same key twice → first records, second returns existing.

```bash
curl -s -X POST http://localhost:3000/billing/generate \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test", "idempotency_key": "demo-idem"}'
# → {"recorded": true, ...}

curl -s -X POST http://localhost:3000/billing/generate \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test", "idempotency_key": "demo-idem"}'
# → {"recorded": false, ...}
```

**Proven by:** `meter.service.test.js`, `integration.test.js`

---

## C. GET /billing/usage

**Goal:** Returns period, usage, limits, remaining, breakdown, cost.

```bash
curl -s http://localhost:3000/billing/usage -H "Authorization: Bearer 1"
```

Returns: `period`, `usage.api_calls.{used,limit,remaining}`, `usage.ai_tokens.{used,limit,remaining,breakdown}`, `cost.{micro_units,markup,token_pricing}`.

**Proven by:** `integration.test.js`, `usage.service.test.js`

---

## D. Paymob Checkout

**Goal:** Server-side pricing, client cannot override.

```bash
# Normal checkout
curl -s -X POST http://localhost:3000/billing/checkout \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"plan": "Pro"}'
# → {"checkoutUrl": "https://accept.paymob.com/...", "intentionId": "..."}

# Client tries to override price (ignored)
curl -s -X POST http://localhost:3000/billing/checkout \
  -H "Authorization: Bearer 1" \
  -H "Content-Type: application/json" \
  -d '{"plan": "Pro", "amount": 1}'
# → Still 200, server uses 50,000 EGP cents
```

**Proven by:** `integration.test.js` — price/tenant tampering tests

---

## E. Verified Webhook

**Goal:** Valid webhook accepted, forged webhook rejected.

```bash
# Forged (invalid HMAC):
curl -s -X POST "http://localhost:3000/webhooks/paymob?hmac=invalid" \
  -H "Content-Type: application/json" \
  -d '{"type":"TRANSACTION","obj":{"id":123,"success":true}}'
# → 400 {"error": "Invalid signature"}
```

Valid webhook requires constructing a payload with correct HMAC-SHA512. The test suite proves this.

**Proven by:** `paymob.service.test.js`, `integration.test.js`

---

## F. Webhook Deduplication

**Goal:** Same event twice → first processed, second deduplicated, 1 row in payment_events.

**Proven by:** `integration.test.js` — "duplicate callback does not create duplicate event rows"

---

## G. Free → Pro Upgrade

1. Tenant starts on Free (seeded)
2. `POST /billing/checkout` → Paymob checkout URL
3. Complete payment in Paymob test dashboard
4. Paymob sends verified webhook
5. Subscription updated to active with Pro limits

**Proven by:** `integration.test.js`, `billing.service.test.js`

---

## Final Validation

```bash
npm test          # 122 tests, 9 suites
npm run reconcile # background job
```
