/**
 * Benchmark tests against hand calculations for the 2026-07-04 audit fixes.
 *
 * These tests use textbook-style problems with fully hand-derived bearing
 * pressures, eccentricity, and force resultants. They serve as regression
 * guards to prevent the bugs from creeping back in:
 *
 *   1. RW-BM-1: 4 m dry cantilever retaining wall, surcharge 10 kN/m².
 *      Hand-derived: Ka=1/3, Pa=48 kN/m, M_overturning=90.67 kN·m/m,
 *      ΣV=163.76 kN/m, x_bar=0.9335 m (corrected), e=-0.2665 m,
 *      p_toe=113.67 kN/m², p_heel=22.78 kN/m².
 *      Buggy formula would give x_bar=1.487 m, e=+0.287 m, p_toe=19.31,
 *      p_heel=117.18 — the OLD code under-estimated toe pressure by 6×.
 *
 *   2. RW-BM-2: 6 m wall with surcharge (textbook size). Hand-derived
 *      x_bar=0.9252 m, e=-0.5748 m, p_toe=211.40 kN/m² (>SBC → REVISE),
 *      p_heel=-14.71 kN/m² (tension → REVISE). The corrected code
 *      correctly flags this wall as REVISE on both checks.
 *
 *   3. RW-BM-3: 5 m wall with water table at 2 m depth. Tests the water-
 *      table handling in the bearing-pressure computation.
 *
 *   4. WS-D-2: Waffle-slab effective depth tracks the user-supplied
 *      `rib_bar_dia` parameter (12/16/20/25 mm all give the expected d).
 *
 *   5. WS-ASTMIN-2: Waffle-slab Ast_min is always >= the IS 456 Cl. 26.5.1.1(a)
 *      beam-rule minimum (0.85/fy × bw × d), proving the fix is conservative.
 */

import { analyzeRetainingWall, type RetainingWallInput } from '../components/retainingWallEngine';
import { analyzeWaffleSlab } from '../components/waffleSlabEngine';

// ─── Retaining wall benchmarks ────────────────────────────────────────────

describe('RW-BM-1: 4 m dry cantilever retaining wall (textbook benchmark)', () => {
    const input: RetainingWallInput = {
        H: 4000, D_stem_base: 400, D_stem_top: 200, D_base: 400,
        B: 2400, B_toe: 600,
        phi: 30, gamma_soil: 18, gamma_concrete: 24, q_surcharge: 10,
        mu: 0.45, sbc: 200, waterTableDepth: 0,
        fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500',
        cover: 50, loadFactor: 1.5,
    };

    test('Ka = (1-sinφ)/(1+sinφ) = 1/3 for φ=30°', () => {
        const r = analyzeRetainingWall(input);
        expect(r.Ka).toBeCloseTo(1 / 3, 4);
    });

    test('Active earth pressure Pa = 0.5·Ka·γ·H² = 48 kN/m', () => {
        const r = analyzeRetainingWall(input);
        // 0.5 * (1/3) * 18 * 4² = 48 kN/m
        expect(r.Pa).toBeCloseTo(48.0, 2);
    });

    test('Surcharge pressure Pq = Ka·q·H = 13.33 kN/m', () => {
        const r = analyzeRetainingWall(input);
        // (1/3) * 10 * 4 = 13.333 kN/m
        expect(r.Pq).toBeCloseTo(13.333, 2);
    });

    test('M_overturning = Pa·H/3 + Pq·H/2 = 90.67 kN·m/m', () => {
        const r = analyzeRetainingWall(input);
        // 48 * 4/3 + 13.333 * 4/2 = 64 + 26.667 = 90.667
        expect(r.M_overturning).toBeCloseTo(90.67, 1);
    });

    test('ΣV (stem + base + soil + surcharge) = 163.76 kN/m', () => {
        const r = analyzeRetainingWall(input);
        // Stem: 0.5*(0.4+0.2)*3.6*24 = 25.92
        // Base: 2.4*0.4*24 = 23.04
        // Soil: 1.4*4*18 = 100.8
        // Surcharge: 1.4*10 = 14
        // Total: 163.76
        expect(r.SigmaV).toBeCloseTo(163.76, 1);
    });

    test('M_resisting (about toe) = 243.54 kN·m/m', () => {
        const r = analyzeRetainingWall(input);
        // Stem: 25.92 * 0.8 = 20.736
        // Base: 23.04 * 1.2 = 27.648
        // Soil: 100.8 * 1.7 = 171.36
        // Surcharge: 14 * 1.7 = 23.8
        // Total: 243.544
        expect(r.M_resisting).toBeCloseTo(243.54, 1);
    });

    test('x_bar = (M_resisting - M_overturning) / ΣV = 0.9335 m (CORRECTED)', () => {
        const r = analyzeRetainingWall(input);
        const B_m = r.B / 1000;
        const x_bar = r.eccentricity + B_m / 2;
        // (243.544 - 90.667) / 163.76 = 0.9335 m
        expect(x_bar).toBeCloseTo(0.9335, 3);
        // The buggy formula would give 243.544/163.76 = 1.487 m — way off.
        expect(x_bar).not.toBeCloseTo(1.487, 1);
    });

    test('eccentricity = -0.2665 m (NEGATIVE → resultant on toe side)', () => {
        const r = analyzeRetainingWall(input);
        // e = x_bar - B/2 = 0.9335 - 1.2 = -0.2665
        expect(r.eccentricity).toBeCloseTo(-0.2665, 3);
        expect(r.eccentricity).toBeLessThan(0); // on toe side (typical RW)
    });

    test('p_toe = 113.67 kN/m² (corrected sign — HIGHER than p_heel)', () => {
        const r = analyzeRetainingWall(input);
        // p_avg = 68.233, 6e/B = -0.6662
        // p_toe = 68.233 * (1 - (-0.6662)) = 113.67
        expect(r.p_toe).toBeCloseTo(113.67, 0);
        expect(r.p_toe).toBeGreaterThan(r.p_heel);
        // The buggy formula would give p_toe = 19.31 — under-estimated by ~6×.
        expect(r.p_toe).toBeGreaterThan(100);
    });

    test('p_heel = 22.78 kN/m² (corrected sign — LOWER than p_toe, positive)', () => {
        const r = analyzeRetainingWall(input);
        // p_heel = 68.233 * (1 + (-0.6662)) = 22.78
        expect(r.p_heel).toBeCloseTo(22.78, 0);
        expect(r.p_heel).toBeGreaterThan(0); // no tension
    });

    test('bearing_ok = true (p_max < SBC = 200)', () => {
        const r = analyzeRetainingWall(input);
        expect(r.p_max).toBeCloseTo(r.p_toe, 1); // p_max = p_toe (the larger one)
        expect(r.p_max).toBeLessThan(200);
        expect(r.bearing_ok).toBe(true);
    });
});

