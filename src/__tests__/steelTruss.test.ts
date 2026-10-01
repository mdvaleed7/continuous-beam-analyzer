/**
 * Roof-truss members (CHS / SHS / double angles), the portal-truss model and
 * transverse web stiffeners — hand checks against IS 800:2007 and AISC 360-22.
 */
import { chsSection, shsSections, doubleAngle, trussCatalogue, checkTrussIS, checkTrussAISC } from '../lib/steelTruss';
import { ANGLES_IS808 } from '../lib/data/anglesIS808';
import { kvIS, webLimitIS, stiffenerIS } from '../lib/steelIS800';
import { webLimitAISC, stiffenerAISC } from '../lib/steelAISC360';
import { runDesign, optimizeSteel, buildModel, type PortalFrameInput, type BeamInput, type TrussRoof } from '../components/steelFrameEngine';

const angle = (name: string) => ANGLES_IS808.find(a => a.name === name)!;

describe('truss sections', () => {
    it('CHS 114.3 × 4.5 matches the published properties (A 15.5 cm², I 234 cm⁴, Wpl 54.7 cm³)', () => {
        const s = chsSection(114.3, 4.5);
        expect(s.A / 100).toBeCloseTo(15.52, 1);
        expect(s.Iz / 1e4).toBeCloseTo(234.3, 0);
        expect(s.Zpz / 1e3).toBeCloseTo(54.3, 0);         // (D³ − d³)/6
        expect(s.w).toBeCloseTo(12.19, 1);
    });
    it('double angle on an 8 mm gusset: Iy = 2[Iyy + A(c + tg/2)²]', () => {
        const a = angle('ISEA 75X75X6');
        const s = doubleAngle(a, 8);
        expect(s.A).toBeCloseTo(1750, 6);
        expect(s.Iz).toBeCloseTo(2 * 471000, 6);
        expect(s.Iy).toBeCloseTo(2 * (471000 + 875 * (20.8 + 4) ** 2), 3);
    });
    it('catalogue chains are lightest first and never step down in area or Zp', () => {
        for (const fam of ['CHS', 'SHS', '2L'] as const) {
            const c = trussCatalogue(fam, 345, 'IS800');
            expect(c.length).toBeGreaterThan(10);
            for (let i = 1; i < c.length; i++) {
                expect(c[i].w).toBeGreaterThan(c[i - 1].w);
                expect(c[i].A).toBeGreaterThan(c[i - 1].A);
                expect(c[i].Zpz).toBeGreaterThanOrEqual(c[i - 1].Zpz);
            }
        }
        // IS 800 Table 2: double angles in compression need (b + d)/t ≤ 25ε
        const eps = Math.sqrt(250 / 345);
        expect(trussCatalogue('2L', 345, 'IS800').every(s => 2 * s.b! / s.t <= 25 * eps + 1e-9)).toBe(true);
    });
});

describe('IS 800 truss member checks', () => {
    const shs = shsSections().find(s => s.name === 'SHS 100x100x4')!;
    it('SHS 100×100×4, 3 m, 200 kN compression: Cl. 7.1.2.1 curve b by hand', () => {
        // r = √(2 263 500 / 1495) = 38.91; KL/r = 77.10; fcc = π²E/(KL/r)² = 332.1 MPa
        // λ = √(250/332.1) = 0.8677; φ = 0.5[1 + 0.34(λ − 0.2) + λ²] = 0.9900; χ = 0.6819
        // Pd = χ·A·fy/γm0 = 0.6819 × 1495 × 250/1.10 = 231.7 kN
        const r = checkTrussIS(shs, 250, 410, { N: -200e3, M: 0, V: 0, Lz: 3000, Ly: 3000 });
        expect(r.Pc / 1e3).toBeCloseTo(231.7, 0);
        expect(r.util.bucklingZ).toBeCloseTo(200 / 231.7, 2);
        expect(r.KLr).toBeCloseTo(77.1, 1);
        expect(r.util.class).toBeCloseTo((100 - 8) / 4 / 42, 6);      // Table 2 flat b/t ≤ 42ε
    });
    it('2-ISEA 75×75×6 tension: Cl. 6.3.3 with β = 0.7 per angle', () => {
        // leg (75 − 3)·6 = 432 mm²: 2(0.9·432·410/1.25 + 0.7·432·250/1.10) = 392.5 kN < Ag·fy/γm0 = 397.7 kN
        const s = doubleAngle(angle('ISEA 75X75X6'), 8);
        const r = checkTrussIS(s, 250, 410, { N: 250e3, M: 0, V: 0, Lz: 2000, Ly: 2000 });
        expect(r.Tc / 1e3).toBeCloseTo(392.5, 1);
        expect(r.util.tension).toBeCloseTo(250 / 392.5, 3);
    });
});

