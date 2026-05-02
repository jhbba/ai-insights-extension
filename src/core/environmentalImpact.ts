/**
 * Environmental impact estimation.
 * Based on research estimates for LLM inference energy consumption.
 * 
 * Sources:
 * - IEA energy estimates for data centers
 * - Luccioni et al. (2023) "Estimating the Carbon Footprint of BLOOM"
 * - WRI water usage estimates for cooling
 */

export interface EnvironmentalImpact {
  co2Grams: number;
  waterLiters: number;
  treeEquivalentYears: number;
}

// Estimated energy per 1M tokens (kWh) - average across model sizes
const KWH_PER_MILLION_TOKENS = 0.05;
// Average CO2 per kWh (grams) - US grid average
const CO2_GRAMS_PER_KWH = 390;
// Water usage per kWh (liters) - cooling estimates
const WATER_LITERS_PER_KWH = 1.8;
// A mature tree absorbs ~21,772g CO2 per year
const TREE_CO2_ABSORPTION_PER_YEAR = 21772;

export function calculateEnvironmentalImpact(totalTokens: number): EnvironmentalImpact {
  const energyKwh = (totalTokens / 1_000_000) * KWH_PER_MILLION_TOKENS;
  const co2Grams = energyKwh * CO2_GRAMS_PER_KWH;
  const waterLiters = energyKwh * WATER_LITERS_PER_KWH;
  const treeEquivalentYears = co2Grams / TREE_CO2_ABSORPTION_PER_YEAR;

  return {
    co2Grams: Math.round(co2Grams * 100) / 100,
    waterLiters: Math.round(waterLiters * 1000) / 1000,
    treeEquivalentYears: Math.round(treeEquivalentYears * 1000000) / 1000000,
  };
}