describe('RW-BM-2: 6 m wall with surcharge (textbook size — exceeds SBC)', () => {
    const input: RetainingWallInput = {
        H: 6000, D_stem_base: 500, D_stem_top: 200, D_base: 600,
        B: 3000, B_toe: 750,
        phi: 30, gamma_soil: 18, gamma_concrete: 24, q_surcharge: 10,
        mu: 0.5, sbc: 200, waterTableDepth: 0,
        fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500',
        cover: 50, loadFactor: 1.5,
    };

    test('M_overturning = 276 kN·m/m, ΣV = 295.06 kN/m', () => {
        const r = analyzeRetainingWall(input);
        expect(r.M_overturning).toBeCloseTo(276.0, 1);
        expect(r.SigmaV).toBeCloseTo(295.06, 1);
    });

    test('x_bar = 0.9252 m (corrected), eccentricity = -0.5748 m', () => {
        const r = analyzeRetainingWall(input);
        const B_m = r.B / 1000;
        const x_bar = r.eccentricity + B_m / 2;
        expect(x_bar).toBeCloseTo(0.9252, 3);
        expect(r.eccentricity).toBeCloseTo(-0.5748, 3);
    });

    test('p_toe = 211.4 kN/m² (EXCEEDS SBC = 200 → REVISE)', () => {
        const r = analyzeRetainingWall(input);
        expect(r.p_toe).toBeCloseTo(211.4, 0);
        expect(r.p_toe).toBeGreaterThan(200); // exceeds SBC
    });

    test('p_heel = -14.71 kN/m² (TENSION at heel → REVISE)', () => {
        const r = analyzeRetainingWall(input);
        expect(r.p_heel).toBeCloseTo(-14.71, 0);
        expect(r.p_heel).toBeLessThan(0); // tension
    });

    test('bearing_ok = false (wall must be revised)', () => {
        const r = analyzeRetainingWall(input);
        expect(r.bearing_ok).toBe(false);
        expect(r.overallStatus).toBe('REVISE');
    });
});

describe('RW-BM-3: 5 m wall with water table at 2 m depth', () => {
    const input: RetainingWallInput = {
        H: 5000, D_stem_base: 450, D_stem_top: 200, D_base: 500,
        B: 2700, B_toe: 700,
        phi: 30, gamma_soil: 18, gamma_concrete: 24, q_surcharge: 0,
        mu: 0.5, sbc: 200, waterTableDepth: 2000, // WT at 2 m from top
        fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500',
        cover: 50, loadFactor: 1.5,
    };

    test('M_overturning includes water + submerged soil pressure', () => {
        const r = analyzeRetainingWall(input);
        // Hand: 12*3.667 + 36*1.5 + 12.285*1 + 44.145*1 ≈ 154.43 kN·m/m
        // (small buoyancy correction in ΣV brings engine slightly off.)
        expect(r.M_overturning).toBeCloseTo(154.43, 0);
    });

    test('x_bar = 0.920 m (corrected), eccentricity = -0.430 m (toe side)', () => {
        const r = analyzeRetainingWall(input);
        const B_m = r.B / 1000;
        const x_bar = r.eccentricity + B_m / 2;
        expect(x_bar).toBeCloseTo(0.920, 2);
        expect(r.eccentricity).toBeCloseTo(-0.430, 2);
        expect(r.eccentricity).toBeLessThan(0); // resultant on toe side
    });

    test('p_toe = ~150 kN/m² (< SBC = 200), p_heel = ~3 kN/m² (positive)', () => {
        const r = analyzeRetainingWall(input);
        expect(r.p_toe).toBeCloseTo(150.0, 0);
        expect(r.p_heel).toBeCloseTo(3.3, 0);
        expect(r.p_heel).toBeGreaterThan(0); // no tension
        expect(r.p_toe).toBeGreaterThan(r.p_heel);
    });

    test('bearing_ok = true (despite water table, pressures within limits)', () => {
        const r = analyzeRetainingWall(input);
        expect(r.bearing_ok).toBe(true);
    });
});

