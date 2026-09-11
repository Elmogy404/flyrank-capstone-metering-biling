const { pool } = require("../db");
const usageRepository = require("../repositories/usage.repository");
const subscriptionRepository = require("../repositories/subscription.repository");
const { MeterService, QuotaExceededError } = require("./meter.service");

class GeneratorService {
  constructor() {
    this.meterService = new MeterService();
  }

  async generate({ tenantId, prompt, model, idempotencyKey }) {
    const tokenBreakdown = this._simulateTokenGeneration(prompt, model);

    const totalTokens =
      tokenBreakdown.input +
      tokenBreakdown.cached_input +
      tokenBreakdown.output +
      tokenBreakdown.reasoning;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Check idempotency by querying for existing event.
      const existingApiCall = await usageRepository.findByTenantAndIdempotencyKey(
        tenantId,
        `generate_${idempotencyKey}`
      );

      if (existingApiCall) {
        await client.query("ROLLBACK");
        return {
          recorded: false,
          event: existingApiCall,
          usage: tokenBreakdown,
        };
      }

      // Lock subscription row for this tenant to prevent concurrent quota races.
      const subscription =
        await subscriptionRepository.findActiveWithPlanForUpdate(
          tenantId,
          client
        );

      if (!subscription) {
        await client.query("ROLLBACK");
        throw new Error("No active subscription");
      }

      const period = new Date();
      period.setDate(1);
      period.setHours(0, 0, 0, 0);

      // Read current usage BEFORE inserting new events.
      const currentApiCalls = await usageRepository.getMonthlyUsageByType(
        tenantId,
        "API_CALL",
        period,
        client
      );

      const currentAiTokens = await usageRepository.getMonthlyUsageByType(
        tenantId,
        "AI_TOKEN",
        period,
        client
      );

      // Explicitly validate: current_usage + requested_usage <= plan_limit
      const requestedApiCalls = 1;
      if (currentApiCalls + requestedApiCalls > subscription.api_calls_limit) {
        await client.query("ROLLBACK");
        throw new QuotaExceededError(
          "API_CALL",
          currentApiCalls + requestedApiCalls,
          subscription.api_calls_limit
        );
      }

      const requestedAiTokens = totalTokens;
      if (currentAiTokens + requestedAiTokens > subscription.ai_tokens_limit) {
        await client.query("ROLLBACK");
        throw new QuotaExceededError(
          "AI_TOKEN",
          currentAiTokens + requestedAiTokens,
          subscription.ai_tokens_limit
        );
      }

      // Quota check passed. Insert usage events.
      let apiCallResult;
      try {
        apiCallResult = await client.query(
          `INSERT INTO usage_events (tenant_id, type, quantity, idempotency_key, metadata)
           VALUES ($1, 'API_CALL', $2, $3, $4)
           RETURNING *`,
          [
            tenantId,
            requestedApiCalls,
            `generate_${idempotencyKey}`,
            JSON.stringify({ model, prompt_length: prompt.length }),
          ]
        );
      } catch (err) {
        if (err.code === "23505") {
          await client.query("ROLLBACK");
          const existing = await usageRepository.findByTenantAndIdempotencyKey(
            tenantId,
            `generate_${idempotencyKey}`
          );
          return { recorded: false, event: existing, usage: tokenBreakdown };
        }
        throw err;
      }

      let aiTokenResult;
      try {
        aiTokenResult = await client.query(
          `INSERT INTO usage_events (tenant_id, type, quantity, idempotency_key, metadata)
           VALUES ($1, 'AI_TOKEN', $2, $3, $4)
           RETURNING *`,
          [
            tenantId,
            requestedAiTokens,
            `generate_tokens_${idempotencyKey}`,
            JSON.stringify({
              model,
              breakdown: tokenBreakdown,
            }),
          ]
        );
      } catch (err) {
        if (err.code === "23505") {
          await client.query("ROLLBACK");
          const existing = await usageRepository.findByTenantAndIdempotencyKey(
            tenantId,
            `generate_tokens_${idempotencyKey}`
          );
          return { recorded: false, event: existing, usage: tokenBreakdown };
        }
        throw err;
      }

      await client.query("COMMIT");

      return {
        recorded: true,
        event: apiCallResult.rows[0],
        usage: tokenBreakdown,
        totalTokens,
      };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }

  _simulateTokenGeneration(prompt, model) {
    const promptLength = prompt ? prompt.length : 0;
    const estimatedInputTokens = Math.max(1, Math.ceil(promptLength / 4));
    const estimatedOutputTokens = Math.max(1, Math.ceil(estimatedInputTokens * 1.5));
    const cachedInputTokens = Math.floor(estimatedInputTokens * 0.3);
    const reasoningTokens = Math.floor(estimatedOutputTokens * 0.4);

    return {
      input: estimatedInputTokens - cachedInputTokens,
      cached_input: cachedInputTokens,
      output: estimatedOutputTokens - reasoningTokens,
      reasoning: reasoningTokens,
    };
  }
}

module.exports = { GeneratorService };
