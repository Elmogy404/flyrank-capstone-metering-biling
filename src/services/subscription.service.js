const { pool } = require("../db");
const subscriptionRepository = require("../repositories/subscription.repository");

const PROVIDER_NAME = "paymob";

const STATUS_MAP = {
  true: "active",
  false: "expired",
};

class SubscriptionService {
  async synchronizeFromProviderEvent({ tenantId, providerEventId, success, payload, client }) {
    const executor = client || pool;

    const subscription = await subscriptionRepository.findByTenantId(tenantId, client);
    if (!subscription) return null;

    const newStatus = STATUS_MAP[String(success)] || "expired";

    if (success) {
      const updated = await executor.query(
        `UPDATE subscriptions
         SET status = 'active',
             provider = $1,
             provider_subscription_id = COALESCE(provider_subscription_id, $2),
             started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
             ended_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [PROVIDER_NAME, providerEventId, subscription.id]
      );
      return updated.rows[0];
    } else {
      const updated = await executor.query(
        `UPDATE subscriptions
         SET status = $1,
             ended_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [newStatus, subscription.id]
      );
      return updated.rows[0];
    }
  }
}

module.exports = { SubscriptionService, PROVIDER_NAME };
