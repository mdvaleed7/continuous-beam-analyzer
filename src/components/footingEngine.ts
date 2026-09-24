/**
 * footingEngine.ts — IS 456:2000 Isolated Footing Design Engine
 *
 * Supports two footing types:
 *  • Flat footing (uniform thickness)
 *  • Slope footing (hipped top from the pedestal / column face down to D1 at
 *    the edges, flat base)
 *
 * Design checks per IS 456:2000:
 *  1. Soil pressure under service loads with the SBC entered for each load
 *     case (any permissible increase for wind / earthquake cases is entered
 *     by the user in that case's SBC — it is NOT applied again here).
 *     When the resultant leaves the kern the no-tension (partial contact)
 *     distribution is solved exactly; loss of contact is allowed only for
 *     load cases flagged `allowPartialContact`, and a resultant outside the
 *     base is an overturning failure.
 *  2. Punching (two-way) shear at d/2 (Cl. 31.6 / 34.2.4.1 b).
 *  3. One-way shear at d from the face (Cl. 34.2.4.1 a); for slope footings
 *     with the effective depth at the critical section.
 *  4. Flexure at the face (Cl. 34.2.3); for slope footings with the actual
 *     compression width of the sloped section.
 *  5. Edge thickness ≥ 150 mm (Cl. 34.1.2).
 *  6. Central-band distribution of short-direction steel (Cl. 34.3.1 b).
 *  7. Bearing at the column / pedestal base (Cl. 34.4) with dowels.
 *  8. Development length of the bars from the critical section (Cl. 34.2.4.3,
 *     Cl. 26.2.1, bends per Cl. 26.2.2.1).
 */

import {
    TAU_C_MAX,
    getTauC,
    getPunchingTauC,
    flexuralDesign as flexuralDesignShared,
    selectBars,
    computeRequiredDepthForBM,
    getMinSteelRatio,
    developmentLength,
    computeCost,
    type ConcreteGrade,
    type BarResult,
} from '../lib/is456';

// ─── Types ───────────────────────────────────────────────────────────────────

type FootingType = 'flat' | 'slope';

/**
 * A single load case for a footing (SERVICE loads). The engine envelopes all
 * cases. `sbc` is the allowable bearing pressure for THIS case — enter the
 * increased value for wind / earthquake combinations here (IS 1904 /
 * IS 1893); no further increase is applied by the engine.
 */
export interface LoadCase {
    label: string;        // e.g. "LC1: DL+LL"
    Fy: number;           // axial load (kN) — unfactored service load
    Mx: number;           // moment about X-axis (kN·m)
    Mz: number;           // moment about Z-axis (kN·m)
    sbc: number;          // permissible SBC for this load case (kN/m²)
    // ULS load factor used for the structural design from this case
    // (IS 456 Table 18: 1.5 for DL+LL, 1.2 for DL+LL+WL/EL). Defaults to
    // the footing's `loadFactor`.
    loadFactor?: number;
    // Allow loss of contact (resultant outside the kern) for this case —
    // normally only for wind / earthquake cases. Default false.
    allowPartialContact?: boolean;
}

export interface FootingConfig {
    label: string;
    footingType: FootingType;
    // Column dimensions (mm)
    col_a: number;        // column size parallel X (mm)
    col_b: number;        // column size parallel Z (mm)
    loadCases: LoadCase[];
    // ─── Legacy single-load-case fields (kept for backwards compat) ────────
    Fy: number;           // axial load (kN)
    Mx: number;           // moment about X-axis (kN·m)
    Mz: number;           // moment about Z-axis (kN·m)
    sbc: number;          // allowable bearing capacity (kN/m²)
    // Soil parameters
    depthFill: number;    // depth of fill above the footing top (m)
    gammaFill: number;    // unit weight of fill (kN/m³)
    gammaConcrete: number; // unit weight of concrete (kN/m³)
    // When true the SBC is a NET safe bearing capacity: the check compares
    // p_gross − γ_fill·(depthFill + D) with it. Default false (gross).
    sbcIsNet?: boolean;
    // Material
    fck: number;
    fy: number;
    grade: string;
    steelGrade: string;
    cover: number;        // clear cover (mm)
    // Default ULS load factor for the structural design (IS 456 Table 18).
    loadFactor?: number;
    // Bar diameter selection
    barDiaX: number;      // bar diameter in X direction (mm) — bottom layer
    barDiaZ: number;      // bar diameter in Z direction (mm) — second layer
    // Footing dimensions
    L: number;            // footing length parallel X (m)
    B: number;            // footing breadth parallel Z (m)
    D: number;            // overall depth at the column / pedestal (m)
    // Pedestal (optional)
    pedestalOffset: number; // pedestal offset from column edge (mm), 0 = no pedestal
    pedestal_a: number;   // pedestal size parallel X (mm)
    pedestal_b: number;   // pedestal size parallel Z (mm)
    // Slope footing specific
    D1?: number;          // depth at the footing edge (mm) — slope footing only
    addnWtPercent?: number;  // deprecated — ignored
    shearStrength?: number;  // deprecated — ignored
}

interface SoilPressureResult {
    p_min: number;        // minimum SERVICE soil pressure (kN/m²) — 0 with partial contact
    p_max: number;        // maximum SERVICE soil pressure (kN/m²)
    p_avg: number;        // average SERVICE soil pressure (kN/m²)
    p_check: number;      // pressure compared with the SBC (gross, or net when sbcIsNet)
    // Net FACTORED upward pressure for flexure + shear: γf·(p_max − W/A),
    // W = self-weight + fill (they bear directly on the base).
    p_max_net_factored: number;
    p_min_net_factored: number;
    eccentricityX: number; // eccentricity in X direction (m)
    eccentricityZ: number; // eccentricity in Z direction (m)
    fullContact: boolean;  // resultant within the kern (no uplift)
    contactFraction: number; // contact area / base area
    overturning: boolean;  // resultant outside the base → no equilibrium
    contactOk: boolean;    // full contact, or partial contact allowed for this case
    sbcCheck: boolean;     // p_check ≤ SBC and contact ok
    sbcCheckFactor: number; // always 1 — kept for backwards compat
}

