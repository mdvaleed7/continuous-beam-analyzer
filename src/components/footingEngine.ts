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
    getTauC,
    flexuralDesign as flexuralDesignShared,
    computeRequiredDepthForBM,
    computeCostIndex,
    type ConcreteGrade,
} from '../lib/is456';

// ─── Types ───────────────────────────────────────────────────────────────────

type FootingType = 'flat' | 'slope';

/**
 * A single load case for a footing. The user enters multiple load cases
 * (e.g. DL+LL, DL+WL, DL+LL+EQ, …) and the engine envelopes them to find
 * the governing combination for each design check:
 *   • Max Mx  + corresponding Mz, Fy
 *   • Max Mz  + corresponding Mx, Fy
 *   • Max Fy  + corresponding Mx, Mz
 * Each load case can also have its own SBC (lateral-load cases allow a 25%
 * increase per IS 1904, captured separately by the user).
 */
export interface LoadCase {
    label: string;        // e.g. "LC1: DL+LL"
    Fy: number;           // axial load (kN) — unfactored service load
    Mx: number;           // moment about X-axis (kN·m)
    Mz: number;           // moment about Z-axis (kN·m)
    sbc: number;          // permissible SBC for this load case (kN/m²)
}

export interface FootingConfig {
    label: string;
    footingType: FootingType;
    // Column dimensions (mm)
    col_a: number;        // column size parallel X (mm)
    col_b: number;        // column size parallel Z (mm)
    // ─── Load cases ────────────────────────────────────────────────────────
    // The new multi-load-case API. Each entry is a full load case with its
    // own Fy/Mx/Mz/sbc. The engine envelopes across all load cases.
    loadCases: LoadCase[];
    // ─── Legacy single-load-case fields (kept for backwards compat) ────────
    // If loadCases is empty, the engine falls back to these single values.
    Fy: number;           // axial load (kN)
    Mx: number;           // moment about X-axis (kN·m)
    Mz: number;           // moment about Z-axis (kN·m)
    sbc: number;          // allowable bearing capacity (kN/m²)
    // Soil parameters
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
    // NOTE: addnWtPercent and shearStrength are DEPRECATED.
    //   • Footing self-weight is now computed from actual geometry:
    //       W_concrete = L × B × D × γConcrete
    //       W_fill     = (L × B − col_a × col_b) × depthFill × γFill
    //   • τc is now computed inbuilt from IS 456 Table 19 via getTauC(pt, grade),
    //     so changing the concrete grade automatically updates the shear
    //     capacity at the backend.
    addnWtPercent?: number;  // deprecated — ignored
    shearStrength?: number;  // deprecated — ignored
}

interface SoilPressureResult {
    p_min: number;        // minimum soil pressure (kN/m²)
    p_max: number;        // maximum soil pressure (kN/m²)
    p_avg: number;        // average soil pressure (kN/m²)
    eccentricityX: number; // eccentricity in X direction (m)
    eccentricityZ: number; // eccentricity in Z direction (m)
    sbcCheck: boolean;     // p_max ≤ SBC
    sbcCheckFactor: number; // SBC increase factor for lateral loads
}

interface PunchingShearResult {
    perimeter_u: number;   // critical perimeter (mm)
    area_punched: number;  // area within critical perimeter (mm²)
    Vu: number;            // punching shear force (kN)
    tau_v: number;         // actual shear stress (N/mm²)
    tau_c: number;         // permissible shear stress (N/mm²)
    status: 'OK' | 'FAIL';
}

interface OneWayShearResult {
    Vu: number;            // one-way shear force (kN)
    tau_v: number;         // actual shear stress (N/mm²)
    tau_c: number;         // permissible shear stress (N/mm²)
    status: 'OK' | 'FAIL';
}

interface FlexuralDesignResult {
    Mu: number;            // design moment (kN·m)
    d: number;             // effective depth provided (mm)
    Ast_req: number;       // required steel area (mm²/m)
    Ast_min: number;       // minimum steel (mm²/m)
    Ast_max: number;       // maximum steel (mm²/m)
    pt: number;            // percentage of steel
    governs: string;       // 'design' | 'minimum' | 'maximum'
    isDoubly: boolean;
    status: 'SAFE' | 'REVISE';
    // IS 456 Cl. 38.1: d_req = √(M / (R·b)) — minimum effective depth from BM
    d_req_bm: number;      // required effective depth from BM consideration (mm)
    depthStatus: 'OK' | 'FAIL';  // d_provided ≥ d_req_bm ?
}

