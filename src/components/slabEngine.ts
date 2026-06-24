/**
 * slabEngine.ts — IS 456:2000 Slab Design Engine
 *
 * Supports:
 *  • Two-way restrained slabs (IS 456 Table 26 / Annex D)
 *  • One-way slabs (Ly/Lx > 2)
 *  • Cantilever slabs
 *  • Multi-panel design
 *  • Full Annex C deflection (short-term + shrinkage + creep)
 *  • Shear check per IS 456 Clause 40
 */

import {
    TAU_C_MAX,
    CREEP_COEFF,
    getTauC,
    flexuralDesign,
    selectBars,
    computeCostIndex,
    type ConcreteGrade,
    type SteelGrade,
    type Governs,
    type FlexuralResult,
    type BarResult,
} from '../lib/is456';

// ─── Public types ────────────────────────────────────────────────────────────

export type SlabType = 'two-way' | 'one-way' | 'cantilever';
export type SlabTypeInput = 'auto' | SlabType;
export type SupportCondition = 'cantilever' | 'simply' | 'one_end' | 'continuous';
export type DesignStatus = 'OK' | 'FAIL' | 'DESIGN' | 'SAFE' | 'REVISE';
export type { Governs } from '../lib/is456';

/** Input configuration for a single slab panel. */
export interface SlabConfig {
    label?: string;
    Lx: number;             // short span (m) — used by two-way, one-way, auto
    Ly: number;             // long span (m) — used by two-way, auto
    L?: number;             // single span (m) — used by cantilever (replaces Lx/Ly)
    D: number;              // overall thickness (mm)
    cover?: number;         // clear cover (mm), default 20
    fck?: number;           // concrete grade (MPa), default 25
    fy?: number;            // steel grade (MPa), default 500
    grade?: ConcreteGrade | string;   // e.g. "M25"
    steelGrade?: SteelGrade | string; // e.g. "Fe500"
    DL?: number;            // additional dead load (kN/m²)
    LL?: number;            // live load (kN/m²), default 3
    SDL?: number;           // superimposed dead load (kN/m²), default 1.5
    loadFactor?: number;    // default 1.5
    boundaryCase?: number;  // IS 456 Table 26 case 1-9 (two-way only)
    supportCondition?: SupportCondition; // one-way explicit support condition
    slabType?: SlabTypeInput;
    ageOfLoading?: string;  // '7' | '28' | '365'
    camber?: number;        // (mm) initial upward camber to offset deflection
}

// ponytail: FlexuralDesign and BarSelection are now FlexuralResult and BarResult from is456
export type FlexuralDesign = FlexuralResult;
export type BarSelection = BarResult;

export interface ShearDirResult {
    Vu: number;
    tau_v: number;
    tau_c: number;
    k: number;
    tau_c_max: number;
    pt: number;
    allowable: number;
    status: DesignStatus;
    d: number;
}

export interface ShearResult {
    shortDir: ShearDirResult;
    longDir: ShearDirResult;
}

export interface SpanDepthCheck {
    basicRatio: number;
    mf: number;
    modifiedRatio: number;
    fs: number;
    pt: number;
    d_req: number;
    d_provided: number;
    status: DesignStatus;
    note: string;
}

export interface DeflectionResult {
    L: number;
    D: number;
    d: number;
    b: number;
    Ec: number;
    Es: number;
    m: number;
    m_lt: number;
    theta: number;
    Ece: number;
    pt: number;
    pc: number;
    Igr: number;
    Icr: number;
    Ieff: number;
    Ieff_perm: number;
    Icr_lt: number;
    Ieff_lt: number;
    x: number;
    x_lt: number;
    z: number;
    z_lt: number;
    Mcr: number;
    fcr: number;
    alpha: number;
    k3: number;
    eps_cs: number;
    psi_cs: number;
    ai: number;
    ai_perm: number;
    a1_perm: number;
    a_shrinkage: number;
    a_creep: number;
    a_total: number;
    a_post_construction: number;
    limit_total: number;
    limit_post: number;
    status_total: 'OK' | 'FAIL';
    status_post: 'OK' | 'FAIL';
    camber: number;
    supportCondition: SupportCondition;
}

export interface SlabAnalysisResult {
    Lx: number;
    Ly: number;
    D: number;
    cover: number;
    fck: number;
    fy: number;
    grade: string;
    steelGrade: string;
    DL: number;
    LL: number;
    SDL: number;
    selfWeight: number;
    totalDL: number;
    totalService: number;
    wFactored: number;
    loadFactor: number;
    boundaryCase: number;
    supportCondition: SupportCondition;
    slabType: SlabType;
    lyLx: number;
    ageOfLoading: string;
    ax_pos: number | null;
    ay_pos: number | null;
    ax_neg: number | null;
    ay_neg: number | null;
    Mx_pos: number;
    My_pos: number;
    Mx_neg: number;
    My_neg: number;
    dx: number;
    dy: number;
    flex_x_bot: FlexuralDesign;
    flex_y_bot: FlexuralDesign;
    flex_x_top: FlexuralDesign;
    flex_y_top: FlexuralDesign;
    bars_x_bot: BarSelection;
    bars_y_bot: BarSelection;
    bars_x_top: BarSelection;
    bars_y_top: BarSelection;
    ldCheck: SpanDepthCheck;
    deflection: DeflectionResult;
    shear: ShearResult;
    steelStatus: DesignStatus;
    deflStatus: 'OK' | 'FAIL';
    shearStatus: 'OK' | 'FAIL';
    overallStatus: DesignStatus;
}

