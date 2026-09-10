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

Or if the token is not a valid integer:

```json
{
  "error": "Invalid token"
}
```

#### 404 Not Found

Plan not found or no subscription exists for the tenant.

```json
{
  "error": "Plan not found"
}
```

Or:

```json
{
  "error": "No subscription found"
}
```

#### 409 Conflict

Tenant is already subscribed to the requested plan.

```json
{
  "error": "Already subscribed to Pro"
}
```

#### 500 Internal Server Error

```json
{
  "error": "Internal server error"
}
```

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
    },
    ...
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

#### 400 Bad Request

Invalid HMAC signature or malformed payload.

```json
{
  "error": "Invalid signature"
}
```

Or:

```json
{
  "error": "Invalid payload"
}
```

#### 500 Internal Server Error

```json
{
  "error": "Internal server error"
}
```

### Security Behavior

- **HMAC verification:** Payload is verified using SHA-512 with 20 fields from the `obj` object, concatenated in lexicographic key order
- **Timing-safe comparison:** Uses `crypto.timingSafeEqual` to prevent timing attacks
- **No database changes on invalid signature:** If HMAC verification fails, the handler returns 400 and no rows are inserted or updated
- **Idempotent:** Duplicate provider events are detected via `UNIQUE(provider, provider_event_id)` constraint and safely ignored (return 200)
- **Transaction-safe:** Subscription updates occur within a PostgreSQL transaction (BEGIN/COMMIT/ROLLBACK)
- **Secrets not exposed:** Paymob credentials are never returned in response bodies or error messages

---

## Service Layer Endpoints (Unit-Tested, No HTTP Routes)

The following services exist and are tested via unit tests but are **not exposed as HTTP endpoints**:

### MeterService.recordUsage()

Records a billable usage event. Tested in `tests/metering/meter.service.test.js`.

```javascript
meterService.recordUsage({
  tenantId: 1,
  type: "API_CALL",    // or "AI_TOKEN"
  quantity: 1,
  idempotencyKey: "unique-key-per-tenant"
})
// Returns: { recorded: true/false, event: {...} }
```

### MeterService.getMonthlyUsage()

Returns monthly usage aggregation. Tested in `tests/metering/meter.service.test.js`.

```javascript
meterService.getMonthlyUsage(tenantId, period)
// Returns: { API_CALL: { used: N }, AI_TOKEN: { used: N } }
```

### QuotaService.checkQuota()

Checks if usage is within plan limits. Tested indirectly through MeterService tests.

```javascript
quotaService.checkQuota(tenantId, "API_CALL", quantity)
// Returns: { allowed: true, currentUsage, limit, projected }
// Throws: QuotaExceededError if exceeded
```

These services are included in the codebase and tested but not wired to HTTP routes. See README.md limitations section.
