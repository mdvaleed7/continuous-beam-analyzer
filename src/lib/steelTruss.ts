/**
 * steelTruss.ts — sections and member checks for portal-truss members.
 *
 * Families
 *   CHS  circular hollow sections (IS 1161 structural tubes; properties from
 *        the outside diameter and wall, cold formed / welded)
 *   SHS  square hollow sections (IS 4923, cold formed; catalogue from STAAD's
 *        IS 4923-2017 database, as the Python PEB optimiser)
 *   2L   two equal angles back to back on a gusset (IS 808 ISEA), legs on the
 *        gusset in the truss plane: in-plane I = 2·Izz, out-of-plane
 *        I = 2[Iyy + A(c + tg/2)²], Ze = 2·Zz
 *
 * Units: mm, N, N·mm, MPa.
 *
 * IS 800:2007 (LSM)
 *   Table 2 class: CHS D/t 42ε² / 52ε² / 146ε² (bending), 88ε² (axial, class 3);
 *     SHS flat b/t 29.3ε / 33.5ε / 42ε (b = B − 2t, conservative);
 *     angles (axial, class 3): b/t ≤ 15.7ε and (b + d)/t ≤ 25ε
 *   7.1.2 compression, Table 10: hollow sections cold formed curve b; angles curve c
 *   6.2 / 6.3 tension: tubes welded all round An = Ag, Tdn = 0.9·An·fu/γm1;
 *     angles 6.3.3 Tdn = 0.9·Anc·fu/γm1 + β·Ago·fy/γm0 per angle, β = 0.7 (its lower bound)
 *   8.2.1.2 Md = Zp·fy/γm0 (class 1/2) or Ze·fy/γm0; no LTB for closed sections;
 *     double angles Ze (class 3)
 *   8.4 shear: RHS Av = A·h/(b + h), CHS Av = 2A/π, angles Av = 2·b·t;
 *     9.2.2 high shear with Mfd = 0 (conservative)
 *   9.3.1 / 9.3.2.2 interaction (KLT = 1, Cmz = 1 — upper bounds)
 *   Table 3 slenderness: KL/r ≤ 180 (compression under dead / imposed),
 *     250 (compression only with wind), 400 (always tension)
 *
 * AISC 360-22 (LRFD)
 *   Table B4.1a (compression): CHS D/t ≤ 0.11E/Fy; HSS walls b/t ≤ 1.40√(E/Fy)
 *     (b = B − 3t); double-angle legs b/t ≤ 0.45√(E/Fy) — slender elements are
 *     rejected (no E7 reduction)
 *   E3 flexural buckling; double angles also E4 flexural-torsional buckling
 *     (J = 2·It, Cw ≈ 0, shear centre at the outstanding legs); connectors of
 *     built-up members assumed adequate (E6 not checked)
 *   D2 tension: φ0.90·Fy·Ag, φ0.75·Fu·Ae; HSS welded all round U = 1;
 *     double angles U = 1 − x̄/l with an assumed weld length l = 2b
 *   F7 / F8: compact HSS Mn = Fy·Z, otherwise Fy·S (lower bound of F7.2 / F8.2);
 *     double angles Mn = Fy·S (F9.1 with the stem in compression; LTB not
 *     checked — chords held at every panel point)
 *   G4 / G5 / G3 shear, φv = 0.90; H1-1 interaction
 *   Slenderness KL/r ≤ 200 (compression, E2 user note), 300 (tension, D1 note)
 */
import { TUBES_IS4923 } from './data/tubesIS4923';
import { ANGLES_IS808 } from './data/anglesIS808';

export type TrussFamily = 'CHS' | 'SHS' | '2L';

export interface TrussSection {
    name: string;
    family: TrussFamily;
    A: number;          // mm²
    Iz: number;         // in-plane (truss plane) bending, mm⁴
    Iy: number;         // out-of-plane, mm⁴
    Zez: number;        // elastic modulus, in-plane bending, mm³
    Zpz: number;        // plastic modulus, mm³
    w: number;          // kg/m
    t: number;          // wall / leg thickness, mm
    D?: number;         // CHS outside diameter
    B?: number; H?: number;        // SHS width / depth
    b?: number;         // angle leg
    c?: number;         // angle centroid from the back of a leg
    J?: number;         // torsion constant (double angle: 2·It)
    tg?: number;        // gusset between the angles
}

const STEEL = 7850;

