"use strict";

/**
 * AI token pricing constants.
 * All values are in integer microcents (1/100,000 of a cent) to avoid floating point.
 *
 * Markup is applied server-side via calculatePrice() — never raw provider cost.
 * Client input is ignored for pricing decisions.
 */

const TOKEN_PRICING = {
  input: { name: "input", costMicroUnits: 100 },
  cached_input: { name: "cached_input", costMicroUnits: 10 },
  output: { name: "output", costMicroUnits: 300 },
  reasoning: { name: "reasoning", costMicroUnits: 300 },
};

const MARKUP_NUMERATOR = 3;
const MARKUP_DENOMINATOR = 2;

function calculateCost(tokenCategory, quantity) {
  const pricing = TOKEN_PRICING[tokenCategory];
  if (!pricing) {
    throw new Error(`Unknown token category: ${tokenCategory}`);
  }
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error("quantity must be a non-negative integer");
  }
  return pricing.costMicroUnits * quantity;
}

function calculatePrice(tokenCategory, quantity) {
  return Math.ceil((calculateCost(tokenCategory, quantity) * MARKUP_NUMERATOR) / MARKUP_DENOMINATOR);
}

function calculateTotalCost(breakdown) {
  let total = 0;
  for (const [category, quantity] of Object.entries(breakdown)) {
    total += calculateCost(category, quantity);
  }
  return total;
}

function calculateTotalPrice(breakdown) {
  let total = 0;
  for (const [category, quantity] of Object.entries(breakdown)) {
    total += calculatePrice(category, quantity);
  }
  return total;
}

module.exports = {
  TOKEN_PRICING,
  MARKUP_NUMERATOR,
  MARKUP_DENOMINATOR,
  calculateCost,
  calculatePrice,
  calculateTotalCost,
  calculateTotalPrice,
};
