const tenantRepository = require("../repositories/tenant.repository");

async function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  try {
    const tenantId = parseInt(token, 10);
    if (isNaN(tenantId)) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.user = {
      tenantId: tenant.id,
      name: tenant.name,
      email: tenant.email,
    };

    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = { authenticateToken };
