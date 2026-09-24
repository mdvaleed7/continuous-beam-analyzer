/**
 * Slab deflection review (2026-09): regression tests against hand calculations.
 *
 *  D1  post-construction deflection includes the short-term live-load part
 *  D2  permanent-load stiffness uses the section cracked under M_service
 *  D3  α consistent with the moment diagram (BS 8110-2 Table 3.1 K)
 *  D4  shrinkage k4 extended below (pt − pc) = 0.25 instead of 0
 *  D5  flat slab panel-centre deflection by crossing strips (c/c spans)
 *  D6  flat slab column strip = 0.5·min(L1, L2)  (IS 456 Cl. 31.1.1 a)
 *  D7  waffle rib moment paired with its own span; α matches SS moments
 *  D8  cantilever tip load deflected with α = 1/3
 */
import { annexCAlpha, annexCK4, staticBeta, annexCDeflection } from '../lib/is456';
import { analyzeSlab } from '../components/slabEngine';
import { analyzeFlatSlab } from '../components/flatSlabEngine';
import { analyzeWaffleSlab } from '../components/waffleSlabEngine';
import { analyzeCantileverSlab } from '../components/cantileverSlabEngine';

describe('α coefficient (BS 8110-2 Table 3.1)', () => {
    test('K = 0.104(1 − β/10); β = 0 ≈ 5/48, β = 4 ≈ 1/16; cantilever 1/4', () => {
        expect(annexCAlpha('simply', 0)).toBeCloseTo(0.104, 4);
        expect(annexCAlpha('continuous', 4)).toBeCloseTo(0.0624, 4);
        expect(annexCAlpha('continuous', 9)).toBeCloseTo(0.0624, 4); // β capped at 4
        expect(annexCAlpha('cantilever', 2)).toBe(0.25);
    });

    test('β from equilibrium: M_C = wL²/12 → β = 1; wL²/10 → 0.5; wL²/8 → 0', () => {
        expect(staticBeta(1 / 12)).toBeCloseTo(1.0, 6);
        expect(staticBeta(1 / 10)).toBeCloseTo(0.5, 6);
        expect(staticBeta(1 / 8)).toBeCloseTo(0, 6);
    });

    test('one-way continuous slab uses α = 0.104·0.9 = 0.0936 (not 1/16)', () => {
        const r = analyzeSlab({ Lx: 4, Ly: 10, D: 150, fck: 25, fy: 500, LL: 3, SDL: 1.5, slabType: 'one-way', supportCondition: 'continuous' });
        expect(r.deflection.alpha).toBeCloseTo(0.0936, 4);
    });

    test('two-way Case 1, Ly/Lx = 1: β = 2·0.032/0.024 = 2.667 → α = 0.0763', () => {
        const r = analyzeSlab({ Lx: 4, Ly: 4, D: 130, fck: 25, fy: 500, LL: 3, SDL: 1.5, slabType: 'two-way', boundaryCase: 1 });
        expect(r.deflection.beta).toBeCloseTo(2.667, 2);
        expect(r.deflection.alpha).toBeCloseTo(0.0763, 4);
    });
});

describe('shrinkage k4 (Annex C-3.1)', () => {
    test('pt = 0.158 %: k4 = 0.72·√0.158 = 0.286 (was 0)', () => {
        expect(annexCK4(0.158, 0)).toBeCloseTo(0.72 * Math.sqrt(0.158), 4);
    });
    test('code range unchanged: pt = 0.5 → 0.509; pt = 1.5 → 0.65·√1.5 = 0.796', () => {
        expect(annexCK4(0.5, 0)).toBeCloseTo(0.72 * 0.5 / Math.sqrt(0.5), 4);
        expect(annexCK4(1.5, 0)).toBeCloseTo(0.65 * Math.sqrt(1.5), 4);
    });
    test('lightly reinforced two-way slab now has non-zero shrinkage deflection', () => {
        const r = analyzeSlab({ Lx: 4, Ly: 4, D: 130, fck: 25, fy: 500, LL: 3, SDL: 1.5, slabType: 'two-way', boundaryCase: 1 });
        expect(r.deflection.a_shrinkage).toBeGreaterThan(0);
    });
});

describe('Annex C hand calculation — SS strip, L = 4 m, D = 150, 10 @ 150, M25', () => {
    // Hand calc: d = 125, Ec = 25000, m = 8, Ast = 523.6
    //  Igr = 281.25e6, fcr = 3.5, Mcr = 13.125 kN·m
    //  x: 500x² + 4188.8x − 523600 = 0 → x = 28.44 mm, Icr = 1000x³/3 + 8·523.6·(d−x)² = 46.71e6
    //  Ms = 16.5 > Mcr → Ieff = Icr/(1.2 − 0.7955·(z/d)(1−x/d)) with z = 115.52
    const Ast = Math.PI * 25 * 1000 / 150;
    const r = annexCDeflection(
        { Lx: 4000, D: 150, cover: 20, fck: 25, fy: 500 },
        { barDia_x_bot: 10, Ast_x_bot: Ast, M_service: 16.5, M_perm: 10.5, supportCondition: 'simply', beta: 0 },
    );
    const x = (-8 * Ast + Math.sqrt((8 * Ast) ** 2 + 2 * 1000 * 8 * Ast * 125)) / 1000;
    const Icr = 1000 * x ** 3 / 3 + 8 * Ast * (125 - x) ** 2;
    const Ieff = Icr / (1.2 - (13.125 / 16.5) * ((125 - x / 3) / 125) * (1 - x / 125));

    test('section properties', () => {
        expect(r.Mcr).toBeCloseTo(13.13, 1);
        expect(r.x).toBeCloseTo(28.44, 1);
        expect(r.Icr / 1e6).toBeCloseTo(Icr / 1e6, 3);
        expect(r.Ieff / 1e6).toBeCloseTo(Ieff / 1e6, 3);
    });

    test('D2: M_perm (10.5) < Mcr < M_service → permanent stiffness is the cracked I_eff', () => {
        expect(r.Ieff_perm).toBeCloseTo(r.Ieff, 3);
        expect(r.Ieff_perm).toBeLessThan(r.Igr);
        // a_i,perm = 0.104·10.5e6·4000²/(25000·Ieff)
        expect(r.ai_perm).toBeCloseTo(0.104 * 10.5e6 * 16e6 / (25000 * Ieff), 1);
    });

    test('D1: a_post = (a_i − a_i,perm) + a_creep + a_shrinkage', () => {
        expect(r.a_live).toBeCloseTo(r.ai - r.ai_perm, 1);
        expect(r.a_post_construction).toBeCloseTo(r.a_live + r.a_creep + r.a_shrinkage, 1);
        expect(r.a_total).toBeCloseTo(r.ai + r.a_creep + r.a_shrinkage, 1);
    });
});

