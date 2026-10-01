/**
 * steelIS800.ts — IS 800:2007 (limit state method) checks for welded,
 * doubly-symmetric I-sections, applied section by section along tapered
 * members.
 *
 *  Classification ........ Table 2 (welded outstands, web with axial load)
 *  Tension ............... Cl. 6.2   Tdg = Ag·fy/γm0
 *  Compression ........... Cl. 7.1.2  fcd = (fy/γm0)/(φ + √(φ² − λ²)),
 *                          φ = 0.5[1 + α(λ − 0.2) + λ²], λ = √(fy/fcc);
 *                          Table 10: welded I (tf ≤ 40): z-z curve b, y-y curve c
 *                          Slender elements: portion beyond the semi-compact
 *                          limit ignored (Cl. 7.3.2.1)
 *  Bending ............... Cl. 8.2.1.2 Md = βb·Zp·fy/γm0;  LTB Cl. 8.2.2
 *                          fbd = χLT·fy/γm0, αLT = 0.49 (welded),
 *                          Mcr = √[(π²EIy/LLT²)(G·It + π²EIw/LLT²)] (Cl. 8.2.2.1)
 *                          with c1 = 1.0 (uniform moment — conservative)
 *  Slender web (d/tw beyond the semi-compact limit): moment carried by the
 *                          flanges only, Mfd = Af·h0·fy/γm0 (plate-girder
 *                          approach); d/tw ≤ 200ε without stiffeners (Cl. 8.6.1.1)
 *  Shear ................. Cl. 8.4, web buckling Cl. 8.4.2.2(a) (simple
 *                          post-critical): kv = 5.35 without intermediate
 *                          stiffeners; with transverse stiffeners at spacing c
 *                          kv = 4 + 5.35/(c/d)² (c/d < 1), 5.35 + 4/(c/d)² (c/d ≥ 1)
 *  Web limits ............ Cl. 8.6.1.1 / 8.6.1.2: d/tw ≤ min(200ε, 345ε²) unstiffened;
 *                          stiffened d ≤ c ≤ 3d: 200ε; 0.74d ≤ c < d: c/tw ≤ 200ε;
 *                          c < 0.74d: 270ε; flange buckling 345ε² (c ≥ 1.5d) / 345ε
 *  Stiffeners ............ Cl. 8.7.1.2 outstand ≤ 20·ts·ε (core 14·ts·ε),
 *                          Cl. 8.7.2.4 Is ≥ 0.75·d·tw³ (c/d ≥ √2) or 1.5·d³·tw³/c²;
 *                          no tension field, so Fq = V − Vcr/γm0 ≤ 0 (Cl. 8.7.2.5)
 *  High shear ............ Cl. 9.2.2 (V > 0.6Vd)
 *  Combined .............. Cl. 9.3.1.3 (section, linear) and Cl. 9.3.2.2
 *                          (member buckling, Kz / KLT; Cmz = 0.9 sway frames)
 */
import type { SectionProps } from './steelSection';

export const IS800 = { E: 2.0e5, G: 0.769e5, gm0: 1.10 } as const;

export type ISClass = 'plastic' | 'compact' | 'semi-compact' | 'slender';
const rank: Record<ISClass, number> = { plastic: 0, compact: 1, 'semi-compact': 2, slender: 3 };
const worse = (a: ISClass, b: ISClass): ISClass => (rank[a] >= rank[b] ? a : b);

export const IS_ALPHA = { a: 0.21, b: 0.34, c: 0.49, d: 0.76 } as const;