interface PunchingShearResult {
    perimeter_u: number;   // critical perimeter (mm)
    area_punched: number;  // area within critical perimeter (m²)
    d: number;             // effective depth at the perimeter (mm)
    Vu: number;            // punching shear force (kN)
    tau_v: number;         // actual shear stress (N/mm²)
    tau_c: number;         // permissible shear stress (N/mm²)
    status: 'OK' | 'FAIL';
}

interface OneWayShearResult {
    Vu: number;            // one-way shear force (kN)
    d: number;             // effective depth at the section (mm, averaged across the width)
    tau_v: number;         // actual shear stress (N/mm²)
    tau_c: number;         // permissible shear stress (N/mm²)
    status: 'OK' | 'FAIL';
}

interface FlexuralDesignResult {
    Mu: number;            // design moment per metre (kN·m/m)
    d: number;             // effective depth provided (mm)
    Ast_req: number;       // required steel area (mm²/m)
    Ast_min: number;       // minimum steel (mm²/m)
    Ast_max: number;       // maximum steel (mm²/m)
    pt: number;            // percentage of steel
    governs: string;       // 'design' | 'minimum' | 'maximum'
    isDoubly: boolean;
    status: 'SAFE' | 'REVISE';
    d_req_bm: number;      // required effective depth from BM consideration (mm)
    depthStatus: 'OK' | 'FAIL';
    bars: BarResult | null;  // selected bar (dia, spacing, Ast_provided, label)
}

interface SlopeCheckResult {
    slopeAngleDeg: number;
    isAdequate: boolean;
    note: string;
}

/** Result of analysing ONE load case (before enveloping). */
export interface LoadCaseResult {
    label: string;
    Fy: number;
    Mx: number;
    Mz: number;
    sbc: number;
    loadFactor: number;
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

export interface CentralBandResult {
    beta: number;              // long side / short side
    shortDirection: 'X' | 'Z'; // bars running along the short side
    As_total: number;          // total short-direction steel (mm²)
    As_band: number;           // in the central band of width = short side (mm²)
    bandWidth: number;         // m
    band_per_m: number;        // mm²/m in the band
    outer_per_m: number;       // mm²/m in each outer portion (≥ minimum)
    bandBars: BarResult;
    outerBars: BarResult | null;
}

export interface BearingCheckResult {
    location: string;          // 'Column on footing' | 'Column on pedestal' | 'Pedestal on footing'
    A1: number;                // supporting area (mm²)
    A2: number;                // loaded area (mm²)
    Pu: number;                // factored axial (kN)
    capacity: number;          // 0.45·fck·√(A1/A2)·A2, √ ≤ 2 (kN)
    ok: boolean;
    As_dowel_req: number;      // mm² (≥ 0.5 % of A2, Cl. 34.4.3; + excess force / 0.67fy)
}

export interface DevelopmentLengthResult {
    direction: 'X' | 'Z';
    Ld: number;                // mm (σs reduced by Ast_req/Ast_prov)
    available: number;         // straight length from the face to the bar end (mm)
    anchorage: 'straight' | 'bend' | 'insufficient';
    leg_req: number;           // vertical leg needed after a 90° bend (mm)
    leg_available: number;     // mm
}

export interface FootingAnalysisResult {
    label: string;
    footingType: FootingType;
    col_a: number;
    col_b: number;
    Fy: number;           // governing axial
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
    D1: number | null;
    pedestal_a: number;
    pedestal_b: number;
    pedestalOffset: number;
    addnWtPercent: number;  // deprecated — kept as 0 for backwards-compat
    areaReq: number;
    areaProv: number;
    dEffX: number;
    dEffZ: number;
    totalLoad: number;
    selfWeight: number;
    fillWeight: number;
    concreteVol: number;    // m³ (footing + pedestal)
    steelWeight_kg: number; // provided bottom mat incl. band distribution
    soilPressure: SoilPressureResult;
    punchingShear: PunchingShearResult;
    oneWayShearX: OneWayShearResult;
    oneWayShearZ: OneWayShearResult;
    flexureX: FlexuralDesignResult;
    flexureZ: FlexuralDesignResult;
    slopeCheck: SlopeCheckResult | null;
    edgeThickness: { value: number; min: number; ok: boolean };
    centralBand: CentralBandResult | null;
    bearing: BearingCheckResult[];
    developmentLength: DevelopmentLengthResult[];
    overallStatus: 'SAFE' | 'REVISE';
    messages: string[];
    tau_c_max: number;
    tau_c_inbuilt: number;
    tau_c_punching: number;
    pt_used: number;
    loadFactor: number;
    loadCases: LoadCaseResult[];
    governingLoadCase: string;
    envelope: {
        maxMx: LoadCaseResult | null;
        maxMz: LoadCaseResult | null;
        maxFy: LoadCaseResult | null;
    };
}

// ─── Soil pressure: exact no-tension solution ───────────────────────────────

type Pt = [number, number];

/** Clip a convex polygon by the half-plane a + b·x + c·y ≥ 0 (Sutherland–Hodgman). */
function clipHalfPlane(poly: Pt[], a: number, b: number, c: number): Pt[] {
    const out: Pt[] = [];
    const val = (p: Pt) => a + b * p[0] + c * p[1];
    for (let i = 0; i < poly.length; i++) {
        const P = poly[i], Q = poly[(i + 1) % poly.length];
        const vp = val(P), vq = val(Q);
        if (vp >= 0) out.push(P);
        if ((vp >= 0) !== (vq >= 0)) {
            const t = vp / (vp - vq);
            out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
        }
    }
    return out;
}

/** Area, first and second moments of a polygon (Green's theorem). */
function polygonMoments(poly: Pt[]) {
    let A = 0, Sx = 0, Sy = 0, Ixx = 0, Iyy = 0, Ixy = 0;
    for (let i = 0; i < poly.length; i++) {
        const [x0, y0] = poly[i];
        const [x1, y1] = poly[(i + 1) % poly.length];
        const cr = x0 * y1 - x1 * y0;
        A += cr / 2;
        Sx += (x0 + x1) * cr / 6;
        Sy += (y0 + y1) * cr / 6;
        Ixx += (x0 * x0 + x0 * x1 + x1 * x1) * cr / 12;
        Iyy += (y0 * y0 + y0 * y1 + y1 * y1) * cr / 12;
        Ixy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * cr / 24;
    }
    return { A, Sx, Sy, Ixx, Iyy, Ixy };
}

function solve3(M: number[][], t: number[]): number[] | null {
    const [[a, b, c], [d, e, f], [g, h, i]] = M;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-18) return null;
    const inv = [
        [(e * i - f * h), -(b * i - c * h), (b * f - c * e)],
        [-(d * i - f * g), (a * i - c * g), -(a * f - c * d)],
        [(d * h - e * g), -(a * h - b * g), (a * e - b * d)],
    ];
    return [0, 1, 2].map(r => (inv[r][0] * t[0] + inv[r][1] * t[1] + inv[r][2] * t[2]) / det);
}