describe('AISC 360 truss member checks', () => {
    it('CHS 114.3 × 4.5, 4 m, E3: φPn by hand', () => {
        // r = 38.85 mm; L/r = 102.96; Fe = π²E/(L/r)² = 186.2 MPa; Fy/Fe = 1.702 ≤ 2.25
        // Fcr = 0.658^1.702 × 317 = 155.5 MPa; φPn = 0.9 × 155.5 × 1552 = 217.2 kN
        const s = chsSection(114.3, 4.5);
        const r = checkTrussAISC(s, 317, 427, { N: -150e3, M: 0, V: 0, Lz: 4000, Ly: 4000 });
        expect(r.Pc / 1e3).toBeCloseTo(217.2, 0);
    });
    it('double angles: E4 flexural-torsional buckling lowers the out-of-plane strength', () => {
        const s = doubleAngle(angle('ISEA 50X50X5'), 8);
        const r = checkTrussAISC(s, 250, 400, { N: -50e3, M: 0, V: 0, Lz: 1500, Ly: 1500 });
        const ry = Math.sqrt(s.Iy / s.A);
        const Fe = Math.PI ** 2 * 200000 / (1500 / ry) ** 2;
        const flexOnly = 0.9 * (250 / Fe <= 2.25 ? 0.658 ** (250 / Fe) * 250 : 0.877 * Fe) * s.A;
        expect(r.util.bucklingY).toBeGreaterThan(50e3 / flexOnly);
    });
});

describe('transverse web stiffeners', () => {
    it('IS 800 Cl. 8.4.2.2(a) kv and Cl. 8.6.1 web limits', () => {
        expect(kvIS(undefined, 800)).toBe(5.35);
        expect(kvIS(800, 800)).toBeCloseTo(9.35, 12);             // c/d = 1: 5.35 + 4
        expect(kvIS(400, 800)).toBeCloseTo(4 + 5.35 * 4, 12);     // c/d = 0.5
        expect(webLimitIS(800, undefined, 250)).toBe(200);        // min(200ε, 345ε²)
        expect(webLimitIS(800, 1000, 250)).toBe(200);             // d ≤ c ≤ 3d
        expect(webLimitIS(800, 400, 250)).toBe(270);              // c < 0.74d
    });
    it('IS 800 Cl. 8.7.2.4 stiffener stiffness and AISC G2.3', () => {
        const p = stiffenerIS(876, 4, 200, 250, 500)!;
        expect(p.Is).toBeGreaterThanOrEqual(p.IsMin);
        expect(p.IsMin).toBeCloseTo(1.5 * 876 ** 3 * 4 ** 3 / 500 ** 2, 3);   // c/d < √2
        expect(p.bs).toBeLessThanOrEqual(20 * p.ts);
        const q = stiffenerAISC(876, 4, 200, 345, 500)!;
        expect(q.bs / q.ts).toBeLessThanOrEqual(0.56 * Math.sqrt(200000 / 345) + 1e-9);
        expect(webLimitAISC(876, 345, 500)).toBeCloseTo(12 * Math.sqrt(200000 / 345), 9);   // a/h ≤ 1.5
    });
    it('a slender web fails unstiffened and passes with stiffeners chosen by the engine', () => {
        const beam: BeamInput = {
            code: 'IS800', fy: 250, span: 6, supports: 'pinned-pinned',
            member: { bf: 200, tf: 12, tw: 4, profile: { at: [0, 1], D: [900, 900] } },
            w: { D: 20, L: 20, W: 0 }, P: { D: 0, L: 0, a: 0 }, Ly: 1.0, verticalLimit: 300, nSub: 12,
        };
        const plain = runDesign({ mode: 'beam', input: beam });
        expect(plain.ok).toBe(false);                             // d/tw = 219 > 200ε
        const stiff = runDesign({ mode: 'beam', input: { ...beam, stiffeners: { enabled: true, penaltyKg: 0 } } });
        expect(stiff.ok).toBe(true);
        expect(stiff.stiffeners.n).toBeGreaterThan(0);
        expect(stiff.members[0].stiffeners.every(s => s.spacing <= 0.74 * 876)).toBe(true);
        expect(stiff.mass).toBeCloseTo(plain.mass + stiff.stiffeners.mass, 6);
    });
});

