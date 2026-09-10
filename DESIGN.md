# Usage Metering & Billing Engine — Design

## 1. Problem

The system is a backend service responsible for:
- Tracking tenant usage.
- Enforcing monthly usage quotas based on subscription plans.
- Calculating usage costs.
- Synchronizing subscription state with Stripe.
- Preventing duplicate usage records when requests are retried.

The core scope contains two plans (Free / Pro) and two usage types (API calls / AI tokens). AI usage is simulated; no real AI model integration is required.

## 2. Scope

### Core features
1. Multi-tenant usage tracking.
2. Monthly API-call and AI-token quotas.
3. Idempotent usage recording.
4. Quota enforcement.
5. Monthly usage and cost rollups.
6. AI token cost calculation.
7. Stripe Test Mode Checkout.
8. Stripe webhook verification and deduplication.
9. Subscription/plan synchronization.

### Non-goals
- Real AI model integration.
- Real payments.
- Invoicing.
- Proration.
- Overage billing.

## 3. Data Model

Core tables:
- `tenants`
- `plans`
- `subscriptions`
- `usage_events`

Relationships:

```text
Tenant 1 ────< Subscription >──── 1 Plan
Tenant 1 ────< UsageEvent
```

### `tenants`
```text
id
name
email
hashed_password
status
created_at
updated_at
```

### `plans`
```text
id
name
api_calls_limit
ai_tokens_limit
created_at
```

### `subscriptions`
```text
id
tenant_id
plan_id
status
stripe_subscription_id
started_at
ended_at
created_at
updated_at
```

### `usage_events`
```text
id
tenant_id
type
quantity
idempotency_key
created_at
```

Top-level usage types:
```text
API_CALL
AI_TOKEN
```

`quantity` is an integer. `idempotency_key` is required and scoped to the tenant.

## 4. Usage Model

`usage_events` is the source of truth for usage.

Usage is rolled up from events for the current billing month:

```text
usage_events
     │
     │ monthly aggregation
     ▼
used / limit / cost
```

API/token counters are not stored as the primary usage state in `subscriptions`.

## 5. Architecture

```text
                    ┌──────────────┐
                    │    Client    │
                    └──────┬───────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │   HTTP / API    │
                  │ Routes          │
                  │ Controllers     │
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │    Services     │
                  │                 │
                  │ MeterService    │
                  │ QuotaService    │
                  │ BillingService  │
                  │ StripeService   │
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │  Data / DB      │
                  │ Repositories    │
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │   PostgreSQL    │
                  └─────────────────┘
```

Stripe payment synchronization:

```text
                 Stripe
                   │
             signed webhook
                   │
                   ▼
          /webhooks/stripe
                   │
                   ▼
          StripeService
                   │
                   ▼
             PostgreSQL
```

## 6. API Surface

```text
POST /generate
GET  /usage
POST /webhooks/stripe
```

### `POST /generate`

Dummy billable endpoint.

High-level flow:

```text
Validate request
      ↓
Identify tenant
      ↓
Check idempotency
      ↓
Check quota
      ↓
Record usage
      ↓
Calculate relevant cost
      ↓
Return result
```

AI token usage is simulated.

### `GET /usage`

Returns the tenant's current monthly:
- used
- limit
- cost

for supported usage types.

### `POST /webhooks/stripe`

Required events:
```text
checkout.session.completed
customer.subscription.updated
customer.subscription.deleted
```

Flow:
```text
Stripe
  ↓
Verify signature
  ↓
Check event deduplication
  ↓
Process event
  ↓
Update subscription / plan
```

## 7. Idempotency Strategy

Every billable request must provide an `Idempotency-Key`.

Database uniqueness will enforce:

```text
UNIQUE(tenant_id, idempotency_key)
```

The application will recognize duplicate requests and return the original result without recording usage again.

The database constraint is the final protection against concurrent duplicate requests.

## 8. Quota Strategy

```text
current usage + requested usage
              │
              ▼
        compare with limit
              │
        ┌─────┴─────┐
        │           │
      allowed     exceeded
        │           │
        ▼           ▼
    record       reject
    usage        429 / 402
```

The concurrency-safe implementation will be designed during Phase 2.

## 9. Cost Model

Normal API usage:
```text
API calls → configured price
```

AI pricing categories:
```text
input tokens
cached input tokens
output tokens
reasoning tokens
```

These are pricing categories, not top-level usage types.

Top-level usage types remain:
```text
API_CALL
AI_TOKEN
```

Money will use integer monetary units rather than floating-point values.

## 10. Architecture Invariants

1. Every usage event belongs to exactly one tenant.
2. Tenants cannot access another tenant's usage.
3. Usage events are the source of truth for usage.
4. The same billable operation must not be counted twice.
5. Database constraints protect against duplicate idempotency keys.
6. Quota checks must be concurrency-safe.
7. Money uses integer units.
8. Stripe webhook signatures must be verified.
9. Stripe events must be processed idempotently.
10. Stripe is the payment source of truth; PostgreSQL mirrors verified subscription events.
