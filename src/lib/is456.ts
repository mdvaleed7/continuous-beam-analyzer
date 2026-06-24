/**
 * Shared IS 456:2000 design-code constants and formulas.
 *
 * Previously duplicated across `wallEngine.js` and `slabEngine.js` with
 * slightly different parameter signatures (e.g. `getTauC(pt_percent, fck)`
 * vs `getTauC(pt, grade)`). This module is the single source of truth.
 *
 * Cross-references:
 *   - IS 456:2000 Cl. 26.5.2.1 (minimum reinforcement)
 *   - IS 456:2000 Cl. 26.5.1.1 (maximum reinforcement = 4% of gross area)
 *   - IS 456:2000 Cl. 38.1 (flexural design)
 *   - IS 456:2000 Cl. 40 (shear design)
 *   - IS 456:2000 Table 19 (design shear strength of concrete, τc)
 *   - IS 456:2000 Table 20 (maximum shear stress, τc,max)
 *   - IS 456:2000 Table 21 (creep coefficient)
 */

// ─── Concrete grade ─────────────────────────────────────────────────────────
export type ConcreteGrade = 'M15' | 'M20' | 'M25' | 'M30' | 'M35' | 'M40';

// ─── Steel grade ────────────────────────────────────────────────────────────
export type SteelGrade = 'Fe250' | 'Fe415' | 'Fe500' | 'Fe550';

// ─── Table 20 — Maximum shear stress τc,max (N/mm²) ─────────────────────────
export const TAU_C_MAX: Record<ConcreteGrade, number> = {
    M15: 2.5, M20: 2.8, M25: 3.1, M30: 3.5, M35: 3.7, M40: 4.0,
};

// ─── Limiting moment coefficient Mu,lim = coeff × fck × b × d² ──────────────
//     (IS 456 Cl. 38.1, for singly-reinforced rectangular sections)
export const MU_LIM_COEFF: Record<SteelGrade, number> = {
    Fe250: 0.149, Fe415: 0.138, Fe500: 0.133, Fe550: 0.129,
};

// ─── Minimum steel ratio Ast_min / (b × t) ─────────────────────────────────
//     IS 456 Cl. 26.5.2.1: 0.12% for Fe415/Fe500/Fe550, 0.15% for Fe250
//     (total cross-section, split per face)
export const MIN_STEEL_RATIO: Record<SteelGrade, number> = {
    Fe250: 0.0015, Fe415: 0.0012, Fe500: 0.0012, Fe550: 0.0012,
};

// ─── Maximum steel ratio Ast_max / (b × t) ─────────────────────────────────
//     IS 456 Cl. 26.5.1.1: 4% of gross cross-section
export const MAX_STEEL_RATIO = 0.04;

// ─── Creep coefficient θ (IS 456 Table 21) ────────────────────────────────
//     Keyed by age of loading in days
export const CREEP_COEFF: Record<string, number> = {
    '7': 2.2, '28': 1.6, '365': 1.1,
};

// ─── Standard bar diameters and spacings ───────────────────────────────────
export const STANDARD_BAR_DIAS: readonly number[] = [8, 10, 12, 16, 20, 25];
export const STANDARD_SPACINGS: readonly number[] = [100, 125, 150, 175, 200, 250, 300];

/**
 * Design shear strength of concrete τc (N/mm²) — exact analytical formula
 * matching IS 456 Table 19.
 *
 * Formula:
 *   β = max(0.8 · fck / (6.89 · pt), 1.0)
 *   τc = 0.85 · √(0.8 · fck) · (√(1 + 5β) − 1) / (6β)
 *
 * @param pt  - percentage of tensile steel (pt = 100·Ast/(b·d))
 * @param fckOrGrade  - either the fck number (e.g. 25) or the grade string (e.g. "M25")
 * @returns τc in N/mm²
 *
 * @example
 *   getTauC(0.25, 20)      // → 0.359  (M20, pt=0.25%, Table 19: 0.36)
 *   getTauC(1.00, 'M25')   // → 0.641  (M25, pt=1.00%, Table 19: 0.64)
 *   getTauC(3.00, 30)      // → 0.962  (M30, pt=3.00%, Table 19: 0.96)
 */
export function getTauC(pt: number, fckOrGrade: number | ConcreteGrade | string): number {
    const fck = typeof fckOrGrade === 'string'
        ? parseInt(fckOrGrade.replace('M', ''), 10)
        : fckOrGrade;
    // IS 456 Table 19 applies for pt >= 0.15
    const ptc = Math.min(Math.max(pt, 0.15), 3.0);
    const beta = Math.max((0.8 * fck) / (6.89 * ptc), 1.0);
    return (0.85 * Math.sqrt(0.8 * fck) * (Math.sqrt(1 + 5 * beta) - 1)) / (6 * beta);
}