/** CHS from outside diameter and wall (mm). */
export function chsSection(D: number, t: number): TrussSection {
    const d = D - 2 * t;
    const A = Math.PI * (D * D - d * d) / 4;
    const I = Math.PI * (D ** 4 - d ** 4) / 64;
    return {
        name: `CHS ${D}x${t}`, family: 'CHS', A, Iz: I, Iy: I, Zez: 2 * I / D, Zpz: (D ** 3 - d ** 3) / 6,
        w: A * 1e-6 * STEEL, t, D, J: 2 * I,
    };
}

/**
 * Typical structural CHS sizes (outside diameter × wall, mm) of IS 1161 —
 * verify availability with the supplier; properties are computed from the
 * geometry, so any size can be added.
 */
export const CHS_SIZES: [number, number][] = [
    [33.7, 2.6], [33.7, 3.2], [42.4, 2.6], [42.4, 3.2], [48.3, 2.9], [48.3, 3.2], [48.3, 4.0],
    [60.3, 2.9], [60.3, 3.6], [60.3, 4.5], [76.1, 3.2], [76.1, 3.6], [76.1, 4.5], [88.9, 3.2], [88.9, 4.0], [88.9, 4.8],
    [114.3, 3.6], [114.3, 4.5], [114.3, 5.4], [139.7, 4.5], [139.7, 4.8], [139.7, 5.4], [165.1, 4.5], [165.1, 4.8], [165.1, 5.4],
    [168.3, 4.5], [168.3, 6.3], [193.7, 4.8], [193.7, 5.9], [219.1, 4.8], [219.1, 5.9], [219.1, 8.0], [273.0, 6.3], [273.0, 8.0],
];

export function shsSections(): TrussSection[] {
    return TUBES_IS4923.map(x => ({
        name: x.name, family: 'SHS' as const, A: x.A, Iz: x.Iz, Iy: x.Iy, Zez: x.Zez, Zpz: x.Zpz, w: x.w, t: x.t, B: x.B, H: x.H,
        J: 4 * ((x.B - x.t) * (x.H - x.t)) ** 2 * x.t / (2 * (x.B + x.H - 2 * x.t)),     // thin-walled closed section
    }));
}

/** Two equal angles back to back on a gusset tg thick (as the Python double_angle()). */
export function doubleAngle(a: (typeof ANGLES_IS808)[number], tg: number): TrussSection {
    return {
        name: `2-${a.name}`, family: '2L', A: 2 * a.A, Iz: 2 * a.Izz, Iy: 2 * (a.Iyy + a.A * (a.c + tg / 2) ** 2),
        Zez: 2 * a.Zz, Zpz: 2 * a.Zpz, w: 2 * a.w, t: a.t, b: a.b, c: a.c, J: 2 * a.It, tg,
    };
}

/** Every section of a family (double angles on a gusset tg thick), unfiltered. */
export function allTrussSections(family: TrussFamily, tg = 8): TrussSection[] {
    return family === 'CHS' ? CHS_SIZES.map(([D, t]) => chsSection(D, t))
        : family === 'SHS' ? shsSections()
            : ANGLES_IS808.map(a => doubleAngle(a, tg));
}

/** Section by name (any section of the family, not only the optimiser chain). */
export function trussSectionByName(family: TrussFamily, name: string, tg = 8): TrussSection {
    const s = allTrussSections(family, tg).find(x => x.name === name);
    if (!s) throw new Error(`Truss section ${name} is not in the ${family} catalogue`);
    return s;
}

/**
 * Catalogue of a family, lightest first, kept only where a step up never
 * weakens a member (each step: more area, Zp not lower, r_min ≥ 0.98 × the best
 * lighter one — the chain rule of the Python optimiser, so a greedy search
 * does not stall). Double angles: only Table 2 class-3 angles in compression
 * at the grade ((b + d)/t ≤ 25ε, IS 800) or b/t ≤ 0.45√(E/Fy) (AISC).
 */
export function trussCatalogue(family: TrussFamily, fy: number, code: 'IS800' | 'AISC360', tg = 8): TrussSection[] {
    const eps = Math.sqrt(250 / fy);
    const raw = allTrussSections(family, tg).filter(s => s.family !== '2L'
        || (code === 'IS800' ? 2 * s.b! / s.t <= 25 * eps + 1e-9 : s.b! / s.t <= 0.45 * Math.sqrt(200000 / fy) + 1e-9));
    const sorted = [...raw].sort((p, q) => p.w - q.w);
    const out: TrussSection[] = [];
    let rBest = 0;
    for (const s of sorted) {
        const r = Math.sqrt(Math.min(s.Iz, s.Iy) / s.A);
        const last = out[out.length - 1];
        if (!last || (s.w > last.w && s.A > 1.02 * last.A && s.Zpz >= last.Zpz && r >= 0.98 * rBest)) {
            out.push(s);
            rBest = Math.max(rBest, r);
        }
    }
    return out;
}

