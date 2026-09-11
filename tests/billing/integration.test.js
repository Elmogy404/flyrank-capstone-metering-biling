const crypto = require("crypto");
const request = require("supertest");
const {
  pool,
  setupTestTenant,
  cleanupTestTenant,
  cleanupAllPaymentEvents,
  cleanupAllUsageEvents,
  closePool,
} = require("../helpers");
const subscriptionRepository = require("../../src/repositories/subscription.repository");
const { BillingService } = require("../../src/services/billing.service");
const createApp = require("../../src/app");

const HMAC_SECRET = "test_hmac_secret_for_integration_tests";

function generateHmac(obj) {
  const fields = [
    obj.amount_cents,
    obj.created_at,
    obj.currency,
    obj.error_occured,
    obj.has_parent_transaction,
    obj.id,
    obj.integration_id,
    obj.is_3d_secure,
    obj.is_auth,
    obj.is_capture,
    obj.is_refunded,
    obj.is_standalone_payment,
    obj.is_voided,
    obj.order.id,
    obj.owner,
    obj.pending,
    obj.source_data.pan,
    obj.source_data.sub_type,
    obj.source_data.type,
    obj.success,
  ];
  const concatenated = fields.map(String).join("");
  return crypto.createHmac("sha512", HMAC_SECRET).update(concatenated).digest("hex");
}

function createWebhookPayload(overrides = {}) {
  return {
    type: "TRANSACTION",
    obj: {
      id: overrides.id || 192036465,
      pending: overrides.pending !== undefined ? overrides.pending : false,
      amount_cents: overrides.amount_cents || 50000,
      success: overrides.success !== undefined ? overrides.success : true,
      is_auth: false,
      is_capture: false,
      is_standalone_payment: true,
      is_voided: false,
      is_refunded: false,
      is_3d_secure: true,
      integration_id: 5911458,
      profile_id: 164295,
      has_parent_transaction: false,
      order: {
        id: overrides.orderId || 217503754,
        merchant_order_id:
          overrides.merchantOrderId ||
          `tenant_${tenantId}_plan_Pro_${Date.now()}`,
        created_at: "2026-09-10T12:00:00.000000",
        amount_cents: 50000,
        currency: "EGP",
      },
      created_at: "2026-09-10T12:00:00.000000",
      currency: "EGP",
      source_data: {
        pan: "2346",
        type: "card",
        sub_type: "MasterCard",
      },
      error_occured: false,
      owner: 12345,
      ...overrides,
    },
  };
}

let tenantId;
let subscriptionId;
let app;

beforeAll(async () => {
  const tenant = await setupTestTenant();
  tenantId = tenant.tenantId;
  subscriptionId = tenant.subscriptionId;

  const mockPaymob = {
    createIntention: jest.fn().mockResolvedValue({
      id: "intention_test_123",
      clientSecret: "client_secret_test_456",
      orderId: 789,
    }),
    checkoutUrl: jest.fn(
      (secret) =>
        `https://accept.paymob.com/unifiedcheckout/?publicKey=pk_test&clientSecret=${secret}`
    ),
    verifyTransactionHmac: jest.fn().mockImplementation(function (obj, receivedHmac) {
      const fields = [
        obj.amount_cents,
        obj.created_at,
        obj.currency,
        obj.error_occured,
        obj.has_parent_transaction,
        obj.id,
        obj.integration_id,
        obj.is_3d_secure,
        obj.is_auth,
        obj.is_capture,
        obj.is_refunded,
        obj.is_standalone_payment,
        obj.is_voided,
        obj.order.id,
        obj.owner,
        obj.pending,
        obj.source_data.pan,
        obj.source_data.sub_type,
        obj.source_data.type,
        obj.success,
      ];
      const concatenated = fields.map(String).join("");
      const computed = crypto
        .createHmac("sha512", HMAC_SECRET)
        .update(concatenated)
        .digest("hex");
      if (computed.length !== receivedHmac.length) return false;
      return crypto.timingSafeEqual(
        Buffer.from(computed),
        Buffer.from(receivedHmac)
      );
    }),
  };

  const billingService = new BillingService(mockPaymob);
  app = createApp(billingService);
});

afterAll(async () => {
  await cleanupTestTenant(tenantId);
  await closePool();
});

