const { MeterService } = require("../../src/services/meter.service");
const {
  pool,
  setupTestTenant,
  cleanupTestTenant,
  cleanupAllUsageEvents,
  closePool,
} = require("../helpers");

const meterService = new MeterService();

let tenantId;

beforeAll(async () => {
  const tenant = await setupTestTenant();
  tenantId = tenant.tenantId;
});

afterAll(async () => {
  await cleanupTestTenant(tenantId);
  await closePool();
});

beforeEach(async () => {
  await cleanupAllUsageEvents();
});

describe("MeterService.recordUsage", () => {
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

  test("returns existing event on duplicate idempotency key", async () => {
    const first = await meterService.recordUsage({
      tenantId,
      type: "API_CALL",
      quantity: 5,
      idempotencyKey: "key-dup",
    });

    const second = await meterService.recordUsage({
      tenantId,
      type: "API_CALL",
      quantity: 5,
      idempotencyKey: "key-dup",
    });

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(second.event.id).toBe(first.event.id);
  });

  test("allows different idempotency keys", async () => {
    const first = await meterService.recordUsage({
      tenantId,
      type: "API_CALL",
      quantity: 1,
      idempotencyKey: "key-a",
    });

    const second = await meterService.recordUsage({
      tenantId,
      type: "API_CALL",
      quantity: 1,
      idempotencyKey: "key-b",
    });

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(true);
    expect(first.event.id).not.toBe(second.event.id);
  });

  test("isolates usage between tenants", async () => {
    const otherTenant = await setupTestTenant();

    await meterService.recordUsage({
      tenantId,
      type: "API_CALL",
      quantity: 10,
      idempotencyKey: "key-iso-1",
    });

    await meterService.recordUsage({
      tenantId: otherTenant.tenantId,
      type: "API_CALL",
      quantity: 20,
      idempotencyKey: "key-iso-2",
    });

    const period = new Date();
    period.setDate(1);
    period.setHours(0, 0, 0, 0);

    const tenantUsage = await meterService.getMonthlyUsage(tenantId, period);
    const otherUsage = await meterService.getMonthlyUsage(
      otherTenant.tenantId,
      period
    );

    expect(tenantUsage.API_CALL.used).toBe(10);
    expect(otherUsage.API_CALL.used).toBe(20);

    await cleanupTestTenant(otherTenant.tenantId);
  });
});

