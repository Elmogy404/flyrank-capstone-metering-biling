const express = require("express");
const { BillingController } = require("../controllers/billing.controller");
const { PaymobWebhookController } = require("../controllers/paymob-webhook.controller");
const { GeneratorController } = require("../controllers/generator.controller");
const { UsageController } = require("../controllers/usage.controller");
const { authenticateToken } = require("../middleware/auth");

function createRoutes(billingService, generatorService, usageService) {
  const router = express.Router();

  const billingController = new BillingController(billingService);
  const webhookController = new PaymobWebhookController(billingService);
  const generatorController = new GeneratorController(generatorService);
  const usageController = new UsageController(usageService);

  router.post("/checkout", authenticateToken, (req, res) =>
    billingController.createCheckout(req, res)
  );

  router.post("/generate", authenticateToken, (req, res) =>
    generatorController.generate(req, res)
  );

  router.get("/usage", authenticateToken, (req, res) =>
    usageController.getUsage(req, res)
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