beforeEach(async () => {
  await cleanupAllPaymentEvents();
  await pool.query(
    `UPDATE subscriptions SET status = 'active', provider_subscription_id = NULL, ended_at = NULL WHERE id = $1`,
    [subscriptionId]
  );
});

describe("POST /billing/checkout", () => {
  test("authenticated tenant can initiate Pro checkout", async () => {
    const res = await request(app)
      .post("/billing/checkout")
      .set("Authorization", `Bearer ${tenantId}`)
      .send({ plan: "Pro" });

    expect(res.status).toBe(200);
    expect(res.body.checkoutUrl).toContain("accept.paymob.com");
    expect(res.body.intentionId).toBeDefined();
  });

  test("unauthenticated request is rejected", async () => {
    const res = await request(app)
      .post("/billing/checkout")
      .send({ plan: "Pro" });

    expect(res.status).toBe(401);
  });

  test("unknown plan is rejected", async () => {
    const res = await request(app)
      .post("/billing/checkout")
      .set("Authorization", `Bearer ${tenantId}`)
      .send({ plan: "Unknown" });

    expect(res.status).toBe(404);
  });

  test("client cannot control amount", async () => {
    const res = await request(app)
      .post("/billing/checkout")
      .set("Authorization", `Bearer ${tenantId}`)
      .send({ plan: "Pro", amount: 1 });

    expect(res.status).toBe(200);
    expect(res.body.checkoutUrl).toBeDefined();
  });

  test("client cannot control tenant ID", async () => {
    const otherTenant = await setupTestTenant();

    const res = await request(app)
      .post("/billing/checkout")
      .set("Authorization", `Bearer ${tenantId}`)
      .send({ plan: "Pro", tenant_id: otherTenant.tenantId });

    expect(res.status).toBe(200);

    await cleanupTestTenant(otherTenant.tenantId);
  });
});