// ── member checks ──
export interface TrussMemberInput {
    N: number;          // axial (N), tension positive
    M: number;          // in-plane moment magnitude (N·mm)
    V: number;          // shear magnitude (N)
    Lz: number;         // in-plane effective length (mm)
    Ly: number;         // out-of-plane effective length (mm)
}

export interface TrussMemberResult {
    util: { class: number; tension: number; section: number; bucklingY: number; bucklingZ: number; shear: number };
    max: number;
    governing: string;
    KLr: number;        // largest slenderness KL/r
    Pc: number; Tc: number; Mc: number; Vc: number;     // design resistances (N, N·mm)
    notes: string[];
}

const chi = (lam: number, alpha: number) => {
    const phi = 0.5 * (1 + alpha * (lam - 0.2) + lam * lam);
    return Math.min(1, 1 / (phi + Math.sqrt(Math.max(0, phi * phi - lam * lam))));
};

const gov = (u: TrussMemberResult['util'], code: 'IS800' | 'AISC360') => {
    const labels: Record<keyof TrussMemberResult['util'], string> = code === 'IS800'
        ? { class: 'section class (Table 2)', tension: 'tension (Cl. 6)', section: 'section N + M (Cl. 9.3.1)', bucklingY: 'out-of-plane buckling (Cl. 9.3.2.2)', bucklingZ: 'in-plane buckling (Cl. 9.3.2.2)', shear: 'shear (Cl. 8.4)' }
        : { class: 'width-thickness (B4.1)', tension: 'tension (D2)', section: 'P + M (H1-1)', bucklingY: 'compression out of plane (E3/E4) + M', bucklingZ: 'compression in plane (E3) + M', shear: 'shear (G)' };
    let best: keyof TrussMemberResult['util'] = 'class';
    (Object.keys(u) as (keyof TrussMemberResult['util'])[]).forEach(k => { if (u[k] > u[best]) best = k; });
    return { max: u[best], governing: labels[best] };
};

/** IS 800:2007 check of a truss member at one station. */
export function checkTrussIS(s: TrussSection, fy: number, fu: number, q: TrussMemberInput): TrussMemberResult {
    const E = 2e5, gm0 = 1.10, gm1 = 1.25, fd = fy / gm0, eps = Math.sqrt(250 / fy);
    const notes: string[] = [];
    const rz = Math.sqrt(s.Iz / s.A), ry = Math.sqrt(s.Iy / s.A);
    const alpha = s.family === '2L' ? 0.49 : 0.34;                 // Table 10: angles c, cold-formed hollow b
    const pd = (L: number, r: number) => {
        const lam = Math.sqrt(fy / (Math.PI ** 2 * E)) * L / r;
        return { P: chi(lam, alpha) * s.A * fd, lam };
    };
    const z = pd(q.Lz, rz), y = pd(q.Ly, ry);
    const P = Math.max(0, -q.N), T = Math.max(0, q.N);
    // class and moment resistance
    let cls: number, plastic: boolean;
    if (s.family === 'CHS') {
        const Dt = s.D! / s.t;
        cls = P > 0 ? Math.max(Dt / (88 * eps * eps), Dt / (146 * eps * eps)) : Dt / (146 * eps * eps);
        plastic = Dt <= 52 * eps * eps;
    } else if (s.family === 'SHS') {
        const bt = (s.B! - 2 * s.t) / s.t;
        cls = bt / (42 * eps);
        plastic = bt <= 33.5 * eps;
    } else {
        cls = P > 0 ? Math.max(s.b! / s.t / (15.7 * eps), 2 * s.b! / s.t / (25 * eps)) : s.b! / s.t / (15.7 * eps);
        plastic = false;
    }
    let Md = (plastic ? s.Zpz : s.Zez) * fd;
    const Av = s.family === 'CHS' ? 2 * s.A / Math.PI : s.family === 'SHS' ? s.A * s.H! / (s.B! + s.H!) : 2 * s.b! * s.t;
    const Vd = Av * fy / (Math.sqrt(3) * gm0);
    if (q.V > 0.6 * Vd) Md *= Math.max(0, 1 - (2 * q.V / Vd - 1) ** 2);          // 9.2.2, Mfd = 0
    // tension
    let Td: number;
    if (s.family === '2L') {
        const leg = (s.b! - s.t / 2) * s.t;                         // connected (Anc) and outstanding (Ago) leg
        Td = Math.min(s.A * fd, 2 * (0.9 * leg * fu / gm1 + 0.7 * leg * fy / gm0));
    } else {
        Td = Math.min(s.A * fd, 0.9 * s.A * fu / gm1);
    }
    const nz = P / z.P;
    const Kz = Math.min(1 + (z.lam - 0.2) * nz, 1 + 0.8 * nz);
    const u = {
        class: cls,
        tension: T / Td,
        section: (T > 0 ? T / Td : P / (s.A * fd)) + q.M / Md,
        bucklingY: P > 0 ? P / y.P + q.M / Md : 0,
        bucklingZ: P > 0 ? nz + Kz * q.M / Md : 0,
        shear: q.V / Vd,
    };
    const g = gov(u, 'IS800');
    if (cls > 1) notes.push('slender (Class 4) — not allowed');
    return { util: u, max: g.max, governing: g.governing, KLr: Math.max(q.Lz / rz, q.Ly / ry), Pc: Math.min(z.P, y.P), Tc: Td, Mc: Md, Vc: Vd, notes };
}

