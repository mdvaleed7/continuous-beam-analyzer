/**
 * Tapered steel member / portal frame design — hand-calculation checks of the
 * section properties, the FE engine against closed forms, the IS 800:2007 and
 * AISC 360-22 member checks, and the optimizer.
 */
import { sectionProps, depthAt, memberMass, type MemberSection } from '../lib/steelSection';
import { chiIS, classifyIS, shearIS, mcrIS, IS800 } from '../lib/steelIS800';
import { fcrE3, cbAISC, shearAISC, ltbStressAISC, classifyAISC, AISC } from '../lib/steelAISC360';
import {
    runDesign, optimizeSteel, strengthCombos,
    portalGeometry, craneReactions, type BeamInput, type ColumnInput, type PortalFrameInput, type MultiSpanFrameInput, type CraneInput,
} from '../components/steelFrameEngine';

const prism = (D: number, bf: number, tf: number, tw: number): MemberSection => ({ bf, tf, tw, profile: { at: [0, 1], D: [D, D] } });

describe('welded I-section properties', () => {
    const p = sectionProps({ D: 400, bf: 200, tf: 12, tw: 8 });
    it('area, inertia and moduli by hand', () => {
        // A = 2·200·12 + 376·8 = 4800 + 3008 = 7808 mm²
        expect(p.A).toBeCloseTo(7808, 6);
        // Iz = (200·400³ − 192·376³)/12
        expect(p.Iz).toBeCloseTo((200 * 400 ** 3 - 192 * 376 ** 3) / 12, 3);
        // Iy = 2·12·200³/12 + 376·8³/12 = 16.0e6 + 16 042.7
        expect(p.Iy).toBeCloseTo(16.016043e6, -1);
        // Zp = 2400·388 + 8·376²/4
        expect(p.Zpz).toBeCloseTo(2400 * 388 + 8 * 376 * 376 / 4, 3);
        expect(p.Zez).toBeCloseTo(2 * p.Iz / 400, 6);
    });
    it('linear taper and integrated mass', () => {
        const m: MemberSection = { bf: 200, tf: 12, tw: 8, profile: { at: [0, 1], D: [300, 600] } };
        expect(depthAt(m.profile, 0.5)).toBeCloseTo(450, 9);
        // Area is linear in D, so the mean area is the area at mid-length
        const Amid = sectionProps({ D: 450, bf: 200, tf: 12, tw: 8 }).A;
        expect(memberMass(m, 10)).toBeCloseTo(Amid * 1e-6 * 10 * 7850, 6);
    });
});

describe('IS 800:2007 member checks', () => {
    it('χ from Cl. 7.1.2.1 (curve c, λ = 1.751)', () => {
        const lambda = 1.751, a = 0.49;
        const phi = 0.5 * (1 + a * (lambda - 0.2) + lambda * lambda);
        expect(chiIS(lambda, a)).toBeCloseTo(1 / (phi + Math.sqrt(phi * phi - lambda * lambda)), 9);
        expect(chiIS(lambda, a)).toBeCloseTo(0.2455, 3);
        expect(chiIS(0.1, 0.34)).toBe(1);
    });
    it('Table 2 classification of a welded section', () => {
        const p = sectionProps({ D: 400, bf: 200, tf: 12, tw: 8 });
        const c = classifyIS(p, 250, 0);
        expect(c.bt).toBeCloseTo(100 / 12, 9);        // 8.33 ≤ 8.4 → plastic
        expect(c.flange).toBe('plastic');
        expect(c.dt).toBeCloseTo(47, 9);              // 376/8 ≤ 84 → plastic
        expect(c.web).toBe('plastic');
        const slender = classifyIS(sectionProps({ D: 1200, bf: 200, tf: 12, tw: 6 }), 250, 0);
        expect(slender.web).toBe('slender');          // 196 > 126
    });
    it('shear buckling Cl. 8.4.2.2(a), kv = 5.35', () => {
        const p = sectionProps({ D: 1012, bf: 200, tf: 6, tw: 5 });   // d/tw = 200
        const r = shearIS(p, 250);
        const tauCr = 5.35 * Math.PI ** 2 * 2e5 / (12 * 0.91 * 200 * 200);
        const lw = Math.sqrt(250 / (Math.sqrt(3) * tauCr));
        expect(r.lambdaW).toBeCloseTo(lw, 9);
        expect(r.Vd).toBeCloseTo(1012 * 5 * (250 / (Math.sqrt(3) * lw * lw)) / 1.1, 3);
        // stocky web: plastic shear
        const q = sectionProps({ D: 400, bf: 200, tf: 12, tw: 8 });
        expect(shearIS(q, 250).Vd).toBeCloseTo(400 * 8 * 250 / Math.sqrt(3) / 1.1, 6);
    });
    it('Mcr Cl. 8.2.2.1', () => {
        const p = sectionProps({ D: 400, bf: 200, tf: 12, tw: 8 });
        const L = 5000;
        const a = Math.PI ** 2 * IS800.E * p.Iy / (L * L);
        expect(mcrIS(p, L)).toBeCloseTo(Math.sqrt(a * (IS800.G * p.J + Math.PI ** 2 * IS800.E * p.Iw / (L * L))), 3);
    });
});

