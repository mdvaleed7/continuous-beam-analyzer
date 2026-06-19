/**
 * Beam solver regression suite (Set A).
 *
 * The beam engine works in NORMALIZED units: load intensity w = 1 (unit),
 * lengths normalized by L_ref. Physical V = V_norm * L_ref, M = M_norm * L_ref^2.
 * For Set A we use a single span with L_ref = the span length, w = 1, and
 * scale results by w and L. Since loadCase 'udl' uses w=ONE, the normalized
 * outputs are coefficients of w*L_ref^2 (moment) and w*L_ref (shear).
 *
 * Restored from deleted tests/test_set_a.mjs (commit 2e6ac6c) and converted
 * to jest so `npm test` exercises it.
 */
import { analyzeBeam } from '../components/beamEngine';

function approx(a, b, tol = 1e-9) {
    return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
}

// Helper: run single span, w=1 (unit udl), L_ref=1 => normalized coefficients.
// Physical with arbitrary w,L: multiply M coeff by w*L^2, V coeff by w*L.
function run(endCond, nSpans = 1) {
    return analyzeBeam({ nSpans, loadCase: 'udl', endCond, L_ref_phys: 1, EI_ref_phys: 1 });
}

describe('Set A — beam solver regression', () => {
    test('A0: 1 span Pinned-Pinned UDL w, length L', () => {
        const r = run('pinned');
        const sp = r.spans[0];
        // M_max = wL^2/8 (coeff 1/8), R = wL/2 (coeff 1/2), end moments 0
        expect(approx(r.reactions[0].Rv.fl(), 0.5)).toBe(true);
        expect(approx(r.reactions[1].Rv.fl(), 0.5)).toBe(true);
        expect(approx(sp.MLeft, 0)).toBe(true);
        expect(approx(sp.MRight, 0)).toBe(true);
        expect(approx(sp.maxM, 0.125)).toBe(true);
    });

    test('A1: 1 span Fixed-Fixed UDL', () => {
        const r = run('fixed-fixed');
        const sp = r.spans[0];
        // End moments wL^2/12 hogging (coeff -1/12), midspan wL^2/24 (1/24), R = wL/2
        expect(approx(r.reactions[0].Rv.fl(), 0.5)).toBe(true);
        expect(approx(r.reactions[1].Rv.fl(), 0.5)).toBe(true);
        expect(approx(sp.MLeft, -1 / 12)).toBe(true);
        expect(approx(sp.MRight, -1 / 12)).toBe(true);
        expect(approx(sp.M(0.5), 1 / 24)).toBe(true);
    });

    test('A2: 1 span Fixed Left - Pinned right UDL', () => {
        const r = run('fixed');
        const sp = r.spans[0];
        // FEM at fixed end = wL^2/8 hogging (coeff -1/8); R_fixed = 5wL/8, R_pin = 3wL/8
        expect(approx(sp.MLeft, -1 / 8)).toBe(true);
        expect(approx(sp.MRight, 0, 1e-9)).toBe(true);
        expect(approx(r.reactions[0].Rv.fl(), 0.625)).toBe(true);
        expect(approx(r.reactions[1].Rv.fl(), 0.375)).toBe(true);
    });

    test('A3: 2 equal spans Pinned-Pinned outer ends UDL both spans', () => {
        const r = run('pinned', 2);
        // Centre support moment = wL^2/8 hog (coeff -1/8); R_outer=3wL/8, R_centre=5wL/4
        const sp0 = r.spans[0];
        expect(approx(sp0.MRight, -1 / 8)).toBe(true);
        expect(approx(r.reactions[0].Rv.fl(), 0.375)).toBe(true);
        expect(approx(r.reactions[2].Rv.fl(), 0.375)).toBe(true);
        expect(approx(r.reactions[1].Rv.fl(), 1.25)).toBe(true);
    });
});
