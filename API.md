# API Contract

Base URL: `http://localhost:3000`

## Authentication

All authenticated endpoints require:
```
Authorization: Bearer <tenant_id>
```
Where `<tenant_id>` is the numeric tenant ID. Simplified capstone mechanism — not production-grade.

---

## GET /health

No authentication.

**Response 200:**
```json
{ "status": "ok" }
```

---

## POST /billing/checkout

Initiates Paymob checkout for the Pro plan.

**Headers:** `Authorization: Bearer <tenant_id>`, `Content-Type: application/json`

**Request:**
```json
{ "plan": "Pro" }
```

Server determines the amount (50,000 EGP cents). Client input for `amount` or `tenant_id` is ignored.

**Response 200:**
```json
{
  "checkoutUrl": "https://accept.paymob.com/unifiedcheckout/?publicKey=...&clientSecret=...",
  "intentionId": "intention_..."
}
```

| Status | Error | Cause |
|--------|-------|-------|
| 400 | `plan is required` | Missing plan |
| 401 | `Access token required` / `Invalid token` | Auth failure |
| 404 | `Plan not found` / `No subscription found` | Unknown plan or no subscription |
| 409 | `Already subscribed to Pro` | Active Pro subscription |
| 500 | `Internal server error` | Unexpected error |

---

## POST /billing/generate

Atomic billable operation: records API_CALL + AI_TOKEN usage with simulated token generation.

**Headers:** `Authorization: Bearer <tenant_id>`, `Content-Type: application/json`

**Request:**
```json
{
  "prompt": "Explain quantum computing",
  "model": "gpt-4",
  "idempotency_key": "unique-key-per-request"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `prompt` | Yes | Input prompt |
| `model` | No | Model identifier (default: `gpt-4`) |
| `idempotency_key` | Yes | Unique key for deduplication |

**Response 200:**
```json
{
  "recorded": true,
  "usage": {
    "input": 25,
    "cached_input": 7,
    "output": 37,
    "reasoning": 15
  },
  "total_tokens": 84
}
```

Duplicate idempotency keys return `recorded: false` with the original event.

| Status | Error | Cause |
|--------|-------|-------|
| 400 | `prompt is required` / `idempotency_key is required` | Missing fields |
| 401 | `Access token required` / `Invalid token` | Auth failure |
| 404 | `No active subscription` | No active subscription |
| 429 | `Quota exceeded` | Rate limit exceeded (includes type, used, limit) |
| 500 | `Internal server error` | Unexpected error |

---

## GET /billing/usage

Monthly usage summary with cost breakdown.

**Headers:** `Authorization: Bearer <tenant_id>`

**Query Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `month` | No | Month (1-12), defaults to current |
| `year` | No | Year, defaults to current |

**Response 200:**
```json
{
  "period": { "month": 9, "year": 2026 },
  "usage": {
    "api_calls": {
      "used": 42,
      "limit": 10000,
      "remaining": 9958
    },
    "ai_tokens": {
      "used": 15000,
      "limit": 1000000,
      "remaining": 985000,
      "breakdown": {
        "input": 5000,
        "cached_input": 1500,
        "output": 6000,
        "reasoning": 2500
      }
    }
  },
  "cost": {
    "micro_units": 2650000,
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

| Status | Error | Cause |
|--------|-------|-------|
| 400 | `month must be an integer between 1 and 12` / `year must be a positive integer` | Invalid query |
| 401 | `Access token required` / `Invalid token` | Auth failure |
| 404 | `No active subscription` | No active subscription |
| 500 | `Internal server error` | Unexpected error |

---

## POST /webhooks/paymob

Paymob webhook callback. **Public endpoint** — no authentication.

**Query parameter:** `hmac` — HMAC-SHA512 signature.

**Request body:** Paymob transaction callback with `obj` containing transaction details.

**Response 200:**
```json
{ "received": true }
```

Returned for: successful processing, duplicate event, or unresolvable tenant.

**Security behavior:**
- HMAC-SHA512 verified using 20 fields from `obj`, concatenated lexicographically, compared with `crypto.timingSafeEqual`
- Invalid signature → 400, no database changes
- Duplicate events → 200, no reprocessing (`UNIQUE(provider, provider_event_id)`)
- Subscription updates within a database transaction

| Status | Error | Cause |
|--------|-------|-------|
| 400 | `Invalid signature` / `Invalid payload` | HMAC failure or missing `obj` |
| 500 | `Internal server error` | Unexpected error |