describe('AISC 360-22 member checks', () => {
    it('E3 critical stress', () => {
        expect(fcrE3(345, 345)).toBeCloseTo(0.658 * 345, 9);
        expect(fcrE3(345, 100)).toBeCloseTo(87.7, 9);            // Fy/Fe = 3.45 > 2.25
    });
    it('Cb Eq. F1-1', () => {
        expect(cbAISC(1, 1, 1, 1)).toBeCloseTo(1, 12);
        // uniformly loaded simple span: Mmax 1, quarter points 0.75
        expect(cbAISC(1, 0.75, 1, 0.75)).toBeCloseTo(12.5 / (2.5 + 2.25 + 4 + 2.25), 12);
    });
    it('G2.1 shear', () => {
        const p = sectionProps({ D: 400, bf: 200, tf: 12, tw: 8 });  // h/tw = 47 ≤ 1.10√(kvE/Fy)
        expect(shearAISC(p, 345).Vn).toBeCloseTo(0.6 * 345 * 400 * 8, 6);
    });
    it('F2 LTB: Lp and plastic plateau', () => {
        const p = sectionProps({ D: 400, bf: 200, tf: 12, tw: 8 });
        expect(classifyAISC(p, 250).web).toBe('compact');
        const Lp = 1.76 * p.ry * Math.sqrt(AISC.E / 250);
        const r = ltbStressAISC(p, 250, Lp * 0.9, 1);
        expect(r.Lp).toBeCloseTo(Lp, 6);
        expect(r.Fn * p.Zez).toBeCloseTo(Math.min(250 * p.Zpz, 1.6 * 250 * p.Zez), 3);
    });
});

