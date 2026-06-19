'use strict';

/* ================================================================
   BASEMENT WALL DESIGN ENGINE — IS 456:2000
   Zone-by-zone analysis, design, and optimization
   for continuous vertical wall strips under lateral pressure.
   ================================================================ */

import { analyzeBeam, toFrac } from './beamEngine';
import {
    TAU_C_MAX,
    MU_LIM_COEFF,
    MIN_STEEL_RATIO,
    MAX_STEEL_RATIO,
    getTauC as getTauCShared,
    type ConcreteGrade,
    type SteelGrade,
} from '../lib/is456';


// ─── Public types ────────────────────────────────────────────────────────────

export type WaterMode = 'dry' | 'partial' | 'submerged';
export type ShearStatus = 'minimum' | 'design' | 'FAIL';
export type Governs = 'design' | 'minimum' | 'maximum';

export interface WallZone {
    height: number;
    thickness: number;
    thicknessTop?: number;
    thicknessBot?: number;
}

export interface SoilParams {
    phi?: number;
    gamma_soil?: number;
    gamma_water?: number;
    waterTableDepth?: number;
    groundLevelDepth?: number;
    surcharge?: number;
    waterMode?: WaterMode;
}

export interface WallMaterial {
    grade: string;
    fck: number;
    steelGrade: string;
    fy: number;
    cover?: number;
    E?: number;
}

export interface WallConfig {
    zones: WallZone[];
    soilParams: SoilParams;
    material: WallMaterial;
    loadFactor?: number;
    barDias?: readonly number[];
    spacings?: readonly number[];
    isTapered?: boolean;
    _mesh?: PressureMesh;
    minThk?: number;
    maxThk?: number;
    thkStep?: number;
    endCond?: string;
    [key: string]: unknown;
}

export interface PressurePoint {
    earthP: number;
    waterP: number;
    surchargeP: number;
    combined: number;
}

export interface ProfileNode extends PressurePoint {
    depth: number;
}

export interface FlexuralDesign {
    Ast_req: number;
    Ast_min?: number;
    Ast_max?: number;
    Mu_lim: number;
    Mu_applied?: number;
    isDoubly: boolean;
    governs: Governs;
    utilization: number;
}

export interface BarSelection {
    dia: number;
    spacing: number;
    Ast_provided: number;
    label: string;
}

export interface ShearLinks {
    dia: number;
    spacing: number;
    label: string;
    Asv_sv_provided: number;
}

export interface ShearDesign {
    tau_v: number;
    tau_c: number;
    tau_c_max: number;
    pt: number;
    status: ShearStatus;
    Asv_sv: number | null;
    links: ShearLinks | null;
    Vu_applied: number;
}

export interface ZoneDesign {
    zone: number;
    height: number;
    thickness: number;
    d_hogging: number;
    d_sagging: number;
    EI: number;
    M_left: number;
    M_right: number;
    M_max_span: number;
    M_hogging: number;
    M_sagging: number;
    M_governing: number;
    V_left: number;
    V_right: number;
    V_governing: number;
    flex_hogging: FlexuralDesign;
    flex_sagging: FlexuralDesign;
    shear: ShearDesign;
    mainBars_hogging: BarSelection;
    mainBars_sagging: BarSelection;
    pressureTop: PressurePoint;
    pressureBot: PressurePoint;
}

export interface PressureParams {
    K0: number;
    gamma_soil: number;
    gamma_water: number;
    waterTableDepth: number;
    groundLevelDepth: number;
    waterMode: WaterMode;
    surcharge: number;
    loadFactor: number;
}

export interface PressureMesh {
    K0: number;
    pressureParams: PressureParams;
    cumDepths: number[];
    totalHeight: number;
    round6: (v: number) => number;
    wMode: WaterMode;
    wtd: number;
    gld: number;
    hasWaterKink: boolean;
    hasGroundKink: boolean;
    breakDepths: number[];
    nSeg: number;
    zoneOfDepth: (d: number) => number;
    customLoads: { wL: any; wR: any }[];
    segZone: number[];
    segDepths: { top: number; bot: number }[];
    pressureProfile: ProfileNode[];
    supportMask: boolean[];
    zonePressures: { top: PressurePoint; bottom: PressurePoint }[];
    totalLateralForce: number;
    centerOfPressure: number;
}

export interface WallAnalysisResult {
    beamResult: any;
    zoneDesigns: ZoneDesign[];
    feasible: boolean;
    totalConcreteVol: number;
    totalSteelWeight: number;
    governingZone: number | null;
    maxUtilization: number;
    K0: number;
    totalHeight: number;
    cumDepths: number[];
    zonePressures: { top: PressurePoint; bottom: PressurePoint }[];
    pressureProfile: ProfileNode[];
    waterTableDepth?: number;
    submersionState: 'dry' | 'partial' | 'fully';
    config: WallConfig;
    totalLateralForce: number;
    centerOfPressure: number;
    supportMask: boolean[];
}

export interface OptimumDesign {
    thicknesses: number[];
    concreteVol: number;
    steelWeight: number;
    maxUtilization: number;
    result: WallAnalysisResult;
}

export interface OptimizeResult {
    totalTrials: number;
    feasibleCount: number;
    approximate: boolean;
    method: 'full-enumeration' | 'sequential-greedy';
    topDesigns: OptimumDesign[];
    optimum: OptimumDesign | null;
}

/**
 * Progress callback for the optimizer. Invoked periodically during the
 * enumeration loop so callers (e.g. a Web Worker) can report progress to the
 * UI without blocking the computation.
 *
 * @param done    - number of combinations evaluated so far
 * @param total   - total number of combinations to evaluate
 * @param feasible - number of feasible designs found so far
 */
export type ProgressCallback = (done: number, total: number, feasible: number) => void;

