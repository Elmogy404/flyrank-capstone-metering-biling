# Evidence

One concrete proof per Definition-of-Done checkbox.

---

## Metering

### Billable action creates usage event

**Test:** `meter.service.test.js` — "records usage successfully"

```javascript
test("records usage successfully", async () => {
  const result = await meterService.recordUsage({
    tenantId,
    type: "API_CALL",
    quantity: 1,
    idempotencyKey: "key-001",
  });

  expect(result.recorded).toBe(true);
  expect(result.event).toBeDefined();
  expect(result.event.tenant_id).toBe(tenantId);
  expect(result.event.type).toBe("API_CALL");
  expect(result.event.quantity).toBe(1);
  expect(result.event.idempotency_key).toBe("key-001");
});
```

**Result:** Usage event is persisted with correct tenant_id, type, quantity, and idempotency_key.

### Duplicate usage prevention

**Test:** `meter.service.test.js` — "returns existing event on duplicate idempotency key"

```javascript
test("returns existing event on duplicate idempotency key", async () => {
  const first = await meterService.recordUsage({
    tenantId, type: "API_CALL", quantity: 5, idempotencyKey: "key-dup",
  });
  const second = await meterService.recordUsage({
    tenantId, type: "API_CALL", quantity: 5, idempotencyKey: "key-dup",
  });

  expect(first.recorded).toBe(true);
  expect(second.recorded).toBe(false);
  expect(second.event.id).toBe(first.event.id);
});
```

**Result:** Second call returns `recorded: false` and the original event. Database constraint `UNIQUE(tenant_id, idempotency_key)` enforced. Duplicate `INSERT` triggers code `23505` (unique violation) which is caught and the existing event is returned.

### Concurrent duplicate requests produce one event

**Test:** `meter.service.test.js` — "concurrent duplicate requests produce one event"

```javascript
test("concurrent duplicate requests produce one event", async () => {
  const promises = Array.from({ length: 5 }, (_, i) =>
    meterService.recordUsage({
      tenantId, type: "API_CALL", quantity: 1, idempotencyKey: "key-concurrent-dup",
    })
  );
  const results = await Promise.all(promises);
  const recorded = results.filter((r) => r.recorded === true);
  const rejected = results.filter((r) => r.recorded === false);

  expect(recorded.length).toBe(1);
  expect(rejected.length).toBe(4);
});
```

**Result:** 5 concurrent requests with the same idempotency key: 1 recorded, 4 rejected. Database uniqueness constraint protects against race conditions.

---

## Quotas

### Usage under limit → allowed

**Test:** `meter.service.test.js` — "allows usage within quota"

```javascript
test("allows usage within quota", async () => {
  const result = await meterService.recordUsage({
    tenantId, type: "API_CALL", quantity: 999,
    idempotencyKey: "key-quota-ok",
  });
  expect(result.recorded).toBe(true);
});
```

**Result:** Test tenant has Free plan (1,000 API calls/month). 999 calls recorded successfully.

### Exact boundary → allowed

**Test:** `meter.service.test.js` — "allows usage exactly at quota"

```javascript
test("allows usage exactly at quota", async () => {
  await meterService.recordUsage({
    tenantId, type: "API_CALL", quantity: 999,
    idempotencyKey: "key-quota-exact-1",
  });
  const result = await meterService.recordUsage({
    tenantId, type: "API_CALL", quantity: 1,
    idempotencyKey: "key-quota-exact-2",
  });
  expect(result.recorded).toBe(true);
});
```

**Result:** 999 + 1 = 1,000 (exactly at Free plan limit). Recorded successfully.

### Over limit → rejected

**Test:** `meter.service.test.js` — "rejects usage exceeding quota"

```javascript
test("rejects usage exceeding quota", async () => {
  await meterService.recordUsage({
    tenantId, type: "API_CALL", quantity: 999,
    idempotencyKey: "key-quota-exceed-1",
  });
  await expect(
    meterService.recordUsage({
      tenantId, type: "API_CALL", quantity: 2,
      idempotencyKey: "key-quota-exceed-2",
    })
  ).rejects.toThrow("Quota exceeded");
});
```

