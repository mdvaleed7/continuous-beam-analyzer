/**
 * Cantilever support rotation (back-span flexibility) and waffle-slab support
 * hogging design — regression tests against hand calculations.
 */
import { analyzeCantileverSlab } from '../components/cantileverSlabEngine';
import { analyzeWaffleSlab } from '../components/waffleSlabEngine';

describe('Cantilever — back-span rotation', () => {
    const base = {
        L: 1.5, D: 180, cover: 20, fck: 25, fy: 500, w_live: 3, w_finish: 1.5,
        bar_main: 12, spacing_main: 150, bar_dist: 8, spacing_dist: 200,
    };

    test('fixed support (default): no rotation, same as the root deflection', () => {
        const r = analyzeCantileverSlab(base);
        expect(r.supportRotation).toBeNull();
        expect(r.deflection.a_total).toBeCloseTo(r.deflectionRoot.a_total, 2);
    });

    test('θ = M·Lb/(3EI) for a pinned far end; tip moves θ·L', () => {
        const r = analyzeCantileverSlab({ ...base, supportFixity: 'backspan', backSpan_L: 4, backSpan_farEnd: 'pinned' });
        const root = r.deflectionRoot;
        const theta = (1 / 3) * r.M_service * 1e6 * 4000 / (root.Ec * root.Ieff);
        expect(r.supportRotation!.theta_i_mrad).toBeCloseTo(theta * 1000, 1);
        expect(r.supportRotation!.a_i).toBeCloseTo(theta * root.L, 1);
        expect(r.deflection.ai).toBeCloseTo(root.ai + r.supportRotation!.a_i, 1);
        expect(r.deflection.a_creep).toBeCloseTo(root.a_creep + r.supportRotation!.a_creep, 1);
        expect(r.deflection.a_total).toBeGreaterThan(root.a_total);
    });

    test('continuous far end (k = 1/4) rotates 3/4 as much as pinned (k = 1/3)', () => {
        const p = analyzeCantileverSlab({ ...base, supportFixity: 'backspan', backSpan_L: 4, backSpan_farEnd: 'pinned' });
        const c = analyzeCantileverSlab({ ...base, supportFixity: 'backspan', backSpan_L: 4, backSpan_farEnd: 'continuous' });
        expect(c.supportRotation!.theta_i_mrad / p.supportRotation!.theta_i_mrad).toBeCloseTo(0.75, 2);
    });
});

describe('Waffle slab — support hogging (IS 456 Table 12 / 13)', () => {
    const base = {
        Lx: 6, Ly: 6, spacing_x: 0.9, spacing_y: 0.9,
        bw: 150, D: 350, Df: 75, cover: 30, fck: 25, fy: 500,
        w_live: 3, w_finish: 1.5,
    };

    test('simply supported edges: no hogging, V = 0.5·q·L', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'simply' });
        expect(r.hogging).toBeNull();
        expect(r.V_rib_x).toBeCloseTo(0.5 * r.qx * 6 * 0.9, 6);
    });

    test('continuous: M⁻ = (wD/12 + wL/9)·share·L² per rib; V = (0.5wD + 0.6wL)·share·L', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'continuous' });
        const wuD = 1.5 * (r.w_dead + 1.5), wuL = 1.5 * 3;
        const share = r.qx / r.wu;
        expect(r.hogging!.x.M_hog).toBeCloseTo((wuD / 12 + wuL / 9) * share * 36 * 0.9, 1);
        expect(r.V_rib_x).toBeCloseTo((0.5 * wuD + 0.6 * wuL) * share * 6 * 0.9, 4);
    });

    test('one-end continuous: M⁻ = (wD/10 + wL/9)·share·L²; V = 0.6·q·L', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'one_end' });
        const wuD = 1.5 * (r.w_dead + 1.5), wuL = 1.5 * 3;
        const share = r.qx / r.wu;
        expect(r.hogging!.x.M_hog).toBeCloseTo((wuD / 10 + wuL / 9) * share * 36 * 0.9, 1);
        expect(r.V_rib_x).toBeCloseTo(0.6 * r.qx * 6 * 0.9, 4);
    });

    test('rib-web hogging section: b = bw, Ast ≥ 0.85·b·d/fy, singly reinforced check', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'continuous' });
        const h = r.hogging!.x;
        const d = 350 - 30 - 8;
        expect(h.b).toBe(150);
        expect(h.d).toBe(d);
        // Mu,lim = 0.133·fck·b·d² for Fe500
        expect(h.Mu_lim).toBeCloseTo(0.133 * 25 * 150 * d * d / 1e6, 0);
        // Ast from IS 456 Annex G: Ast = 0.5 fck/fy (1 − √(1 − 4.6Mu/(fck b d²))) b d
        const Ast = 0.5 * 25 / 500 * (1 - Math.sqrt(1 - 4.6 * h.M_hog * 1e6 / (25 * 150 * d * d))) * 150 * d;
        expect(Math.abs(h.Ast_req - Math.max(Ast, 0.85 * 150 * d / 500))).toBeLessThanOrEqual(1); // helper rounds Ast up
        expect(h.Ast_provided).toBeGreaterThanOrEqual(h.Ast_req);
    });

    test('solid support zone widens the compression zone to the rib spacing', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'continuous', solid_support_zone: true });
        expect(r.hogging!.x.b).toBe(900);
    });

    test('too few hogging bars → REVISE', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'continuous', rib_hog_bar_dia: 8, rib_hog_n_bars: 1 });
        expect(r.hogging!.x.ok).toBe(false);
        expect(r.overallStatus).toBe('REVISE');
    });
});
