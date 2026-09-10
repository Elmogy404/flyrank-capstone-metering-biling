const { pool } = require("../db");
const { PaymobService } = require("./paymob.service");
const subscriptionRepository = require("../repositories/subscription.repository");
const paymentEventRepository = require("../repositories/payment-event.repository");
const { SubscriptionService, PROVIDER_NAME } = require("./subscription.service");

const PLAN_PRICES = {
  Pro: { amountCents: 50000, currency: "EGP" },
};

class BillingService {
  constructor(paymob) {
    this.paymob = paymob || new PaymobService();
    this.subscriptionService = new SubscriptionService();
  }

  async createCheckout({ tenantId, planName, customer }) {
    const planConfig = PLAN_PRICES[planName];
    if (!planConfig) {
      throw new Error(`Unknown plan: ${planName}`);
    }

    const subscription = await subscriptionRepository.findByTenantId(tenantId);
    if (!subscription) {
      throw new Error("No subscription found for tenant");
    }

    if (subscription.status === "active" && subscription.plan_id === 2) {
      throw new Error("Already subscribed to Pro");
    }

    const specialReference = `tenant_${tenantId}_plan_${planName}_${Date.now()}`;

    const intention = await this.paymob.createIntention({
      amountCents: planConfig.amountCents,
      currency: planConfig.currency,
      specialReference,
      customer: {
        firstName: customer.name || "Customer",
        lastName: "User",
        email: customer.email,
        phone: customer.phone || "+201000000000",
      },
      notificationUrl: `${process.env.APP_URL || "http://localhost:3000"}/webhooks/paymob`,
      redirectionUrl: `${process.env.APP_URL || "http://localhost:3000"}/payment/complete`,
    });

    return {
      checkoutUrl: this.paymob.checkoutUrl(intention.clientSecret),
      intentionId: intention.id,
      orderId: intention.orderId,
    };
  }

  async processWebhook({ obj, hmac }) {
    const verified = this.paymob.verifyTransactionHmac(obj, hmac);
    if (!verified) {
      throw new Error("Invalid HMAC signature");
    }

    const providerEventId = String(obj.id);
    const eventType = obj.success ? "payment_success" : "payment_failed";

    const existing = await paymentEventRepository.findByProviderEventId(
      PROVIDER_NAME,
      providerEventId
    );
    if (existing && existing.processed_at) {
      return { processed: false, reason: "already_processed" };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const event = await paymentEventRepository.insertIfNotExists({
        provider: PROVIDER_NAME,
        providerEventId,
        eventType,
        payload: obj,
      });

      if (!event) {
        await client.query("COMMIT");
        return { processed: false, reason: "duplicate_event" };
      }

      const merchantOrderId = obj.order && obj.order.merchant_order_id;
      let tenantId = null;

      if (merchantOrderId && merchantOrderId.startsWith("tenant_")) {
        const parts = merchantOrderId.split("_");
        tenantId = parseInt(parts[1], 10);
      }

      if (!tenantId) {
        await client.query("ROLLBACK");
        return { processed: false, reason: "cannot_determine_tenant" };
      }

      await this.subscriptionService.synchronizeFromProviderEvent({
        tenantId,
        providerEventId,
        success: obj.success,
        payload: obj,
        client,
      });

      await paymentEventRepository.markProcessed(event.id, client);

      await client.query("COMMIT");
      return { processed: true, tenantId, success: obj.success };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = { BillingService, PLAN_PRICES };
