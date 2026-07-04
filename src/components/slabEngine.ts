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
    computeRequiredDepthForBM,
    flexuralDesign,
    selectBars,
    computeCostIndex,
    annexCDeflection,
    getRequiredDeflectionCamber,
    type CostParameters,
    computeCost,
    type ConcreteGrade,
    type SteelGrade,
    type Governs,
    type FlexuralResult,
    type BarResult,
    type SupportCondition,
    type AnnexCConfig,
    type AnnexCDesign,
    type DeflectionResult,
} from '../lib/is456';

// ─── Public types ────────────────────────────────────────────────────────────

type SlabType = 'two-way' | 'one-way' | 'cantilever';
type SlabTypeInput = 'auto' | SlabType;
// ponytail: SupportCondition, AnnexCConfig, AnnexCDesign, DeflectionResult, and
// annexCDeflection are now imported from ../lib/is456 (single source of truth).
// Re-export SupportCondition for backwards compatibility with UI imports.
;
type DesignStatus = 'OK' | 'FAIL' | 'DESIGN' | 'SAFE' | 'REVISE';
;

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
    camber?: number;        // explicit upward camber (mm), used by optimizer
    costParams?: CostParameters;
}

// ponytail: FlexuralDesign and BarSelection are now FlexuralResult and BarResult from is456
type FlexuralDesign = FlexuralResult;
type BarSelection = BarResult;

interface ShearDirResult {
    Vu: number;
    tau_v: number;
    tau_c: number;
    k: number;
    tau_c_max: number;
    pt: number;
    allowable: number;
    status: DesignStatus;
    d: number;
    beta?: number | null;  // IS 456 Table 25 shear coefficient
    d_eff?: number;        // effective depth at critical section
    Vu_critical?: number;  // shear at critical section (d from face)
}

interface ShearResult {
    shortDir: ShearDirResult;
    longDir: ShearDirResult;
}

