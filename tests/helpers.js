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
        `test-tenant-${Date.now()}`,
        `test-${Date.now()}@example.com`,
        "test-hash",
      ]
    );
    const tenantId = tenantResult.rows[0].id;

    const subResult = await client.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status)
       VALUES ($1, 1, 'active')
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

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  setupTestTenant,
  cleanupTestTenant,
  cleanupAllUsageEvents,
  closePool,
};