export interface MultiPanelResult extends SlabAnalysisResult {
    panelId: number;
    label: string;
}

// ═══════════════════════════════════════════════════════════════
//  IS 456 TABLE 26 — Bending Moment Coefficients
//  Rows: 9 boundary cases. Columns: Ly/Lx = 1.0…2.0
// ═══════════════════════════════════════════════════════════════
const LY_LX_RATIOS: readonly number[] = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0];

// αx+ (positive moment in short span, mid-span)
const TABLE_26_AX_POS: readonly (readonly number[])[] = [
    [0.024, 0.028, 0.032, 0.036, 0.039, 0.041, 0.045, 0.049], // Case 1: Interior
    [0.028, 0.032, 0.036, 0.039, 0.041, 0.044, 0.048, 0.052], // Case 2: One short edge disc.
    [0.028, 0.033, 0.039, 0.044, 0.047, 0.051, 0.059, 0.065], // Case 3: One long edge disc.
    [0.035, 0.040, 0.045, 0.049, 0.053, 0.056, 0.063, 0.069], // Case 4: Two adjacent edges disc.
    [0.035, 0.037, 0.040, 0.043, 0.045, 0.045, 0.049, 0.052], // Case 5: Two short edges disc.
    [0.035, 0.043, 0.051, 0.057, 0.063, 0.068, 0.080, 0.088], // Case 6: Two long edges disc.
    [0.043, 0.048, 0.053, 0.057, 0.060, 0.064, 0.069, 0.073], // Case 7: Three edges disc. (1 long cont.)
    [0.043, 0.051, 0.059, 0.065, 0.071, 0.076, 0.087, 0.096], // Case 8: Three edges disc. (1 short cont.)
    [0.056, 0.064, 0.072, 0.079, 0.085, 0.089, 0.100, 0.107], // Case 9: Four edges disc. (SS)
];

// αy+ (positive moment in long span, mid-span) — constant for all Ly/Lx
const TABLE_26_AY_POS: readonly number[] = [0.024, 0.028, 0.028, 0.035, 0.035, 0.035, 0.043, 0.043, 0.056];

// αx- (negative moment in short span, at supports)
const TABLE_26_AX_NEG: readonly (readonly (number | null)[])[] = [
    [0.032, 0.037, 0.043, 0.047, 0.051, 0.053, 0.060, 0.065], // Case 1
    [0.037, 0.043, 0.048, 0.051, 0.055, 0.057, 0.064, 0.068], // Case 2
    [0.037, 0.044, 0.052, 0.057, 0.063, 0.067, 0.077, 0.085], // Case 3
    [0.047, 0.053, 0.060, 0.065, 0.071, 0.075, 0.084, 0.091], // Case 4
    [0.045, 0.049, 0.052, 0.056, 0.059, 0.060, 0.065, 0.069], // Case 5
    [null, null, null, null, null, null, null, null],          // Case 6: no αx- (both long edges disc.)
    [0.057, 0.064, 0.071, 0.076, 0.080, 0.084, 0.091, 0.097], // Case 7
    [null, null, null, null, null, null, null, null],          // Case 8: no αx- (1 short cont.)
    [null, null, null, null, null, null, null, null],          // Case 9: no αx- (all edges disc.)
];

// αy- (negative moment in long span, at supports) — constant where applicable
const TABLE_26_AY_NEG: readonly (number | null)[] = [
    0.032, // Case 1
    0.037, // Case 2
    0.037, // Case 3
    0.047, // Case 4
    null,  // Case 5: no αy- (both short edges disc.)
    0.045, // Case 6
    null,  // Case 7: no αy-
    0.057, // Case 8
    null,  // Case 9: no αy-
];

// Depth multiplier k for thin slabs (IS 456 Cl. 40.2.1.1)
function getDepthFactorK(D: number): number {
    if (D <= 150) return 1.30;
    if (D <= 175) return 1.25 + (175 - D) * 0.05 / 25;
    if (D <= 200) return 1.20 + (200 - D) * 0.05 / 25;
    if (D <= 225) return 1.15 + (225 - D) * 0.05 / 25;
    if (D <= 250) return 1.10 + (250 - D) * 0.05 / 25;
    if (D <= 275) return 1.05 + (275 - D) * 0.05 / 25;
    if (D <= 300) return 1.00 + (300 - D) * 0.05 / 25;
    return 1.00;
}