/** Table 2 classification. N = axial force (N), compression positive. */
export function classifyIS(p: SectionProps, fy: number, N: number) {
    const eps = Math.sqrt(250 / fy);
    // Outstanding flange of a welded section: b/tf, b = half flange width (conservative)
    const bt = (p.bf / 2) / p.tf;
    const flange: ISClass = bt <= 8.4 * eps ? 'plastic' : bt <= 9.4 * eps ? 'compact' : bt <= 13.6 * eps ? 'semi-compact' : 'slender';
    // Web of an I-section: pure bending limits, reduced for axial compression
    // (Table 2, "generally": r1 = N/(d·tw·fy/γm0), r2 = N/(A·fy/γm0)).
    const dt = p.hw / p.tw;
    const Nc = Math.max(0, N);
    const r1 = Nc / (p.hw * p.tw * fy / IS800.gm0);
    const r2 = Nc / (p.A * fy / IS800.gm0);
    const lim = Nc > 0
        ? {
            pl: Math.max(84 * eps / (1 + r1), 42 * eps),
            co: Math.max(105 * eps / (1 + 1.5 * r1), 42 * eps),
            sc: Math.max(126 * eps / (1 + 2 * r2), 42 * eps),
        }
        : { pl: 84 * eps, co: 105 * eps, sc: 126 * eps };
    const web: ISClass = dt <= lim.pl ? 'plastic' : dt <= lim.co ? 'compact' : dt <= lim.sc ? 'semi-compact' : 'slender';
    return { flange, web, section: worse(flange, web), eps, bt, dt, webLimits: lim };
}

/** Stress reduction factor χ for a column curve (Cl. 7.1.2.1). */
export function chiIS(lambda: number, alpha: number): number {
    const phi = 0.5 * (1 + alpha * (lambda - 0.2) + lambda * lambda);
    return Math.min(1, 1 / (phi + Math.sqrt(Math.max(0, phi * phi - lambda * lambda))));
}

/** Effective area in compression: parts beyond the semi-compact limit ignored (Cl. 7.3.2.1). */
export function effectiveAreaIS(p: SectionProps, fy: number): number {
    const eps = Math.sqrt(250 / fy);
    const outstand = Math.min(p.bf / 2, 13.6 * eps * p.tf);          // welded outstand, axial compression
    const webEff = Math.min(p.hw, 42 * eps * p.tw);                   // web in axial compression
    return 4 * outstand * p.tf + webEff * p.tw;
}

/** Elastic critical moment, Cl. 8.2.2.1 (c1 = 1). LLT in mm; returns N·mm. */
export function mcrIS(p: SectionProps, LLT: number): number {
    const { E, G } = IS800;
    const a = Math.PI ** 2 * E * p.Iy / (LLT * LLT);
    return Math.sqrt(a * (G * p.J + Math.PI ** 2 * E * p.Iw / (LLT * LLT)));
}

/** In-plane bending strength of the section (no LTB), N·mm. */
export function bendingSectionIS(p: SectionProps, fy: number, cls: ReturnType<typeof classifyIS>) {
    const fyd = fy / IS800.gm0;
    if (cls.web === 'slender') {
        // Flanges only (plate-girder approach) — web carries shear
        return { Md: p.Af * p.h0 * fyd, betaB: 1, basis: 'flanges only (slender web)' as const };
    }
    const betaB = cls.section === 'semi-compact' ? p.Zez / p.Zpz : 1;
    return { Md: betaB * p.Zpz * fyd, betaB, basis: (betaB < 1 ? 'Ze' : 'Zp') as 'Ze' | 'Zp' };
}

/** LTB reduction for an unbraced segment, from its critical (smallest) section. */
export function ltbIS(pMin: SectionProps, fy: number, LLT: number, N = 0) {
    const cls = classifyIS(pMin, fy, N);
    const sec = bendingSectionIS(pMin, fy, cls);
    const Mcr = mcrIS(pMin, LLT);
    const Mp = sec.Md * IS800.gm0;                     // βb·Zp·fy (or flanges-only equivalent)
    const lambdaLT = Math.sqrt(Mp / Mcr);
    const chiLT = lambdaLT <= 0.4 ? 1 : chiIS(lambdaLT, 0.49);   // Cl. 8.2.2: LTB may be ignored for λLT ≤ 0.4
    return { Mcr, lambdaLT, chiLT };
}

/** Cl. 8.4.2.2(a) shear buckling coefficient; c = transverse stiffener spacing (mm), undefined = none. */
export function kvIS(c: number | undefined, d: number): number {
    if (c === undefined || !Number.isFinite(c)) return 5.35;
    const r = c / d;
    return r < 1 ? 4 + 5.35 / (r * r) : 5.35 + 4 / (r * r);
}