describe('FE engine vs closed forms', () => {
    const beam = (supports: BeamInput['supports']): BeamInput => ({
        code: 'IS800', fy: 250, span: 8, supports, member: prism(400, 200, 12, 8),
        w: { D: 0, L: 10, W: 0 }, P: { D: 0, L: 0, a: 0 }, Ly: 1, verticalLimit: 240, nSub: 16,
    });
    it('simply supported: M = wL²/8, δ = 5wL⁴/384EI', () => {
        const r = runDesign({ mode: 'beam', input: beam('pinned-pinned') });
        const sls = r.combos.find(c => c.name === 'SLS: L')!;
        const Mmax = Math.max(...sls.members.flatMap(m => m.M.map(Math.abs)));
        expect(Mmax).toBeCloseTo(10 * 64 / 8, 2);
        const EI = 2e5 * sectionProps({ D: 400, bf: 200, tf: 12, tw: 8 }).Iz;   // N·mm²
        const d = 5 * 10 * 8000 ** 4 / (384 * EI);
        expect(r.deflections[0].value).toBeCloseTo(d, 1);
    });
    it('fixed-fixed: support moment wL²/12', () => {
        const r = runDesign({ mode: 'beam', input: beam('fixed-fixed') });
        const sls = r.combos.find(c => c.name === 'SLS: L')!;
        const Mmax = Math.max(...sls.members.flatMap(m => m.M.map(Math.abs)));
        expect(Mmax).toBeCloseTo(10 * 64 / 12, 2);
    });
    it('cantilever column: γe ≈ π²EI / 4L²P', () => {
        const col: ColumnInput = {
            code: 'AISC360', fy: 345, height: 6, base: 'fixed', top: 'free', member: prism(300, 200, 12, 8),
            P: { D: 100, L: 0, W: 0 }, Mtop: { D: 0, L: 0, W: 0 }, wWind: 0, Ly: 6, lateralLimit: 150, windServiceFactor: 0.7, nSub: 16,
        };
        const r = runDesign({ mode: 'column', input: col });
        const c = r.combos.find(x => x.kind === 'strength')!;
        const p = sectionProps({ D: 300, bf: 200, tf: 12, tw: 8 });
        // γe is reported on the nominal stiffness; self-weight lowers it slightly
        const Pcr = Math.PI ** 2 * 2e5 * p.Iz / (4 * 6000 ** 2) / 1000;   // kN
        const Pu = 1.4 * 100;
        expect(c.name).toBe('1.4D');
        expect(c.gammaE).toBeGreaterThan(0.97 * Pcr / Pu);
        expect(c.gammaE).toBeLessThan(1.001 * Pcr / Pu);
    });
});

describe('portal frame', () => {
    const frame = (code: PortalFrameInput['code']): PortalFrameInput => ({
        code, fy: 345, span: 20, eaveHeight: 7, roofSlope: 6, baySpacing: 6, base: 'pinned',
        column: { bf: 200, tf: 12, tw: 6, profile: { at: [0, 1], D: [300, 650] } },
        rafter: { bf: 200, tf: 12, tw: 6, profile: { at: [0, 0.3, 1], D: [650, 400, 400] } },
        dead: 0.25, live: code === 'IS800' ? 0.75 : 0.96, windPressure: 0.9,
        cpe: { windwardWall: 0.7, leewardWall: -0.25, windwardRoof: -0.9, leewardRoof: -0.4 }, cpi: [0.2, -0.2],
        columnLy: 2.5, rafterLy: 3, verticalLimit: 180, lateralLimit: 150, windServiceFactor: 0.7, nSub: 8,
    });
    it('vertical reactions balance the applied gravity load', () => {
        const r = runDesign({ mode: 'frame', input: frame('IS800') });
        const sls = r.combos.find(c => c.name === 'SLS: L')!;
        const Ry = sls.reactions.reduce((a, x) => a + x.Ry, 0);
        // live on plan: 0.75 kN/m² × 6 m × 20 m
        expect(Ry).toBeCloseTo(0.75 * 6 * 20, 1);
        const Rx = sls.reactions.reduce((a, x) => a + x.Rx, 0);
        expect(Math.abs(Rx)).toBeLessThan(1e-6);
    });
    it('both codes produce complete, finite results', () => {
        for (const code of ['IS800', 'AISC360'] as const) {
            const r = runDesign({ mode: 'frame', input: frame(code) });
            expect(Number.isFinite(r.maxUtil)).toBe(true);
            expect(r.members.length).toBe(4);
            expect(r.combos.filter(c => c.kind === 'strength').length).toBe(strengthCombos(code, ['W1', 'W2'], true).length);
            expect(r.mass).toBeGreaterThan(0);
        }
    });
});