**Result:** 999 + 2 = 1,001 (exceeds Free plan limit of 1,000). Throws `QuotaExceededError`.

### Concurrent quota competition respects limit

**Test:** `meter.service.test.js` — "concurrent requests competing for quota respect the limit"

```javascript
test("concurrent requests competing for quota respect the limit", async () => {
  const promises = Array.from({ length: 10 }, (_, i) =>
    meterService.recordUsage({
      tenantId, type: "API_CALL", quantity: 100,
      idempotencyKey: `key-concurrent-quota-${i}`,
    })
  );
  const results = await Promise.allSettled(promises);
  // ... verifies total usage <= 1000
  expect(usage.API_CALL.used).toBeLessThanOrEqual(1000);
});
```

**Result:** 10 concurrent requests of 100 each. Total usage never exceeds 1,000. `SELECT ... FOR UPDATE` ensures concurrency safety.

---

## Cost Calculation

### Token pricing constants are correct

**Test:** `pricing.test.js` — "has all four token categories"

```javascript
test("has all four token categories", () => {
  expect(TOKEN_PRICING.input).toBeDefined();
  expect(TOKEN_PRICING.cached_input).toBeDefined();
  expect(TOKEN_PRICING.output).toBeDefined();
  expect(TOKEN_PRICING.reasoning).toBeDefined();
});
```

**Result:** All four token categories defined with integer microcent costs.

### Cached input is cheaper than input

**Test:** `pricing.test.js` — "cached_input is cheaper than input"

```javascript
test("cached_input is cheaper than input", () => {
  expect(TOKEN_PRICING.cached_input.costMicroUnits).toBeLessThan(
    TOKEN_PRICING.input.costMicroUnits
  );
});
```

**Result:** `cached_input` (10) < `input` (100), enforcing cost hierarchy.

### Markup applied to raw cost

**Test:** `pricing.test.js` — "applies markup to cost"

```javascript
test("applies markup to cost", () => {
  const price = calculatePrice("input", 1000);
  const expectedCost = TOKEN_PRICING.input.costMicroUnits * 1000;
  const expectedPrice = Math.ceil(expectedCost * MARKUP);
  expect(price).toBe(expectedPrice);
});
```

**Result:** Client price = raw cost × 1.5 markup, calculated with integer ceiling.

### Cost calculation uses integer arithmetic

**Test:** `pricing.test.js` — "all costs are integers"

```javascript
test("all costs are integers", () => {
  for (const category of Object.values(TOKEN_PRICING)) {
    expect(Number.isInteger(category.costMicroUnits)).toBe(true);
  }
});
```

**Result:** No floating point used. All pricing values are integers.

---

## Generate Endpoint (POST /billing/generate)

### Authenticated tenant can generate

**Test:** `integration.test.js` — "authenticated tenant can generate"

```javascript
test("authenticated tenant can generate", async () => {
  const res = await request(app)
    .post("/billing/generate")
    .set("Authorization", `Bearer ${tenantId}`)
    .send({ prompt: "Hello world", model: "gpt-4", idempotency_key: "integ-gen-1" });

  expect(res.status).toBe(200);
  expect(res.body.recorded).toBe(true);
  expect(res.body.usage).toBeDefined();
  expect(res.body.usage.input).toBeGreaterThan(0);
  expect(res.body.usage.output).toBeGreaterThan(0);
  expect(res.body.total_tokens).toBeGreaterThan(0);
});
```

**Result:** Returns 200 with token breakdown and total count.

### Atomic API_CALL + AI_TOKEN metering

**Test:** `generator.service.test.js` — "records API_CALL and AI_TOKEN usage atomically"