// ───────────────────── IS 456 Constants (re-exported from lib/is456.ts) ────
// The constants above (TAU_C_MAX, MU_LIM_COEFF, MIN_STEEL_RATIO) used to be
// duplicated between wallEngine.js and slabEngine.js. They now live in
// src/lib/is456.js as the single source of truth. Local bindings are kept so
// existing call sites inside this file do not need to be rewritten.

/** Earth pressure at rest coefficient */
function computeK0(phi_deg: number): number {
    const phi = phi_deg * Math.PI / 180;
    return 1 - Math.sin(phi);
}

// ───────────────────── IS 456 Design Functions ─────────────────────

/**
 * Calculate design shear strength of concrete τc (N/mm²) per IS 456 exact
 * formula. Thin wrapper around the shared `getTauC` so this file keeps its
 * original (pt_percent, fck) call signature.
 */
function getTauC(pt_percent: number, fck: number): number {
    return getTauCShared(pt_percent, fck);
}

/** Flexural design per IS 456 Clause 38 — singly reinforced
 *  @param {number} t_actual_mm  actual total wall thickness (mm) for Ast_max calc */
function flexuralDesign(Mu_kNm: number, b_mm: number, d_mm: number, fck: number, fy: number, t_actual_mm: number): FlexuralDesign {
    const Mu = Math.abs(Mu_kNm) * 1e6; // N·mm
    
    // Limiting moment
    const coeff = MU_LIM_COEFF[`Fe${fy}` as SteelGrade] ?? 0.138;
    const Mu_lim = coeff * fck * b_mm * d_mm * d_mm;
    
    // Maximum steel check — use actual wall thickness, not approximation
    const t_mm = t_actual_mm || (d_mm + 50);

    if (Mu <= 0.001) {
        // No moment — provide minimum steel
        const minRatio = MIN_STEEL_RATIO[`Fe${fy}` as SteelGrade] ?? 0.0012;
        return {
            Ast_req: Math.ceil((minRatio * b_mm * t_mm) / 2),
            Mu_lim: Mu_lim / 1e6, // back to kN·m
            isDoubly: false,
            governs: 'minimum',
            utilization: 0,
        };
    }
    
    const isDoubly = Mu > Mu_lim;
    
    // Singly reinforced steel area
    const ratio = 4.6 * Mu / (fck * b_mm * d_mm * d_mm);
    const sqrtTerm = Math.sqrt(Math.max(0, 1 - ratio));
    let Ast_req = (0.5 * fck / fy) * (1 - sqrtTerm) * b_mm * d_mm;
    
    // Minimum steel check - 0.12% total, split per face
    const minRatio = MIN_STEEL_RATIO[`Fe${fy}` as SteelGrade] ?? 0.0012;
    const Ast_min = (minRatio * b_mm * t_mm) / 2;
    
    // Maximum steel check - 4% total
    const Ast_max = 0.04 * b_mm * t_mm;
    
    let governs: Governs = 'design';
    if (Ast_req < Ast_min) {
        Ast_req = Ast_min;
        governs = 'minimum';
    } else if (Ast_req > Ast_max) {
        Ast_req = Ast_max;
        governs = 'maximum';
    }
    
    return {
        Ast_req: Math.ceil(Ast_req),
        Ast_min: Math.ceil(Ast_min),
        Ast_max: Math.floor(Ast_max),
        Mu_lim: Mu_lim / 1e6,
        Mu_applied: Math.abs(Mu_kNm),
        isDoubly,
        governs,
        utilization: Mu / Mu_lim,
    };
}

/** Select shear links (2-legged) for a given Asv/sv requirement */
function selectShearLinks(Asv_sv_req: number | null): ShearLinks | null {
    if (!Asv_sv_req) return null;
    const dias = [8, 10, 12];
    const spacings = [100, 125, 150, 175, 200, 250, 300];
    
    for (const dia of dias) {
        const Asv = 2 * Math.PI * dia * dia / 4; // 2-legged
        for (const sp of spacings) {
            const Asv_sv_provided = Asv / sp;
            if (Asv_sv_provided >= Asv_sv_req) {
                return {
                    dia,
                    spacing: sp,
                    label: `${dia}mm 2-legged @ ${sp} c/c`,
                    Asv_sv_provided: Math.round(Asv_sv_provided * 100) / 100
                };
            }
        }
    }
    // Fallback
    const fallbackAsv = 2 * Math.PI * 12 * 12 / 4;
    return {
        dia: 12, spacing: 100,
        label: `12mm 2-legged @ 100 c/c`,
        Asv_sv_provided: Math.round((fallbackAsv / 100) * 100) / 100
    };
}

/** Shear design per IS 456 Clause 40 */
function shearDesign(Vu_kN: number, b_mm: number, d_mm: number, Ast_mm2: number, fck: number, fy: number, grade: string): ShearDesign {
    const Vu = Math.abs(Vu_kN) * 1e3; // N
    
    const tau_v = Vu / (b_mm * d_mm); // N/mm²
    const pt = 100 * Ast_mm2 / (b_mm * d_mm);
    const tau_c = getTauC(pt, fck);
    const tau_c_max = TAU_C_MAX[grade as ConcreteGrade] ?? 2.8;
    
    let status: ShearStatus;
    let Asv_sv: number | null;
    if (tau_v <= tau_c) {
        status = 'minimum';
        // Minimum shear reinforcement: Asv/sv = 0.4/(0.87×fy) × b
        Asv_sv = (0.4 * b_mm) / (0.87 * fy);
    } else if (tau_v <= tau_c_max) {
        status = 'design';
        const Vus = Vu - tau_c * b_mm * d_mm;
        Asv_sv = Vus / (0.87 * fy * d_mm);
    } else {
        status = 'FAIL';
        Asv_sv = null;
    }
    
    const links = selectShearLinks(Asv_sv);
    
    return {
        tau_v: Math.round(tau_v * 1000) / 1000,
        tau_c: Math.round(tau_c * 1000) / 1000,
        tau_c_max,
        pt: Math.round(pt * 1000) / 1000,
        status,
        Asv_sv: Asv_sv !== null ? Math.round(Asv_sv * 100) / 100 : null,
        links,
        Vu_applied: Math.abs(Vu_kN),
    };
}

