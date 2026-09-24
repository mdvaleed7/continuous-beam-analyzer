/**
 * Optimization & calculation review (2026-09): regression tests against hand
 * calculations for walls, slabs and footings.
 *
 *  Flat slab   — DDM end-span coefficients with αc (Cl. 31.4.3.3), punching with
 *                moment transfer (Cl. 31.6 / 31.4.5.2), steel quantity per panel
 *  Footing     — SBC checked without the 1.25 factor, net factored pressure
 *                γf(p − W/A), exact no-tension bearing, central band (Cl. 34.3.1 c),
 *                steel quantity
 *  Ret. wall   — stem horizontal steel (Cl. 32.5 c)
 *  Basement    — K0 for φ = 0, crack width (Annex F), P–M capacity (Cl. 39),
 *                construction-stage cantilever, shear without links, per-zone
 *                optimizer minimum
 *  Slab        — Table 26 case 5, short-span support per case, capacity-based
 *                flexure utilization, extended optimizer sweeping real bars,
 *                single wastage
 *  Cantilever  — no duplicate "no bottom mat" trials, formwork soffit + edge
 *  Waffle      — single wastage in the optimizer cost
 */
import {
    computeCost, flexuralCapacity, sectionMomentCapacityAtAxial, steelStressIS,
    crackWidthAnnexF, slabDepthFactorK, computeRequiredDepthForBM, getTauC,
} from '../lib/is456';
import { analyzeFlatSlab, ddmCoefficients } from '../components/flatSlabEngine';
import { analyzeFooting, noTensionBearing, type FootingConfig } from '../components/footingEngine';
import { analyzeRetainingWall } from '../components/retainingWallEngine';
import { analyzeWall, optimizeWall } from '../components/wallEngine';
import { analyzeSlab, optimizeSlab, optimizeSlabExtended } from '../components/slabEngine';
import { optimizeCantileverSlab } from '../components/cantileverSlabEngine';
import { optimizeWaffleSlab } from '../components/waffleSlabEngine';

// ═══════════════════════════════════════════════════════════════════════════
//  IS 456 helpers
// ═══════════════════════════════════════════════════════════════════════════

