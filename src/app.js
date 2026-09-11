const express = require("express");
const { createRoutes, createWebhookRoutes } = require("./routes/billing.routes");
const { BillingService } = require("./services/billing.service");
const { GeneratorService } = require("./services/generator.service");
const { UsageService } = require("./services/usage.service");

function createApp(billingService, generatorService, usageService) {
  const app = express();

  const billing = billingService || new BillingService();
  const generator = generatorService || new GeneratorService();
  const usage = usageService || new UsageService();

  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/billing", createRoutes(billing, generator, usage));
  app.use("/webhooks", createWebhookRoutes(billing));

  return app;
}

module.exports = createApp;
