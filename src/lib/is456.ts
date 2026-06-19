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
