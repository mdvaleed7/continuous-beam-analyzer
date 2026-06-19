/**
 * Shared input utilities for the three analyzer components.
 *
 * Previously each analyzer parsed numeric inputs differently — BeamAnalyzer
 * had a `parseNumber` helper with min clamping, WallAnalyzer accepted raw
 * values, and SlabAnalyzer used `+e.target.value` casts. This module gives
 * all three a single, consistent API.
 */

/**
 * Parse a user-typed value as a number, clamping to a minimum and falling back
 * to a default on NaN.
 *
 * @param val  - the raw input value
 * @param min  - inclusive lower bound (NaN/undefined → no clamp)
 * @param fallback  - returned when val is NaN (default 0)
 * @returns the parsed, clamped number
 *
 * @example
 *   parseNumber('4.5', 0.001, 1)  // → 4.5
 *   parseNumber('',     0.001, 1)  // → 1 (NaN fallback)
 *   parseNumber('-2',   0.001, 1)  // → 0.001 (clamped)
 */
export function parseNumber(val: string | number, min?: number, fallback: number = 0): number {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num)) return fallback;
    if (min !== undefined && !isNaN(min) && num < min) return min;
    return num;
}

/**
 * Parse an integer with optional bounds. Useful for dropdowns that should
 * reject out-of-range values (e.g. nSpans, refSpanL).
 *
 * @param val  - the raw input value
 * @param opts - { min, max, fallback }
 * @returns the parsed, bounded integer
 */
export function parseIntBounded(
    val: string | number,
    { min, max, fallback = 0 }: { min?: number; max?: number; fallback?: number } = {},
): number {
    const n = parseInt(typeof val === 'string' ? val : String(val), 10);
    if (isNaN(n)) return fallback;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
}