describe('portal frame — unsymmetric frames and wind from the right', () => {
    const base = (over: Partial<PortalFrameInput> = {}): PortalFrameInput => ({
        code: 'IS800', fy: 345, span: 20, eaveHeight: 7, roofSlope: 6, baySpacing: 6, base: 'pinned',
        column: { bf: 200, tf: 12, tw: 6, profile: { at: [0, 1], D: [300, 650] } },
        rafter: { bf: 200, tf: 12, tw: 6, profile: { at: [0, 0.3, 1], D: [650, 400, 400] } },
        dead: 0.25, live: 0.75, windPressure: 0.9,
        cpe: { windwardWall: 0.7, leewardWall: -0.25, windwardRoof: -0.9, leewardRoof: -0.4 }, cpi: [0.2, -0.2],
        columnLy: 2.5, rafterLy: 3, verticalLimit: 180, lateralLimit: 150, windServiceFactor: 1, nSub: 8, ...over,
    });
    const sls = (r: ReturnType<typeof runDesign>, name: string) => r.combos.find(c => c.name === name)!;
    const sumRx = (c: ReturnType<typeof sls>) => c.reactions.reduce((a, x) => a + x.Rx, 0);
    const sumRy = (c: ReturnType<typeof sls>) => c.reactions.reduce((a, x) => a + x.Ry, 0);

    it('apex position from unequal slopes and eave heights', () => {
        const g = portalGeometry({ span: 20, eaveHeight: 7, roofSlope: 10, eaveHeightR: 8, roofSlopeR: 5 });
        const t = (d: number) => Math.tan(d * Math.PI / 180);
        const x = (8 - 7 + 20 * t(5)) / (t(10) + t(5));
        expect(g.xA).toBeCloseTo(x, 9);
        expect(g.yA).toBeCloseTo(7 + x * t(10), 9);
        expect(g.yA).toBeCloseTo(8 + (20 - x) * t(5), 9);
        expect(() => portalGeometry({ span: 20, eaveHeight: 7, roofSlope: 2, eaveHeightR: 12, roofSlopeR: 2 })).toThrow();
    });

    it('symmetric frame: auto runs wind from the left only; "both" gives the mirror image', () => {
        const auto = runDesign({ mode: 'frame', input: base() });
        expect(auto.combos.some(c => c.name.includes('WR'))).toBe(false);
        const r = runDesign({ mode: 'frame', input: base({ windDirections: 'both' }) });
        const L = sls(r, 'SLS: 1WL1'), R = sls(r, 'SLS: 1WR1');
        const byNode = (c: typeof L, n: number) => c.reactions.find(x => x.node === n)!;
        // left support under wind from the right = mirror of the right support under wind from the left
        expect(byNode(R, 0).Rx).toBeCloseTo(-byNode(L, 4).Rx, 6);
        expect(byNode(R, 0).Ry).toBeCloseTo(byNode(L, 4).Ry, 6);
        expect(byNode(R, 4).Rx).toBeCloseTo(-byNode(L, 0).Rx, 6);
        // the mirror case adds nothing to the design of a symmetric frame
        // (members are designed as groups: Column L+R, Rafter L+R)
        for (const g of auto.groups) {
            expect(r.groups.find(x => x.group === g.group)!.maxUtil).toBeCloseTo(g.maxUtil, 6);
        }
    });

    it('unsymmetric frame: wind from the right is added automatically and satisfies equilibrium', () => {
        const inp = base({ roofSlope: 10, roofSlopeR: 5, eaveHeightR: 8 });
        const g = portalGeometry(inp);
        const r = runDesign({ mode: 'frame', input: inp });
        expect(r.combos.some(c => c.name === '1.5(D+WR2)')).toBe(true);
        expect(r.deflections.map(d => d.name)).toEqual(expect.arrayContaining(['Left eave drift (H/150)', 'Right eave drift (H/150)']));
        // Horizontal resultant of wind from the right (cpi = +0.2), by surface:
        // right wall pushed −x, left wall sucked −x, roof suction on the projected rises
        const p = 0.9 * 6, cpi = 0.2, c = inp.cpe;
        const riseL = g.yA - g.HL, riseR = g.yA - g.HR;
        const Fx = -p * (c.windwardWall - cpi) * g.HR + p * (c.leewardWall - cpi) * g.HL
            - p * (c.windwardRoof - cpi) * riseR + p * (c.leewardRoof - cpi) * riseL;
        expect(sumRx(sls(r, 'SLS: 1WR1'))).toBeCloseTo(-Fx, 4);
        expect(Fx).toBeLessThan(0);                        // net push toward −x
    });

    it('notional loads follow the first-order sway of an unsymmetric frame', () => {
        const ratio = (inp: PortalFrameInput) => {
            const c = runDesign({ mode: 'frame', input: inp }).combos.find(x => x.name === '1.5(D+L)')!;
            expect(c.notional).toBe(true);
            return sumRx(c) / sumRy(c);
        };
        // symmetric: +x notional (reaction −0.005·ΣV)
        expect(ratio(base())).toBeCloseTo(-0.005, 6);
        // mirrored unsymmetric frames sway in opposite directions → opposite notional loads
        const a = ratio(base({ roofSlope: 12, roofSlopeR: 4 }));
        const b = ratio(base({ roofSlope: 4, roofSlopeR: 12 }));
        expect(Math.abs(a)).toBeCloseTo(0.005, 6);
        expect(b).toBeCloseTo(-a, 6);
    });
});