describe('D1 end-to-end: SS one-way slab 4 m / 150 mm', () => {
    test('post-construction now carries the live-load part (≈ 11.2 mm vs 5.8 mm before the fix)', () => {
        const r = analyzeSlab({ Lx: 4, Ly: 10, D: 150, fck: 25, fy: 500, LL: 3, SDL: 1.5, slabType: 'one-way', supportCondition: 'simply' });
        const d = r.deflection;
        expect(d.limit_post).toBeCloseTo(11.43, 2);
        expect(d.a_live).toBeGreaterThan(5);
        expect(d.a_post_construction).toBeCloseTo(d.a_live + d.a_creep + d.a_shrinkage, 1);
        expect(d.a_post_construction).toBeGreaterThan(10);
        expect(d.status_total).toBe('FAIL'); // 20.7 mm > L/250 = 16 mm
    });
});

describe('Flat slab (D5, D6)', () => {
    const base = {
        L1: 7, L2: 7, c1: 0.5, c2: 0.5, hasDrop: false, dropL1: 0, dropL2: 0, dropDepth: 0,
        D: 230, cover: 20, fck: 30, fy: 500, w_live: 4, w_finish: 1.5,
        panelType: 'interior' as const, bar_dia: 12, bar_spacing: 150,
    };

    test('D6: column strip width = 0.5·min(L1, L2)', () => {
        expect(analyzeFlatSlab({ ...base, L1: 6, L2: 8 }).colStripWidth).toBeCloseTo(3.0, 6);
        expect(analyzeFlatSlab({ ...base, L1: 8, L2: 6 }).colStripWidth).toBeCloseTo(3.0, 6);
    });

    test('D5: panel-centre deflection = column strip + orthogonal middle strip, on c/c span', () => {
        const r = analyzeFlatSlab(base);
        const s = r.deflectionStrips;
        expect(r.deflection.L).toBe(7000);
        expect(r.deflection.a_total).toBeGreaterThan(s.cs1.a_total);
        expect(r.deflection.a_total).toBeCloseTo(s.cs1.a_total + s.ms2.a_total, 0);
        // β for interior panel: 2·0.65/0.35 = 3.714 → α = 0.0654
        expect(s.cs1.alpha).toBeCloseTo(0.104 * (1 - 3.7143 / 10), 4);
    });

    test('exterior panel deflection uses the exterior positive moment (0.52·M0)', () => {
        const int = analyzeFlatSlab(base).deflectionStrips.cs1;
        const ext = analyzeFlatSlab({ ...base, panelType: 'exterior' }).deflectionStrips.cs1;
        expect(ext.ai).toBeGreaterThan(int.ai);
    });
});

describe('Waffle slab (D7)', () => {
    const base = {
        Lx: 6, Ly: 9, spacing_x: 0.9, spacing_y: 0.9,
        bw: 150, D: 350, Df: 75, cover: 30, fck: 25, fy: 500,
        w_live: 3, w_finish: 1.5,
    };
    test('governing rib is deflected over its own span', () => {
        const r = analyzeWaffleSlab(base);
        const ribSpan = r.ribX.Ast_req >= r.ribY.Ast_req ? 6000 : 9000;
        expect(r.deflection.L).toBe(ribSpan);
    });
    test('simply supported grid moments → α = 0.104 even with continuous edges', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'continuous' });
        expect(r.deflection.alpha).toBeCloseTo(0.104, 4);
        expect(r.hogging).not.toBeNull();
    });
});

describe('Cantilever slab (D8)', () => {
    const base = {
        L: 1.5, D: 180, cover: 20, fck: 25, fy: 500, w_live: 3, w_finish: 1.5,
        bar_main: 12, spacing_main: 150, bar_dist: 8, spacing_dist: 200,
    };
    test('tip parapet load deflects with α = 1/3', () => {
        const r = analyzeCantileverSlab({ ...base, parapetHeight: 1.0, parapetThickness: 115, parapetDensity: 20 });
        const d = (180 - 20 - 6) / 1000;
        const Le = 1.5 + d / 2;
        const P = 1.0 * 0.115 * 20;
        const Mu = r.M_service - P * Le;
        const expected = (0.25 * Mu + (1 / 3) * P * Le) / r.M_service;
        expect(r.deflection.alpha).toBeCloseTo(expected, 5);
        expect(r.deflection.alpha).toBeGreaterThan(0.25);
    });
    test('no parapet → α = 1/4', () => {
        expect(analyzeCantileverSlab(base).deflection.alpha).toBe(0.25);
    });
});
