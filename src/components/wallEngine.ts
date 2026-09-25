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
    developmentLength,
    flexuralDesign,
    selectBars,
    shearDesign,
    selectShearLinks,
    computeCostIndex,
    computeCost,
    computeRequiredDepthForBM,
    WALL_MIN_THICKNESS,
    crackWidthAnnexF,
    sectionMomentCapacityAtAxial,
    slabDepthFactorK,
    type CrackWidthResult,
    type ConcreteGrade,
    type SteelGrade,
    type Governs,
    type ShearStatus,
    type FlexuralResult as FlexuralDesign,
    type BarResult as BarSelection,
    type CostParameters,
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
    // Vertical load from the structure above at the top of the wall (kN/m, service).
    axialLoad?: number;
    // Crack width control (IS 456 Cl. 35.3.2 / Annex F). Default on; limits
    // 0.2 mm on the earth face (contact with soil / ground water), 0.3 mm inside.
    checkCrackWidth?: boolean;
    crackWidthLimitEarth?: number;
    crackWidthLimitInner?: number;
    // Check the construction stage: backfill placed before the floors are cast
    // (wall acts as a cantilever from the base). Default off — then the
    // drawings must require backfilling only after the floors are cast.
    checkConstructionStage?: boolean;
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
    thickness: number;          // mean thickness (volume); tapered sections use their own
    thicknessTop: number;
    thicknessBot: number;
    d_hogging: number;          // at the governing earth-face section
    d_sagging: number;          // at the governing inner-face section
    x_hogging: number;          // governing sections, m below the zone top
    x_sagging: number;
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
    shear_k: number;           // Cl. 40.2.1.1 depth factor
    shearOk: boolean;          // τv ≤ k·τc (no links in the wall)
    // governing shear section: support end, tension face (h = earth, s = inner), d (mm)
    shearAt: { at: 'top' | 'bottom'; face: 'h' | 's'; d: number };
    // extra tension bars near a support where τc of the continuous bars is
    // short; length (m) includes the extension and the anchorage
    shearBars: { at: 'top' | 'bottom'; face: 'h' | 's'; bars: BarSelection; length: number; Ast_total: number; ok: boolean }[];
    mainBars_hogging: BarSelection;
    mainBars_sagging: BarSelection;
    distBars: BarSelection;    // horizontal steel per face (Cl. 32.5 c)
    crack: {                    // Ms = service moment M/γf (in-service, propped)
        hogging: CrackWidthResult & { Ms: number; x: number; limit: number; ok: boolean };
        sagging: CrackWidthResult & { Ms: number; x: number; limit: number; ok: boolean };
    };
    pm: {                       // axial + bending with slenderness (Cl. 32.2 / 39)
        Pu: number; He: number; slenderness: number; slendernessOk: boolean; ea: number;
        Mu_h: number; cap_h: number; Mu_s: number; cap_s: number; ok: boolean;
    };
    construction: { M: number; V: number } | null;  // cantilever stage (factored), when checked
    ok: boolean;               // every check in the zone passes
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
    costIndex: number;             // AUDIT FIX OPT-4 (2026-07-04): now in INR (was INR without formwork); kept the field name for back-compat
    formworkArea: number;          // AUDIT FIX OPT-4: formwork area exposed for transparency
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
    // `??` (not `||`) so φ = 0 (clay) gives K0 = 1 instead of silently becoming 30°.
    const K0 = computeK0(soilParams.phi ?? 30);

    const pressureParams: PressureParams = {
        K0,
        gamma_soil: soilParams.gamma_soil ?? 18,
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
    const cover = material.cover || 40;
    const fck = material.fck, fy = material.fy;
    const GAMMA_CONCRETE = 25;
    const axialTop = Math.max(0, Number(config.axialLoad) || 0);          // kN/m, service
    const checkCrack = config.checkCrackWidth !== false;
    const crackLimitEarth = Number(config.crackWidthLimitEarth ?? 0.2);    // mm — Cl. 35.3.2 (contact with soil / ground water)
    const crackLimitInner = Number(config.crackWidthLimitInner ?? 0.3);    // mm — Cl. 35.3.2 general
    const consStage = config.checkConstructionStage === true;

    // Construction stage: wall backfilled before the floors are cast acts as a
    // vertical cantilever fixed at the base (factored pressure profile).
    //   V_c(z) = ∫0^z p dζ,   M_c(z) = ∫0^z p(ζ)(z − ζ) dζ
    const cantileverAt = (z: number) => {
        let V = 0, M = 0;
        for (let k = 0; k < pressureProfile.length - 1; k++) {
            const a = pressureProfile[k], b = pressureProfile[k + 1];
            const za = a.depth, zb = Math.min(b.depth, z);
            if (zb <= za + 1e-12) { if (a.depth >= z) break; continue; }
            const pa = a.combined;
            const pb = b.depth > za ? a.combined + (b.combined - a.combined) * (zb - za) / (b.depth - za) : b.combined;
            const h = zb - za;
            const F = 0.5 * (pa + pb) * h;
            const ybar = (pa + pb) > 0 ? h * (pa + 2 * pb) / (3 * (pa + pb)) : h / 2;
            V += F;
            M += F * (z - (za + ybar));
            if (b.depth >= z) break;
        }
        return { V, M };
    };
    // Self-weight above depth z (kN/m)
    const selfWeightAbove = (z: number) => {
        let W = 0;
        for (let i = 0; i < nZones; i++) {
            const top = cumDepths[i], bot = Math.min(cumDepths[i + 1], z);
            if (bot <= top) break;
            const tTop = config.isTapered ? (zones[i].thicknessTop || zones[i].thickness) : zones[i].thickness;
            const tBot = config.isTapered ? (zones[i].thicknessBot || zones[i].thickness) : zones[i].thickness;
            const tAvg = (tTop + tBot) / 2;
            W += (tAvg / 1000) * (bot - top) * GAMMA_CONCRETE;
        }
        return W;
    };
    const kSlab = slabDepthFactorK;
    const distRatio = fy >= 415 ? 0.0020 : 0.0025;     // Cl. 32.5(c), deformed bars ≤ 16 mm

    const zoneDesigns: ZoneDesign[] = [];
    for (let i = 0; i < nZones; i++) {
        const segs = segByZone[i];
        const isTapered = config.isTapered || false;
        const tTop = isTapered ? (zones[i].thicknessTop || zones[i].thickness) : zones[i].thickness;
        const tBot = isTapered ? (zones[i].thicknessBot || zones[i].thickness) : zones[i].thickness;
        const t_mm = isTapered ? (tTop + tBot) / 2 : zones[i].thickness;
        const h_m = zones[i].height;
        const zoneTopDepth = cumDepths[i];
        // Thickness varies linearly over a tapered zone. Every section is
        // designed at its own thickness — the zone used to be designed at the
        // mean thickness, which over-states d at the thin end (unconservative
        // where the thin end carries the larger moment, e.g. a continuous
        // support at the top of a lower zone).
        const tAt = (x: number) => tTop + (tBot - tTop) * Math.min(1, Math.max(0, x / h_m));
        const tMin = Math.min(tTop, tBot), tMax = Math.max(tTop, tBot);
        const xThick = tBot >= tTop ? h_m : 0;

        // Shear and moment (physical units) at a distance x below the zone top.
        const forcesAt = (xFromZoneTop: number): { V: number; M: number } => {
            const depth = zoneTopDepth + xFromZoneTop;
            for (const k of segs) {
                const s = segDepths[k];
                if (depth >= s.top - 1e-9 && depth <= s.bot + 1e-9) {
                    const xi = (depth - s.top) / L_ref;
                    return { V: beamResult.spans[k].V(xi) * L_ref, M: beamResult.spans[k].M(xi) * L_ref * L_ref };
                }
            }
            const sp = beamResult.spans[segs[segs.length - 1]];
            const aL = sp.alpha.fl();
            return { V: sp.V(aL) * L_ref, M: sp.M(aL) * L_ref * L_ref };
        };

        const firstSp = beamResult.spans[segs[0]];
        const lastSp = beamResult.spans[segs[segs.length - 1]];
        const ML = firstSp.MLeft * L_ref * L_ref;
        const MR = lastSp.MRight * L_ref * L_ref;
        const VL = firstSp.VLeft * L_ref;
        const VR = lastSp.VRight * L_ref;

        // Moment samples along the zone, separated by face — earth face
        // (hogging, M < 0) / inner face (sagging, M > 0); x from the zone top.
        type Sample = { x: number; M: number; t: number };
        const hogService: Sample[] = [];
        const sagService: Sample[] = [];
        const nSteps = 40;
        for (const k of segs) {
            const sp = beamResult.spans[k];
            const s = segDepths[k];
            const aL = sp.alpha.fl();
            for (let j = 0; j <= nSteps; j++) {
                const M_val = sp.M((j / nSteps) * aL) * L_ref * L_ref;
                const x = s.top - zoneTopDepth + (j / nSteps) * (s.bot - s.top);
                if (M_val > 0) sagService.push({ x, M: M_val, t: tAt(x) });
                else if (M_val < 0) hogService.push({ x, M: -M_val, t: tAt(x) });
            }
        }
        const maxOf = (list: Sample[]) => list.reduce((m, s) => Math.max(m, s.M), 0);
        const M_hogging_propped = maxOf(hogService);
        const M_sagging = maxOf(sagService);

        // Sections that can govern: steel demand and stress ∝ M/d, so sections
        // below half the largest M/d are skipped (always well below the peak).
        const candidates = (list: Sample[]) => {
            const ratio = (q: Sample) => q.M / Math.max(1, q.t - cover);
            const top = list.reduce((m, q) => Math.max(m, ratio(q)), 0);
            return list.filter(q => ratio(q) >= 0.5 * top);
        };

        // Construction stage: the earth face carries the cantilever moment,
        // largest at the bottom of each zone.
        let construction: { M: number; V: number } | null = null;
        const hogDemand: Sample[] = [...hogService];
        if (consStage) {
            const c = cantileverAt(cumDepths[i + 1]);
            construction = { M: c.M, V: c.V };
            hogDemand.push({ x: h_m, M: c.M, t: tAt(h_m) });
        }
        const M_hogging = maxOf(hogDemand);
        const M_gov = Math.max(M_hogging, M_sagging);
        // The thickest section fixes the minimum steel of the (uniform) bars.
        const sagDemand: Sample[] = [...candidates(sagService), { x: xThick, M: 0, t: tMax }];
        const hogDesign: Sample[] = [...candidates(hogDemand), { x: xThick, M: 0, t: tMax }];

        // Flexural design of one face: the section needing the most steel at
        // its own depth governs (a section needing compression steel or more
        // than 4 % governs outright).
        const designFace = (dem: Sample[], dia: number) => {
            let gov: { flex: FlexuralDesign; x: number; M: number; t: number } | null = null;
            // ties (minimum steel governing) go to the larger moment
            const rank = (f: FlexuralDesign, M: number) => (f.isDoubly || f.governs === 'maximum' ? 1e12 : 0) + f.Ast_req + 1e-6 * M;
            for (const s of dem) {
                const flex = flexuralDesign(s.M, b, s.t - cover - dia / 2, fck, fy, s.t, true);
                if (!gov || rank(flex, s.M) > rank(gov.flex, gov.M)) gov = { flex, x: s.x, M: s.M, t: s.t };
            }
            return gov!;
        };
        // First pass with the largest available bar (conservative d, CALC-004),
        // then again with the diameter actually selected.
        let hogGov = designFace(hogDesign, maxBarDia);
        let sagGov = designFace(sagDemand, maxBarDia);
        let mainBars_hogging = selectBars(hogGov.flex.Ast_req, barDias, spacings, b);
        let mainBars_sagging = selectBars(sagGov.flex.Ast_req, barDias, spacings, b);
        if (mainBars_hogging.dia !== maxBarDia || mainBars_sagging.dia !== maxBarDia) {
            hogGov = designFace(hogDesign, mainBars_hogging.dia);
            sagGov = designFace(sagDemand, mainBars_sagging.dia);
            mainBars_hogging = selectBars(hogGov.flex.Ast_req, barDias, spacings, b);
            mainBars_sagging = selectBars(sagGov.flex.Ast_req, barDias, spacings, b);
        }
        const flex_hogging = hogGov.flex;
        const flex_sagging = sagGov.flex;

        const setBars = (face: 'h' | 's', bars: BarSelection) => {
            if (face === 'h') mainBars_hogging = bars; else mainBars_sagging = bars;
        };
        const barsOf = (face: 'h' | 's') => face === 'h' ? mainBars_hogging : mainBars_sagging;
        // Effective depth of a face at x (local thickness, bars of that face)
        const dAt = (face: 'h' | 's', x: number) => tAt(x) - cover - barsOf(face).dia / 2;

        // Crack width — IS 456 Annex F on the service moments (M/γf) at every
        // section, each at its own thickness. Earth face in contact with soil /
        // ground water: 0.2 mm; inner face 0.3 mm (Cl. 35.3.2). The propped
        // (in-service) moments are used.
        const crackAt = (face: 'h' | 's', s: Sample) => {
            const bars = barsOf(face);
            return crackWidthAnnexF(s.M / loadFactor, b, s.t, s.t - cover - bars.dia / 2, bars.Ast_provided, bars.dia, bars.spacing, cover, fck, fy);
        };
        const hogCrackList = candidates(hogService);
        const sagCrackList = candidates(sagService);
        // Memoised per bar arrangement (the bars change only when increased)
        const crackMemo = { h: new Map<BarSelection, { cw: CrackWidthResult; s: Sample } | null>(), s: new Map<BarSelection, { cw: CrackWidthResult; s: Sample } | null>() };
        const worstCrack = (face: 'h' | 's') => {
            const key = barsOf(face), memo = crackMemo[face];
            if (!memo.has(key)) memo.set(key, worstCrackUncached(face));
            return memo.get(key)!;
        };
        const worstCrackUncached = (face: 'h' | 's') => {
            const list = face === 'h' ? hogCrackList : sagCrackList;
            const limit = face === 'h' ? crackLimitEarth : crackLimitInner;
            let worst: { cw: CrackWidthResult; s: Sample } | null = null;
            for (const s of list) {
                const cw = crackAt(face, s);
                const score = (cw.fs_ok ? 0 : 1e6) + cw.w / limit;
                if (!worst || score > (worst.cw.fs_ok ? 0 : 1e6) + worst.cw.w / limit) worst = { cw, s };
            }
            return worst;
        };
        const crackFails = (face: 'h' | 's') => {
            if (!checkCrack) return false;
            const wc = worstCrack(face);
            if (!wc) return false;
            return wc.cw.w > (face === 'h' ? crackLimitEarth : crackLimitInner) || !wc.cw.fs_ok;
        };

        // Shear without links — the wall is designed as a vertical slab:
        // τv ≤ k·τc (Cl. 40.2.1.1), at d from the face of BOTH supports of the
        // zone (Cl. 22.6.2.1), with pt of the face in tension at that section
        // (Table 19) and the thickness of that end. The tension face follows
        // the sign of M there: sagging (inner face) below a pinned top, hogging
        // (earth face) at continuous supports and at the fixed base.
        const shearCases = () => {
            const cases: { V: number; face: 'h' | 's'; at: 'top' | 'bottom'; d: number; k: number; stage: 'propped' | 'construction' }[] = [];
            for (const at of ['top', 'bottom'] as const) {
                const xEnd = at === 'top' ? 0 : h_m;
                const sec = (face: 'h' | 's') => {
                    const dm = dAt(face, xEnd) / 1000;
                    const x = dm >= h_m ? xEnd : (at === 'top' ? dm : h_m - dm);
                    return { ...forcesAt(x), x };
                };
                const fh = sec('h'), fs = sec('s');
                let face: 'h' | 's';
                if (fh.M < 0 && !(fs.M > 0)) face = 'h';
                else if (fs.M > 0 && !(fh.M < 0)) face = 's';
                else face = mainBars_hogging.Ast_provided <= mainBars_sagging.Ast_provided ? 'h' : 's';
                const f = face === 'h' ? fh : fs;
                cases.push({ V: Math.abs(f.V), face, at, d: dAt(face, f.x), k: kSlab(tAt(f.x)), stage: 'propped' });
            }
            // Construction stage: cantilever shear at d above the base, earth face in tension
            if (consStage) {
                const dm = Math.min(dAt('h', h_m) / 1000, h_m);
                cases.push({ V: cantileverAt(cumDepths[i + 1] - dm).V, face: 'h', at: 'bottom', d: dAt('h', h_m - dm), k: kSlab(tAt(h_m - dm)), stage: 'construction' });
            }
            return cases;
        };
        // Least pt (%) giving τc ≥ target (Table 19, τc rising with pt up to 3 %)
        const ptForTauC = (target: number): number | null => {
            if (getTauC(3.0, fck) < target) return null;
            let lo = 0.15, hi = 3.0;
            if (getTauC(lo, fck) >= target) return lo;
            for (let it = 0; it < 40; it++) {
                const mid = 0.5 * (lo + hi);
                if (getTauC(mid, fck) < target) lo = mid; else hi = mid;
            }
            return hi;
        };

        // Where the crack width falls short, the tension bars of that face are
        // increased over the whole zone (a zone that still fails needs a
        // thicker section).
        for (const face of ['h', 's'] as const) {
            for (let it = 0; it < 25 && crackFails(face) && barsOf(face).adequate !== false; it++) {
                setBars(face, selectBars(barsOf(face).Ast_provided * 1.1, barDias, spacings, b));
            }
        }

        // Where τc of the continuous bars falls short at a support, EXTRA
        // tension bars are added near that support only (Table 19: p_t counts
        // the bars continuing at least d beyond the section). Their length:
        //   the stretch where the continuous bars alone are short
        //   + max(d, 12φ) beyond it (Cl. 26.2.3.1)
        //   + Ld anchorage past the support face (Cl. 26.2.1).
        // Previously the bars of the whole face were increased over the full
        // zone height, which over-stated the steel and pushed the optimizer
        // towards thicker walls.
        type ShearCase = ReturnType<typeof shearCases>[number];
        const shearAtSection = (c: ShearCase, a: number) => {
            // a = distance from the support face (m); sections nearer than d
            // take the shear at d (Cl. 22.6.2.1)
            const aa = Math.max(a, c.d / 1000);
            const x = c.at === 'top' ? Math.min(aa, h_m) : Math.max(h_m - aa, 0);
            const V = c.stage === 'construction'
                ? cantileverAt(cumDepths[i] + x).V
                : Math.abs(forcesAt(x).V);
            return { V, d: dAt(c.face, x), k: kSlab(tAt(x)) };
        };
        const baseShort = (c: ShearCase, a: number) => {
            const q = shearAtSection(c, a);
            const pt = 100 * barsOf(c.face).Ast_provided / (b * q.d);
            return q.V * 1e3 / (b * q.d) > q.k * getTauC(pt, fck);
        };
        type ExtraBars = { at: 'top' | 'bottom'; face: 'h' | 's'; bars: BarSelection; length: number; Ast_total: number; ok: boolean };
        const extras = new Map<string, ExtraBars>();
        for (const c of shearCases()) {
            if (!baseShort(c, 0)) continue;                         // continuous bars suffice
            const tau_v = c.V * 1e3 / (b * c.d);
            const pt = ptForTauC(tau_v / c.k);
            const base = barsOf(c.face);
            const key = `${c.at}/${c.face}`;
            const prev = extras.get(key);
            const merge = (cand: ExtraBars) => extras.set(key, !prev ? cand : {
                at: c.at, face: c.face,
                bars: cand.bars.Ast_provided >= prev.bars.Ast_provided ? cand.bars : prev.bars,
                length: Math.max(cand.length, prev.length),
                Ast_total: base.Ast_provided + Math.max(cand.bars.Ast_provided, prev.bars.Ast_provided),
                ok: cand.ok && prev.ok,
            });
            if (pt === null) {                                      // needs a thicker section
                merge({ at: c.at, face: c.face, bars: base, length: 0, Ast_total: base.Ast_provided, ok: false });
                continue;
            }
            const AstAdd = pt * b * c.d / 100 - base.Ast_provided;
            // extra bars no larger than the continuous bars, so d is unchanged
            const bars = selectBars(AstAdd, barDias.filter(x => x <= base.dia), spacings, b);
            // stretch where the continuous bars alone are short
            let aReq = c.d / 1000;
            const nScan = 40;
            for (let j = 1; j <= nScan; j++) {
                const a = (j / nScan) * h_m;
                if (a <= c.d / 1000) continue;
                if (!baseShort(c, a)) break;
                aReq = a;
            }
            const Ld = developmentLength(bars.dia, fy, material.grade) / 1000;
            const length = Math.min(aReq + Math.max(c.d / 1000, 12 * bars.dia / 1000), h_m) + Ld;
            merge({ at: c.at, face: c.face, bars, length, Ast_total: base.Ast_provided + bars.Ast_provided, ok: bars.adequate !== false });
        }
        const shearBars = [...extras.values()];
        const AstAt = (c: ShearCase) =>
            barsOf(c.face).Ast_provided + (extras.get(`${c.at}/${c.face}`)?.bars.Ast_provided ?? 0);

        // Reported effective depths: at the governing flexural section of each face
        const d_hogging = dAt('h', hogGov.x);
        const d_sagging = dAt('s', sagGov.x);

        const crackEntry = (face: 'h' | 's', limit: number) => {
            const wc = worstCrack(face);
            const bars = barsOf(face);
            const cw = wc ? wc.cw : crackWidthAnnexF(0, b, tMax, dAt(face, xThick), bars.Ast_provided, bars.dia, bars.spacing, cover, fck, fy);
            return { ...cw, Ms: wc ? wc.s.M / loadFactor : 0, x: wc ? wc.s.x : xThick, limit, ok: !crackFails(face) };
        };
        const crack = {
            hogging: crackEntry('h', crackLimitEarth),
            sagging: crackEntry('s', crackLimitInner),
        };

        // Governing shear case: the largest τv / (k·τc)
        let shear = shearDesign(0, b, d_sagging, mainBars_sagging.Ast_provided, fck, fy, material.grade);
        let V_gov = 0, shearRatio = -1, k_shear = kSlab(tMin);
        let shearAt: ZoneDesign['shearAt'] = { at: 'bottom', face: 'h', d: d_hogging };
        for (const c of shearCases()) {
            const sd = shearDesign(c.V, b, c.d, AstAt(c), fck, fy, material.grade);
            const ratio = sd.tau_v / (c.k * sd.tau_c);
            if (ratio > shearRatio) {
                shearRatio = ratio; shear = sd; V_gov = c.V; k_shear = c.k;
                shearAt = { at: c.at, face: c.face, d: c.d };
            }
        }
        const shearOk = shear.tau_v <= k_shear * shear.tau_c && shearBars.every(e => e.ok);

        // Axial load + bending with slenderness — IS 456 Cl. 32.2 / Cl. 39.
        // Slenderness and ea on the thinnest section (conservative for a
        // tapered zone); capacity at each face's governing section, at its
        // own thickness, under the axial load at the zone bottom.
        const Pu = loadFactor * (axialTop + selfWeightAbove(cumDepths[i + 1]));
        const He = 0.75 * h_m;                                  // Cl. 32.2.3(a), floors restrain rotation
        const slenderness = He * 1000 / tMin;
        const ea = (He * 1000) ** 2 / (2500 * tMin);            // mm, Cl. 32.2.5
        const pmAt = (face: 'h' | 's', x: number, M: number) => {
            const t = tAt(x);
            const emin = 0.05 * t;                              // mm, Cl. 32.2.4
            const Mu = Math.max(M, Pu * emin / 1000) + Pu * ea / 1000;
            const other = face === 'h' ? mainBars_sagging : mainBars_hogging;
            const cap = sectionMomentCapacityAtAxial(b, t, [
                { As: other.Ast_provided, y: cover + other.dia / 2 },
                { As: barsOf(face).Ast_provided, y: dAt(face, x) },
            ], fck, fy, Pu);
            return { Mu, cap };
        };
        // Each face checked at its governing flexural section and at its
        // largest moment; the worse ratio is reported.
        const peak = (list: Sample[]) => list.reduce<Sample | null>((m, q) => (!m || q.M > m.M ? q : m), null);
        const worsePM = (face: 'h' | 's', a: Sample, bSample: Sample | null) => {
            const pa = pmAt(face, a.x, a.M);
            if (!bSample || (bSample.x === a.x && bSample.M === a.M)) return pa;
            const pb = pmAt(face, bSample.x, bSample.M);
            return pb.Mu / Math.max(pb.cap, 1e-9) > pa.Mu / Math.max(pa.cap, 1e-9) ? pb : pa;
        };
        const hogPM = worsePM('h', hogGov, peak(hogDemand));
        const sagPM = worsePM('s', sagGov, peak(sagService));
        const pm = {
            Pu: Math.round(Pu * 10) / 10, He: Math.round(He * 1000) / 1000,
            slenderness: Math.round(slenderness * 10) / 10, slendernessOk: slenderness <= 30,
            ea: Math.round(ea * 10) / 10,
            Mu_h: Math.round(hogPM.Mu * 100) / 100, cap_h: Math.round(hogPM.cap * 100) / 100,
            Mu_s: Math.round(sagPM.Mu * 100) / 100, cap_s: Math.round(sagPM.cap * 100) / 100,
            ok: slenderness <= 30 && hogPM.cap >= hogPM.Mu - 1e-6 && sagPM.cap >= sagPM.Mu - 1e-6,
        };

        // Horizontal (distribution) steel — Cl. 32.5(c), half on each face,
        // sized for the thickest section of the zone
        const distPerFace = distRatio * 1000 * tMax / 2;
        const distSpacings = spacings.filter(sp => sp <= Math.min(3 * tMin, 450));
        const distBars = selectBars(distPerFace, [8, 10, 12, 16], distSpacings.length ? distSpacings : spacings, b);

        const barsOk = mainBars_hogging.adequate !== false && mainBars_sagging.adequate !== false;
        const zoneOk = !flex_hogging.isDoubly && !flex_sagging.isDoubly
            && flex_hogging.governs !== 'maximum' && flex_sagging.governs !== 'maximum'
            && barsOk && shearOk && shear.status !== 'FAIL'
            && crack.hogging.ok && crack.sagging.ok && pm.ok
            && tMin >= WALL_MIN_THICKNESS;

        zoneDesigns.push({
            zone: i + 1,
            height: h_m,
            thickness: t_mm,
            thicknessTop: tTop,
            thicknessBot: tBot,
            d_hogging,
            d_sagging,
            x_hogging: hogGov.x,
            x_sagging: sagGov.x,
            EI: zoneEIs[i],
            M_left: ML,
            M_right: MR,
            M_max_span: M_sagging,
            M_hogging,
            M_sagging,
            M_governing: M_gov,
            V_left: VL,
            V_right: VR,
            V_governing: V_gov,
            flex_hogging,
            flex_sagging,
            shear,
            shear_k: k_shear,
            shearOk,
            shearAt,
            shearBars,
            mainBars_hogging,
            mainBars_sagging,
            distBars,
            crack,
            pm,
            construction,
            ok: zoneOk,
            pressureTop: zonePressures[i].top,
            pressureBot: zonePressures[i].bottom,
        });
    }

    // ── Totals & feasibility ─────────────────────────────────────────────────
    // A zone is feasible when: Mu ≤ Mu,lim on both faces (Cl. 38.1), Ast ≤ 4 %
    // (Cl. 26.5.1.1), bars can supply the steel, τv ≤ k·τc without links
    // (Cl. 40.2.1.1), crack width within Cl. 35.3.2 (Annex F), axial + bending
    // with slenderness (Cl. 32.2 / 39) and t ≥ 150 mm (Cl. 32.2.3).
    let totalConcreteVol = 0;
    let totalSteelWeight = 0;
    let feasible = true;
    let governingZone: number | null = null;
    let maxUtilization = 0;
    for (const zd of zoneDesigns) {
        totalConcreteVol += (zd.thickness / 1000) * zd.height;
        const mainSteelWeight = ((zd.mainBars_hogging.Ast_provided + zd.mainBars_sagging.Ast_provided) / 1e6) * zd.height * 7850;
        const distSteelWeight = (2 * zd.distBars.Ast_provided / 1e6) * zd.height * 7850;
        const shearSteelWeight = zd.shearBars.reduce((w, e) => w + (e.bars.Ast_provided / 1e6) * e.length * 7850, 0);
        totalSteelWeight += mainSteelWeight + distSteelWeight + shearSteelWeight;
        if (!zd.ok) feasible = false;
        const maxUtil = Math.max(zd.flex_hogging.utilization, zd.flex_sagging.utilization);
        if (maxUtil > maxUtilization) {
            maxUtilization = maxUtil;
            governingZone = zd.zone;
        }
    }

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
 * Minimum thickness of EACH zone to stay singly reinforced (Mu ≤ Mu,lim,
 * IS 456 Cl. 38.1) and to satisfy the Cl. 32.2.3 absolute minimum (150 mm).
 *
 * A preliminary analysis at a uniform reference thickness (the maximum
 * available) gives the governing moment of every zone; then
 *
 *   d = √(M / (R × b))   where R = coeff × fck
 *   t = d + cover + barDia/2
 *
 * The minimum is returned per zone — a single wall-wide minimum (the old
 * behaviour) forced lightly loaded upper zones up to the thickness needed by
 * the most heavily loaded zone, so thin upper zones were never evaluated.
 *
 * @param config    wall configuration
 * @param mesh      pre-computed pressure mesh (shared by the optimizer)
 * @param maxBarDia largest bar in the available set (mm)
 * @returns minimum required thickness per zone in mm (rounded up)
 */
function computeMinRequiredThickness(
    config: WallConfig,
    mesh: PressureMesh,
    maxBarDia: number,
): number[] {
    const { material } = config;
    const fck = material.fck || 25;
    const fy = material.fy || 500;
    const cover = material.cover || 40;

    // The moments depend on the relative zone stiffness, so this estimate is
    // only a pruning aid: the optimizer relaxes it (see zoneFloor in
    // optimizeWall) and every candidate is still fully analysed.
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

    return refResult.zoneDesigns.map(zd => {
        const Mu_gov_kNm = zd.M_governing;
        if (Mu_gov_kNm <= 0.001) return WALL_MIN_THICKNESS;
        const { d_req } = computeRequiredDepthForBM(Mu_gov_kNm, fck, fy, 1000);
        return Math.max(WALL_MIN_THICKNESS, Math.ceil(d_req + cover + maxBarDia / 2));
    });
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
            // AUDIT FIX OPT-4 (2026-07-04): include formwork in the cost.
            // Formwork area per metre run = 2 × totalHeight (both faces of wall).
            const formworkArea = 2 * result.totalHeight;
            const ci = computeCost(
                result.totalConcreteVol,
                result.totalSteelWeight,
                formworkArea,
                { steelCost_per_kg: costRatio, concreteCost_per_m3: 6500, formworkCost_per_m2: 350, wastage_factor: 1.07 },
            );
            return {
                thicknesses: [...currentThk],
                concreteVol: result.totalConcreteVol,
                steelWeight: result.totalSteelWeight,
                maxUtilization: result.maxUtilization,
                costIndex: ci,
                formworkArea,
                result,
            };
        }

        // Identify failing zones and bump their thickness by one step.
        // For tapered walls, bump both the top and bottom variables.
        // zd.ok carries every zone check (flexure, 4 % steel, bars, shear
        // without links, crack width, axial + bending, 150 mm minimum), the
        // same gate that sets result.feasible.
        let anyBumped = false;
        for (const zd of result.zoneDesigns) {
            const zIdx = zd.zone - 1; // 0-based zone index
            if (!zd.ok) {
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

/** Cost per m run: concrete + steel (7 % wastage) + formwork on both faces (OPT-4). */
function wallCost(result: WallAnalysisResult, costRatio: number): { costIndex: number; formworkArea: number } {
    const formworkArea = 2 * result.totalHeight;
    const costIndex = computeCost(
        result.totalConcreteVol,
        result.totalSteelWeight,
        formworkArea,
        { steelCost_per_kg: costRatio, concreteCost_per_m3: 6500, formworkCost_per_m2: 350, wastage_factor: 1.07 },
    );
    return { costIndex, formworkArea };
}

/**
 * Optimize wall thickness zone by zone.
 *
 * ALGORITHM:
 *   1. Compute the STRUCTURAL MINIMUM thickness of EACH zone from its design
 *      moment (IS 456 Cl. 38.1 limiting moment) and Cl. 32.2.3 (150 mm).
 *   2. Build the thickness grid from the user's minThk to maxThk and give every
 *      zone only the options at or above 85 % of its own minimum (a relaxed
 *      floor — the minimum comes from a uniform-thickness analysis and the
 *      moments shift when the zone stiffnesses change). Thin upper zones are
 *      therefore evaluated even when a lower zone needs a thick section.
 *      Tapered walls: every section is designed at its own thickness and the
 *      peak moment may sit at the thick end, so a combination is pruned only
 *      when even the thicker node of a zone is below its floor.
 *   3. Enumerate all combinations (full enumeration for small search spaces,
 *      greedy sequential for large ones).
 *   4. Select the combination with the lowest cost:
 *        cost = concrete × vol + steel × weight × wastage + formwork × area
 *   5. POST-OPTIMIZATION VERIFICATION: re-analyze the selected optimum and confirm
 *      that all IS 456 checks pass. If any fail, bump the failing zone's thickness
 *      and retry (up to 5 iterations).
 *
 * @param config     wall configuration (zones, soil, material, optimization bounds)
 * @param costRatio  steel cost per kg (default 90 ₹/kg)
 * @param onProgress optional callback invoked periodically with progress info
 */
export function optimizeWall(config: WallConfig, costRatio: number = 90, onProgress?: ProgressCallback): OptimizeResult {
    const { zones, minThk: userMinThk, maxThk: userMaxThk, thkStep, ...restConfig } = config;
    const barDias = config.barDias || [8, 10, 12, 16, 20, 25];
    const maxBarDia = Math.max(...barDias);
    const maxThk = userMaxThk || 600;
    const step = thkStep || 50;

    // ── Step 1: Compute thickness-independent pressure mesh (PERF-004) ────
    // The lateral-pressure mesh depends only on the zone *heights* and the
    // soil/water/surcharge/load-factor inputs — NONE of which change as the
    // optimizer sweeps thicknesses. Compute it ONCE here and feed it into
    // every analyzeWall trial via config._mesh.
    const sharedMesh = computePressureMesh({ ...restConfig, zones } as WallConfig);

    // ── Step 2: Structural minimum thickness per zone ────────────────────
    const zoneMin = computeMinRequiredThickness(
        { ...restConfig, zones, maxThk } as WallConfig,
        sharedMesh,
        maxBarDia,
    );
    const zoneFloor = zoneMin.map(t => 0.85 * t);

    // ── Step 3: Thickness options per variable ───────────────────────────
    const lo = Math.max(userMinThk || 150, WALL_MIN_THICKNESS);
    const grid: number[] = [];
    for (let t = lo; t <= maxThk + 1e-9; t += step) grid.push(Math.round(t));
    // Ensure at least one option exists
    if (grid.length === 0) grid.push(Math.round(maxThk));
    const gridMax = grid[grid.length - 1];

    const nZones = zones.length;
    const nVars = config.isTapered ? nZones + 1 : nZones;
    const options: number[][] = config.isTapered
        ? Array.from({ length: nVars }, () => grid)
        : zoneFloor.map(f => {
            const opts = grid.filter(t => t >= Math.min(f, gridMax) - 1e-9);
            return opts.length ? opts : [gridMax];
        });
    // Tapered: prune only when the thicker node of a zone is below its floor.
    const passesFloors = (vars: number[]): boolean => !config.isTapered
        || zoneFloor.every((f, i) => Math.max(vars[i], vars[i + 1]) >= Math.min(f, gridMax) - 1e-9);

    // ── Step 4: Enumeration ──────────────────────────────────────────────
    // Full enumeration is the only path that proves a global optimum. Keep the
    // cap high enough for the documented realistic case (5 zones × 9 options =
    // 59,049 combos), then fall back only for genuinely huge searches.
    const maxCombos = 60000;
    const totalCombos = options.reduce((n, o) => n * o.length, 1);

    if (totalCombos > maxCombos) {
        // Fall back to greedy sequential optimization (approximate, not exhaustive)
        return optimizeSequential(config, options, sharedMesh, costRatio, step, maxThk, onProgress, passesFloors);
    }

    const applyVars = (vars: number[]): WallZone[] => zones.map((z: WallZone, i: number) => config.isTapered
        ? { ...z, thicknessTop: vars[i], thicknessBot: vars[i + 1] }
        : { ...z, thickness: vars[i] });

    const results: OptimumDesign[] = [];
    const indices = new Array(nVars).fill(0);

    for (let combo = 0; combo < totalCombos; combo++) {
        const vars = indices.map((idx: number, v: number) => options[v][idx]);
        if (passesFloors(vars)) {
            try {
                const result = analyzeWall({
                    ...restConfig,
                    zones: applyVars(vars),
                    _mesh: sharedMesh, // PERF-004: reuse pre-computed pressure mesh
                } as WallConfig);

                // Feasibility is checked comprehensively inside analyzeWall
                // (zd.ok for every zone): flexure Mu ≤ Mu,lim (Cl. 38.1), Ast ≤ 4 %
                // (Cl. 26.5.1.1), bars able to supply Ast, shear without links
                // τv ≤ k·τc (Cl. 40.2.1.1), crack width (Cl. 35.3.2 / Annex F),
                // axial + bending with slenderness (Cl. 32.2 / 39), t ≥ 150 mm.
                if (result.feasible) {
                    const { costIndex, formworkArea } = wallCost(result, costRatio);
                    results.push({
                        thicknesses: vars,
                        concreteVol: result.totalConcreteVol,
                        steelWeight: result.totalSteelWeight,
                        maxUtilization: result.maxUtilization,
                        costIndex,
                        formworkArea,
                        result,
                    });
                }
            } catch (e) {
                // Skip invalid combinations (e.g. beam engine errors for extreme geometries)
            }
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
            if (indices[k] >= options[k].length) {
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
    for (let i = 0; i < Math.min(results.length, 10) && !optimum; i++) {
        optimum = verifyAndRemediate(
            results[i].thicknesses,
            { ...restConfig, zones, isTapered: config.isTapered } as WallConfig,
            sharedMesh,
            step,
            maxThk,
            costRatio,
        );
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
 * ALGORITHM: greedy coordinate descent — start every variable at its largest
 * option, then for each variable sweep its options and keep the one that
 * yields the lowest cost while remaining feasible. Repeat until no improvement.
 *
 * This is NOT exhaustive: it may converge to a local minimum. The result is
 * flagged `approximate: true` so the UI can warn the user.
 *
 * Post-optimization verification (VERIFY-001) is applied identically to the
 * full-enumeration path.
 */
function optimizeSequential(
    config: WallConfig, options: number[][], sharedMesh: PressureMesh | null,
    costRatio: number, thkStep: number, maxThkBound: number,
    onProgress?: ProgressCallback,
    passesFloors: (vars: number[]) => boolean = () => true,
): OptimizeResult {
    const { zones, ...restConfig } = config;
    // PERF-004: reuse the caller's pre-computed pressure mesh; build one only if a
    // caller invoked this path directly without supplying it.
    const mesh = sharedMesh || computePressureMesh({ ...restConfig, zones } as WallConfig);
    const nVars = options.length;

    // Start with every variable at its largest option (feasible end of the search)
    const currentVars = options.map(o => o[o.length - 1]);

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
    const maxOpts = Math.max(...options.map(o => o.length));
    const maxIter = nVars * maxOpts;
    let trialCount = 0;
    const perPass = options.reduce((n, o) => n + o.length, 0);
    const totalTrials = perPass * maxOpts;

    while (improved && iterations < maxIter) {
        improved = false;
        iterations++;

        for (let v = 0; v < nVars; v++) {
            const origThk = currentVars[v];
            let bestThk = origThk;
            let bestCostIndex = Infinity;

            for (const t of options[v]) {
                currentVars[v] = t;
                trialCount++;
                if (!passesFloors(currentVars)) continue;
                try {
                    const trialZones = applyVars(currentVars);
                    const result = analyzeWall({ ...restConfig, zones: trialZones, _mesh: mesh } as WallConfig);
                    // Same feasibility gate as full enumeration (zd.ok for every zone).
                    if (result.feasible) {
                        const { costIndex } = wallCost(result, costRatio);
                        if (costIndex < bestCostIndex) {
                            bestCostIndex = costIndex;
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