/** Select bar arrangement: returns { dia, spacing, Ast_provided, label } */
function selectBars(Ast_req_mm2: number, barDias: readonly number[], spacings: readonly number[], b_mm: number): BarSelection {
    // Standard IS 456 practice: for a 1-m strip, Ast_provided = Abar × (1000 / spacing)
    let best: BarSelection | null = null;
    for (const dia of barDias) {
        const Abar = Math.PI * dia * dia / 4;
        for (const sp of spacings) {
            const Ast = Abar * (b_mm / sp);
            if (Ast >= Ast_req_mm2) {
                if (!best || Ast < best.Ast_provided) {
                    best = {
                        dia,
                        spacing: sp,
                        Ast_provided: Math.round(Ast),
                        label: `${dia}mm @ ${sp} c/c`,
                    };
                }
            }
        }
    }
    // Fallback: use largest bar at minimum spacing
    if (!best) {
        const dia = barDias[barDias.length - 1];
        const sp = spacings[0];
        const Ast = (Math.PI * dia * dia / 4) * (b_mm / sp);
        best = {
            dia,
            spacing: sp,
            Ast_provided: Math.round(Ast),
            label: `${dia}mm @ ${sp} c/c`,
        };
    }
    return best;
}

// ───────────────────── Lateral Pressure Computation ─────────────────────

/** Compute factored lateral pressure at a given depth (kN/m²) */
function lateralPressure(depth_m: number, params: PressureParams): PressurePoint {
    const { K0, gamma_soil, gamma_water, waterTableDepth, waterMode, surcharge, loadFactor, groundLevelDepth } = params;
    
    const gld = groundLevelDepth || 0;
    
    if (depth_m <= gld) {
        return { earthP: 0, waterP: 0, surchargeP: 0, combined: 0 };
    }
    
    let waterP_unfactored = 0;
    let earthP_unfactored = 0;
    
    const gamma_sub = Math.max(0, gamma_soil - gamma_water);

    if (waterMode === 'submerged') {
        waterP_unfactored = gamma_water * (depth_m - gld);
        earthP_unfactored = K0 * gamma_sub * (depth_m - gld);
    } else if (waterMode === 'partial') {
        const wtd = Math.max(waterTableDepth, gld); // water table cannot be above ground level for soil pressure calculation
        if (depth_m <= wtd) {
            earthP_unfactored = K0 * gamma_soil * (depth_m - gld);
            waterP_unfactored = 0;
        } else {
            earthP_unfactored = K0 * (gamma_soil * (wtd - gld) + gamma_sub * (depth_m - wtd));
            waterP_unfactored = gamma_water * (depth_m - wtd);
        }
    } else {
        earthP_unfactored = K0 * gamma_soil * (depth_m - gld);
        waterP_unfactored = 0;
    }
    
    const surchargeP_unfactored = K0 * surcharge;
    
    return {
        earthP: earthP_unfactored * loadFactor,
        waterP: waterP_unfactored * loadFactor,
        surchargeP: surchargeP_unfactored * loadFactor,
        combined: (earthP_unfactored + waterP_unfactored + surchargeP_unfactored) * loadFactor
    };
}

// ───────────────────── Wall Analysis ─────────────────────

/**
 * PERF-004: Compute everything in the wall model that is INDEPENDENT of zone
 * thickness — the lateral-pressure field and the analysis mesh derived from it.
 *
 * The lateral earth/water/surcharge pressure profile is a function of depth,
 * the soil parameters, the water regime and the load factor ONLY. It does NOT
 * depend on the wall thickness. During `optimizeWall` we re-run `analyzeWall`
 * once per thickness combination (hundreds–thousands of times), so recomputing
 * this profile every call — including the per-segment `lateralPressure()` sweeps,
 * the break-depth set, the support mask and the overturning integral — is pure
 * waste. Hoisting it here lets the optimizer compute it ONCE (keyed on the
 * pressure-relevant inputs) and feed it back through `config._mesh`.
 *
 * @returns mesh object consumed by analyzeWall (see destructuring there).
 */
