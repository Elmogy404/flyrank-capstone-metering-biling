require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function setupTestTenant() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tenantResult = await client.query(
      `INSERT INTO tenants (name, email, hashed_password)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [
        `test-tenant-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
        "test-hash",
      ]
    );
    const tenantId = tenantResult.rows[0].id;

    const subResult = await client.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, provider)
       VALUES ($1, 1, 'active', 'paymob')
       RETURNING id`,
      [tenantId]
    );

    await client.query("COMMIT");

    return { tenantId, subscriptionId: subResult.rows[0].id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function cleanupTestTenant(tenantId) {
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM payment_events WHERE provider = 'paymob' AND payload::text LIKE $1", [
      `%"id":%`,
    ]);
    await client.query("DELETE FROM usage_events WHERE tenant_id = $1", [
      tenantId,
    ]);
    await client.query("DELETE FROM subscriptions WHERE tenant_id = $1", [
      tenantId,
    ]);
    await client.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
  } finally {
    client.release();
  }
}

async function cleanupAllUsageEvents() {
  await pool.query("DELETE FROM usage_events");
}

async function cleanupAllPaymentEvents() {
  await pool.query("DELETE FROM payment_events");
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  setupTestTenant,
  cleanupTestTenant,
  cleanupAllUsageEvents,
  cleanupAllPaymentEvents,
  closePool,
};