describe("POST /webhooks/paymob", () => {
  test("valid provider callback is accepted", async () => {
    const payload = createWebhookPayload({ success: true, pending: false });
    const hmac = generateHmac(payload.obj);

    const res = await request(app)
      .post(`/webhooks/paymob?hmac=${hmac}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  test("invalid signature is rejected with 400", async () => {
    const payload = createWebhookPayload({ success: true });

    const res = await request(app)
      .post("/webhooks/paymob?hmac=invalid_signature")
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid signature");
  });

  test("forged callback does not change subscription", async () => {
    await pool.query(
      `UPDATE subscriptions SET status = 'active' WHERE id = $1`,
      [subscriptionId]
    );

    const payload = createWebhookPayload({ success: true });
    const res = await request(app)
      .post("/webhooks/paymob?hmac=invalid")
      .send(payload);

    expect(res.status).toBe(400);

    const sub = await subscriptionRepository.findByTenantId(tenantId);
    expect(sub.status).toBe("active");
  });

  test("malformed callback is rejected", async () => {
    const res = await request(app)
      .post("/webhooks/paymob")
      .send({ invalid: true });

    expect(res.status).toBe(400);
  });

  test("duplicate callback does not create duplicate event rows", async () => {
    const payload = createWebhookPayload({
      id: 888999000,
      success: true,
      pending: false,
    });
    const hmac = generateHmac(payload.obj);

    await request(app)
      .post(`/webhooks/paymob?hmac=${hmac}`)
      .send(payload);

    await request(app)
      .post(`/webhooks/paymob?hmac=${hmac}`)
      .send(payload);

    const events = await pool.query(
      `SELECT * FROM payment_events WHERE provider_event_id = '888999000'`
    );
    expect(events.rows.length).toBe(1);
  });
});

describe("Subscription synchronization", () => {
  test("successful payment activates Pro subscription", async () => {
    await pool.query(
      `UPDATE subscriptions SET status = 'pending' WHERE id = $1`,
      [subscriptionId]
    );

    const payload = createWebhookPayload({ success: true, pending: false });
    const hmac = generateHmac(payload.obj);

    const res = await request(app)
      .post(`/webhooks/paymob?hmac=${hmac}`)
      .send(payload);

    expect(res.status).toBe(200);

    const sub = await subscriptionRepository.findByTenantId(tenantId);
    expect(sub.status).toBe("active");
  });

  test("failed payment marks subscription as expired", async () => {
    const payload = createWebhookPayload({
      id: 333444555,
      success: false,
      pending: false,
    });
    const hmac = generateHmac(payload.obj);

    const res = await request(app)
      .post(`/webhooks/paymob?hmac=${hmac}`)
      .send(payload);

    expect(res.status).toBe(200);

    const sub = await subscriptionRepository.findByTenantId(tenantId);
    expect(sub.status).toBe("expired");
  });

  test("tenant isolation is preserved", async () => {
    const otherTenant = await setupTestTenant();

    const payload = createWebhookPayload({
      id: 666777888,
      success: true,
      pending: false,
      merchantOrderId: `tenant_${otherTenant.tenantId}_plan_Pro_${Date.now()}`,
    });
    const hmac = generateHmac(payload.obj);

    await request(app)
      .post(`/webhooks/paymob?hmac=${hmac}`)
      .send(payload);

    const otherSub = await subscriptionRepository.findByTenantId(
      otherTenant.tenantId
    );
    expect(otherSub.status).toBe("active");

    const originalSub = await subscriptionRepository.findByTenantId(tenantId);
    expect(originalSub.status).toBe("active");

    await cleanupTestTenant(otherTenant.tenantId);
  });
});

describe("Concurrency", () => {
  test("concurrent duplicate webhooks do not double-process", async () => {
    const payload = createWebhookPayload({
      id: 555666777,
      success: true,
      pending: false,
    });
    const hmac = generateHmac(payload.obj);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post(`/webhooks/paymob?hmac=${hmac}`)
          .send(payload)
      )
    );

    const succeeded = results.filter((r) => r.status === 200);
    expect(succeeded.length).toBe(5);

    const events = await pool.query(
      `SELECT * FROM payment_events WHERE provider_event_id = '555666777'`
    );
    expect(events.rows.length).toBe(1);
  });
});

describe("Security", () => {
  test("webhook without valid verification cannot upgrade tenant", async () => {
    await pool.query(
      `UPDATE subscriptions SET status = 'active' WHERE id = $1`,
      [subscriptionId]
    );

    const payload = createWebhookPayload({ success: true });
    await request(app)
      .post("/webhooks/paymob?hmac=invalid")
      .send(payload);

    const sub = await subscriptionRepository.findByTenantId(tenantId);
    expect(sub.status).toBe("active");
  });

  test("secrets are not returned in responses", async () => {
    const res = await request(app)
      .post("/billing/checkout")
      .set("Authorization", `Bearer ${tenantId}`)
      .send({ plan: "Pro" });

    const responseText = JSON.stringify(res.body);
    expect(responseText).not.toContain("egy_sk_test");
    expect(responseText).not.toContain("6CFF0B29");
  });
});

describe("POST /billing/generate", () => {
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

  test("unauthenticated request is rejected", async () => {
    const res = await request(app)
      .post("/billing/generate")
      .send({ prompt: "Hello", idempotency_key: "integ-gen-noauth" });

    expect(res.status).toBe(401);
  });

  test("missing prompt is rejected", async () => {
    const res = await request(app)
      .post("/billing/generate")
      .set("Authorization", `Bearer ${tenantId}`)
      .send({ idempotency_key: "integ-gen-noprompt" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("prompt is required");
  });

  test("missing idempotency_key is rejected", async () => {
    const res = await request(app)
      .post("/billing/generate")
      .set("Authorization", `Bearer ${tenantId}`)
      .send({ prompt: "Hello" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("idempotency_key is required");
  });

  test("duplicate idempotency key returns existing result", async () => {
    const res1 = await request(app)
      .post("/billing/generate")
      .set("Authorization", `Bearer ${tenantId}`)
      .send({ prompt: "Test", idempotency_key: "integ-gen-dup" });

    const res2 = await request(app)
      .post("/billing/generate")
      .set("Authorization", `Bearer ${tenantId}`)
      .send({ prompt: "Test", idempotency_key: "integ-gen-dup" });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.recorded).toBe(true);
    expect(res2.body.recorded).toBe(false);
  });

  test("client cannot control tenant ID", async () => {
    const otherTenant = await setupTestTenant();

    const res = await request(app)
      .post("/billing/generate")
      .set("Authorization", `Bearer ${tenantId}`)
      .send({ prompt: "Test", idempotency_key: "integ-gen-iso", tenant_id: otherTenant.tenantId });

    expect(res.status).toBe(200);

    await cleanupTestTenant(otherTenant.tenantId);
  });
});

describe("GET /billing/usage", () => {
  test("authenticated tenant can get usage", async () => {
    const res = await request(app)
      .get("/billing/usage")
      .set("Authorization", `Bearer ${tenantId}`);

    expect(res.status).toBe(200);
    expect(res.body.period).toBeDefined();
    expect(res.body.usage).toBeDefined();
    expect(res.body.usage.api_calls).toBeDefined();
    expect(res.body.usage.ai_tokens).toBeDefined();
    expect(res.body.cost).toBeDefined();
  });

  test("unauthenticated request is rejected", async () => {
    const res = await request(app)
      .get("/billing/usage");

    expect(res.status).toBe(401);
  });

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

  test("includes plan limits", async () => {
    const res = await request(app)
      .get("/billing/usage")
      .set("Authorization", `Bearer ${tenantId}`);

    expect(res.body.usage.api_calls.limit).toBeGreaterThan(0);
    expect(res.body.usage.ai_tokens.limit).toBeGreaterThan(0);
  });

  test("calculates remaining quota", async () => {
    const res = await request(app)
      .get("/billing/usage")
      .set("Authorization", `Bearer ${tenantId}`);

    expect(res.body.usage.api_calls.remaining).toBe(
      res.body.usage.api_calls.limit - res.body.usage.api_calls.used
    );
  });

  test("includes cost breakdown with pricing info", async () => {
    const res = await request(app)
      .get("/billing/usage")
      .set("Authorization", `Bearer ${tenantId}`);

    expect(res.body.cost.micro_units).toBeGreaterThanOrEqual(0);
    expect(res.body.cost.markup).toBeDefined();
    expect(res.body.cost.markup.numerator).toBe(3);
    expect(res.body.cost.markup.denominator).toBe(2);
    expect(res.body.cost.token_pricing).toBeDefined();
    expect(res.body.cost.token_pricing.input).toBeDefined();
    expect(res.body.cost.token_pricing.output).toBeDefined();
  });

  test("respects custom month and year query params", async () => {
    const res = await request(app)
      .get("/billing/usage?month=6&year=2025")
      .set("Authorization", `Bearer ${tenantId}`);

    expect(res.status).toBe(200);
    expect(res.body.period.month).toBe(6);
    expect(res.body.period.year).toBe(2025);
  });

  test("rejects month=13 with 400", async () => {
    const res = await request(app)
      .get("/billing/usage?month=13")
      .set("Authorization", `Bearer ${tenantId}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("month must be an integer between 1 and 12");
  });

  test("rejects month=0 with 400", async () => {
    const res = await request(app)
      .get("/billing/usage?month=0")
      .set("Authorization", `Bearer ${tenantId}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("month must be an integer between 1 and 12");
  });

  test("rejects month=abc with 400", async () => {
    const res = await request(app)
      .get("/billing/usage?month=abc")
      .set("Authorization", `Bearer ${tenantId}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("month must be an integer between 1 and 12");
  });

  test("rejects year=0 with 400", async () => {
    const res = await request(app)
      .get("/billing/usage?year=0")
      .set("Authorization", `Bearer ${tenantId}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("year must be a positive integer");
  });

  test("rejects year=-1 with 400", async () => {
    const res = await request(app)
      .get("/billing/usage?year=-1")
      .set("Authorization", `Bearer ${tenantId}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("year must be a positive integer");
  });

  test("rejects year=abc with 400", async () => {
    const res = await request(app)
      .get("/billing/usage?year=abc")
      .set("Authorization", `Bearer ${tenantId}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("year must be a positive integer");
  });

  test("generate returns 429 with quota details when API_CALL quota exceeded", async () => {
    await cleanupAllUsageEvents();

    // Free plan: 1000 API calls. Fill to 1000 directly.
    await pool.query(
      `INSERT INTO usage_events (tenant_id, type, quantity, idempotency_key) VALUES ($1, 'API_CALL', 1000, 'integ-quad-pre-fill')`,
      [tenantId]
    );

    const res = await request(app)
      .post("/billing/generate")
      .set("Authorization", `Bearer ${tenantId}`)
      .send({ prompt: "Over limit", idempotency_key: "integ-quad-over" });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Quota exceeded");
    expect(res.body.type).toBe("API_CALL");
    expect(res.body.used).toBe(1001);
    expect(res.body.limit).toBe(1000);

    await cleanupAllUsageEvents();
  });
});
