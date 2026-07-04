/**
 * Validation tests for the 2026-07-04 v3 optimizer audit fixes.
 *
 * Four cost-calculation bugs were fixed across the optimizers:
 *
 *   OPT-1 (CRITICAL): flatSlabEngine.ts — steel weight was missing the panel
 *     area, under-reporting steel by ~12× for a 6 m panel. The optimizer's
 *     cost ranking was dominated by concrete + formwork, effectively ignoring
 *     steel cost. A design with heavy rebar but slightly less concrete would
 *     be wrongly preferred.
 *
 *   OPT-2 (CRITICAL): retainingWallEngine.ts — optimizer only minimized
 *     CONCRETE VOLUME, ignoring steel entirely. A wall with a thin stem +
 *     heavy rebar would be preferred over a wall with a slightly thicker
 *     stem + light rebar, even if the latter was cheaper. The fix uses the
 *     shared `computeCost` helper (concrete + steel + formwork) and returns
 *     a proper `RetainingWallOptimizeResult` shape.
 *
 *   OPT-3 (HIGH): cantileverSlabEngine.ts — `costIndex` returned a
 *     dimensionless "concrete-equivalent volume" (`concreteVol + steelWeight
 *     × (costRatio/7850)`), inconsistent with the slab/flat-slab/waffle-slab
 *     optimizers which return INR. The fix uses `computeCost` and renames
 *     `costIndex` → `costTotal_INR` (UI updated accordingly).
 *
 *   OPT-4 (HIGH): wallEngine.ts + footingEngine.ts — used `computeCostIndex`
 *     which omits formwork. For walls, formwork is ~20% of total cost
 *     (2 × H × B faces × ₹350/m²); for footings, ~8%. The fix uses
 *     `computeCost` with the proper formwork area. Also fixes floating-point
 *     accumulation in the footing sweep loops.
 *
 *   OPT-5 (MEDIUM): flatSlabEngine.ts — `flexure_u` only checked the column-
 *     strip positive moment zone. The governing utilization is the MAX across
 *     all four zones (col/mid × pos/neg).
 */

import { optimizeRetainingWall } from '../components/retainingWallEngine';
import { optimizeCantileverSlab } from '../components/cantileverSlabEngine';
import { optimizeFlatSlab } from '../components/flatSlabEngine';
import { optimizeFooting } from '../components/footingEngine';
import { optimizeWall } from '../components/wallEngine';
import { computeCost } from '../lib/is456';

// ─── Helpers ──────────────────────────────────────────────────────────────

const INR_TOLERANCE = 0.01; // 1% tolerance for cost comparisons

// ─── OPT-1: Flat slab steel weight ────────────────────────────────────────

describe('OPT-1: flat slab steel weight includes panel area', () => {
    test('steel weight is ~12× larger than the buggy formula for a 6 m panel', () => {
        const result = optimizeFlatSlab({
            L1: 6, L2: 6, c1: 0.4, c2: 0.4,
            hasDrop: false, dropL1: 0, dropL2: 0, dropDepth: 200,
            D: 200, cover: 25, fck: 25, fy: 500,
            w_live: 3, w_finish: 1.5,
            panelType: 'interior',
        }, {
            minD: 200, maxD: 220, stepD: 20,
            barDias: [12],
            barSpacings: [150],
        });

        expect(result.feasibleCount).toBeGreaterThan(0);
        const opt = result.optimum!;
        expect(opt).not.toBeNull();

        // For a 6 m × 6 m panel, the corrected steel weight should be in the
        // hundreds of kg, not tens of kg. The buggy formula gave ~40 kg for
        // a 6 m panel; the correct value is ~490 kg.
        expect(opt.steelWeight_gross).toBeGreaterThan(100);

        // Steel cost should be a meaningful fraction of total cost (> 10%).
        // With the bug, steel was < 5% of total.
        const steelFraction = opt.costBreakdown.steel_INR / opt.costTotal_INR;
        expect(steelFraction).toBeGreaterThan(0.10);
    });

    test('cost breakdown components sum to total cost', () => {
        const result = optimizeFlatSlab({
            L1: 5, L2: 5, c1: 0.4, c2: 0.4,
            hasDrop: false, dropL1: 0, dropL2: 0, dropDepth: 200,
            D: 180, cover: 25, fck: 25, fy: 500,
            w_live: 3, w_finish: 1.5,
            panelType: 'interior',
        }, {
            minD: 180, maxD: 220, stepD: 20,
            barDias: [12, 16],
            barSpacings: [125, 150, 175],
        });

        if (result.optimum) {
            const o = result.optimum;
            const sum = o.costBreakdown.concrete_INR + o.costBreakdown.steel_INR + o.costBreakdown.formwork_INR;
            // Sum should match costTotal_INR within 1% (rounding tolerance)
            expect(Math.abs(sum - o.costTotal_INR) / o.costTotal_INR).toBeLessThan(INR_TOLERANCE);
        }
    });
});

