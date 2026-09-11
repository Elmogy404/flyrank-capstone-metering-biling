const { ReconciliationJob } = require("../../src/jobs/reconciliation.job");
const { pool } = require("../../src/db");
const { setupTestTenant, cleanupTestTenant } = require("../helpers");

describe("ReconciliationJob", () => {
  let testTenant;

  beforeAll(async () => {
    testTenant = await setupTestTenant();
  });

  afterAll(async () => {
    await cleanupTestTenant(testTenant.tenantId);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM payment_events");
    await pool.query("UPDATE subscriptions SET status = 'active' WHERE tenant_id = $1", [
      testTenant.tenantId,
    ]);
  });

  it("should complete with no issues on clean state", async () => {
    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const job = new ReconciliationJob({ logger });

    const result = await job.run();

    expect(result.unprocessedEvents).toBe(0);
    expect(result.stalePendingSubscriptions).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(logger.info).toHaveBeenCalled();
  });

  it("should detect unprocessed payment events", async () => {
    await pool.query(
      `INSERT INTO payment_events (provider, provider_event_id, event_type, payload, processed_at)
       VALUES ('paymob', 'evt_unprocessed_1', 'payment.success', '{}', NULL)`
    );

    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const job = new ReconciliationJob({ logger });

    const result = await job.run();

    expect(result.unprocessedEvents).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("unprocessed payment events")
    );
  });

  it("should not count already-processed events", async () => {
    await pool.query(
      `INSERT INTO payment_events (provider, provider_event_id, event_type, payload, processed_at)
       VALUES ('paymob', 'evt_processed_1', 'payment.success', '{}', NOW())`
    );

    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const job = new ReconciliationJob({ logger });

    const result = await job.run();

    expect(result.unprocessedEvents).toBe(0);
  });

  it("should detect stale pending subscriptions", async () => {
    await pool.query(
      `UPDATE subscriptions SET status = 'pending', created_at = NOW() - INTERVAL '48 hours'
       WHERE tenant_id = $1`,
      [testTenant.tenantId]
    );

    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const job = new ReconciliationJob({ logger });

    const result = await job.run();

    expect(result.stalePendingSubscriptions).toBeGreaterThanOrEqual(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("stuck in pending")
    );
  });

  it("should not count recent pending subscriptions", async () => {
    await pool.query(
      `UPDATE subscriptions SET status = 'pending', created_at = NOW() - INTERVAL '1 hour'
       WHERE tenant_id = $1`,
      [testTenant.tenantId]
    );

    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const job = new ReconciliationJob({ logger });

    const result = await job.run();

    expect(result.stalePendingSubscriptions).toBe(0);
  });

  it("should retry on transient failure and succeed", async () => {
    const originalQuery = pool.query;
    let callCount = 0;

    pool.query = jest.fn().mockImplementation(async (...args) => {
      callCount++;
      if (callCount === 1) {
        throw new Error("transient connection error");
      }
      return originalQuery.apply(pool, args);
    });

    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const job = new ReconciliationJob({ logger, maxRetries: 1 });

    const result = await job.run();

    expect(result.errors).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("retrying")
    );

    pool.query = originalQuery;
  });

  it("should exhaust retries and record error", async () => {
    const originalQuery = pool.query;

    pool.query = jest.fn().mockRejectedValue(new Error("persistent DB failure"));

    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const job = new ReconciliationJob({ logger, maxRetries: 1 });

    const result = await job.run();

    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("persistent DB failure");
    expect(result.errors[1]).toContain("persistent DB failure");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("all retries exhausted")
    );

    pool.query = originalQuery;
  });

  it("should handle both check failures gracefully", async () => {
    const originalQuery = pool.query;
    let callCount = 0;

    pool.query = jest.fn().mockImplementation(async (...args) => {
      callCount++;
      if (callCount <= 2) {
        throw new Error("First check failed");
      }
      if (callCount <= 4) {
        throw new Error("Second check failed");
      }
      return { rows: [] };
    });

    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const job = new ReconciliationJob({ logger, maxRetries: 1 });

    const result = await job.run();

    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("First check failed");
    expect(result.errors[1]).toContain("Second check failed");

    pool.query = originalQuery;
  });
});