// ═══════════════════════════════════════════════════════════════
//  INTERPOLATION
// ═══════════════════════════════════════════════════════════════
function interpolateCoeff(
    caseNo: number,
    lyLx: number,
    table: ReadonlyArray<ReadonlyArray<number | null>>,
): number | null {
    const idx = caseNo - 1;
    const row = table[idx];
    if (!row) return null;

    // Clamp ratio
    const r = Math.max(1.0, Math.min(2.0, lyLx));

    // Find bracketing indices
    for (let i = 0; i < LY_LX_RATIOS.length - 1; i++) {
        if (r >= LY_LX_RATIOS[i] && r <= LY_LX_RATIOS[i + 1]) {
            const lo = LY_LX_RATIOS[i], hi = LY_LX_RATIOS[i + 1];
            const vLo = row[i];
            const vHi = row[i + 1];
            if (vLo === null || vHi === null) return null;
            return vLo + (vHi - vLo) * (r - lo) / (hi - lo);
        }
    }
    // Exact match at 2.0
    return row[row.length - 1];
}


// ponytail: getTauC imported directly from ../lib/is456

// ═══════════════════════════════════════════════════════════════
//  MODIFICATION FACTOR (IS 456 Fig. 4 — simplified formula)
// ═══════════════════════════════════════════════════════════════
function getModificationFactor(fs: number, ptProv: number): number {
    const pt = Math.max(0.1, Math.min(3.0, ptProv));
    let mf: number;
    if (fs <= 120) {
        mf = 2.0 - 0.8 * (pt - 0.1);
    } else if (fs <= 240) {
        mf = 1.6 - 0.6 * (pt - 0.2) - (fs - 120) * 0.003;
    } else {
        mf = 1.2 - 0.35 * (pt - 0.3) - (fs - 240) * 0.002;
    }
    return Math.max(1.0, Math.min(2.0, mf));
}

// Basic l/d ratios per IS 456 Cl. 23.2.1
function getBasicLdRatio(supportType: SupportCondition): number {
    switch (supportType) {
        case 'cantilever': return 7;
        case 'simply': return 20;
        case 'continuous':
        default: return 26;
    }
}

// ═══════════════════════════════════════════════════════════════
//  FLEXURAL DESIGN — IS 456 Cl. 38
// ═══════════════════════════════════════════════════════════════
// ponytail: flexuralDesign + selectBars imported from ../lib/is456 — zero local copies

// ═══════════════════════════════════════════════════════════════
//  FULL ANNEX C DEFLECTION — IS 456:2000
// ═══════════════════════════════════════════════════════════════
interface AnnexCConfig {
    Lx: number;
    D: number;
    cover: number;
    fck: number;
    fy: number;
    Es?: number;
    ageOfLoading?: string;
    camber?: number;
}

interface AnnexCDesign {
    barDia_x_bot: number;
    Ast_x_bot: number;
    Asc_x_top?: number;
    M_service: number;
    M_perm: number;
    supportCondition: SupportCondition;
}