describe('crane loads', () => {
    const crane: CraneInput = {
        span: 0, capacity: 100, crabWeight: 30, bridgeWeight: 120, hookApproach: 1.0, wheelBase: 3.5, eccentricity: 0.5,
        bracketLevel: 5.5, railLevel: 6.1, impact: 0.25, surge: 0.10, girderWeight: 1.5, lateralLimit: 400, spreadLimit: 10,
    };
    it('wheel loads and column reactions by hand', () => {
        const r = craneReactions(crane, 20, 7.5);
        // crane span 20 − 2·0.5 = 19 m; crab + load 130 kN at 1.0 m from the near rail
        expect(r.craneSpan).toBeCloseTo(19, 12);
        expect(r.Pmax).toBeCloseTo((120 / 2 + 130 * 18 / 19) / 2, 9);     // 91.58 kN per wheel
        expect(r.Pmin).toBeCloseTo((120 / 2 + 130 * 1 / 19) / 2, 9);
        // two wheels 3.5 m apart on 7.5 m simply supported girders, one wheel over the frame
        expect(r.k).toBeCloseTo(1 + 4 / 7.5, 12);
        expect(r.Rmax).toBeCloseTo(r.Pmax * r.k, 9);
        expect(r.H).toBeCloseTo(0.10 * 130 / 4 * r.k, 9);                  // per wheel × k
        expect(r.Rg).toBeCloseTo(1.5 * 7.5, 12);
    });

    const portal = (over: Partial<PortalFrameInput> = {}): PortalFrameInput => ({
        code: 'IS800', fy: 345, span: 20, eaveHeight: 8, roofSlope: 6, baySpacing: 7.5, base: 'pinned',
        column: { bf: 250, tf: 12, tw: 8, profile: { at: [0, 1], D: [400, 750] } },
        rafter: { bf: 200, tf: 12, tw: 6, profile: { at: [0, 0.3, 1], D: [700, 450, 450] } },
        dead: 0.15, live: 0.75, windPressure: 1.0,
        cpe: { windwardWall: 0.7, leewardWall: -0.25, windwardRoof: -0.9, leewardRoof: -0.4 }, cpi: [0.2, -0.2],
        columnLy: 1.5, rafterLy: 1.5, verticalLimit: 180, lateralLimit: 150, windServiceFactor: 1, nSub: 8, crane, ...over,
    });

    it('crane load cases: equilibrium, bracket moment and axial jump', () => {
        const r = runDesign({ mode: 'frame', input: portal() });
        const rx = craneReactions(crane, 20, 7.5);
        const c = r.combos.find(x => x.name === 'SLS: CV1+CH')!;       // static crane loads, surge +x
        expect(c.reactions.reduce((a, x) => a + x.Ry, 0)).toBeCloseTo(rx.Rmax + rx.Rmin, 6);
        expect(c.reactions.reduce((a, x) => a + x.Rx, 0)).toBeCloseTo(-2 * rx.H, 6);
        // left column: axial and moment step by Rmax and Rmax·e across the bracket
        const col = c.members.find(m => m.name === 'Column L')!;
        const sb = 5.5 / 8;
        const idx = col.s.map((v, k) => [v, k]).filter(([v]) => Math.abs(v - sb) < 1e-9).map(([, k]) => k);
        expect(idx.length).toBe(2);
        expect(Math.abs(col.N[idx[0]] - col.N[idx[1]])).toBeCloseTo(rx.Rmax, 6);
        expect(Math.abs(col.M[idx[0]] - col.M[idx[1]])).toBeCloseTo(rx.Rmax * 0.5, 6);
        expect(r.deflections.map(d => d.name)).toEqual(expect.arrayContaining(['Crane rail lateral (H/400)', 'Crane rail spread']));
    });

    it('IS 800 crane combinations: leading and accompanying imposed loads', () => {
        const r = runDesign({ mode: 'frame', input: portal() });
        const names = r.combos.map(c => c.name);
        expect(names).toEqual(expect.arrayContaining([
            '1.5D+1.5(CV1+CH)+1.05L', '1.5D+1.5L+1.05(CV2−CH)',
            '1.2D+1.2(CV1+CH)+1.05L+0.6W1', '1.2D+1.2(CV2+CH)+0.53L+1.2W2', '1.2D+1.2L+0.53(CV1+CH)+1.2W1',
        ]));
        // crane in the only span of a symmetric frame → wind from the left suffices (surge ± covered)
        expect(names.some(n => n.includes('WR'))).toBe(false);
        const ra = runDesign({ mode: 'frame', input: portal({ code: 'AISC360' }) });
        expect(ra.combos.map(c => c.name)).toEqual(expect.arrayContaining([
            '1.2D+1.6(CV1+CH)+0.5Lr', '1.2D+1.6Lr+1.0(CV2−CH)', '1.2D+1.0W1+1.0(CV1+CH)+0.5Lr',
        ]));
    });
});