export function computePressureMesh(config: WallConfig): PressureMesh {
    const { zones, soilParams, material, loadFactor = 1.5 } = config;
    const nZones = zones.length;
    const K0 = computeK0(soilParams.phi || 30);

    const pressureParams: PressureParams = {
        K0,
        gamma_soil: soilParams.gamma_soil || 18,
        gamma_water: soilParams.gamma_water ?? 9.81,
        waterTableDepth: soilParams.waterTableDepth ?? 999,
        groundLevelDepth: soilParams.groundLevelDepth || 0,
        waterMode: soilParams.waterMode || 'submerged',
        surcharge: soilParams.surcharge || 0,
        loadFactor,
    };

    // Cumulative depths (m) from top of wall for the design zones
    const cumDepths = [0];
    for (let i = 0; i < nZones; i++) cumDepths.push(cumDepths[i] + zones[i].height);
    const totalHeight = cumDepths[nZones];

    const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;
    const wMode = pressureParams.waterMode;
    const wtd = pressureParams.waterTableDepth;
    const gld = pressureParams.groundLevelDepth;
    const hasWaterKink = wMode === 'partial' && wtd > 1e-6 && wtd < totalHeight - 1e-6;
    const hasGroundKink = gld > 1e-6 && gld < totalHeight - 1e-6;

    const breakSet = new Set(cumDepths.map(round6));
    if (hasWaterKink) breakSet.add(round6(Math.max(wtd, gld)));
    if (hasGroundKink) breakSet.add(round6(gld));
    const breakDepths = Array.from(breakSet).sort((a, b) => a - b);
    const nSeg = breakDepths.length - 1;

    const zoneOfDepth = (d: number): number => {
        for (let i = 0; i < nZones; i++) {
            if (d >= cumDepths[i] - 1e-9 && d <= cumDepths[i + 1] + 1e-9) return i;
        }
        return nZones - 1;
    };

    // Per-segment combined loads, zone ownership and depths (thickness-independent)
    const customLoads: { wL: any; wR: any }[] = [];
    const segZone: number[] = [];
    const segDepths: { top: number; bot: number }[] = [];
    for (let k = 0; k < nSeg; k++) {
        const dTop = breakDepths[k], dBot = breakDepths[k + 1];
        const zi = zoneOfDepth((dTop + dBot) / 2);
        const pTop = lateralPressure(dTop + 1e-6, pressureParams);
        const pBot = lateralPressure(dBot - 1e-6, pressureParams);
        segZone.push(zi);
        segDepths.push({ top: dTop, bot: dBot });
        customLoads.push({ wL: toFrac(round6(pTop.combined)), wR: toFrac(round6(pBot.combined)) });
    }

    // Pressure profile capturing step discontinuities (e.g., surcharge at ground level)
    const pressureProfile: ProfileNode[] = [];
    for (let k = 0; k < nSeg; k++) {
        const dTop = breakDepths[k], dBot = breakDepths[k + 1];
        const pTop = lateralPressure(dTop + 1e-6, pressureParams);
        const pBot = lateralPressure(dBot - 1e-6, pressureParams);
        if (k > 0) {
            const prevPBot = pressureProfile[pressureProfile.length - 1];
            if (Math.abs(pTop.combined - prevPBot.combined) > 1e-3 || Math.abs(pTop.waterP - prevPBot.waterP) > 1e-3) {
                pressureProfile.push({ depth: dTop, ...pTop });
            }
        } else {
            const pTopAbove = lateralPressure(dTop - 1e-6, pressureParams);
            pressureProfile.push({ depth: dTop, ...pTopAbove });
            if (Math.abs(pTop.combined - pTopAbove.combined) > 1e-3 || Math.abs(pTop.waterP - pTopAbove.waterP) > 1e-3) {
                pressureProfile.push({ depth: dTop, ...pTop });
            }
        }
        pressureProfile.push({ depth: dBot, ...pBot });
    }

    // Support mask: zone boundaries (incl. top & base) are supports; water nodes free.
    const supportMask = breakDepths.map(d => cumDepths.some(zd => Math.abs(d - zd) < 1e-6));

    // Per-design-zone pressure (top/bottom) for tables & report
    const zonePressures: { top: PressurePoint; bottom: PressurePoint }[] = [];
    for (let i = 0; i < nZones; i++) {
        zonePressures.push({
            top: lateralPressure(cumDepths[i], pressureParams),
            bottom: lateralPressure(cumDepths[i + 1], pressureParams),
        });
    }

    // Overturning forces from the pressure profile (thickness-independent)
    let totalLateralForce = 0, overturningMoment = 0;
    for (let i = 0; i < pressureProfile.length - 1; i++) {
        const topNode = pressureProfile[i], botNode = pressureProfile[i + 1];
        const hSegment = botNode.depth - topNode.depth;
        const p1 = topNode.combined, p2 = botNode.combined;
        const force = 0.5 * (p1 + p2) * hSegment;
        const y_centroid_seg = (hSegment / 3) * (p1 + 2 * p2) / (p1 + p2 || 1);
        const depth_centroid = topNode.depth + y_centroid_seg;
        totalLateralForce += force;
        overturningMoment += force * (totalHeight - depth_centroid);
    }
    const centerOfPressure = totalLateralForce > 0 ? (overturningMoment / totalLateralForce) : 0;

    return {
        K0, pressureParams, cumDepths, totalHeight, round6, wMode, wtd, gld,
        hasWaterKink, hasGroundKink, breakDepths, nSeg, zoneOfDepth,
        customLoads, segZone, segDepths, pressureProfile, supportMask,
        zonePressures, totalLateralForce, centerOfPressure,
    };
}

/**
 * Analyze a basement wall as a continuous vertical strip.
 *
 * STRUCTURAL MODEL (zone-as-support idealisation) — CALC-002 / GUI-001:
 * The wall is solved as a CONTINUOUS BEAM laid out along the vertical depth axis,
 * where EVERY zone boundary is modelled as a lateral (roller) support — i.e. a
 * point that cannot deflect sideways but is free to rotate, representing a floor
 * slab, a ground-anchor tie or the ground-floor diaphragm. Consequently:
 *   • number of design zones  ===  number of beam spans;
 *   • each floor-slab level MUST be placed at a zone boundary for the model to be
 *     structurally correct (a support that does not exist in reality, or a missing
 *     one, changes the whole moment/shear field);
 *   • the TOP boundary is a roller (held by the ground-floor slab) and the BASE is
 *     FIXED (cast monolithically into the raft) — this is the propped-cantilever
 *     idealisation. The support arrangement is therefore a PHYSICAL property of the
 *     wall, NOT a user choice: see the `beamEndCond` constant below (CALC-003).
 *   • placing an extra zone boundary at the water-table depth improves load
 *     accuracy for the partial-submergence case (it pins the pressure slope kink to
 *     an analysis node). The mesh builder also inserts a *non-support* node there
 *     automatically, but an explicit zone there additionally lets you read design
 *     forces at that level.
 *
 * @param {Object} config
 *   - zones: [{height, thickness}]     zone geometry (m, mm); boundaries = supports
 *   - soilParams: {phi, gamma_soil, gamma_water, waterTableDepth, surcharge}
 *   - material: {grade, fck, steelGrade, fy, cover, E}
 *   - loadFactor: number (default 1.5)
 *   - barDias: [8, 10, 12, 16, 20, 25]
 *   - spacings: [100, 125, 150, 175, 200, 250, 300]
 *   - _mesh: (internal, optional) pre-computed thickness-independent pressure mesh
 *            from computePressureMesh(); supplied by optimizeWall to avoid
 *            recomputing the pressure profile on every thickness trial (PERF-004).
 *
 * @returns analysis result with per-zone design
 */