describe('portal truss (roof truss on I-section columns)', () => {
    const truss = (over: Partial<TrussRoof> = {}): TrussRoof => ({
        family: 'SHS', depthEave: 1.5, bottomSlope: 0.5, panel: 1.5, K: 1, bottomLy: 3, gusset: 8,
        top: 'SHS 100x100x4', bottom: 'SHS 100x100x4', vertical: 'SHS 60x60x3', diagonal: 'SHS 70x70x3', ...over,
    });
    const portal = (over: Partial<PortalFrameInput> = {}): PortalFrameInput => ({
        code: 'IS800', fy: 345, span: 24, eaveHeight: 8, roofSlope: 5.71, baySpacing: 7.5, base: 'pinned',
        column: { bf: 220, tf: 12, tw: 6, profile: { at: [0, 1], D: [400, 600] } },
        rafter: { bf: 200, tf: 12, tw: 6, profile: { at: [0, 1], D: [500, 500] } },
        dead: 0.15, live: 0.75, windPressure: 0.81,
        cpe: { windwardWall: 0.7, leewardWall: -0.3, windwardRoof: -0.9, leewardRoof: -0.5 }, cpi: [0.2, -0.2],
        columnLy: 1.5, rafterLy: 1.5, verticalLimit: 180, lateralLimit: 150, windServiceFactor: 1, truss: truss(), ...over,
    });

    it('geometry: 8 panels a side, Pratt webs, bottom chord framing into the columns', () => {
        const m = buildModel({ mode: 'frame', input: portal() });
        const count = (g: string) => m.members.filter(x => x.group === g).length;
        expect(count('Top chord')).toBe(2);
        expect(count('Bottom chord')).toBe(2);
        expect(count('Vertical')).toBe(2 * 7 + 1);
        expect(count('Diagonal')).toBe(2 * 8);
        // bottom chord meets the column 1.5 m below the eave
        const bc = m.members.find(x => x.name === 'Bottom chord L')!;
        expect(m.nodes[bc.i]).toEqual({ x: 0, y: 6.5 });
    });

    it('live load: vertical equilibrium, pin-ended webs carry no end moment, Pratt action', () => {
        const r = runDesign({ mode: 'frame', input: portal() });
        const c = r.combos.find(x => x.name === 'SLS: L')!;
        expect(c.reactions.reduce((a, q) => a + q.Ry, 0)).toBeCloseTo(0.75 * 7.5 * 24, 6);
        expect(c.reactions.reduce((a, q) => a + q.Rx, 0)).toBeCloseTo(0, 6);
        const webs = c.members.filter(x => /^(Vertical|Diagonal)/.test(x.name));
        for (const w of webs) for (const v of w.M) expect(Math.abs(v)).toBeLessThan(1e-9);
        // Pratt: diagonals in tension, verticals in compression; bottom chord in tension at mid-span
        expect(c.members.filter(x => /^Diagonal L[1-6]$/.test(x.name)).every(x => x.N[0] > 0)).toBe(true);
        expect(c.members.filter(x => /^Vertical L[1-6]$/.test(x.name)).every(x => x.N[0] < 0)).toBe(true);
        const bc = c.members.find(x => x.name === 'Bottom chord L')!;
        expect(bc.N[bc.N.length - 1]).toBeGreaterThan(0);
        // truss members carry their own results
        const d1 = r.members.find(x => x.name === 'Diagonal L1')!;
        expect(d1.truss?.section.name).toBe('SHS 70x70x3');
        expect(d1.stiffeners.length).toBe(0);
    });

    it('slenderness limit follows the sign of the axial force (IS 800 Table 3)', () => {
        const r = runDesign({ mode: 'frame', input: portal() });
        const v = r.members.find(x => x.name === 'Vertical L1')!;
        expect(v.truss!.slenderLimit).toBe(180);                  // compression under dead + imposed
        expect(r.members.filter(x => x.truss).every(x => [180, 250, 400].includes(x.truss!.slenderLimit))).toBe(true);
    });

    it('optimizer sizes the truss roles and the truss depth', () => {
        const P = { depthMin: 300, depthMax: 900, depthStep: 50, bfList: [150, 200, 250], tfList: [8, 10, 12, 16], twList: [4, 5, 6, 8], trussDepths: [1.2, 1.6, 2.0] };
        const o = optimizeSteel({ mode: 'frame', input: portal({ code: 'AISC360', windPressure: 0.6 }) }, P);
        expect(o.best).not.toBeNull();
        expect(o.result!.ok).toBe(true);
        expect(o.result!.members.filter(m => m.truss).every(m => m.maxUtil <= 1 + 1e-9)).toBe(true);
        const t = (o.best!.input as PortalFrameInput).truss!;
        expect([1.2, 1.6, 2.0]).toContain(t.depthEave);
    }, 120000);

    it('crane below the bottom chord only', () => {
        const crane = { span: 0, capacity: 50, crabWeight: 15, bridgeWeight: 60, hookApproach: 1, wheelBase: 3, eccentricity: 0.5,
            bracketLevel: 6.2, railLevel: 6.8, girderWeight: 1, impact: 0.25, surge: 0.1, lateralLimit: 400, spreadLimit: 10 };
        expect(() => buildModel({ mode: 'frame', input: portal({ crane }) })).toThrow(/bottom chord/);
        const ok = runDesign({ mode: 'frame', input: portal({ crane: { ...crane, bracketLevel: 5, railLevel: 5.6 } }) });
        expect(ok.combos.some(c => c.name.includes('CV1'))).toBe(true);
    });
});