describe('IS 456 helpers', () => {
    test('P–M capacity at P = 0 equals the rectangular-parabolic block (b 1000, D 300, As 1000 @ 250, M25/Fe500)', () => {
        // C = 0.36105·fck·b·xu at 0.41597·xu (Fig. 21 block, exact); T = 0.87·fy·As
        const xu = 0.87 * 500 * 1000 / (0.36105 * 25 * 1000);                 // 48.19 mm
        const M = (0.36105 * 25 * 1000 * xu * (150 - 0.41597 * xu) + 0.87 * 500 * 1000 * 100) / 1e6;
        expect(sectionMomentCapacityAtAxial(1000, 300, [{ As: 1000, y: 250 }], 25, 500, 0)).toBeCloseTo(M, 2);
    });

    test('P–M capacity is zero beyond the squash load', () => {
        // Strain 0.002 everywhere: 0.446·fck·Ac + (fs(0.002) − 0.446·fck)·As
        const fs = steelStressIS(0.002, 500);
        const Puz = (0.446 * 25 * 1000 * 300 + (fs - 0.446 * 25) * 2000) / 1e3;
        const layers = [{ As: 1000, y: 50 }, { As: 1000, y: 250 }];
        expect(sectionMomentCapacityAtAxial(1000, 300, layers, 25, 500, 1.01 * Puz)).toBe(0);
        expect(sectionMomentCapacityAtAxial(1000, 300, layers, 25, 500, 0.9 * Puz)).toBeGreaterThan(0);
    });

    test('Fe500 design stress–strain (Fig. 23A): 0.8·fyd elastic limit, interpolation, plateau', () => {
        const fyd = 0.87 * 500;
        expect(steelStressIS(0.001, 500)).toBeCloseTo(200, 6);
        // between (0.85 fyd, 0.85 fyd/Es + 0.0001) and (0.90 fyd, 0.90 fyd/Es + 0.0003)
        const e0 = 0.85 * fyd / 2e5 + 0.0001, e1 = 0.90 * fyd / 2e5 + 0.0003;
        expect(steelStressIS(0.002, 500)).toBeCloseTo(0.85 * fyd + 0.05 * fyd * (0.002 - e0) / (e1 - e0), 6);
        expect(steelStressIS(-0.01, 500)).toBeCloseTo(-fyd, 6);
    });

    test('slab depth factor k (Cl. 40.2.1.1): 1.30 ≤ 150 mm, 1.00 ≥ 300 mm, linear between', () => {
        expect(slabDepthFactorK(150)).toBe(1.30);
        expect(slabDepthFactorK(225)).toBeCloseTo(1.15, 10);
        expect(slabDepthFactorK(400)).toBe(1.00);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Flat slab
// ═══════════════════════════════════════════════════════════════════════════

describe('Flat slab — DDM distribution (IS 456 Cl. 31.4.3.2 / 31.4.3.3)', () => {
    test('interior span: 0.65 negative / 0.35 positive', () => {
        const c = ddmCoefficients(false, 1);
        expect(c.negInt).toBe(0.65);
        expect(c.pos).toBe(0.35);
        expect(c.negExt).toBe(0);
    });

    test('end span, αc = 1 → 1/(1 + 1/αc) = 0.5: 0.70 / 0.49 / 0.325', () => {
        const c = ddmCoefficients(true, 1);
        expect(c.negInt).toBeCloseTo(0.75 - 0.10 * 0.5, 10);
        expect(c.pos).toBeCloseTo(0.63 - 0.28 * 0.5, 10);
        expect(c.negExt).toBeCloseTo(0.65 * 0.5, 10);
    });

    test('end span, αc = 3 → f = 0.75: 0.675 / 0.42 / 0.4875', () => {
        const c = ddmCoefficients(true, 3);
        expect(c.negInt).toBeCloseTo(0.675, 10);
        expect(c.pos).toBeCloseTo(0.42, 10);
        expect(c.negExt).toBeCloseTo(0.4875, 10);
    });
});

describe('Flat slab — 6 × 6 m interior panel, 400 × 400 columns, D = 200 (no drop)', () => {
    const input = {
        L1: 6, L2: 6, c1: 0.4, c2: 0.4, hasDrop: false, dropL1: 0, dropL2: 0, dropDepth: 200,
        D: 200, cover: 25, fck: 25, fy: 500, w_live: 3, w_finish: 1.5,
        panelType: 'interior' as const, bar_dia: 12, bar_spacing: 150,
    };

    test('punching: τv = V/(u·d) + γv·M·c/Jc = 1.485 > 0.25√fck = 1.25 → REVISE', () => {
        const r = analyzeFlatSlab(input);
        const p = r.punchingChecks.find(c => c.location === 'Interior column')!;
        const d = 200 - 25 - 12;                                 // mean of the two layers (169, 157)
        const a1 = 400 + d;                                      // critical section at d/2
        const wu = 1.5 * (0.2 * 25 + 1.5 + 3);
        const V = wu * (6 * 6 - (a1 / 1000) ** 2);               // 508.5 kN
        const tauDirect = V * 1e3 / (4 * a1 * d);                // 1.385
        // αc at the interior joint: 2 columns (3 m) vs 2 slab spans (Cl. 31.4.3.3)
        const Kc = 2 * (0.4 * 0.4 ** 3 / 12) / 3;
        const Ks = (6 * 0.2 ** 3 / 12) / 6;
        const ac = Kc / (2 * Ks);                                // 1.067
        // Unbalanced moment, equal spans (Cl. 31.4.5.2): 0.08·(0.5·wl)·l2·ln²/(1 + 1/αc)
        const M = 0.08 * 0.5 * (1.5 * 3) * 6 * 5.6 ** 2 / (1 + 1 / ac);   // 17.48 kN·m
        const J = d * a1 ** 3 / 6 + a1 * d ** 3 / 6 + d * a1 * a1 * a1 / 2;
        const gv = 1 - 1 / (1 + (2 / 3) * Math.sqrt(1));         // 0.4 (Cl. 31.6.2.2)
        const tauM = gv * M * 1e6 * (a1 / 2) / J;                // 0.099
        expect(p.d).toBeCloseTo(d, 1);
        expect(p.V).toBeCloseTo(V, 1);
        expect(p.tau_v).toBeCloseTo(tauDirect + tauM, 2);
        expect(p.tau_c).toBeCloseTo(0.25 * Math.sqrt(25), 3);    // ks = 0.5 + βc = 1.5 → 1.0
        expect(p.ok).toBe(false);
        expect(r.overallStatus).toBe('REVISE');
    });

    test('steel quantity: bottom bars over the full span, top bars 0.3·ln from each support', () => {
        const r = analyzeFlatSlab({ ...input, D: 240 });
        const ln = 6 - 0.4;
        const kg = (z: { bars: { Ast_provided: number }; width: number } | null, len: number) =>
            z ? z.bars.Ast_provided * z.width * len * 7850 / 1e6 : 0;
        const { dir1, dir2 } = r.zones;
        const expected =
            kg(dir1.posCol, 6) + kg(dir1.posMid, 6) + kg(dir1.negCol, 2 * 0.3 * ln) + kg(dir1.negMid, 2 * 0.3 * ln)
            + kg(dir2.posCol, 6) + kg(dir2.posMid, 6) + kg(dir2.negCol, 2 * 0.3 * ln) + kg(dir2.negMid, 2 * 0.3 * ln)
            + r.transferChecks.reduce((s, t) => s + t.Ast_extra * 2 * 0.3 * ln * 7850 / 1e6, 0);
        expect(r.steelWeight_kg).toBeCloseTo(expected, 6);
        expect(r.steelWeight_kg).toBeGreaterThan(200);   // a whole 36 m² panel, not a 1 m strip
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Footing
// ═══════════════════════════════════════════════════════════════════════════

const footing = (over: Partial<FootingConfig> = {}): FootingConfig => ({
    label: 'F1', footingType: 'flat', col_a: 400, col_b: 400,
    loadCases: [{ label: 'LC1', Fy: 900, Mx: 0, Mz: 0, sbc: 200 }],
    Fy: 900, Mx: 0, Mz: 0, sbc: 200,
    depthFill: 1.0, gammaFill: 18, gammaConcrete: 25,
    fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500', cover: 50, barDiaX: 12, barDiaZ: 12,
    L: 2.2, B: 2.2, D: 0.5, pedestalOffset: 0, pedestal_a: 400, pedestal_b: 400,
    ...over,
});

describe('Footing — bearing and design pressure', () => {
    test('SBC is compared with the service pressure itself (no 1.25 increase): 215.9 > 200 → REVISE', () => {
        const r = analyzeFooting(footing());
        // W = 2.2²·0.5·25 + (2.2² − 0.4²)·1.0·18 = 60.5 + 84.24
        const p = (900 + 60.5 + 84.24) / 4.84;
        expect(r.soilPressure.p_max).toBeCloseTo(p, 1);
        expect(r.soilPressure.sbcCheckFactor).toBe(1);
        expect(r.soilPressure.sbcCheck).toBe(false);          // passed before with 1.25 × SBC = 250
        expect(r.overallStatus).toBe('REVISE');
    });

    test('net factored design pressure γf·(p − W/A) = 1.5·900/4.84', () => {
        const r = analyzeFooting(footing());
        expect(r.soilPressure.p_max_net_factored).toBeCloseTo(1.5 * 900 / 4.84, 1);
    });

    test('no-tension bearing, uniaxial: p_max = 2N/(3·B·(L/2 − e)) in either direction', () => {
        const a = noTensionBearing(1000, 0.6, 0, 2.5, 2);
        expect(a.p_max).toBeCloseTo(2 * 1000 / (3 * 2 * (1.25 - 0.6)), 6);   // 512.82
        expect(a.contactFraction).toBeCloseTo(3 * (1.25 - 0.6) / 2.5, 6);
        const b = noTensionBearing(1000, 0, 0.5, 2.5, 2);
        expect(b.p_max).toBeCloseTo(2 * 1000 / (3 * 2.5 * (1 - 0.5)), 6);     // 533.33
    });

    test('no-tension bearing, biaxial: the compressed region carries N and both moments', () => {
        const N = 1000, ex = 0.3, ez = 0.2, L = 2.5, B = 2;
        const r = noTensionBearing(N, ex, ez, L, B);
        const { a, b, c } = r.plane!;
        // independent midpoint integration of max(0, a + b·x + c·z)
        const n = 400;
        let F = 0, Mx = 0, Mz = 0;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const x = -L / 2 + (i + 0.5) * L / n, z = -B / 2 + (j + 0.5) * B / n;
                const p = Math.max(0, a + b * x + c * z) * (L / n) * (B / n);
                F += p; Mx += p * x; Mz += p * z;
            }
        }
        expect(F / N).toBeCloseTo(1, 3);
        expect(Mx / (N * ex)).toBeCloseTo(1, 2);
        expect(Mz / (N * ez)).toBeCloseTo(1, 2);
        expect(r.contactFraction).toBeLessThan(1);             // ex/L + ez/B = 0.22 > 1/6
        expect(r.p_max).toBeGreaterThan(N / (L * B) * (1 + 6 * ex / L + 6 * ez / B));
    });
});

describe('Footing — reinforcement', () => {
    test('rectangular footing 3.0 × 2.0: central band 2/(β + 1) of the short-direction steel (Cl. 34.3.1 c)', () => {
        const r = analyzeFooting(footing({ L: 3.0, B: 2.0, sbc: 250, loadCases: [{ label: 'LC1', Fy: 900, Mx: 0, Mz: 0, sbc: 250 }] }));
        const cb = r.centralBand!;
        expect(cb.beta).toBeCloseTo(1.5, 6);
        expect(cb.As_band).toBeCloseTo(cb.As_total * 2 / (1.5 + 1), 0);
        expect(cb.bandWidth).toBeCloseTo(2.0, 6);
        // the outer strips keep at least the minimum steel 0.12 %·1000·500
        expect(cb.outer_per_m).toBeGreaterThanOrEqual(600);
    });

    test('steel quantity = Σ Ast,prov × width × (length − 2·cover)', () => {
        const r = analyzeFooting(footing());
        const bx = r.flexureX.bars!, bz = r.flexureZ.bars!;
        const expected = (bx.Ast_provided * 2.2 * (2.2 - 0.1) + bz.Ast_provided * 2.2 * (2.2 - 0.1)) * 7850 / 1e6;
        expect(r.steelWeight_kg).toBeCloseTo(expected, 1);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Retaining wall
// ═══════════════════════════════════════════════════════════════════════════

describe('Retaining wall — stem horizontal steel (Cl. 32.5 c)', () => {
    test('0.20 % of b·t for Fe500 deformed bars, half per face: 400 mm²/m for a 400 mm stem', () => {
        const r = analyzeRetainingWall({
            H: 4000, D_stem_base: 400, D_stem_top: 200, D_base: 400, B: 2400, B_toe: 600,
            phi: 30, gamma_soil: 18, gamma_concrete: 24, q_surcharge: 10, mu: 0.45, sbc: 200,
            waterTableDepth: 0, fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500', cover: 50, loadFactor: 1.5,
        });
        expect(r.stem_horizontal.ratio).toBe(0.002);
        expect(r.stem_horizontal.Ast_per_face).toBe(400);
        expect(r.stem_horizontal.bars.Ast_provided).toBeGreaterThanOrEqual(400);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Basement wall
// ═══════════════════════════════════════════════════════════════════════════

const soilDry = { phi: 30, gamma_soil: 18, gamma_water: 9.81, waterTableDepth: 999, groundLevelDepth: 0, waterMode: 'dry' as const, surcharge: 10 };
const matWall = { grade: 'M25', fck: 25, steelGrade: 'Fe500', fy: 500, cover: 40 };

describe('Basement wall — single 4 m zone, t = 400 mm', () => {
    const base = { zones: [{ height: 4, thickness: 400 }], soilParams: soilDry, material: matWall, loadFactor: 1.5 };

    test('φ = 0 gives K0 = 1 (was silently replaced by 30°)', () => {
        expect(analyzeWall({ ...base, soilParams: { ...soilDry, phi: 0 } }).K0).toBeCloseTo(1, 10);
    });

    test('crack width on the earth face — IS 456 Annex F, written out', () => {
        const zd = analyzeWall(base).zoneDesigns[0];
        const bars = zd.mainBars_hogging;
        const Ms = zd.M_hogging / 1.5, h = 400, d = zd.d_hogging, As = bars.Ast_provided;
        const m = 200000 / (0.5 * 5000 * Math.sqrt(25));
        const x = (-m * As + Math.sqrt((m * As) ** 2 + 2 * 1000 * m * As * d)) / 1000;
        const fs = Ms * 1e6 / (As * (d - x / 3));
        const eps1 = fs / 200000 * (h - x) / (d - x);
        const epsm = eps1 - 1000 * (h - x) * (h - x) / (3 * 200000 * As * (d - x));
        const acr = Math.sqrt((bars.spacing / 2) ** 2 + (40 + bars.dia / 2) ** 2) - bars.dia / 2;
        const w = 3 * acr * epsm / (1 + 2 * (acr - 40) / (h - x));
        expect(zd.crack.hogging.Ms).toBeCloseTo(Ms, 6);
        expect(zd.crack.hogging.w).toBeCloseTo(w, 3);
        expect(zd.crack.hogging.w).toBeLessThanOrEqual(0.2);
        expect(crackWidthAnnexF(Ms, 1000, h, d, As, bars.dia, bars.spacing, 40, 25, 500).w).toBeCloseTo(w, 3);
    });

    test('shear is resisted without links: τv ≤ k·τc with k = 1.0 (D ≥ 300)', () => {
        const zd = analyzeWall(base).zoneDesigns[0];
        expect(zd.shear_k).toBe(1.0);
        expect(zd.shear.tau_v).toBeLessThanOrEqual(zd.shear.tau_c);
        expect(zd.shearOk).toBe(true);
        // fixed base: the earth face is in tension at the governing section
        expect(zd.shearAt).toEqual(expect.objectContaining({ at: 'bottom', face: 'h' }));
    });

    test('axial load + slenderness (Cl. 32.2): He = 0.75H, ea = He²/2500t, Pu = 1.5·(P + self-weight)', () => {
        const zd = analyzeWall({ ...base, axialLoad: 200 }).zoneDesigns[0];
        expect(zd.pm.He).toBeCloseTo(3.0, 6);
        expect(zd.pm.slenderness).toBeCloseTo(3000 / 400, 1);
        expect(zd.pm.ea).toBeCloseTo(3000 ** 2 / (2500 * 400), 1);           // 9.0 mm
        expect(zd.pm.Pu).toBeCloseTo(1.5 * (200 + 0.4 * 4 * 25), 1);          // 360 kN/m
        expect(zd.pm.ok).toBe(true);
    });

    test('construction stage: cantilever M = γf·(K0·γ·H³/6 + K0·q·H²/2) = 204 kN·m', () => {
        const zd = analyzeWall({ ...base, checkConstructionStage: true }).zoneDesigns[0];
        expect(zd.construction!.M).toBeCloseTo(1.5 * (0.5 * 18 * 64 / 6 + 0.5 * 10 * 16 / 2), 3);
        expect(zd.construction!.V).toBeCloseTo(1.5 * (0.5 * 18 * 16 / 2 + 0.5 * 10 * 4), 3);
        expect(zd.M_hogging).toBeCloseTo(204, 3);                               // governs the earth face
    });

    test('horizontal steel spacing ≤ min(3t, 450) and ≥ 0.20 %·b·t/2 per face', () => {
        const zd = analyzeWall(base).zoneDesigns[0];
        expect(zd.distBars.Ast_provided).toBeGreaterThanOrEqual(0.002 * 1000 * 400 / 2);
        expect(zd.distBars.spacing).toBeLessThanOrEqual(450);
    });
});

describe('Basement wall optimizer — per-zone minimum thickness', () => {
    const cfg = {
        zones: [{ height: 3.0, thickness: 300 }, { height: 3.2, thickness: 300 }, { height: 3.5, thickness: 300 }],
        soilParams: soilDry, material: matWall, loadFactor: 1.5,
        minThk: 150, maxThk: 500, thkStep: 50,
    };

    test('the top zone may be thinner than the Mu,lim minimum of the most loaded zone', () => {
        const o = optimizeWall(cfg);
        expect(o.optimum).not.toBeNull();
        const t = o.optimum!.thicknesses;
        // The old single wall-wide minimum: max over zones of d(Mu,lim) + cover + φmax/2
        const ref = analyzeWall({ ...cfg, zones: cfg.zones.map(z => ({ ...z, thickness: 500 })) });
        const globalMin = Math.max(...ref.zoneDesigns.map(zd =>
            Math.ceil(computeRequiredDepthForBM(zd.M_governing, 25, 500, 1000).d_req + 40 + 25 / 2)));
        expect(t[0]).toBeLessThan(globalMin);
        expect(t[0]).toBeLessThan(t[2]);
        // every zone of the optimum passes every check
        for (const zd of o.optimum!.result.zoneDesigns) {
            expect(zd.ok).toBe(true);
            expect(zd.shear.tau_v).toBeLessThanOrEqual(zd.shear_k * zd.shear.tau_c + 1e-9);
            expect(zd.crack.hogging.w).toBeLessThanOrEqual(0.2);
            expect(zd.crack.sagging.w).toBeLessThanOrEqual(0.3);
        }
    });

    test('where τc falls short the tension bars are increased (Table 19) instead of adding links', () => {
        // 325 mm bottom zone: τv ≈ 0.70 N/mm² needs p_t ≈ 1.4 % at the fixed base,
        // well above the steel needed for flexure
        const r = analyzeWall({ ...cfg, zones: [{ height: 3.0, thickness: 275 }, { height: 3.2, thickness: 275 }, { height: 3.5, thickness: 325 }] });
        const zd = r.zoneDesigns[2];
        const faceBars = zd.shearAt.face === 'h' ? zd.mainBars_hogging : zd.mainBars_sagging;
        const flexReq = zd.shearAt.face === 'h' ? zd.flex_hogging.Ast_req : zd.flex_sagging.Ast_req;
        expect(faceBars.Ast_provided).toBeGreaterThan(flexReq * 1.2);
        const pt = 100 * faceBars.Ast_provided / (1000 * zd.shearAt.d);
        expect(zd.shear.tau_v).toBeLessThanOrEqual(zd.shear_k * getTauC(pt, 25) + 1e-3);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Normal slab
// ═══════════════════════════════════════════════════════════════════════════

const slab = { Lx: 4, Ly: 5, D: 150, fck: 25, fy: 500, grade: 'M25', LL: 3, SDL: 1.5 };

describe('Two-way slab — IS 456 Table 26', () => {
    test('case 5 (two short edges discontinuous) at ly/lx = 1.4: αx+ = 0.044', () => {
        const r = analyzeSlab({ ...slab, Ly: 5.6, slabType: 'two-way', boundaryCase: 5 });
        expect(r.ax_pos).toBeCloseTo(0.044, 6);
    });

    test('short span runs between the LONG edges: cases 2 and 5 continuous, case 6 simply supported', () => {
        // Case 5 at ly/lx = 1: αx− = 0.045, αx+ = 0.035 → β = 2·0.045/0.035
        const c5 = analyzeSlab({ ...slab, Ly: 4, slabType: 'two-way', boundaryCase: 5 });
        expect(c5.supportCondition).toBe('continuous');
        expect(c5.deflection.beta).toBeCloseTo(2 * 0.045 / 0.035, 6);
        expect(c5.deflection.alpha).toBeCloseTo(0.104 * (1 - 2 * 0.045 / 0.035 / 10), 6);
        // Case 2 at ly/lx = 1: αx− = 0.037, αx+ = 0.028, both long edges continuous
        const c2 = analyzeSlab({ ...slab, Ly: 4, slabType: 'two-way', boundaryCase: 2 });
        expect(c2.supportCondition).toBe('continuous');
        expect(c2.deflection.beta).toBeCloseTo(2 * 0.037 / 0.028, 6);
        // Case 6: both long edges discontinuous — no αx−, basic l/d 20 (Cl. 23.2.1)
        const c6 = analyzeSlab({ ...slab, Ly: 4, slabType: 'two-way', boundaryCase: 6 });
        expect(c6.supportCondition).toBe('simply');
        expect(c6.ax_neg).toBeNull();
        expect(c6.ldCheck.basicRatio).toBe(20);
    });
});

describe('Slab flexure with the provided bars', () => {
    test('flexUtilization = max Mu / Mu,R over the four zones, bars at their actual depth', () => {
        const r = analyzeSlab({ ...slab, slabType: 'two-way', boundaryCase: 1 });
        const cap = (As: number, d: number) => {
            const Mu = 0.87 * 500 * As * d * (1 - As * 500 / (1000 * d * 25)) / 1e6;
            return Math.min(Mu, 0.133 * 25 * 1000 * d * d / 1e6);             // Annex G-1.1 b, ≤ Mu,lim
        };
        const c = 20;
        const dxb = 150 - c - r.bars_x_bot.dia / 2, dyb = 150 - c - r.bars_x_bot.dia - r.bars_y_bot.dia / 2;
        const dxt = 150 - c - r.bars_x_top.dia / 2, dyt = 150 - c - r.bars_x_top.dia - r.bars_y_top.dia / 2;
        const u = Math.max(
            r.Mx_pos / cap(r.bars_x_bot.Ast_provided, dxb), r.My_pos / cap(r.bars_y_bot.Ast_provided, dyb),
            r.Mx_neg / cap(r.bars_x_top.Ast_provided, dxt), r.My_neg / cap(r.bars_y_top.Ast_provided, dyt),
        );
        expect(r.flexUtilization).toBeCloseTo(u, 2);
        expect(r.flexUtilization).toBeLessThanOrEqual(1);
        expect(flexuralCapacity(r.bars_x_bot.Ast_provided, 1000, dxb, 25, 500)).toBeCloseTo(cap(r.bars_x_bot.Ast_provided, dxb), 6);
    });

    test('fixed main bars that cannot carry the moment make the design REVISE', () => {
        // One-way SS 4 m, D 150: Ast,req ≈ 490 mm²/m; 8 @ 250 gives 201 mm²/m
        const r = analyzeSlab({ ...slab, Ly: 10, slabType: 'one-way', supportCondition: 'simply', mainBarDia: 8, mainBarSpacing: 250 });
        expect(r.bars_x_bot.label).toBe('8mm @ 250 c/c');
        expect(r.bars_x_bot.adequate).toBe(false);
        expect(r.flexUtilization).toBeGreaterThan(1);
        expect(r.steelStatus).toBe('REVISE');
    });
});

describe('Slab optimizers', () => {
    const cost = { steelCost_per_kg: 90, concreteCost_per_m3: 6500, formworkCost_per_m2: 350, wastage_factor: 1.07 };

    test('extended optimizer designs with the swept bars — distinct designs, provided steel over the panel', () => {
        const r = optimizeSlabExtended({ ...slab, boundaryCase: 1, costParams: cost },
            { thicknesses: [120, 140], barDias: [8, 10], barSpacings: [150, 200, 250] });
        expect(r.feasibleCount).toBeGreaterThan(1);
        const keys = new Set<string>();
        for (const d of r.topDesigns) {
            expect(d.result.bars_x_bot.dia).toBe(d.barDia);
            expect(d.result.bars_x_bot.spacing).toBe(d.barSpacing);
            keys.add(`${d.thickness}/${d.barDia}/${d.barSpacing}`);
            const res = d.result;
            const barKg = (res.bars_x_bot.Ast_provided + res.bars_x_top.Ast_provided
                + res.bars_y_bot.Ast_provided + res.bars_y_top.Ast_provided) * 4 * 5 * 7850 / 1e6;
            expect(d.steelWeight_net).toBeGreaterThanOrEqual(barKg - 1e-9);   // + corner torsion steel
            // wastage applied once (inside computeCost)
            expect(d.costTotal_INR).toBeCloseTo(computeCost(d.concreteVol, d.steelWeight_net, 20, cost), 6);
            expect(d.steelWeight_gross).toBeCloseTo(d.steelWeight_net * 1.07, 6);
        }
        expect(keys.size).toBe(r.topDesigns.length);
    });

    test('legacy optimizer: flexure utilization is capacity-based, cost has a single wastage factor', () => {
        const r = optimizeSlab({ ...slab, boundaryCase: 1 }, [120, 130, 140]);
        const o = r.optimum!;
        expect(o.utilizationRatio.flexure).toBeCloseTo(o.result.flexUtilization, 6);
        expect(o.utilizationRatio.flexure).toBeLessThan(1);
        expect(o.costTotal_INR).toBeCloseTo(computeCost(o.concreteVol, o.steelWeight_net, 20, r.costParams), 6);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Cantilever and waffle optimizers
// ═══════════════════════════════════════════════════════════════════════════

describe('Cantilever slab optimizer', () => {
    const input = { L: 1.5, D: 180, cover: 20, fck: 25, fy: 500, w_live: 3, w_finish: 1.5, bar_main: 12, spacing_main: 150, bar_dist: 8, spacing_dist: 200 };
    const params = { minD: 150, maxD: 200, stepD: 25, barDias: [10, 12], spacings: [150, 200], bottomBarDias: [0, 8], bottomSpacings: [150, 200, 250] };

    test('"no bottom mat" is one option, not one per bottom spacing', () => {
        const r = optimizeCantileverSlab(input, params);
        expect(r.totalTrials).toBe(3 * 2 * 2 * (1 + 3));
        const keys = r.topDesigns.map(d => `${d.D}/${d.bar_main}/${d.spacing_main}/${d.bar_bot}/${d.spacing_bot}`);
        expect(new Set(keys).size).toBe(keys.length);
    });

    test('formwork per metre = soffit L_eff + free edge D (the top surface is not formed)', () => {
        const r = optimizeCantileverSlab(input, params);
        const o = r.optimum!;
        const formwork = o.result.L_eff + o.D / 1000;
        expect(o.costTotal_INR).toBeCloseTo(computeCost(o.concreteVol, o.steelWeight, formwork, r.costParams), 6);
    });
});

describe('Waffle slab optimizer', () => {
    test('cost uses the net steel with the wastage factor applied once', () => {
        const r = optimizeWaffleSlab(
            { Lx: 6, Ly: 6, spacing_x: 0.9, spacing_y: 0.9, bw: 150, D: 350, Df: 75, cover: 30, fck: 25, fy: 500, w_live: 3, w_finish: 1.5 },
            { minD: 300, maxD: 400, stepD: 50, minDf: 75, minBw: 150, minSpacing: 0.9, ribBarDias: [12, 16], ribNBars: [2, 3] },
        );
        const o = r.optimum!;
        expect(o).not.toBeNull();
        expect(o.costTotal_INR).toBeCloseTo(computeCost(o.concreteVol, o.steelWeight_net, 36, r.costParams), 6);
        expect(o.steelWeight_gross).toBeCloseTo(o.steelWeight_net * 1.07, 6);
        expect(o.costBreakdown.steel_INR).toBeCloseTo(o.steelWeight_net * 90 * 1.07, 6);
    });
});
