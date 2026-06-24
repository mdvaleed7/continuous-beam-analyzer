/**
 * footingEngine.ts — IS 456:2000 Isolated Footing Design Engine
 *
 * Supports two footing types:
 *  • Flat footing (uniform thickness)
 *  • Slope footing (sloped pedestal with flat base)
 *
 * Design checks per IS 456:2000:
 *  1. Base area sizing from SBC
 *  2. Soil pressure check (p_max ≤ SBC)
 *  3. Punching shear (two-way shear) at the pedestal face
 *  4. One-way shear at effective depth from the pedestal face
 *  5. Flexural design (Ast per meter in both X and Z directions)
 *  6. Slope adequacy check (slope footings only)
 */

import {
    TAU_C_MAX,
    MU_LIM_COEFF,
    MIN_STEEL_RATIO,
    getTauC,
    getMuLimCoeff,
    getMinSteelRatio,
    type ConcreteGrade,
    type SteelGrade,
} from '../lib/is456';
// ponytail: was economicOptimization.ts — one line covers it
const computeCostIndex = (vol: number, steel: number, r = 90) => vol + steel * (r / 7850);

// ─── Types ───────────────────────────────────────────────────────────────────

export type FootingType = 'flat' | 'slope';

export interface FootingConfig {
    label: string;
    footingType: FootingType;
    // Column dimensions (mm)
    col_a: number;        // column size parallel X (mm)
    col_b: number;        // column size parallel Z (mm)
    // Unfactored forces from column
    Fy: number;           // axial load (kN)
    Mx: number;           // moment about X-axis (kN·m)
    Mz: number;           // moment about Z-axis (kN·m)
    // Soil parameters
    sbc: number;          // allowable bearing capacity (kN/m²)
    depthFill: number;    // depth of fill above NGL (m)
    gammaFill: number;    // unit weight of fill (kN/m³)
    gammaConcrete: number; // unit weight of concrete (kN/m³)
    // Material
    fck: number;
    fy: number;
    grade: string;
    steelGrade: string;
    cover: number;        // clear cover (mm)
    // Bar diameter selection
    barDiaX: number;      // bar diameter in X direction (mm)
    barDiaZ: number;      // bar diameter in Z direction (mm)
    // Footing dimensions (user-provided or computed)
    L: number;            // footing length parallel X (m) — provided
    B: number;            // footing breadth parallel Z (m) — provided
    D: number;            // overall depth (m) — provided
    // Pedestal (optional)
    pedestalOffset: number; // pedestal offset from column edge (mm), 0 = no pedestal
    pedestal_a: number;   // pedestal size parallel X (mm)
    pedestal_b: number;   // pedestal size parallel Z (mm)
    // Slope footing specific
    D1?: number;          // depth at pedestal edge (mm) — slope footing only
    // Additional weight percentage
    addnWtPercent: number; // additional weight of footing as % of column load
    // Shear strength of concrete (for punching shear check)
    shearStrength: number; // τc from IS 456 Table 19 (N/mm²)
}

export interface SoilPressureResult {
    p_min: number;        // minimum soil pressure (kN/m²)
    p_max: number;        // maximum soil pressure (kN/m²)
    p_avg: number;        // average soil pressure (kN/m²)
    eccentricityX: number; // eccentricity in X direction (m)
    eccentricityZ: number; // eccentricity in Z direction (m)
    sbcCheck: boolean;     // p_max ≤ SBC
    sbcCheckFactor: number; // SBC increase factor for lateral loads
}

export interface PunchingShearResult {
    perimeter_u: number;   // critical perimeter (mm)
    area_punched: number;  // area within critical perimeter (mm²)
    Vu: number;            // punching shear force (kN)
    tau_v: number;         // actual shear stress (N/mm²)
    tau_c: number;         // permissible shear stress (N/mm²)
    status: 'OK' | 'FAIL';
}

export interface OneWayShearResult {
    Vu: number;            // one-way shear force (kN)
    tau_v: number;         // actual shear stress (N/mm²)
    tau_c: number;         // permissible shear stress (N/mm²)
    status: 'OK' | 'FAIL';
}