/**
 * Bearing pressure under a rigid L × B base for vertical load N at
 * eccentricities (ex along L, ez along B), soil in compression only.
 * Pressure p = a + b·x + c·z over the contact region {p > 0}; the contact
 * polygon is found iteratively (at each step the equilibrium equations on
 * the current contact polygon are linear in a, b, c — the Newton step,
 * since p = 0 on the moving boundary).
 */
export function noTensionBearing(N: number, ex: number, ez: number, L: number, B: number) {
    const rect: Pt[] = [[-L / 2, -B / 2], [L / 2, -B / 2], [L / 2, B / 2], [-L / 2, B / 2]];
    const area = L * B;
    if (N <= 0) return { p_max: 0, contactFraction: 0, overturning: true };
    if (Math.abs(ex) >= L / 2 || Math.abs(ez) >= B / 2) return { p_max: Infinity, contactFraction: 0, overturning: true };
    // Start from the full-contact linear distribution.
    let th = [N / area, 12 * N * ex / (B * L ** 3), 12 * N * ez / (L * B ** 3)];
    const target = [N, N * ex, N * ez];
    let contact = rect;
    for (let it = 0; it < 200; it++) {
        contact = clipHalfPlane(rect, th[0], th[1], th[2]);
        const m = polygonMoments(contact);
        if (m.A <= area * 1e-9) break;
        const next = solve3([[m.A, m.Sx, m.Sy], [m.Sx, m.Ixx, m.Ixy], [m.Sy, m.Ixy, m.Iyy]], target);
        if (!next) break;
        const w = it < 20 ? 1 : 0.5;
        const nt = th.map((v, k) => v + w * (next[k] - v));
        const change = Math.max(...nt.map((v, k) => Math.abs(v - th[k]) / (Math.abs(th[0]) + 1e-9)));
        th = nt;
        if (change < 1e-10) break;
    }
    contact = clipHalfPlane(rect, th[0], th[1], th[2]);
    const m = polygonMoments(contact);
    const p_max = Math.max(...rect.map(([x, z]) => th[0] + th[1] * x + th[2] * z));
    // plane: p(x, z) = a + b·x + c·z on the contact region (x along L, z along B)
    return { p_max, contactFraction: m.A / area, overturning: false, plane: { a: th[0], b: th[1], c: th[2] } };
}

function computeSoilPressure(
    L: number, B: number,
    serviceTotal: number, W_perm: number,
    Mx: number, Mz: number,
    sbc: number, loadFactor: number,
    allowPartial: boolean, overburden: number,
): SoilPressureResult {
    const area = L * B;
    const p_avg = serviceTotal / area;
    // Mx (about X) → eccentricity along Z (B); Mz (about Z) → along X (L).
    const eZ = serviceTotal !== 0 ? Math.abs(Mx) / serviceTotal : 0;
    const eX = serviceTotal !== 0 ? Math.abs(Mz) / serviceTotal : 0;

    const pFromMx = 6 * Math.abs(Mx) / (L * B * B);
    const pFromMz = 6 * Math.abs(Mz) / (L * L * B);
    let p_max = p_avg + pFromMx + pFromMz;
    let p_min = p_avg - pFromMx - pFromMz;
    let fullContact = p_min >= -1e-9;
    let contactFraction = 1;
    let overturning = false;
    if (!fullContact) {
        const nt = noTensionBearing(serviceTotal, eX, eZ, L, B);
        p_max = nt.p_max;
        p_min = 0;
        contactFraction = nt.contactFraction;
        overturning = nt.overturning;
    }
    const contactOk = !overturning && (fullContact || allowPartial);
    const p_check = p_max - overburden;
    const sbcCheck = contactOk && p_check <= sbc;

    // Net upward pressure for structural design: γf·(p − W/A).
    const w_perm = W_perm / area;
    const p_max_net_factored = loadFactor * (p_max - w_perm);
    const p_min_net_factored = loadFactor * (p_min - w_perm);

    return {
        p_min: Math.round(p_min * 100) / 100,
        p_max: Number.isFinite(p_max) ? Math.round(p_max * 100) / 100 : p_max,
        p_avg: Math.round(p_avg * 100) / 100,
        p_check: Number.isFinite(p_check) ? Math.round(p_check * 100) / 100 : p_check,
        p_max_net_factored: Number.isFinite(p_max_net_factored) ? Math.round(p_max_net_factored * 100) / 100 : p_max_net_factored,
        p_min_net_factored: Math.round(p_min_net_factored * 100) / 100,
        eccentricityX: Math.round(eX * 1000) / 1000,
        eccentricityZ: Math.round(eZ * 1000) / 1000,
        fullContact,
        contactFraction: Math.round(contactFraction * 1000) / 1000,
        overturning,
        contactOk,
        sbcCheck,
        sbcCheckFactor: 1,
    };
}

