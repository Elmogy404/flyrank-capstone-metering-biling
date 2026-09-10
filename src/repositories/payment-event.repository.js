const { pool } = require("../db");

class PaymentEventRepository {
  async insertIfNotExists({ provider, providerEventId, eventType, payload }) {
    const result = await pool.query(
      `INSERT INTO payment_events (provider, provider_event_id, event_type, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING *`,
      [provider, providerEventId, eventType, payload ? JSON.stringify(payload) : null]
    );
    return result.rows[0] || null;
  }

  async markProcessed(id, client) {
    const executor = client || pool;
    await executor.query(
      `UPDATE payment_events SET processed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );
  }

  async findByProviderEventId(provider, providerEventId) {
    const result = await pool.query(
      `SELECT * FROM payment_events
       WHERE provider = $1 AND provider_event_id = $2`,
      [provider, providerEventId]
    );
    return result.rows[0] || null;
  }
}

module.exports = new PaymentEventRepository();
