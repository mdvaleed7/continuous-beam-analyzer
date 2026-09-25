/**
 * steelAISC360.ts — AISC 360-22 (LRFD) checks for welded, doubly-symmetric
 * I-sections, applied section by section along web-tapered members
 * (stress-based approach of AISC Design Guide 25).
 *
 *  Classification ... Table B4.1a (compression), B4.1b (flexure; built-up
 *                     flanges kc = 4/√(h/tw), 0.35 ≤ kc ≤ 0.76)
 *  Compression ...... E3 (Fcr = 0.658^(Fy/Fe)·Fy or 0.877Fe), E7 effective
 *                     widths for slender elements (Table E7.1 c1, c2)
 *  Flexure .......... F2 / F3 (compact web), F4 (noncompact web), F5 (slender
 *                     web); F13.2 h/tw ≤ 260 and aw ≤ 10 without stiffeners
 *  Shear ............ G2.1, kv = 5.34 (no transverse stiffeners), φv = 0.9
 *  Tension .......... D2(a) yielding, φt = 0.9
 *  Interaction ...... H1-1a / H1-1b
 *  φ = 0.90 for compression, flexure, shear (built-up) and tension yielding.
 */
import type { SectionProps } from './steelSection';

export const AISC = { E: 200000, G: 77200, phi: 0.9 } as const;

const kcOf = (p: SectionProps) => Math.min(0.76, Math.max(0.35, 4 / Math.sqrt(p.hw / p.tw)));

export function classifyAISC(p: SectionProps, Fy: number) {
    const { E } = AISC;
    const kc = kcOf(p);
    const FL = 0.7 * Fy;
    const lf = p.bf / (2 * p.tf), lw = p.hw / p.tw;
    const flex = {
        lpf: 0.38 * Math.sqrt(E / Fy), lrf: 0.95 * Math.sqrt(kc * E / FL),
        lpw: 3.76 * Math.sqrt(E / Fy), lrw: 5.70 * Math.sqrt(E / Fy),
    };
    const comp = { lrf: 0.64 * Math.sqrt(kc * E / Fy), lrw: 1.49 * Math.sqrt(E / Fy) };
    const flange = lf <= flex.lpf ? 'compact' : lf <= flex.lrf ? 'noncompact' : 'slender';
    const web = lw <= flex.lpw ? 'compact' : lw <= flex.lrw ? 'noncompact' : 'slender';
    return { kc, FL, lf, lw, flex, comp, flange, web } as const;
}

/** E3: critical stress for elastic buckling stress Fe (MPa). */
export function fcrE3(Fy: number, Fe: number): number {
    if (!Number.isFinite(Fe)) return Fy;
    return Fy / Fe <= 2.25 ? Math.pow(0.658, Fy / Fe) * Fy : 0.877 * Fe;
}

/** E7: effective area at critical stress Fcr (mm²). */
export function effectiveAreaAISC(p: SectionProps, Fy: number, Fcr: number): number {
    const c = classifyAISC(p, Fy);
    const eff = (b: number, lambda: number, lr: number, c1: number, c2: number) => {
        if (lambda <= lr * Math.sqrt(Fy / Fcr)) return b;
        const Fel = (c2 * lr / lambda) ** 2 * Fy;
        const r = Math.sqrt(Fel / Fcr);
        return Math.min(b, b * (1 - c1 * r) * r);
    };
    const bOut = p.bf / 2;
    const be = eff(bOut, c.lf, c.comp.lrf, 0.22, 1.49);        // unstiffened (built-up flange)
    const he = eff(p.hw, c.lw, c.comp.lrw, 0.18, 1.31);        // stiffened (web)
    return p.A - 4 * (bOut - be) * p.tf - (p.hw - he) * p.tw;
}

export function compressionAISC(p: SectionProps, Fy: number, Fe: number) {
    const Fcr = fcrE3(Fy, Fe);
    const Ae = effectiveAreaAISC(p, Fy, Fcr);
    return { Fcr, Ae, Pn: Fcr * Ae };
}

