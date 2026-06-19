/**
 * B0 independent hand-derivation verification.
 *
 * Restored from deleted tests/verify_b0.mjs (commit 2e6ac6c) and converted
 * to jest. Re-derives the propped-cantilever closed-form solution for a single-
 * zone dry wall under triangular lateral pressure and compares against the
 * engine's output.
 */
import { analyzeWall } from '../components/wallEngine';

const approx = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

describe('B0 independent hand derivation', () => {
    // Single zone wall, dry, triangular pressure 0 -> w0 at base over height H.
    // Base FIXED, top ROLLER (propped cantilever). Load factor 1.
    const H = 4, K0 = 0.3, g = 18, lf = 1;
    const w0 = K0 * g * H; // 21.6 kN/m² peak base pressure

    // Closed-form propped cantilever under triangular load (zero at propped end,
    // w0 at fixed end) — standard structural-table result.
    const W = w0 * H / 2;
    const R_top = w0 * H / 10;
    const M_base = w0 * H * H / 15;
    const xstar = Math.sqrt(2 * H * R_top / w0);
    const Msag = R_top * xstar - w0 * Math.pow(xstar, 3) / (6 * H);

    const cfg = {
        zones: [{ height: H, thickness: 300 }],
        soilParams: { phi: 44.427, gamma_soil: g, gamma_water: 9.81, waterTableDepth: 999, surcharge: 0, waterMode: 'dry' },
        material: { grade: 'M25', fck: 25, steelGrade: 'Fe415', fy: 415, cover: 40, E: 25000 }, loadFactor: lf,
    };
    const w = analyzeWall(cfg);
    const zd = w.zoneDesigns[0];

    test('K0 ≈ 0.30 (Jaky: 1 - sin φ, φ=44.427°)', () => {
        expect(approx(w.K0, K0, 5e-3)).toBe(true);
    });

    test('M_base (hogging) = w0·H²/15', () => {
        expect(approx(zd.M_hogging, M_base)).toBe(true);
    });

    test('Total lateral force = w0·H/2', () => {
        expect(approx(w.totalLateralForce, W)).toBe(true);
    });

    test('M_sagging matches closed form', () => {
        expect(approx(zd.M_sagging, Msag, 1e-2)).toBe(true);
    });

    test('Global equilibrium: Σ reactions == W', () => {
        const br = w.beamResult;
        const Lr = br.spanLengths[0].fl();
        let sumR = 0;
        br.reactions.forEach(r => { sumR += r.Rv.fl() * Lr; });
        expect(Math.abs(sumR - W)).toBeLessThan(1e-6 * Math.max(1, W));
    });
});
