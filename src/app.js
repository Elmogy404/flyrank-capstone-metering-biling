const express = require("express");
const { createRoutes, createWebhookRoutes } = require("./routes/billing.routes");
const { BillingService } = require("./services/billing.service");

function createApp(billingService) {
  const app = express();

  const billing = billingService || new BillingService();

  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/billing", createRoutes(billing));
  app.use("/webhooks", createWebhookRoutes(billing));

  return app;
}

module.exports = createApp;
