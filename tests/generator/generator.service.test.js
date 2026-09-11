const { GeneratorService } = require("../../src/services/generator.service");
const { MeterService, QuotaExceededError } = require("../../src/services/meter.service");
const {
  pool,
  setupTestTenant,
  cleanupTestTenant,
  cleanupAllUsageEvents,
  closePool,
} = require("../helpers");

const generatorService = new GeneratorService();
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

describe("GeneratorService.generate", () => {
  test("records API_CALL and AI_TOKEN usage atomically", async () => {
    const result = await generatorService.generate({
      tenantId,
      prompt: "Hello, how are you?",
      model: "gpt-4",
      idempotencyKey: "gen-001",
    });

    expect(result.recorded).toBe(true);
    expect(result.usage).toBeDefined();
    expect(result.usage.input).toBeGreaterThan(0);
    expect(result.usage.cached_input).toBeGreaterThanOrEqual(0);
    expect(result.usage.output).toBeGreaterThan(0);
    expect(result.usage.reasoning).toBeGreaterThanOrEqual(0);
    expect(result.totalTokens).toBe(
      result.usage.input +
        result.usage.cached_input +
        result.usage.output +
        result.usage.reasoning
    );
  });

  test("returns existing event on duplicate idempotency key", async () => {
    const first = await generatorService.generate({
      tenantId,
      prompt: "Test prompt",
      model: "gpt-4",
      idempotencyKey: "gen-dup",
    });

    const second = await generatorService.generate({
      tenantId,
      prompt: "Test prompt",
      model: "gpt-4",
      idempotencyKey: "gen-dup",
    });

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(second.event.id).toBe(first.event.id);
  });

  test("creates both API_CALL and AI_TOKEN events in database", async () => {
    await generatorService.generate({
      tenantId,
      prompt: "Count me",
      model: "gpt-4",
      idempotencyKey: "gen-count",
    });

    const apiCallEvents = await pool.query(
      `SELECT * FROM usage_events WHERE tenant_id = $1 AND type = 'API_CALL' AND idempotency_key = $2`,
      [tenantId, "generate_gen-count"]
    );
    expect(apiCallEvents.rows.length).toBe(1);

    const aiTokenEvents = await pool.query(
      `SELECT * FROM usage_events WHERE tenant_id = $1 AND type = 'AI_TOKEN' AND idempotency_key = $2`,
      [tenantId, "generate_tokens_gen-count"]
    );
    expect(aiTokenEvents.rows.length).toBe(1);
  });

  test("stores metadata on usage events", async () => {
    await generatorService.generate({
      tenantId,
      prompt: "Metadata test",
      model: "gpt-4",
      idempotencyKey: "gen-meta",
    });

    const events = await pool.query(
      `SELECT * FROM usage_events WHERE tenant_id = $1 AND idempotency_key LIKE $2`,
      [tenantId, "gen-meta%"]
    );

    for (const event of events.rows) {
      expect(event.metadata).toBeDefined();
      expect(event.metadata.model).toBe("gpt-4");
    }
  });

  test("rejects usage exceeding API_CALL quota", async () => {
    await cleanupAllUsageEvents();

    // Free plan: 1000 API calls. Fill to 1000 directly via SQL.
    const inserts = Array.from({ length: 1000 }, (_, i) =>
      pool.query(
        `INSERT INTO usage_events (tenant_id, type, quantity, idempotency_key)
         VALUES ($1, 'API_CALL', 1, $2)`,
        [tenantId, `quota-api-sql-${i}`]
      )
    );
    await Promise.all(inserts);

    await expect(
      generatorService.generate({
        tenantId,
        prompt: "Over quota",
        model: "gpt-4",
        idempotencyKey: "gen-over-api",
      })
    ).rejects.toThrow(QuotaExceededError);
  });

  test("rejects usage exceeding AI_TOKEN quota", async () => {
    await cleanupAllUsageEvents();

    // Free plan: 100000 AI tokens. Fill to 100000 directly via SQL.
    await pool.query(
      `INSERT INTO usage_events (tenant_id, type, quantity, idempotency_key)
       VALUES ($1, 'AI_TOKEN', 100000, 'quota-tokens-full-sql')`,
      [tenantId]
    );

    await expect(
      generatorService.generate({
        tenantId,
        prompt: "A".repeat(400000),
        model: "gpt-4",
        idempotencyKey: "gen-over-tokens",
      })
    ).rejects.toThrow(QuotaExceededError);
  });

  test("isolates usage between tenants", async () => {
    const otherTenant = await setupTestTenant();

    await generatorService.generate({
      tenantId,
      prompt: "Tenant 1 prompt",
      model: "gpt-4",
      idempotencyKey: "gen-iso-1",
    });

    await generatorService.generate({
      tenantId: otherTenant.tenantId,
      prompt: "Tenant 2 prompt",
      model: "gpt-4",
      idempotencyKey: "gen-iso-2",
    });

    const period = new Date();
    period.setDate(1);
    period.setHours(0, 0, 0, 0);

    const tenant1Events = await pool.query(
      `SELECT * FROM usage_events WHERE tenant_id = $1 AND DATE_TRUNC('month', created_at) = $2`,
      [tenantId, period]
    );

    const tenant2Events = await pool.query(
      `SELECT * FROM usage_events WHERE tenant_id = $1 AND DATE_TRUNC('month', created_at) = $2`,
      [otherTenant.tenantId, period]
    );

    expect(tenant1Events.rows.length).toBe(2);
    expect(tenant2Events.rows.length).toBe(2);

    await cleanupTestTenant(otherTenant.tenantId);
  });
});

