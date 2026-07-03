'use strict';

/* ================================================================
   BASEMENT WALL DESIGN ENGINE — IS 456:2000
   Zone-by-zone analysis, design, and optimization
   for continuous vertical wall strips under lateral pressure.
   ================================================================ */

import { analyzeBeam, toFrac } from './beamEngine';
import {
    TAU_C_MAX,
    getTauC,
    flexuralDesign,
    selectBars,
    shearDesign,
    selectShearLinks,
    computeCostIndex,
    computeRequiredDepthForBM,
    WALL_MIN_THICKNESS,
    type ConcreteGrade,
    type SteelGrade,
    type Governs,
    type ShearStatus,
    type FlexuralResult as FlexuralDesign,
    type BarResult as BarSelection,
    type ShearLinkResult as ShearLinks,
    type ShearResult as ShearDesign,
} from '../lib/is456';

// ───────────────────── Types ────────────────────────────────────────────────────────────

type WaterMode = 'dry' | 'partial' | 'submerged';
;

interface WallZone {
    height: number;
    thickness: number;
    thicknessTop?: number;
    thicknessBot?: number;
}

interface SoilParams {
    phi?: number;
    gamma_soil?: number;
    gamma_water?: number;
    waterTableDepth?: number;
    groundLevelDepth?: number;
    surcharge?: number;
    waterMode?: WaterMode;
}