/** Largest d/tw by Cl. 8.6.1.1 (serviceability) and 8.6.1.2 (compression flange buckling into the web). */
export function webLimitIS(d: number, c: number | undefined, fy: number): number {
    const eps = Math.sqrt(250 / fy);
    if (c === undefined || !Number.isFinite(c) || c > 3 * d) return Math.min(200 * eps, 345 * eps * eps);
    const serv = c >= d ? 200 * eps : c >= 0.74 * d ? 200 * eps * d / c : 270 * eps;
    return Math.min(serv, c >= 1.5 * d ? 345 * eps * eps : 345 * eps);
}

export const STIFFENER_T = [6, 8, 10, 12, 16];      // mm, flat plate thicknesses tried

/**
 * Lightest single-sided flat intermediate stiffener (outstand toward the
 * flange tip): Cl. 8.7.1.2 outstand ≤ 20·ts·ε, stiffness from the core
 * section (14·ts·ε) about the web face ≥ Cl. 8.7.2.4. Null if none works.
 */
export function stiffenerIS(d: number, tw: number, bf: number, fy: number, c: number) {
    const eps = Math.sqrt(250 / fy);
    const IsMin = c / d >= Math.SQRT2 ? 0.75 * d * tw ** 3 : 1.5 * d ** 3 * tw ** 3 / (c * c);
    for (const ts of STIFFENER_T) {
        const bs = Math.min((bf - tw) / 2, 20 * ts * eps);
        const Is = ts * Math.min(bs, 14 * ts * eps) ** 3 / 3;
        if (bs > 0 && Is >= IsMin) return { ts, bs, Is, IsMin, area: ts * bs };
    }
    return null;
}

/** Shear strength with web buckling (Cl. 8.4, 8.4.2.2 a), N; c = stiffener spacing (mm). */
export function shearIS(p: SectionProps, fy: number, c?: number) {
    const { E } = IS800;
    const eps = Math.sqrt(250 / fy);
    const dt = p.hw / p.tw;
    const kv = kvIS(c, p.hw);
    let tau_b = fy / Math.sqrt(3);
    let lambdaW = 0;
    const buckling = dt > 67 * eps * Math.sqrt(kv / 5.35);                 // Cl. 8.4.2.1
    if (buckling) {
        const tauCr = kv * Math.PI ** 2 * E / (12 * (1 - 0.3 * 0.3) * dt * dt);
        lambdaW = Math.sqrt(fy / (Math.sqrt(3) * tauCr));
        tau_b = lambdaW <= 0.8 ? fy / Math.sqrt(3)
            : lambdaW < 1.2 ? (1 - 0.8 * (lambdaW - 0.8)) * fy / Math.sqrt(3)
                : fy / (Math.sqrt(3) * lambdaW * lambdaW);
    }
    // Cl. 8.4.1.1: shear area of a WELDED I-section Av = d·tw (d = clear web depth); h·tw is for rolled sections
    const Av = p.hw * p.tw;
    return { Vd: Av * tau_b / IS800.gm0, tau_b, lambdaW, buckling, kv };
}

export interface ISStationInput {
    N: number;          // axial (N), tension positive
    M: number;          // major-axis moment magnitude (N·mm)
    V: number;          // shear magnitude (N)
    fccZ: number;       // in-plane elastic buckling stress at this section (MPa), Infinity if none
    fccY: number;       // out-of-plane elastic buckling stress (MPa)
    chiLT: number;      // from the unbraced segment
    lambdaLT: number;
    CmLT: number;       // equivalent uniform moment factor of the segment (Table 18)
    Cmz?: number;       // default 0.9 (sway frame, Table 18)
    c?: number;         // transverse web stiffener spacing (mm); undefined = none
}

export interface ISStationResult {
    cls: ReturnType<typeof classifyIS>;
    Nd: number; Pdz: number; Pdy: number; lambdaZ: number; lambdaY: number;
    Md: number; MdLT: number; Vd: number;
    util: { section: number; bucklingY: number; bucklingZ: number; shear: number };
    max: number;
    governing: string;
    notes: string[];
}

