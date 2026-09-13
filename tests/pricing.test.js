const {
  TOKEN_PRICING,
  API_CALL_PRICING,
  MARKUP_NUMERATOR,
  MARKUP_DENOMINATOR,
  calculateCost,
  calculatePrice,
  calculateTotalCost,
  calculateTotalPrice,
} = require("../src/services/pricing");

describe("Pricing", () => {
  describe("TOKEN_PRICING", () => {
    test("has all four token categories", () => {
      expect(TOKEN_PRICING.input).toBeDefined();
      expect(TOKEN_PRICING.cached_input).toBeDefined();
      expect(TOKEN_PRICING.output).toBeDefined();
      expect(TOKEN_PRICING.reasoning).toBeDefined();
    });

    test("cached_input is cheaper than input", () => {
      expect(TOKEN_PRICING.cached_input.costMicroUnits).toBeLessThan(
        TOKEN_PRICING.input.costMicroUnits
      );
    });

    test("output is more expensive than input", () => {
      expect(TOKEN_PRICING.output.costMicroUnits).toBeGreaterThan(
        TOKEN_PRICING.input.costMicroUnits
      );
    });

    test("reasoning costs same as output", () => {
      expect(TOKEN_PRICING.reasoning.costMicroUnits).toBe(
        TOKEN_PRICING.output.costMicroUnits
      );
    });

    test("all costs are integers", () => {
      for (const category of Object.values(TOKEN_PRICING)) {
        expect(Number.isInteger(category.costMicroUnits)).toBe(true);
      }
    });
  });

  describe("API_CALL_PRICING", () => {
    test("is defined and has correct structure", () => {
      expect(API_CALL_PRICING).toBeDefined();
      expect(API_CALL_PRICING.name).toBe("api_call");
      expect(API_CALL_PRICING.costMicroUnits).toBe(50);
    });

    test("cost is an integer", () => {
      expect(Number.isInteger(API_CALL_PRICING.costMicroUnits)).toBe(true);
    });

    test("single API call cost is 50 microcents", () => {
      const cost = API_CALL_PRICING.costMicroUnits * 1;
      expect(cost).toBe(50);
    });

    test("10 API calls cost 500 microcents", () => {
      const cost = API_CALL_PRICING.costMicroUnits * 10;
      expect(cost).toBe(500);
    });

    test("API call price with markup is correct", () => {
      const cost = API_CALL_PRICING.costMicroUnits * 5;
      const price = Math.ceil((cost * MARKUP_NUMERATOR) / MARKUP_DENOMINATOR);
      expect(price).toBe(Math.ceil((250 * 3) / 2));
    });
  });

  describe("MARKUP", () => {
    test("is integer numerator/denominator (no floating point)", () => {
      expect(Number.isInteger(MARKUP_NUMERATOR)).toBe(true);
      expect(Number.isInteger(MARKUP_DENOMINATOR)).toBe(true);
      expect(MARKUP_DENOMINATOR).toBeGreaterThan(0);
    });

    test("represents a value greater than 1", () => {
      expect(MARKUP_NUMERATOR / MARKUP_DENOMINATOR).toBeGreaterThan(1);
    });
  });

  describe("calculateCost", () => {
    test("calculates cost for input tokens", () => {
      const cost = calculateCost("input", 1000);
      expect(cost).toBe(TOKEN_PRICING.input.costMicroUnits * 1000);
    });

    test("calculates cost for cached_input tokens", () => {
      const cost = calculateCost("cached_input", 500);
      expect(cost).toBe(TOKEN_PRICING.cached_input.costMicroUnits * 500);
    });

    test("returns 0 for 0 quantity", () => {
      expect(calculateCost("input", 0)).toBe(0);
    });

    test("throws for unknown category", () => {
      expect(() => calculateCost("unknown", 100)).toThrow(
        "Unknown token category: unknown"
      );
    });

    test("throws for negative quantity", () => {
      expect(() => calculateCost("input", -1)).toThrow(
        "quantity must be a non-negative integer"
      );
    });

    test("throws for non-integer quantity", () => {
      expect(() => calculateCost("input", 1.5)).toThrow(
        "quantity must be a non-negative integer"
      );
    });
  });

  describe("calculatePrice", () => {
    test("applies markup to cost using integer arithmetic", () => {
      const price = calculatePrice("input", 1000);
      const rawCost = TOKEN_PRICING.input.costMicroUnits * 1000;
      const expectedPrice = Math.ceil((rawCost * MARKUP_NUMERATOR) / MARKUP_DENOMINATOR);
      expect(price).toBe(expectedPrice);
    });

    test("price is greater than cost", () => {
      const cost = calculateCost("input", 1000);
      const price = calculatePrice("input", 1000);
      expect(price).toBeGreaterThan(cost);
    });

    test("no floating point in calculation", () => {
      const price = calculatePrice("input", 7);
      expect(Number.isInteger(price)).toBe(true);
    });
  });

  describe("calculateTotalCost", () => {
    test("sums costs across categories", () => {
      const total = calculateTotalCost({
        input: 100,
        cached_input: 50,
        output: 200,
        reasoning: 0,
      });

      const expected =
        TOKEN_PRICING.input.costMicroUnits * 100 +
        TOKEN_PRICING.cached_input.costMicroUnits * 50 +
        TOKEN_PRICING.output.costMicroUnits * 200 +
        TOKEN_PRICING.reasoning.costMicroUnits * 0;

      expect(total).toBe(expected);
    });

    test("returns 0 for empty breakdown", () => {
      expect(calculateTotalCost({})).toBe(0);
    });
  });

  describe("calculateTotalPrice", () => {
    test("applies markup to total cost using integer arithmetic", () => {
      const totalCost = calculateTotalCost({
        input: 100,
        output: 200,
      });
      const totalPrice = calculateTotalPrice({
        input: 100,
        output: 200,
      });

      expect(totalPrice).toBe(Math.ceil((totalCost * MARKUP_NUMERATOR) / MARKUP_DENOMINATOR));
    });

    test("result is integer", () => {
      const price = calculateTotalPrice({ input: 7, output: 3 });
      expect(Number.isInteger(price)).toBe(true);
    });
  });
});
