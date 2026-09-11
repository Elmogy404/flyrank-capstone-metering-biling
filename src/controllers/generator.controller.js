const { GeneratorService } = require("../services/generator.service");
const { QuotaExceededError } = require("../services/meter.service");

class GeneratorController {
  constructor(generatorService) {
    this.generatorService = generatorService || new GeneratorService();
  }

  async generate(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { prompt, model, idempotency_key } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "prompt is required" });
      }

      if (!idempotency_key) {
        return res.status(400).json({ error: "idempotency_key is required" });
      }

      const result = await this.generatorService.generate({
        tenantId,
        prompt,
        model: model || "gpt-4",
        idempotencyKey: idempotency_key,
      });

      return res.status(200).json({
        recorded: result.recorded,
        usage: result.usage,
        total_tokens: result.totalTokens,
      });
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return res.status(429).json({
          error: "Quota exceeded",
          type: err.type,
          used: err.used,
          limit: err.limit,
        });
      }
      if (err.message === "No active subscription") {
        return res.status(404).json({ error: "No active subscription" });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}

module.exports = { GeneratorController };