function annexCDeflection(config: AnnexCConfig, design: AnnexCDesign): DeflectionResult {
    const { Lx, D, cover, fck, fy, Es = 200000, ageOfLoading = '28', camber = 0 } = config;
    const { barDia_x_bot, Ast_x_bot, Asc_x_top = 0, M_service, M_perm, supportCondition } = design;

    const b = 1000; // mm, unit strip
    const d = D - cover - (barDia_x_bot || 10) / 2;
    const L = Lx; // mm — short span

    const Ec = Math.round(5000 * Math.sqrt(fck));
    const m = Math.round(Es / Ec); // short-term modular ratio
    const pt = 100 * Ast_x_bot / (b * d);
    const pc = 100 * Asc_x_top / (b * d);

    // ─── Gross Moment of Inertia Igr ───
    const Igr = b * D * D * D / 12;

    // ─── Cracking Moment Mcr ───
    const fcr = 0.7 * Math.sqrt(fck);
    const yt = D / 2;
    const Mcr = fcr * Igr / yt / 1e6; // kN·m

    // ─── Cracked Moment of Inertia Icr ───
    const d_comp = cover + (barDia_x_bot || 10) / 2;
    let x: number;
    if (Asc_x_top > 0) {
        const A = b / 2;
        const B = (m - 1) * Asc_x_top + m * Ast_x_bot;
        const C = -(m * Ast_x_bot * d + (m - 1) * Asc_x_top * d_comp);
        x = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
    } else {
        x = (-m * Ast_x_bot + Math.sqrt(Math.pow(m * Ast_x_bot, 2) + 2 * b * m * Ast_x_bot * d)) / b;
    }

    const Icr = b * x * x * x / 3
        + m * Ast_x_bot * Math.pow(d - x, 2)
        + (m - 1) * Asc_x_top * Math.pow(x - d_comp, 2);

    // ─── Effective Moment of Inertia Ieff (IS 456 Annex C, Cl. C-2) ───
    const Ms = Math.abs(M_service);
    const z = d - x / 3;
    let Ieff: number;
    if (Ms <= 0.001 || Mcr >= Ms) {
        Ieff = Igr;
    } else {
        const factor = 1.2 - (Mcr / Ms) * (z / d) * (1 - x / d);
        Ieff = factor > 0 ? Icr / factor : Igr;
        Ieff = Math.max(Icr, Math.min(Igr, Ieff));
    }

    // ─── Ieff for permanent load (Ieff_perm) ───
    const Mp = Math.abs(M_perm);
    let Ieff_perm: number;
    if (Mp <= 0.001 || Mcr >= Mp) {
        Ieff_perm = Igr;
    } else {
        const factor_p = 1.2 - (Mcr / Mp) * (z / d) * (1 - x / d);
        Ieff_perm = factor_p > 0 ? Icr / factor_p : Igr;
        Ieff_perm = Math.max(Icr, Math.min(Igr, Ieff_perm));
    }

    // ─── α coefficient (for deflection formula) ───
    let alpha: number;
    switch (supportCondition) {
        case 'simply': alpha = 5 / 48; break;
        case 'one_end': alpha = 1 / 12; break;
        case 'continuous': alpha = 1 / 16; break;
        case 'cantilever': alpha = 1 / 4; break;
        default: alpha = 1 / 16;
    }

    // ─── A. Short-term Deflection ───
    const ai = alpha * Ms * 1e6 * L * L / (Ec * Ieff);
    const ai_perm = alpha * Mp * 1e6 * L * L / (Ec * Ieff_perm);

    // ─── B. Shrinkage Deflection (IS 456 Annex C, Cl. C-3) ───
    const eps_cs = 0.0003;
    const ptPcDiff = Math.max(0, pt - pc);
    let k4: number;
    if (ptPcDiff < 1.0) {
        k4 = pt > 0 ? 0.72 * ptPcDiff / Math.sqrt(pt) : 0;
    } else {
        k4 = 0.65 * Math.sqrt(ptPcDiff);
    }
    k4 = Math.min(1.0, k4);
    const psi_cs = k4 * eps_cs / D;

    let k3: number;
    switch (supportCondition) {
        case 'cantilever': k3 = 0.500; break;
        case 'simply': k3 = 0.125; break;
        case 'one_end': k3 = 0.086; break;
        case 'continuous': k3 = 0.063; break;
        default: k3 = 0.063;
    }
    const a_shrinkage = k3 * psi_cs * L * L;

    // ─── C. Creep Deflection (IS 456 Annex C, Cl. C-4) ───
    const theta = CREEP_COEFF[ageOfLoading] ?? 1.6;
    const Ece = Ec / (1 + theta);
    const m_lt = Math.round(Es / Ece);

    let x_lt: number;
    if (Asc_x_top > 0) {
        const A = b / 2;
        const B = (m_lt - 1) * Asc_x_top + m_lt * Ast_x_bot;
        const C = -(m_lt * Ast_x_bot * d + (m_lt - 1) * Asc_x_top * d_comp);
        x_lt = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
    } else {
        x_lt = (-m_lt * Ast_x_bot + Math.sqrt(Math.pow(m_lt * Ast_x_bot, 2) + 2 * b * m_lt * Ast_x_bot * d)) / b;
    }

    const z_lt = d - x_lt / 3;
    const Icr_lt = b * x_lt * x_lt * x_lt / 3
        + m_lt * Ast_x_bot * Math.pow(d - x_lt, 2)
        + (m_lt - 1) * Asc_x_top * Math.pow(x_lt - d_comp, 2);

    let Ieff_lt: number;
    if (Mp <= 0.001 || Mcr >= Mp) {
        Ieff_lt = Igr;
    } else {
        const factor_lt = 1.2 - (Mcr / Mp) * (z_lt / d) * (1 - x_lt / d);
        Ieff_lt = factor_lt > 0 ? Icr_lt / factor_lt : Igr;
        Ieff_lt = Math.max(Icr_lt, Math.min(Igr, Ieff_lt));
    }

    const a1_perm = alpha * Mp * 1e6 * L * L / (Ece * Ieff_lt);
    const a_creep = a1_perm - ai_perm;

    // ─── Total Deflections ───
    const a_total_raw = ai + Math.max(0, a_creep) + a_shrinkage;
    const a_post_raw = Math.max(0, a_creep) + a_shrinkage;

    // Apply camber offset
    const a_total = Math.max(0, a_total_raw - camber);
    const a_post_construction = Math.max(0, a_post_raw - camber);

    // ─── Limits ───
    const limit_total = L / 250;
    const limit_post = Math.min(L / 350, 20);

    return {
        L, D, d, b, Ec, Es, m, m_lt, theta, Ece,
        pt: Math.round(pt * 1000) / 1000,
        pc: Math.round(pc * 1000) / 1000,
        Igr, Icr, Ieff, Ieff_perm, Icr_lt, Ieff_lt,
        x: Math.round(x * 100) / 100,
        x_lt: Math.round(x_lt * 100) / 100,
        z: Math.round(z * 100) / 100,
        z_lt: Math.round(z_lt * 100) / 100,
        Mcr: Math.round(Mcr * 100) / 100,
        fcr,
        alpha,
        k3,
        eps_cs,
        psi_cs: Math.round(psi_cs * 1e6) / 1e6,
        ai: Math.round(ai * 100) / 100,
        ai_perm: Math.round(ai_perm * 100) / 100,
        a1_perm: Math.round(a1_perm * 100) / 100,
        a_shrinkage: Math.round(a_shrinkage * 100) / 100,
        a_creep: Math.round(Math.max(0, a_creep) * 100) / 100,
        a_total: Math.round(a_total * 100) / 100,
        a_post_construction: Math.round(a_post_construction * 100) / 100,
        limit_total: Math.round(limit_total * 100) / 100,
        limit_post: Math.round(limit_post * 100) / 100,
        status_total: a_total <= limit_total ? 'OK' : 'FAIL',
        status_post: a_post_construction <= limit_post ? 'OK' : 'FAIL',
        supportCondition,
        camber: Math.round(camber * 100) / 100,
    };
}

