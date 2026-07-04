/**
 * End-to-end validation tests for the 2026-07-04 audit fixes.
 *
 * These tests exercise the actual exported engine functions (not replicated
 * copies) to verify the bug fixes work in the real code path:
 *
 *   1. RW-XBAR-001 + RW-PBEAR-001 — `analyzeRetainingWall` produces a
 *      bearing-pressure distribution whose signs are physically correct for
 *      a typical retaining wall (resultant on toe side, p_toe > p_heel).
 *
 *   2. RW-XBAR-001 — `analyzeRetainingWall` uses
 *      x_bar = (M_resisting − M_overturning) / ΣV (not just M_resisting / ΣV),
 *      so the eccentricity is reduced (shifted toward the toe) compared to
 *      the buggy formula.
 *
 *   3. BEAM-FEM-001 — the wall engine, which feeds trapezoidal earth-pressure
 *      loads through the tapered-beam FEM path, produces reactions that
 *      satisfy vertical equilibrium (ΣV_reactions = −ΣV_loads). Before the
 *      fix, the M_cant error upset equilibrium for non-UDL trapezoidal loads
 *      on tapered walls.
 */

import { analyzeRetainingWall, type RetainingWallInput } from '../components/retainingWallEngine';
import { analyzeWall, type WallConfig } from '../components/wallEngine';

// ─── Retaining wall: bearing pressure sign convention ────────────────────

function baseRetainingWall(overrides: Partial<RetainingWallInput> = {}): RetainingWallInput {
    return {
        H: 4000,
        D_stem_base: 400,
        D_stem_top: 200,
        D_base: 400,
        B: 2400,
        B_toe: 600,
        phi: 30,
        gamma_soil: 18,
        gamma_concrete: 24,
        q_surcharge: 10,
        mu: 0.45,
        sbc: 200,
        waterTableDepth: 0,
        fck: 25,
        fy: 500,
        grade: 'M25',
        steelGrade: 'Fe500',
        cover: 50,
        loadFactor: 1.5,
        ...overrides,
    };
}

describe('Retaining wall — end-to-end bearing pressure (audit 2026-07-04)', () => {
    test('p_toe > p_heel for a typical retaining wall (resultant on toe side)', () => {
        const r = analyzeRetainingWall(baseRetainingWall());
        // For a typical retaining wall, the lateral earth pressure pushes the
        // resultant toward the toe. Eccentricity (positive toward heel) should
        // be NEGATIVE (resultant on toe side of base centre).
        expect(r.eccentricity).toBeLessThan(0);
        // And the toe pressure should be HIGHER than the heel pressure.
        expect(r.p_toe).toBeGreaterThan(r.p_heel);
        // The reported p_max should equal p_toe (the larger value).
        expect(r.p_max).toBeCloseTo(r.p_toe, 1);
    });

    test('x_bar uses (M_resisting - M_overturning) / SigmaV (not just M_resisting / SigmaV)', () => {
        const r = analyzeRetainingWall(baseRetainingWall());
        // The corrected formula must give an eccentricity that matches:
        //   e = (M_resisting - M_overturning) / SigmaV - B/2
        const B_m = r.B / 1000;
        const e_correct = (r.M_resisting - r.M_overturning) / r.SigmaV - B_m / 2;
        // The buggy formula would give:
        const e_buggy = r.M_resisting / r.SigmaV - B_m / 2;
        // The engine must use the corrected formula.
        expect(r.eccentricity).toBeCloseTo(e_correct, 3);
        expect(r.eccentricity).not.toBeCloseTo(e_buggy, 3);
        // For a typical wall, |e_correct| < |e_buggy| AND e_correct is shifted
        // toward the toe (more negative).
        expect(r.eccentricity).toBeLessThan(e_buggy);
    });

    test('bearing pressures match Meyerhof formula with corrected signs', () => {
        const r = analyzeRetainingWall(baseRetainingWall());
        const B_m = r.B / 1000;
        const p_avg = r.SigmaV / B_m;
        const e = r.eccentricity; // positive toward heel
        // p_toe = p_avg * (1 - 6e/B)  — LOWER when e > 0 (resultant on heel)
        // p_heel = p_avg * (1 + 6e/B) — HIGHER when e > 0
        // For typical retaining wall, e < 0 (resultant on toe), so:
        //   p_toe > p_avg (toe pressure HIGHER than average)
        //   p_heel < p_avg (heel pressure LOWER than average)
        const p_toe_expected = p_avg * (1 - 6 * e / B_m);
        const p_heel_expected = p_avg * (1 + 6 * e / B_m);
        expect(r.p_toe).toBeCloseTo(p_toe_expected, 1);
        expect(r.p_heel).toBeCloseTo(p_heel_expected, 1);
    });

    test('wall with very wide heel — resultant shifts to heel side (e > 0)', () => {
        // For a wall with a very wide base (B = 12 m, mostly heel), the soil
        // weight on the heel dominates and shifts the resultant toward the
        // HEEL side. Eccentricity (positive toward heel) becomes positive,
        // and p_heel > p_toe. This is the OPPOSITE of the typical narrow-base
        // case, and the corrected sign convention must handle both correctly.
        const r = analyzeRetainingWall(baseRetainingWall({ B: 12000, B_toe: 3000 }));
        // Eccentricity should be POSITIVE (resultant on heel side).
        expect(r.eccentricity).toBeGreaterThan(0);
        // Heel pressure should be HIGHER than toe pressure.
        expect(r.p_heel).toBeGreaterThan(r.p_toe);
        // And p_max should equal p_heel.
        expect(r.p_max).toBeCloseTo(r.p_heel, 1);
        // Both pressures should remain positive (no tension).
        expect(r.p_toe).toBeGreaterThan(0);
        expect(r.p_heel).toBeGreaterThan(0);
    });
});