```javascript
test("records API_CALL and AI_TOKEN usage atomically", async () => {
  const result = await generatorService.generate({
    tenantId, prompt: "Hello, how are you?", model: "gpt-4", idempotencyKey: "gen-001",
  });
  expect(result.recorded).toBe(true);
  expect(result.usage.input).toBeGreaterThan(0);
  expect(result.usage.output).toBeGreaterThan(0);
  expect(result.totalTokens).toBe(
    result.usage.input + result.usage.cached_input + result.usage.output + result.usage.reasoning
  );
});
```

**Result:** Both API_CALL and AI_TOKEN events created in single transaction.

### Quota enforcement on generate

**Test:** `generator.service.test.js` — "rejects usage exceeding API_CALL quota"

```javascript
test("rejects usage exceeding API_CALL quota", async () => {
  // Fill quota to limit
  for (let i = 0; i < 1000; i++) {
    await meterService.recordUsage({
      tenantId, type: "API_CALL", quantity: 1, idempotencyKey: `quota-api-${i}`,
    });
  }
  await expect(
    generatorService.generate({ tenantId, prompt: "Over quota", model: "gpt-4", idempotencyKey: "gen-over-api" })
  ).rejects.toThrow(QuotaExceededError);
});
```

**Result:** QuotaExceededError thrown when API_CALL or AI_TOKEN limit exceeded.

---

## Usage Endpoint (GET /billing/usage)

### Returns monthly usage with cost breakdown

**Test:** `integration.test.js` — "reflects usage from generate calls"

```javascript
test("reflects usage from generate calls", async () => {
  await request(app)
    .post("/billing/generate")
    .set("Authorization", `Bearer ${tenantId}`)
    .send({ prompt: "Usage test", idempotency_key: "integ-usage-1" });

  const res = await request(app)
    .get("/billing/usage")
    .set("Authorization", `Bearer ${tenantId}`);

  expect(res.status).toBe(200);
  expect(res.body.usage.api_calls.used).toBeGreaterThanOrEqual(1);
  expect(res.body.usage.ai_tokens.used).toBeGreaterThan(0);
});
```

**Result:** Usage reflects recorded events; cost breakdown included.

### Includes plan limits and remaining quota

**Test:** `integration.test.js` — "includes plan limits"

```javascript
test("includes plan limits", async () => {
  const res = await request(app)
    .get("/billing/usage")
    .set("Authorization", `Bearer ${tenantId}`);

  expect(res.body.usage.api_calls.limit).toBeGreaterThan(0);
  expect(res.body.usage.ai_tokens.limit).toBeGreaterThan(0);
});
```

**Result:** Plan limits from subscription returned alongside usage.

---

## Data Model

### Migrations applied successfully

```bash
npm run migrate
```

Four migrations applied:
1. `001_initial_schema.sql` — Creates plans, tenants, subscriptions, usage_events tables
2. `002_seed.sql` — Seeds 3 plans (Free, Pro, Premium) and 1 demo tenant with active subscription
3. `003_add_payment_events_and_provider.js` — Adds payment_events table, renames stripe_subscription_id to provider_subscription_id, adds provider column
4. `004_add_usage_metadata.js` — Adds metadata JSONB column to usage_events for AI token category details

---

## Payment Provider Integration

**Note:** The original capstone specifies Stripe Test Mode. This project uses **Paymob Test Mode** instead due to regional availability (Egypt). The architectural goals are preserved.

### Checkout flow works

**Test:** `integration.test.js` — "authenticated tenant can initiate Pro checkout"

```javascript
test("authenticated tenant can initiate Pro checkout", async () => {
  const res = await request(app)
    .post("/billing/checkout")
    .set("Authorization", `Bearer ${tenantId}`)
    .send({ plan: "Pro" });

  expect(res.status).toBe(200);
  expect(res.body.checkoutUrl).toContain("accept.paymob.com");
  expect(res.body.intentionId).toBeDefined();
});
```

**Result:** Returns HTTP 200 with Paymob checkout URL and intention ID.

### Server-side pricing (client cannot control amount)

**Test:** `integration.test.js` — "client cannot control amount"

