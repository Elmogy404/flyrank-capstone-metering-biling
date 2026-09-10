const { pool } = require("../db");

class UsageRepository {
  async create({ tenantId, type, quantity, idempotencyKey, client }) {
    const executor = client || pool;
    const result = await executor.query(
      `INSERT INTO usage_events (tenant_id, type, quantity, idempotency_key)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenantId, type, quantity, idempotencyKey]
    );
    return result.rows[0];
  }

  async findByTenantAndIdempotencyKey(tenantId, idempotencyKey) {
    const result = await pool.query(
      `SELECT * FROM usage_events
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey]
    );
    return result.rows[0] || null;
  }

  async getMonthlyUsage(tenantId, period) {
    const result = await pool.query(
      `SELECT type, SUM(quantity) as total
       FROM usage_events
       WHERE tenant_id = $1
         AND DATE_TRUNC('month', created_at) = $2
       GROUP BY type`,
      [tenantId, period]
    );
    return result.rows;
  }

  async getMonthlyUsageByType(tenantId, usageType, period, client) {
    const executor = client || pool;
    const result = await executor.query(
      `SELECT COALESCE(SUM(quantity), 0) as total
       FROM usage_events
       WHERE tenant_id = $1
         AND type = $2
         AND DATE_TRUNC('month', created_at) = $3`,
      [tenantId, usageType, period]
    );
    return parseInt(result.rows[0].total, 10);
  }
}

module.exports = new UsageRepository();