export function checkStationIS(p: SectionProps, fy: number, s: ISStationInput): ISStationResult {
    const fyd = fy / IS800.gm0;
    const notes: string[] = [];
    const Ncomp = Math.max(0, -s.N);
    const cls = classifyIS(p, fy, Ncomp);
    const eps = cls.eps;
    if (cls.flange === 'slender') notes.push(`flange b/tf = ${cls.bt.toFixed(1)} > 13.6ε — slender flange not covered`);
    const dtMax = webLimitIS(p.hw, s.c, fy);
    if (cls.dt > dtMax) {
        notes.push(s.c === undefined
            ? `web d/tw = ${cls.dt.toFixed(0)} > ${dtMax.toFixed(0)} — stiffeners required (Cl. 8.6.1.1)`
            : `web d/tw = ${cls.dt.toFixed(0)} > ${dtMax.toFixed(0)} with stiffeners at ${s.c.toFixed(0)} mm — stiffeners required (Cl. 8.6.1)`);
    }

    // Axial
    const Nd = p.A * fyd;
    const Ae = cls.section === 'slender' ? effectiveAreaIS(p, fy) : p.A;
    const lambdaZ = Number.isFinite(s.fccZ) ? Math.sqrt(fy / s.fccZ) : 0;
    const lambdaY = Number.isFinite(s.fccY) ? Math.sqrt(fy / s.fccY) : 0;
    const buckZ = p.tf <= 40 ? IS_ALPHA.b : IS_ALPHA.c;
    const buckY = p.tf <= 40 ? IS_ALPHA.c : IS_ALPHA.d;
    const Pdz = Ae * fyd * chiIS(lambdaZ, buckZ);
    const Pdy = Ae * fyd * chiIS(lambdaY, buckY);

    // Bending
    const sec = bendingSectionIS(p, fy, cls);
    let Md = sec.Md;
    const Vs = shearIS(p, fy, s.c);
    const Vd = Vs.Vd;
    if (s.V > 0.6 * Vd && cls.web !== 'slender') {
        // Cl. 9.2.2: Mdv = Md − β(Md − Mfd) ≤ 1.2·Ze·fy/γm0, β = (2V/Vd − 1)²
        const Mfd = p.Af * p.h0 * fyd;
        const beta = (2 * s.V / Vd - 1) ** 2;
        Md = Math.max(Mfd, Math.min(Md - beta * (Md - Mfd), 1.2 * p.Zez * fyd));
        notes.push('high shear: moment capacity reduced (Cl. 9.2.2)');
    }
    const MdLT = Math.min(Md, s.chiLT * sec.Md);

    // Interaction
    let section: number, bucklingY: number, bucklingZ: number;
    if (s.N >= 0) {
        // Tension + bending: section check; LTB checked on the moment alone (tension benefit ignored)
        section = s.N / Nd + s.M / Md;
        bucklingY = s.M / MdLT;
        bucklingZ = 0;
    } else {
        const P = Ncomp;
        section = P / (Ae * fyd) + s.M / Md;                              // Cl. 9.3.1.3
        const ny = P / Pdy, nz = P / Pdz;
        const Cmz = s.Cmz ?? 0.9;
        const Kz = Math.min(1 + (lambdaZ - 0.2) * nz, 1 + 0.8 * nz);
        const den = Math.max(1e-6, s.CmLT - 0.25);
        const KLT = Math.max(1 - 0.1 * s.lambdaLT * ny / den, 1 - 0.1 * ny / den);
        bucklingY = ny + KLT * s.M / MdLT;                                // Cl. 9.3.2.2 (a)
        bucklingZ = nz + Kz * Cmz * s.M / MdLT;              // Cl. 9.3.2.2 (b)
    }
    const shear = s.V / Vd;
    const util = { section, bucklingY, bucklingZ, shear };
    let max = Math.max(section, bucklingY, bucklingZ, shear);
    if (notes.some(n => n.includes('not covered') || n.includes('stiffeners required'))) max = Math.max(max, 9.99);
    const governing = max === shear ? 'shear (Cl. 8.4)'
        : max === section ? 'section N + M (Cl. 9.3.1)'
            : max === bucklingY ? 'out-of-plane / LTB (Cl. 9.3.2.2)'
                : max === bucklingZ ? 'in-plane buckling (Cl. 9.3.2.2)' : 'section limits';
    return { cls, Nd, Pdz, Pdy, lambdaZ, lambdaY, Md, MdLT, Vd, util, max, governing, notes };
}
