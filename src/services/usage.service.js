const usageRepository = require("../repositories/usage.repository");
const subscriptionRepository = require("../repositories/subscription.repository");
const { calculateTotalPrice, TOKEN_PRICING, API_CALL_PRICING, MARKUP_NUMERATOR, MARKUP_DENOMINATOR } = require("./pricing");

class UsageService {
  async getMonthlyUsage({ tenantId, month, year }) {
    const now = new Date();
    const targetMonth = month != null ? parseInt(month, 10) : now.getMonth() + 1;
    const targetYear = year != null ? parseInt(year, 10) : now.getFullYear();

    const period = new Date(targetYear, targetMonth - 1, 1, 0, 0, 0, 0);

    const subscription =
      await subscriptionRepository.findActiveWithPlan(tenantId);

    if (!subscription) {
      throw new Error("No active subscription");
    }

    const apiCallsUsage = await usageRepository.getMonthlyUsageByType(
      tenantId,
      "API_CALL",
      period
    );

    const aiTokensUsage = await usageRepository.getMonthlyUsageByType(
      tenantId,
      "AI_TOKEN",
      period
    );

    const aiTokensDetailed =
      await usageRepository.getMonthlyUsageByTypeDetailed(
        tenantId,
        "AI_TOKEN",
        period
      );

    const breakdowns = aiTokensDetailed.breakdowns || [];
    const breakdown = {};
    for (const b of breakdowns) {
      for (const [category, quantity] of Object.entries(b)) {
        breakdown[category] = (breakdown[category] || 0) + parseInt(quantity, 10);
      }
    }

    const apiCallCost = API_CALL_PRICING.costMicroUnits * apiCallsUsage;
    const apiCallPrice = Math.ceil((apiCallCost * MARKUP_NUMERATOR) / MARKUP_DENOMINATOR);
    const tokenPrice = calculateTotalPrice(breakdown);
    const costMicroUnits = apiCallPrice + tokenPrice;

    const apiCallsLimit = subscription.api_calls_limit;
    const aiTokensLimit = subscription.ai_tokens_limit;

    const apiCallsRemaining = Math.max(0, apiCallsLimit - apiCallsUsage);
    const aiTokensRemaining = Math.max(0, aiTokensLimit - aiTokensUsage);

    return {
      period: {
        month: targetMonth,
        year: targetYear,
      },
      usage: {
        api_calls: {
          used: apiCallsUsage,
          limit: apiCallsLimit,
          remaining: apiCallsRemaining,
        },
        ai_tokens: {
          used: aiTokensUsage,
          limit: aiTokensLimit,
          remaining: aiTokensRemaining,
          breakdown,
        },
      },
      cost: {
        micro_units: costMicroUnits,
        markup: { numerator: MARKUP_NUMERATOR, denominator: MARKUP_DENOMINATOR },
        api_call_pricing: {
          cost: API_CALL_PRICING.costMicroUnits,
          price: Math.ceil((API_CALL_PRICING.costMicroUnits * MARKUP_NUMERATOR) / MARKUP_DENOMINATOR),
        },
        token_pricing: Object.fromEntries(
          Object.entries(TOKEN_PRICING).map(([k, v]) => [
            k,
            { cost: v.costMicroUnits, price: Math.ceil((v.costMicroUnits * MARKUP_NUMERATOR) / MARKUP_DENOMINATOR) },
          ])
        ),
      },
    };
  }
}

module.exports = { UsageService };