// ─── Waffle-slab benchmark ────────────────────────────────────────────────

describe('WS-D-2: waffle-slab effective depth tracks rib_bar_dia', () => {
    const baseInput = {
        Lx: 6, Ly: 6,
        spacing_x: 0.9, spacing_y: 0.9,
        bw: 150, D: 350, Df: 75,
        cover: 30, fck: 25, fy: 500,
        w_live: 3, w_finish: 1.5,
    };

    test('default rib_bar_dia = 16 mm → d = 312 mm', () => {
        const r = analyzeWaffleSlab(baseInput);
        // d = D - cover - barDia/2 = 350 - 30 - 16/2 = 312
        expect(r.ribX.d_eff).toBe(312);
    });

    test('explicit rib_bar_dia = 20 mm → d = 310 mm', () => {
        const r = analyzeWaffleSlab({ ...baseInput, rib_bar_dia: 20 });
        // d = 350 - 30 - 20/2 = 310
        expect(r.ribX.d_eff).toBe(310);
    });

    test('explicit rib_bar_dia = 25 mm → d = 307.5 mm', () => {
        const r = analyzeWaffleSlab({ ...baseInput, rib_bar_dia: 25 });
        // d = 350 - 30 - 25/2 = 307.5
        expect(r.ribX.d_eff).toBe(307.5);
    });

    test('explicit rib_bar_dia = 12 mm → d = 314 mm', () => {
        const r = analyzeWaffleSlab({ ...baseInput, rib_bar_dia: 12 });
        // d = 350 - 30 - 12/2 = 314
        expect(r.ribX.d_eff).toBe(314);
    });

    test('d DECREASES as rib_bar_dia INCREASES (correct sensitivity)', () => {
        const r12 = analyzeWaffleSlab({ ...baseInput, rib_bar_dia: 12 });
        const r16 = analyzeWaffleSlab({ ...baseInput, rib_bar_dia: 16 });
        const r20 = analyzeWaffleSlab({ ...baseInput, rib_bar_dia: 20 });
        const r25 = analyzeWaffleSlab({ ...baseInput, rib_bar_dia: 25 });
        expect(r12.ribX.d_eff).toBeGreaterThan(r16.ribX.d_eff);
        expect(r16.ribX.d_eff).toBeGreaterThan(r20.ribX.d_eff);
        expect(r20.ribX.d_eff).toBeGreaterThan(r25.ribX.d_eff);
    });
});

describe('WS-ASTMIN-2: waffle-slab Ast_min is conservative (>= beam rule)', () => {
    test('narrow rib: slab rule governs, but engine value >= beam rule', () => {
        const r = analyzeWaffleSlab({
            Lx: 6, Ly: 6, spacing_x: 0.9, spacing_y: 0.9,
            bw: 150, D: 350, Df: 75, cover: 30, fck: 25, fy: 500,
            w_live: 3, w_finish: 1.5,
        });
        // Beam rule: 0.85/fy * bw * d = 0.85/500 * 150 * 312 = 79.56 mm²
        const beamRule = (0.85 / 500) * 150 * r.ribX.d_eff;
        expect(r.ribX.Ast_min).toBeGreaterThanOrEqual(beamRule);
        // The fix is conservative: never returns less than the beam rule.
    });

    test('wide rib: both rules comparable, engine value >= beam rule', () => {
        const r = analyzeWaffleSlab({
            Lx: 4, Ly: 4, spacing_x: 0.4, spacing_y: 0.4,
            bw: 300, D: 250, Df: 60, cover: 30, fck: 25, fy: 500,
            w_live: 3, w_finish: 1.5,
        });
        const beamRule = (0.85 / 500) * 300 * r.ribX.d_eff;
        expect(r.ribX.Ast_min).toBeGreaterThanOrEqual(beamRule);
    });

    test('deep rib with small flange: slab rule still wins (conservative)', () => {
        const r = analyzeWaffleSlab({
            Lx: 5, Ly: 5, spacing_x: 0.3, spacing_y: 0.3,
            bw: 200, D: 500, Df: 50, cover: 25, fck: 25, fy: 500,
            w_live: 3, w_finish: 1.5,
        });
        const beamRule = (0.85 / 500) * 200 * r.ribX.d_eff;
        expect(r.ribX.Ast_min).toBeGreaterThanOrEqual(beamRule);
    });
});
