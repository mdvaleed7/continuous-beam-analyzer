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
const MU_LIM_COEFF: Record<SteelGrade, number> = {
    Fe250: 0.149, Fe415: 0.138, Fe500: 0.133, Fe550: 0.129,
};

// ─── Minimum steel ratio Ast_min / (b × t) ─────────────────────────────────
//     IS 456 Cl. 26.5.2.1: 0.12% for Fe415/Fe500/Fe550, 0.15% for Fe250
//     (total cross-section, split per face)
const MIN_STEEL_RATIO: Record<SteelGrade, number> = {
    Fe250: 0.0015, Fe415: 0.0012, Fe500: 0.0012, Fe550: 0.0012,
};

// ─── Maximum steel ratio Ast_max / (b × t) ─────────────────────────────────
//     IS 456 Cl. 26.5.1.1: 4% of gross cross-section
const MAX_STEEL_RATIO = 0.04;

// ─── Minimum wall thickness (IS 456 Cl. 32.2.3) ────────────────────────────
//     Absolute minimum thickness for RC walls = 150 mm.
//     For load-bearing walls the effective-height/thickness ratio (slenderness)
//     must also be checked, but 150 mm is the unconditional code floor.
export const WALL_MIN_THICKNESS = 150;

// ─── Creep coefficient θ (IS 456 Table 21) ────────────────────────────────
//     Keyed by age of loading in days
export const CREEP_COEFF: Record<string, number> = {
    '7': 2.2, '28': 1.6, '365': 1.1,
};

// ─── Standard bar diameters and spacings ───────────────────────────────────
const STANDARD_BAR_DIAS: readonly number[] = [8, 10, 12, 16, 20, 25];
const STANDARD_SPACINGS: readonly number[] = [100, 125, 150, 175, 200, 250, 300];

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
function getEc(fck: number): number {
    return 5000 * Math.sqrt(fck);
}

/**
 * Modular ratio for transformed-section calculations.
 *
 * Modified to equal Es / Ec for deflection calculation in all slabs and elsewhere.
 */
function getAnnexCModularRatio(fck: number, Es: number = 200000): number {
    return Es / getEc(fck);
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
    Asc_req?: number;
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
    let Ast_req = 0;
    let Asc_req = 0;

    if (!isDoubly) {
        const ratio = 4.6 * Mu / (fck * b_mm * d_mm * d_mm);
        const sqrtTerm = Math.sqrt(Math.max(0, 1 - ratio));
        Ast_req = (0.5 * fck / fy) * (1 - sqrtTerm) * b_mm * d_mm;
    } else {
        const ratio_lim = 4.6 * Mu_lim / (fck * b_mm * d_mm * d_mm);
        const sqrtTerm_lim = Math.sqrt(Math.max(0, 1 - ratio_lim));
        const Ast1 = (0.5 * fck / fy) * (1 - sqrtTerm_lim) * b_mm * d_mm;

        const Mu2 = Mu - Mu_lim;
        const d_prime = 50;
        const fsc = 0.87 * fy;
        const Ast2 = Mu2 / (0.87 * fy * (d_mm - d_prime));
        Asc_req = Mu2 / (fsc * (d_mm - d_prime));
        Ast_req = Ast1 + Ast2;
    }

    let governs: Governs = 'design';
    if (Ast_req < Ast_min) { Ast_req = Ast_min; governs = 'minimum'; }
    else if (Ast_req > Ast_max) { Ast_req = Ast_max; governs = 'maximum'; }

    const pt = 100 * Ast_req / (b_mm * d_mm);
    return {
        Ast_req: Math.ceil(Ast_req), Ast_min: Math.ceil(Ast_min), Ast_max: Math.floor(Ast_max),
        Mu_lim: Mu_lim / 1e6, Mu_applied: Math.abs(Mu_kNm), isDoubly, governs,
        utilization: Mu / Mu_lim, pt: Math.round(pt * 1000) / 1000,
        status: isDoubly ? 'REVISE' : 'SAFE',
        Asc_req: isDoubly ? Math.ceil(Asc_req) : 0,
    };
}
// ─── Required effective depth from B.M. consideration — IS 456 Cl. 38.1 ────
//
//  For a singly-reinforced rectangular section, the limiting moment is:
//    Mu,lim = R · b · d²        where R = coeff × fck
//
//  Re-arranging for d:
//    d = √(M / (R · b))         (M in N·mm, b in mm → d in mm)
//
//  This is the MINIMUM effective depth needed to keep the section singly
//  reinforced (Mu ≤ Mu,lim). It is the standard textbook check for walls,
//  slabs, footings, and any flexural member.
//
//  Reference: IS 456:2000 Cl. 38.1, SP-16 Table 2
//
//  @param Mu_kNm  - factored bending moment (kN·m) or (kN·m/m for unit strip)
//  @param fck     - characteristic compressive strength (MPa)
//  @param fy      - yield strength of steel (MPa) — determines the R coefficient
//  @param b_mm    - width of section (mm), typically 1000 for 1m strip
//  @returns       - required effective depth d in mm

