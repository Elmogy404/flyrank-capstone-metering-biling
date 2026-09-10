# API Contract

## POST /billing/checkout

Initiates a Pro subscription checkout with Paymob.

### Headers

- `Authorization: Bearer <tenant_id>`
- `Content-Type: application/json`

### Request Body

```json
{
  "plan": "Pro"
}
```

### Success Response (200)

```json
{
  "checkoutUrl": "https://accept.paymob.com/unifiedcheckout/?publicKey=...&clientSecret=...",
  "intentionId": "intention_123"
}
```

### Errors

#### 400 Bad Request

Missing or invalid request body.

```json
{
  "error": "plan is required"
}
```

#### 401 Unauthorized

Missing or invalid authentication token.

```json
{
  "error": "Access token required"
}
```

#### 404 Not Found

Plan not found or no subscription for tenant.

```json
{
  "error": "Plan not found"
}
```

#### 409 Conflict

Tenant already subscribed to the requested plan.

```json
{
  "error": "Already subscribed to Pro"
}
```

---

## POST /webhooks/paymob

Paymob webhook callback for payment verification. This endpoint is public (no authentication required).

### Headers

- `Content-Type: application/json`

### Query Parameters

- `hmac` - HMAC signature for verification

### Request Body

Paymob transaction callback payload containing:
- `type` - Event type (e.g., "TRANSACTION")
- `obj` - Transaction object with payment details

### Success Response (200)

```json
{
  "received": true
}
```

### Errors

#### 400 Bad Request

Invalid HMAC signature or malformed payload.

```json
{
  "error": "Invalid signature"
}
```

### Security Notes

- HMAC is verified using SHA-512 before any processing
- Invalid signatures are rejected with 400 and no database changes occur
- Duplicate events are handled idempotently (return 200 without reprocessing)
- Webhook processing is transaction-safe

---

## POST /generate

Billable endpoint that simulates an AI generation request.

### Headers

- `Authorization: Bearer <token>`
- `Idempotency-Key: <unique-key>`

### Request Body

```json
{
  "prompt": "Explain REST APIs"
}
```

### Success Response

```json
{
  "message": "Generation completed",
  "result": "Dummy generated response",
  "usage": {
    "api_calls": 1,
    "ai_tokens": 150
  }
}
```

### Errors

#### 400 Bad Request

Invalid request body or missing required fields.

#### 401 Unauthorized

Authentication is required or invalid.

#### 402 Payment Required

The tenant must upgrade or activate a valid subscription.

#### 429 Too Many Requests

The tenant has exceeded the usage quota.

---

## GET /usage

Returns the tenant's current monthly usage.

### Headers

- `Authorization: Bearer <token>`

### Success Response

```json
{
  "period": "2026-09",
  "usage": {
    "api_calls": {
      "used": 25,
      "limit": 1000
    },
    "ai_tokens": {
      "used": 3500,
      "limit": 100000
    }
  }
}
```

### Errors

#### 401 Unauthorized

Authentication is required or invalid.