// ─── OPT-2: Retaining wall cost-based optimization ────────────────────────

describe('OPT-2: retaining wall optimizer uses cost (not just concrete volume)', () => {
    const baseInput = {
        H: 4000, D_stem_base: 400, D_stem_top: 200, D_base: 400,
        B: 2400, B_toe: 600,
        phi: 30, gamma_soil: 18, gamma_concrete: 24, q_surcharge: 10,
        mu: 0.45, sbc: 200, waterTableDepth: 0,
        fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500',
        cover: 50, loadFactor: 1.5,
    };

    test('optimizer returns a proper RetainingWallOptimizeResult shape', () => {
        const r = optimizeRetainingWall(baseInput, {
            minB: 2400, maxB: 3500, stepB: 100,
            minThk: 350, maxThk: 500, stepThk: 50,
        });
        expect(r).toHaveProperty('totalTrials');
        expect(r).toHaveProperty('feasibleCount');
        expect(r).toHaveProperty('topDesigns');
        expect(r).toHaveProperty('optimum');
        expect(r).toHaveProperty('costParams');
        // Legacy fields (bestResult, minVol, total) are GONE.
        expect(r).not.toHaveProperty('bestResult');
        expect(r).not.toHaveProperty('minVol');
    });

    test('optimum has costTotal_INR, concreteVol, steelWeight', () => {
        const r = optimizeRetainingWall(baseInput, {
            minB: 2400, maxB: 4000, stepB: 100,
            minThk: 300, maxThk: 600, stepThk: 50,
        });
        expect(r.feasibleCount).toBeGreaterThan(0);
        const o = r.optimum!;
        expect(o).not.toBeNull();
        expect(typeof o.costTotal_INR).toBe('number');
        expect(o.costTotal_INR).toBeGreaterThan(0);
        expect(typeof o.concreteVol).toBe('number');
        expect(o.concreteVol).toBeGreaterThan(0);
        expect(typeof o.steelWeight).toBe('number');
        expect(o.steelWeight).toBeGreaterThan(0);
    });

    test('topDesigns are sorted by costTotal_INR ascending', () => {
        const r = optimizeRetainingWall(baseInput, {
            minB: 2400, maxB: 4000, stepB: 100,
            minThk: 300, maxThk: 600, stepThk: 50,
        });
        for (let i = 1; i < r.topDesigns.length; i++) {
            expect(r.topDesigns[i].costTotal_INR)
                .toBeGreaterThanOrEqual(r.topDesigns[i - 1].costTotal_INR);
        }
    });

    test('costTotal_INR matches computeCost(concrete + steel + formwork)', () => {
        const r = optimizeRetainingWall(baseInput, {
            minB: 2400, maxB: 4000, stepB: 100,
            minThk: 300, maxThk: 600, stepThk: 50,
        });
        const o = r.optimum!;
        // Hand-compute: formwork = 2 × H_stem (both faces of stem) + B (top of base)
        //   — matches the engine's formula `2 * (r.H_stem / 1000) + (r.B / 1000)`.
        const formworkArea = 2 * (o.result.H_stem / 1000) + (o.B / 1000);
        const expected = computeCost(o.concreteVol, o.steelWeight, formworkArea, r.costParams);
        expect(o.costTotal_INR).toBeCloseTo(expected, 0);
    });
});

// ─── OPT-3: Cantilever INR cost ───────────────────────────────────────────