interface WallMaterial {
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

interface PressurePoint {
    earthP: number;
    waterP: number;
    surchargeP: number;
    combined: number;
}

export interface ProfileNode extends PressurePoint {
    depth: number;
}

;



interface ZoneDesign {
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

interface PressureParams {
    K0: number;
    gamma_soil: number;
    gamma_water: number;
    waterTableDepth: number;
    groundLevelDepth: number;
    waterMode: WaterMode;
    surcharge: number;
    loadFactor: number;
}

interface PressureMesh {
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

interface OptimumDesign {
    thicknesses: number[];
    concreteVol: number;
    steelWeight: number;
    maxUtilization: number;
    costIndex: number;
    result: WallAnalysisResult;
}

export interface OptimizeResult {
    totalTrials: number;
    feasibleCount: number;
    approximate: boolean;
    method: 'full-enumeration' | 'sequential-greedy';
    topDesigns: OptimumDesign[];
    optimum: OptimumDesign | null;
    costRatioUsed: number;
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

// ponytail: flexuralDesign, selectBars, shearDesign, selectShearLinks
// all imported from ../lib/is456 — zero local copies

// ───────────────────── Lateral Pressure Computation ─────────────────────

/** Compute factored lateral pressure at a given depth (kN/m²) */
function lateralPressure(depth_m: number, params: PressureParams): PressurePoint {
    const { K0, gamma_soil, gamma_water, waterTableDepth, waterMode, surcharge, loadFactor, groundLevelDepth } = params;
    
    const gld = groundLevelDepth || 0;
    
    // BUG-W1 FIX: use strict `<` so a depth exactly at the ground line still
    // receives the surcharge component. The integration is unaffected (the
    // ±1e-6 offset trick in computePressureMesh captures the step), but the
    // reported zone-top pressure is now correct when gld=0.
    if (depth_m < gld) {
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
function computePressureMesh(config: WallConfig): PressureMesh {
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

    // Per-segment combined loads, zone ownership and depths (thickness-independent).
    // ponytail: compute pTop/pBot ONCE per segment and reuse for both customLoads
    // and pressureProfile (previously lateralPressure was called 2× per segment).
    const customLoads: { wL: any; wR: any }[] = [];
    const segZone: number[] = [];
    const segDepths: { top: number; bot: number }[] = [];
    const segPTop: PressurePoint[] = [];
    const segPBot: PressurePoint[] = [];
    for (let k = 0; k < nSeg; k++) {
        const dTop = breakDepths[k], dBot = breakDepths[k + 1];
        const zi = zoneOfDepth((dTop + dBot) / 2);
        const pTop = lateralPressure(dTop + 1e-6, pressureParams);
        const pBot = lateralPressure(dBot - 1e-6, pressureParams);
        segZone.push(zi);
        segDepths.push({ top: dTop, bot: dBot });
        segPTop.push(pTop);
        segPBot.push(pBot);
        customLoads.push({ wL: toFrac(round6(pTop.combined)), wR: toFrac(round6(pBot.combined)) });
    }

    // Pressure profile capturing step discontinuities (e.g., surcharge at ground level)
    const pressureProfile: ProfileNode[] = [];
    for (let k = 0; k < nSeg; k++) {
        const dTop = breakDepths[k], dBot = breakDepths[k + 1];
        const pTop = segPTop[k];
        const pBot = segPBot[k];
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

    // Per-design-zone pressure (top/bottom) for tables & report.
    // BUG-W1: now that lateralPressure uses strict `<`, cumDepths[i] at the
    // ground line correctly returns the surcharge component.
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
        const isTapered = config.isTapered || false;
        const tTop = isTapered ? (zones[i].thicknessTop || zones[i].thickness) : zones[i].thickness;
        const tBot = isTapered ? (zones[i].thicknessBot || zones[i].thickness) : zones[i].thickness;
        const t_mm = isTapered ? (tTop + tBot) / 2 : zones[i].thickness;
        const I_mm4 = (b * t_mm * t_mm * t_mm) / 12;
        zoneEIs.push((E_Nmm2 * I_mm4) / 1e9); // 1 kN·m² = 1e9 N·mm²
    }

    // Per-segment EI / tapered-stiffness geometry (THICKNESS-DEPENDENT)
    // ponytail: hoist E_modulus out of the segment loop (it depends only on the
    // concrete grade, not on the segment). Also honour material.E when supplied
    // (CONCERN-B) so the reported zoneEIs and spanTapers.E stay consistent.
    const segEIs: number[] = [];
    const spanTapers: any[] = [];
    const E_modulus = material.E || 5000 * Math.sqrt(material.fck || 25); // IS 456 Cl. 6.2.3.1
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

    // ponytail: hoist the largest bar diameter out of the zone loop (loop-invariant).
    const maxBarDia = Math.max(...barDias);

    // Per-zone IS 456 design
    const zoneDesigns: ZoneDesign[] = [];
    for (let i = 0; i < nZones; i++) {
        const segs = segByZone[i];
        const isTapered = config.isTapered || false;
        const tTop = isTapered ? (zones[i].thicknessTop || zones[i].thickness) : zones[i].thickness;
        const tBot = isTapered ? (zones[i].thicknessBot || zones[i].thickness) : zones[i].thickness;
        const t_mm = isTapered ? (tTop + tBot) / 2 : zones[i].thickness;
        const cover = material.cover || 40;
        // CALC-004: the initial effective depth must be CONSERVATIVE. Previously a
        // 12 mm bar was hard-coded, which over-estimates d whenever the design ends
        // up needing larger bars (16/20/25 mm) — a larger bar lowers its own centroid,
        // reducing d and therefore the moment capacity for the same Ast. Seeding the
        // first-pass d with the LARGEST available bar diameter gives the smallest
        // (worst-case) d, so the subsequent bar selection can only improve on it,
        // never violate it. The true per-face d is recomputed from the actually
        // selected bar below.
        let barDia = maxBarDia; // largest available bar → conservative (smallest d)
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

        // Governing shear: at d from the more heavily loaded support face.
        // BUG-W3 FIX: when d_m ≥ h_m (zone shorter than effective depth — rare
        // for sub-250 mm zones), evaluate at the support FACE instead of
        // clamping to min(d_m, h_m)=h_m which collapsed to the wrong support.
        let d_m = d_mm / 1000;
        let V_gov: number;
        const dEff_m = Math.min(d_m, h_m);
        if (Math.abs(VL) >= Math.abs(VR)) {
            // Critical near top support: at distance d from top, but not past h_m
            V_gov = Math.abs(Vphys(dEff_m >= h_m ? 0 : dEff_m));
        } else {
            // Critical near bottom support: at distance d from bottom
            V_gov = Math.abs(Vphys(dEff_m >= h_m ? h_m : h_m - dEff_m));
        }

        // Flexural design for both faces
        let flex_hogging = flexuralDesign(M_hogging, b, d_mm, material.fck, material.fy, t_mm, true);
        let flex_sagging = flexuralDesign(M_sagging, b, d_mm, material.fck, material.fy, t_mm, true);
        
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
            const dEff_m_crit = Math.min(d_m_crit, h_m);
            if (Math.abs(VL) >= Math.abs(VR)) {
                V_gov = Math.abs(Vphys(dEff_m_crit >= h_m ? 0 : dEff_m_crit));
            } else {
                V_gov = Math.abs(Vphys(dEff_m_crit >= h_m ? h_m : h_m - dEff_m_crit));
            }
            
            // Recompute flexure and select bars with true d per face
            flex_hogging = flexuralDesign(M_hogging, b, d_hogging, material.fck, material.fy, t_mm, true);
            flex_sagging = flexuralDesign(M_sagging, b, d_sagging, material.fck, material.fy, t_mm, true);
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
            M_max_span: M_sagging, // BUG-W2 FIX: was M_gov (= max hogging,sagging), duplicating M_governing below. Field name means max in-span (sagging) moment.
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

    // ── Total quantities & comprehensive feasibility checks ─────────────────
    //
    // A wall section is considered FEASIBLE only when ALL of the following
    // IS 456:2000 structural requirements are satisfied in every zone:
    //
    //   1. FLEXURAL CAPACITY (IS 456 Cl. 38.1):
    //      The applied moment Mu must not exceed the limiting moment Mu,lim
    //      for a singly-reinforced section:
    //        Mu,lim = coeff × fck × b × d²
    //      where coeff depends on the steel grade (Fe415→0.138, Fe500→0.133, etc.).
    //      If Mu > Mu,lim the section requires compression reinforcement
    //      (isDoubly = true), which is not acceptable for basement walls.
    //      Equivalently, utilization = Mu / Mu,lim must be ≤ 1.0.
    //
    //   2. MAXIMUM REINFORCEMENT (IS 456 Cl. 26.5.1.1):
    //      Ast,max = 4% of gross cross-section (b × t).
    //      If the required Ast exceeds this, the section is under-designed
    //      (governs === 'maximum'). Thickness must be increased.
    //
    //   3. SHEAR CAPACITY (IS 456 Cl. 40.2.3):
    //      τv = Vu / (b × d) must not exceed τc,max (IS 456 Table 20).
    //      If τv > τc,max, no amount of shear reinforcement can save the
    //      section (shear.status === 'FAIL'). Thickness must be increased.
    //
    //   4. MINIMUM WALL THICKNESS (IS 456 Cl. 32.2.3):
    //      t ≥ 150 mm (unconditional code minimum for RC walls).
    //
    let totalConcreteVol = 0; // m³ per m run
    let totalSteelWeight = 0; // kg per m run
    let feasible = true;
    let governingZone: number | null = null;
    let maxUtilization = 0;

    for (const zd of zoneDesigns) {
        // ── Material quantities (per m run of wall) ──
        totalConcreteVol += (zd.thickness / 1000) * zd.height * 1;
        // Steel weight: Ast (mm²) × height (m) × strip width (1 m) × density (7850 kg/m³)
        totalSteelWeight += ((zd.mainBars_hogging.Ast_provided + zd.mainBars_sagging.Ast_provided) / 1e6) * zd.height * 1 * 7850;

        // ── Check 1: Shear capacity — IS 456 Cl. 40.2.3 / Table 20 ──
        // If τv > τc,max the section cannot be saved by shear reinforcement.
        if (zd.shear.status === 'FAIL') {
            feasible = false;
        }

        // ── Check 2: Flexural over-reinforcement — IS 456 Cl. 38.1 ──
        // A singly-reinforced wall must have Mu ≤ Mu,lim on both faces.
        // isDoubly === true means Mu > Mu,lim → section needs compression steel
        // → thickness is insufficient for the applied moment.
        if (zd.flex_hogging.isDoubly || zd.flex_sagging.isDoubly) {
            feasible = false;
        }

        // ── Check 3: Maximum steel ratio — IS 456 Cl. 26.5.1.1 ──
        // governs === 'maximum' means Ast_req > 4% × b × t. The function
        // silently capped Ast_req at Ast_max, but the section is under-designed.
        if (zd.flex_hogging.governs === 'maximum' || zd.flex_sagging.governs === 'maximum') {
            feasible = false;
        }

        // ── Check 4: Minimum wall thickness — IS 456 Cl. 32.2.3 ──
        if (zd.thickness < WALL_MIN_THICKNESS) {
            feasible = false;
        }

        // ── Track governing utilization for reporting ──
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

// ───────────────────── Structural Minimum Thickness ─────────────────────

/**
 * Compute the minimum wall thickness required to keep ALL zones singly reinforced
 * (Mu ≤ Mu,lim) and to satisfy the IS 456 Cl. 32.2.3 absolute minimum (150 mm).
 *
 * This function runs a preliminary analysis at a reference thickness (the maximum
 * available) to determine the actual governing moments from the continuous beam
 * model. It then uses the shared IS 456 Cl. 38.1 formula:
 *
 *   d = √(M / (R × b))   where R = coeff × fck
 *   t = d + cover + barDia/2
 *
 * This is the standard textbook formula for minimum effective depth from B.M.
 * consideration, applicable to walls, slabs, and footings alike.
 *
 * @param config    wall configuration
 * @param mesh      pre-computed pressure mesh (shared by the optimizer)
 * @param maxBarDia largest bar in the available set (mm)
 * @returns minimum required thickness in mm (rounded up to nearest integer)
 */
function computeMinRequiredThickness(
    config: WallConfig,
    mesh: PressureMesh,
    maxBarDia: number,
): number {
    const { material } = config;
    const fck = material.fck || 25;
    const fy = material.fy || 500;
    const cover = material.cover || 40;

    // Run a preliminary analysis at a conservatively large thickness to get the
    // actual governing moments from the continuous beam model. The moments are
    // weakly dependent on EI (which depends on thickness), but in a propped wall
    // under lateral pressure the moment distribution is dominated by the pressure
    // profile and span lengths, not the stiffness. Using max thickness gives a
    // conservative (slightly lower) estimate of d_min.
    const refThk = config.maxThk || 600;
    const refZones = config.zones.map(z => ({
        ...z,
        thickness: refThk,
        thicknessTop: refThk,
        thicknessBot: refThk,
    }));
    const refResult = analyzeWall({
        ...config,
        zones: refZones,
        _mesh: mesh,
    } as WallConfig);

    // For each zone, compute the minimum d (effective depth) from the governing
    // moment using the shared IS 456 Cl. 38.1 formula:
    //   d = √(M / (R × b))   where R = coeff × fck
    //   t = d + cover + barDia/2
    let tMin = WALL_MIN_THICKNESS; // IS 456 Cl. 32.2.3 absolute floor

    for (const zd of refResult.zoneDesigns) {
        const Mu_gov_kNm = zd.M_governing;
        if (Mu_gov_kNm <= 0.001) continue;

        // Use the shared formula: d = √(M / (R × b))
        const { d_req } = computeRequiredDepthForBM(Mu_gov_kNm, fck, fy, 1000);
        // Gross thickness = d + effective cover (clear cover + half bar diameter)
        const t_min_zone = Math.ceil(d_req + cover + maxBarDia / 2);
        tMin = Math.max(tMin, t_min_zone);
    }

    return tMin;
}

// ───────────────────── Post-Optimization Verification ─────────────────────

/**
 * VERIFY-001: After the optimizer selects a design, perform a full re-analysis
 * and confirm that ALL IS 456 checks pass. If any zone fails (shear, doubly
 * reinforced, max steel), bump that zone's thickness by one step and re-analyze.
 * Repeat up to MAX_VERIFY_ITER times to converge on a compliant design.
 *
 * This guards against numerical edge cases where the optimizer's feasibility
 * gate and the final re-analysis disagree (e.g. due to bar-selection iteration
 * changing d between passes).
 *
 * @param thicknesses  the selected thickness per variable
 * @param config       wall configuration (zones, material, etc.)
 * @param mesh         shared pressure mesh
 * @param thkStep      thickness increment for remediation (mm)
 * @param maxThk       upper bound on thickness (mm)
 * @param costRatio    steel/concrete cost ratio for cost index computation
 * @returns verified OptimumDesign or null if no compliant design is found
 */
const MAX_VERIFY_ITER = 5;

function verifyAndRemediate(
    thicknesses: number[],
    config: WallConfig,
    mesh: PressureMesh,
    thkStep: number,
    maxThk: number,
    costRatio: number,
): OptimumDesign | null {
    const { zones, ...restConfig } = config;
    let currentThk = [...thicknesses];

    for (let iter = 0; iter < MAX_VERIFY_ITER; iter++) {
        // Build zone config from current thicknesses
        const trialZones = zones.map((z: WallZone, i: number) => {
            if (config.isTapered) {
                return {
                    ...z,
                    thicknessTop: currentThk[i],
                    thicknessBot: currentThk[i + 1] ?? currentThk[i],
                };
            } else {
                return { ...z, thickness: currentThk[i] };
            }
        });

        const result = analyzeWall({
            ...restConfig,
            zones: trialZones,
            _mesh: mesh,
        } as WallConfig);

        // If fully feasible, return the verified design.
        if (result.feasible) {
            const ci = computeCostIndex(result.totalConcreteVol, result.totalSteelWeight, costRatio);
            return {
                thicknesses: [...currentThk],
                concreteVol: result.totalConcreteVol,
                steelWeight: result.totalSteelWeight,
                maxUtilization: result.maxUtilization,
                costIndex: ci,
                result,
            };
        }

        // Identify failing zones and bump their thickness by one step.
        // For tapered walls, bump both the top and bottom variables.
        let anyBumped = false;
        for (const zd of result.zoneDesigns) {
            const zIdx = zd.zone - 1; // 0-based zone index
            const zoneFails =
                zd.shear.status === 'FAIL' ||
                zd.flex_hogging.isDoubly || zd.flex_sagging.isDoubly ||
                zd.flex_hogging.governs === 'maximum' || zd.flex_sagging.governs === 'maximum' ||
                zd.thickness < WALL_MIN_THICKNESS;

            if (zoneFails) {
                if (config.isTapered) {
                    // Bump top and bottom thickness variables for this zone
                    if (currentThk[zIdx] + thkStep <= maxThk) {
                        currentThk[zIdx] += thkStep;
                        anyBumped = true;
                    }
                    const botIdx = zIdx + 1;
                    if (botIdx < currentThk.length && currentThk[botIdx] + thkStep <= maxThk) {
                        currentThk[botIdx] += thkStep;
                        anyBumped = true;
                    }
                } else {
                    if (currentThk[zIdx] + thkStep <= maxThk) {
                        currentThk[zIdx] += thkStep;
                        anyBumped = true;
                    }
                }
            }
        }

        // If no thickness could be bumped (already at maxThk), give up.
        if (!anyBumped) return null;
    }

    return null; // Could not converge within MAX_VERIFY_ITER iterations
}

// ───────────────────── Zone-by-Zone Optimization ─────────────────────

/**
 * Optimize wall thickness zone by zone.
 *
 * ALGORITHM:
 *   1. Compute the STRUCTURAL MINIMUM thickness from the actual design moments
 *      (IS 456 Cl. 38.1 limiting moment equation) and IS 456 Cl. 32.2.3 (150 mm).
 *   2. Clamp the user's minThk to this structural minimum so the optimizer never
 *      wastes time evaluating thicknesses that are guaranteed to fail.
 *   3. Enumerate all feasible thickness combinations (full enumeration for small
 *      search spaces, greedy sequential for large ones).
 *   4. Select the combination with the lowest cost index:
 *        costIndex = concreteCost × vol + steelCost × weight
 *   5. POST-OPTIMIZATION VERIFICATION: re-analyze the selected optimum and confirm
 *      that all IS 456 checks pass. If any fail, bump the failing zone's thickness
 *      and retry (up to 5 iterations).
 *
 * @param config     wall configuration (zones, soil, material, optimization bounds)
 * @param costRatio  steel cost per kg (default 90 ₹/kg)
 * @param onProgress optional callback invoked periodically with progress info
 */
export function optimizeWall(config: WallConfig, costRatio: number = 90, onProgress?: ProgressCallback): OptimizeResult {
    const { zones, minThk: userMinThk, maxThk, thkStep, ...restConfig } = config;
    const barDias = config.barDias || [8, 10, 12, 16, 20, 25];
    const maxBarDia = Math.max(...barDias);

    // ── Step 1: Compute thickness-independent pressure mesh (PERF-004) ────
    // The lateral-pressure mesh depends only on the zone *heights* and the
    // soil/water/surcharge/load-factor inputs — NONE of which change as the
    // optimizer sweeps thicknesses. Compute it ONCE here and feed it into
    // every analyzeWall trial via config._mesh.
    const sharedMesh = computePressureMesh({ ...restConfig, zones } as WallConfig);

    // ── Step 2: Compute structural minimum thickness ─────────────────────
    // Back-calculate the minimum wall thickness needed to keep all zones
    // singly reinforced (Mu ≤ Mu,lim per IS 456 Cl. 38.1) and satisfy the
    // IS 456 Cl. 32.2.3 absolute minimum of 150 mm.
    const structuralMin = computeMinRequiredThickness(
        { ...restConfig, zones, maxThk } as WallConfig,
        sharedMesh,
        maxBarDia,
    );

    // ── Step 3: Clamp and generate thickness options ─────────────────────
    // The user's minThk is clamped UP to the structural minimum so the
    // optimizer never evaluates guaranteed-to-fail thin sections.
    const effectiveMinThk = Math.max(userMinThk || 150, structuralMin, WALL_MIN_THICKNESS);
    const step = thkStep || 50;
    // Round effectiveMinThk up to the nearest step boundary from the user's
    // original minThk to keep the enumeration grid aligned.
    const startThk = Math.ceil(effectiveMinThk / step) * step;

    const thicknesses: number[] = [];
    for (let t = startThk; t <= maxThk!; t += step) {
        thicknesses.push(Math.round(t));
    }
    // Ensure at least one option exists (the clamped minimum itself)
    if (thicknesses.length === 0) thicknesses.push(Math.round(Math.min(startThk, maxThk!)));

    const nZones = zones.length;
    const nOpts = thicknesses.length;
    const nVars = config.isTapered ? nZones + 1 : nZones;

    // ── Step 4: Enumeration ──────────────────────────────────────────────
    // Full enumeration is the only path that proves a global optimum. Keep the
    // cap high enough for the documented realistic case (5 zones × 9 options =
    // 59,049 combos), then fall back only for genuinely huge searches.
    const maxCombos = 60000;
    const totalCombos = Math.pow(nOpts, nVars);

    if (totalCombos > maxCombos) {
        // Fall back to greedy sequential optimization (approximate, not exhaustive)
        return optimizeSequential(config, thicknesses, sharedMesh, costRatio, step, maxThk!, onProgress);
    }

    const results: OptimumDesign[] = [];
    const indices = new Array(nVars).fill(0);

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

            // Feasibility is now checked comprehensively inside analyzeWall:
            //   - Shear: τv ≤ τc,max (IS 456 Cl. 40.2.3)
            //   - Flexure: Mu ≤ Mu,lim on both faces (IS 456 Cl. 38.1)
            //   - Max steel: Ast ≤ 4% × b × t (IS 456 Cl. 26.5.1.1)
            //   - Min thickness: t ≥ 150 mm (IS 456 Cl. 32.2.3)
            if (result.feasible) {
                const costIndex = computeCostIndex(result.totalConcreteVol, result.totalSteelWeight, costRatio);
                results.push({
                    thicknesses: config.isTapered
                        ? indices.map((idx: number) => thicknesses[idx])
                        : trialZones.map(z => z.thickness),
                    concreteVol: result.totalConcreteVol,
                    steelWeight: result.totalSteelWeight,
                    maxUtilization: result.maxUtilization,
                    costIndex,
                    result,
                });
            }
        } catch (e) {
            // Skip invalid combinations (e.g. beam engine errors for extreme geometries)
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

    // Sort by cost index (primary), then max utilization (secondary tie-breaker)
    results.sort((a, b) => {
        const dCI = a.costIndex - b.costIndex;
        if (Math.abs(dCI) > 0.001) return dCI;
        return a.maxUtilization - b.maxUtilization;
    });

    // ── Step 5: Post-optimization verification (VERIFY-001) ──────────────
    // Re-analyze the best design and confirm all code checks pass.
    // If the verification fails (e.g. bar-selection iteration changed d),
    // bump failing zones and retry up to MAX_VERIFY_ITER times.
    let optimum: OptimumDesign | null = null;
    if (results.length > 0) {
        optimum = verifyAndRemediate(
            results[0].thicknesses,
            { ...restConfig, zones, isTapered: config.isTapered } as WallConfig,
            sharedMesh,
            step,
            maxThk!,
            costRatio,
        );
        // If the top candidate couldn't be remediated, try subsequent candidates
        if (!optimum) {
            for (let i = 1; i < Math.min(results.length, 10); i++) {
                optimum = verifyAndRemediate(
                    results[i].thicknesses,
                    { ...restConfig, zones, isTapered: config.isTapered } as WallConfig,
                    sharedMesh,
                    step,
                    maxThk!,
                    costRatio,
                );
                if (optimum) break;
            }
        }
    }

    return {
        totalTrials: totalCombos,
        feasibleCount: results.length,
        // CALC-005: full enumeration evaluated EVERY thickness combination, so the
        // returned optimum is provably the global minimum. Flag it so the UI can show
        // a "✓ Optimal" badge (vs the "⚠ Approximate" badge for the greedy fallback).
        approximate: false,
        method: 'full-enumeration',
        topDesigns: results.slice(0, 10),
        optimum,
        costRatioUsed: costRatio,
    };
}

/**
 * Sequential single-zone optimization (for large search spaces).
 *
 * ALGORITHM: greedy coordinate descent — fix all zones at maxThk, then for each
 * zone variable, sweep all thickness options and keep the one that yields the
 * lowest cost index while remaining feasible. Repeat until no improvement.
 *
 * This is NOT exhaustive: it may converge to a local minimum. The result is
 * flagged `approximate: true` so the UI can warn the user.
 *
 * Post-optimization verification (VERIFY-001) is applied identically to the
 * full-enumeration path.
 */
function optimizeSequential(
    config: WallConfig, thicknesses: number[], sharedMesh: PressureMesh | null,
    costRatio: number, thkStep: number, maxThkBound: number,
    onProgress?: ProgressCallback,
): OptimizeResult {
    const { zones, ...restConfig } = config;
    // PERF-004: reuse the caller's pre-computed pressure mesh; build one only if a
    // caller invoked this path directly without supplying it.
    const mesh = sharedMesh || computePressureMesh({ ...restConfig, zones } as WallConfig);
    const nZones = zones.length;
    const nVars = config.isTapered ? nZones + 1 : nZones;
    const maxThk = thicknesses[thicknesses.length - 1];

    // Start with maximum thickness everywhere (guaranteed feasible starting point)
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

    // Greedy coordinate descent: reduce each zone's thickness one at a time
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
            let bestCostIndex = Infinity;

            for (const t of thicknesses) {
                currentVars[v] = t;
                trialCount++;
                try {
                    const trialZones = applyVars(currentVars);
                    const result = analyzeWall({ ...restConfig, zones: trialZones, _mesh: mesh } as WallConfig);
                    // Feasibility now includes all IS 456 checks (shear, flexure,
                    // max steel, min thickness) — same gate as full enumeration.
                    if (result.feasible) {
                        const ci = computeCostIndex(result.totalConcreteVol, result.totalSteelWeight, costRatio);
                        if (ci < bestCostIndex) {
                            bestCostIndex = ci;
                            bestThk = t;
                        }
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

    // ── Post-optimization verification (VERIFY-001) ─────────────────────
    // Re-analyze the greedy result and confirm all IS 456 checks pass.
    // If verification fails, bump failing zones and retry.
    const verified = verifyAndRemediate(
        currentVars,
        { ...restConfig, zones, isTapered: config.isTapered } as WallConfig,
        mesh,
        thkStep,
        maxThkBound,
        costRatio,
    );
    const feasible = verified !== null;

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
        topDesigns: feasible ? [verified!] : [],
        optimum: verified,
        costRatioUsed: costRatio,
    };
}


// ───────────────────── Exports ─────────────────────
// Canvas drawing and HTML table rendering were split into wallRender.ts and
// wallHtml.ts (ARCH-01). This file exports only the mathematical core, the
// IS 456 design functions, the pressure mesh, the analysis, and the optimizer.
// All types and the three public functions above are already declared with
// `export` inline, so no additional export statement is needed here.