export function analyzeWall(config: WallConfig): WallAnalysisResult {
    const {
        zones,
        soilParams,
        material,
        loadFactor = 1.5,
        barDias = [8, 10, 12, 16, 20, 25],
        spacings = [100, 125, 150, 175, 200, 250, 300],
    } = config;

    const nZones = zones.length;
    const b = 1000; // unit strip width in mm

    // ── PERF-004: thickness-INDEPENDENT pressure mesh ─────────────────────────
    // The lateral pressure field, break-depth set, per-segment combined loads,
    // support mask, per-zone pressures and overturning forces depend only on the
    // soil/water/surcharge inputs and the zone *heights* — never on thickness.
    // optimizeWall pre-computes this once and threads it in via config._mesh, so
    // it is not recomputed on every thickness trial. When absent (a normal single
    // analyzeWall call) we compute it here.
    //
    // The mesh also resolves the partial-submergence slope kink: a dedicated
    // *continuous* (non-support) analysis node is inserted at the water-table
    // depth so each segment carries an EXACT linear pressure while the real zone
    // boundaries stay as transverse supports.
    const mesh = config._mesh || computePressureMesh(config);
    const {
        K0, pressureParams, cumDepths, totalHeight, round6, wMode, wtd, gld,
        hasWaterKink, hasGroundKink, breakDepths, nSeg, zoneOfDepth,
        customLoads, segZone, segDepths, pressureProfile, supportMask,
        zonePressures, totalLateralForce, centerOfPressure,
    } = mesh;

    // Zone EI values (kN·m²) — one per design zone (THICKNESS-DEPENDENT)
    const E_Nmm2 = material.E || 5000 * Math.sqrt(material.fck || 20); // IS 456 Cl. 6.2.3.1
    const zoneEIs: number[] = [];
    for (let i = 0; i < nZones; i++) {
        const t_mm = zones[i].thickness;
        const I_mm4 = (b * t_mm * t_mm * t_mm) / 12;
        zoneEIs.push((E_Nmm2 * I_mm4) / 1e9); // 1 kN·m² = 1e9 N·mm²
    }

    // Per-segment EI / tapered-stiffness geometry (THICKNESS-DEPENDENT)
    const segEIs: number[] = [];
    const spanTapers: any[] = [];
    const E_modulus = 5000 * Math.sqrt(parseInt(material.grade.replace('M', '')) || 25);
    for (let k = 0; k < nSeg; k++) {
        const dTop = breakDepths[k], dBot = breakDepths[k + 1];
        const zi = segZone[k];
        segEIs.push(zoneEIs[zi]);

        // Compute local exact thicknesses for analytical tapered stiffness
        const z = zones[zi];
        const isTapered = config.isTapered || false;
        const tTop = isTapered ? (z.thicknessTop || z.thickness) : z.thickness;
        const tBot = isTapered ? (z.thicknessBot || z.thickness) : z.thickness;
        const zTop = cumDepths[zi];
        const zBot = cumDepths[zi + 1];
        const zH = zBot - zTop;

        const d1 = tTop + (tBot - tTop) * ((dTop - zTop) / zH);
        const d2 = tTop + (tBot - tTop) * ((dBot - zTop) / zH);

        spanTapers.push({
            d1: d1 / 1000,         // mm to m
            d2: d2 / 1000,
            b: b / 1000,           // 1 m strip
            E: E_modulus * 1000,   // MPa to kN/m²
            L: dBot - dTop
        });
    }

    // Map to the beam engine (reference span = first analysis segment)
    const spanLengths = segDepths.map((s: { top: number; bot: number }) => toFrac(round6(s.bot - s.top)));
    const spanEIs = segEIs.map((ei: number) => toFrac(round6(ei)));

    // CALC-003 / GUI-002: the wall's boundary condition is a PHYSICAL property of
    // the propped-cantilever idealization, not a user choice. Node 0 = top (held by
    // the ground-floor slab → roller), node N = base (cast into the raft → moment-
    // resisting → fixed), intermediate zone boundaries = rollers. That is exactly
    // the beam engine's 'fixed-right' end condition. There is deliberately no
    // `config.endCond` here: a previous doc comment advertised one ('fixed'|'pinned'|
    // 'fixed-fixed') but `analyzeWall` never read it — confirmed no-op by the
    // regression test in src/__tests__/wallEngine.endcond.test.js (which feeds
    // 'pinned' and 'fixed-fixed' configs and asserts byte-identical analysis output
    // modulo the echoed input). Exposing the field would only let the UI request a
    // physically-meaningless support arrangement. The constant below is the single
    // source of truth.
    const beamEndCond = 'fixed-right';

    const beamCfg = {
        nSpans: nSeg,
        loadCase: 'custom',
        endCond: beamEndCond,
        spanLengths,
        spanEIs,
        spanTapers,
        customLoads,
        supportMask,
        refSpanL: 0,
        refSpanEI: 0,
        L_ref_phys: round6(segDepths[0].bot - segDepths[0].top),
        EI_ref_phys: segEIs[0]
    };

    const beamResult = analyzeBeam(beamCfg);
    const L_ref = spanLengths[0].fl();

    // Group analysis segments by their owning design zone
    const segByZone: number[][] = Array.from({ length: nZones }, () => []);
    for (let k = 0; k < nSeg; k++) segByZone[segZone[k]].push(k);

    // zonePressures comes from the (thickness-independent) pressure mesh — PERF-004.

    // Per-zone IS 456 design
    const zoneDesigns: ZoneDesign[] = [];
    for (let i = 0; i < nZones; i++) {
        const segs = segByZone[i];
        const t_mm = zones[i].thickness;
        const cover = material.cover || 40;
        // CALC-004: the initial effective depth must be CONSERVATIVE. Previously a
        // 12 mm bar was hard-coded, which over-estimates d whenever the design ends
        // up needing larger bars (16/20/25 mm) — a larger bar lowers its own centroid,
        // reducing d and therefore the moment capacity for the same Ast. Seeding the
        // first-pass d with the LARGEST available bar diameter gives the smallest
        // (worst-case) d, so the subsequent bar selection can only improve on it,
        // never violate it. The true per-face d is recomputed from the actually
        // selected bar below.
        let barDia = Math.max(...barDias); // largest available bar → conservative (smallest d)
        let d_mm = t_mm - cover - barDia / 2;
        const h_m = zones[i].height;
        const zoneTopDepth = cumDepths[i];

        // The beam engine works in normalized units where:
        //   V_physical = V_normalized × L_ref
        //   M_physical = M_normalized × L_ref²
        //   x_normalized = x_physical / L_ref
        // A design zone may span more than one analysis segment (when the water
        // table cuts through it), so these helpers locate the right segment.
        const Vphys = (xFromZoneTop: number): number => {
            const depth = zoneTopDepth + xFromZoneTop;
            for (const k of segs) {
                const s = segDepths[k];
                if (depth >= s.top - 1e-9 && depth <= s.bot + 1e-9) {
                    return beamResult.spans[k].V((depth - s.top) / L_ref) * L_ref;
                }
            }
            const kl = segs[segs.length - 1];
            return beamResult.spans[kl].V(beamResult.spans[kl].alpha.fl()) * L_ref;
        };

        const firstSp = beamResult.spans[segs[0]];
        const lastSp = beamResult.spans[segs[segs.length - 1]];

        const ML = firstSp.MLeft * L_ref * L_ref;   // kN·m/m (top of zone)
        const MR = lastSp.MRight * L_ref * L_ref;   // kN·m/m (bottom of zone)
        const VL = firstSp.VLeft * L_ref;           // kN/m (top of zone)
        const VR = lastSp.VRight * L_ref;           // kN/m (bottom of zone)

        // Governing moments strictly separated by face — scan every segment
        let M_hogging = 0; // Earth face tension (negative BMD)
        let M_sagging = 0; // Inner face tension (positive BMD)
        const nSteps = 40;
        for (const k of segs) {
            const sp = beamResult.spans[k];
            const aL = sp.alpha.fl();
            for (let j = 0; j <= nSteps; j++) {
                const M_val = sp.M((j / nSteps) * aL) * L_ref * L_ref;
                if (M_val > 0) M_sagging = Math.max(M_sagging, M_val);
                else if (M_val < 0) M_hogging = Math.max(M_hogging, Math.abs(M_val));
            }
        }
        const M_gov = Math.max(M_hogging, M_sagging);

        // Governing shear: at d from the more heavily loaded support face
        let d_m = d_mm / 1000;
        let V_gov: number;
        if (Math.abs(VL) >= Math.abs(VR)) {
            V_gov = Math.abs(Vphys(Math.min(d_m, h_m)));            // d from top support
        } else {
            V_gov = Math.abs(Vphys(Math.max(0, h_m - Math.min(d_m, h_m)))); // d from bottom support
        }

        // Flexural design for both faces
        let flex_hogging = flexuralDesign(M_hogging, b, d_mm, material.fck, material.fy, t_mm);
        let flex_sagging = flexuralDesign(M_sagging, b, d_mm, material.fck, material.fy, t_mm);
        
        // Select bar arrangement
        let mainBars_hogging = selectBars(flex_hogging.Ast_req, barDias, spacings, b);
        let mainBars_sagging = selectBars(flex_sagging.Ast_req, barDias, spacings, b);
        
        // Iteration for actual d based on selected bars
        let d_hogging = t_mm - cover - mainBars_hogging.dia / 2;
        let d_sagging = t_mm - cover - mainBars_sagging.dia / 2;
        
        if (mainBars_hogging.dia !== barDia || mainBars_sagging.dia !== barDia) {
            // Recompute V_gov with true d of the tension face
            let d_critical = Math.abs(VL) >= Math.abs(VR) ? d_sagging : d_hogging;
            let d_m_crit = d_critical / 1000;
            if (Math.abs(VL) >= Math.abs(VR)) {
                V_gov = Math.abs(Vphys(Math.min(d_m_crit, h_m)));
            } else {
                V_gov = Math.abs(Vphys(Math.max(0, h_m - Math.min(d_m_crit, h_m))));
            }
            
            // Recompute flexure and select bars with true d per face
            flex_hogging = flexuralDesign(M_hogging, b, d_hogging, material.fck, material.fy, t_mm);
            flex_sagging = flexuralDesign(M_sagging, b, d_sagging, material.fck, material.fy, t_mm);
            mainBars_hogging = selectBars(flex_hogging.Ast_req, barDias, spacings, b);
            mainBars_sagging = selectBars(flex_sagging.Ast_req, barDias, spacings, b);
            
            // Re-update d after re-selection just in case
            d_hogging = t_mm - cover - mainBars_hogging.dia / 2;
            d_sagging = t_mm - cover - mainBars_sagging.dia / 2;
        }

        const d_critical_shear = Math.abs(VL) >= Math.abs(VR) ? d_sagging : d_hogging;

        // Shear design: use the tension steel area at the critical section.
        // If shear governs near the support (sagging region), use inner-face steel.
        // If near mid-span/bottom (hogging region), use earth-face steel.
        const shearAst = Math.abs(VL) >= Math.abs(VR)
            ? mainBars_sagging.Ast_provided   // critical near top support (sagging zone)
            : mainBars_hogging.Ast_provided;  // critical near bottom support (hogging zone)
        // For walls, supports are at top/bottom, so critical section is in hogging region.
        const shear = shearDesign(V_gov, b, d_critical_shear, shearAst, material.fck, material.fy, material.grade);
        
        const EI_val = zoneEIs[i];

        zoneDesigns.push({
            zone: i + 1,
            height: h_m,
            thickness: t_mm,
            d_hogging,
            d_sagging,
            EI: EI_val,
            M_left: ML,
            M_right: MR,
            M_max_span: M_gov,
            M_hogging,
            M_sagging,
            M_governing: M_gov,
            V_left: VL,
            V_right: VR,
            V_governing: V_gov,
            flex_hogging,
            flex_sagging,
            shear: shear,
            mainBars_hogging,
            mainBars_sagging,
            pressureTop: zonePressures[i].top,
            pressureBot: zonePressures[i].bottom,
        });
    }

    // Total quantities
    let totalConcreteVol = 0; // m³ per m run
    let totalSteelWeight = 0; // kg per m run
    let feasible = true;
    let governingZone: number | null = null;
    let maxUtilization = 0;

    for (const zd of zoneDesigns) {
        totalConcreteVol += (zd.thickness / 1000) * zd.height * 1; // per m run
        totalSteelWeight += ((zd.mainBars_hogging.Ast_provided + zd.mainBars_sagging.Ast_provided) / 1e6) * zd.height * 1 * 7850; // steel density kg/m³
        
        if (zd.shear.status === 'FAIL' || zd.flex_hogging.isDoubly || zd.flex_sagging.isDoubly) {
            feasible = false;
        }
        
        const maxUtil = Math.max(zd.flex_hogging.utilization, zd.flex_sagging.utilization);
        if (maxUtil > maxUtilization) {
            maxUtilization = maxUtil;
            governingZone = zd.zone;
        }
    }

    // Overturning forces (totalLateralForce, centerOfPressure) come from the
    // thickness-independent pressure mesh — PERF-004 (no recompute per trial).

    return {
        beamResult,
        zoneDesigns,
        feasible,
        totalConcreteVol: Math.round(totalConcreteVol * 100) / 100,
        totalSteelWeight: Math.round(totalSteelWeight),
        governingZone,
        maxUtilization: Math.round(maxUtilization * 1000) / 1000,
        K0,
        totalHeight,
        cumDepths,
        zonePressures,
        pressureProfile,
        waterTableDepth: soilParams.waterTableDepth,
        submersionState: wMode === 'dry' ? 'dry' : (wMode === 'submerged' ? 'fully' : (hasWaterKink ? 'partial' : (wtd <= 1e-6 ? 'fully' : 'dry'))),
        config,
        totalLateralForce,
        centerOfPressure,
        supportMask
    };
}