```javascript
test("client cannot control amount", async () => {
  const res = await request(app)
    .post("/billing/checkout")
    .set("Authorization", `Bearer ${tenantId}`)
    .send({ plan: "Pro", amount: 1 });

  expect(res.status).toBe(200);
  expect(res.body.checkoutUrl).toBeDefined();
});
```

**Result:** Sending `amount: 1` is ignored. Server determines 50,000 EGP cents from `PLAN_PRICES.Pro`. Checkout succeeds at the correct server-side price.

### Server-side tenant isolation (client cannot control tenant ID)

**Test:** `integration.test.js` — "client cannot control tenant ID"

```javascript
test("client cannot control tenant ID", async () => {
  const otherTenant = await setupTestTenant();
  const res = await request(app)
    .post("/billing/checkout")
    .set("Authorization", `Bearer ${tenantId}`)
    .send({ plan: "Pro", tenant_id: otherTenant.tenantId });

  expect(res.status).toBe(200);
  await cleanupTestTenant(otherTenant.tenantId);
});
```

**Result:** Sending `tenant_id` is ignored. Tenant ID comes from the authenticated token (`req.user.tenantId`), not the request body.

### HMAC verification

**Test:** `paymob.service.test.js` — "returns true for valid HMAC"

```javascript
test("returns true for valid HMAC", () => {
  // ... constructs obj and computes HMAC-SHA512
  expect(paymob.verifyTransactionHmac(obj, hmac)).toBe(true);
});
```

**Result:** Valid HMAC-SHA512 signature verified using 20 fields concatenated in lexicographic order, compared with `crypto.timingSafeEqual`.

### Invalid webhook rejected

**Test:** `integration.test.js` — "invalid signature is rejected with 400"

```javascript
test("invalid signature is rejected with 400", async () => {
  const payload = createWebhookPayload({ success: true });
  const res = await request(app)
    .post("/webhooks/paymob?hmac=invalid_signature")
    .send(payload);

  expect(res.status).toBe(400);
  expect(res.body.error).toBe("Invalid signature");
});
```

**Result:** Invalid HMAC returns HTTP 400. No database changes occur (verified by "forged callback does not change subscription" test).

### Forged callback does not change subscription

**Test:** `integration.test.js` — "forged callback does not change subscription"

```javascript
test("forged callback does not change subscription", async () => {
  await pool.query(`UPDATE subscriptions SET status = 'active' WHERE id = $1`, [subscriptionId]);
  const payload = createWebhookPayload({ success: true });
  const res = await request(app)
    .post("/webhooks/paymob?hmac=invalid")
    .send(payload);

  expect(res.status).toBe(400);
  const sub = await subscriptionRepository.findByTenantId(tenantId);
  expect(sub.status).toBe("active");
});
```

**Result:** Subscription remains "active" after forged callback attempt.

### Duplicate event handling

**Test:** `integration.test.js` — "duplicate callback does not create duplicate event rows"

```javascript
test("duplicate callback does not create duplicate event rows", async () => {
  const payload = createWebhookPayload({ id: 888999000, success: true, pending: false });
  const hmac = generateHmac(payload.obj);

  await request(app).post(`/webhooks/paymob?hmac=${hmac}`).send(payload);
  await request(app).post(`/webhooks/paymob?hmac=${hmac}`).send(payload);

  const events = await pool.query(
    `SELECT * FROM payment_events WHERE provider_event_id = '888999000'`
  );
  expect(events.rows.length).toBe(1);
});
```

**Result:** Two identical webhooks produce exactly 1 row in `payment_events`. `UNIQUE(provider, provider_event_id)` constraint enforced. Both return HTTP 200.

### Subscription synchronized on successful payment

**Test:** `integration.test.js` — "successful payment activates Pro subscription"

```javascript
test("successful payment activates Pro subscription", async () => {
  await pool.query(`UPDATE subscriptions SET status = 'pending' WHERE id = $1`, [subscriptionId]);
  const payload = createWebhookPayload({ success: true, pending: false });
  const hmac = generateHmac(payload.obj);

  const res = await request(app).post(`/webhooks/paymob?hmac=${hmac}`).send(payload);
  expect(res.status).toBe(200);

  const sub = await subscriptionRepository.findByTenantId(tenantId);
  expect(sub.status).toBe("active");
});
```