/** AISC 360-22 LRFD check of a truss member at one station. */
export function checkTrussAISC(s: TrussSection, Fy: number, Fu: number, q: TrussMemberInput): TrussMemberResult {
    const E = 200000, G = 77200, phi = 0.9;
    const notes: string[] = [];
    const rz = Math.sqrt(s.Iz / s.A), ry = Math.sqrt(s.Iy / s.A);
    const fcr = (Fe: number) => (Fy / Fe <= 2.25 ? Math.pow(0.658, Fy / Fe) * Fy : 0.877 * Fe);
    const FeZ = Math.PI ** 2 * E / (q.Lz / rz) ** 2;
    let FeY = Math.PI ** 2 * E / (q.Ly / ry) ** 2;
    if (s.family === '2L') {
        // E4: flexural-torsional buckling about the axis of symmetry (out of plane)
        const y0 = s.c! - s.t / 2;                                  // centroid to shear centre
        const ro2 = y0 * y0 + (s.Iz + s.Iy) / s.A;
        const H = 1 - y0 * y0 / ro2;
        const Fez = G * s.J! / (s.A * ro2);
        FeY = (FeY + Fez) / (2 * H) * (1 - Math.sqrt(Math.max(0, 1 - 4 * FeY * Fez * H / (FeY + Fez) ** 2)));
    }
    const P = Math.max(0, -q.N), T = Math.max(0, q.N);
    let cls: number, compact: boolean;
    if (s.family === 'CHS') {
        const Dt = s.D! / s.t;
        cls = Dt / (0.11 * E / Fy);
        compact = Dt <= 0.07 * E / Fy;
    } else if (s.family === 'SHS') {
        const bt = (s.B! - 3 * s.t) / s.t;
        cls = bt / (1.40 * Math.sqrt(E / Fy));
        compact = bt <= 1.12 * Math.sqrt(E / Fy);
    } else {
        cls = s.b! / s.t / (0.45 * Math.sqrt(E / Fy));
        compact = false;
    }
    const Pc = phi * Math.min(fcr(FeZ), fcr(FeY)) * s.A;
    const PcZ = phi * fcr(FeZ) * s.A, PcY = phi * fcr(FeY) * s.A;
    const Mc = phi * Fy * (compact ? s.Zpz : s.Zez);
    const U = s.family === '2L' ? Math.max(0.4, 1 - s.c! / (2 * s.b!)) : 1;   // D3: U = 1 − x̄/l, l = 2b assumed
    const Tc = Math.min(phi * Fy * s.A, 0.75 * Fu * U * s.A);
    const Aw = s.family === 'CHS' ? s.A / 2 : s.family === 'SHS' ? 2 * (s.H! - 3 * s.t) * s.t : 2 * s.b! * s.t;
    const Vc = phi * 0.6 * Fy * Aw;
    const h1 = (pr: number, mr: number) => (pr >= 0.2 ? pr + 8 / 9 * mr : pr / 2 + mr);
    const u = {
        class: cls,
        tension: T / Tc,
        section: T > 0 ? h1(T / Tc, q.M / Mc) : h1(P / (phi * Fy * s.A), q.M / Mc),
        bucklingY: P > 0 ? h1(P / PcY, q.M / Mc) : 0,
        bucklingZ: P > 0 ? h1(P / PcZ, q.M / Mc) : 0,
        shear: q.V / Vc,
    };
    const g = gov(u, 'AISC360');
    if (cls > 1) notes.push('slender element — not allowed (no E7 reduction)');
    return { util: u, max: g.max, governing: g.governing, KLr: Math.max(q.Lz / rz, q.Ly / ry), Pc, Tc, Mc, Vc, notes };
}
