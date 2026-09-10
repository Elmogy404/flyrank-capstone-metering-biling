const { pool } = require("../db");

class TenantRepository {
  async findById(id) {
    const result = await pool.query(
      `SELECT * FROM tenants WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async findByEmail(email) {
    const result = await pool.query(
      `SELECT * FROM tenants WHERE email = $1`,
      [email]
    );
    return result.rows[0] || null;
  }

  async create({ name, email, hashedPassword }) {
    const result = await pool.query(
      `INSERT INTO tenants (name, email, hashed_password)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, email, hashedPassword]
    );
    return result.rows[0];
  }
}

module.exports = new TenantRepository();
