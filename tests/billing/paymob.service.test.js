const crypto = require("crypto");
const { PaymobService } = require("../../src/services/paymob.service");

describe("PaymobService", () => {
  let paymob;

  beforeEach(() => {
    paymob = new PaymobService({
      secretKey: "test_secret",
      publicKey: "test_public",
      hmacSecret: "test_hmac_secret_key_for_verification",
      integrationId: "12345",
    });
  });

  describe("verifyTransactionHmac", () => {
    test("returns true for valid HMAC", () => {
      const obj = {
        amount_cents: 50000,
        created_at: "2026-09-10T12:00:00.000000",
        currency: "EGP",
        error_occured: false,
        has_parent_transaction: false,
        id: 123456789,
        integration_id: 12345,
        is_3d_secure: true,
        is_auth: false,
        is_capture: false,
        is_refunded: false,
        is_standalone_payment: true,
        is_voided: false,
        order: { id: 987654321 },
        owner: 12345,
        pending: false,
        source_data: {
          pan: "2346",
          sub_type: "MasterCard",
          type: "card",
        },
        success: true,
      };

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
      const hmac = crypto
        .createHmac("sha512", "test_hmac_secret_key_for_verification")
        .update(concatenated)
        .digest("hex");

      expect(paymob.verifyTransactionHmac(obj, hmac)).toBe(true);
    });

    test("returns false for invalid HMAC", () => {
      const obj = {
        amount_cents: 50000,
        created_at: "2026-09-10T12:00:00.000000",
        currency: "EGP",
        error_occured: false,
        has_parent_transaction: false,
        id: 123456789,
        integration_id: 12345,
        is_3d_secure: true,
        is_auth: false,
        is_capture: false,
        is_refunded: false,
        is_standalone_payment: true,
        is_voided: false,
        order: { id: 987654321 },
        owner: 12345,
        pending: false,
        source_data: {
          pan: "2346",
          sub_type: "MasterCard",
          type: "card",
        },
        success: true,
      };

      expect(paymob.verifyTransactionHmac(obj, "invalid_hmac_value")).toBe(false);
    });

    test("returns false for null obj", () => {
      expect(paymob.verifyTransactionHmac(null, "some_hmac")).toBe(false);
    });

    test("returns false for empty HMAC", () => {
      expect(paymob.verifyTransactionHmac({ id: 1 }, "")).toBe(false);
    });

    test("returns false for tampered data", () => {
      const obj = {
        amount_cents: 50000,
        created_at: "2026-09-10T12:00:00.000000",
        currency: "EGP",
        error_occured: false,
        has_parent_transaction: false,
        id: 123456789,
        integration_id: 12345,
        is_3d_secure: true,
        is_auth: false,
        is_capture: false,
        is_refunded: false,
        is_standalone_payment: true,
        is_voided: false,
        order: { id: 987654321 },
        owner: 12345,
        pending: false,
        source_data: {
          pan: "2346",
          sub_type: "MasterCard",
          type: "card",
        },
        success: true,
      };

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
      const hmac = crypto
        .createHmac("sha512", "test_hmac_secret_key_for_verification")
        .update(concatenated)
        .digest("hex");

      obj.success = false;
      expect(paymob.verifyTransactionHmac(obj, hmac)).toBe(false);
    });
  });

  describe("checkoutUrl", () => {
    test("generates correct checkout URL", () => {
      const url = paymob.checkoutUrl("test_client_secret_123");
      expect(url).toContain("accept.paymob.com/unifiedcheckout/");
      expect(url).toContain("publicKey=test_public");
      expect(url).toContain("clientSecret=test_client_secret_123");
    });
  });
});
