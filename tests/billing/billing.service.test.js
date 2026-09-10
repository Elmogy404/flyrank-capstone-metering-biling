const crypto = require("crypto");
const { pool, setupTestTenant, cleanupTestTenant, cleanupAllPaymentEvents, closePool } = require("../helpers");
const paymentEventRepository = require("../../src/repositories/payment-event.repository");
const subscriptionRepository = require("../../src/repositories/subscription.repository");

const HMAC_SECRET = "test_hmac_secret_for_billing_tests";

jest.mock("../../src/services/paymob.service", () => {
  const modCrypto = require("crypto");
  const HMAC = "test_hmac_secret_for_billing_tests";
  return {
    PaymobService: jest.fn().mockImplementation(() => ({
      createIntention: jest.fn().mockResolvedValue({
        id: "intention_123",
        clientSecret: "client_secret_456",
        orderId: 789,
      }),
      checkoutUrl: jest.fn(
        (secret) => `https://accept.paymob.com/unifiedcheckout/?publicKey=pk&clientSecret=${secret}`
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
        const computed = modCrypto
          .createHmac("sha512", HMAC)
          .update(concatenated)
          .digest("hex");
        if (computed.length !== receivedHmac.length) return false;
        return modCrypto.timingSafeEqual(
          Buffer.from(computed),
          Buffer.from(receivedHmac)
        );
      }),
    })),
  };
});

const { BillingService } = require("../../src/services/billing.service");

let billingService;
let tenantId;
let subscriptionId;

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
        merchant_order_id: overrides.merchantOrderId || `tenant_${tenantId}_plan_Pro_${Date.now()}`,
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

beforeAll(async () => {
  billingService = new BillingService();
  const tenant = await setupTestTenant();
  tenantId = tenant.tenantId;
  subscriptionId = tenant.subscriptionId;
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

describe("BillingService.createCheckout", () => {
  test("creates checkout for known plan", async () => {
    const result = await billingService.createCheckout({
      tenantId,
      planName: "Pro",
      customer: { name: "Test", email: "test@example.com" },
    });

    expect(result.checkoutUrl).toContain("accept.paymob.com");
    expect(result.intentionId).toBeDefined();
  });

  test("rejects unknown plan", async () => {
    await expect(
      billingService.createCheckout({
        tenantId,
        planName: "Unknown",
        customer: { name: "Test", email: "test@example.com" },
      })
    ).rejects.toThrow("Unknown plan");
  });
});

describe("BillingService.processWebhook", () => {
  test("processes valid successful webhook", async () => {
    const payload = createWebhookPayload({ success: true, pending: false });
    const hmac = generateHmac(payload.obj);

    const result = await billingService.processWebhook({
      obj: payload.obj,
      hmac,
    });

    expect(result.processed).toBe(true);
    expect(result.tenantId).toBe(tenantId);
    expect(result.success).toBe(true);
  });

  test("rejects invalid HMAC signature", async () => {
    const payload = createWebhookPayload({ success: true });

    await expect(
      billingService.processWebhook({
        obj: payload.obj,
        hmac: "invalid_hmac_signature",
      })
    ).rejects.toThrow("Invalid HMAC signature");
  });

  test("does not change subscription on forged callback", async () => {
    await pool.query(
      `UPDATE subscriptions SET status = 'active' WHERE id = $1`,
      [subscriptionId]
    );

    await expect(
      billingService.processWebhook({
        obj: { id: 999999 },
        hmac: "forged",
      })
    ).rejects.toThrow();

    const sub = await subscriptionRepository.findByTenantId(tenantId);
    expect(sub.status).toBe("active");
  });

  test("handles duplicate event idempotently", async () => {
    const payload = createWebhookPayload({
      id: 111222333,
      success: true,
      pending: false,
    });
    const hmac = generateHmac(payload.obj);

    const first = await billingService.processWebhook({
      obj: payload.obj,
      hmac,
    });

    const second = await billingService.processWebhook({
      obj: payload.obj,
      hmac,
    });

    expect(first.processed).toBe(true);
    expect(second.processed).toBe(false);
  });

  test("activated subscription after successful payment", async () => {
    await pool.query(
      `UPDATE subscriptions SET status = 'pending' WHERE id = $1`,
      [subscriptionId]
    );

    const payload = createWebhookPayload({ success: true, pending: false });
    const hmac = generateHmac(payload.obj);

    await billingService.processWebhook({ obj: payload.obj, hmac });

    const sub = await subscriptionRepository.findByTenantId(tenantId);
    expect(sub.status).toBe("active");
  });

  test("marks subscription as expired on failed payment", async () => {
    const payload = createWebhookPayload({
      id: 444555666,
      success: false,
      pending: false,
    });
    const hmac = generateHmac(payload.obj);

    await billingService.processWebhook({ obj: payload.obj, hmac });

    const sub = await subscriptionRepository.findByTenantId(tenantId);
    expect(sub.status).toBe("expired");
  });

  test("preserves tenant isolation during webhook processing", async () => {
    const otherTenant = await setupTestTenant();

    const payload = createWebhookPayload({
      id: 777888999,
      success: true,
      pending: false,
      merchantOrderId: `tenant_${otherTenant.tenantId}_plan_Pro_${Date.now()}`,
    });
    const hmac = generateHmac(payload.obj);

    await billingService.processWebhook({ obj: payload.obj, hmac });

    const updatedSub = await subscriptionRepository.findByTenantId(
      otherTenant.tenantId
    );
    expect(updatedSub.status).toBe("active");

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

    const promises = Array.from({ length: 5 }, () =>
      billingService.processWebhook({ obj: payload.obj, hmac })
    );

    const results = await Promise.allSettled(promises);

    const processed = results.filter(
      (r) => r.status === "fulfilled" && r.value.processed === true
    );
    const duplicates = results.filter(
      (r) => r.status === "fulfilled" && r.value.processed === false
    );

    expect(processed.length).toBe(1);
    expect(duplicates.length).toBe(4);
  });
});

describe("Security", () => {
  test("webhook without valid verification cannot upgrade tenant", async () => {
    await pool.query(
      `UPDATE subscriptions SET status = 'active' WHERE id = $1`,
      [subscriptionId]
    );

    const result = await billingService
      .processWebhook({
        obj: { id: 123 },
        hmac: "completely_invalid",
      })
      .catch(() => null);

    const sub = await subscriptionRepository.findByTenantId(tenantId);
    expect(sub.status).toBe("active");
  });

  test("secrets are not exposed in error messages", async () => {
    try {
      await billingService.processWebhook({
        obj: { id: 123 },
        hmac: "bad",
      });
    } catch (err) {
      expect(err.message).not.toContain("test_hmac_secret");
      expect(err.message).not.toContain("egy_sk_test");
    }
  });
});
