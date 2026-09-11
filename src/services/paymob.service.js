const crypto = require("crypto");
const axios = require("axios");

const PAYMOB_BASE_URL = "https://accept.paymob.com";

class PaymobService {
  constructor(config = {}) {
    this.secretKey = config.secretKey || process.env.PAYMOB_SECRET_KEY;
    this.publicKey = config.publicKey || process.env.PAYMOB_PUBLIC_KEY;
    this.hmacSecret = config.hmacSecret || process.env.PAYMOB_HMAC_SECRET;
    this.integrationId = config.integrationId || process.env.PAYMOB_INTEGRATION_ID;

    this.client = axios.create({
      baseURL: PAYMOB_BASE_URL,
      headers: {
        Authorization: `Token ${this.secretKey}`,
        "Content-Type": "application/json",
      },
    });
  }

  async createIntention({
    amountCents,
    currency,
    integrationId,
    specialReference,
    customer,
    notificationUrl,
    redirectionUrl,
  }) {
    const payload = {
      amount: amountCents,
      currency: currency || "EGP",
      payment_methods: [Number(integrationId || this.integrationId)],
      items: [
        {
          name: "Pro Plan Subscription",
          amount: amountCents,
          quantity: 1,
        },
      ],
      special_reference: specialReference,
      billing_data: {
        first_name: customer.firstName,
        last_name: customer.lastName,
        email: customer.email,
        phone_number: customer.phone || "+201000000000",
        apartment: "NA",
        floor: "NA",
        street: "NA",
        building: "NA",
        shipping_method: "NA",
        postal_code: "NA",
        city: "NA",
        state: "NA",
        country: "EGY",
      },
      notification_url: notificationUrl,
      redirection_url: redirectionUrl,
    };

    const { data } = await this.client.post("/v1/intention/", payload);
    return {
      id: data.id,
      clientSecret: data.client_secret,
      orderId: data.intention_order_id,
    };
  }

  checkoutUrl(clientSecret) {
    return `${PAYMOB_BASE_URL}/unifiedcheckout/?publicKey=${this.publicKey}&clientSecret=${clientSecret}`;
  }

  verifyTransactionHmac(obj, receivedHmac) {
    if (!obj || !receivedHmac) return false;

    const fields = [
      obj.amount_cents,
      obj.created_at,
      obj.currency,
      obj.error_occured,
      obj.has_parent_transaction,
      obj.id,
      obj.integration_id,
      obj.is_3d_secure,
      obj.is_auth,
      obj.is_capture,
      obj.is_refunded,
      obj.is_standalone_payment,
      obj.is_voided,
      obj.order.id,
      obj.owner,
      obj.pending,
      obj.source_data.pan,
      obj.source_data.sub_type,
      obj.source_data.type,
      obj.success,
    ];

    const concatenated = fields.map(String).join("");
    const computed = crypto
      .createHmac("sha512", this.hmacSecret)
      .update(concatenated)
      .digest("hex");

    if (computed.length !== receivedHmac.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(computed),
      Buffer.from(receivedHmac)
    );
  }
}

module.exports = { PaymobService };
