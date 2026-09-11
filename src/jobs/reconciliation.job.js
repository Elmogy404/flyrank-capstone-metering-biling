const { pool } = require("../db");

class ReconciliationJob {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.maxRetries = options.maxRetries || 1;
  }

  async _queryWithRetry(queryFn, label) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await queryFn();
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries) {
          this.logger.warn(
            `[Reconciliation] ${label} failed on attempt ${attempt + 1}, retrying: ${err.message}`
          );
        }
      }
    }
    throw lastError;
  }

  async run() {
    const results = {
      unprocessedEvents: 0,
      stalePendingSubscriptions: 0,
      errors: [],
    };

    try {
      const unprocessedResult = await this._queryWithRetry(
        () =>
          pool.query(
            `SELECT id, provider, provider_event_id, event_type, created_at
             FROM payment_events
             WHERE processed_at IS NULL
             ORDER BY created_at ASC
             LIMIT 100`
          ),
        "unprocessed events check"
      );

      results.unprocessedEvents = unprocessedResult.rows.length;

      if (results.unprocessedEvents > 0) {
        this.logger.warn(
          `[Reconciliation] Found ${results.unprocessedEvents} unprocessed payment events`
        );

        for (const event of unprocessedResult.rows) {
          this.logger.warn(
            `[Reconciliation] Unprocessed event: id=${event.id} provider=${event.provider} event_id=${event.provider_event_id} type=${event.event_type} created=${event.created_at}`
          );
        }
      }
    } catch (err) {
      results.errors.push(`Failed to check unprocessed events: ${err.message}`);
      this.logger.error(`[Reconciliation] Error checking unprocessed events (all retries exhausted): ${err.message}`);
    }

    try {
      const staleResult = await this._queryWithRetry(
        () =>
          pool.query(
            `SELECT s.id, s.tenant_id, s.status, s.created_at, t.name as tenant_name
             FROM subscriptions s
             JOIN tenants t ON s.tenant_id = t.id
             WHERE s.status = 'pending'
               AND s.created_at < NOW() - INTERVAL '24 hours'
             LIMIT 100`
          ),
        "stale subscriptions check"
      );

      results.stalePendingSubscriptions = staleResult.rows.length;

      if (results.stalePendingSubscriptions > 0) {
        this.logger.warn(
          `[Reconciliation] Found ${results.stalePendingSubscriptions} subscriptions stuck in pending for >24h`
        );

        for (const sub of staleResult.rows) {
          this.logger.warn(
            `[Reconciliation] Stale pending subscription: id=${sub.id} tenant=${sub.tenant_id} (${sub.tenant_name}) created=${sub.created_at}`
          );
        }
      }
    } catch (err) {
      results.errors.push(`Failed to check stale subscriptions: ${err.message}`);
      this.logger.error(`[Reconciliation] Error checking stale subscriptions (all retries exhausted): ${err.message}`);
    }

    if (results.errors.length > 0) {
      this.logger.error(
        `[Reconciliation] Completed with ${results.errors.length} error(s): ${results.errors.join("; ")}`
      );
    } else {
      this.logger.info(
        `[Reconciliation] Complete: ${results.unprocessedEvents} unprocessed events, ${results.stalePendingSubscriptions} stale pending subscriptions`
      );
    }

    return results;
  }
}

module.exports = { ReconciliationJob };