/**
 * Maximum shear stress τc,max for a concrete grade.
 *
 * @param grade  - e.g. "M25"
 * @returns τc,max in N/mm²
 */
export function getTauCMax(grade: string): number {
    return TAU_C_MAX[grade as ConcreteGrade] ?? 2.8;
}

/**
 * Limiting moment coefficient for a steel grade.
 *
 * @param fyOrGrade  - either the fy number (e.g. 500) or the steel grade string (e.g. "Fe500")
 * @returns coefficient (Mu,lim = coeff × fck × b × d²)
 */
export function getMuLimCoeff(fyOrGrade: number | string): number {
    if (typeof fyOrGrade === 'string') {
        return MU_LIM_COEFF[fyOrGrade as SteelGrade] ?? 0.138;
    }
    return MU_LIM_COEFF[`Fe${fyOrGrade}` as SteelGrade] ?? 0.138;
}

/**
 * Minimum steel ratio for a steel grade.
 *
 * @param fyOrGrade  - either the fy number (e.g. 500) or the steel grade string (e.g. "Fe500")
 * @returns Ast_min / (b × t) ratio
 */
export function getMinSteelRatio(fyOrGrade: number | string): number {
    if (typeof fyOrGrade === 'string') {
        return MIN_STEEL_RATIO[fyOrGrade as SteelGrade] ?? 0.0012;
    }
    return MIN_STEEL_RATIO[`Fe${fyOrGrade}` as SteelGrade] ?? 0.0012;
}

/**
 * Young's modulus of concrete per IS 456 Cl. 6.2.3.1: Ec = 5000 · √fck (MPa)
 *
 * @param fck  - characteristic compressive strength (MPa)
 * @returns Ec in MPa
 */
export function getEc(fck: number): number {
    return 5000 * Math.sqrt(fck);
}

// ─── Shared types ──────────────────────────────────────────────────────────

export type Governs = 'design' | 'minimum' | 'maximum';
export type ShearStatus = 'minimum' | 'design' | 'FAIL';

export interface FlexuralResult {
    Ast_req: number;
    Ast_min?: number;
    Ast_max?: number;
    Mu_lim: number;
    Mu_applied?: number;
    isDoubly: boolean;
    governs: Governs;
    utilization: number;
    pt?: number;
    status?: string;
}

export interface BarResult {
    dia: number;
    spacing: number;
    Ast_provided: number;
    label: string;
    nBars?: number;
}

export interface ShearLinkResult {
    dia: number;
    spacing: number;
    label: string;
    Asv_sv_provided: number;
}

export interface ShearResult {
    tau_v: number;
    tau_c: number;
    tau_c_max: number;
    pt: number;
    status: ShearStatus;
    Asv_sv: number | null;
    links: ShearLinkResult | null;
    Vu_applied: number;
}

// ─── Flexural design — IS 456 Cl. 38.1 ────────────────────────────────────
// Single source of truth for singly-reinforced rectangular section design.
// The wall, slab, and footing engines all call this instead of their own copy.
//
// @param Mu_kNm   - factored bending moment (kN·m)
// @param b_mm     - width of section (mm), typically 1000 for 1m strip
// @param d_mm     - effective depth (mm)
// @param fck      - characteristic compressive strength of concrete (MPa)
// @param fy       - yield strength of steel (MPa)
// @param D_mm     - optional gross thickness (mm); used for min/max steel calc.
//                   If omitted, defaults to d_mm + 50 for footings or d_mm + 25 for slabs.
// @param splitFace - if true, min steel is halved (wall: each face gets half)

export function flexuralDesign(
    Mu_kNm: number, b_mm: number, d_mm: number,
    fck: number, fy: number,
    D_mm?: number, splitFace: boolean = false,
): FlexuralResult {
    const Mu = Math.abs(Mu_kNm) * 1e6;
    const coeff = MU_LIM_COEFF[`Fe${fy}` as SteelGrade] ?? 0.138;
    const Mu_lim = coeff * fck * b_mm * d_mm * d_mm;
    const t_mm = D_mm || (d_mm + 50);
    const minR = MIN_STEEL_RATIO[`Fe${fy}` as SteelGrade] ?? 0.0012;
    const Ast_min_total = minR * b_mm * t_mm;
    const Ast_min = splitFace ? Ast_min_total / 2 : Ast_min_total;
    const Ast_max = MAX_STEEL_RATIO * b_mm * t_mm;

    if (Mu <= 0.001) {
        return {
            Ast_req: Math.ceil(Ast_min), Ast_min: Math.ceil(Ast_min), Ast_max: Math.floor(Ast_max),
            Mu_lim: Mu_lim / 1e6, Mu_applied: 0, isDoubly: false, governs: 'minimum', utilization: 0,
        };
    }

    const isDoubly = Mu > Mu_lim;
    const ratio = 4.6 * Mu / (fck * b_mm * d_mm * d_mm);
    const sqrtTerm = Math.sqrt(Math.max(0, 1 - ratio));
    let Ast_req = (0.5 * fck / fy) * (1 - sqrtTerm) * b_mm * d_mm;

    let governs: Governs = 'design';
    if (Ast_req < Ast_min) { Ast_req = Ast_min; governs = 'minimum'; }
    else if (Ast_req > Ast_max) { Ast_req = Ast_max; governs = 'maximum'; }

    const pt = 100 * Ast_req / (b_mm * d_mm);
    return {
        Ast_req: Math.ceil(Ast_req), Ast_min: Math.ceil(Ast_min), Ast_max: Math.floor(Ast_max),
        Mu_lim: Mu_lim / 1e6, Mu_applied: Math.abs(Mu_kNm), isDoubly, governs,
        utilization: Mu / Mu_lim, pt: Math.round(pt * 1000) / 1000,
        status: isDoubly ? 'REVISE' : 'SAFE',
    };
}

