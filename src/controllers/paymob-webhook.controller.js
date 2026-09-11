const { BillingService } = require("../services/billing.service");

class PaymobWebhookController {
  constructor(billingService) {
    this.billingService = billingService || new BillingService();
  }

  async handleWebhook(req, res) {
    try {
      const hmac = req.query.hmac || "";
      const obj = req.body && req.body.obj;

      if (!obj) {
        return res.status(400).json({ error: "Invalid payload" });
      }

      const result = await this.billingService.processWebhook({ obj, hmac });

      if (result.reason === "already_processed" || result.reason === "duplicate_event") {
        return res.status(200).json({ received: true });
      }

      if (result.reason === "cannot_determine_tenant") {
        return res.status(200).json({ received: true });
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      if (err.message === "Invalid HMAC signature") {
        return res.status(400).json({ error: "Invalid signature" });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}

module.exports = { PaymobWebhookController };
