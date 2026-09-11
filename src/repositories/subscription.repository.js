const { pool } = require("../db");

class SubscriptionRepository {
  async findByTenantId(tenantId, client) {
    const executor = client || pool;
    const result = await executor.query(
      `SELECT * FROM subscriptions
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId]
    );
    return result.rows[0] || null;
  }

  async findActiveWithPlan(tenantId, client) {
    const executor = client || pool;
    const result = await executor.query(
      `SELECT
         s.id as subscription_id,
         s.tenant_id,
         s.plan_id,
         s.status,
         s.provider,
         s.provider_subscription_id,
         p.name as plan_name,
         p.api_calls_limit,
         p.ai_tokens_limit
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.tenant_id = $1
         AND s.status = 'active'
       LIMIT 1`,
      [tenantId]
    );
    return result.rows[0] || null;
  }

  async findActiveWithPlanForUpdate(tenantId, client) {
    const executor = client || pool;
    const result = await executor.query(
      `SELECT
         s.id as subscription_id,
         s.tenant_id,
         s.plan_id,
         s.status,
         s.provider,
         s.provider_subscription_id,
         p.name as plan_name,
         p.api_calls_limit,
         p.ai_tokens_limit
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.tenant_id = $1
         AND s.status = 'active'
       LIMIT 1
       FOR UPDATE OF s`,
      [tenantId]
    );
    return result.rows[0] || null;
  }

  async findByProviderSubscriptionId(providerSubscriptionId, client) {
    const executor = client || pool;
    const result = await executor.query(
      `SELECT * FROM subscriptions
       WHERE provider_subscription_id = $1`,
      [providerSubscriptionId]
    );
    return result.rows[0] || null;
  }

  async create({ tenantId, planId, status, provider, providerSubscriptionId }) {
    const result = await pool.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, provider, provider_subscription_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, planId, status, provider || "paymob", providerSubscriptionId || null]
    );
    return result.rows[0];
  }

  async update(id, fields, client) {
    const keys = Object.keys(fields);
    if (keys.length === 0) return null;

    const executor = client || pool;
    const setClauses = keys
      .map((key, i) => `${key} = $${i + 2}`)
      .join(", ");
    const values = [id, ...Object.values(fields)];

    const result = await executor.query(
      `UPDATE subscriptions
       SET ${setClauses}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }
}

module.exports = new SubscriptionRepository();