// ─── Bar selection for 1m strip ────────────────────────────────────────────

export function selectBars(
    Ast_req: number,
    barDias: readonly number[] = STANDARD_BAR_DIAS,
    spacings: readonly number[] = STANDARD_SPACINGS,
    b: number = 1000,
): BarResult {
    let best: BarResult | null = null;
    for (const dia of barDias) {
        const Abar = Math.PI * dia * dia / 4;
        for (const sp of spacings) {
            const Ast = Abar * (b / sp);
            if (Ast >= Ast_req && (!best || Ast < best.Ast_provided)) {
                best = { dia, spacing: sp, Ast_provided: Math.round(Ast), label: `${dia}mm @ ${sp} c/c`, nBars: Math.floor(b / sp) };
            }
        }
    }
    if (!best) {
        const dia = barDias[barDias.length - 1], sp = spacings[0];
        const Ast = (Math.PI * dia * dia / 4) * (b / sp);
        best = { dia, spacing: sp, Ast_provided: Math.round(Ast), label: `${dia}mm @ ${sp} c/c`, nBars: Math.floor(b / sp) };
    }
    return best;
}

// ─── Shear link selection (2-legged stirrups) ──────────────────────────────

export function selectShearLinks(Asv_sv_req: number | null): ShearLinkResult | null {
    if (!Asv_sv_req) return null;
    const dias = [8, 10, 12];
    for (const dia of dias) {
        const Asv = 2 * Math.PI * dia * dia / 4;
        for (const sp of STANDARD_SPACINGS) {
            const prov = Asv / sp;
            if (prov >= Asv_sv_req) {
                return { dia, spacing: sp, label: `${dia}mm 2-legged @ ${sp} c/c`, Asv_sv_provided: Math.round(prov * 100) / 100 };
            }
        }
    }
    const Asv = 2 * Math.PI * 144 / 4;
    return { dia: 12, spacing: 100, label: `12mm 2-legged @ 100 c/c`, Asv_sv_provided: Math.round((Asv / 100) * 100) / 100 };
}

// ─── Shear design — IS 456 Cl. 40 ─────────────────────────────────────────

export function shearDesign(
    Vu_kN: number, b_mm: number, d_mm: number,
    Ast_mm2: number, fck: number, fy: number, grade: string,
): ShearResult {
    const Vu = Math.abs(Vu_kN) * 1e3;
    const tau_v = Vu / (b_mm * d_mm);
    const pt = 100 * Ast_mm2 / (b_mm * d_mm);
    const tau_c = getTauC(pt, fck);
    const tau_c_max = TAU_C_MAX[grade as ConcreteGrade] ?? 2.8;

    let status: ShearStatus, Asv_sv: number | null;
    if (tau_v <= tau_c) {
        status = 'minimum';
        Asv_sv = (0.4 * b_mm) / (0.87 * fy);
    } else if (tau_v <= tau_c_max) {
        status = 'design';
        Asv_sv = (Vu - tau_c * b_mm * d_mm) / (0.87 * fy * d_mm);
    } else {
        status = 'FAIL';
        Asv_sv = null;
    }

    return {
        tau_v: Math.round(tau_v * 1000) / 1000,
        tau_c: Math.round(tau_c * 1000) / 1000,
        tau_c_max, pt: Math.round(pt * 1000) / 1000,
        status, Asv_sv: Asv_sv !== null ? Math.round(Asv_sv * 100) / 100 : null,
        links: selectShearLinks(Asv_sv), Vu_applied: Math.abs(Vu_kN),
    };
}

// ─── Economic cost index ───────────────────────────────────────────────────
// ponytail: was economicOptimization.ts — one line covers it
export const computeCostIndex = (vol: number, steel: number, r = 90) => vol + steel * (r / 7850);
