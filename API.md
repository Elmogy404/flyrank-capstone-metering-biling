# API Contract

## Base URL

```
http://localhost:3000
```

## Authentication

All authenticated endpoints use the following header:

```
Authorization: Bearer <tenant_id>
```

Where `<tenant_id>` is the numeric ID of the tenant. This is a simplified capstone authentication mechanism — not production-grade.

---

## GET /health

Health check endpoint. No authentication required.

### Response (200)

```json
{
  "status": "ok"
}
```

---

## POST /billing/checkout

Initiates a Paymob checkout for the Pro plan. Requires authentication.

### Headers

- `Authorization: Bearer <tenant_id>`
- `Content-Type: application/json`

### Request Body

```json
{
  "plan": "Pro"
}
```

Only `"Pro"` is currently accepted. The amount (50,000 EGP cents = 500 EGP) is determined server-side and cannot be controlled by the client.

### Success Response (200)

```json
{
  "checkoutUrl": "https://accept.paymob.com/unifiedcheckout/?publicKey=...&clientSecret=...",
  "intentionId": "intention_..."
}
```

### Errors

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `plan is required` | Missing plan in request body |
| 401 | `Access token required` | Missing Authorization header |
| 401 | `Invalid token` | Non-integer tenant ID |
| 404 | `Plan not found` | Unknown plan name |
| 404 | `No subscription found` | Tenant has no subscription |
| 409 | `Already subscribed to Pro` | Duplicate subscription |
| 500 | `Internal server error` | Unexpected error |

---

## POST /billing/generate

Atomic billable operation: records API_CALL + AI_TOKEN usage with simulated token generation. Requires authentication.

### Headers

- `Authorization: Bearer <tenant_id>`
- `Content-Type: application/json`

### Request Body

```json
{
  "prompt": "Explain quantum computing in simple terms",
  "model": "gpt-4",
  "idempotency_key": "unique-key-per-request"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `prompt` | Yes | The input prompt for generation |
| `model` | No | Model identifier (default: `gpt-4`) |
| `idempotency_key` | Yes | Unique key per request for deduplication |

**Behavior:**
- Simulates AI token generation (input, cached_input, output, reasoning categories)
- Atomically records both API_CALL and AI_TOKEN usage in a single transaction
- Enforces monthly quota limits for both API calls and AI tokens
- Duplicate idempotency keys return the original result without re-recording

### Success Response (200)

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

### Errors

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `prompt is required` | Missing prompt in request body |
| 400 | `idempotency_key is required` | Missing idempotency key |
| 401 | `Access token required` | Missing Authorization header |
| 401 | `Invalid token` | Non-integer tenant ID |
| 404 | `No active subscription` | Tenant has no active subscription |
| 429 | `Quota exceeded` | Rate limit exceeded (includes type, used, limit) |
| 500 | `Internal server error` | Unexpected error |

---

## GET /billing/usage

Monthly usage summary with cost breakdown. Requires authentication.

### Headers

- `Authorization: Bearer <tenant_id>`

### Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `month` | No | Month number (1-12), defaults to current month |
| `year` | No | Year (e.g. 2026), defaults to current year |

### Success Response (200)

```json
{
  "period": {
    "month": 9,
    "year": 2026
  },
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
    "markup": 1.5,
    "token_pricing": {
      "input": { "cost": 100, "price": 150 },
      "cached_input": { "cost": 10, "price": 15 },
      "output": { "cost": 300, "price": 450 },
      "reasoning": { "cost": 300, "price": 450 }
    }
  }
}
```

**Cost fields:**
- `micro_units` — Total cost in integer microcents (1/100,000 of a cent), client price with markup applied
- `markup` — Markup multiplier applied to raw cost
- `token_pricing` — Per-category pricing reference (cost = raw, price = with markup)

### Errors

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Access token required` | Missing Authorization header |
| 401 | `Invalid token` | Non-integer tenant ID |
| 404 | `No active subscription` | Tenant has no active subscription |
| 500 | `Internal server error` | Unexpected error |

---

## POST /webhooks/paymob

Paymob webhook callback for payment verification. **This endpoint is public** — no authentication is required because Paymob must reach it directly.

### Headers

- `Content-Type: application/json`

### Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `hmac` | Yes | HMAC-SHA512 signature for verification |

### Request Body

Paymob transaction callback payload:

```json
{
  "type": "TRANSACTION",
  "obj": {
    "id": 123456789,
    "pending": false,
    "amount_cents": 50000,
    "success": true,
    "currency": "EGP",
    "integration_id": 5911458,
    "order": {
      "id": 987654321,
      "merchant_order_id": "tenant_1_plan_Pro_1694347200000",
      "amount_cents": 50000,
      "currency": "EGP"
    },
    "source_data": {
      "pan": "2346",
      "type": "card",
      "sub_type": "MasterCard"
    }
  }
}
```

The `merchant_order_id` format is `tenant_{id}_{plan}_{timestamp}` and is used to identify the tenant.

### Success Response (200)

```json
{
  "received": true
}
```

This response is returned for all of the following cases:
- Webhook processed successfully (subscription updated)
- Duplicate event (already processed, safely ignored)
- Cannot determine tenant from merchant_order_id

### Errors

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Invalid signature` | HMAC verification failed |
| 400 | `Invalid payload` | Missing `obj` in request body |
| 500 | `Internal server error` | Unexpected error |

### Security Behavior

- **HMAC verification:** Payload is verified using SHA-512 with 20 fields from the `obj` object, concatenated in lexicographic key order
- **Timing-safe comparison:** Uses `crypto.timingSafeEqual` to prevent timing attacks
- **No database changes on invalid signature:** If HMAC verification fails, the handler returns 400 and no rows are inserted or updated
- **Idempotent:** Duplicate provider events are detected via `UNIQUE(provider, provider_event_id)` constraint and safely ignored (return 200)
- **Transaction-safe:** Subscription updates occur within a PostgreSQL transaction (BEGIN/COMMIT/ROLLBACK)
- **Secrets not exposed:** Paymob credentials are never returned in response bodies or error messages
