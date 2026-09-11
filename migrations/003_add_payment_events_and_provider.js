/**
 * @param {import('node-pg-migrate').MigrationBuilder} pbm
 */
exports.up = (pbm) => {
  pbm.sql(`
    ALTER TABLE subscriptions
      ADD COLUMN provider VARCHAR(50) NOT NULL DEFAULT 'paymob';

    ALTER TABLE subscriptions
      RENAME COLUMN stripe_subscription_id TO provider_subscription_id;
  `);

  pbm.sql(`
    CREATE TABLE payment_events (
      id SERIAL PRIMARY KEY,
      provider VARCHAR(50) NOT NULL,
      provider_event_id VARCHAR(255) NOT NULL,
      event_type VARCHAR(100) NOT NULL,
      payload JSONB,
      processed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT unique_provider_event
        UNIQUE (provider, provider_event_id)
    );

    CREATE INDEX idx_payment_events_provider_event
      ON payment_events (provider, provider_event_id);
  `);
};

exports.down = (pbm) => {
  pbm.sql(`DROP TABLE IF EXISTS payment_events;`);
  pbm.sql(`
    ALTER TABLE subscriptions
      RENAME COLUMN provider_subscription_id TO stripe_subscription_id;

    ALTER TABLE subscriptions
      DROP COLUMN IF EXISTS provider;
  `);
};
