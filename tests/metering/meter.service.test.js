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

  test("allows usage exactly at quota", async () => {
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

  test("rejects usage exceeding quota", async () => {
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
  });

  test("concurrent requests competing for quota respect the limit", async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      meterService.recordUsage({
        tenantId,
        type: "API_CALL",
        quantity: 100,
        idempotencyKey: `key-concurrent-quota-${i}`,
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
    expect(succeeded.length + failed.length).toBe(10);
  });
});
