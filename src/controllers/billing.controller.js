const { BillingService } = require("../services/billing.service");

class BillingController {
  constructor(billingService) {
    this.billingService = billingService || new BillingService();
  }

  async createCheckout(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { plan } = req.body;

      if (!plan) {
        return res.status(400).json({ error: "plan is required" });
      }

      const result = await this.billingService.createCheckout({
        tenantId,
        planName: plan,
        customer: {
          name: req.user.name || "Customer",
          email: req.user.email,
          phone: req.user.phone,
        },
      });

      return res.status(200).json({
        checkoutUrl: result.checkoutUrl,
        intentionId: result.intentionId,
      });
    } catch (err) {
      if (err.message === "Unknown plan: " + req.body.plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      if (err.message === "Already subscribed to Pro") {
        return res.status(409).json({ error: err.message });
      }
      if (err.message === "No subscription found for tenant") {
        return res.status(404).json({ error: "No subscription found" });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}

module.exports = { BillingController };
