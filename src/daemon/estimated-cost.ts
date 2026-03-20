/** Per-million-token pricing for Claude models (API rates, not subscription). */
const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  opus: { inputPerM: 5, outputPerM: 25 },
  sonnet: { inputPerM: 3, outputPerM: 15 },
  haiku: { inputPerM: 1, outputPerM: 5 },
};

function matchPricing(model: string): { inputPerM: number; outputPerM: number } | null {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return MODEL_PRICING.opus;
  if (lower.includes('sonnet')) return MODEL_PRICING.sonnet;
  if (lower.includes('haiku')) return MODEL_PRICING.haiku;
  return null;
}

/** Estimate what the API cost would be for the given token counts and model. */
export function estimateCost(model: string | null, inputTokens: number, outputTokens: number): number | null {
  if (!model) return null;
  const pricing = matchPricing(model);
  if (!pricing) return null;
  return (inputTokens / 1_000_000) * pricing.inputPerM + (outputTokens / 1_000_000) * pricing.outputPerM;
}