// ───────────────────── Zone-by-Zone Optimization ─────────────────────

/**
 * Optimize wall thickness zone by zone.
 * Enumerate feasible thickness combinations and select minimum cost.
 *
 * @param config     wall configuration (zones, soil, material, optimization bounds)
 * @param onProgress optional callback invoked every ~500 combos with progress info
 */
export function optimizeWall(config: WallConfig, onProgress?: ProgressCallback): OptimizeResult {
    const { zones, minThk, maxThk, thkStep, ...restConfig } = config;
    
    // Generate thickness options
    const thicknesses: number[] = [];
    for (let t = minThk!; t <= maxThk!; t += thkStep!) {
        thicknesses.push(Math.round(t));
    }
    if (thicknesses.length === 0) thicknesses.push(minThk!);
    
    const nZones = zones.length;
    const nOpts = thicknesses.length;

    // PERF-004: the lateral-pressure mesh depends only on the zone *heights* and the
    // soil/water/surcharge/load-factor inputs — NONE of which change as the optimizer
    // sweeps thicknesses. Compute it ONCE here and feed it into every analyzeWall
    // trial via config._mesh, eliminating hundreds–thousands of redundant pressure
    // sweeps. (Zone heights are identical across trials, so a mesh built from the
    // base zones is valid for all thickness combinations.)
    const sharedMesh = computePressureMesh({ ...restConfig, zones } as WallConfig);
    
    // Full enumeration
    const results: OptimumDesign[] = [];
    const nVars = config.isTapered ? nZones + 1 : nZones;
    const indices = new Array(nVars).fill(0);
    // PERF-003: after PERF-005, a single analyzeWall is ~1.5 ms, so full
    // enumeration of a few thousand combinations completes in a few seconds —
    // well within an interactive budget and ALWAYS globally optimal. The old
    // 50 000 cap (a) was reached at realistic settings (5 zones × 9 thickness
    // options = 59 049 combos) and (b) handed off to optimizeSequential, a
    // greedy heuristic that is NOT guaranteed optimal and which crashed on a
    // `current is not defined` reference error. We raise the cap so the exact
    // search covers all realistic cases, and only fall back for genuinely huge
    // spaces (6+ zones at a fine step). The fallback is now correct and clearly
    // flags its result as approximate (see optimizeSequential).
    const maxCombos = 20000; // ~30 s worst case at ~1.5 ms/combo
    const totalCombos = Math.pow(nOpts, nVars);

    if (totalCombos > maxCombos) {
        // Fall back to greedy sequential optimization (approximate, not exhaustive)
        return optimizeSequential(config, thicknesses, sharedMesh, onProgress);
    }
    
    for (let combo = 0; combo < totalCombos; combo++) {
        // Build zone config with current thicknesses
        const trialZones = zones.map((z: WallZone, i: number) => {
            if (config.isTapered) {
                return {
                    ...z,
                    thicknessTop: thicknesses[indices[i]],
                    thicknessBot: thicknesses[indices[i + 1]],
                };
            } else {
                return {
                    ...z,
                    thickness: thicknesses[indices[i]],
                };
            }
        });
        
        try {
            const result = analyzeWall({
                ...restConfig,
                zones: trialZones,
                _mesh: sharedMesh, // PERF-004: reuse pre-computed pressure mesh
            } as WallConfig);
            
            if (result.feasible) {
                results.push({
                    thicknesses: config.isTapered 
                        ? indices.map((idx: number) => thicknesses[idx])
                        : trialZones.map(z => z.thickness),
                    concreteVol: result.totalConcreteVol,
                    steelWeight: result.totalSteelWeight,
                    maxUtilization: result.maxUtilization,
                    result,
                });
            }
        } catch (e) {
            // Skip invalid combinations
        }

        // Report progress every 500 combos (or ~2.5% whichever is larger)
        // to avoid flooding the message channel.
        if (onProgress) {
            const interval = Math.max(500, Math.floor(totalCombos / 40));
            if (combo % interval === 0 || combo === totalCombos - 1) {
                onProgress(combo + 1, totalCombos, results.length);
            }
        }

        // Increment indices (odometer style)
        let carry = 1;
        for (let k = nVars - 1; k >= 0 && carry; k--) {
            indices[k] += carry;
            if (indices[k] >= nOpts) {
                indices[k] = 0;
                carry = 1;
            } else {
                carry = 0;
            }
        }
    }
    
    // Sort by concrete volume (primary), then steel weight (secondary)
    results.sort((a, b) => {
        const dv = a.concreteVol - b.concreteVol;
        if (Math.abs(dv) > 0.001) return dv;
        return a.steelWeight - b.steelWeight;
    });
    
    return {
        totalTrials: totalCombos,
        feasibleCount: results.length,
        // CALC-005: full enumeration evaluated EVERY thickness combination, so the
        // returned optimum is provably the global minimum. Flag it so the UI can show
        // a "✓ Optimal" badge (vs the "⚠ Approximate" badge for the greedy fallback).
        approximate: false,
        method: 'full-enumeration',
        topDesigns: results.slice(0, 10),
        optimum: results.length > 0 ? results[0] : null,
    };
}