// ═══════════════════════════════════════════════════════════════
//  SHEAR CHECK — IS 456 Cl. 40
// ═══════════════════════════════════════════════════════════════
interface ShearConfig {
    Lx: number;
    Ly: number;
    D: number;
    cover: number;
    fck: number;
    loadFactor?: number;
}

interface ShearDesign {
    wTotal: number;
    barDia_x_bot: number;
    Ast_x_bot: number;
    Ast_y_bot: number;
    grade: string;
}

function shearCheck(config: ShearConfig, design: ShearDesign): ShearResult {
    const { Lx, Ly, D, cover } = config;
    const { wTotal, barDia_x_bot, Ast_x_bot, Ast_y_bot, grade } = design;

    const b = 1000;
    const dx = D - cover - (barDia_x_bot || 10) / 2;
    const dy = dx - (barDia_x_bot || 10);

    const Vu_x = wTotal * (Lx / 1000) / 2;
    const Vu_y = wTotal * (Ly / 1000) / 2;

    const pt_x = 100 * Ast_x_bot / (b * dx);
    const pt_y = 100 * Ast_y_bot / (b * dy);

    const tau_v_x = (Vu_x * 1000) / (b * dx);
    const tau_v_y = (Vu_y * 1000) / (b * dy);

    const tau_c_x = getTauC(pt_x, grade);
    const tau_c_y = getTauC(pt_y, grade);
    const tau_c_max = TAU_C_MAX[grade as ConcreteGrade] ?? 2.8;

    const k = getDepthFactorK(D);

    const status_x: DesignStatus = (tau_v_x <= k * tau_c_x) ? 'OK' : (tau_v_x <= tau_c_max ? 'DESIGN' : 'FAIL');
    const status_y: DesignStatus = (tau_v_y <= k * tau_c_y) ? 'OK' : (tau_v_y <= tau_c_max ? 'DESIGN' : 'FAIL');

    return {
        shortDir: {
            Vu: Math.round(Vu_x * 100) / 100,
            tau_v: Math.round(tau_v_x * 1000) / 1000,
            tau_c: Math.round(tau_c_x * 1000) / 1000,
            k, tau_c_max,
            pt: Math.round(pt_x * 1000) / 1000,
            allowable: Math.round(k * tau_c_x * 1000) / 1000,
            status: status_x,
            d: dx,
        },
        longDir: {
            Vu: Math.round(Vu_y * 100) / 100,
            tau_v: Math.round(tau_v_y * 1000) / 1000,
            tau_c: Math.round(tau_c_y * 1000) / 1000,
            k, tau_c_max,
            pt: Math.round(pt_y * 1000) / 1000,
            allowable: Math.round(k * tau_c_y * 1000) / 1000,
            status: status_y,
            d: dy,
        },
    };
}

// ═══════════════════════════════════════════════════════════════
//  SPAN/DEPTH RATIO CHECK — IS 456 Cl. 23.2
// ═══════════════════════════════════════════════════════════════
interface SpanDepthConfig {
    Lx: number;
    D: number;
    cover: number;
    fy: number;
}

interface SpanDepthDesign {
    barDia_x_bot: number;
    Ast_x_bot: number;
    Ast_x_bot_req: number;
    supportType: SupportCondition;
}

function spanDepthCheck(config: SpanDepthConfig, design: SpanDepthDesign): SpanDepthCheck {
    const { Lx, D, cover, fy } = config;
    const { barDia_x_bot, Ast_x_bot, Ast_x_bot_req, supportType } = design;

    const d = D - cover - (barDia_x_bot || 10) / 2;
    const b = 1000;
    const pt = 100 * Ast_x_bot / (b * d);

    const fs = 0.58 * fy * (Ast_x_bot_req / Ast_x_bot);

    const basicRatio = getBasicLdRatio(supportType);
    const mf = getModificationFactor(fs, pt);
    const modifiedRatio = basicRatio * mf;
    const d_req = (Lx) / modifiedRatio;

    return {
        basicRatio,
        mf: Math.round(mf * 100) / 100,
        modifiedRatio: Math.round(modifiedRatio * 10) / 10,
        fs: Math.round(fs),
        pt: Math.round(pt * 1000) / 1000,
        d_req: Math.round(d_req * 10) / 10,
        d_provided: d,
        status: d >= d_req ? 'OK' : 'FAIL',
        note: 'informational — Annex C deflection result governs',
    };
}

// ═══════════════════════════════════════════════════════════════
//  DETERMINE SLAB TYPE
// ═══════════════════════════════════════════════════════════════
function getSlabType(Lx: number, Ly: number, slabType: SlabType | null): SlabType {
    // Respect explicit user selection — if they picked a type, use it.
    if (slabType === 'cantilever') return 'cantilever';
    if (slabType === 'one-way') return 'one-way';
    if (slabType === 'two-way') return 'two-way';
    // Auto-detect from Ly/Lx ratio
    const ratio = Ly / Lx;
    if (ratio > 2) return 'one-way';
    return 'two-way';
}

