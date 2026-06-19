/**
 * Wall engine regression suite (Set B).
 *
 * Restored from deleted tests/test_set_b.mjs (commit 2e6ac6c) and converted
 * to jest. Validates the wall engine against closed-form propped-cantilever
 * solutions for triangular lateral pressure.
 */
import { analyzeBeam, toFrac } from '../components/beamEngine';
import { analyzeWall } from '../components/wallEngine';

function approx(a, b, tol = 1e-2) {
    return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
}

const mat = { grade: 'M25', fck: 25, steelGrade: 'Fe415', fy: 415, cover: 40, E: 25000 };

describe('Set B — wall engine regression', () => {
    test('B0 — single zone, dry, triangular 0->K0*g*H, base fixed, top roller', () => {
        const H = 4, K0 = 0.3, g = 18, lf = 1;
        const w0 = K0 * g * H; // 21.6
        const cfg = {
            zones: [{ height: H, thickness: 300 }],
            soilParams: { phi: 44.427, gamma_soil: g, gamma_water: 9.81, waterTableDepth: 999, surcharge: 0, waterMode: 'dry' },
            material: mat, loadFactor: lf,
        };
        const w = analyzeWall(cfg);
        // closed-form propped cantilever: M_base=w0 H^2/15, R_top=w0 H/10
        expect(approx(w.K0, 0.3, 5e-3)).toBe(true);
        expect(approx(w.zoneDesigns[0].M_hogging, w0 * H * H / 15)).toBe(true);
        expect(approx(w.totalLateralForce, w0 * H / 2)).toBe(true);
        const xstar = Math.sqrt(2 * H * (w0 * H / 10) / w0);
        const Msag = (w0 * H / 10) * xstar - w0 * Math.pow(xstar, 3) / (6 * H);
        expect(approx(w.zoneDesigns[0].M_sagging, Msag)).toBe(true);
    });

    test('B1 — single zone, fully submerged: p = K0*g_sub*z + g_w*z', () => {
        const H = 4, K0 = 0.3, g = 18, gw = 9.81, lf = 1;
        const g_sub = g - gw; // 8.19
        const p_base = (K0 * g_sub + gw) * H; // combined at base
        const cfg = {
            zones: [{ height: H, thickness: 300 }],
            soilParams: { phi: 44.427, gamma_soil: g, gamma_water: gw, waterTableDepth: 0, surcharge: 0, waterMode: 'submerged' },
            material: mat, loadFactor: lf,
        };
        const w = analyzeWall(cfg);
        // combined pressure is still TRIANGULAR (0 at top -> p_base at base),
        // so same propped-cantilever closed form:
        expect(approx(w.totalLateralForce, p_base * H / 2, 2e-2)).toBe(true);
        expect(approx(w.zoneDesigns[0].M_hogging, p_base * H * H / 15, 2e-2)).toBe(true);
    });

    test('B2 — 2-zone wall, same total H, uniform thickness (propped 2-span)', () => {
        const H1 = 2, H2 = 2, H = H1 + H2, K0 = 0.3, g = 18, lf = 1;
        const cfg = {
            zones: [{ height: H1, thickness: 300 }, { height: H2, thickness: 300 }],
            soilParams: { phi: 44.427, gamma_soil: g, gamma_water: 9.81, waterTableDepth: 999, surcharge: 0, waterMode: 'dry' },
            material: mat, loadFactor: lf,
        };
        const w = analyzeWall(cfg);
        // Independent: 2-span propped continuous via direct beamEngine with interior roller.
        const p1 = K0 * g * H1, p2 = K0 * g * H;
        const dcfg = {
            nSpans: 2, loadCase: 'custom', endCond: 'fixed-right',
            spanLengths: [toFrac(H1), toFrac(H2)], spanEIs: [toFrac(1), toFrac(1)],
            customLoads: [{ wL: toFrac(0), wR: toFrac(p1) }, { wL: toFrac(p1), wR: toFrac(p2) }],
            supportMask: [true, true, true], refSpanL: 0, refSpanEI: 0, L_ref_phys: H1, EI_ref_phys: 1,
        };
        const r = analyzeBeam(dcfg);
        const Lr = dcfg.spanLengths[0].fl();
        let Mhog = 0, Msag = 0;
        r.spans.forEach(sp => {
            const aL = sp.alpha.fl();
            for (let j = 0; j <= 200; j++) {
                const m = sp.M((j / 200) * aL) * Lr * Lr;
                if (m > 0) Msag = Math.max(Msag, m);
                else Mhog = Math.max(Mhog, -m);
            }
        });
        const wallMhog = w.zoneDesigns.reduce((a, z) => Math.max(a, z.M_hogging), 0);
        const wallMsag = w.zoneDesigns.reduce((a, z) => Math.max(a, z.M_sagging), 0);
        expect(approx(wallMhog, Mhog, 2e-2)).toBe(true);
        expect(approx(wallMsag, Msag, 2e-2)).toBe(true);
    });
});