export interface RequiredDepthResult {
    /** Factored moment used (kN·m) */
    Mu: number;
    /** Moment of resistance factor R = coeff × fck (N/mm²) */
    R: number;
    /** Mu,lim coefficient for the steel grade */
    coeff: number;
    /** Required effective depth from BM (mm) */
    d_req: number;
}

export function computeRequiredDepthForBM(
    Mu_kNm: number, fck: number, fy: number, b_mm: number = 1000,
): RequiredDepthResult {
    // IS 456 Cl. 38.1: Mu,lim = coeff × fck × b × d²
    // ⟹ R = coeff × fck
    // ⟹ d = √(M / (R × b))   where M is in N·mm, b in mm
    const coeff = MU_LIM_COEFF[`Fe${fy}` as SteelGrade] ?? 0.138;
    const R = coeff * fck;                             // N/mm²
    const Mu_Nmm = Math.abs(Mu_kNm) * 1e6;           // kN·m → N·mm
    const d_req = Mu_Nmm > 0
        ? Math.sqrt(Mu_Nmm / (R * b_mm))             // mm
        : 0;
    return {
        Mu: Math.abs(Mu_kNm),
        R: Math.round(R * 10000) / 10000,
        coeff,
        d_req: Math.round(d_req * 100) / 100,         // 0.01 mm precision
    };
}

// ─── Bar selection for 1m strip ────────────────────────────────────────────