describe("MeterService quota enforcement", () => {
  test("allows usage within quota", async () => {
    const result = await meterService.recordUsage({
      tenantId,
      type: "API_CALL",
      quantity: 999,
      idempotencyKey: "key-quota-ok",
    });

    expect(result.recorded).toBe(true);
  });

  test("succeeds when usage + quantity equals exactly the limit", async () => {
    // Free plan: 1000 API calls. Record 1000 in one shot.
    const result = await meterService.recordUsage({
      tenantId,
      type: "API_CALL",
      quantity: 1000,
      idempotencyKey: "key-quota-exact-1000",
    });

    expect(result.recorded).toBe(true);

    const period = new Date();
    period.setDate(1);
    period.setHours(0, 0, 0, 0);

    const usage = await meterService.getMonthlyUsage(tenantId, period);
    expect(usage.API_CALL.used).toBe(1000);
  });

  test("allows usage exactly at quota via two requests", async () => {
    await meterService.recordUsage({
      tenantId,
      type: "API_CALL",
      quantity: 999,
      idempotencyKey: "key-quota-exact-1",
    });

    const result = await meterService.recordUsage({
      tenantId,
      type: "API_CALL",
      quantity: 1,
      idempotencyKey: "key-quota-exact-2",
    });

    expect(result.recorded).toBe(true);
  });

  test("rejects one unit over the boundary", async () => {
    // Free plan: 1000 API calls. Record 1001 in one shot.
    await expect(
      meterService.recordUsage({
        tenantId,
        type: "API_CALL",
        quantity: 1001,
        idempotencyKey: "key-quota-over-1",
      })
    ).rejects.toThrow("Quota exceeded");
  });

  test("rejects when cumulative usage exceeds limit", async () => {
    await meterService.recordUsage({
      tenantId,
      type: "API_CALL",
      quantity: 999,
      idempotencyKey: "key-quota-exceed-1",
    });

    await expect(
      meterService.recordUsage({
        tenantId,
        type: "API_CALL",
        quantity: 2,
        idempotencyKey: "key-quota-exceed-2",
      })
    ).rejects.toThrow("Quota exceeded");
  });

  test("rejected operation leaves no persisted usage", async () => {
    // Fill to 999, then try to add 2 (exceeds limit).
    await meterService.recordUsage({
      tenantId,
      type: "API_CALL",
      quantity: 999,
      idempotencyKey: "key-quota-noop-fill",
    });

    await expect(
      meterService.recordUsage({
        tenantId,
        type: "API_CALL",
        quantity: 2,
        idempotencyKey: "key-quota-noop-reject",
      })
    ).rejects.toThrow("Quota exceeded");

    const period = new Date();
    period.setDate(1);
    period.setHours(0, 0, 0, 0);

    const usage = await meterService.getMonthlyUsage(tenantId, period);
    expect(usage.API_CALL.used).toBe(999);
  });

  test("rejected operation does not persist event row", async () => {
    await meterService.recordUsage({
      tenantId,
      type: "API_CALL",
      quantity: 999,
      idempotencyKey: "key-quota-norow-fill",
    });

    await expect(
      meterService.recordUsage({
        tenantId,
        type: "API_CALL",
        quantity: 2,
        idempotencyKey: "key-quota-norow-reject",
      })
    ).rejects.toThrow("Quota exceeded");

    const result = await pool.query(
      `SELECT * FROM usage_events WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, "key-quota-norow-reject"]
    );
    expect(result.rows.length).toBe(0);
  });
});

describe("MeterService concurrency", () => {
  test("concurrent duplicate requests produce one event", async () => {
    const promises = Array.from({ length: 5 }, (_, i) =>
      meterService.recordUsage({
        tenantId,
        type: "API_CALL",
        quantity: 1,
        idempotencyKey: "key-concurrent-dup",
      })
    );

    const results = await Promise.all(promises);

    const recorded = results.filter((r) => r.recorded === true);
    const rejected = results.filter((r) => r.recorded === false);

    expect(recorded.length).toBe(1);
    expect(rejected.length).toBe(4);

    for (const r of rejected) {
      expect(r.event.id).toBe(recorded[0].event.id);
    }

    const period = new Date();
    period.setDate(1);
    period.setHours(0, 0, 0, 0);

    const usage = await meterService.getMonthlyUsage(tenantId, period);
    expect(usage.API_CALL.used).toBe(1);
  });

  test("concurrent competing requests respect the limit", async () => {
    // Free plan: 1000 API calls. 10 requests x 100 each = 1000 total.
    // Exactly fits — all should succeed.
    const promisesFit = Array.from({ length: 10 }, (_, i) =>
      meterService.recordUsage({
        tenantId,
        type: "API_CALL",
        quantity: 100,
        idempotencyKey: `key-concurrent-fit-${i}`,
      })
    );

    const resultsFit = await Promise.allSettled(promisesFit);
    const succeededFit = resultsFit.filter((r) => r.status === "fulfilled");

    const period = new Date();
    period.setDate(1);
    period.setHours(0, 0, 0, 0);

    const usageFit = await meterService.getMonthlyUsage(tenantId, period);
    expect(usageFit.API_CALL.used).toBe(1000);
    expect(succeededFit.length).toBe(10);
  });

  test("concurrent requests exceeding limit reject without exceeding it", async () => {
    // 20 requests x 100 each = 2000 total. Limit is 1000.
    // Exactly 10 should succeed, 10 should fail.
    const promises = Array.from({ length: 20 }, (_, i) =>
      meterService.recordUsage({
        tenantId,
        type: "API_CALL",
        quantity: 100,
        idempotencyKey: `key-concurrent-over-${i}`,
      })
    );

    const results = await Promise.allSettled(promises);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter(
      (r) => r.status === "rejected" && r.reason.name === "QuotaExceededError"
    );

    const period = new Date();
    period.setDate(1);
    period.setHours(0, 0, 0, 0);

    const usage = await meterService.getMonthlyUsage(tenantId, period);

    expect(usage.API_CALL.used).toBeLessThanOrEqual(1000);
    expect(usage.API_CALL.used).toBe(1000);
    expect(succeeded.length).toBe(10);
    expect(failed.length).toBe(10);
    expect(succeeded.length + failed.length).toBe(20);
  });
});