// ═══════════════════════════════════════════════════════════════
//  SUPPORT CONDITION for deflection
// ═══════════════════════════════════════════════════════════════
function getSupportCondForDeflection(boundaryCase: number): SupportCondition {
    switch (boundaryCase) {
        case 1: return 'continuous';
        case 2: case 3: return 'one_end';
        case 4: return 'one_end';
        case 5: case 6: return 'simply';
        case 7: case 8: return 'simply';
        case 9: return 'simply';
        default: return 'continuous';
    }
}

// ═══════════════════════════════════════════════════════════════
//  MAIN ANALYSIS — single panel
// ═══════════════════════════════════════════════════════════════
export function analyzeSlab(config: SlabConfig): SlabAnalysisResult {
    const {
        D, cover = 20,
        fck = 25, fy = 500, grade = 'M25', steelGrade = 'Fe500',
        DL = 0, LL = 3, SDL = 1.5,
        loadFactor = 1.5,
        boundaryCase = 1,
        supportCondition: explicitSupportCond,
        slabType = 'auto',
        ageOfLoading = '28',
    } = config;

    // ── Resolve span lengths based on slab type ─────────────────────────────
    // Cantilever uses a single `L` field; two-way and one-way use Lx/Ly. If
    // a cantilever config omits `L`, fall back to `Lx` for backwards compat.
    const isCantileverInput = slabType === 'cantilever';
    const Lx_m = isCantileverInput && config.L !== undefined ? config.L : config.Lx;
    const Ly_m = isCantileverInput && config.L !== undefined ? config.L : (config.Ly ?? config.Lx);

    const Lx = Lx_m * 1000; // mm
    const Ly = Ly_m * 1000;
    const b = 1000; // mm unit strip

    // Self-weight
    const selfWeight = D / 1000 * 25;
    const totalDL = selfWeight + SDL + DL;
    const totalService = totalDL + LL;
    const wFactored = totalService * loadFactor;

    const actualSlabType = getSlabType(Lx, Ly, slabType === 'auto' ? null : slabType);

    let Mx_pos: number, My_pos: number, Mx_neg: number, My_neg: number;
    let ax_pos: number | null, ay_pos: number | null, ax_neg: number | null, ay_neg: number | null;
    const lyLx = Ly / Lx;

    if (actualSlabType === 'cantilever') {
        Mx_pos = 0;
        My_pos = 0;
        Mx_neg = wFactored * Math.pow(Lx_m, 2) / 2;
        My_neg = 0;
        ax_pos = 0; ay_pos = 0; ax_neg = 0.5; ay_neg = 0;
    } else if (actualSlabType === 'one-way') {
        // One-way slab: use explicit supportCondition if provided, otherwise
        // derive from boundaryCase (backwards compat).
        const supportCond = explicitSupportCond ?? getSupportCondForDeflection(boundaryCase);
        if (supportCond === 'continuous') {
            Mx_pos = wFactored * Math.pow(Lx_m, 2) / 12;
            Mx_neg = wFactored * Math.pow(Lx_m, 2) / 10;
        } else if (supportCond === 'one_end') {
            Mx_pos = wFactored * Math.pow(Lx_m, 2) / 10;
            Mx_neg = wFactored * Math.pow(Lx_m, 2) / 10;
        } else {
            Mx_pos = wFactored * Math.pow(Lx_m, 2) / 8;
            Mx_neg = 0;
        }
        My_pos = 0;
        My_neg = 0;
        ax_pos = Mx_pos / (wFactored * Math.pow(Lx_m, 2) + 0.001);
        ay_pos = 0; ax_neg = Mx_neg / (wFactored * Math.pow(Lx_m, 2) + 0.001); ay_neg = 0;
    } else {
        // Two-way restrained slab — IS 456 Table 26
        ax_pos = interpolateCoeff(boundaryCase, lyLx, TABLE_26_AX_POS as unknown as ReadonlyArray<ReadonlyArray<number | null>>) ?? 0;
        ay_pos = TABLE_26_AY_POS[boundaryCase - 1] ?? 0;
        ax_neg = interpolateCoeff(boundaryCase, lyLx, TABLE_26_AX_NEG);
        ay_neg = TABLE_26_AY_NEG[boundaryCase - 1];

        Mx_pos = ax_pos * wFactored * Math.pow(Lx_m, 2);
        My_pos = ay_pos * wFactored * Math.pow(Lx_m, 2);
        Mx_neg = ax_neg !== null ? ax_neg * wFactored * Math.pow(Lx_m, 2) : 0;
        My_neg = ay_neg !== null ? ay_neg * wFactored * Math.pow(Lx_m, 2) : 0;
    }

    const barDia = 10;
    const dx = D - cover - barDia / 2;
    const dy = D - cover - barDia - barDia / 2;

    const flex_x_bot = flexuralDesign(Mx_pos, b, dx, fck, fy, D);
    const flex_y_bot = flexuralDesign(My_pos, b, dy, fck, fy, D);
    const flex_x_top = flexuralDesign(Mx_neg, b, dx, fck, fy, D);
    const flex_y_top = flexuralDesign(My_neg, b, dy, fck, fy, D);

    const bars_x_bot = selectBars(flex_x_bot.Ast_req);
    const bars_y_bot = selectBars(flex_y_bot.Ast_req);
    const bars_x_top = selectBars(flex_x_top.Ast_req);
    const bars_y_top = selectBars(flex_y_top.Ast_req);

    const dx_actual = D - cover - bars_x_bot.dia / 2;
    const dy_actual = D - cover - bars_x_bot.dia - bars_y_bot.dia / 2;

    // Resolve the effective support condition for span/depth + deflection checks.
    // Priority: explicit supportCondition (one-way) > cantilever > derived from boundaryCase.
    const effectiveSupportCond: SupportCondition = actualSlabType === 'cantilever' ? 'cantilever' :
        explicitSupportCond ?? getSupportCondForDeflection(boundaryCase);
    const supportType: SupportCondition = effectiveSupportCond === 'one_end' ? 'one_end' :
        effectiveSupportCond === 'continuous' ? 'continuous' :
        effectiveSupportCond === 'cantilever' ? 'cantilever' : 'simply';
    const ldCheck = spanDepthCheck(
        { Lx, D, cover, fy },
        {
            barDia_x_bot: bars_x_bot.dia,
            Ast_x_bot: bars_x_bot.Ast_provided,
            Ast_x_bot_req: flex_x_bot.Ast_req,
            supportType,
        },
    );

    const isCantilever = actualSlabType === 'cantilever';
    const aGoverning = (isCantilever ? ax_neg : ax_pos) ?? 0;
    const Mx_governing = isCantilever ? Mx_neg : Mx_pos;
    const totalServiceMoment = aGoverning * totalService * Math.pow(Lx_m, 2);
    const permMoment = aGoverning * totalDL * Math.pow(Lx_m, 2);

    const bars_tension = isCantilever ? bars_x_top : bars_x_bot;
    const bars_compression: BarSelection | null = isCantilever ? bars_x_bot : null;

    const supportCondDefl: SupportCondition = effectiveSupportCond;

    const deflection = annexCDeflection(
        { Lx, D, cover, fck, fy, ageOfLoading, camber: config.camber || 0 },
        {
            barDia_x_bot: bars_tension.dia,
            Ast_x_bot: bars_tension.Ast_provided,
            Asc_x_top: bars_compression ? bars_compression.Ast_provided : 0,
            M_service: totalServiceMoment || Mx_governing / loadFactor,
            M_perm: permMoment || (totalDL / totalService) * Mx_governing / loadFactor,
            supportCondition: supportCondDefl,
        },
    );

    const shear = shearCheck(
        { Lx, Ly, D, cover, fck, loadFactor },
        {
            wTotal: wFactored,
            barDia_x_bot: bars_x_bot.dia,
            Ast_x_bot: bars_x_bot.Ast_provided,
            Ast_y_bot: bars_y_bot.Ast_provided,
            grade,
        },
    );

    const steelStatus: DesignStatus = [flex_x_bot, flex_y_bot, flex_x_top, flex_y_top].every(f => !f.isDoubly) ? 'SAFE' : 'REVISE';
    const deflStatus: 'OK' | 'FAIL' = deflection.status_total === 'OK' && deflection.status_post === 'OK' ? 'OK' : 'FAIL';
    const shearStatus: 'OK' | 'FAIL' = shear.shortDir.status === 'OK' && shear.longDir.status === 'OK' ? 'OK' : 'FAIL';

    return {
        Lx: Lx_m, Ly: Ly_m, D, cover, fck, fy, grade, steelGrade,
        DL, LL, SDL, selfWeight: Math.round(selfWeight * 100) / 100,
        totalDL: Math.round(totalDL * 100) / 100,
        totalService: Math.round(totalService * 100) / 100,
        wFactored: Math.round(wFactored * 100) / 100,
        loadFactor,
        boundaryCase,
        supportCondition: effectiveSupportCond,
        slabType: actualSlabType,
        lyLx: Math.round(lyLx * 100) / 100,
        ageOfLoading,

        ax_pos: ax_pos !== null ? Math.round(ax_pos * 10000) / 10000 : null,
        ay_pos: ay_pos !== null ? Math.round(ay_pos * 10000) / 10000 : null,
        ax_neg: ax_neg !== null ? Math.round(ax_neg * 10000) / 10000 : null,
        ay_neg: ay_neg !== null ? Math.round(ay_neg * 10000) / 10000 : null,

        Mx_pos: Math.round((Mx_pos || 0) * 100) / 100,
        My_pos: Math.round((My_pos || 0) * 100) / 100,
        Mx_neg: Math.round((Mx_neg || 0) * 100) / 100,
        My_neg: Math.round((My_neg || 0) * 100) / 100,

        dx: dx_actual, dy: dy_actual,

        flex_x_bot, flex_y_bot, flex_x_top, flex_y_top,
        bars_x_bot, bars_y_bot, bars_x_top, bars_y_top,
        ldCheck,
        deflection,
        shear,

        steelStatus,
        deflStatus,
        shearStatus,
        overallStatus: steelStatus === 'SAFE' && deflStatus === 'OK' && shearStatus === 'OK' ? 'SAFE' : 'REVISE',
    };
}