describe('OPT-3: cantilever optimizer returns INR (not m³-equivalent)', () => {
    test('optimum has costTotal_INR, not costIndex', () => {
        const r = optimizeCantileverSlab({
            L: 1.5, D: 200, cover: 25, fck: 25, fy: 500,
            w_live: 3, w_finish: 1.5,
            bar_main: 12, spacing_main: 150,
            bar_dist: 10, spacing_dist: 200,
        }, { minD: 150, maxD: 250, stepD: 25 });

        expect(r.feasibleCount).toBeGreaterThan(0);
        const o = r.optimum!;
        expect(o).not.toBeNull();
        expect(o).toHaveProperty('costTotal_INR');
        expect(o).not.toHaveProperty('costIndex'); // legacy field removed
        expect(typeof o.costTotal_INR).toBe('number');
        expect(o.costTotal_INR).toBeGreaterThan(100); // INR, not m³-equivalent
    });

    test('costBreakdown components are present and sum to total', () => {
        const r = optimizeCantileverSlab({
            L: 1.5, D: 200, cover: 25, fck: 25, fy: 500,
            w_live: 3, w_finish: 1.5,
            bar_main: 12, spacing_main: 150,
            bar_dist: 10, spacing_dist: 200,
        }, { minD: 150, maxD: 250, stepD: 25 });

        const o = r.optimum!;
        expect(o.costBreakdown).toBeDefined();
        const sum = o.costBreakdown.concrete_INR + o.costBreakdown.steel_INR + o.costBreakdown.formwork_INR;
        expect(Math.abs(sum - o.costTotal_INR) / o.costTotal_INR).toBeLessThan(INR_TOLERANCE);
    });

    test('result has costParams (not costRatioUsed)', () => {
        const r = optimizeCantileverSlab({
            L: 1.5, D: 200, cover: 25, fck: 25, fy: 500,
            w_live: 3, w_finish: 1.5,
            bar_main: 12, spacing_main: 150,
            bar_dist: 10, spacing_dist: 200,
        }, { minD: 150, maxD: 250, stepD: 25 });
        expect(r).toHaveProperty('costParams');
        expect(r).not.toHaveProperty('costRatioUsed');
    });
});

// ─── OPT-4: Wall and footing optimizers include formwork ──────────────────

describe('OPT-4: wall optimizer includes formwork in cost', () => {
    test('OptimumDesign has formworkArea field', () => {
        const r = optimizeWall({
            zones: [{ height: 4, thickness: 400 }],
            soilParams: {
                phi: 30, gamma_soil: 18, gamma_water: 9.81,
                waterTableDepth: 999, groundLevelDepth: 0,
                waterMode: 'dry', surcharge: 10,
            },
            material: { grade: 'M25', fck: 25, steelGrade: 'Fe500', fy: 500, cover: 40 },
            loadFactor: 1.5,
            minThk: 300, maxThk: 500, thkStep: 50,
        } as any);

        // If any feasible design exists, the optimum should have formworkArea
        if (r.optimum) {
            expect(r.optimum).toHaveProperty('formworkArea');
            expect(r.optimum.formworkArea).toBeGreaterThan(0);
            // Formwork area = 2 × totalHeight (both faces of wall)
            expect(r.optimum.formworkArea).toBeCloseTo(2 * r.optimum.result.totalHeight, 1);
        }
    });

    test('costIndex now includes formwork (higher than old concrete+steel only)', () => {
        const r = optimizeWall({
            zones: [{ height: 4, thickness: 400 }],
            soilParams: {
                phi: 30, gamma_soil: 18, gamma_water: 9.81,
                waterTableDepth: 999, groundLevelDepth: 0,
                waterMode: 'dry', surcharge: 10,
            },
            material: { grade: 'M25', fck: 25, steelGrade: 'Fe500', fy: 500, cover: 40 },
            loadFactor: 1.5,
            minThk: 300, maxThk: 500, thkStep: 50,
        } as any);

        if (r.optimum) {
            const o = r.optimum;
            // Old cost (without formwork) = 6500 × vol + 90 × steel × 1.07
            const oldCost = 6500 * o.concreteVol + 90 * o.steelWeight * 1.07;
            // New cost (with formwork) must be higher
            expect(o.costIndex).toBeGreaterThan(oldCost);
        }
    });
});