/** Section-only flexural strength (no LTB): yielding / Rpc / Rpg and FLB (N·mm). */
export function flexureLocalAISC(p: SectionProps, Fy: number) {
    const { E } = AISC;
    const c = classifyAISC(p, Fy);
    const Sx = p.Zez, Mp = Math.min(Fy * p.Zpz, 1.6 * Fy * Sx), Myc = Fy * Sx;
    const aw = Math.min(10, p.hw * p.tw / (p.bf * p.tf));
    const flb = (Mplateau: number, FLSx: number) =>
        c.flange === 'compact' ? Mplateau
            : c.flange === 'noncompact'
                ? Mplateau - (Mplateau - FLSx) * (c.lf - c.flex.lpf) / (c.flex.lrf - c.flex.lpf)
                : 0.9 * E * c.kc * Sx / (c.lf * c.lf);
    if (c.web === 'compact') {
        // F2 / F3
        const Mn = Math.min(Mp, flb(Mp, 0.7 * Fy * Sx));
        return { Mn, plateau: Mp, case: c.flange === 'compact' ? 'F2' : 'F3', Rpc: Mp / Myc, Rpg: 1 };
    }
    if (c.web === 'noncompact') {
        // F4 — Rpc
        const r = Mp / Myc;
        const Rpc = Math.min(r, r - (r - 1) * (c.lw - c.flex.lpw) / (c.flex.lrw - c.flex.lpw));
        const Mn = Math.min(Rpc * Myc, flb(Rpc * Myc, c.FL * Sx));
        return { Mn, plateau: Rpc * Myc, case: 'F4', Rpc, Rpg: 1 };
    }
    // F5 — Rpg; flange local buckling on the critical stress
    const Rpg = Math.min(1, 1 - aw / (1200 + 300 * aw) * (c.lw - 5.7 * Math.sqrt(E / Fy)));
    const Fcr = c.flange === 'compact' ? Fy
        : c.flange === 'noncompact' ? Fy - 0.3 * Fy * (c.lf - c.flex.lpf) / (c.flex.lrf - c.flex.lpf)
            : 0.9 * E * c.kc / (c.lf * c.lf);
    return { Mn: Rpg * Math.min(Fy, Fcr) * Sx, plateau: Rpg * Fy * Sx, case: 'F5', Rpc: 1, Rpg };
}

/** LTB strength of a segment from its critical (smallest) section; returns stress Mn/Sx (MPa). */
export function ltbStressAISC(p: SectionProps, Fy: number, Lb: number, Cb: number) {
    const { E } = AISC;
    const c = classifyAISC(p, Fy);
    const Sx = p.Zez, Mp = Math.min(Fy * p.Zpz, 1.6 * Fy * Sx);
    const aw = Math.min(10, p.hw * p.tw / (p.bf * p.tf));
    const rt = p.bf / Math.sqrt(12 * (1 + aw / 6));
    let Mn: number, Lp: number, Lr: number;
    if (c.web === 'compact') {
        // F2
        const rts = Math.sqrt(Math.sqrt(p.Iy * p.Iw) / Sx);
        const jr = p.J / (Sx * p.h0);
        Lp = 1.76 * p.ry * Math.sqrt(E / Fy);
        Lr = 1.95 * rts * (E / (0.7 * Fy)) * Math.sqrt(jr + Math.sqrt(jr * jr + 6.76 * (0.7 * Fy / E) ** 2));
        if (Lb <= Lp) Mn = Mp;
        else if (Lb <= Lr) Mn = Math.min(Mp, Cb * (Mp - (Mp - 0.7 * Fy * Sx) * (Lb - Lp) / (Lr - Lp)));
        else {
            const Fcr = Cb * Math.PI ** 2 * E / (Lb / rts) ** 2 * Math.sqrt(1 + 0.078 * jr * (Lb / rts) ** 2);
            Mn = Math.min(Mp, Fcr * Sx);
        }
    } else if (c.web === 'noncompact') {
        // F4
        const loc = flexureLocalAISC(p, Fy);
        const RM = loc.Rpc * Fy * Sx, FL = c.FL;
        const jr = p.J / (Sx * p.h0);
        Lp = 1.1 * rt * Math.sqrt(E / Fy);
        Lr = 1.95 * rt * (E / FL) * Math.sqrt(jr + Math.sqrt(jr * jr + 6.76 * (FL / E) ** 2));
        if (Lb <= Lp) Mn = RM;
        else if (Lb <= Lr) Mn = Math.min(RM, Cb * (RM - (RM - FL * Sx) * (Lb - Lp) / (Lr - Lp)));
        else {
            const Fcr = Cb * Math.PI ** 2 * E / (Lb / rt) ** 2 * Math.sqrt(1 + 0.078 * jr * (Lb / rt) ** 2);
            Mn = Math.min(RM, Fcr * Sx);
        }
    } else {
        // F5
        const Rpg = flexureLocalAISC(p, Fy).Rpg;
        Lp = 1.1 * rt * Math.sqrt(E / Fy);
        Lr = Math.PI * rt * Math.sqrt(E / (0.7 * Fy));
        const Fcr = Lb <= Lp ? Fy
            : Lb <= Lr ? Math.min(Fy, Cb * (Fy - 0.3 * Fy * (Lb - Lp) / (Lr - Lp)))
                : Math.min(Fy, Cb * Math.PI ** 2 * E / (Lb / rt) ** 2);
        Mn = Rpg * Fcr * Sx;
    }
    return { Fn: Mn / Sx, Lp, Lr };
}