export interface FlexuralDesignResult {
    Mu: number;            // design moment (kN·m)
    d: number;             // effective depth (mm)
    Ast_req: number;       // required steel area (mm²/m)
    Ast_min: number;       // minimum steel (mm²/m)
    Ast_max: number;       // maximum steel (mm²/m)
    pt: number;            // percentage of steel
    governs: string;       // 'design' | 'minimum' | 'maximum'
    isDoubly: boolean;
    status: 'SAFE' | 'REVISE';
}

export interface SlopeCheckResult {
    slopeAngleDeg: number;  // slope angle (degrees)
    isAdequate: boolean;    // slope is ≤ 1:1.5 (IS 456 recommended)
    note: string;
}

export interface FootingAnalysisResult {
    label: string;
    footingType: FootingType;
    // Echo inputs
    col_a: number;
    col_b: number;
    Fy: number;
    Mx: number;
    Mz: number;
    sbc: number;
    fck: number;
    fy: number;
    grade: string;
    steelGrade: string;
    cover: number;
    barDiaX: number;
    barDiaZ: number;
    L: number;
    B: number;
    D: number;
    D1: number | null;      // slope footing only
    pedestal_a: number;
    pedestal_b: number;
    pedestalOffset: number;
    addnWtPercent: number;
    // Computed results
    areaReq: number;        // required base area (m²)
    areaProv: number;       // provided base area (m²)
    dEffX: number;          // effective depth in X (mm)
    dEffZ: number;          // effective depth in Z (mm)
    totalLoad: number;      // total factored load including self-weight (kN)
    soilPressure: SoilPressureResult;
    punchingShear: PunchingShearResult;
    oneWayShearX: OneWayShearResult;
    oneWayShearZ: OneWayShearResult;
    flexureX: FlexuralDesignResult;
    flexureZ: FlexuralDesignResult;
    slopeCheck: SlopeCheckResult | null;  // slope footing only
    overallStatus: 'SAFE' | 'REVISE';
    // IS 456 constants used
    tau_c_max: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Flexural design per IS 456 Cl. 38 — singly reinforced, per-meter basis.
 */
function flexuralDesignPerMeter(
    Mu_kNm: number,
    d_mm: number,
    fck: number,
    fy: number,
): FlexuralDesignResult {
    const b = 1000; // 1 m strip
    const Mu = Math.abs(Mu_kNm) * 1e6; // N·mm
    const coeff = getMuLimCoeff(fy);
    const Mu_lim = coeff * fck * b * d_mm * d_mm;
    const minR = getMinSteelRatio(fy);
    const t_mm = d_mm + 50; // approximate gross thickness

    const Ast_min = minR * b * t_mm;
    const Ast_max = 0.04 * b * t_mm;

    if (Mu <= 0.001) {
        return {
            Mu: 0, d: d_mm,
            Ast_req: Math.ceil(Ast_min),
            Ast_min: Math.ceil(Ast_min),
            Ast_max: Math.floor(Ast_max),
            pt: 0, governs: 'minimum', isDoubly: false,
            status: 'SAFE',
        };
    }

    const isDoubly = Mu > Mu_lim;
    const ratio = 4.6 * Mu / (fck * b * d_mm * d_mm);
    const sqrtTerm = Math.sqrt(Math.max(0, 1 - ratio));
    let Ast_req = (0.5 * fck / fy) * (1 - sqrtTerm) * b * d_mm;

    let governs = 'design';
    if (Ast_req < Ast_min) { Ast_req = Ast_min; governs = 'minimum'; }
    else if (Ast_req > Ast_max) { Ast_req = Ast_max; governs = 'maximum'; }

    const pt = 100 * Ast_req / (b * d_mm);

    return {
        Mu: Math.abs(Mu_kNm),
        d: d_mm,
        Ast_req: Math.ceil(Ast_req),
        Ast_min: Math.ceil(Ast_min),
        Ast_max: Math.floor(Ast_max),
        pt: Math.round(pt * 1000) / 1000,
        governs,
        isDoubly,
        status: isDoubly ? 'REVISE' : 'SAFE',
    };
}

/**
 * Compute soil pressure under eccentric loading.
 * For a rectangular footing L × B with loads Fy, Mx, Mz:
 *   p = Fy/(L×B) ± Mx×B/(L×B²) ± Mz×L/(L²×B)
 */
function computeSoilPressure(
    L: number, B: number,
    Fy: number, Mx: number, Mz: number,
    sbc: number,
): SoilPressureResult {
    const area = L * B;
    const p_avg = Fy / area;

    // BUG 1 FIX: Mx (moment about X-axis) causes eccentricity in the Z
    // direction (parallel to B), and Mz (moment about Z-axis) causes
    // eccentricity in the X direction (parallel to L). The previous code
    // had these swapped.
    const eZ = Mx !== 0 ? Mx / Fy : 0; // eccentricity along Z due to Mx
    const eX = Mz !== 0 ? Mz / Fy : 0; // eccentricity along X due to Mz

    // Pressure variation: σ = F/A ± M·c/I
    // Mx acts about X-axis → pressure varies along B: Δp = 6·Mx/(L·B²)
    // Mz acts about Z-axis → pressure varies along L: Δp = 6·Mz/(L²·B)
    const pFromMx = 6 * Mx / (L * B * B); // pressure component from Mx
    const pFromMz = 6 * Mz / (L * L * B); // pressure component from Mz

    const p_max = p_avg + Math.abs(pFromMx) + Math.abs(pFromMz);
    const p_min = p_avg - Math.abs(pFromMx) - Math.abs(pFromMz);

    // SBC increase factor for lateral loads (25% increase per IS 1904)
    const sbcFactor = (Mx !== 0 || Mz !== 0) ? 1.25 : 1.0;
    const sbcCheck = p_max <= sbc * sbcFactor;

    return {
        p_min: Math.round(p_min * 100) / 100,
        p_max: Math.round(p_max * 100) / 100,
        p_avg: Math.round(p_avg * 100) / 100,
        eccentricityX: Math.round(eX * 1000) / 1000,
        eccentricityZ: Math.round(eZ * 1000) / 1000,
        sbcCheck,
        sbcCheckFactor: sbcFactor,
    };
}

// ─── Main Analysis ───────────────────────────────────────────────────────────

export function analyzeFooting(config: FootingConfig): FootingAnalysisResult {
    const {
        label, footingType,
        col_a, col_b,
        Fy, Mx, Mz,
        sbc, depthFill, gammaFill, gammaConcrete,
        fck, fy, grade, steelGrade, cover,
        barDiaX, barDiaZ,
        L, B, D,
        pedestalOffset, pedestal_a, pedestal_b,
        D1, addnWtPercent, shearStrength,
    } = config;

    // ── 1. Base area required ────────────────────────────────────────────────
    // The addnWtPercent IS the self-weight + fill weight approximation
    // (typically 10% of column load). Do NOT also subtract concrete/fill
    // weight from SBC — that double-counts.
    // Formula matches the reference Excel: areaReq = (Fy + addnWt) / SBC
    const selfWt = Fy * (addnWtPercent / 100);
    const areaReq = sbc > 0 ? (Fy + selfWt) / sbc : 0;
    const areaProv = L * B;

    // ── 2. Total load on soil ────────────────────────────────────────────────
    // Total = column load + self-weight approximation (addnWt%)
    // The addnWt% already covers footing self-weight + fill weight.
    const totalLoad = Fy + selfWt;

    // ── 3. Soil pressure check ──────────────────────────────────────────────
    const soilPressure = computeSoilPressure(L, B, totalLoad, Mx, Mz, sbc);

    // ── 4. Effective depth ──────────────────────────────────────────────────
    // For flat footing: d = D - cover - barDia/2 (uniform thickness)
    // For slope footing: D is the depth at the pedestal (thick end),
    //   D1 is the depth at the edge (thin end). The critical section for
    //   moment and shear is at the pedestal face, so use D (not D1) for
    //   effective depth. D1 is used only for the slope adequacy check.
    const D_mm = D * 1000;
    const D1_mm = D1 !== undefined ? D1 : D_mm; // edge depth (slope footing)
    const dEffX = D_mm - cover - barDiaZ / 2;     // X bars on top (larger d)
    const dEffZ = D_mm - cover - barDiaX - barDiaZ / 2; // Z bars below

    // ── 5. Punching shear (two-way shear) ───────────────────────────────────
    // Critical section at d/2 from the pedestal/column face
    const pedA = pedestal_a > 0 ? pedestal_a : col_a;
    const pedB = pedestal_b > 0 ? pedestal_b : col_b;
    const a1 = pedA / 1000; // pedestal dimension parallel X (m)
    const b1 = pedB / 1000; // pedestal dimension parallel Z (m)
    const d_avg = (dEffX + dEffZ) / 2;
    const d_m = d_avg / 1000;

    // Critical perimeter at d/2 from face
    const critA = a1 + d_m; // (m)
    const critB = b1 + d_m; // (m)
    const perimeter_u = 2 * (critA + critB) * 1000; // mm
    const area_punched = critA * critB; // m²
    const Vu_punch = soilPressure.p_max * (areaProv - area_punched); // kN
    const tau_v_punch = (Vu_punch * 1000) / (perimeter_u * d_avg); // N/mm²
    const tau_c_punch = shearStrength; // user-provided τc
    const punchingStatus: 'OK' | 'FAIL' = tau_v_punch <= tau_c_punch ? 'OK' : 'FAIL';

    // ── 6. One-way shear ────────────────────────────────────────────────────
    // Critical section at d from the pedestal face
    // X-direction: shear across width B, at distance d from pedestal face along L
    const distX = d_m; // distance from pedestal face (m)
    const lengthBeyondX = L / 2 - a1 / 2 - distX; // length beyond critical section
    const Vu_oneway_X = lengthBeyondX > 0 ? soilPressure.p_max * B * lengthBeyondX : 0;
    const tau_v_oneway_X = (Vu_oneway_X * 1000) / (B * 1000 * dEffX);
    const tau_c_oneway_X = shearStrength;
    const tau_c_oneway_Z = shearStrength;
    const onewayXStatus: 'OK' | 'FAIL' = tau_v_oneway_X <= tau_c_oneway_X ? 'OK' : 'FAIL';

    const lengthBeyondZ = B / 2 - b1 / 2 - distX;
    const Vu_oneway_Z = lengthBeyondZ > 0 ? soilPressure.p_max * L * lengthBeyondZ : 0;
    const tau_v_oneway_Z = (Vu_oneway_Z * 1000) / (L * 1000 * dEffZ);
    const onewayZStatus: 'OK' | 'FAIL' = tau_v_oneway_Z <= tau_c_oneway_Z ? 'OK' : 'FAIL';

    // ── 7. Flexural design ──────────────────────────────────────────────────
    // Moment at the face of the pedestal: M = p * l² / 2 (cantilever action)
    // X-direction: cantilever length = (L - a1) / 2, moment per meter width = p_max * l² / 2
    const cantLX = (L - a1) / 2; // m
    const Mx_flex = soilPressure.p_max * cantLX * cantLX / 2; // kN·m per meter
    const flexureX = flexuralDesignPerMeter(Mx_flex, dEffX, fck, fy);

    const cantLZ = (B - b1) / 2; // m
    const Mz_flex = soilPressure.p_max * cantLZ * cantLZ / 2; // kN·m per meter
    const flexureZ = flexuralDesignPerMeter(Mz_flex, dEffZ, fck, fy);

    // ── 8. Slope check (slope footing only) ─────────────────────────────────
    let slopeCheck: SlopeCheckResult | null = null;
    if (footingType === 'slope') {
        const slopeRun = (L / 2 - a1 / 2) * 1000; // horizontal run (mm)
        const slopeRise = D_mm - (D1 ?? D_mm); // vertical rise from edge to pedestal (mm)
        const slopeAngleDeg = slopeRun > 0 ? Math.atan(slopeRise / slopeRun) * 180 / Math.PI : 0;
        // IS 456 recommends slope ≤ 1:1 for footings (slope angle ≤ 45°)
        // Many practices use 1:1.5 (angle ≤ 33.7°)
        const isAdequate = slopeAngleDeg <= 45 && slopeRise > 0;
        slopeCheck = {
            slopeAngleDeg: Math.round(slopeAngleDeg * 10) / 10,
            isAdequate,
            note: isAdequate
                ? `Slope angle ${Math.round(slopeAngleDeg * 10) / 10}° ≤ 45° — adequate`
                : `Slope angle ${Math.round(slopeAngleDeg * 10) / 10}° > 45° — revise depth`,
        };
    }

    // ── 9. Overall status ───────────────────────────────────────────────────
    const allChecks = [
        soilPressure.sbcCheck,
        punchingStatus === 'OK',
        onewayXStatus === 'OK',
        onewayZStatus === 'OK',
        flexureX.status === 'SAFE',
        flexureZ.status === 'SAFE',
        ...(slopeCheck ? [slopeCheck.isAdequate] : []),
    ];
    const overallStatus: 'SAFE' | 'REVISE' = allChecks.every(Boolean) ? 'SAFE' : 'REVISE';

    return {
        label,
        footingType,
        col_a, col_b,
        Fy, Mx, Mz,
        sbc,
        fck, fy, grade, steelGrade, cover,
        barDiaX, barDiaZ,
        L, B, D,
        D1: footingType === 'slope' ? (D1 ?? null) : null,
        pedestal_a, pedestal_b, pedestalOffset,
        addnWtPercent,
        areaReq: Math.round(areaReq * 100) / 100,
        areaProv: Math.round(areaProv * 100) / 100,
        dEffX: Math.round(dEffX),
        dEffZ: Math.round(dEffZ),
        totalLoad: Math.round(totalLoad),
        soilPressure,
        punchingShear: {
            perimeter_u: Math.round(perimeter_u),
            area_punched: Math.round(area_punched * 1e6) / 1e6,
            Vu: Math.round(Vu_punch * 100) / 100,
            tau_v: Math.round(tau_v_punch * 1000) / 1000,
            tau_c: tau_c_punch,
            status: punchingStatus,
        },
        oneWayShearX: {
            Vu: Math.round(Vu_oneway_X * 100) / 100,
            tau_v: Math.round(tau_v_oneway_X * 1000) / 1000,
            tau_c: tau_c_oneway_X,
            status: onewayXStatus,
        },
        oneWayShearZ: {
            Vu: Math.round(Vu_oneway_Z * 100) / 100,
            tau_v: Math.round(tau_v_oneway_Z * 1000) / 1000,
            tau_c: tau_c_oneway_Z,
            status: onewayZStatus,
        },
        flexureX,
        flexureZ,
        slopeCheck,
        overallStatus,
        tau_c_max: TAU_C_MAX[grade as ConcreteGrade] ?? 2.8,
    };
}

// ─── Multi-footing analysis ──────────────────────────────────────────────────

export function analyzeFootings(configs: FootingConfig[]): FootingAnalysisResult[] {
    return configs.map(analyzeFooting);
}

// ─── Constants for UI ────────────────────────────────────────────────────────

export interface FootingTypeOption {
    value: FootingType;
    label: string;
    desc: string;
}

export const FOOTING_TYPES: readonly FootingTypeOption[] = [
    { value: 'flat', label: 'Flat Footing', desc: 'Uniform thickness throughout' },
    { value: 'slope', label: 'Slope Footing', desc: 'Sloped top with flat base (pedestal at column)' },
];

// ═══════════════════════════════════════════════════════════════
//  OPTIMIZER
// ═══════════════════════════════════════════════════════════════
export interface FootingOptimizeParams {
    minL: number; maxL: number; stepL: number;
    minB: number; maxB: number; stepB: number;
    minD: number; maxD: number; stepD: number;
}

export interface OptimumFootingDesign {
    L: number;
    B: number;
    D: number;
    volume: number;
    costIndex: number;
    result: FootingAnalysisResult;
}

export interface FootingOptimizeResult {
    totalTrials: number;
    feasibleCount: number;
    topDesigns: OptimumFootingDesign[];
    optimum: OptimumFootingDesign | null;
    costRatioUsed: number;
}

export type FootingProgressCallback = (done: number, total: number, feasible: number) => void;

/**
 * Optimize footing dimensions by sweeping a range of L, B, and D to find
 * the combination with the minimum concrete volume that satisfies all checks.
 */
export function optimizeFooting(
    config: FootingConfig,
    params: FootingOptimizeParams,
    costRatio: number = 90,
    onProgress?: FootingProgressCallback
): FootingOptimizeResult {
    const results: OptimumFootingDesign[] = [];
    const { minL, maxL, stepL, minB, maxB, stepB, minD, maxD, stepD } = params;

    // Calculate total combinations
    const numL = Math.max(1, Math.floor((maxL - minL) / stepL) + 1);
    const numB = Math.max(1, Math.floor((maxB - minB) / stepB) + 1);
    const numD = Math.max(1, Math.floor((maxD - minD) / stepD) + 1);
    const total = numL * numB * numD;
    
    let done = 0;

    for (let L = minL; L <= maxL; L += stepL) {
        for (let B = minB; B <= maxB; B += stepB) {
            for (let D = minD; D <= maxD; D += stepD) {
                done++;
                try {
                    const trialConfig = { ...config, L, B, D };
                    // For slope footings, assume D1 is fixed or linearly related,
                    // but for optimization we just use D as the pedestal depth.
                    // If D1 is specified, we leave it as is, provided it's <= D.
                    if (trialConfig.footingType === 'slope' && trialConfig.D1 !== undefined) {
                        trialConfig.D1 = Math.min(trialConfig.D1, D * 1000); // ensure D1 <= D_mm
                    }
                    
                    const result = analyzeFooting(trialConfig);

                    if (result.overallStatus === 'SAFE') {
                        // Calculate volume for sorting. 
                        // Flat footing volume: L * B * D
                        // Slope footing volume: complex, but roughly we can just use L*B*D as an upper bound or compute exact.
                        // For simplicity in optimization ranking, L * B * D is sufficient.
                        let volume = L * B * D;
                        if (trialConfig.footingType === 'slope') {
                            const pedA = trialConfig.pedestal_a > 0 ? trialConfig.pedestal_a / 1000 : trialConfig.col_a / 1000;
                            const pedB = trialConfig.pedestal_b > 0 ? trialConfig.pedestal_b / 1000 : trialConfig.col_b / 1000;
                            const D1_m = (trialConfig.D1 ?? (D * 1000)) / 1000;
                            const A1 = pedA * pedB;
                            const A2 = L * B;
                            // Frustum volume + base volume
                            volume = L * B * D1_m + (D - D1_m) / 3 * (A1 + A2 + Math.sqrt(A1 * A2));
                        }

                        // Calculate steel weight (using required area since actual bars aren't selected here)
                        // Ast_req is mm² per meter width.
                        const steelWeight = ((result.flexureX.Ast_req + result.flexureZ.Ast_req) * L * B * 7850) / 1e6;
                        
                        const costIndex = computeCostIndex(volume, steelWeight, costRatio);

                        results.push({
                            L: Math.round(L * 100) / 100,
                            B: Math.round(B * 100) / 100,
                            D: Math.round(D * 100) / 100,
                            volume, costIndex, result
                        });
                    }
                } catch (e) {
                    // Skip invalid
                }

                if (onProgress && (done % 50 === 0 || done === total)) {
                    onProgress(done, total, results.length);
                }
            }
        }
    }

    // Sort by cost index ascending
    results.sort((a, b) => a.costIndex - b.costIndex);

    return {
        totalTrials: total,
        feasibleCount: results.length,
        topDesigns: results.slice(0, 10),
        optimum: results.length > 0 ? results[0] : null,
        costRatioUsed: costRatio,
    };
}

