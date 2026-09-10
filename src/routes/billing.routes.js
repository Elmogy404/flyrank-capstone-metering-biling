const express = require("express");
const { BillingController } = require("../controllers/billing.controller");
const { PaymobWebhookController } = require("../controllers/paymob-webhook.controller");
const { authenticateToken } = require("../middleware/auth");

function createRoutes(billingService) {
  const router = express.Router();

  const billingController = new BillingController(billingService);
  const webhookController = new PaymobWebhookController(billingService);

  router.post("/checkout", authenticateToken, (req, res) =>
    billingController.createCheckout(req, res)
  );

  return router;
}

function createWebhookRoutes(billingService) {
  const router = express.Router();
  const webhookController = new PaymobWebhookController(billingService);

  router.post(
    "/paymob",
    express.json({ limit: "1mb" }),
    (req, res) => webhookController.handleWebhook(req, res)
  );

  return router;
}

module.exports = { createRoutes, createWebhookRoutes };