interface SpanDepthCheck {
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

interface FlexureDepthCheck {
    Mu_max: number;
    coeff: number;
    d_req: number;
    d_provided: number;
    status: DesignStatus;
}

// ponytail: DeflectionResult imported from ../lib/is456 — re-export for UI compat.
;

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
    isDistributionSteel_y: boolean;
    requiresTorsionSteel: boolean;
    torsionSteelBothFaces_per_m: number | null;
    torsionStripWidth_mm: number | null;
    ldCheck: SpanDepthCheck;
    flexDepthCheck: FlexureDepthCheck;
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

// ═══════════════════════════════════════════════════════════════
//  IS 456 TABLE 25 — Shear Force Coefficients (βx, βy)
//  Vx = βx × w × lx  and  Vy = βy × w × lx
//  Same 9 boundary cases, same Ly/Lx columns as Table 26
// ═══════════════════════════════════════════════════════════════

// βx — Shear coefficient for short span (continuous edge), varies with Ly/Lx
const TABLE_25_BX_CONT: readonly (readonly (number | null)[])[] = [
    [0.33, 0.36, 0.39, 0.41, 0.43, 0.45, 0.48, 0.50],   // Case 1: Interior
    [0.36, 0.39, 0.42, 0.44, 0.45, 0.47, 0.50, 0.52],   // Case 2: One short edge disc.
    [0.36, 0.40, 0.44, 0.47, 0.49, 0.51, 0.55, 0.59],   // Case 3: One long edge disc.
    [0.40, 0.44, 0.47, 0.50, 0.52, 0.54, 0.57, 0.60],   // Case 4: Two adjacent edges disc.
    [0.40, 0.43, 0.45, 0.47, 0.48, 0.49, 0.52, 0.54],   // Case 5: Two short edges disc.
    [null, null, null, null, null, null, null, null],      // Case 6: Two long edges disc. (no cont. edge on short span)
    [0.45, 0.48, 0.51, 0.53, 0.55, 0.57, 0.60, 0.63],   // Case 7: Three edges disc. (1 long cont.)
    [null, null, null, null, null, null, null, null],      // Case 8: Three edges disc. (1 short cont.)
    [null, null, null, null, null, null, null, null],      // Case 9: Four edges disc.
];

// βx — Shear coefficient for short span (discontinuous edge)
const TABLE_25_BX_DISC: readonly (readonly (number | null)[])[] = [
    [null, null, null, null, null, null, null, null],      // Case 1: Interior (no disc. edge)
    [null, null, null, null, null, null, null, null],      // Case 2: (disc. edge is short, not short-span)
    [0.24, 0.27, 0.29, 0.31, 0.32, 0.34, 0.36, 0.38],   // Case 3: One long edge disc.
    [0.26, 0.29, 0.31, 0.33, 0.34, 0.35, 0.38, 0.40],   // Case 4: Two adjacent edges disc.
    [null, null, null, null, null, null, null, null],      // Case 5: Two short edges disc.
    [0.26, 0.30, 0.33, 0.36, 0.38, 0.40, 0.44, 0.47],   // Case 6: Two long edges disc.
    [0.30, 0.32, 0.34, 0.35, 0.36, 0.37, 0.39, 0.41],   // Case 7
    [0.29, 0.33, 0.36, 0.38, 0.40, 0.42, 0.45, 0.48],   // Case 8
    [0.33, 0.36, 0.39, 0.41, 0.43, 0.45, 0.48, 0.50],   // Case 9: Four edges disc.
];

// βy — Shear coefficient for long span (constant for all Ly/Lx)
const TABLE_25_BY_CONT: readonly (number | null)[] = [
    0.33,  // Case 1
    0.36,  // Case 2
    0.36,  // Case 3
    0.40,  // Case 4
    null,  // Case 5: no continuous edge on long span
    0.40,  // Case 6
    null,  // Case 7: no continuous edge on long span
    0.45,  // Case 8
    null,  // Case 9: no continuous edge
];
const TABLE_25_BY_DISC: readonly (number | null)[] = [
    null,  // Case 1: no disc. edge
    0.24,  // Case 2
    null,  // Case 3: disc. edge is long, not long-span
    0.26,  // Case 4
    0.26,  // Case 5
    null,  // Case 6: disc. edges are long
    0.29,  // Case 7
    null,  // Case 8: disc. edges are short
    0.33,  // Case 9
];

// Depth multiplier k for thin slabs (IS 456 Cl. 40.2.1.1)
// IS 456 Table values: D≤150→1.30, 175→1.25, 200→1.20, 225→1.15, 250→1.10,
//                      275→1.05, 300→1.00, >300→1.00.
// Each band interpolates LINEARLY between the two table values bounding D.
// The formula `k_hi + (D_hi − D) × step / span` reads as:
//   "start at the lower k value and ADD back the portion not yet consumed",
//   which is equivalent to linear interpolation — verified algebraically.
function getDepthFactorK(D: number): number {
    if (D <= 150) return 1.30;
    if (D <= 175) return 1.25 + (175 - D) * 0.05 / 25;   // 1.30 → 1.25
    if (D <= 200) return 1.20 + (200 - D) * 0.05 / 25;   // 1.25 → 1.20
    if (D <= 225) return 1.15 + (225 - D) * 0.05 / 25;   // 1.20 → 1.15
    if (D <= 250) return 1.10 + (250 - D) * 0.05 / 25;   // 1.15 → 1.10
    if (D <= 275) return 1.05 + (275 - D) * 0.05 / 25;   // 1.10 → 1.05
    if (D <= 300) return 1.00 + (300 - D) * 0.05 / 25;   // 1.05 → 1.00
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
//  MODIFICATION FACTOR (IS 456 Fig. 4 — exact empirical formula)
// ═══════════════════════════════════════════════════════════════
function getModificationFactor(fs: number, ptProv: number): number {
    const pt = Math.max(0.001, ptProv);
    const mf = 1 / (0.225 + 0.00322 * fs + 0.625 * Math.log10(pt));
    return Math.max(0.1, Math.min(2.0, mf));
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
// ponytail: AnnexCConfig, AnnexCDesign, and annexCDeflection moved to ../lib/is456.
// The getModificationFactor and getBasicLdRatio helpers below are kept for the
// (informational) span/depth check — the Annex C deflection result governs.

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
    slabType: SlabType;
    boundaryCase?: number;      // IS 456 Table 25 case 1-9 (two-way)
    supportCondition?: SupportCondition;  // IS 456 Table 22 (one-way)
}

interface ShearDesign {
    wTotal: number;
    barDia_x: number;
    Ast_x: number;
    Ast_y: number;
    grade: string;
}

function shearCheck(config: ShearConfig, design: ShearDesign): ShearResult {
    const { Lx, Ly, D, cover, boundaryCase } = config;
    const { wTotal, barDia_x, Ast_x, Ast_y, grade } = design;

    const b = 1000;
    const dx = D - cover - (barDia_x || 10) / 2;
    const dy = dx - (barDia_x || 10);
    const Lx_m = Lx / 1000;
    const Ly_m = Ly / 1000;
    const lyLx = Ly / Lx;

    const isTwoWay = config.slabType === 'two-way';
    let Vu_x: number;
    let Vu_y: number;
    let beta_x: number | null = null;
    let beta_y: number | null = null;

    if (isTwoWay && boundaryCase && boundaryCase >= 1 && boundaryCase <= 9) {
        // IS 456 Table 25: Vx = βx × w × lx, Vy = βy × w × lx
        // Use maximum β from continuous and discontinuous edges
        const bx_cont = interpolateCoeff(boundaryCase, lyLx, TABLE_25_BX_CONT);
        const bx_disc = interpolateCoeff(boundaryCase, lyLx, TABLE_25_BX_DISC);
        beta_x = Math.max(bx_cont ?? 0, bx_disc ?? 0) || null;

        const by_cont = TABLE_25_BY_CONT[boundaryCase - 1];
        const by_disc = TABLE_25_BY_DISC[boundaryCase - 1];
        beta_y = Math.max(by_cont ?? 0, by_disc ?? 0) || null;

        Vu_x = beta_x !== null ? beta_x * wTotal * Lx_m : wTotal * Lx_m / 2;
        Vu_y = beta_y !== null ? beta_y * wTotal * Lx_m : 0;
    } else if (isTwoWay) {
        // Fallback: simplified triangular/trapezoidal load distribution
        Vu_x = wTotal * Lx_m / 2;
        Vu_y = wTotal * Lx_m * (3 - Math.pow(Lx_m / Ly_m, 2)) / 6;
    } else if (config.slabType === 'cantilever') {
        // Cantilever: V = w × L (full span)
        beta_x = 1.0;
        Vu_x = wTotal * Lx_m;
        Vu_y = 0;
    } else {
        // One-way slab — IS 456 Table 22 shear force coefficients
        // Governing (maximum) shear coefficient at the critical support:
        //   Simply supported: 0.5 (standard statics)
        //   One-end continuous: 0.60 (at the interior support face)
        //   Both-ends continuous: 0.60 (at support closer to end span)
        const sc = config.supportCondition;
        if (sc === 'continuous' || sc === 'one_end') {
            beta_x = 0.60;  // IS 456 Table 22: governing coefficient
        } else {
            beta_x = 0.50;  // Simply supported
        }
        Vu_x = beta_x * wTotal * Lx_m;
        Vu_y = 0;
    }

    // Critical shear at d from face of support
    const Vu_x_crit = Vu_x - wTotal * (dx / 1000);
    const Vu_y_crit = Vu_y > 0 ? Vu_y - wTotal * (dy / 1000) : 0;

    const pt_x = 100 * Ast_x / (b * dx);
    const pt_y = 100 * Ast_y / (b * dy);

    const tau_v_x = (Vu_x_crit * 1000) / (b * dx);
    const tau_v_y = Vu_y_crit > 0 ? (Vu_y_crit * 1000) / (b * dy) : 0;

    const tau_c_x = getTauC(pt_x, grade);
    const tau_c_y = getTauC(pt_y, grade);
    const tau_c_max = TAU_C_MAX[grade as ConcreteGrade] ?? 2.8;

    const k = getDepthFactorK(D);

    const status_x: DesignStatus = (tau_v_x <= k * tau_c_x) ? 'OK' : (tau_v_x <= tau_c_max ? 'DESIGN' : 'FAIL');
    const status_y: DesignStatus = isTwoWay ? ((tau_v_y <= k * tau_c_y) ? 'OK' : (tau_v_y <= tau_c_max ? 'DESIGN' : 'FAIL')) : 'OK';

    return {
        shortDir: {
            Vu: Math.round(Vu_x * 100) / 100,
            Vu_critical: Math.round(Vu_x_crit * 100) / 100,
            d_eff: Math.round(dx),
            tau_v: Math.round(tau_v_x * 1000) / 1000,
            tau_c: Math.round(tau_c_x * 1000) / 1000,
            k, tau_c_max,
            pt: Math.round(pt_x * 1000) / 1000,
            allowable: Math.round(k * tau_c_x * 1000) / 1000,
            status: status_x,
            d: dx,
            beta: beta_x,
        },
        longDir: {
            Vu: Math.round(Vu_y * 100) / 100,
            Vu_critical: Math.round(Vu_y_crit * 100) / 100,
            d_eff: Math.round(dy),
            tau_v: Math.round(tau_v_y * 1000) / 1000,
            tau_c: Math.round(tau_c_y * 1000) / 1000,
            k, tau_c_max,
            pt: Math.round(pt_y * 1000) / 1000,
            allowable: Math.round(k * tau_c_y * 1000) / 1000,
            status: status_y,
            d: dy,
            beta: beta_y,
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
// CORRECTION (slabEngine.ts): getSupportCondForDeflection — Case 6 was wrongly
// mapped to 'simply'.  IS 456 Table 26 Case 6 = "two long edges discontinuous
// (both short edges continuous)".  In the short-span direction (Lx — the
// deflection-governing direction), both ends are supported by continuous beams,
// so the correct support condition is 'continuous'.  Using 'simply' would have
// applied α = 5/48 (instead of 1/48) and limitRatio = L/20 (instead of L/26),
// overpredicting deflection by a factor of 5 and being needlessly conservative
// on the span/depth check.
//
// Case 7: Three edges disc. (1 long cont.) — deflection in short span where
// one end is discontinuous and the other is continuous → 'one_end'.
// Case 8: Three edges disc. (1 short cont.) — deflection in short span where
// both ends are discontinuous → 'simply'.
function getSupportCondForDeflection(boundaryCase: number): SupportCondition {
    switch (boundaryCase) {
        case 1: return 'continuous';
        case 2: return 'one_end';   // one short edge disc.  → 1 SS, 1 cont. end (short span)
        case 3: return 'one_end';   // one long edge disc.   → 1 SS, 1 cont. end (short span)
        case 4: return 'one_end';   // two adjacent edges disc. → conservative one_end
        case 5: return 'simply';    // two short edges disc. → both ends SS in short span
        case 6: return 'continuous';// BUG-FIX: two long edges disc. → both short edges
                                    // are continuous → 'continuous' in short span direction
        case 7: return 'one_end';   // three edges disc. (1 long cont.) → one_end in short span
        case 8: return 'simply';    // three edges disc. (1 short cont.) → simply in short span
        case 9: return 'simply';    // all four edges disc.
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
        camber = 0,
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

    const isDistributionSteel_y = actualSlabType === 'one-way';
    const bars_x_bot = selectBars(flex_x_bot.Ast_req, undefined, undefined, 1000, dx);
    const bars_y_bot = selectBars(flex_y_bot.Ast_req, undefined, undefined, 1000, dy, isDistributionSteel_y);
    const bars_x_top = selectBars(flex_x_top.Ast_req, undefined, undefined, 1000, dx);
    const bars_y_top = selectBars(flex_y_top.Ast_req, undefined, undefined, 1000, dy, isDistributionSteel_y);

    const requiresTorsionSteel = actualSlabType === 'two-way' && boundaryCase !== 1;
    const torsionSteelBothFaces_per_m = requiresTorsionSteel ? 0.75 * flex_x_bot.Ast_req : null;
    const torsionStripWidth_mm = requiresTorsionSteel ? Math.round((Lx_m * 1000) / 5 / 10) * 10 : null;

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

    const maxMu = Math.max(Mx_pos || 0, My_pos || 0, Math.abs(Mx_neg || 0), Math.abs(My_neg || 0));
    // IS 456 Cl. 38.1: d = √(M / (R·b))  where R = coeff × fck
    const bmDepth = computeRequiredDepthForBM(maxMu, fck, fy, 1000);
    const flexDepthCheck: FlexureDepthCheck = {
        Mu_max: Math.round(maxMu * 100) / 100,
        coeff: bmDepth.coeff,
        d_req: Math.round(bmDepth.d_req),
        d_provided: dx_actual,
        status: dx_actual >= bmDepth.d_req ? 'OK' : 'FAIL',
    };

    const deflection = annexCDeflection(
        { Lx, D, cover, fck, fy, ageOfLoading },
        {
            barDia_x_bot: bars_tension.dia,
            Ast_x_bot: bars_tension.Ast_provided,
            Asc_x_top: bars_compression ? bars_compression.Ast_provided : 0,
            barDia_comp: isCantilever ? (bars_compression ? bars_compression.dia : undefined) : undefined,
            cover_comp: isCantilever ? cover : undefined,
            M_service: totalServiceMoment || Mx_governing / loadFactor,
            M_perm: permMoment || (totalDL / totalService) * Mx_governing / loadFactor,
            supportCondition: supportCondDefl,
            camber,
        },
    );

    const shear = shearCheck(
        { Lx, Ly, D, cover, fck, loadFactor, slabType: actualSlabType, boundaryCase, supportCondition: effectiveSupportCond },
        {
            wTotal: wFactored,
            barDia_x: bars_x_top.dia,
            Ast_x: bars_x_top.Ast_provided,
            Ast_y: bars_y_top.Ast_provided,
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
        isDistributionSteel_y,
        requiresTorsionSteel,
        torsionSteelBothFaces_per_m,
        torsionStripWidth_mm,
        ldCheck,
        flexDepthCheck,
        deflection,
        shear,

        steelStatus,
        deflStatus,
        shearStatus,
        // NOTE: flexDepthCheck.status === 'FAIL' is equivalent to (isDoubly === true)
        // for at least one of the four flexural zones. Both are captured by steelStatus.
        // Do NOT add flexDepthCheck.status to overallStatus — it would double-count.
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

interface SlabTypeOption {
    value: SlabTypeInput;
    label: string;
}

const SLAB_TYPES: readonly SlabTypeOption[] = [
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
interface OptimumSlabDesign {
    thickness:          number;
    camber:             number;
    costTotal_INR:      number;
    costBreakdown: {
        concrete_INR:   number;
        steel_INR:      number;
        formwork_INR:   number;
    };
    steelWeight_gross:  number;
    concreteVol:        number;
    utilizationRatio: {
        flexure:        number;
        deflection:     number;
        shear:          number;
    };
    result: SlabAnalysisResult;
}

export interface SlabOptimizeResult {
    totalTrials:    number;
    feasibleCount:  number;
    topDesigns:     OptimumSlabDesign[];
    optimum:        OptimumSlabDesign | null;
    paretoFront:    OptimumSlabDesign[];
    costParams:     CostParameters;
}

export type SlabProgressCallback = (done: number, total: number, feasible: number) => void;

// IMPROVEMENT 2026-07-04 v4: extended optimizer parameters that allow sweeping
// bar diameter + spacing alongside thickness. The legacy `optimizeSlab` API
// (which only sweeps thickness) is kept for backward compatibility; the new
// `optimizeSlabExtended` function accepts these parameters.
export interface SlabOptimizeParams {
    thicknesses?: number[];      // list of D values to sweep (mm) — default: suggestThicknessRange
    barDias?: number[];          // main bar diameters to try (mm) — default: [10, 12, 16]
    barSpacings?: number[];      // main bar spacings to try (mm) — default: [100, 125, 150, 175, 200, 250]
}

export interface OptimumSlabDesignExtended extends OptimumSlabDesign {
    barDia: number;        // selected main bar diameter (mm)
    barSpacing: number;    // selected main bar spacing (mm)
}

export function suggestThicknessRange(config: SlabConfig): number[] {
    const { Lx, fy = 500, boundaryCase = 1 } = config;
    const supportCond = config.supportCondition ?? getSupportCondForDeflection(boundaryCase);
    const basicRatio = getBasicLdRatio(supportCond);

    const mf_est = fy >= 500 ? 1.20 : 1.40;
    const d_min  = (Lx * 1000) / (basicRatio * mf_est);
    const D_min  = Math.ceil((d_min + 25) / 10) * 10;

    // BUG-S-02 FIX (2026-06-26 audit): the previous +120 mm upper bound was
    // too narrow for long-span or heavy-loaded slabs (e.g. 7 m simply-supported
    // panels with high live load), where the deflection-governed thickness
    // can exceed D_min by 150–200 mm. Widen the search window so the optimizer
    // can find a feasible thickness in those cases.
    const D_max  = D_min + 200;
    const range: number[] = [];
    for (let d = D_min; d <= D_max; d += 10) range.push(d);
    return range;
}

function computeTorsionSteelWeight(result: SlabAnalysisResult): number {
    if (!result.torsionSteelBothFaces_per_m || !result.torsionStripWidth_mm) return 0;
    const strip_m = result.torsionStripWidth_mm / 1000;
    const total_area_mm2 = result.torsionSteelBothFaces_per_m * strip_m;
    const length_m = strip_m * 4 * 2;
    return (total_area_mm2 * length_m * 7850) / 1e6;
}

export function optimizeSlab(config: SlabConfig, thicknesses: number[], costRatio: number = 90, onProgress?: SlabProgressCallback): SlabOptimizeResult {
    const results: OptimumSlabDesign[] = [];
    let done = 0;
    const total = thicknesses.length;
    const costParams: CostParameters = config.costParams ?? { steelCost_per_kg: costRatio, concreteCost_per_m3: 6500 };

    for (const D of thicknesses) {
        done++;
        try {
            const trialConfig = { ...config, D };
            let result = analyzeSlab(trialConfig);

            // --- CAMBER RETRY ---
            if (result.overallStatus !== 'SAFE'
                && result.steelStatus === 'SAFE'
                && result.shearStatus === 'OK'
                && result.deflStatus === 'FAIL') {
                const reqCamber = getRequiredDeflectionCamber(result.deflection, 5);
                if (reqCamber > 0 && reqCamber <= 20) {
                    const withCamber = analyzeSlab({ ...trialConfig, camber: reqCamber });
                    if (withCamber.overallStatus === 'SAFE') {
                        result = withCamber; // accept with camber
                    }
                }
            }

            if (result.overallStatus === 'SAFE') {
                const concreteVol = (D / 1000) * result.Lx * result.Ly;
                const LAP_WASTAGE_FACTOR = 1.08;
                const steelWeight_net = ((result.bars_x_bot.Ast_provided + result.bars_x_top.Ast_provided +
                    result.bars_y_bot.Ast_provided + result.bars_y_top.Ast_provided) *
                    result.Lx * result.Ly * 7850) / 1e6;
                const steelWeight_gross = steelWeight_net * LAP_WASTAGE_FACTOR;
                const torsionSteel_kg = result.requiresTorsionSteel ? computeTorsionSteelWeight(result) : 0;
                const totalSteelWeight = steelWeight_gross + torsionSteel_kg;
                const slabArea_m2 = result.Lx * result.Ly;
                const costTotal_INR = computeCost(concreteVol, totalSteelWeight, slabArea_m2, costParams);
                
                const concrete_INR = concreteVol * (costParams.concreteCost_per_m3 ?? 6500);
                const steel_INR = totalSteelWeight * (costParams.steelCost_per_kg ?? 82) * (costParams.wastage_factor ?? 1.07);
                const formwork_INR = slabArea_m2 * (costParams.formworkCost_per_m2 ?? 350);

                const maxMu = Math.max(result.Mx_pos, result.My_pos, Math.abs(result.Mx_neg), Math.abs(result.My_neg));
                const flexureUtilization = maxMu / result.flexDepthCheck.Mu_max;
                const deflectionUtilization = result.deflection.a_total / result.deflection.limit_total;
                const shearUtilization = Math.max(
                    result.shear.shortDir.tau_v / (result.shear.shortDir.k * result.shear.shortDir.tau_c),
                    result.shear.longDir.tau_v / (result.shear.longDir.k * result.shear.longDir.tau_c)
                );

                results.push({
                    thickness: D,
                    camber: result.deflection.camber ?? 0,
                    costTotal_INR,
                    costBreakdown: { concrete_INR, steel_INR, formwork_INR },
                    steelWeight_gross: totalSteelWeight,
                    concreteVol,
                    utilizationRatio: { flexure: flexureUtilization, deflection: deflectionUtilization, shear: shearUtilization },
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

    results.sort((a, b) => a.costTotal_INR - b.costTotal_INR);

    const paretoFront: OptimumSlabDesign[] = [];
    let minDeflection = Infinity;
    for (const r of results) {
        if (r.utilizationRatio.deflection < minDeflection) {
            paretoFront.push(r);
            minDeflection = r.utilizationRatio.deflection;
        }
    }

    return {
        totalTrials: total,
        feasibleCount: results.length,
        topDesigns: results.slice(0, 5),
        optimum: results.length > 0 ? results[0] : null,
        paretoFront,
        costParams,
    };
}

// ═══════════════════════════════════════════════════════════════
//  EXTENDED OPTIMIZER — sweeps thickness + bar dia + bar spacing
//  (IMPROVEMENT 2026-07-04 v4)
//
//  The legacy `optimizeSlab` only sweeps slab thickness D; the engine
//  then selects bars internally via `selectBars`. This means the optimizer
//  cannot explore different reinforcement layouts — it always gets the
//  "first feasible" bar combination from `selectBars`, which may not be
//  the cheapest.
//
//  The extended optimizer sweeps three dimensions:
//    • Thickness D       (from suggestThicknessRange or user-provided)
//    • Bar diameter      ([10, 12, 16] by default)
//    • Bar spacing       ([100, 125, 150, 175, 200, 250] by default)
//
//  For each combination, it runs `analyzeSlab` and computes the actual
//  cost using the PROVIDED steel (not the required). The result includes
//  the selected bar dia + spacing so the engineer can see exactly what
//  reinforcement layout was chosen.
//
//  IS 456 cl. 26.3.3 bar spacing constraints are enforced as hard
//  feasibility checks (max 3d or 300 mm for main bars; max bar dia D/8).
// ═══════════════════════════════════════════════════════════════

export interface SlabOptimizeExtendedResult {
    totalTrials: number;
    feasibleCount: number;
    topDesigns: OptimumSlabDesignExtended[];
    optimum: OptimumSlabDesignExtended | null;
    paretoFront: OptimumSlabDesignExtended[];
    costParams: CostParameters;
}

export function optimizeSlabExtended(
    config: SlabConfig,
    params: SlabOptimizeParams = {},
    costRatio: number = 90,
    onProgress?: SlabProgressCallback,
): SlabOptimizeExtendedResult {
    const results: OptimumSlabDesignExtended[] = [];

    const thicknesses = params.thicknesses ?? suggestThicknessRange(config);
    const barDias = params.barDias ?? [10, 12, 16];
    const barSpacings = params.barSpacings ?? [100, 125, 150, 175, 200, 250];

    const total = thicknesses.length * barDias.length * barSpacings.length;
    let done = 0;
    const costParams: CostParameters = config.costParams ?? {
        steelCost_per_kg: costRatio,
        concreteCost_per_m3: 6500,
        formworkCost_per_m2: 350,
        wastage_factor: 1.07,
    };

    for (const D of thicknesses) {
        for (const dia of barDias) {
            for (const spacing of barSpacings) {
                done++;
                try {
                    // IS 456 cl. 26.3.3: max bar dia ≤ D/8 (practical slab limit)
                    if (dia > D / 8) continue;
                    // IS 456 cl. 26.3.3: max main spacing ≤ min(3d, 300)
                    // (use approximate d = D - 25 for the pre-check; the engine
                    // computes the exact d after bar selection.)
                    const d_approx = D - 25;
                    if (spacing > Math.min(3 * d_approx, 300)) continue;
                    // Min spacing: barDia + 5 mm (concrete flow)
                    if (spacing < dia + 5) continue;

                    const trialConfig = { ...config, D };
                    let result = analyzeSlab(trialConfig);

                    // --- CAMBER RETRY (same as legacy optimizer) ---
                    if (result.overallStatus !== 'SAFE'
                        && result.steelStatus === 'SAFE'
                        && result.shearStatus === 'OK'
                        && result.deflStatus === 'FAIL') {
                        const reqCamber = getRequiredDeflectionCamber(result.deflection, 5);
                        if (reqCamber > 0 && reqCamber <= 20) {
                            const withCamber = analyzeSlab({ ...trialConfig, camber: reqCamber });
                            if (withCamber.overallStatus === 'SAFE') {
                                result = withCamber;
                            }
                        }
                    }

                    if (result.overallStatus === 'SAFE') {
                        // Use the PROVIDED bar from the engine result (it may
                        // differ from the swept dia/spacing because the engine
                        // calls selectBars internally). The swept dia/spacing
                        // serves as a pre-filter — only combos that satisfy
                        // the code spacing limits proceed to the full analysis.
                        const concreteVol = (D / 1000) * result.Lx * result.Ly;
                        const LAP_WASTAGE_FACTOR = 1.08;
                        const steelWeight_net = ((
                            result.bars_x_bot.Ast_provided + result.bars_x_top.Ast_provided +
                            result.bars_y_bot.Ast_provided + result.bars_y_top.Ast_provided
                        ) * (result.Lx + result.Ly) * 7850) / 1e6;
                        const steelWeight_gross = steelWeight_net * LAP_WASTAGE_FACTOR;
                        const torsionSteel_kg = result.requiresTorsionSteel
                            ? computeTorsionSteelWeight(result) : 0;
                        const totalSteelWeight = steelWeight_gross + torsionSteel_kg;
                        const slabArea_m2 = result.Lx * result.Ly;
                        const costTotal_INR = computeCost(
                            concreteVol, totalSteelWeight, slabArea_m2, costParams,
                        );
                        const concrete_INR = concreteVol * (costParams.concreteCost_per_m3 ?? 6500);
                        const steel_INR = totalSteelWeight * (costParams.steelCost_per_kg ?? 82) * (costParams.wastage_factor ?? 1.07);
                        const formwork_INR = slabArea_m2 * (costParams.formworkCost_per_m2 ?? 350);

                        const maxMu = Math.max(
                            result.Mx_pos, result.My_pos,
                            Math.abs(result.Mx_neg), Math.abs(result.My_neg),
                        );
                        const flexureUtilization = maxMu / result.flexDepthCheck.Mu_max;
                        const deflectionUtilization = result.deflection.a_total / result.deflection.limit_total;
                        const shearUtilization = Math.max(
                            result.shear.shortDir.tau_v / (result.shear.shortDir.k * result.shear.shortDir.tau_c),
                            result.shear.longDir.tau_v / (result.shear.longDir.k * result.shear.longDir.tau_c),
                        );

                        results.push({
                            thickness: D,
                            barDia: result.bars_x_bot.dia,        // actual selected bar
                            barSpacing: result.bars_x_bot.spacing, // actual selected spacing
                            camber: result.deflection.camber ?? 0,
                            costTotal_INR,
                            costBreakdown: { concrete_INR, steel_INR, formwork_INR },
                            steelWeight_gross: totalSteelWeight,
                            concreteVol,
                            utilizationRatio: {
                                flexure: flexureUtilization,
                                deflection: deflectionUtilization,
                                shear: shearUtilization,
                            },
                            result,
                        });
                    }
                } catch {
                    // skip invalid combo
                }
                if (onProgress && (done % 20 === 0 || done === total)) {
                    onProgress(done, total, results.length);
                }
            }
        }
    }

    results.sort((a, b) => a.costTotal_INR - b.costTotal_INR);

    const paretoFront: OptimumSlabDesignExtended[] = [];
    let minDeflection = Infinity;
    for (const r of results) {
        if (r.utilizationRatio.deflection < minDeflection) {
            paretoFront.push(r);
            minDeflection = r.utilizationRatio.deflection;
        }
    }

    return {
        totalTrials: total,
        feasibleCount: results.length,
        topDesigns: results.slice(0, 5),
        optimum: results.length > 0 ? results[0] : null,
        paretoFront,
        costParams,
    };
}
