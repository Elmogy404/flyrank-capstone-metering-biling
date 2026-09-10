const { pool } = require("../db");

class SubscriptionRepository {
  async findByTenantId(tenantId) {
    const result = await pool.query(
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
         s.stripe_subscription_id,
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
         s.stripe_subscription_id,
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

  async findByStripeSubscriptionId(stripeSubscriptionId) {
    const result = await pool.query(
      `SELECT * FROM subscriptions
       WHERE stripe_subscription_id = $1`,
      [stripeSubscriptionId]
    );
    return result.rows[0] || null;
  }

  async create({ tenantId, planId, status, stripeSubscriptionId }) {
    const result = await pool.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, stripe_subscription_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenantId, planId, status, stripeSubscriptionId]
    );
    return result.rows[0];
  }

  async update(id, fields) {
    const keys = Object.keys(fields);
    if (keys.length === 0) return null;

    const setClauses = keys
      .map((key, i) => `${key} = $${i + 2}`)
      .join(", ");
    const values = [id, ...Object.values(fields)];

    const result = await pool.query(
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
