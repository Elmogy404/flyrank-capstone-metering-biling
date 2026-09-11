const { UsageService } = require("../services/usage.service");

class UsageController {
  constructor(usageService) {
    this.usageService = usageService || new UsageService();
  }

  async getUsage(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { month, year } = req.query;

      if (month !== undefined) {
        const m = parseInt(month, 10);
        if (!Number.isInteger(m) || m < 1 || m > 12) {
          return res.status(400).json({ error: "month must be an integer between 1 and 12" });
        }
      }

      if (year !== undefined) {
        const y = parseInt(year, 10);
        if (!Number.isInteger(y) || y < 1) {
          return res.status(400).json({ error: "year must be a positive integer" });
        }
      }

      const result = await this.usageService.getMonthlyUsage({
        tenantId,
        month,
        year,
      });

      return res.status(200).json(result);
    } catch (err) {
      if (err.message === "No active subscription") {
        return res.status(404).json({ error: "No active subscription" });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}

module.exports = { UsageController };