/** Moment gradient factor, Eq. F1-1 (capped at 3.0). */
export function cbAISC(Mmax: number, MA: number, MB: number, MC: number): number {
    const den = 2.5 * Mmax + 3 * MA + 4 * MB + 3 * MC;
    return den > 0 ? Math.min(3, 12.5 * Mmax / den) : 1;
}

/** G2.1 shear, no transverse stiffeners (N). */
export function shearAISC(p: SectionProps, Fy: number) {
    const { E } = AISC;
    const kv = 5.34;
    const ht = p.hw / p.tw;
    const lim = 1.10 * Math.sqrt(kv * E / Fy);
    const Cv1 = ht <= lim ? 1 : lim / ht;
    return { Vn: 0.6 * Fy * p.Aw * Cv1, Cv1 };
}

export interface AISCStationInput {
    N: number;      // axial (N), tension positive
    M: number;      // moment magnitude (N·mm)
    V: number;      // shear magnitude (N)
    FeIn: number;   // in-plane elastic buckling stress at the section (MPa)
    FeOut: number;  // out-of-plane elastic buckling stress (MPa)
    FnLTB: number;  // LTB stress capacity of the segment (MPa)
}

export interface AISCStationResult {
    cls: ReturnType<typeof classifyAISC>;
    Pc: number; Mc: number; Vc: number; Tc: number;
    flexCase: string;
    util: { interaction: number; shear: number };
    max: number;
    governing: string;
    notes: string[];
}

export function checkStationAISC(p: SectionProps, Fy: number, s: AISCStationInput): AISCStationResult {
    const phi = AISC.phi;
    const cls = classifyAISC(p, Fy);
    const notes: string[] = [];
    const aw = p.hw * p.tw / (p.bf * p.tf);
    if (cls.lw > 260) notes.push(`h/tw = ${cls.lw.toFixed(0)} > 260 — stiffeners required (F13.2)`);
    if (aw > 10) notes.push(`aw = ${aw.toFixed(1)} > 10 (F13.2)`);

    const loc = flexureLocalAISC(p, Fy);
    const MnLTB = s.FnLTB * p.Zez;
    const Mn = Math.min(loc.Mn, MnLTB);
    const Mc = phi * Mn;
    const Vc = phi * shearAISC(p, Fy).Vn;
    const Tc = phi * Fy * p.A;

    let interaction: number;
    let Pc = Infinity;
    if (s.N < 0) {
        const Pn = Math.min(compressionAISC(p, Fy, s.FeIn).Pn, compressionAISC(p, Fy, s.FeOut).Pn);
        Pc = phi * Pn;
        const pr = -s.N / Pc, mr = s.M / Mc;
        interaction = pr >= 0.2 ? pr + 8 / 9 * mr : pr / 2 + mr;           // H1-1a / H1-1b
    } else {
        const pr = s.N / Tc, mr = s.M / Mc;
        interaction = pr >= 0.2 ? pr + 8 / 9 * mr : pr / 2 + mr;
    }
    const shear = s.V / Vc;
    let max = Math.max(interaction, shear);
    if (notes.length) max = Math.max(max, 9.99);
    const governing = max === shear ? 'shear (G2.1)'
        : notes.length ? 'proportion limits (F13.2)'
            : `P + M (H1-1), flexure ${loc.case}${MnLTB < loc.Mn ? ' LTB' : ''}`;
    return { cls, Pc, Mc, Vc, Tc, flexCase: loc.case, util: { interaction, shear }, max, governing, notes };
}
