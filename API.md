# API Contract

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

---

## POST /webhooks/stripe

Receives Stripe webhook events and synchronizes subscription state.

### Headers

- `Stripe-Signature: <signature>`

### Supported Events

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

### Errors

#### 400 Bad Request

Invalid Stripe signature or malformed webhook.