// ═══════════════════════════════════════════════════════════════
//  MULTI-PANEL ANALYSIS
// ═══════════════════════════════════════════════════════════════
export function analyzeSlabs(panels: SlabConfig[]): MultiPanelResult[] {
    return panels.map((panel, idx) => ({
        panelId: idx + 1,
        label: panel.label || `S${idx + 1}`,
        ...analyzeSlab(panel),
    }));
}

// ═══════════════════════════════════════════════════════════════
//  BOUNDARY CASE DESCRIPTIONS
// ═══════════════════════════════════════════════════════════════
export interface BoundaryCase {
    case: number;
    label: string;
    desc: string;
}

export const BOUNDARY_CASES: readonly BoundaryCase[] = [
    { case: 1, label: 'Interior Panel', desc: 'All four edges continuous' },
    { case: 2, label: 'One Short Edge Disc.', desc: 'One short edge discontinuous' },
    { case: 3, label: 'One Long Edge Disc.', desc: 'One long edge discontinuous' },
    { case: 4, label: 'Two Adjacent Edges Disc.', desc: 'Two adjacent edges discontinuous' },
    { case: 5, label: 'Two Short Edges Disc.', desc: 'Two short edges discontinuous' },
    { case: 6, label: 'Two Long Edges Disc.', desc: 'Two long edges discontinuous' },
    { case: 7, label: 'Three Edges Disc. (1 Long Cont.)', desc: 'Three edges disc., one long edge continuous' },
    { case: 8, label: 'Three Edges Disc. (1 Short Cont.)', desc: 'Three edges disc., one short edge continuous' },
    { case: 9, label: 'Four Edges Disc. (SS)', desc: 'All four edges discontinuous (simply supported)' },
];

