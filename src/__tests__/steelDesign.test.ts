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
    type BeamInput, type ColumnInput, type PortalFrameInput,
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