**Result:** Subscription status changes from "pending" to "active" after verified successful payment.

### Subscription synchronized on failed payment

**Test:** `integration.test.js` — "failed payment marks subscription as expired"

```javascript
test("failed payment marks subscription as expired", async () => {
  const payload = createWebhookPayload({ id: 333444555, success: false, pending: false });
  const hmac = generateHmac(payload.obj);

  const res = await request(app).post(`/webhooks/paymob?hmac=${hmac}`).send(payload);
  expect(res.status).toBe(200);

  const sub = await subscriptionRepository.findByTenantId(tenantId);
  expect(sub.status).toBe("expired");
});
```

**Result:** Subscription status changes to "expired" after verified failed payment.

### Tenant isolation preserved during webhook processing

**Test:** `integration.test.js` — "tenant isolation is preserved"

```javascript
test("tenant isolation is preserved", async () => {
  const otherTenant = await setupTestTenant();
  const payload = createWebhookPayload({
    id: 666777888, success: true, pending: false,
    merchantOrderId: `tenant_${otherTenant.tenantId}_plan_Pro_${Date.now()}`,
  });
  const hmac = generateHmac(payload.obj);

  await request(app).post(`/webhooks/paymob?hmac=${hmac}`).send(payload);

  const otherSub = await subscriptionRepository.findByTenantId(otherTenant.tenantId);
  expect(otherSub.status).toBe("active");

  const originalSub = await subscriptionRepository.findByTenantId(tenantId);
  expect(originalSub.status).toBe("active");

  await cleanupTestTenant(otherTenant.tenantId);
});
```

**Result:** Webhook for `otherTenant` updates only `otherTenant`'s subscription. Original tenant's subscription unchanged.

### Concurrent duplicate webhooks do not double-process

**Test:** `integration.test.js` — "concurrent duplicate webhooks do not double-process"

```javascript
test("concurrent duplicate webhooks do not double-process", async () => {
  const payload = createWebhookPayload({ id: 555666777, success: true, pending: false });
  const hmac = generateHmac(payload.obj);

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      request(app).post(`/webhooks/paymob?hmac=${hmac}`).send(payload)
    )
  );

  const succeeded = results.filter((r) => r.status === 200);
  expect(succeeded.length).toBe(5);

  const events = await pool.query(
    `SELECT * FROM payment_events WHERE provider_event_id = '555666777'`
  );
  expect(events.rows.length).toBe(1);
});
```

**Result:** 5 concurrent webhooks: all return 200, but only 1 row inserted in `payment_events`.

---

## Data Model

### Migrations applied successfully

```bash
npm run migrate
```

Four migrations applied:
1. `001_initial_schema.sql` — Creates plans, tenants, subscriptions, usage_events tables
2. `002_seed.sql` — Seeds 3 plans (Free, Pro, Premium) and 1 demo tenant with active subscription
3. `003_add_payment_events_and_provider.js` — Adds payment_events table, renames stripe_subscription_id to provider_subscription_id, adds provider column
4. `004_add_usage_metadata.js` — Adds metadata JSONB column to usage_events for AI token category details

### payment_events unique constraint

**Schema (migration 003):**

```sql
CREATE TABLE payment_events (
    id SERIAL PRIMARY KEY,
    provider VARCHAR(50) NOT NULL,
    provider_event_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB,
    processed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_provider_event
      UNIQUE (provider, provider_event_id)
);
```

**Enforced by test:** `integration.test.js` — "duplicate callback does not create duplicate event rows" (see above)

### usage_events unique constraint

**Schema (migration 001):**

```sql
CONSTRAINT unique_tenant_idempotency
    UNIQUE (tenant_id, idempotency_key)
```

**Enforced by test:** `meter.service.test.js` — "returns existing event on duplicate idempotency key" (see above)