export function selectBars(
    Ast_req: number,
    barDias: readonly number[] = STANDARD_BAR_DIAS,
    spacings: readonly number[] = STANDARD_SPACINGS,
    b: number = 1000,
    d_eff_mm?: number,
    isDistribution?: boolean,
): BarResult {
    const maxSpacing = d_eff_mm
        ? (isDistribution
            ? Math.min(5 * d_eff_mm, 450)
            : Math.min(3 * d_eff_mm, 300))
        : (isDistribution ? 450 : 300);

    let best: BarResult | null = null;
    for (const dia of barDias) {
        const Abar = Math.PI * dia * dia / 4;
        for (const sp of spacings.filter(s => s <= maxSpacing)) {
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
export interface CostParameters {
    concreteCost_per_m3?: number;   // ₹/m³   default 6500
    steelCost_per_kg?: number;   // ₹/kg   default 82
    formworkCost_per_m2?: number;   // ₹/m²   default 350
    wastage_factor?: number;   // ratio  default 1.07
}

export function computeCost(
    concreteVol_m3: number,
    steelWeight_kg: number,
    slabArea_m2: number,
    p: CostParameters = {},
): number {
    const Cc = p.concreteCost_per_m3 ?? 6500;
    const Cs = p.steelCost_per_kg ?? 82;
    const Cf = p.formworkCost_per_m2 ?? 350;
    const fw = p.wastage_factor ?? 1.07;
    return Cc * concreteVol_m3 + Cs * steelWeight_kg * fw + Cf * slabArea_m2;
}

// Backward-compat shim — keeps existing calls working
export const computeCostIndex =
    (vol: number, steel: number, r = 90): number =>
        computeCost(vol, steel, 0, { steelCost_per_kg: r, concreteCost_per_m3: 6500 });

// ═══════════════════════════════════════════════════════════════
//  ANNEX C DEFLECTION CHECK — IS 456:2000 Annex C
//  Extracted from slabEngine.ts so the cantilever, flat-slab, and
//  waffle-slab engines can all share the SAME detailed deflection
//  calculation (short-term + shrinkage + creep) instead of the
//  simplified L/d ratio. This is the DRY "ponytail" move — one
//  source of truth for IS 456 Annex C.
//
//  Key parameters:
//    k3 = 0.5 (cantilever), 0.125 (simply), 0.086 (one_end), 0.063 (continuous)
//    fcr = 0.7·√fck, Ece = Ec/(1+θ), Ieff via 1.2−(Mcr/Ms)(z/d)(1−x/d)
// ═══════════════════════════════════════════════════════════════

export type SupportCondition = 'cantilever' | 'simply' | 'one_end' | 'continuous';

// ═══════════════════════════════════════════════════════════════
//  SPAN/DEPTH RATIO CHECK — IS 456 Cl. 23.2 (informational)
//
//  Per the user's instruction: this simplified L/d check is computed
//  for ALL slabs (cantilever, normal, waffle, flat) "just as it is in
//  the normal slab case", but it is IGNORED for design purposes — the
//  full Annex C deflection calculation governs. The calculation is
//  surfaced so the engineer can inspect basicRatio / mf / d_req.
// ═══════════════════════════════════════════════════════════════

export interface SpanDepthCheckResult {
    basicRatio: number;      // basic l/d per IS 456 Cl. 23.2.1
    mf: number;              // modification factor (IS 456 Fig. 4)
    modifiedRatio: number;   // basicRatio × mf
    fs: number;              // service stress in steel (N/mm²)
    pt: number;              // % tension steel
    d_req: number;           // required effective depth (mm)
    d_provided: number;      // provided effective depth (mm)
    status: 'IGNORED' | 'OK' | 'FAIL';  // always 'IGNORED' — Annex C governs
    note: string;
}

export function getBasicLdRatio(supportType: SupportCondition): number {
    switch (supportType) {
        case 'cantilever': return 7;
        case 'simply': return 20;
        case 'continuous':
        case 'one_end':
        default: return 26;
    }
}

export function getModificationFactor(fs: number, ptProv: number): number {
    const pt = Math.max(0.001, ptProv); // Prevent division by zero or negative
    const mf = 1 / (0.225 + 0.00322 * fs + 0.625 * Math.log10(pt));
    return Math.max(0.1, Math.min(2.0, mf));
}

export interface SpanDepthCheckInput {
    L: number;            // span (mm)
    D: number;            // overall depth (mm)
    cover: number;        // clear cover (mm)
    fy: number;
    barDia: number;       // tension bar diameter (mm)
    AstProvided: number;  // tension steel provided (mm²)
    AstRequired: number;  // tension steel required (mm²)
    b?: number;           // width (mm) — default 1000 (1 m strip)
    supportType: SupportCondition;
}

/**
 * Compute the simplified IS 456 Cl. 23.2 span/depth ratio check.
 *
 * The status is ALWAYS 'IGNORED' because, per the project requirement, the
 * full Annex C deflection calculation governs the design. This routine is
 * purely informational — it surfaces the basic l/d, modification factor and
 * required depth so the engineer can compare against the rigorous Annex C
 * result. It is invoked for every slab type (cantilever / normal / waffle /
 * flat).
 */
export function computeSpanDepthCheck(input: SpanDepthCheckInput): SpanDepthCheckResult {
    const { L, D, cover, fy, barDia, AstProvided, AstRequired, supportType } = input;
    const b = input.b ?? 1000;
    const d = D - cover - (barDia || 10) / 2;
    const pt = 100 * AstProvided / (b * d);
    const fs = AstProvided > 0
        ? 0.58 * fy * (AstRequired / AstProvided)
        : 0.58 * fy;
    const basicRatio = getBasicLdRatio(supportType);
    const mf = getModificationFactor(fs, pt);
    const modifiedRatio = basicRatio * mf;
    const d_req = L / modifiedRatio;
    return {
        basicRatio,
        mf: Math.round(mf * 100) / 100,
        modifiedRatio: Math.round(modifiedRatio * 10) / 10,
        fs: Math.round(fs),
        pt: Math.round(pt * 1000) / 1000,
        d_req: Math.round(d_req * 10) / 10,
        d_provided: Math.round(d * 10) / 10,
        status: 'IGNORED',
        note: 'informational — Annex C deflection result governs (ignored for design)',
    };
}

export interface AnnexCConfig {
    Lx: number;              // span (mm) — the span over which deflection is computed
    D: number;               // overall thickness (mm)
    cover: number;           // clear cover (mm)
    fck: number;
    fy: number;
    Es?: number;             // default 200000 MPa
    ageOfLoading?: string;   // '7' | '28' | '365' — default '28'
}

export interface AnnexCDesign {
    barDia_x_bot: number;    // tension bar diameter (mm)
    Ast_x_bot: number;       // tension steel area (mm²/m)
    Asc_x_top?: number;      // compression steel area (mm²/m) — default 0
    // Compression-face geometry. When omitted, d' falls back to the tension
    // cover + tension-bar/2 approximation (the original behaviour, kept for
    // back-compat). Supply these for an exact d' on cantilever / continuous
    // slabs where the compression face differs in cover / bar diameter.
    barDia_comp?: number;    // compression bar diameter (mm) — used to locate d'
    cover_comp?: number;     // clear cover on the compression face (mm)
    M_service: number;       // total service moment (kN·m/m)
    M_perm: number;          // permanent (dead) service moment (kN·m/m)
    supportCondition: SupportCondition;
    camber?: number;         // explicit upward camber (mm), default 0
}

export interface DeflectionResult {
    L: number; D: number; d: number; b: number;
    Ec: number; Es: number; m: number; m_lt: number; theta: number; Ece: number;
    pt: number; pc: number;
    Igr: number; Icr: number; Ieff: number; Ieff_perm: number; Icr_lt: number; Ieff_lt: number;
    x: number; x_lt: number; z: number; z_lt: number;
    Mcr: number; fcr: number; alpha: number; k3: number; eps_cs: number; psi_cs: number;
    ai: number; ai_perm: number; a1_perm: number; a_shrinkage: number; a_creep: number;
    a_total: number; a_post_construction: number;
    limit_total: number; limit_post: number;
    status_total: 'OK' | 'FAIL'; status_post: 'OK' | 'FAIL';
    camber: number; supportCondition: SupportCondition;
}

function clampDeflectionCamber(
    camberMm: number,
    postConstructionDeflectionMm: number,
    stepMm: number = 5,
): number {
    const step = Number.isFinite(stepMm) && stepMm > 0 ? stepMm : 5;
    const requested = Number.isFinite(camberMm) ? Math.max(0, camberMm) : 0;
    const postConstruction = Number.isFinite(postConstructionDeflectionMm)
        ? Math.max(0, postConstructionDeflectionMm)
        : 0;

    if (requested <= 0 || postConstruction <= 0) return 0;

    const stepped = Math.floor(requested / step) * step;
    const maxAllowed = Math.floor(postConstruction / step) * step;

    return Math.max(0, Math.min(stepped, maxAllowed));
}

export function getRequiredDeflectionCamber(
    deflection: Pick<DeflectionResult, 'a_total' | 'a_post_construction' | 'limit_total' | 'limit_post'>,
    stepMm: number = 5,
): number {
    const step = Number.isFinite(stepMm) && stepMm > 0 ? stepMm : 5;
    const required = Math.max(
        0,
        deflection.a_total - deflection.limit_total,
        deflection.a_post_construction - deflection.limit_post,
    );
    if (required <= 0) return 0;

    const roundedRequired = Math.ceil(required / step) * step;
    return clampDeflectionCamber(roundedRequired, deflection.a_post_construction, step);
}

export function annexCDeflection(config: AnnexCConfig, design: AnnexCDesign): DeflectionResult {
    const { Lx, D, cover, fck, fy, Es = 200000, ageOfLoading = '28' } = config;
    const {
        barDia_x_bot, Ast_x_bot, Asc_x_top = 0,
        barDia_comp, cover_comp,
        M_service, M_perm, supportCondition,
    } = design;

    const b = 1000; // mm, unit strip
    const d = D - cover - (barDia_x_bot || 10) / 2;
    const L = Lx; // mm

    const Ec = getEc(fck);
    const m = getAnnexCModularRatio(fck, Es);
    const pt = 100 * Ast_x_bot / (b * d);
    const pc = 100 * Asc_x_top / (b * d);

    const Igr = b * D * D * D / 12;
    const fcr = 0.7 * Math.sqrt(fck);
    const yt = D / 2;
    const Mcr = fcr * Igr / yt / 1e6;

    // d' from the compression face to centroid of compression steel.
    // If the caller supplied explicit compression-face geometry, use it;
    // otherwise fall back to the legacy approximation.
    const d_comp = (barDia_comp !== undefined || cover_comp !== undefined)
        ? ((cover_comp ?? cover) + (barDia_comp ?? barDia_x_bot ?? 10) / 2)
        : cover + (barDia_x_bot || 10) / 2;
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

    const Ms = Math.abs(M_service);
    const z = d - x / 3;
    let Ieff: number;
    if (Ms <= 0.001 || Mcr >= Ms) {
        Ieff = Igr;
    } else {
        // IS 456 Annex C Cl. C-2.1. For a rectangular slab strip, bw / b = 1.0.
        const factor = 1.2 - (Mcr / Ms) * (z / d) * (1 - x / d);
        Ieff = factor > 0 ? Icr / factor : Igr;
        Ieff = Math.max(Icr, Math.min(Igr, Ieff));
    }

    const Mp = Math.abs(M_perm);
    let Ieff_perm: number;
    if (Mp <= 0.001 || Mcr >= Mp) {
        Ieff_perm = Igr;
    } else {
        const factor_p = 1.2 - (Mcr / Mp) * (z / d) * (1 - x / d);
        Ieff_perm = factor_p > 0 ? Icr / factor_p : Igr;
        Ieff_perm = Math.max(Icr, Math.min(Igr, Ieff_perm));
    }

    let alpha: number;
    switch (supportCondition) {
        case 'simply': alpha = 5 / 48; break;
        case 'one_end': alpha = 1 / 12; break;
        case 'continuous': alpha = 1 / 16; break;
        case 'cantilever': alpha = 1 / 4; break;
        default: alpha = 1 / 16;
    }

    const ai = alpha * Ms * 1e6 * L * L / (Ec * Ieff);
    const ai_perm = alpha * Mp * 1e6 * L * L / (Ec * Ieff_perm);


    const eps_cs = 0.0003;
    const ptPcDiff = Math.max(0, pt - pc);
    let k4: number;
    if (pt <= 0 || ptPcDiff < 0.25) {
        // Below the lower threshold IS 456 gives no formula — take k4 = 0
        k4 = 0;
    } else if (ptPcDiff < 1.0) {
        k4 = 0.72 * ptPcDiff / Math.sqrt(pt);
    } else {
        k4 = 0.65 * ptPcDiff / Math.sqrt(pt);
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

    // Creep deflection (Annex C Cl. C-4)
    const theta = CREEP_COEFF[ageOfLoading] ?? 1.6;
    const Ece = Ec / (1 + theta);
    const m_lt = Es / Ece;

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

    const a_total_raw = ai + Math.max(0, a_creep) + a_shrinkage;
    const a_post_raw = Math.max(0, a_creep) + a_shrinkage;

    const limit_total = L / 250;
    const limit_post = Math.min(L / 350, 20);

    // Camber is credited only when supplied explicitly by the caller. It is kept
    // on 5 mm increments and below the post-construction deflection being offset.
    const camber = clampDeflectionCamber(design.camber ?? 0, a_post_raw);
    const a_total = Math.max(0, a_total_raw - camber);
    const a_post_construction = Math.max(0, a_post_raw - camber);

    return {
        L, D, d, b,
        Ec: Math.round(Ec * 100) / 100,
        Es,
        m: Math.round(m * 1000) / 1000,
        m_lt: Math.round(m_lt * 1000) / 1000,
        theta,
        Ece,
        pt: Math.round(pt * 1000) / 1000,
        pc: Math.round(pc * 1000) / 1000,
        Igr, Icr, Ieff, Ieff_perm, Icr_lt, Ieff_lt,
        x: Math.round(x * 100) / 100,
        x_lt: Math.round(x_lt * 100) / 100,
        z: Math.round(z * 100) / 100,
        z_lt: Math.round(z_lt * 100) / 100,
        Mcr: Math.round(Mcr * 100) / 100,
        fcr, alpha, k3, eps_cs,
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
//  T-BEAM DEFLECTION CHECK — IS 456:2000 Annex C
//  For waffle slabs: the deflection is computed on the COMBINED
//  rib + flange T-section (not a per-meter strip approximation).
//  The rib reinforcement (Ast) directly controls I_cr and I_eff,
//  and therefore the deflection.
//
//  Methodology follows transformed-section mechanics and IS 456 Annex C:
//    1. Gross I_gr of the T-section (flange bf × Df + web bw × (D−Df))
//       computed via parallel-axis theorem about the centroidal axis.
//    2. Cracked I_cr: solve for NA depth x; if x ≤ Df the section
//       behaves as a rectangular flange section, else as a true T.
//    3. Mcr = 0.7√fck · I_gr / yt  (yt = D − ȳ, extreme tension fibre)
//    4. I_eff via Branson/Annex C: I_cr / (1.2 − (Mcr/Ms)(z/d)(1−x/d))
//    5. Short-term a_i = α·Ms·L²/(Ec·I_eff)
//    6. Shrinkage a_sh = k3·ψ_cs·L²  (k3 per support condition)
//    7. Creep a_cr = a1,perm − ai,perm  (Ece = Ec/(1+θ))
//    8. Camber applied if total or post-construction exceeds limits.
// ═══════════════════════════════════════════════════════════════

export interface TBeamDeflectionConfig {
    L: number;          // span (mm)
    bf: number;         // flange width (mm) = rib spacing
    Df: number;         // flange (topping) thickness (mm)
    bw: number;         // web (rib) width (mm)
    D: number;          // overall depth (mm)
    cover: number;      // clear cover to tension steel (mm)
    barDia: number;     // tension bar diameter (mm)
    Ast: number;        // tension steel area provided (mm²) — the rib bottom reinforcement
    // ─── Compression (top) reinforcement at midspan — IS 456 Annex C ──────
    // When the rib carries hanger bars or anchored continuity bars in compression
    // face, they reduce the deflection. Both `Asc` and the geometry needed to
    // place them (cover_top + barDia_top) must be supplied together; omitting
    // them defaults to no compression steel (back-compat).
    Asc?: number;       // compression steel area provided in the rib top (mm²)
    barDia_top?: number;// compression bar diameter (mm) — for d' = cover_top + barDia_top/2
    cover_top?: number; // clear cover to compression steel (mm); defaults to `cover`
    fck: number;
    fy: number;
    Es?: number;
    ageOfLoading?: string;
}

export interface TBeamDeflectionDesign {
    M_service: number;     // total service moment on the rib (kN·m)
    M_perm: number;        // permanent (dead) service moment (kN·m)
    supportCondition: SupportCondition;
    camber?: number;       // explicit upward camber (mm), default 0
}

export function tBeamDeflection(config: TBeamDeflectionConfig, design: TBeamDeflectionDesign): DeflectionResult {
    const {
        L, bf, Df, bw, D, cover, barDia, Ast,
        Asc = 0, barDia_top = 0, cover_top,
        fck, fy, Es = 200000, ageOfLoading = '28',
    } = config;
    const { M_service, M_perm, supportCondition } = design;

    const d = D - cover - barDia / 2;   // effective depth to tension steel
    // d' (depth from compression face to centroid of compression steel)
    const cover_t = cover_top ?? cover;
    const d_comp = Asc > 0 ? cover_t + (barDia_top || 0) / 2 : 0;
    const b = bf;                        // flange width (for unit-strip compat in return)
    const m_ratio = getAnnexCModularRatio(fck, Es); // Modular ratio m = Es / Ec

    // ─── 1. Gross moment of inertia I_gr (T-section, uncracked) ─────────────
    // Flange: bf × Df, centroid at Df/2 from top
    // Web:    bw × (D − Df), centroid at Df + (D−Df)/2 from top
    const A_f = bf * Df;
    const A_w = bw * (D - Df);
    const A_total = A_f + A_w;
    const y_f = Df / 2;                          // flange centroid from top
    const y_w = Df + (D - Df) / 2;              // web centroid from top
    const y_bar = (A_f * y_f + A_w * y_w) / A_total;  // composite centroid from top
    const I_gr = (bf * Math.pow(Df, 3) / 12 + A_f * Math.pow(y_bar - y_f, 2))
        + (bw * Math.pow(D - Df, 3) / 12 + A_w * Math.pow(y_bar - y_w, 2));

    // ─── 2. Cracked moment of inertia I_cr (transformed section) ────────────
    // Solve for NA depth x (from top). With compression steel Asc the
    // first-moment equation about the NA is:
    //   (b_eff·x²)/2 + (m−1)·Asc·(x − d')  =  m·Ast·(d − x)
    // where b_eff = bf if x ≤ Df, else b_eff is handled piecewise (flange
    // contributes bf·Df, web contributes bw·(x−Df)).
    //
    // Solve_x: helper that solves the quadratic for a given b_eff assumption.
    const solveX = (m: number, includeComp: boolean): number => {
        // Case (a) — NA in flange: rectangular of width bf.
        // (bf/2)·x² + [m·Ast + (m−1)·Asc]·x − [m·Ast·d + (m−1)·Asc·d'] = 0
        const aA = bf / 2;
        const bA = m * Ast + (includeComp ? (m - 1) * Asc : 0);
        const cA = -(m * Ast * d + (includeComp ? (m - 1) * Asc * d_comp : 0));
        const discA = bA * bA - 4 * aA * cA;
        const xA = discA >= 0 ? (-bA + Math.sqrt(discA)) / (2 * aA) : Df;
        if (xA <= Df) return xA;

        // Case (b) — NA in web. Take moments about NA, splitting concrete into
        // flange (bf·Df, centroid at Df/2 from top) and web above NA
        // (bw·(x−Df), centroid at (Df + (x−Df)/2) from top):
        //   bf·Df·(x − Df/2) + (bw/2)·(x − Df)²
        //     + (m−1)·Asc·(x − d')  =  m·Ast·(d − x)
        // → expand to a quadratic A·x² + B·x + C = 0.
        const aB = bw / 2;
        const bB = bf * Df - bw * Df + m * Ast + (includeComp ? (m - 1) * Asc : 0);
        const cB = -bf * Df * Df / 2 + (bw * Df * Df) / 2
            - m * Ast * d
            - (includeComp ? (m - 1) * Asc * d_comp : 0);
        const discB = bB * bB - 4 * aB * cB;
        return discB >= 0 ? (-bB + Math.sqrt(discB)) / (2 * aB) : Df;
    };

    const x = solveX(m_ratio, Asc > 0);

    // I_cr: cracked transformed inertia about NA (top fibre = 0)
    const compTerm = Asc > 0 ? (m_ratio - 1) * Asc * Math.pow(x - d_comp, 2) : 0;
    let Icr: number;
    if (x <= Df) {
        // Rectangular flange section
        Icr = bf * Math.pow(x, 3) / 3 + m_ratio * Ast * Math.pow(d - x, 2) + compTerm;
    } else {
        // True T-section: bf·x³/3 − (bf−bw)·(x−Df)³/3 + m·Ast·(d−x)² + comp
        Icr = bf * Math.pow(x, 3) / 3
            - (bf - bw) * Math.pow(x - Df, 3) / 3
            + m_ratio * Ast * Math.pow(d - x, 2)
            + compTerm;
    }

    // ─── 3. Cracking moment Mcr ─────────────────────────────────────────────
    const Ec = getEc(fck);
    const fcr = 0.7 * Math.sqrt(fck);
    const yt = D - y_bar; // extreme tension fibre (bottom) from centroid
    const Mcr = fcr * I_gr / yt / 1e6; // kN·m

    // ─── 4. Effective moment of inertia I_eff (Annex C Cl. C-2) ─────────────
    // IS 456:2000 Annex C Cl. C-2.1:
    //   Ieff = Icr / [1.2 − (Mcr/M) × (bw/b) × (z/d) × (1 − x/d)]
    // For T-sections b = bf (compression flange width); bw/bf < 1 for waffle ribs.
    // annexCDeflection (rectangular strip) uses bw/b = 1 implicitly since bw = b = 1000 mm.
    const bw_bf = bw / bf; // BUG-WS2 FIX: T-beam web-to-flange ratio per IS 456 Annex C Cl. C-2.1
    const pt = 100 * Ast / (bw * d); // % tension steel on web (per IS 456)
    const pc = Asc > 0 ? 100 * Asc / (bw * d) : 0; // % compression steel on web
    const Ms = Math.abs(M_service);
    const z = d - x / 3; // lever arm
    let Ieff: number;
    if (Ms <= 0.001 || Mcr >= Ms) {
        Ieff = I_gr;
    } else {
        const factor = 1.2 - (Mcr / Ms) * bw_bf * (z / d) * (1 - x / d);
        Ieff = factor > 0 ? Icr / factor : I_gr;
        Ieff = Math.max(Icr, Math.min(I_gr, Ieff));
    }

    const Mp = Math.abs(M_perm);
    let Ieff_perm: number;
    if (Mp <= 0.001 || Mcr >= Mp) {
        Ieff_perm = I_gr;
    } else {
        const factor_p = 1.2 - (Mcr / Mp) * bw_bf * (z / d) * (1 - x / d);
        Ieff_perm = factor_p > 0 ? Icr / factor_p : I_gr;
        Ieff_perm = Math.max(Icr, Math.min(I_gr, Ieff_perm));
    }

    // ─── α coefficient per support condition ────────────────────────────────
    let alpha: number;
    switch (supportCondition) {
        case 'simply': alpha = 5 / 48; break;
        case 'one_end': alpha = 1 / 12; break;
        case 'continuous': alpha = 1 / 16; break;
        case 'cantilever': alpha = 1 / 4; break;
        default: alpha = 1 / 16;
    }

    // ─── 5. Short-term deflection ───────────────────────────────────────────
    const ai = alpha * Ms * 1e6 * L * L / (Ec * Ieff);
    const ai_perm = alpha * Mp * 1e6 * L * L / (Ec * Ieff_perm);

    // ─── 6. Shrinkage deflection (Annex C Cl. C-3) ──────────────────────────
    // BUG-TBEAM-04 FIX (2026-06-26 audit): same k4 correction as annexCDeflection.
    // IS 456 Cl. C-3.1 keeps the /√pt divisor in BOTH branches; the second
    // branch only swaps the leading coefficient from 0.72 → 0.65.
    const eps_cs = 0.0003;
    const ptPcDiff = Math.max(0, pt - pc);
    let k4: number;
    if (pt <= 0 || ptPcDiff < 0.25) {
        k4 = 0;
    } else if (ptPcDiff < 1.0) {
        k4 = 0.72 * ptPcDiff / Math.sqrt(pt);
    } else {
        k4 = 0.65 * ptPcDiff / Math.sqrt(pt);
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

    // ─── 7. Creep deflection (Annex C Cl. C-4) ──────────────────────────────
    const theta = CREEP_COEFF[ageOfLoading] ?? 1.6;
    const Ece = Ec / (1 + theta);
    const m_lt = Es / Ece;

    // Re-compute cracked NA + Icr with long-term modular ratio for creep
    const x_lt = solveX(m_lt, Asc > 0);
    const compTerm_lt = Asc > 0 ? (m_lt - 1) * Asc * Math.pow(x_lt - d_comp, 2) : 0;
    let Icr_lt: number;
    if (x_lt <= Df) {
        Icr_lt = bf * Math.pow(x_lt, 3) / 3 + m_lt * Ast * Math.pow(d - x_lt, 2) + compTerm_lt;
    } else {
        Icr_lt = bf * Math.pow(x_lt, 3) / 3
            - (bf - bw) * Math.pow(x_lt - Df, 3) / 3
            + m_lt * Ast * Math.pow(d - x_lt, 2)
            + compTerm_lt;
    }
    const z_lt = d - x_lt / 3;
    let Ieff_lt: number;
    if (Mp <= 0.001 || Mcr >= Mp) {
        Ieff_lt = I_gr;
    } else {
        const factor_lt = 1.2 - (Mcr / Mp) * bw_bf * (z_lt / d) * (1 - x_lt / d);
        Ieff_lt = factor_lt > 0 ? Icr_lt / factor_lt : I_gr;
        Ieff_lt = Math.max(Icr_lt, Math.min(I_gr, Ieff_lt));
    }

    const a1_perm = alpha * Mp * 1e6 * L * L / (Ece * Ieff_lt);
    const a_creep = a1_perm - ai_perm;

    // ─── 8. Total deflections + explicit camber ─────────────────────────────
    const a_total_raw = ai + Math.max(0, a_creep) + a_shrinkage;
    const a_post_raw = Math.max(0, a_creep) + a_shrinkage;
    const limit_total = L / 250;
    const limit_post = Math.min(L / 350, 20);

    const camber = clampDeflectionCamber(design.camber ?? 0, a_post_raw);
    const a_total = Math.max(0, a_total_raw - camber);
    const a_post_construction = Math.max(0, a_post_raw - camber);

    return {
        L, D, d, b, Ec, Es, m: m_ratio, m_lt, theta, Ece,
        pt: Math.round(pt * 1000) / 1000, pc,
        Igr: I_gr, Icr, Ieff, Ieff_perm, Icr_lt, Ieff_lt,
        x: Math.round(x * 100) / 100, x_lt: Math.round(x_lt * 100) / 100,
        z: Math.round(z * 100) / 100, z_lt: Math.round(z_lt * 100) / 100,
        Mcr: Math.round(Mcr * 100) / 100, fcr, alpha, k3, eps_cs,
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