describe('multi-span (multi-gable) frame', () => {
    const ms = (over: Partial<MultiSpanFrameInput> = {}): MultiSpanFrameInput => ({
        code: 'IS800', fy: 345, spans: [{ span: 18, slopeL: 6, slopeR: 6 }, { span: 18, slopeL: 6, slopeR: 6 }], heights: [8, 8, 8],
        baySpacing: 7.5, base: 'pinned',
        column: { bf: 200, tf: 10, tw: 6, profile: { at: [0, 1], D: [350, 650] } },
        interiorColumn: { bf: 200, tf: 10, tw: 6, profile: { at: [0, 1], D: [350, 350] } },
        rafter: { bf: 200, tf: 10, tw: 6, profile: { at: [0, 0.3, 1], D: [650, 400, 400] } },
        dead: 0.15, live: 0.75, windPressure: 1.0, wallCpe: { windward: 0.7, leeward: -0.25 }, roofCpe: [-0.9, -0.4],
        cpi: [0.2, -0.2], columnLy: 1.5, rafterLy: 1.5, verticalLimit: 180, lateralLimit: 150, windServiceFactor: 1, nSub: 6, ...over,
    });
    const sum = (c: { reactions: { Rx: number; Ry: number }[] }, k: 'Rx' | 'Ry') => c.reactions.reduce((a, x) => a + x[k], 0);

    it('members, groups and gravity equilibrium', () => {
        const r = runDesign({ mode: 'multispan', input: ms() });
        expect(r.members.map(m => m.name)).toEqual(['Column 1', 'Rafter 1L', 'Rafter 1R', 'Column 2', 'Rafter 2L', 'Rafter 2R', 'Column 3']);
        expect(r.groups.map(g => g.group).sort()).toEqual(['Column', 'Interior column', 'Rafter']);
        const L = r.combos.find(c => c.name === 'SLS: L')!;
        expect(sum(L, 'Ry')).toBeCloseTo(0.75 * 7.5 * 36, 6);
        expect(L.reactions.length).toBe(3);
        expect(r.combos.some(c => c.name.includes('WR'))).toBe(false);     // symmetric → left only
    });

    it('wind: horizontal equilibrium over walls and all roof slopes', () => {
        const inp = ms({ roofCpe: [-0.9, -0.5, -0.4, -0.3] });
        const r = runDesign({ mode: 'multispan', input: inp });
        const c = r.combos.find(x => x.name === 'SLS: 1W1')!;
        const p = 1.0 * 7.5, cpi = 0.2, rise = 9 * Math.tan(6 * Math.PI / 180);
        // walls: windward pushes +x, leeward suction pulls +x; roof slopes alternate facing −x / +x
        const cp = [-0.9, -0.5, -0.4, -0.3];
        let Fx = p * (0.7 - cpi) * 8 - p * (-0.25 - cpi) * 8;
        cp.forEach((v, j) => { Fx += (j % 2 === 0 ? 1 : -1) * p * (v - cpi) * rise; });
        expect(sum(c, 'Rx')).toBeCloseTo(-Fx, 5);
        // both directions read the list from the windward end: same list = mirror image → left only
        expect(r.combos.some(x => x.name.startsWith('SLS: 1WR'))).toBe(false);
        // different coefficients for wind from the right → both directions
        const r2 = runDesign({ mode: 'multispan', input: { ...inp, roofCpeRight: [-0.8, -0.5] } });
        expect(r2.combos.some(x => x.name === 'SLS: 1WR1')).toBe(true);
    });

    it('crane in an end span makes the frame unsymmetric; heights set per column', () => {
        const crane: CraneInput = {
            span: 1, capacity: 50, crabWeight: 15, bridgeWeight: 60, hookApproach: 0.8, wheelBase: 3, eccentricity: 0.45,
            bracketLevel: 5, railLevel: 5.5, impact: 0.25, surge: 0.1, girderWeight: 1, lateralLimit: 400, spreadLimit: 10,
        };
        const r = runDesign({ mode: 'multispan', input: ms({ crane }) });
        expect(r.combos.some(c => c.name.includes('WR1'))).toBe(true);
        const s = r.combos.find(c => c.name === 'SLS: CV2−CH')!;
        const rx = craneReactions(crane, 18, 7.5);
        expect(sum(s, 'Ry')).toBeCloseTo(rx.Rmax + rx.Rmin, 6);
        expect(sum(s, 'Rx')).toBeCloseTo(2 * rx.H, 6);
        expect(() => runDesign({ mode: 'multispan', input: ms({ heights: [8, 8] }) })).toThrow();
    });

    it('optimizer sizes the three groups', () => {
        const r = optimizeSteel({ mode: 'multispan', input: ms() }, {
            depthMin: 300, depthMax: 800, depthStep: 100, bfList: [150, 200], tfList: [8, 10, 12], twList: [5, 6],
        });
        expect(r.result?.ok).toBe(true);
        const b = r.best!;
        expect(b.mode).toBe('multispan');
        if (b.mode === 'multispan') {
            for (const sec of [b.input.column, b.input.interiorColumn, b.input.rafter]) expect(sec.tf).toBeGreaterThanOrEqual(sec.tw);
            expect(b.input.rafter.profile.D[0]).toBeGreaterThanOrEqual(b.input.rafter.profile.D[1]);
        }
    }, 120000);
});

describe('optimizer', () => {
    it('finds a feasible beam no heavier than the start design', () => {
        const input: BeamInput = {
            code: 'IS800', fy: 250, span: 8, supports: 'pinned-pinned', member: prism(600, 250, 16, 10),
            w: { D: 5, L: 10, W: 0 }, P: { D: 0, L: 0, a: 0 }, Ly: 2, verticalLimit: 300, nSub: 8,
        };
        const start = runDesign({ mode: 'beam', input });
        const r = optimizeSteel({ mode: 'beam', input }, {
            depthMin: 300, depthMax: 700, depthStep: 50, bfList: [150, 200, 250], tfList: [8, 10, 12, 16], twList: [6, 8, 10],
        });
        expect(r.result).not.toBeNull();
        expect(r.result!.ok).toBe(true);
        expect(r.result!.maxUtil).toBeLessThanOrEqual(1);
        expect(r.result!.mass).toBeLessThanOrEqual(start.mass + 1e-6);
        const m = r.best!.mode === 'beam' ? r.best!.input.member : null;
        expect(m!.tf).toBeGreaterThanOrEqual(m!.tw);           // practical rule tf ≥ tw
    });
});
