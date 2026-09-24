/**
 * Benchmark tests against hand calculations for the 2026-07-04 audit fixes.
 *
 * These tests use textbook-style problems with fully hand-derived bearing
 * pressures, eccentricity, and force resultants. They serve as regression
 * guards to prevent the bugs from creeping back in:
 *
 *   1. RW-BM-1: 4 m dry cantilever retaining wall, surcharge 10 kN/m².
 *      Hand-derived (2026-09 review): soil over the heel H − D_base = 3.6 m,
 *      surcharge not restoring (IS 456 Cl. 20.1): W_dead = 139.68 kN/m,
 *      M_R = 202.61 kN·m/m, M_O = 90.67 kN·m/m, 0.9·M_R/M_O = 2.01,
 *      sliding 0.92 < 1.4. Bearing governed without the heel surcharge:
 *      x_bar = 0.8014 m, e = −0.3986 m, p_toe = 116.19, p_heel = 0.21 kN/m².
 *
 *   2. RW-BM-2: 6 m wall with surcharge (textbook size). Hand-derived
 *      x_bar = 0.7563 m, e = −0.7437 m, p_toe = 214.47 kN/m² (> SBC → REVISE),
 *      p_heel = −42.03 kN/m² (tension → REVISE).
 *
 *   3. RW-BM-3: 5 m wall with water table at 2 m depth. Water, submerged
 *      soil and the uplift under the base (U = 39.73 kN/m at 2B/3):
 *      x_bar = 0.5997 m, p_toe = 151.46, p_heel = −37.90 kN/m² → REVISE.
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

    test('vertical loads: soil over the heel is H − D_base = 3.6 m high', () => {
        const r = analyzeRetainingWall(input);
        // Stem: 0.5*(0.4+0.2)*3.6*24 = 25.92
        // Base: 2.4*0.4*24 = 23.04
        // Soil: 1.4*3.6*18 = 90.72   (not 1.4*4.0 — the base occupies 0.4 m)
        // Surcharge: 1.4*10 = 14     (variable — bearing only)
        expect(r.W_soil).toBeCloseTo(90.72, 2);
        expect(r.W_dead).toBeCloseTo(139.68, 2);
        expect(r.SigmaV).toBeCloseTo(153.68, 2);   // W_dead + surcharge − U (U = 0, dry)
    });

    test('M_resisting (permanent loads about the toe) = 202.61 kN·m/m', () => {
        const r = analyzeRetainingWall(input);
        // Stem: 25.92 * 0.8 = 20.736
        // Base: 23.04 * 1.2 = 27.648
        // Soil: 90.72 * 1.7 = 154.224
        // Surcharge over the heel is not a restoring action (IS 456 Cl. 20.1)
        expect(r.M_resisting).toBeCloseTo(202.608, 2);
    });

    test('stability per IS 456 Cl. 20: 0.9·M_R/M_O = 2.011, 0.9·μ·ΣW/ΣH = 0.922 (sliding fails)', () => {
        const r = analyzeRetainingWall(input);
        expect(r.fos_overturning).toBeCloseTo(0.9 * 202.608 / 90.667, 3);   // 2.011 ≥ 1.4
        expect(r.overturning_ok).toBe(true);
        expect(r.fos_sliding).toBeCloseTo(0.9 * 0.45 * 139.68 / 61.333, 3); // 0.922 < 1.4
        expect(r.sliding_ok).toBe(false);
        expect(r.overallStatus).toBe('REVISE');
    });

    test('bearing governed by the case without heel surcharge: x_bar = 0.8014 m', () => {
        const r = analyzeRetainingWall(input);
        // With surcharge:    V = 153.68, x̄ = (202.608 + 23.8 − 90.667)/153.68 = 0.8833 → p_toe 114.74
        // Without surcharge: V = 139.68, x̄ = (202.608 − 90.667)/139.68 = 0.8014 → p_toe 116.19
        expect(r.bearingCase).toBe('without surcharge');
        expect(r.V_bearing).toBeCloseTo(139.68, 2);
        expect(r.x_bar).toBeCloseTo(0.80141, 4);
        // The resultant is NOT M_resisting / ΣV (the old bug, 1.45 m)
        expect(r.x_bar).not.toBeCloseTo(202.608 / 139.68, 1);
    });

    test('eccentricity = −0.3986 m (NEGATIVE → resultant on toe side)', () => {
        const r = analyzeRetainingWall(input);
        // e = x_bar − B/2 = 0.80141 − 1.2
        expect(r.eccentricity).toBeCloseTo(-0.39859, 4);
        expect(r.eccentricity).toBeLessThan(0);
    });

    test('p_toe = 116.19 kN/m² (HIGHER than p_heel)', () => {
        const r = analyzeRetainingWall(input);
        // p_avg = 139.68/2.4 = 58.2, 6e/B = −0.99648 → p_toe = 58.2 × 1.99648
        expect(r.p_toe).toBeCloseTo(116.195, 2);
        expect(r.p_toe).toBeGreaterThan(r.p_heel);
    });

    test('p_heel = 0.205 kN/m² (resultant just inside the middle third)', () => {
        const r = analyzeRetainingWall(input);
        // p_heel = 58.2 × (1 − 0.99648)
        expect(r.p_heel).toBeCloseTo(0.205, 2);
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
    // W_stem = 0.5·0.7·5.4·24 = 45.36 @ 1.0; W_base = 3·0.6·24 = 43.2 @ 1.5;
    // W_soil = 1.75·5.4·18 = 170.1 @ 2.125; W_surcharge = 17.5 @ 2.125
    // W_dead = 258.66, M_R = 45.36 + 64.8 + 361.4625 = 471.6225

    test('M_overturning = 276 kN·m/m, ΣV = 276.16 kN/m, M_R = 471.62 kN·m/m', () => {
        const r = analyzeRetainingWall(input);
        expect(r.M_overturning).toBeCloseTo(276.0, 1);
        expect(r.SigmaV).toBeCloseTo(276.16, 2);
        expect(r.M_resisting).toBeCloseTo(471.6225, 2);
    });

    test('governing case without surcharge: x_bar = 0.7563 m, eccentricity = −0.7437 m', () => {
        const r = analyzeRetainingWall(input);
        // x̄ = (471.6225 − 276)/258.66 = 0.75629
        expect(r.bearingCase).toBe('without surcharge');
        expect(r.x_bar).toBeCloseTo(0.75629, 4);
        expect(r.eccentricity).toBeCloseTo(-0.74371, 4);
    });

    test('p_toe = 214.47 kN/m² (EXCEEDS SBC = 200 → REVISE)', () => {
        const r = analyzeRetainingWall(input);
        // p_avg = 86.22, 6e/B = −1.48742
        expect(r.p_toe).toBeCloseTo(214.465, 1);
        expect(r.p_toe).toBeGreaterThan(200); // exceeds SBC
    });

    test('p_heel = −42.03 kN/m² (TENSION at heel → REVISE)', () => {
        const r = analyzeRetainingWall(input);
        expect(r.p_heel).toBeCloseTo(-42.025, 1);
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
    // hw = 5 − 2 = 3 m of water above the base underside.
    // Lateral: 12·3.667 + 36·1.5 + 12.285·1 + 44.145·1 = 154.43 kN·m/m
    // Uplift (retained side, free-draining toe): U = ½·9.81·3·2.7 = 39.7305 kN/m at 2B/3 = 1.8 m
    // W_stem = 35.1 @ 0.925, W_base = 32.4 @ 1.35, W_soil = 1.55·4.5·18 = 125.55 @ 1.925
    // W_dead = 193.05, M_R = 32.4675 + 43.74 + 241.68375 = 317.89125

    test('M_overturning includes water, submerged soil and uplift', () => {
        const r = analyzeRetainingWall(input);
        expect(r.U).toBeCloseTo(39.7305, 3);
        expect(r.U_arm).toBeCloseTo(1.8, 6);
        expect(r.M_overturning).toBeCloseTo(154.43 + 39.7305 * 1.8, 1);   // 225.94
    });

    test('stability: 0.9·M_R/M_O = 1.266 (< 1.4), sliding 0.9·μ·(ΣW − U)/ΣH = 0.661', () => {
        const r = analyzeRetainingWall(input);
        expect(r.fos_overturning).toBeCloseTo(0.9 * 317.89125 / 225.9449, 3);
        expect(r.fos_sliding).toBeCloseTo(0.9 * 0.5 * (193.05 - 39.7305) / 104.43, 3);
        expect(r.overturning_ok).toBe(false);
        expect(r.sliding_ok).toBe(false);
    });

    test('x_bar = 0.5997 m, eccentricity = −0.7503 m (outside the middle third)', () => {
        const r = analyzeRetainingWall(input);
        // V = 193.05 − 39.7305 = 153.3195; x̄ = (317.89125 − 225.9449)/153.3195
        expect(r.V_bearing).toBeCloseTo(153.3195, 3);
        expect(r.x_bar).toBeCloseTo(0.59970, 4);
        expect(r.eccentricity).toBeCloseTo(-0.75030, 4);
    });

    test('p_toe = 151.46 kN/m², p_heel = −37.90 kN/m² (tension → REVISE)', () => {
        const r = analyzeRetainingWall(input);
        expect(r.p_toe).toBeCloseTo(151.46, 1);
        expect(r.p_heel).toBeCloseTo(-37.90, 1);
        expect(r.bearing_ok).toBe(false);
        expect(r.overallStatus).toBe('REVISE');
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