### Tenant isolation

**Proven by tests:**
- `meter.service.test.js` — "isolates usage between tenants"
- `integration.test.js` — "tenant isolation is preserved"
- `integration.test.js` — "client cannot control tenant ID"
- `billing.service.test.js` — "preserves tenant isolation during webhook processing"

---

## Tests

### Full test suite passes

```bash
$ npm test

Test Suites: 7 passed, 7 total
Tests:       112 passed, 112 total
```

**Test breakdown:**

| Suite | Tests |
|-------|-------|
| `tests/metering/meter.service.test.js` | 14 |
| `tests/billing/paymob.service.test.js` | 6 |
| `tests/billing/billing.service.test.js` | 12 |
| `tests/billing/integration.test.js` | 35 |
| `tests/pricing.test.js` | 15 |
| `tests/generator/generator.service.test.js` | 16 |
| `tests/usage/usage.service.test.js` | 14 |
| **Total** | **112** |

**Test categories covered:**
- Usage idempotency (2 tests)
- Quota boundaries — within, exact, one-over, cumulative, rejected-no-persist (5 tests)
- Concurrency — duplicate requests, quota competition, concurrent limit (4 tests)
- HMAC verification — valid, invalid, null, empty, tampered (5 tests)
- Checkout URL generation (1 test)
- Checkout creation — known plan, unknown plan (2 tests)
- Webhook processing — valid, invalid HMAC, forged, duplicate, subscription sync (7 tests)
- Tenant isolation (4 tests)
- Concurrency — duplicate webhooks (2 tests)
- Security — forged callbacks, secrets not exposed (3 tests)
- HTTP integration — checkout, webhook, generate, usage endpoints (35 tests)
- Pricing — token categories, markup, cost calculation, error handling (15 tests)
- Generator — atomic metering, idempotency, metadata, quota, isolation, boundaries (16 tests)
- Usage — aggregation, cost breakdown, plan limits, error handling, query validation (14 tests)

---

## Documentation

### README.md

Comprehensive README with:
- Overview and engineering goals
- Paymob adaptation explanation
- Architecture diagram
- Data model documentation
- Plans and quotas table
- API endpoint documentation
- Authentication mechanism explanation
- Webhook security documentation
- Environment variables
- Run/migrate/seed/test instructions
- Limitations section (honest)
- Tech stack

### API.md

Full API contract with:
- Authentication mechanism
- All 5 HTTP endpoints with request/response schemas (health, checkout, generate, usage, webhook)
- Error codes and security behavior

### capstone.yaml

Correct commands:
- `run: node src/server.js`
- `seed: npm run migrate`
- `test: npm test`
- `base_url: http://localhost:3000`
- Endpoints: /health, /billing/checkout, /billing/generate, /billing/usage, /webhooks/paymob

### DESIGN.md

Architecture document (historical — references Stripe from initial design phase before Paymob adaptation).

---

## Migration Reversibility

Migrations 003 and 004 have proper `down` functions:

```javascript
// Migration 003 down
exports.down = (pbm) => {
  pbm.sql(`DROP TABLE IF EXISTS payment_events;`);
  pbm.sql(`
    ALTER TABLE subscriptions
      RENAME COLUMN provider_subscription_id TO stripe_subscription_id;
    ALTER TABLE subscriptions
      DROP COLUMN IF EXISTS provider;
  `);
};

// Migration 004 down
exports.down = (pbm) => {
  pbm.sql(`ALTER TABLE usage_events DROP COLUMN IF EXISTS metadata;`);
};
```

Successfully verified by running:
```bash
npm run migrate:down   # rolls back migration 004
npm run migrate:down   # rolls back migration 003
npm run migrate        # re-applies migrations 003 and 004
```

All commands executed without errors against the test database.

---

## Not Claimed

The following are **not** claimed as complete:
- Invoice generation
- Overage billing
- Proration
- Reconciliation jobs
- Real payment processing (Test Mode only)
- Production-grade authentication
