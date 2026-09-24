/**
 * Waffle slab — curtailment of support hogging bars, IS 456 Cl. 26.2.3
 * (hand-calculation checks).
 */
import { analyzeWaffleSlab } from '../components/waffleSlabEngine';

const base = {
    Lx: 6, Ly: 6, spacing_x: 0.9, spacing_y: 0.9,
    bw: 150, D: 350, Df: 75, cover: 30, fck: 25, fy: 500,
    w_live: 3, w_finish: 1.5,
};
const up50 = (v: number) => Math.ceil(v / 50) * 50;
// root of M − q·x(L − x)/2 = 0 nearest the support (x in m)
const root = (M: number, q: number, L: number) => {
    const disc = L * L / 4 - 2 * M / q;
    return disc < 0 ? null : L / 2 - Math.sqrt(disc);
};

describe('Waffle hogging bars — Cl. 26.2.3 curtailment', () => {
    test('Ld = φ·0.87fy/(4·τbd), τbd = 1.4 × 1.6 (M25, deformed) — Cl. 26.2.1', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'continuous' });
        expect(r.hogging!.x.curtailment.Ld).toBe(Math.round(16 * 0.87 * 500 / (4 * 1.4 * 1.6)));
    });

    test('interior panel: POI from the envelope of (max support M, full load) and (alternate LL, dead-only span)', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'continuous' });
        const share = r.qx / r.wu;
        const wuD = 1.5 * (r.w_dead + 1.5), wuL = 1.5 * 3;
        const trib = 0.9, L = 6;
        const M1 = r.hogging!.x.M_hog, q1 = r.wu * share * trib;
        const M2 = (wuD + 0.5 * wuL) * share * trib * L * L / 12, q2 = wuD * share * trib;
        const x0 = Math.max(root(M1, q1, L)!, root(M2, q2, L)!) * 1000;
        const c = r.hogging!.x.curtailment;
        expect(Math.abs(c.x_POI! - x0)).toBeLessThanOrEqual(2);
        // Group A: POI + max(d, 12φ, Ln/16) = POI + 375 (Ln/16 governs), ≥ 1/3 of the bars
        expect(c.extPOI).toBe(375);
        expect(c.groupA.L).toBe(up50(c.x_POI! + 375));
        expect(c.groupA.n).toBeGreaterThanOrEqual(r.hogging!.x.n_bars / 3);
    });

    test('group B: cut at max(theoretical + max(d, 12φ), Ld from face) and checked against Cl. 26.2.3.2(a)', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'continuous', rib_hog_n_bars: 3, support_width: 0.3 });
        const c = r.hogging!.x.curtailment;
        expect(c.groupA.n).toBe(1);
        expect(c.groupB!.n).toBe(2);
        expect(c.groupB!.L).toBe(up50(Math.max(c.groupB!.x_theory! + c.ext1, c.Ld + 150)));
        expect(c.groupB!.check).toBe('a');
        expect(c.groupB!.V).toBeLessThanOrEqual((2 / 3) * c.groupB!.Vc + 1e-9);
        expect(c.groupB!.L).toBeLessThan(c.groupA.L);
    });

    test('one end continuous: M_B = 0, POI from the propped-span envelope', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'one_end' });
        const share = r.qx / r.wu;
        const wuD = 1.5 * (r.w_dead + 1.5), wuL = 1.5 * 3;
        const trib = 0.9, L = 6;
        // M(x) = M_A(1 − x/L) − q·x(L − x)/2 = 0 → q/2·x² − (q·L/2 + M_A/L)·x + M_A = 0
        const rootP = (M: number, q: number) => {
            const A = q / 2, B = -(q * L / 2 + M / L), C = M;
            return (-B - Math.sqrt(B * B - 4 * A * C)) / (2 * A);
        };
        const M1 = r.hogging!.x.M_hog, q1 = r.wu * share * trib;
        const M2 = (wuD + 0.5 * wuL) * share * trib * L * L / 10, q2 = wuD * share * trib;
        const x0 = Math.max(rootP(M1, q1), rootP(M2, q2)) * 1000;
        expect(Math.abs(r.hogging!.x.curtailment.x_POI! - x0)).toBeLessThanOrEqual(2);
    });

    test('live load > dead load: alternate loading keeps the span in hogging → bars run through', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'continuous', w_live: 10, rib_hog_n_bars: 3 });
        const c = r.hogging!.x.curtailment;
        expect(c.runsThrough).toBe(true);
        expect(c.groupA.L).toBe(6000);
    });

    test('Cl. 26.2.3.2 not satisfied → group B is not curtailed', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'continuous', w_live: 10, rib_hog_n_bars: 3 });
        const g = r.hogging!.x.curtailment.groupB!;
        expect(g.check).toBe('none');
        expect(g.curtailed).toBe(false);
        expect(g.L).toBe(r.hogging!.x.curtailment.groupA.L);
    });

    test('simply supported edges: no hogging bars, no curtailment', () => {
        expect(analyzeWaffleSlab({ ...base, deflectionSupport: 'simply' }).hogging).toBeNull();
    });
});
