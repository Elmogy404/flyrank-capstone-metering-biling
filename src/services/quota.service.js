const subscriptionRepository = require("../repositories/subscription.repository");
const usageRepository = require("../repositories/usage.repository");

class QuotaExceededError extends Error {
  constructor(type, used, limit) {
    super(`Quota exceeded for ${type}: ${used}/${limit}`);
    this.name = "QuotaExceededError";
    this.type = type;
    this.used = used;
    this.limit = limit;
  }
}

class QuotaService {
  async checkQuota(tenantId, type, quantity) {
    const subscription = await subscriptionRepository.findActiveWithPlan(tenantId);

    if (!subscription) {
      throw new Error("No active subscription");
    }

    const limit =
      type === "API_CALL"
        ? subscription.api_calls_limit
        : subscription.ai_tokens_limit;

    const period = new Date();
    period.setDate(1);
    period.setHours(0, 0, 0, 0);

    const currentUsage = await usageRepository.getMonthlyUsageByType(
      tenantId,
      type,
      period
    );

    if (currentUsage + quantity > limit) {
      throw new QuotaExceededError(type, currentUsage + quantity, limit);
    }

    return {
      allowed: true,
      currentUsage,
      limit,
      projected: currentUsage + quantity,
    };
  }
}

module.exports = { QuotaService, QuotaExceededError };