export interface SlabTypeOption {
    value: SlabTypeInput;
    label: string;
}

export const SLAB_TYPES: readonly SlabTypeOption[] = [
    { value: 'auto', label: 'Auto (detect from Ly/Lx)' },
    { value: 'two-way', label: 'Two-Way Restrained' },
    { value: 'one-way', label: 'One-Way' },
    { value: 'cantilever', label: 'Cantilever' },
];

export interface SupportConditionOption {
    value: SupportCondition;
    label: string;
    desc: string;
}

/** Support conditions for one-way slabs (IS 456 Cl. 23.2.1). */
export const SUPPORT_CONDITIONS: readonly SupportConditionOption[] = [
    { value: 'simply', label: 'Simply Supported', desc: 'Both ends simply supported — M = wL²/8' },
    { value: 'one_end', label: 'One-End Continuous', desc: 'One end continuous, one simply supported — M+ = wL²/10, M- = wL²/10' },
    { value: 'continuous', label: 'Both Ends Continuous', desc: 'Both ends continuous — M+ = wL²/12, M- = wL²/10' },
];

// ═══════════════════════════════════════════════════════════════
//  OPTIMIZER
// ═══════════════════════════════════════════════════════════════
export interface OptimumSlabDesign {
    thickness: number;
    costIndex: number;
    result: SlabAnalysisResult;
}

export interface SlabOptimizeResult {
    totalTrials: number;
    feasibleCount: number;
    topDesigns: OptimumSlabDesign[];
    optimum: OptimumSlabDesign | null;
    costRatioUsed: number;
}

export type SlabProgressCallback = (done: number, total: number, feasible: number) => void;

/**
 * Optimize slab thickness by sweeping a range of thicknesses and finding the
 * minimum one that satisfies all design criteria.
 */
export function optimizeSlab(config: SlabConfig, thicknesses: number[], costRatio: number = 90, onProgress?: SlabProgressCallback): SlabOptimizeResult {
    const results: OptimumSlabDesign[] = [];
    let done = 0;
    const total = thicknesses.length;

    for (const D of thicknesses) {
        done++;
        try {
            const trialConfig = { ...config, D };
            const result = analyzeSlab(trialConfig);

            if (result.overallStatus === 'SAFE') {
                const concreteVol = (D / 1000) * result.Lx * result.Ly;
                const steelWeight = ((result.bars_x_bot.Ast_provided + result.bars_x_top.Ast_provided + 
                                      result.bars_y_bot.Ast_provided + result.bars_y_top.Ast_provided) * 
                                     result.Lx * result.Ly * 7850) / 1e6;
                const costIndex = computeCostIndex(concreteVol, steelWeight, costRatio);
                results.push({
                    thickness: D,
                    costIndex,
                    result,
                });
            }
        } catch (e) {
            // skip invalid thickness
        }

        if (onProgress && (done % 5 === 0 || done === total)) {
            onProgress(done, total, results.length);
        }
    }

    // Sort by cost index ascending
    results.sort((a, b) => a.costIndex - b.costIndex);

    return {
        totalTrials: total,
        feasibleCount: results.length,
        topDesigns: results.slice(0, 5),
        optimum: results.length > 0 ? results[0] : null,
        costRatioUsed: costRatio,
    };
}
