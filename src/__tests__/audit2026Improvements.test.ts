/**
 * Validation tests for the 2026-07-04 v4 optimizer improvements.
 *
 * Five improvements were made to help the optimizers find truly optimum
 * size AND reinforcement:
 *
 *   IMP-1: Added developmentLength() + checkDevelopmentLength() to is456.ts
 *          (IS 456 cl. 26.2.1). Previously missing from the entire codebase.
 *
 *   IMP-2: Added checkBarSpacing() to is456.ts (IS 456 cl. 26.3.3).
 *          Enforces max spacing ≤ min(3d, 300) for main bars, ≤ min(5d, 450)
 *          for distribution bars, and max bar dia ≤ D/8.
 *
 *   IMP-3: Footing engine now selects actual bars via selectBars() and
 *          exposes flexureX.bars / flexureZ.bars (dia, spacing, Ast_provided).
 *          The optimizer uses Ast_provided (not Ast_req) for steel weight —
 *          fixing a 5-20% under-estimation.
 *
 *   IMP-4: Wall engine now includes distribution steel (0.12% × b × t on
 *          both faces, IS 456 cl. 26.5.2.1) in totalSteelWeight. Previously
 *          only main flexural steel was counted.
 *
 *   IMP-5: New optimizeSlabExtended() function sweeps thickness + bar dia +
 *          bar spacing (3 dimensions). The legacy optimizeSlab() only swept
 *          thickness. The extended version enforces IS 456 cl. 26.3.3 spacing
 *          constraints as hard feasibility pre-filters.
 */

import {
    developmentLength,
    checkDevelopmentLength,
    getTauBd,
    checkBarSpacing,
} from '../lib/is456';
import { analyzeFooting } from '../components/footingEngine';
import { analyzeWall } from '../components/wallEngine';
import { optimizeSlabExtended } from '../components/slabEngine';

// ─── IMP-1: Development length ────────────────────────────────────────────

describe('IMP-1: development length (IS 456 cl. 26.2.1)', () => {
    test('Ld = (φ × 0.87 × fy) / (4 × τbd) — 16mm Fe500 in M25', () => {
        // τbd_plain (M25) = 1.4; deformed × 1.6 = 2.24
        // Ld = (16 × 0.87 × 500) / (4 × 2.24) = 6960 / 8.96 = 776.8 mm
        const Ld = developmentLength(16, 500, 'M25');
        expect(Ld).toBeCloseTo(776.8, 1);
    });

    test('deformed bars get +60% bond stress (cl. 26.2.1.1)', () => {
        const tau_plain = getTauBd('M25', false, false);  // 1.4
        const tau_deformed = getTauBd('M25', true, false); // 1.4 × 1.6 = 2.24
        expect(tau_plain).toBeCloseTo(1.4, 2);
        expect(tau_deformed).toBeCloseTo(2.24, 2);
        expect(tau_deformed / tau_plain).toBeCloseTo(1.6, 2);
    });

    test('compression bars get +25% bond stress (cl. 26.2.1.2)', () => {
        const tau_tension = getTauBd('M25', true, false);
        const tau_compression = getTauBd('M25', true, true);
        expect(tau_compression / tau_tension).toBeCloseTo(1.25, 2);
    });

    test('Ld scales linearly with bar diameter', () => {
        const Ld_12 = developmentLength(12, 500, 'M25');
        const Ld_16 = developmentLength(16, 500, 'M25');
        const Ld_20 = developmentLength(20, 500, 'M25');
        // Ld ∝ φ, so Ld_16 / Ld_12 = 16/12, Ld_20 / Ld_12 = 20/12
        expect(Ld_16 / Ld_12).toBeCloseTo(16 / 12, 3);
        expect(Ld_20 / Ld_12).toBeCloseTo(20 / 12, 3);
    });

    test('checkDevelopmentLength returns ok + ratio', () => {
        // 16mm Fe500 in M25: Ld = 776.8 mm
        const check = checkDevelopmentLength(16, 500, 'M25', 800);
        expect(check.Ld).toBeCloseTo(776.8, 1);
        expect(check.available).toBe(800);
        expect(check.ok).toBe(true);
        expect(check.ratio).toBeCloseTo(800 / 776.8, 2);
    });

    test('checkDevelopmentLength fails when available < Ld', () => {
        const check = checkDevelopmentLength(20, 500, 'M25', 900);
        // Ld_20 = 20/16 × 776.8 = 971 mm > 900
        expect(check.Ld).toBeGreaterThan(900);
        expect(check.ok).toBe(false);
        expect(check.ratio).toBeLessThan(1.0);
    });

    test('stressRatio reduces Ld for over-provided sections', () => {
        // If Ast_provided = 2 × Ast_req, the bar only develops 50% of fy.
        // Ld is halved.
        const Ld_full = developmentLength(16, 500, 'M25', true, false, 1.0);
        const Ld_half = developmentLength(16, 500, 'M25', true, false, 0.5);
        expect(Ld_half).toBeCloseTo(Ld_full * 0.5, 1);
    });
});