describe("GeneratorService token simulation", () => {
  test("produces more output than input for typical prompt", async () => {
    const result = await generatorService.generate({
      tenantId,
      prompt: "Explain quantum computing in simple terms",
      model: "gpt-4",
      idempotencyKey: "gen-sim-1",
    });

    expect(result.usage.output).toBeGreaterThan(result.usage.input);
  });

  test("handles empty prompt", async () => {
    const result = await generatorService.generate({
      tenantId,
      prompt: "",
      model: "gpt-4",
      idempotencyKey: "gen-empty",
    });

    expect(result.usage.input).toBeGreaterThanOrEqual(1);
    expect(result.usage.output).toBeGreaterThanOrEqual(1);
  });

  test("scales token counts with prompt length", async () => {
    const short = await generatorService.generate({
      tenantId,
      prompt: "Hi",
      model: "gpt-4",
      idempotencyKey: "gen-short",
    });

    await cleanupAllUsageEvents();

    const long = await generatorService.generate({
      tenantId,
      prompt: "A".repeat(1000),
      model: "gpt-4",
      idempotencyKey: "gen-long",
    });

    expect(long.usage.input).toBeGreaterThan(short.usage.input);
    expect(long.usage.output).toBeGreaterThan(short.usage.output);
  });
});

describe("GeneratorService quota exact boundaries", () => {
  test("succeeds when API_CALL remaining quota exactly equals requested (1)", async () => {
    await cleanupAllUsageEvents();

    // Free plan: 1000 API calls. Fill to 999 directly.
    await pool.query(
      `INSERT INTO usage_events (tenant_id, type, quantity, idempotency_key) VALUES ($1, 'API_CALL', 999, 'boundary-api-ok-fill')`,
      [tenantId]
    );

    const result = await generatorService.generate({
      tenantId,
      prompt: "Boundary test",
      model: "gpt-4",
      idempotencyKey: "gen-boundary-api-ok",
    });

    expect(result.recorded).toBe(true);
  });

  test("rejects when API_CALL remaining quota is less than requested (1)", async () => {
    await cleanupAllUsageEvents();

    // Free plan: 1000 API calls. Fill to 1000 directly.
    await pool.query(
      `INSERT INTO usage_events (tenant_id, type, quantity, idempotency_key) VALUES ($1, 'API_CALL', 1000, 'boundary-api-reject-fill')`,
      [tenantId]
    );

    await expect(
      generatorService.generate({
        tenantId,
        prompt: "Over boundary",
        model: "gpt-4",
        idempotencyKey: "gen-boundary-api-reject",
      })
    ).rejects.toThrow(QuotaExceededError);
  });

  test("succeeds when AI_TOKEN remaining quota exactly equals generated tokens", async () => {
    await cleanupAllUsageEvents();

    // Free plan: 100000 AI tokens. Empty prompt generates 3 tokens.
    // Fill to 99997 so 99997 + 3 = 100000 = limit.
    await pool.query(
      `INSERT INTO usage_events (tenant_id, type, quantity, idempotency_key) VALUES ($1, 'AI_TOKEN', 99997, 'boundary-tokens-ok-fill')`,
      [tenantId]
    );

    const result = await generatorService.generate({
      tenantId,
      prompt: "",
      model: "gpt-4",
      idempotencyKey: "gen-boundary-tokens-ok",
    });

    expect(result.recorded).toBe(true);
  });

  test("rejects when AI_TOKEN remaining quota is less than generated tokens", async () => {
    await cleanupAllUsageEvents();

    // Free plan: 100000 AI tokens. Fill to 99998.
    // Empty prompt generates 3 tokens: 99998 + 3 = 100001 > 100000.
    await pool.query(
      `INSERT INTO usage_events (tenant_id, type, quantity, idempotency_key) VALUES ($1, 'AI_TOKEN', 99998, 'boundary-tokens-reject-fill')`,
      [tenantId]
    );

    await expect(
      generatorService.generate({
        tenantId,
        prompt: "",
        model: "gpt-4",
        idempotencyKey: "gen-boundary-tokens-reject",
      })
    ).rejects.toThrow(QuotaExceededError);
  });
});
