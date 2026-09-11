const { pool } = require("../db");
const subscriptionRepository = require("../repositories/subscription.repository");
const usageRepository = require("../repositories/usage.repository");

class QuotaExceededError extends Error {
  constructor(type, used, limit) {
    super(`Quota exceeded for ${type}: ${used}/${limit}`);
    this.name = "QuotaExceededError";
    this.type = type;
    this.used = used;
    this.limit = limit;
  }
}

class MeterService {
  async recordUsage({ tenantId, type, quantity, idempotencyKey }) {
    // Check idempotency before entering the transaction.
    const existing = await usageRepository.findByTenantAndIdempotencyKey(
      tenantId,
      idempotencyKey
    );

    if (existing) {
      return { recorded: false, event: existing };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Lock subscription row to prevent concurrent quota races.
      const subscription =
        await subscriptionRepository.findActiveWithPlanForUpdate(
          tenantId,
          client
        );

      if (!subscription) {
        await client.query("ROLLBACK");
        throw new Error("No active subscription");
      }

      const limit =
        type === "API_CALL"
          ? subscription.api_calls_limit
          : subscription.ai_tokens_limit;

      const period = new Date();
      period.setDate(1);
      period.setHours(0, 0, 0, 0);

      // Read current usage BEFORE inserting.
      const currentUsage = await usageRepository.getMonthlyUsageByType(
        tenantId,
        type,
        period,
        client
      );

      // Explicitly validate: current_usage + requested_usage <= plan_limit.
      if (currentUsage + quantity > limit) {
        await client.query("ROLLBACK");
        throw new QuotaExceededError(type, currentUsage + quantity, limit);
      }

      // Quota check passed. Insert usage event.
      let event;
      try {
        const result = await client.query(
          `INSERT INTO usage_events (tenant_id, type, quantity, idempotency_key)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [tenantId, type, quantity, idempotencyKey]
        );
        event = result.rows[0];
      } catch (err) {
        if (err.code === "23505") {
          await client.query("ROLLBACK");
          const duplicateExisting =
            await usageRepository.findByTenantAndIdempotencyKey(
              tenantId,
              idempotencyKey
            );
          return { recorded: false, event: duplicateExisting };
        }
        throw err;
      }

      await client.query("COMMIT");
      return { recorded: true, event };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }

  async getMonthlyUsage(tenantId, period) {
    const rows = await usageRepository.getMonthlyUsage(tenantId, period);

    const usage = {
      API_CALL: { used: 0 },
      AI_TOKEN: { used: 0 },
    };

    for (const row of rows) {
      if (usage[row.type]) {
        usage[row.type].used = parseInt(row.total, 10);
      }
    }

    return usage;
  }
}

module.exports = { MeterService, QuotaExceededError };