// ─── IMP-2: Bar spacing constraints ───────────────────────────────────────

describe('IMP-2: bar spacing constraints (IS 456 cl. 26.3.3)', () => {
    test('max main spacing = min(3d, 300)', () => {
        // D=200, d=175: 3d = 525, capped at 300
        const bs = checkBarSpacing(200, 175, 12, 150);
        expect(bs.maxSpacingMain).toBe(300);
    });

    test('max distribution spacing = min(5d, 450)', () => {
        const bs = checkBarSpacing(200, 175, 12, 150, 200);
        // 5d = 875, capped at 450
        expect(bs.maxSpacingDist).toBe(450);
    });

    test('max bar dia = D/8', () => {
        const bs = checkBarSpacing(200, 175, 12, 150);
        expect(bs.maxBarDia).toBe(25); // 200/8 = 25
    });

    test('fails when main spacing exceeds 3d or 300', () => {
        const bs = checkBarSpacing(200, 175, 12, 350);
        expect(bs.spacingMainOK).toBe(false);
        expect(bs.ok).toBe(false);
        expect(bs.messages.length).toBeGreaterThan(0);
    });

    test('fails when bar dia exceeds D/8', () => {
        const bs = checkBarSpacing(100, 85, 16, 150);
        // D/8 = 12.5, bar dia = 16 > 12.5
        expect(bs.barDiaOK).toBe(false);
        expect(bs.ok).toBe(false);
    });

    test('passes for a valid slab configuration', () => {
        const bs = checkBarSpacing(200, 175, 12, 150, 200);
        expect(bs.ok).toBe(true);
        expect(bs.messages.length).toBe(0);
    });

    test('minimum spacing = barDia + 5mm (concrete flow)', () => {
        // 12mm bar at 100mm spacing: 100 >= 12 + 5 = 17, so OK
        const bs = checkBarSpacing(200, 175, 12, 100);
        expect(bs.minSpacing).toBe(17);
        expect(bs.spacingMainOK).toBe(true);
    });
});

// ─── IMP-3: Footing Ast_provided ──────────────────────────────────────────

describe('IMP-3: footing engine exposes Ast_provided (actual bars)', () => {
    const baseConfig = {
        label: 'F1', footingType: 'flat' as const,
        col_a: 400, col_b: 400,
        loadCases: [{ label: 'LC1', Fy: 1000, Mx: 0, Mz: 0, sbc: 200 }],
        Fy: 1000, Mx: 0, Mz: 0, sbc: 200,
        depthFill: 1.0, gammaFill: 18, gammaConcrete: 25,
        fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500',
        cover: 50, barDiaX: 16, barDiaZ: 16,
        L: 2.5, B: 2.5, D: 0.5,
        pedestalOffset: 0, pedestal_a: 400, pedestal_b: 400,
    };

    test('flexureX.bars is populated with dia, spacing, Ast_provided', () => {
        const r = analyzeFooting(baseConfig);
        expect(r.flexureX.bars).not.toBeNull();
        expect(r.flexureX.bars!.dia).toBeGreaterThan(0);
        expect(r.flexureX.bars!.spacing).toBeGreaterThan(0);
        expect(r.flexureX.bars!.Ast_provided).toBeGreaterThan(0);
        expect(r.flexureX.bars!.label).toContain('mm');
    });

    test('Ast_provided >= Ast_req (selectBars rounds up)', () => {
        const r = analyzeFooting(baseConfig);
        expect(r.flexureX.bars!.Ast_provided).toBeGreaterThanOrEqual(r.flexureX.Ast_req);
        expect(r.flexureZ.bars!.Ast_provided).toBeGreaterThanOrEqual(r.flexureZ.Ast_req);
    });

    test('Ast_provided is typically 5-20% higher than Ast_req', () => {
        const r = analyzeFooting(baseConfig);
        const overheadX = r.flexureX.bars!.Ast_provided / r.flexureX.Ast_req;
        expect(overheadX).toBeGreaterThan(1.0);
        expect(overheadX).toBeLessThan(1.25); // < 25% overhead
    });
});

// ─── IMP-4: Wall distribution steel ───────────────────────────────────────