// ─── Flexure helpers ─────────────────────────────────────────────────────────

const XU_MAX_RATIO = (fy: number) => (fy <= 250 ? 0.53 : fy <= 415 ? 0.48 : fy <= 500 ? 0.46 : 0.44);

/**
 * Singly reinforced section whose width varies with depth y below the most
 * compressed fibre (sloped footing at the face). IS 456 Cl. 38.1 stress
 * block (Fig. 21: 0.446·fck plateau, parabola below 0.002), εcu = 0.0035,
 * steel at 0.87·fy (xu ≤ xu,max). Returns the steel for Mu (N·mm) or
 * isDoubly when Mu > Mu,lim.
 */
function flexureVariableWidth(
    Mu_Nmm: number, width: (y: number) => number, d: number, fck: number, fy: number,
) {
    const NS = 200;
    const block = (xu: number) => {
        let C = 0, M = 0;
        const dy = xu / NS;
        for (let i = 0; i < NS; i++) {
            const y = (i + 0.5) * dy;
            const eps = 0.0035 * (xu - y) / xu;
            const r = eps / 0.002;
            const f = r >= 1 ? 0.446 * fck : 0.446 * fck * (2 * r - r * r);
            const dC = f * width(y) * dy;
            C += dC;
            M += dC * (d - y);
        }
        return { C, M };
    };
    const xu_max = XU_MAX_RATIO(fy) * d;
    const lim = block(xu_max);
    if (Mu_Nmm <= 0) return { As: 0, isDoubly: false, Mu_lim: lim.M, xu: 0 };
    if (Mu_Nmm > lim.M) return { As: lim.C / (0.87 * fy), isDoubly: true, Mu_lim: lim.M, xu: xu_max };
    let lo = 0, hi = xu_max;
    for (let it = 0; it < 60; it++) {
        const mid = 0.5 * (lo + hi);
        if (block(mid).M < Mu_Nmm) lo = mid; else hi = mid;
    }
    const xu = 0.5 * (lo + hi);
    return { As: block(xu).C / (0.87 * fy), isDoubly: false, Mu_lim: lim.M, xu };
}

function flexuralDesignPerMeter(Mu_kNm: number, d_mm: number, fck: number, fy: number, D_mm: number): FlexuralDesignResult {
    const r = flexuralDesignShared(Mu_kNm, 1000, d_mm, fck, fy, D_mm);
    const { d_req } = computeRequiredDepthForBM(Mu_kNm, fck, fy, 1000);
    const bars = selectBars(r.Ast_req, undefined, undefined, 1000, d_mm);
    const barsOk = bars.adequate !== false;
    return {
        Mu: r.Mu_applied ?? 0, d: d_mm,
        Ast_req: r.Ast_req, Ast_min: r.Ast_min ?? 0, Ast_max: r.Ast_max ?? 0,
        pt: r.pt ?? 0, governs: r.governs, isDoubly: r.isDoubly,
        status: r.isDoubly || r.governs === 'maximum' || !barsOk ? 'REVISE' : 'SAFE',
        d_req_bm: Math.round(d_req * 100) / 100,
        depthStatus: d_mm >= d_req ? 'OK' : 'FAIL',
        bars,
    };
}

/** Flexure of a sloped footing at the face: whole-width section, per-metre output. */
function flexuralDesignSloped(
    Mu_total_kNm: number, width_m: number, plateau_m: number, D_mm: number, D1_mm: number,
    d_mm: number, fck: number, fy: number,
): FlexuralDesignResult {
    const Wmm = width_m * 1000, bTop = Math.min(plateau_m * 1000, Wmm);
    const hSlope = Math.max(1e-6, D_mm - D1_mm);
    const width = (y: number) => (y >= hSlope ? Wmm : bTop + (Wmm - bTop) * (y / hSlope));
    const r = flexureVariableWidth(Mu_total_kNm * 1e6, width, d_mm, fck, fy);
    const grossArea = Wmm * D1_mm + (D_mm - D1_mm) * (Wmm + bTop) / 2;
    const As_min = getMinSteelRatio(fy) * grossArea;
    const As_max = 0.04 * grossArea;
    let governs = 'design';
    let As = r.As;
    if (As < As_min) { As = As_min; governs = 'minimum'; }
    else if (As > As_max) { As = As_max; governs = 'maximum'; }
    const perM = As / width_m;
    const bars = selectBars(perM, undefined, undefined, 1000, d_mm);
    const Mu_per_m = Mu_total_kNm / width_m;
    return {
        Mu: Mu_per_m, d: d_mm,
        Ast_req: Math.ceil(perM), Ast_min: Math.ceil(As_min / width_m), Ast_max: Math.floor(As_max / width_m),
        pt: Math.round(100 * As / (Wmm * d_mm) * 1000) / 1000,
        governs, isDoubly: r.isDoubly,
        status: r.isDoubly || governs === 'maximum' || bars.adequate === false ? 'REVISE' : 'SAFE',
        // depth needed to keep the sloped section singly reinforced is covered
        // by isDoubly; d_req_bm reported from the rectangular top width.
        d_req_bm: Math.round(computeRequiredDepthForBM(Mu_total_kNm, fck, fy, Math.max(bTop, 1)).d_req * 100) / 100,
        depthStatus: r.isDoubly ? 'FAIL' : 'OK',
        bars,
    };
}

// ─── Main Analysis ───────────────────────────────────────────────────────────