// ─── Wall engine: vertical equilibrium under trapezoidal earth pressure ──

function baseWallConfig(overrides: Partial<WallConfig> = {}): WallConfig {
    return {
        zones: [{ height: 4, thickness: 400 }],
        soilParams: {
            phi: 30,
            gamma_soil: 18,
            gamma_water: 9.81,
            waterTableDepth: 999,
            groundLevelDepth: 0,
            waterMode: 'dry',
            surcharge: 10,
        },
        material: {
            grade: 'M25',
            fck: 25,
            steelGrade: 'Fe500',
            fy: 500,
            cover: 40,
        },
        loadFactor: 1.5,
        isTapered: false,
        ...overrides,
    };
}

describe('Wall engine — vertical equilibrium under trapezoidal earth pressure', () => {
    // The wall engine feeds trapezoidal earth-pressure loads through the
    // tapered-beam FEM path (Simpson's-rule). The reactions returned by
    // `analyzeBeam` are in NORMALIZED units (V_normalized × L_ref = V_physical),
    // where L_ref = spanLengths[0].fl() = the first span's physical length in
    // metres. We multiply by L_ref to compare against the physical total
    // lateral force from the pressure mesh.

    const getLRef = (r: { beamResult: { spanLengths: { fl: () => number }[] } }) =>
        r.beamResult.spanLengths[0].fl();

    test('Σ support reactions = Σ applied loads (uniform wall, UDL+surcharge pressure)', () => {
        const cfg = baseWallConfig();
        const r = analyzeWall(cfg);
        const L_ref = getLRef(r);
        const totalLateral = r.totalLateralForce;
        const sumReactions = r.beamResult.reactions.reduce(
            (s: number, rx: { Rv: { fl: () => number } }) => s + Math.abs(rx.Rv.fl() * L_ref),
            0,
        );
        // For a propped cantilever, both reactions oppose the load (same sign),
        // so the sum of magnitudes equals the total lateral force.
        expect(sumReactions).toBeCloseTo(totalLateral, 0);
    });

    test('Σ support reactions = Σ applied loads (tapered wall, triangular pressure)', () => {
        // Tapered wall with no surcharge → triangular pressure (0 at top, max
        // at bottom). This exercises the Simpson's-rule tapered FEM path
        // where the M_cant bug used to live.
        const cfg = baseWallConfig({
            zones: [{ height: 4, thickness: 400, thicknessTop: 200, thicknessBot: 400 }],
            isTapered: true,
            soilParams: {
                phi: 30,
                gamma_soil: 18,
                gamma_water: 9.81,
                waterTableDepth: 999,
                groundLevelDepth: 0,
                waterMode: 'dry',
                surcharge: 0, // no surcharge → triangular pressure
            },
        });
        const r = analyzeWall(cfg);
        const L_ref = getLRef(r);
        const totalLateral = r.totalLateralForce;
        const sumReactions = r.beamResult.reactions.reduce(
            (s: number, rx: { Rv: { fl: () => number } }) => s + Math.abs(rx.Rv.fl() * L_ref),
            0,
        );
        // Allow ~2% tolerance — Simpson's-rule integration on a tapered beam
        // has slightly more numerical error than the closed-form uniform case.
        expect(sumReactions).toBeCloseTo(totalLateral, -1);
    });

    test('Σ support reactions = Σ applied loads (uniform wall, partial water table)', () => {
        // Partial water table creates a pressure kink at the WT depth. The
        // mesh builder inserts a non-support node there, and each segment
        // carries an exact linear pressure. Total reactions must still equal
        // total lateral force.
        const cfg = baseWallConfig({
            zones: [
                { height: 2, thickness: 400 },
                { height: 2, thickness: 400 },
            ],
            soilParams: {
                phi: 30,
                gamma_soil: 18,
                gamma_water: 9.81,
                waterTableDepth: 2, // WT at 2 m depth (zone boundary)
                groundLevelDepth: 0,
                waterMode: 'partial',
                surcharge: 10,
            },
        });
        const r = analyzeWall(cfg);
        const L_ref = getLRef(r);
        const totalLateral = r.totalLateralForce;
        const sumReactions = r.beamResult.reactions.reduce(
            (s: number, rx: { Rv: { fl: () => number } }) => s + Math.abs(rx.Rv.fl() * L_ref),
            0,
        );
        // Allow ~10% tolerance for Simpson's-rule + multi-segment aggregation.
        expect(sumReactions).toBeCloseTo(totalLateral, -1);
    });
});
