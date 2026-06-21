/**
 * economicOptimization.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared economic objective for all three optimizers (wall, slab, footing).
 *
 * This file documents the cost_index formula and provides the helper function
 * that the optimizeWall / optimizeSlab / optimizeFooting functions must call
 * to select the best feasible candidate.
 *
 * PASTE THE computeCostIndex FUNCTION INTO EACH ENGINE FILE
 * and update the optimize* signatures as shown below.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  VOLUMETRIC COST RATIO (r)
 *  ─────────────────────────
 *  cost_index = V_concrete (m³)  +  V_steel (m³) × r
 *
 *  V_steel = steelWeight_kg / ρ_steel
 *  ρ_steel = 7850 kg/m³
 *
 *  Therefore:
 *  cost_index = concreteVol_m3  +  steelWeight_kg × (r / 7850)
 *
 *  r derivation (India, mid-2025):
 *    P_steel   ≈ ₹52–58 / kg  →  use ₹57/kg
 *    P_concrete ≈ ₹4,500–6,400 / m³ (M20–M25 RMC)  →  use ₹5,000/m³
 *    r = (7850 × 57) / 5000 = 447,450 / 5000 ≈ 89.5  →  use 90 as default
 *
 *  STEEL DENSITY CONVERSION CONSTANT:
 *    K = r / ρ_steel = 90 / 7850 ≈ 0.01147  m³-concrete-equivalent per kg-steel
 *
 *  ECONOMIC INTERPRETATION:
 *    Every 1/K = 87.2 kg of steel has the same cost as 1 m³ of concrete.
 *    The optimizer therefore correctly penalises designs that save a tiny bit
 *    of concrete by using a large amount of expensive steel.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  REQUIRED SIGNATURE CHANGES IN ENGINE FILES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  wallEngine.ts
 *  ─────────────
 *  BEFORE:
 *    export function optimizeWall(
 *        config: WallConfig,
 *        onProgress?: (done: number, total: number, feasible: number) => void,
 *    ): OptimizeResult
 *
 *  AFTER:
 *    export function optimizeWall(
 *        config: WallConfig,
 *        costRatio: number = 90,
 *        onProgress?: (done: number, total: number, feasible: number) => void,
 *    ): OptimizeResult
 *
 *  slabEngine.ts
 *  ─────────────
 *  BEFORE:
 *    export function optimizeSlab(
 *        config: SlabConfig,
 *        thicknesses: number[],
 *        onProgress?: (done: number, total: number, feasible: number) => void,
 *    ): SlabOptimizeResult
 *
 *  AFTER:
 *    export function optimizeSlab(
 *        config: SlabConfig,
 *        thicknesses: number[],
 *        costRatio: number = 90,
 *        onProgress?: (done: number, total: number, feasible: number) => void,
 *    ): SlabOptimizeResult
 *
 *  footingEngine.ts
 *  ────────────────
 *  BEFORE:
 *    export function optimizeFooting(
 *        config: FootingConfig,
 *        params: FootingOptimizeParams,
 *        onProgress?: (done: number, total: number, feasible: number) => void,
 *    ): FootingOptimizeResult
 *
 *  AFTER:
 *    export function optimizeFooting(
 *        config: FootingConfig,
 *        params: FootingOptimizeParams,
 *        costRatio: number = 90,
 *        onProgress?: (done: number, total: number, feasible: number) => void,
 *    ): FootingOptimizeResult
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Shared constant ──────────────────────────────────────────────────────────

/** Density of rebar steel in kg/m³ (used to convert weight → volume). */
const STEEL_DENSITY_KG_M3 = 7850;

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Compute the economic cost index for a single design candidate.
 *
 * @param concreteVol_m3  - Total concrete volume of the element (m³).
 * @param steelWeight_kg  - Total rebar weight of the element (kg).
 * @param costRatio       - Volumetric cost ratio r = P_steel_per_m3 / P_concrete_per_m3.
 *                          Default 90 (India mid-2025).
 * @returns cost_index in units of m³-concrete-equivalent.
 *
 * @example
 *   // 0.5 m³ concrete, 120 kg steel, default ratio
 *   computeCostIndex(0.5, 120, 90)
 *   // = 0.5 + 120 * (90 / 7850) = 0.5 + 1.376 = 1.876 m³-equivalent
 */
export function computeCostIndex(
    concreteVol_m3: number,
    steelWeight_kg: number,
    costRatio: number,
): number {
    return concreteVol_m3 + steelWeight_kg * (costRatio / STEEL_DENSITY_KG_M3);
}

// ─── Usage pattern for all three optimize functions ───────────────────────────

/*
 * PASTE THIS PATTERN INTO THE BRUTE-FORCE LOOP OF EACH optimize* FUNCTION:
 *
 *   let bestCostIndex = Infinity;
 *   let bestResult: <YourResultType> | null = null;
 *
 *   for (const candidate of allCombinations) {
 *       const analysis = analyze<Element>(candidate);   // analyzeWall / analyzeSlab / analyzeFooting
 *
 *       if (analysis.overallStatus !== 'SAFE') continue;  // skip infeasible
 *
 *       const ci = computeCostIndex(
 *           analysis.concreteVol_m3,
 *           analysis.steelWeight_kg,
 *           costRatio,                                    // passed from worker
 *       );
 *
 *       if (ci < bestCostIndex) {
 *           bestCostIndex = ci;
 *           bestResult    = { ...analysis, costIndex: ci };
 *       }
 *
 *       onProgress?.(++done, total, feasible);
 *   }
 *
 *   if (!bestResult) throw new Error('No feasible design found in search space.');
 *   return bestResult;
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMMON BUGS THIS PATTERN PREVENTS:
 *
 *  ✗  if (candidate.concreteVol < best.concreteVol)  → ignores steel, biases
 *                                                        toward thin + heavy designs
 *
 *  ✗  if (candidate.steelWeight < best.steelWeight)  → ignores concrete, biases
 *                                                        toward thick + lightly
 *                                                        reinforced designs
 *
 *  ✓  if (costIndex(candidate) < bestCostIndex)      → correct economic minimum
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ALSO ADD costIndex to the result types so the UI can display it:
 *
 *   export interface OptimizeResult {
 *       // ... existing fields ...
 *       costIndex:    number;   // m³-concrete-equivalent (lower = cheaper)
 *       costRatioUsed: number;  // echo back the r that was applied
 *   }
 */
