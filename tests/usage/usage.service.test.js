const { UsageService } = require("../../src/services/usage.service");
const { GeneratorService } = require("../../src/services/generator.service");
const { TOKEN_PRICING, MARKUP_NUMERATOR, MARKUP_DENOMINATOR } = require("../../src/services/pricing");
const {
  pool,
  setupTestTenant,
  cleanupTestTenant,
  cleanupAllUsageEvents,
  closePool,
} = require("../helpers");

const usageService = new UsageService();
const generatorService = new GeneratorService();

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

describe("UsageService.getMonthlyUsage", () => {
  test("returns usage for current month", async () => {
    const result = await usageService.getMonthlyUsage({
      tenantId,
    });

    expect(result.period).toBeDefined();
    expect(result.period.month).toBeGreaterThan(0);
    expect(result.period.month).toBeLessThanOrEqual(12);
    expect(result.period.year).toBeGreaterThan(2020);
    expect(result.usage.api_calls).toBeDefined();
    expect(result.usage.ai_tokens).toBeDefined();
    expect(result.cost).toBeDefined();
  });

  test("returns zero usage when no events exist", async () => {
    const result = await usageService.getMonthlyUsage({
      tenantId,
    });

    expect(result.usage.api_calls.used).toBe(0);
    expect(result.usage.ai_tokens.used).toBe(0);
  });

  test("reflects recorded usage from generator", async () => {
    await generatorService.generate({
      tenantId,
      prompt: "Hello world",
      model: "gpt-4",
      idempotencyKey: "usage-test-1",
    });

    const result = await usageService.getMonthlyUsage({
      tenantId,
    });

    expect(result.usage.api_calls.used).toBe(1);
    expect(result.usage.ai_tokens.used).toBeGreaterThan(0);
  });

  test("aggregates multiple generate calls", async () => {
    await generatorService.generate({
      tenantId,
      prompt: "First prompt",
      model: "gpt-4",
      idempotencyKey: "usage-agg-1",
    });

    await generatorService.generate({
      tenantId,
      prompt: "Second prompt",
      model: "gpt-4",
      idempotencyKey: "usage-agg-2",
    });

    const result = await usageService.getMonthlyUsage({
      tenantId,
    });

    expect(result.usage.api_calls.used).toBe(2);
    expect(result.usage.ai_tokens.used).toBeGreaterThan(0);
  });

  test("respects custom month and year", async () => {
    const result = await usageService.getMonthlyUsage({
      tenantId,
      month: "6",
      year: "2025",
    });

    expect(result.period.month).toBe(6);
    expect(result.period.year).toBe(2025);
    expect(result.usage.api_calls.used).toBe(0);
  });

  test("includes plan limits from subscription", async () => {
    const result = await usageService.getMonthlyUsage({
      tenantId,
    });

    expect(result.usage.api_calls.limit).toBeGreaterThan(0);
    expect(result.usage.ai_tokens.limit).toBeGreaterThan(0);
  });

  test("calculates remaining quota", async () => {
    const result = await usageService.getMonthlyUsage({
      tenantId,
    });

    expect(result.usage.api_calls.remaining).toBe(
      result.usage.api_calls.limit - result.usage.api_calls.used
    );
    expect(result.usage.ai_tokens.remaining).toBe(
      result.usage.ai_tokens.limit - result.usage.ai_tokens.used
    );
  });

  test("includes cost breakdown with pricing", async () => {
    const result = await usageService.getMonthlyUsage({
      tenantId,
    });

    expect(result.cost.micro_units).toBeGreaterThanOrEqual(0);
    expect(result.cost.markup).toEqual({ numerator: MARKUP_NUMERATOR, denominator: MARKUP_DENOMINATOR });
    expect(result.cost.token_pricing.input).toBeDefined();
    expect(result.cost.token_pricing.output).toBeDefined();
    expect(result.cost.token_pricing.cached_input).toBeDefined();
    expect(result.cost.token_pricing.reasoning).toBeDefined();
  });

  test("includes AI token category breakdown", async () => {
    await generatorService.generate({
      tenantId,
      prompt: "Breakdown test",
      model: "gpt-4",
      idempotencyKey: "usage-breakdown",
    });

    const result = await usageService.getMonthlyUsage({
      tenantId,
    });

    const breakdown = result.usage.ai_tokens.breakdown;
    expect(breakdown).toBeDefined();
    expect(typeof breakdown).toBe("object");
  });

  test("throws for tenant with no active subscription", async () => {
    const noSubTenant = await pool.query(
      `INSERT INTO tenants (name, email, hashed_password) VALUES ($1, $2, $3) RETURNING id`,
      [`no-sub-${Date.now()}`, `nosub-${Date.now()}@example.com`, "hash"]
    );
    const noSubTenantId = noSubTenant.rows[0].id;

    await expect(
      usageService.getMonthlyUsage({ tenantId: noSubTenantId })
    ).rejects.toThrow("No active subscription");

    await pool.query(`DELETE FROM tenants WHERE id = $1`, [noSubTenantId]);
  });
});