interface SlopeCheckResult {
    slopeAngleDeg: number;  // slope angle (degrees)
    isAdequate: boolean;    // slope is ≤ 1:1.5 (IS 456 recommended)
    note: string;
}

/** Result of analysing ONE load case (before enveloping). */
export interface LoadCaseResult {
    label: string;
    Fy: number;
    Mx: number;
    Mz: number;
    sbc: number;
    totalLoad: number;          // column load + actual self-weight + fill (kN)
    selfWeight: number;         // footing self-weight (kN) — actual geometry
    fillWeight: number;         // fill above footing (kN) — actual geometry
    soilPressure: SoilPressureResult;
    punchingShear: PunchingShearResult;
    oneWayShearX: OneWayShearResult;
    oneWayShearZ: OneWayShearResult;
    flexureX: FlexuralDesignResult;
    flexureZ: FlexuralDesignResult;
    overallStatus: 'SAFE' | 'REVISE';
}

export interface FootingAnalysisResult {
    label: string;
    footingType: FootingType;
    // Echo inputs
    col_a: number;
    col_b: number;
    Fy: number;           // governing (envelope) axial — for backwards-compat
    Mx: number;           // governing (envelope) Mx
    Mz: number;           // governing (envelope) Mz
    sbc: number;          // governing SBC
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
    addnWtPercent: number;  // deprecated — kept as 0 for backwards-compat
    // Computed results
    areaReq: number;        // required base area (m²)
    areaProv: number;       // provided base area (m²)
    dEffX: number;          // effective depth in X (mm)
    dEffZ: number;          // effective depth in Z (mm)
    totalLoad: number;      // total factored load including self-weight (kN) — governing LC
    selfWeight: number;     // footing self-weight (kN) — actual geometry
    fillWeight: number;     // fill weight (kN) — actual geometry
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
    // Inbuilt τc from IS 456 Table 19 (computed from pt + grade)
    tau_c_inbuilt: number;
    pt_used: number;        // % steel used for τc lookup
    // ─── Multi-load-case results ──────────────────────────────────────────
    loadCases: LoadCaseResult[];   // per-load-case full results
    governingLoadCase: string;     // label of the governing load case
    envelope: {
        maxMx: LoadCaseResult | null;   // LC with maximum |Mx|
        maxMz: LoadCaseResult | null;   // LC with maximum |Mz|
        maxFy: LoadCaseResult | null;   // LC with maximum Fy
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// ponytail: flexuralDesign imported from ../lib/is456 — thin wrapper for footing-specific return shape.
// BUG-FT2 FIX: pass D_mm (gross depth) so Ast_min/Ast_max use the real gross
// section D instead of the slab-convention default (d+50). For footings with
// 50 mm cover, gross depth ≈ d+58, so the previous d+50 under-provisioned
// minimum steel by ~1.5%.
function flexuralDesignPerMeter(Mu_kNm: number, d_mm: number, fck: number, fy: number, D_mm: number): FlexuralDesignResult {
    const r = flexuralDesignShared(Mu_kNm, 1000, d_mm, fck, fy, D_mm);
    // IS 456 Cl. 38.1: d = √(M / (R·b))  where R = coeff × fck
    const { d_req } = computeRequiredDepthForBM(Mu_kNm, fck, fy, 1000);
    return {
        Mu: r.Mu_applied ?? 0, d: d_mm,
        Ast_req: r.Ast_req, Ast_min: r.Ast_min ?? 0, Ast_max: r.Ast_max ?? 0,
        pt: r.pt ?? 0, governs: r.governs, isDoubly: r.isDoubly,
        status: r.isDoubly ? 'REVISE' : 'SAFE',
        d_req_bm: Math.round(d_req * 100) / 100,
        depthStatus: d_mm >= d_req ? 'OK' : 'FAIL',
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
        sbc: sbcLegacy, depthFill, gammaFill, gammaConcrete,
        fck, fy, grade, steelGrade, cover,
        barDiaX, barDiaZ,
        L, B, D,
        pedestalOffset, pedestal_a, pedestal_b,
        D1,
    } = config;

    // ── Resolve the load-case list ─────────────────────────────────────────
    // New API: config.loadCases. Legacy fallback: single Fy/Mx/Mz/sbc.
    const loadCases: LoadCase[] = config.loadCases && config.loadCases.length > 0
        ? config.loadCases
        : [{ label: 'LC1', Fy: config.Fy, Mx: config.Mx, Mz: config.Mz, sbc: config.sbc }];

    // ── Effective depth (geometry-dependent, same for all LCs) ─────────────
    const D_mm = D * 1000;
    const D1_mm = D1 !== undefined ? D1 : D_mm;
    const dEffX = D_mm - cover - barDiaZ / 2;
    const dEffZ = D_mm - cover - barDiaX - barDiaZ / 2;

    // ── Pedestal / column geometry ─────────────────────────────────────────
    const pedA = pedestalOffset > 0 ? col_a + 2 * pedestalOffset : col_a;
    const pedB = pedestalOffset > 0 ? col_b + 2 * pedestalOffset : col_b;
    const pedDepth_m = pedestalOffset > 0 ? pedestalOffset / 1000 : 0;
    const a1 = pedA / 1000;
    const b1 = pedB / 1000;
    const d_avg = (dEffX + dEffZ) / 2;
    const d_m = d_avg / 1000;
    const critA = a1 + d_m;
    const critB = b1 + d_m;
    const perimeter_u = 2 * (critA + critB) * 1000;
    const area_punched = critA * critB;
    const areaProv = L * B;

    // ── ACTUAL footing self-weight (replaces 10% addnWtPercent) ────────────
    // Flat footing: W_concrete = L × B × D × γConcrete + pedestal_volume
    // Slope footing: frustum volume × γConcrete + pedestal_volume
    //   V_frustum = (D − D1)/3 × (A1 + A2 + √(A1·A2))  +  L·B·D1
    // Fill weight: (L × B − pedA × pedB) × depthFill × γFill
    let concreteVol = L * B * D; // flat footing (m³)
    if (footingType === 'slope') {
        const A1 = a1 * b1;
        const A2 = L * B;
        const D1_m = D1_mm / 1000;
        concreteVol = L * B * D1_m + (D - D1_m) / 3 * (A1 + A2 + Math.sqrt(A1 * A2));
    }
    // Add pedestal volume
    if (pedestalOffset > 0) {
        concreteVol += a1 * b1 * pedDepth_m;
    }
    const selfWeight = concreteVol * gammaConcrete; // kN
    const fillWeight = Math.max(0, (L * B - a1 * b1)) * depthFill * gammaFill;
    const footingWeight = selfWeight + fillWeight; // total permanent load (kN)

    // ── Inbuilt τc from IS 456 Table 19 (replaces user-provided shearStrength) ─
    // τc depends on pt (% tensile steel) and fck. For footings the steel is
    // the flexural steel in the critical section. Use the governing flexure
    // pt — but since pt is only known AFTER flexure design, we iterate:
    // first pass with pt_min (0.12% / 0.15%) → get Ast → recompute pt → τc.
    // For simplicity and conservatism, use pt = 0.15 (the Table 19 floor).
    // This gives the minimum τc, which is safe. The user explicitly wants
    // grade-based τc: getTauC automatically looks up by grade.
    const pt_initial = 0.15; // Table 19 floor — conservative
    const gradeStr = grade as ConcreteGrade;
    const tau_c_inbuilt = getTauC(pt_initial, gradeStr);
    const tau_c_max_val = TAU_C_MAX[gradeStr] ?? 2.8;

    // ── Slope check (geometry-only, same for all LCs) ──────────────────────
    let slopeCheck: SlopeCheckResult | null = null;
    if (footingType === 'slope') {
        const slopeRun = (L / 2 - a1 / 2) * 1000;
        const slopeRise = D_mm - (D1 ?? D_mm);
        const slopeAngleDeg = slopeRun > 0 ? Math.atan(slopeRise / slopeRun) * 180 / Math.PI : 0;
        const isAdequate = slopeAngleDeg <= 45 && slopeRise > 0;
        slopeCheck = {
            slopeAngleDeg: Math.round(slopeAngleDeg * 10) / 10,
            isAdequate,
            note: isAdequate
                ? `Slope angle ${Math.round(slopeAngleDeg * 10) / 10}° ≤ 45° — adequate`
                : `Slope angle ${Math.round(slopeAngleDeg * 10) / 10}° > 45° — revise depth`,
        };
    }

    // ── Base area required (from the largest total load / smallest SBC) ────
    const maxTotalLoad = Math.max(...loadCases.map(lc => lc.Fy + footingWeight));
    const minSbc = Math.min(...loadCases.map(lc => lc.sbc));
    const areaReq = minSbc > 0 ? maxTotalLoad / minSbc : 0;

    // ── Per-load-case analysis ─────────────────────────────────────────────
    const lcResults: LoadCaseResult[] = loadCases.map(lc => {
        const totalLoad = lc.Fy + footingWeight;
        const soilPressure = computeSoilPressure(L, B, totalLoad, lc.Mx, lc.Mz, lc.sbc);

        // Punching shear
        const Vu_punch = soilPressure.p_max * (areaProv - area_punched);
        const tau_v_punch = (Vu_punch * 1000) / (perimeter_u * d_avg);
        const punchingStatus: 'OK' | 'FAIL' = tau_v_punch <= tau_c_inbuilt ? 'OK' : 'FAIL';

        // One-way shear X
        const distX_m = dEffX / 1000;
        const lengthBeyondX = L / 2 - a1 / 2 - distX_m;
        const Vu_oneway_X = lengthBeyondX > 0 ? soilPressure.p_max * B * lengthBeyondX : 0;
        const tau_v_oneway_X = (Vu_oneway_X * 1000) / (B * 1000 * dEffX);
        const onewayXStatus: 'OK' | 'FAIL' = tau_v_oneway_X <= tau_c_inbuilt ? 'OK' : 'FAIL';

        // One-way shear Z
        const distZ_m = dEffZ / 1000;
        const lengthBeyondZ = B / 2 - b1 / 2 - distZ_m;
        const Vu_oneway_Z = lengthBeyondZ > 0 ? soilPressure.p_max * L * lengthBeyondZ : 0;
        const tau_v_oneway_Z = (Vu_oneway_Z * 1000) / (L * 1000 * dEffZ);
        const onewayZStatus: 'OK' | 'FAIL' = tau_v_oneway_Z <= tau_c_inbuilt ? 'OK' : 'FAIL';

        // Flexure
        const cantLX = (L - a1) / 2;
        const Mx_flex = soilPressure.p_max * cantLX * cantLX / 2;
        const flexureX = flexuralDesignPerMeter(Mx_flex, dEffX, fck, fy, D_mm);
        const cantLZ = (B - b1) / 2;
        const Mz_flex = soilPressure.p_max * cantLZ * cantLZ / 2;
        const flexureZ = flexuralDesignPerMeter(Mz_flex, dEffZ, fck, fy, D_mm);

        const allChecks = [
            soilPressure.sbcCheck,
            punchingStatus === 'OK',
            onewayXStatus === 'OK',
            onewayZStatus === 'OK',
            flexureX.status === 'SAFE',
            flexureZ.status === 'SAFE',
            flexureX.depthStatus === 'OK',
            flexureZ.depthStatus === 'OK',
        ];
        const overallStatus: 'SAFE' | 'REVISE' = allChecks.every(Boolean) ? 'SAFE' : 'REVISE';

        return {
            label: lc.label,
            Fy: lc.Fy, Mx: lc.Mx, Mz: lc.Mz, sbc: lc.sbc,
            totalLoad: Math.round(totalLoad),
            selfWeight: Math.round(selfWeight * 10) / 10,
            fillWeight: Math.round(fillWeight * 10) / 10,
            soilPressure,
            punchingShear: {
                perimeter_u: Math.round(perimeter_u),
                area_punched: Math.round(area_punched * 1e6) / 1e6,
                Vu: Math.round(Vu_punch * 100) / 100,
                tau_v: Math.round(tau_v_punch * 1000) / 1000,
                tau_c: Math.round(tau_c_inbuilt * 1000) / 1000,
                status: punchingStatus,
            },
            oneWayShearX: {
                Vu: Math.round(Vu_oneway_X * 100) / 100,
                tau_v: Math.round(tau_v_oneway_X * 1000) / 1000,
                tau_c: Math.round(tau_c_inbuilt * 1000) / 1000,
                status: onewayXStatus,
            },
            oneWayShearZ: {
                Vu: Math.round(Vu_oneway_Z * 100) / 100,
                tau_v: Math.round(tau_v_oneway_Z * 1000) / 1000,
                tau_c: Math.round(tau_c_inbuilt * 1000) / 1000,
                status: onewayZStatus,
            },
            flexureX, flexureZ,
            overallStatus,
        };
    });

    // ── Envelope: find governing LC for max |Mx|, max |Mz|, max Fy ──────────
    const maxMxLC = lcResults.reduce((best, r) =>
        Math.abs(r.Mx) > Math.abs(best?.Mx ?? 0) ? r : best, null as LoadCaseResult | null);
    const maxMzLC = lcResults.reduce((best, r) =>
        Math.abs(r.Mz) > Math.abs(best?.Mz ?? 0) ? r : best, null as LoadCaseResult | null);
    const maxFyLC = lcResults.reduce((best, r) =>
        r.Fy > (best?.Fy ?? 0) ? r : best, null as LoadCaseResult | null);

    // The "governing" LC for the top-level result is the one with the worst
    // overall status (REVISE beats SAFE); among tied, the one with max p_max.
    const governing = lcResults.find(r => r.overallStatus === 'REVISE')
        ?? lcResults.reduce((best, r) =>
            r.soilPressure.p_max > best.soilPressure.p_max ? r : best, lcResults[0]);

    // ── Overall status = worst across all LCs ──────────────────────────────
    const overallStatus: 'SAFE' | 'REVISE' = lcResults.some(r => r.overallStatus === 'REVISE')
        ? 'REVISE' : 'SAFE';

    return {
        label, footingType,
        col_a, col_b,
        Fy: governing.Fy, Mx: governing.Mx, Mz: governing.Mz, sbc: governing.sbc,
        fck, fy, grade, steelGrade, cover,
        barDiaX, barDiaZ,
        L, B, D,
        D1: footingType === 'slope' ? (D1 ?? null) : null,
        pedestal_a, pedestal_b, pedestalOffset,
        addnWtPercent: 0, // deprecated
        areaReq: Math.round(areaReq * 100) / 100,
        areaProv: Math.round(areaProv * 100) / 100,
        dEffX: Math.round(dEffX),
        dEffZ: Math.round(dEffZ),
        totalLoad: governing.totalLoad,
        selfWeight: Math.round(selfWeight * 10) / 10,
        fillWeight: Math.round(fillWeight * 10) / 10,
        soilPressure: governing.soilPressure,
        punchingShear: governing.punchingShear,
        oneWayShearX: governing.oneWayShearX,
        oneWayShearZ: governing.oneWayShearZ,
        flexureX: governing.flexureX,
        flexureZ: governing.flexureZ,
        slopeCheck,
        overallStatus,
        tau_c_max: tau_c_max_val,
        tau_c_inbuilt: Math.round(tau_c_inbuilt * 1000) / 1000,
        pt_used: pt_initial,
        loadCases: lcResults,
        governingLoadCase: governing.label,
        envelope: {
            maxMx: maxMxLC,
            maxMz: maxMzLC,
            maxFy: maxFyLC,
        },
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

interface OptimumFootingDesign {
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
                            const pedA = trialConfig.pedestalOffset > 0 ? trialConfig.col_a / 1000 + 2 * trialConfig.pedestalOffset / 1000 : trialConfig.col_a / 1000;
                            const pedB = trialConfig.pedestalOffset > 0 ? trialConfig.col_b / 1000 + 2 * trialConfig.pedestalOffset / 1000 : trialConfig.col_b / 1000;
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