describe('OPT-4: footing optimizer includes formwork in cost', () => {
    test('costIndex now includes formwork (higher than old concrete+steel only)', () => {
        const r = optimizeFooting({
            label: 'F1', footingType: 'flat',
            col_a: 400, col_b: 400,
            loadCases: [{ label: 'LC1', Fy: 800, Mx: 0, Mz: 0, sbc: 200 }],
            Fy: 800, Mx: 0, Mz: 0, sbc: 200,
            depthFill: 1.0, gammaFill: 18, gammaConcrete: 25,
            fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500',
            cover: 50, barDiaX: 16, barDiaZ: 16,
            L: 2.5, B: 2.5, D: 0.5,
            pedestalOffset: 0, pedestal_a: 400, pedestal_b: 400,
        }, {
            minL: 2.0, maxL: 3.0, stepL: 0.25,
            minB: 2.0, maxB: 3.0, stepB: 0.25,
            minD: 0.4, maxD: 0.6, stepD: 0.1,
        });

        if (r.optimum) {
            const o = r.optimum;
            // Old cost (without formwork) = 6500 × vol + 90 × steel × 1.07
            const oldCost = 6500 * o.volume + 90 * (r.optimum.result.flexureX.Ast_req * o.L + r.optimum.result.flexureZ.Ast_req * o.B) * 7850 / 1e6 * 1.07;
            // New cost (with formwork) must be higher
            expect(o.costIndex).toBeGreaterThan(oldCost);
        }
    });

    test('integer-indexed loops visit exactly numL × numB × numD trials', () => {
        const r = optimizeFooting({
            label: 'F1', footingType: 'flat',
            col_a: 400, col_b: 400,
            loadCases: [{ label: 'LC1', Fy: 800, Mx: 0, Mz: 0, sbc: 200 }],
            Fy: 800, Mx: 0, Mz: 0, sbc: 200,
            depthFill: 1.0, gammaFill: 18, gammaConcrete: 25,
            fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500',
            cover: 50, barDiaX: 16, barDiaZ: 16,
            L: 2.5, B: 2.5, D: 0.5,
            pedestalOffset: 0, pedestal_a: 400, pedestal_b: 400,
        }, {
            minL: 2.0, maxL: 3.0, stepL: 0.25,   // 5 values
            minB: 2.0, maxB: 3.0, stepB: 0.25,   // 5 values
            minD: 0.4, maxD: 0.6, stepD: 0.1,    // 3 values
        });
        // 5 × 5 × 3 = 75 trials (no floating-point miss)
        expect(r.totalTrials).toBe(75);
    });
});

// ─── OPT-5: Flat slab flexure_u uses MAX of all 4 zones ──────────────────

describe('OPT-5: flat slab flexure_u uses MAX of all 4 zones', () => {
    test('flexure_u is the max across col/mid × pos/neg zones', () => {
        const r = optimizeFlatSlab({
            L1: 6, L2: 6, c1: 0.4, c2: 0.4,
            hasDrop: false, dropL1: 0, dropL2: 0, dropDepth: 200,
            D: 200, cover: 25, fck: 25, fy: 500,
            w_live: 3, w_finish: 1.5,
            panelType: 'interior',
        }, {
            minD: 200, maxD: 220, stepD: 20,
            barDias: [12, 16],
            barSpacings: [125, 150, 175],
        });

        if (r.optimum) {
            const o = r.optimum;
            const res = o.result;
            const Ast_provided_defl = (1000 / o.bar_spacing) * (Math.PI * o.bar_dia * o.bar_dia / 4);
            // The governing flexure utilization should be the MAX across all 4 zones
            const expected = Math.max(
                res.Ast_pos_col / res.colStripWidth,
                res.Ast_neg_col / res.colStripWidth,
                res.Ast_pos_mid / res.midStripWidth,
                res.Ast_neg_mid / res.midStripWidth,
            ) / Ast_provided_defl;
            expect(o.utilizationRatio.flexure).toBeCloseTo(expected, 3);
        }
    });
});