export function analyzeFooting(config: FootingConfig): FootingAnalysisResult {
    const {
        label, footingType,
        col_a, col_b,
        depthFill, gammaFill, gammaConcrete,
        fck, fy, grade, steelGrade, cover,
        barDiaX, barDiaZ,
        L, B, D,
        pedestalOffset, pedestal_a, pedestal_b,
        D1,
    } = config;
    const messages: string[] = [];

    const defaultLoadFactor = config.loadFactor && config.loadFactor > 0 ? config.loadFactor : 1.5;
    const loadCases: LoadCase[] = config.loadCases && config.loadCases.length > 0
        ? config.loadCases
        : [{ label: 'LC1', Fy: config.Fy, Mx: config.Mx, Mz: config.Mz, sbc: config.sbc }];

    // ── Geometry ────────────────────────────────────────────────────────────
    const isSlope = footingType === 'slope';
    const D_mm = D * 1000;
    const D1_mm = isSlope ? Math.min(D1 ?? D_mm, D_mm) : D_mm;
    // X bars in the bottom layer, Z bars on top of them.
    const dEffX = D_mm - cover - barDiaX / 2;
    const dEffZ = D_mm - cover - barDiaX - barDiaZ / 2;

    const pedA = pedestalOffset > 0 ? col_a + 2 * pedestalOffset : col_a;
    const pedB = pedestalOffset > 0 ? col_b + 2 * pedestalOffset : col_b;
    const pedDepth_m = pedestalOffset > 0 ? pedestalOffset / 1000 : 0;
    const a1 = pedA / 1000;
    const b1 = pedB / 1000;
    const areaProv = L * B;
    const cantX = (L - a1) / 2, cantZ = (B - b1) / 2;

    // Top surface height (mm) at plan point (x, z) — hipped slope from the
    // pedestal plateau to D1 at the edges; flat footings: D everywhere.
    const heightAt = (x: number, z: number) => {
        if (!isSlope) return D_mm;
        const tx = cantX > 0 ? 1 - Math.max(0, Math.abs(x) - a1 / 2) / cantX : 1;
        const tz = cantZ > 0 ? 1 - Math.max(0, Math.abs(z) - b1 / 2) / cantZ : 1;
        return D1_mm + (D_mm - D1_mm) * Math.max(0, Math.min(1, tx, tz));
    };

    // ── Self-weight: prismoidal formula for the sloped top (exact for the
    // hipped shape with rectangular faces) ─────────────────────────────────
    let concreteVol = L * B * D;
    if (isSlope) {
        const h = (D_mm - D1_mm) / 1000;
        const A1 = a1 * b1, A2 = L * B, Am = ((a1 + L) / 2) * ((b1 + B) / 2);
        concreteVol = L * B * (D1_mm / 1000) + h / 6 * (A1 + A2 + 4 * Am);
    }
    if (pedestalOffset > 0) concreteVol += a1 * b1 * pedDepth_m;
    const selfWeight = concreteVol * gammaConcrete;
    const fillWeight = Math.max(0, (L * B - a1 * b1)) * depthFill * gammaFill;
    const footingWeight = selfWeight + fillWeight;
    const overburden = config.sbcIsNet ? gammaFill * (depthFill + D) : 0;

    // ── Permissible shear stresses ──────────────────────────────────────────
    const pt_initial = 0.15; // Table 19 floor — conservative for one-way shear
    const gradeStr = grade as ConcreteGrade;
    const tau_c_inbuilt = getTauC(pt_initial, gradeStr);
    const tau_c_punching = getPunchingTauC(fck, pedA, pedB);
    const tau_c_max_val = TAU_C_MAX[gradeStr] ?? 2.8;

    // ── Slope geometry check ────────────────────────────────────────────────
    let slopeCheck: SlopeCheckResult | null = null;
    if (isSlope) {
        const slopeRun = Math.min(cantX, cantZ) * 1000;
        const slopeRise = D_mm - D1_mm;
        const slopeAngleDeg = slopeRun > 0 ? Math.atan(slopeRise / slopeRun) * 180 / Math.PI : 0;
        const isAdequate = slopeAngleDeg <= 45 && slopeRise > 0;
        slopeCheck = {
            slopeAngleDeg: Math.round(slopeAngleDeg * 10) / 10,
            isAdequate,
            note: isAdequate
                ? `Slope angle ${Math.round(slopeAngleDeg * 10) / 10}° ≤ 45° — can be cast without top formwork`
                : `Slope angle ${Math.round(slopeAngleDeg * 10) / 10}° > 45° — revise depth`,
        };
    }

    // ── Effective depths at the critical sections (slope: depth at section) ─
    // One-way shear: plane at d from the face, depth averaged across the width.
    const avgDepthAcross = (xPlane: number | null, zPlane: number | null, layerDed: number) => {
        const n = 200;
        let sum = 0;
        for (let i = 0; i < n; i++) {
            const t = -0.5 + (i + 0.5) / n;
            const H = xPlane !== null ? heightAt(xPlane, t * B) : heightAt(t * L, zPlane as number);
            sum += H - cover - layerDed;
        }
        return sum / n;
    };
    const dShearX = isSlope ? avgDepthAcross(a1 / 2 + dEffX / 1000, null, barDiaX / 2) : dEffX;
    const dShearZ = isSlope ? avgDepthAcross(null, b1 / 2 + dEffZ / 1000, barDiaX + barDiaZ / 2) : dEffZ;
    // Punching: perimeter at d/2, depth averaged along the perimeter (iterated).
    const dMeanLayer = cover + 0.75 * barDiaX + 0.25 * barDiaZ;   // mean of the two layer depths
    let d_avg = (dEffX + dEffZ) / 2;
    for (let it = 0; isSlope && it < 3; it++) {
        const hx = a1 / 2 + d_avg / 2000, hz = b1 / 2 + d_avg / 2000;
        let sum = 0, n = 0;
        for (let i = 0; i < 100; i++) {
            const t = -1 + (2 * (i + 0.5)) / 100;
            sum += heightAt(hx, t * hz) + heightAt(t * hx, hz); n += 2;
        }
        d_avg = sum / n - dMeanLayer;
    }
    const d_m = d_avg / 1000;
    const critA = a1 + d_m;
    const critB = b1 + d_m;
    const perimeter_u = 2 * (critA + critB) * 1000;
    const area_punched = critA * critB;

    // ── Base area required (informational) ──────────────────────────────────
    const maxTotalLoad = Math.max(...loadCases.map(lc => lc.Fy + footingWeight));
    const minSbc = Math.min(...loadCases.map(lc => lc.sbc));
    const areaReq = minSbc > 0 ? maxTotalLoad / minSbc : 0;

    // ── Per-load-case analysis ──────────────────────────────────────────────
    const lcResults: LoadCaseResult[] = loadCases.map(lc => {
        const gf = lc.loadFactor && lc.loadFactor > 0 ? lc.loadFactor : defaultLoadFactor;
        const totalLoad = lc.Fy + footingWeight;
        const soilPressure = computeSoilPressure(
            L, B, totalLoad, footingWeight, lc.Mx, lc.Mz, lc.sbc, gf,
            lc.allowPartialContact === true, overburden,
        );
        // Net FACTORED upward pressure, taken uniform at its maximum (conservative).
        const p_design = Number.isFinite(soilPressure.p_max_net_factored) ? Math.max(0, soilPressure.p_max_net_factored) : Infinity;

        // Punching (Cl. 31.6 / 34.2.4.1 b)
        const Vu_punch = p_design * (areaProv - area_punched);
        const tau_v_punch = (Vu_punch * 1000) / (perimeter_u * d_avg);
        const punchingStatus: 'OK' | 'FAIL' = tau_v_punch <= tau_c_punching ? 'OK' : 'FAIL';

        // One-way shear at d from the face (Cl. 34.2.4.1 a)
        const lengthBeyondX = cantX - dEffX / 1000;
        const Vu_oneway_X = lengthBeyondX > 0 ? p_design * B * lengthBeyondX : 0;
        const tau_v_oneway_X = (Vu_oneway_X * 1000) / (B * 1000 * dShearX);
        const onewayXStatus: 'OK' | 'FAIL' = tau_v_oneway_X <= tau_c_inbuilt ? 'OK' : 'FAIL';
        const lengthBeyondZ = cantZ - dEffZ / 1000;
        const Vu_oneway_Z = lengthBeyondZ > 0 ? p_design * L * lengthBeyondZ : 0;
        const tau_v_oneway_Z = (Vu_oneway_Z * 1000) / (L * 1000 * dShearZ);
        const onewayZStatus: 'OK' | 'FAIL' = tau_v_oneway_Z <= tau_c_inbuilt ? 'OK' : 'FAIL';

        // Flexure at the face (Cl. 34.2.3)
        const Mx_flex = p_design * cantX * cantX / 2;          // per metre (bars along X)
        const Mz_flex = p_design * cantZ * cantZ / 2;          // per metre (bars along Z)
        const flexureX = isSlope
            ? flexuralDesignSloped(Mx_flex * B, B, b1, D_mm, D1_mm, dEffX, fck, fy)
            : flexuralDesignPerMeter(Mx_flex, dEffX, fck, fy, D_mm);
        const flexureZ = isSlope
            ? flexuralDesignSloped(Mz_flex * L, L, a1, D_mm, D1_mm, dEffZ, fck, fy)
            : flexuralDesignPerMeter(Mz_flex, dEffZ, fck, fy, D_mm);

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
            loadFactor: gf,
            totalLoad: Math.round(totalLoad),
            selfWeight: Math.round(selfWeight * 10) / 10,
            fillWeight: Math.round(fillWeight * 10) / 10,
            soilPressure,
            punchingShear: {
                perimeter_u: Math.round(perimeter_u),
                area_punched: Math.round(area_punched * 1e6) / 1e6,
                d: Math.round(d_avg),
                Vu: Math.round(Vu_punch * 100) / 100,
                tau_v: Math.round(tau_v_punch * 1000) / 1000,
                tau_c: Math.round(tau_c_punching * 1000) / 1000,
                status: punchingStatus,
            },
            oneWayShearX: {
                Vu: Math.round(Vu_oneway_X * 100) / 100,
                d: Math.round(dShearX),
                tau_v: Math.round(tau_v_oneway_X * 1000) / 1000,
                tau_c: Math.round(tau_c_inbuilt * 1000) / 1000,
                status: onewayXStatus,
            },
            oneWayShearZ: {
                Vu: Math.round(Vu_oneway_Z * 100) / 100,
                d: Math.round(dShearZ),
                tau_v: Math.round(tau_v_oneway_Z * 1000) / 1000,
                tau_c: Math.round(tau_c_inbuilt * 1000) / 1000,
                status: onewayZStatus,
            },
            flexureX, flexureZ,
            overallStatus,
        };
    });

    // ── Envelope ────────────────────────────────────────────────────────────
    const maxMxLC = lcResults.reduce((best, r) =>
        Math.abs(r.Mx) > Math.abs(best?.Mx ?? 0) ? r : best, null as LoadCaseResult | null);
    const maxMzLC = lcResults.reduce((best, r) =>
        Math.abs(r.Mz) > Math.abs(best?.Mz ?? 0) ? r : best, null as LoadCaseResult | null);
    const maxFyLC = lcResults.reduce((best, r) =>
        r.Fy > (best?.Fy ?? 0) ? r : best, null as LoadCaseResult | null);
    const governing = lcResults.find(r => r.overallStatus === 'REVISE')
        ?? lcResults.reduce((best, r) =>
            r.soilPressure.p_max > best.soilPressure.p_max ? r : best, lcResults[0]);
    // Reinforcement from the case needing the most steel in each direction.
    const flexX = lcResults.reduce((b, r) => (r.flexureX.Ast_req > b.flexureX.Ast_req ? r : b), lcResults[0]).flexureX;
    const flexZ = lcResults.reduce((b, r) => (r.flexureZ.Ast_req > b.flexureZ.Ast_req ? r : b), lcResults[0]).flexureZ;

    for (const r of lcResults) {
        if (r.soilPressure.overturning) messages.push(`${r.label}: resultant outside the base — overturning`);
        else if (!r.soilPressure.fullContact && !r.soilPressure.contactOk) messages.push(
            `${r.label}: loss of contact (${Math.round(r.soilPressure.contactFraction * 100)}% in contact) — not allowed for this case`);
    }

    // ── Edge thickness (Cl. 34.1.2) ─────────────────────────────────────────
    const edgeThickness = { value: D1_mm, min: 150, ok: D1_mm >= 150 };
    if (!edgeThickness.ok) messages.push(`Edge thickness ${D1_mm} mm < 150 mm (IS 456 Cl. 34.1.2)`);

    // ── Central band (Cl. 34.3.1 b) ─────────────────────────────────────────
    let centralBand: CentralBandResult | null = null;
    const longSide = Math.max(L, B), shortSide = Math.min(L, B);
    const beta = longSide / shortSide;
    if (beta > 1 + 1e-9) {
        // Short-direction bars run along the short side and are spread over the long side.
        const shortDir: 'X' | 'Z' = L < B ? 'X' : 'Z';
        const flex = shortDir === 'X' ? flexX : flexZ;
        const d_short = shortDir === 'X' ? dEffX : dEffZ;
        const As_total = flex.Ast_req * longSide;
        const As_band = 2 / (beta + 1) * As_total;
        const band_per_m = As_band / shortSide;
        const outerWidth = longSide - shortSide;
        const outer_per_m = Math.max((As_total - As_band) / outerWidth, flex.Ast_min);
        centralBand = {
            beta: Math.round(beta * 1000) / 1000, shortDirection: shortDir,
            As_total: Math.round(As_total), As_band: Math.round(As_band),
            bandWidth: shortSide,
            band_per_m: Math.round(band_per_m), outer_per_m: Math.round(outer_per_m),
            bandBars: selectBars(band_per_m, undefined, undefined, 1000, d_short),
            outerBars: selectBars(outer_per_m, undefined, undefined, 1000, d_short),
        };
    }

    // ── Bearing at the column / pedestal base (Cl. 34.4) ────────────────────
    const PuMax = Math.max(...lcResults.map(r => r.loadFactor * r.Fy));
    const bearing: BearingCheckResult[] = [];
    const bearingCheck = (location: string, a: number, b: number, A1: number) => {
        const A2 = a * b;
        const ratio = Math.min(2, Math.sqrt(Math.max(1, A1 / A2)));
        const capacity = 0.45 * fck * ratio * A2 / 1000;          // kN
        const excess = Math.max(0, PuMax - capacity);
        bearing.push({
            location, A1: Math.round(A1), A2: Math.round(A2), Pu: Math.round(PuMax),
            capacity: Math.round(capacity), ok: PuMax <= capacity,
            As_dowel_req: Math.round(Math.max(0.005 * A2, excess * 1000 / (0.67 * fy))),
        });
    };
    // Largest frustum (1V:2H) wholly inside the footing below the loaded area.
    const slopeFlat = !isSlope || (D_mm - D1_mm) / (Math.min(cantX, cantZ) * 1000) <= 0.5;
    const hFrustum = slopeFlat ? D_mm : D1_mm;
    const footingA1 = (a: number, b: number) =>
        Math.min(a + 4 * hFrustum, L * 1000) * Math.min(b + 4 * hFrustum, B * 1000);
    if (pedestalOffset > 0) {
        bearingCheck('Column on pedestal', col_a, col_b, pedA * pedB);
        bearingCheck('Pedestal on footing', pedA, pedB, footingA1(pedA, pedB));
    } else {
        bearingCheck('Column on footing', col_a, col_b, footingA1(col_a, col_b));
    }
    for (const b of bearing) if (!b.ok) messages.push(
        `${b.location}: Pu ${b.Pu} kN > bearing ${b.capacity} kN — dowels ≥ ${b.As_dowel_req} mm² (Cl. 34.4.1)`);

    // ── Development length (Cl. 34.2.4.3; Ld per Cl. 26.2.1) ────────────────
    const developmentLengths: DevelopmentLengthResult[] = [];
    const devCheck = (direction: 'X' | 'Z', flex: FlexuralDesignResult, cant: number, dia: number) => {
        const stressRatio = flex.bars && flex.bars.Ast_provided > 0 ? Math.min(1, flex.Ast_req / flex.bars.Ast_provided) : 1;
        const Ld = developmentLength(dia, fy, grade, true, false, stressRatio);
        const available = cant * 1000 - cover;
        const leg_available = Math.max(0, D1_mm - 2 * cover - dia);
        let anchorage: DevelopmentLengthResult['anchorage'] = 'straight';
        let leg_req = 0;
        if (available < Ld) {
            // 90° bend at the end: anchorage value 8φ (Cl. 26.2.2.1 b), then a vertical leg.
            leg_req = Math.max(0, Ld - available - 8 * dia);
            anchorage = leg_req <= leg_available ? 'bend' : 'insufficient';
        }
        developmentLengths.push({
            direction, Ld: Math.round(Ld), available: Math.round(available), anchorage,
            leg_req: Math.round(leg_req), leg_available: Math.round(leg_available),
        });
    };
    devCheck('X', flexX, cantX, flexX.bars?.dia ?? barDiaX);
    devCheck('Z', flexZ, cantZ, flexZ.bars?.dia ?? barDiaZ);
    for (const dl of developmentLengths) if (dl.anchorage === 'insufficient') messages.push(
        `${dl.direction} bars: Ld ${dl.Ld} mm cannot be developed (straight ${dl.available} mm + bend + leg ≤ ${dl.leg_available} mm)`);

    // ── Steel quantity (bottom mat, provided bars) ──────────────────────────
    const lenX = L - 2 * cover / 1000, lenZ = B - 2 * cover / 1000;
    const perMX = flexX.bars?.Ast_provided ?? flexX.Ast_req;
    const perMZ = flexZ.bars?.Ast_provided ?? flexZ.Ast_req;
    let steelMm2m = perMX * B * lenX + perMZ * L * lenZ;
    if (centralBand) {
        // Replace the uniform short-direction mat by band + outer portions.
        const bandPerM = centralBand.bandBars.Ast_provided;
        const outerPerM = centralBand.outerBars?.Ast_provided ?? 0;
        const shortLen = centralBand.shortDirection === 'X' ? lenX : lenZ;
        const uniform = (centralBand.shortDirection === 'X' ? perMX * B : perMZ * L) * shortLen;
        steelMm2m += (bandPerM * shortSide + outerPerM * (longSide - shortSide)) * shortLen - uniform;
    }
    for (const dl of developmentLengths) {
        if (dl.anchorage === 'bend') {
            const perM = dl.direction === 'X' ? perMX : perMZ;
            const width = dl.direction === 'X' ? B : L;
            steelMm2m += perM * width * 2 * (dl.leg_req / 1000);
        }
    }
    const steelWeight_kg = steelMm2m * 7850 / 1e6;

    const overallStatus: 'SAFE' | 'REVISE' = lcResults.some(r => r.overallStatus === 'REVISE')
        || !edgeThickness.ok
        || developmentLengths.some(dl => dl.anchorage === 'insufficient')
        || (slopeCheck !== null && !slopeCheck.isAdequate)
        ? 'REVISE' : 'SAFE';

    return {
        label, footingType,
        col_a, col_b,
        Fy: governing.Fy, Mx: governing.Mx, Mz: governing.Mz, sbc: governing.sbc,
        fck, fy, grade, steelGrade, cover,
        barDiaX, barDiaZ,
        L, B, D,
        D1: isSlope ? D1_mm : null,
        pedestal_a, pedestal_b, pedestalOffset,
        addnWtPercent: 0,
        areaReq: Math.round(areaReq * 100) / 100,
        areaProv: Math.round(areaProv * 100) / 100,
        dEffX: Math.round(dEffX),
        dEffZ: Math.round(dEffZ),
        totalLoad: governing.totalLoad,
        selfWeight: Math.round(selfWeight * 10) / 10,
        fillWeight: Math.round(fillWeight * 10) / 10,
        concreteVol: Math.round(concreteVol * 1000) / 1000,
        steelWeight_kg: Math.round(steelWeight_kg * 10) / 10,
        soilPressure: governing.soilPressure,
        punchingShear: governing.punchingShear,
        oneWayShearX: governing.oneWayShearX,
        oneWayShearZ: governing.oneWayShearZ,
        flexureX: flexX,
        flexureZ: flexZ,
        slopeCheck,
        edgeThickness,
        centralBand,
        bearing,
        developmentLength: developmentLengths,
        overallStatus,
        messages,
        tau_c_max: tau_c_max_val,
        tau_c_inbuilt: Math.round(tau_c_inbuilt * 1000) / 1000,
        tau_c_punching: Math.round(tau_c_punching * 1000) / 1000,
        pt_used: pt_initial,
        loadFactor: defaultLoadFactor,
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
    steelWeight: number;
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
 * Optimize footing dimensions by sweeping L, B and D for the minimum cost
 * (concrete + provided steel + side formwork) among designs passing all checks.
 * Steel weight = provided bottom mat over the whole plan area (bars per metre
 * × width × length, incl. central-band distribution and end bends).
 */
export function optimizeFooting(
    config: FootingConfig,
    params: FootingOptimizeParams,
    costRatio: number = 90,
    onProgress?: FootingProgressCallback
): FootingOptimizeResult {
    const results: OptimumFootingDesign[] = [];
    const { minL, maxL, stepL, minB, maxB, stepB, minD, maxD, stepD } = params;

    const countSteps = (min: number, max: number, step: number) =>
        Math.max(1, Math.round((max - min) / step) + 1);
    const numL = countSteps(minL, maxL, stepL);
    const numB = countSteps(minB, maxB, stepB);
    const numD = countSteps(minD, maxD, stepD);
    const total = numL * numB * numD;

    let done = 0;
    for (let iL = 0; iL < numL; iL++) {
        const L = minL + iL * stepL;
        for (let iB = 0; iB < numB; iB++) {
            const B = minB + iB * stepB;
            for (let iD = 0; iD < numD; iD++) {
                const D = minD + iD * stepD;
                done++;
                try {
                    const trialConfig = { ...config, L, B, D };
                    if (trialConfig.footingType === 'slope' && trialConfig.D1 !== undefined) {
                        trialConfig.D1 = Math.min(trialConfig.D1, D * 1000);
                    }
                    const result = analyzeFooting(trialConfig);
                    if (result.overallStatus === 'SAFE') {
                        const volume = result.concreteVol;
                        const steelWeight = result.steelWeight_kg;
                        const edge = trialConfig.footingType === 'slope' ? (result.D1 ?? D * 1000) / 1000 : D;
                        const formworkArea = 2 * (L + B) * edge;
                        const costIndex = computeCost(
                            volume, steelWeight, formworkArea,
                            { steelCost_per_kg: costRatio, concreteCost_per_m3: 6500, formworkCost_per_m2: 350, wastage_factor: 1.07 },
                        );
                        results.push({
                            L: Math.round(L * 100) / 100,
                            B: Math.round(B * 100) / 100,
                            D: Math.round(D * 100) / 100,
                            volume, steelWeight, costIndex, result,
                        });
                    }
                } catch {
                    // Skip invalid
                }
                if (onProgress && (done % 50 === 0 || done === total)) {
                    onProgress(done, total, results.length);
                }
            }
        }
    }

    results.sort((a, b) => a.costIndex - b.costIndex);
    return {
        totalTrials: total,
        feasibleCount: results.length,
        topDesigns: results.slice(0, 10),
        optimum: results.length > 0 ? results[0] : null,
        costRatioUsed: costRatio,
    };
}