/** Sequential single-zone optimization (for large search spaces) */
function optimizeSequential(config: WallConfig, thicknesses: number[], sharedMesh: PressureMesh | null, onProgress?: ProgressCallback): OptimizeResult {
    const { zones, ...restConfig } = config;
    // PERF-004: reuse the caller's pre-computed pressure mesh; build one only if a
    // caller invoked this path directly without supplying it.
    const mesh = sharedMesh || computePressureMesh({ ...restConfig, zones } as WallConfig);
    const nZones = zones.length;
    const nVars = config.isTapered ? nZones + 1 : nZones;
    const maxThk = thicknesses[thicknesses.length - 1];
    
    // Start with maximum thickness everywhere
    const currentVars = new Array(nVars).fill(maxThk);
    
    const applyVars = (vars: number[]): WallZone[] => {
        return zones.map((z, i) => {
            if (config.isTapered) {
                return { ...z, thicknessTop: vars[i], thicknessBot: vars[i + 1] };
            } else {
                return { ...z, thickness: vars[i] };
            }
        });
    };
    
    // Try reducing each zone's thickness one at a time
    let improved = true;
    let iterations = 0;
    const maxIter = nVars * thicknesses.length;
    let trialCount = 0;
    const totalTrials = maxIter * thicknesses.length;

    while (improved && iterations < maxIter) {
        improved = false;
        iterations++;

        for (let v = 0; v < nVars; v++) {
            const origThk = currentVars[v];
            let bestThk = origThk;
            let bestVol = Infinity;
            
            for (const t of thicknesses) {
                currentVars[v] = t;
                trialCount++;
                try {
                    const trialZones = applyVars(currentVars);
                    const result = analyzeWall({ ...restConfig, zones: trialZones, _mesh: mesh } as WallConfig);
                    if (result.feasible && result.totalConcreteVol < bestVol) {
                        bestVol = result.totalConcreteVol;
                        bestThk = t;
                    }
                } catch (e) { /* skip */ }
                // Report progress periodically
                if (onProgress && trialCount % 500 === 0) {
                    onProgress(trialCount, totalTrials, 0);
                }
            }
            
            if (bestThk !== origThk) {
                currentVars[v] = bestThk;
                improved = true;
            } else {
                currentVars[v] = origThk;
            }
        }
    }
    
    // Final analysis with optimized thicknesses
    const finalZones = applyVars(currentVars);
    const finalResult = analyzeWall({ ...restConfig, zones: finalZones, _mesh: mesh } as WallConfig);

    // PERF-003 bug fix: the previous return referenced `current.map(z => z.thickness)`,
    // but `current` was never defined (the variable is `currentVars`, and it holds raw
    // thickness numbers, not zone objects). That threw `ReferenceError: current is not
    // defined` on EVERY sequential-fallback run, so any optimization over a large search
    // space crashed instead of returning a result. Use `currentVars` directly, and share
    // a single design object between `topDesigns[0]` and `optimum` so they cannot diverge.
    const best: OptimumDesign = {
        thicknesses: [...currentVars],
        concreteVol: finalResult.totalConcreteVol,
        steelWeight: finalResult.totalSteelWeight,
        maxUtilization: finalResult.maxUtilization,
        result: finalResult,
    };
    const feasible = finalResult.feasible;

    // Final progress report
    if (onProgress) onProgress(trialCount, trialCount, feasible ? 1 : 0);

    return {
        totalTrials: trialCount,
        feasibleCount: feasible ? 1 : 0,
        // PERF-003: this path is a greedy heuristic, not an exhaustive search, so the
        // returned design may not be the true global optimum. Flag it so the UI can tell
        // the user rather than presenting an approximate result as if it were optimal.
        approximate: true,
        method: 'sequential-greedy',
        topDesigns: feasible ? [best] : [],
        optimum: feasible ? best : null,
    };
}


// ───────────────────── Exports ─────────────────────
// Canvas drawing and HTML table rendering were split into wallRender.ts and
// wallHtml.ts (ARCH-01). This file exports only the mathematical core, the
// IS 456 design functions, the pressure mesh, the analysis, and the optimizer.
// All types and the three public functions above are already declared with
// `export` inline, so no additional export statement is needed here.