describe('IMP-4: wall engine includes distribution steel in weight', () => {
    test('totalSteelWeight > main steel alone (distribution steel added)', () => {
        const r = analyzeWall({
            zones: [{ height: 4, thickness: 400 }],
            soilParams: {
                phi: 30, gamma_soil: 18, gamma_water: 9.81,
                waterTableDepth: 999, groundLevelDepth: 0,
                waterMode: 'dry', surcharge: 10,
            },
            material: { grade: 'M25', fck: 25, steelGrade: 'Fe500', fy: 500, cover: 40 },
            loadFactor: 1.5,
        });

        // Compute main steel only (the old formula)
        const zd = r.zoneDesigns[0];
        const mainSteelOnly = ((zd.mainBars_hogging.Ast_provided + zd.mainBars_sagging.Ast_provided) / 1e6)
            * zd.height * 7850;

        // The engine's total must be HIGHER than main-only (dist steel added)
        expect(r.totalSteelWeight).toBeGreaterThan(mainSteelOnly);

        // Distribution steel: 0.12% × b × t × 2 faces × height × 7850
        const expectedDist = (2 * 0.0012 * 1000 * 400 / 1e6) * 4 * 7850;
        const expectedTotal = mainSteelOnly + expectedDist;
        expect(r.totalSteelWeight).toBeCloseTo(expectedTotal, 0);
    });
});

// ─── IMP-5: Slab extended optimizer ───────────────────────────────────────

describe('IMP-5: optimizeSlabExtended sweeps D + bar dia + spacing', () => {
    test('returns SlabOptimizeExtendedResult with barDia + barSpacing', () => {
        const r = optimizeSlabExtended({
            Lx: 4, Ly: 5, D: 150, fck: 25, fy: 500, grade: 'M25',
            LL: 3, SDL: 1.5, boundaryCase: 1,
        }, {
            thicknesses: [150, 175],
            barDias: [10, 12],
            barSpacings: [150, 200],
        });

        expect(r.totalTrials).toBe(2 * 2 * 2); // 8 combos
        expect(r).toHaveProperty('topDesigns');
        expect(r).toHaveProperty('optimum');
        expect(r).toHaveProperty('paretoFront');

        if (r.optimum) {
            expect(r.optimum).toHaveProperty('barDia');
            expect(r.optimum).toHaveProperty('barSpacing');
            expect(r.optimum.barDia).toBeGreaterThan(0);
            expect(r.optimum.barSpacing).toBeGreaterThan(0);
        }
    });

    test('enforces IS 456 cl. 26.3.3 bar dia ≤ D/8 as pre-filter', () => {
        // D=100, max bar dia = 100/8 = 12.5. A 16mm bar should be filtered out.
        const r = optimizeSlabExtended({
            Lx: 3, Ly: 4, D: 100, fck: 25, fy: 500, grade: 'M25',
            LL: 3, SDL: 1.5, boundaryCase: 1,
        }, {
            thicknesses: [100],
            barDias: [10, 16],      // 16mm > D/8=12.5 → filtered
            barSpacings: [150, 200],
        });

        // If any feasible design exists, it must NOT use 16mm bars
        r.topDesigns.forEach(d => {
            expect(d.barDia).toBeLessThanOrEqual(100 / 8);
        });
    });

    test('enforces max spacing ≤ min(3d, 300) as pre-filter', () => {
        const r = optimizeSlabExtended({
            Lx: 3, Ly: 4, D: 150, fck: 25, fy: 500, grade: 'M25',
            LL: 3, SDL: 1.5, boundaryCase: 1,
        }, {
            thicknesses: [150],
            barDias: [10],
            barSpacings: [150, 350],  // 350 > min(3×125, 300) = 300 → filtered
        });

        // If any feasible design exists, spacing must be ≤ 300
        r.topDesigns.forEach(d => {
            expect(d.barSpacing).toBeLessThanOrEqual(300);
        });
    });

    test('top designs are sorted by cost ascending', () => {
        const r = optimizeSlabExtended({
            Lx: 4, Ly: 5, D: 150, fck: 25, fy: 500, grade: 'M25',
            LL: 3, SDL: 1.5, boundaryCase: 1,
        }, {
            thicknesses: [150, 175, 200],
            barDias: [10, 12],
            barSpacings: [150, 200],
        });

        for (let i = 1; i < r.topDesigns.length; i++) {
            expect(r.topDesigns[i].costTotal_INR)
                .toBeGreaterThanOrEqual(r.topDesigns[i - 1].costTotal_INR);
        }
    });

    test('cost breakdown components sum to total', () => {
        const r = optimizeSlabExtended({
            Lx: 4, Ly: 5, D: 150, fck: 25, fy: 500, grade: 'M25',
            LL: 3, SDL: 1.5, boundaryCase: 1,
        }, {
            thicknesses: [150, 175],
            barDias: [10, 12],
            barSpacings: [150, 200],
        });

        if (r.optimum) {
            const o = r.optimum;
            const sum = o.costBreakdown.concrete_INR + o.costBreakdown.steel_INR + o.costBreakdown.formwork_INR;
            expect(Math.abs(sum - o.costTotal_INR) / o.costTotal_INR).toBeLessThan(0.01);
        }
    });
});
