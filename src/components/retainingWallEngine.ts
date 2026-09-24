/**
 * retainingWallEngine.ts — IS 456:2000 Cantilever Retaining Wall Design
 *
 *   • Active earth pressure (Rankine), surcharge and water on the virtual
 *     back through the heel; submerged soil below the water table.
 *   • Stability per IS 456:2000 Cl. 20:
 *       overturning  0.9·M_R ≥ 1.4·M_O      (Cl. 20.1, 0.9 × dead load)
 *       sliding      0.9·μ·(ΣW − U) ≥ 1.4·ΣH (Cl. 20.2)
 *     with M_R from the permanent loads only (stem, base, soil over the heel);
 *     the surcharge over the heel is variable and is not counted as
 *     restoring. Destabilising: lateral earth, surcharge and water pressure,
 *     and the uplift U under the base when a water table exists.
 *   • Uplift: triangular, γw·hw at the heel to zero at the toe (retained side
 *     only, free-draining front).
 *   • Bearing: trapezoidal pressure from the resultant, with and without the
 *     surcharge over the heel (worse governs); no tension permitted.
 *   • Stem, heel and toe designed as slabs (Cl. 38.1 flexure, Cl. 40 shear)
 *     for 1.5 × service actions; heel/toe moments from the exact trapezoidal
 *     contact pressure and uplift.
 *   • Stem horizontal steel per Cl. 32.5(c); base distribution steel per
 *     Cl. 26.5.2.1; anchorage of the stem bars into the base (Cl. 26.2.1,
 *     90° bend 8φ per Cl. 26.2.2.1).
 */

import {
    getTauC,
    TAU_C_MAX,
    flexuralDesign as flexuralDesignShared,
    selectBars,
    developmentLength,
    getMinSteelRatio,
    computeCost,
    type ConcreteGrade,
    type CostParameters,
    type BarResult,
} from '../lib/is456';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RetainingWallInput {
    // ── Geometry (all mm unless noted) ──────────────────────────────────────
    H: number;            // total height of wall = stem height + base thickness (mm)
    D_stem_base: number;  // stem thickness at the base (junction with base slab) (mm)
    D_stem_top: number;   // stem thickness at the top (mm)  — for a tapered stem
    D_base: number;       // base slab thickness (mm)
    B: number;            // total base width (mm)
    B_toe: number;        // toe projection from the front face of stem (mm)
    H_soil?: number;      // retained soil height from the base bottom (mm). Defaults to H.
    // ── Soil ────────────────────────────────────────────────────────────────
    phi: number;          // angle of internal friction of backfill (degrees)
    gamma_soil: number;   // unit weight of backfill (kN/m³)
    gamma_concrete: number; // unit weight of concrete (kN/m³)
    q_surcharge: number;  // surcharge on the backfill (kN/m²)
    mu: number;           // coefficient of base friction (concrete-on-soil)
    sbc: number;          // safe bearing capacity of foundation soil (kN/m²)
    waterTableDepth: number; // depth of water table below top of backfill (mm); 0 = dry
    // ── Material ────────────────────────────────────────────────────────────
    fck: number;
    fy: number;
    grade: string;        // e.g. 'M25'
    steelGrade: string;   // e.g. 'Fe500'
    cover: number;        // clear cover (mm)
    // ── Load factor ─────────────────────────────────────────────────────────
    loadFactor: number;   // 1.5 for ultimate (used for stem/base flexure and shear)
}

export interface AnchorageResult {
    Ld: number;              // development length of the stem bars (mm)
    embedment: number;       // straight vertical length inside the base (mm)
    detail: 'straight' | 'L-bar' | 'insufficient';
    leg_req: number;         // horizontal leg after a 90° bend (mm)
    leg_available: number;   // mm
}

export interface RetainingWallResult {
    // ── Echo of inputs ──────────────────────────────────────────────────────
    H: number;
    H_stem: number;        // stem height = H − D_base (mm)
    D_stem_base: number;
    D_stem_top: number;
    D_base: number;
    B: number;
    B_toe: number;
    B_heel: number;        // heel projection (mm)
    H_soil: number;
    phi: number;
    gamma_soil: number;
    gamma_concrete: number;
    q_surcharge: number;
    mu: number;
    sbc: number;
    waterTableDepth: number;
    fck: number;
    fy: number;
    grade: string;
    steelGrade: string;
    cover: number;
    loadFactor: number;

    Ka: number;

    // ── Horizontal forces (per metre run) ───────────────────────────────────
    Pa: number; Pa_arm: number;
    Pq: number; Pq_arm: number;
    Pa_water: number; Pa_water_arm: number;
    Pw_soil_submerged: number;
    SigmaH: number;

    // ── Vertical forces ─────────────────────────────────────────────────────
    W_stem: number;
    W_base: number;
    W_soil: number;        // soil over the heel, height H_soil − D_base
    W_surcharge: number;   // surcharge over the heel (bearing only — not restoring)
    U: number;             // uplift under the base (kN/m)
    U_arm: number;         // lever arm of U about the toe (m)
    W_dead: number;        // stem + base + soil
    SigmaV: number;        // W_dead + W_surcharge − U (bearing, with surcharge)
    M_resisting: number;   // moment of the permanent loads about the toe
    M_overturning: number; // moment of lateral forces + uplift about the toe

    // ── Stability (IS 456 Cl. 20) ───────────────────────────────────────────
    fos_overturning: number;   // 0.9·M_R / M_O  (≥ 1.4)
    fos_sliding: number;       // 0.9·μ·(W_dead − U) / ΣH  (≥ 1.4)
    overturning_ok: boolean;
    sliding_ok: boolean;

    // ── Bearing pressure (governing of with / without heel surcharge) ───────
    V_bearing: number;     // vertical load of the governing case (kN/m)
    x_bar: number;
    eccentricity: number;
    p_toe: number;
    p_heel: number;
    p_max: number;
    bearing_ok: boolean;
    bearingCase: 'with surcharge' | 'without surcharge';

    // ── Stem ────────────────────────────────────────────────────────────────
    stem_M_service: number; stem_Mu: number; stem_d: number; stem_Ast: number; stem_pt: number;
    stem_bars: BarResult;
    stem_tau_v: number; stem_tau_c: number; stem_shear_ok: boolean;
    stem_horizontal: { ratio: number; Ast_per_face: number; bars: BarResult };
    anchorage: AnchorageResult;

    // ── Base ────────────────────────────────────────────────────────────────
    heel_M_service: number; heel_Mu: number; heel_d: number; heel_Ast: number; heel_pt: number;
    heel_bars: BarResult; heel_V_service: number;
    heel_tau_v: number; heel_tau_c: number; heel_shear_ok: boolean;
    toe_M_service: number; toe_Mu: number; toe_d: number; toe_Ast: number; toe_pt: number;
    toe_bars: BarResult; toe_V_service: number;
    toe_tau_v: number; toe_tau_c: number; toe_shear_ok: boolean;
    base_distribution: { Ast_per_face: number; bars: BarResult };

    steelWeight_kg: number;   // per metre run (provided bars)
    concreteVol: number;      // m³ per metre run

    overallStatus: 'SAFE' | 'REVISE';
    tau_c_max: number;
    messages: string[];
    forcePoints: { y: number; V: number; M: number; p: number }[];
}

// ─── Main Analysis ───────────────────────────────────────────────────────────

export function analyzeRetainingWall(input: RetainingWallInput): RetainingWallResult {
    const {
        H, D_stem_base, D_stem_top, D_base, B, B_toe,
        phi, gamma_soil, gamma_concrete, q_surcharge, mu, sbc, waterTableDepth,
        fck, fy, grade, steelGrade, cover, loadFactor,
    } = input;
    const messages: string[] = [];
    const gradeC = grade as ConcreteGrade;

    // ── Derived geometry ────────────────────────────────────────────────────
    const H_stem = H - D_base;
    const B_heel = B - B_toe - D_stem_base;
    const H_soil = input.H_soil ?? H;
    const H_m = H / 1000;
    const H_soil_m = H_soil / 1000;
    const H_stem_m = H_stem / 1000;
    const B_m = B / 1000;
    const B_toe_m = B_toe / 1000;
    const B_heel_m = B_heel / 1000;
    const D_base_m = D_base / 1000;
    const D_stem_base_m = D_stem_base / 1000;
    const D_stem_top_m = D_stem_top / 1000;
    if (B_heel < 0) messages.push('Heel projection is negative — B < B_toe + stem thickness');

    // ── Active earth pressure coefficient (Rankine, horizontal backfill) ────
    const phi_rad = phi * Math.PI / 180;
    const Ka = (1 - Math.sin(phi_rad)) / (1 + Math.sin(phi_rad));

    // ── Lateral forces on the virtual back (full height H_soil) ─────────────
    const gamma_water = 9.81;
    let Pa = 0, Pa_arm = 0, Pa_water = 0, Pa_water_arm = 0, Pw_soil_submerged = 0;
    const wt_m = waterTableDepth > 0 ? waterTableDepth / 1000 : H_soil_m + 1;
    const hasWater = waterTableDepth > 0 && wt_m < H_soil_m;
    const hw = hasWater ? H_soil_m - wt_m : 0;          // water height above the base underside
    if (!hasWater) {
        Pa = 0.5 * Ka * gamma_soil * H_soil_m * H_soil_m;
        Pa_arm = H_soil_m / 3;
    } else {
        const h_dry = wt_m, h_wet = hw;
        const gamma_sub = gamma_soil - gamma_water;
        const Pa_dry = 0.5 * Ka * gamma_soil * h_dry * h_dry;
        const Pa_dry_arm = h_wet + h_dry / 3;
        const Pa_wet_rect = Ka * gamma_soil * h_dry * h_wet;
        const Pa_wet_tri = 0.5 * Ka * gamma_sub * h_wet * h_wet;
        const Pa_wet = Pa_wet_rect + Pa_wet_tri;
        const Pa_wet_arm = Pa_wet > 0 ? (Pa_wet_rect * (h_wet / 2) + Pa_wet_tri * (h_wet / 3)) / Pa_wet : 0;
        Pa = Pa_dry + Pa_wet;
        Pa_arm = Pa > 0 ? (Pa_dry * Pa_dry_arm + Pa_wet * Pa_wet_arm) / Pa : 0;
        Pa_water = 0.5 * gamma_water * h_wet * h_wet;
        Pa_water_arm = h_wet / 3;
        Pw_soil_submerged = Pa_wet;
    }
    const Pq = Ka * q_surcharge * H_soil_m;
    const Pq_arm = H_soil_m / 2;
    const SigmaH = Pa + Pq + Pa_water;
    const M_H = Pa * Pa_arm + Pq * Pq_arm + Pa_water * Pa_water_arm;

    // ── Vertical forces about the toe ───────────────────────────────────────
    const W_stem = 0.5 * (D_stem_base_m + D_stem_top_m) * H_stem_m * gamma_concrete;
    const x_stem = B_toe_m + D_stem_base_m / 2;
    const W_base = B_m * D_base_m * gamma_concrete;
    const x_base = B_m / 2;
    const h_soil_heel = Math.max(0, H_soil_m - D_base_m);   // soil above the heel
    const W_soil = Math.max(0, B_heel_m) * h_soil_heel * gamma_soil;
    const x_soil = B_toe_m + D_stem_base_m + B_heel_m / 2;
    const W_surcharge = Math.max(0, B_heel_m) * q_surcharge;
    const x_surcharge = x_soil;
    // Uplift: γw·hw at the heel to 0 at the toe → U = γw·hw·B/2 at 2B/3 from the toe.
    const U = 0.5 * gamma_water * hw * B_m;
    const U_arm = 2 * B_m / 3;

    const W_dead = W_stem + W_base + W_soil;
    const M_resisting = W_stem * x_stem + W_base * x_base + W_soil * x_soil;
    const M_overturning = M_H + U * U_arm;

    // ── Stability — IS 456 Cl. 20.1 / 20.2 ──────────────────────────────────
    const fos_overturning = M_overturning > 0 ? 0.9 * M_resisting / M_overturning : Infinity;
    const fos_sliding = SigmaH > 0 ? 0.9 * mu * Math.max(0, W_dead - U) / SigmaH : Infinity;
    const overturning_ok = fos_overturning >= 1.4;
    const sliding_ok = fos_sliding >= 1.4;
    if (!overturning_ok) messages.push(`Overturning: 0.9·M_R/M_O = ${fos_overturning.toFixed(2)} < 1.4 (IS 456 Cl. 20.1)`);
    if (!sliding_ok) messages.push(`Sliding: 0.9·μ·ΣW/ΣH = ${fos_sliding.toFixed(2)} < 1.4 (IS 456 Cl. 20.2) — widen the base or add a shear key`);

    // ── Bearing pressure — with and without the heel surcharge ──────────────
    const bearingOf = (withSurcharge: boolean) => {
        const V = W_dead + (withSurcharge ? W_surcharge : 0) - U;
        const Mnet = M_resisting + (withSurcharge ? W_surcharge * x_surcharge : 0) - M_overturning;
        const xb = V > 0 ? Mnet / V : 0;
        const e = xb - B_m / 2;                      // positive toward the heel
        const pAvg = V / B_m;
        const pToe = pAvg * (1 - 6 * e / B_m);
        const pHeel = pAvg * (1 + 6 * e / B_m);
        // contact pressure at x from the toe (linear)
        const pAt = (x: number) => pToe + (pHeel - pToe) * x / B_m;
        return { V, xb, e, pToe, pHeel, pAt, withSurcharge };
    };
    const bWith = bearingOf(true);
    const bWithout = bearingOf(false);
    const worse = Math.max(bWith.pToe, bWith.pHeel) >= Math.max(bWithout.pToe, bWithout.pHeel) ? bWith : bWithout;
    const minP = Math.min(bWith.pToe, bWith.pHeel, bWithout.pToe, bWithout.pHeel);
    const p_max = Math.max(worse.pToe, worse.pHeel);
    const bearing_ok = p_max <= sbc && minP >= 0 && worse.V > 0;
    if (p_max > sbc) messages.push(`Bearing p_max ${p_max.toFixed(0)} > SBC ${sbc} kN/m²`);
    if (minP < 0) messages.push(`Tension under the base (resultant outside the middle third) — revise base`);

    // ── Stem pressure integration (SFD / BMD) ───────────────────────────────
    const forcePoints: { y: number, V: number, M: number, p: number }[] = [];
    const n_steps = 100;
    const dy = H_stem_m / n_steps;
    const y_soil = H_m - H_soil_m;
    const wt_depth_from_stem_top = y_soil + (waterTableDepth > 0 ? waterTableDepth / 1000 : Infinity);
    let V = 0, M = 0;
    for (let i = 0; i <= n_steps; i++) {
        const y = i * dy;
        let p = 0;
        if (y > y_soil) {
            const z = y - y_soil;
            if (y > wt_depth_from_stem_top) {
                const z_dry = wt_depth_from_stem_top - y_soil;
                const z_wet = y - wt_depth_from_stem_top;
                p = Ka * gamma_soil * z_dry + Ka * (gamma_soil - gamma_water) * z_wet + gamma_water * z_wet;
            } else {
                p = Ka * gamma_soil * z;
            }
            p += Ka * q_surcharge;
        }
        if (i > 0) {
            const p_prev = forcePoints[i - 1].p;
            const dV = (p + p_prev) / 2 * dy;
            M += forcePoints[i - 1].V * dy + dV * (dy / 2);
            V += dV;
        }
        forcePoints.push({ y, V, M, p });
    }

    // ── Slab design helper: flexure + bars with d from the selected bar ─────
    const DIAS = [10, 12, 16, 20, 25];
    const designSlab = (Mu: number, Dmm: number) => {
        let dia = 12;
        let d = Dmm - cover - dia / 2;
        let flex = flexuralDesignShared(Mu, 1000, d, fck, fy, Dmm);
        let bars = selectBars(flex.Ast_req, DIAS, undefined, 1000, d);
        if (bars.dia !== dia) {
            dia = bars.dia;
            d = Dmm - cover - dia / 2;
            flex = flexuralDesignShared(Mu, 1000, d, fck, fy, Dmm);
            bars = selectBars(flex.Ast_req, DIAS, undefined, 1000, d);
        }
        return { d, flex, bars };
    };

    // ── Stem ────────────────────────────────────────────────────────────────
    const stem_M_service = forcePoints[n_steps].M;
    const stem_Mu = loadFactor * stem_M_service;
    const stem = designSlab(stem_Mu, D_stem_base);
    const stem_d = stem.d;
    const stem_Ast = stem.flex.Ast_req;
    const stem_pt = 100 * stem.bars.Ast_provided / (1000 * stem_d);
    const stem_Vu = loadFactor * forcePoints[n_steps].V;
    const stem_tau_v = (stem_Vu * 1000) / (1000 * stem_d);
    const stem_tau_c = getTauC(stem_pt, gradeC);
    const stem_shear_ok = stem_tau_v <= stem_tau_c;

    // Stem horizontal steel — Cl. 32.5(c): 0.20 % (deformed bars ≤ 16 mm,
    // fy ≥ 415) or 0.25 % of the gross section, half on each face; spacing
    // ≤ min(3t, 450) (Cl. 32.5 d).
    const hRatio = fy >= 415 ? 0.0020 : 0.0025;
    const hPerFace = hRatio * 1000 * D_stem_base / 2;
    const hSpacings = [100, 125, 150, 175, 200, 250, 300, 350, 400, 450].filter(sp => sp <= Math.min(3 * D_stem_top, 450));
    const stem_horizontal = {
        ratio: hRatio,
        Ast_per_face: Math.round(hPerFace),
        bars: selectBars(hPerFace, [8, 10, 12, 16], hSpacings.length ? hSpacings : [100], 1000),
    };

    // ── Heel & toe — exact trapezoidal pressure + uplift, both bearing cases ─
    const u = (x: number) => (hw > 0 ? gamma_water * hw * x / B_m : 0);    // uplift at x from the toe
    const xs_back = B_toe_m + D_stem_base_m;          // stem back face
    const xs_front = B_toe_m;                          // stem front face
    // Heel: cantilever from the stem back face; s = distance from the face.
    const heelActions = (b: ReturnType<typeof bearingOf>) => {
        const Lh = Math.max(0, B_heel_m);
        const wDown = gamma_concrete * D_base_m + gamma_soil * h_soil_heel + (b.withSurcharge ? q_surcharge : 0);
        const p1 = b.pAt(xs_back) + u(xs_back), p2 = b.pAt(B_m) + u(B_m);   // upward at face / heel end
        const Mdown = wDown * Lh * Lh / 2;
        const Mup = p1 * Lh * Lh / 2 + (p2 - p1) * Lh * Lh / 3;
        const Vnet = wDown * Lh - (p1 + p2) / 2 * Lh;
        return { M: Mdown - Mup, V: Vnet };
    };
    // Toe: cantilever from the stem front face toward the toe.
    const toeActions = (b: ReturnType<typeof bearingOf>) => {
        const Lt = B_toe_m;
        const p3 = b.pAt(xs_front) + u(xs_front), p0 = b.pAt(0) + u(0);   // at face / toe end
        const Mup = p3 * Lt * Lt / 2 + (p0 - p3) * Lt * Lt / 3;
        const Mdown = gamma_concrete * D_base_m * Lt * Lt / 2;
        const Vnet = (p3 + p0) / 2 * Lt - gamma_concrete * D_base_m * Lt;
        return { M: Mup - Mdown, V: Vnet };
    };
    const heelA = [heelActions(bWith), heelActions(bWithout)].reduce((a, b) => (b.M > a.M ? b : a));
    const toeA = [toeActions(bWith), toeActions(bWithout)].reduce((a, b) => (b.M > a.M ? b : a));

    const heel_M_service = Math.max(0, heelA.M);
    const heel_Mu = loadFactor * heel_M_service;
    const heel = designSlab(heel_Mu, D_base);
    const heel_d = heel.d;
    const heel_Ast = heel.flex.Ast_req;
    const heel_pt = 100 * heel.bars.Ast_provided / (1000 * heel_d);
    const heel_Vu = loadFactor * Math.abs(heelA.V);
    const heel_tau_v = (heel_Vu * 1000) / (1000 * heel_d);
    const heel_tau_c = getTauC(heel_pt, gradeC);
    const heel_shear_ok = heel_tau_v <= heel_tau_c;

    const toe_M_service = Math.max(0, toeA.M);
    const toe_Mu = loadFactor * toe_M_service;
    const toe = designSlab(toe_Mu, D_base);
    const toe_d = toe.d;
    const toe_Ast = toe.flex.Ast_req;
    const toe_pt = 100 * toe.bars.Ast_provided / (1000 * toe_d);
    const toe_Vu = loadFactor * Math.abs(toeA.V);
    const toe_tau_v = (toe_Vu * 1000) / (1000 * toe_d);
    const toe_tau_c = getTauC(toe_pt, gradeC);
    const toe_shear_ok = toe_tau_v <= toe_tau_c;

    // Base distribution steel — Cl. 26.5.2.1, half on each face.
    const distPerFace = getMinSteelRatio(fy) * 1000 * D_base / 2;
    const base_distribution = {
        Ast_per_face: Math.round(distPerFace),
        bars: selectBars(distPerFace, [8, 10, 12], undefined, 1000, D_base - cover, true),
    };

    // ── Anchorage of the stem bars into the base (Cl. 26.2.1 / 26.2.2.1) ───
    const stemDia = stem.bars.dia;
    const stressRatio = stem.bars.Ast_provided > 0 ? Math.min(1, stem_Ast / stem.bars.Ast_provided) : 1;
    const Ld = developmentLength(stemDia, fy, grade, true, false, stressRatio);
    const embedment = D_base - cover - toe.bars.dia;
    let anchorDetail: AnchorageResult['detail'] = 'straight';
    let leg_req = 0;
    const leg_available = (B_toe + D_stem_base) - cover;
    if (embedment < Ld) {
        // horizontal leg after the 90° bend (anchorage value 8φ), at least the
        // 4φ extension of a standard bend
        leg_req = Math.max(4 * stemDia, Ld - embedment - 8 * stemDia);
        anchorDetail = leg_req <= leg_available ? 'L-bar' : 'insufficient';
    }
    const anchorage: AnchorageResult = {
        Ld: Math.round(Ld), embedment: Math.round(embedment), detail: anchorDetail,
        leg_req: Math.round(leg_req), leg_available: Math.round(leg_available),
    };
    if (anchorDetail === 'insufficient') messages.push(`Stem bars cannot be anchored in the base (Ld ${Math.round(Ld)} mm) — deepen the base`);

    // ── Bars adequacy ───────────────────────────────────────────────────────
    const barsOk = [stem.bars, heel.bars, toe.bars].every(b => b.adequate !== false);
    if (!barsOk) messages.push('Required steel exceeds the densest bar arrangement — increase thickness');

    // ── Quantities per metre run ────────────────────────────────────────────
    const concreteVol = B_m * D_base_m + 0.5 * (D_stem_base_m + D_stem_top_m) * H_stem_m;
    const mm2m =
        stem.bars.Ast_provided * (H_stem_m + embedment / 1000 + leg_req / 1000)
        + stem_horizontal.bars.Ast_provided * 2 * H_stem_m                 // both faces, over the height
        + heel.bars.Ast_provided * (Math.max(0, B_heel_m) + D_stem_base_m)
        + toe.bars.Ast_provided * (B_toe_m + D_stem_base_m)
        + base_distribution.bars.Ast_provided * 2 * B_m;
    const steelWeight_kg = mm2m * 7850 / 1e6;

    const overallStatus: 'SAFE' | 'REVISE' = (
        overturning_ok && sliding_ok && bearing_ok && B_heel >= 0 &&
        !stem.flex.isDoubly && stem_shear_ok &&
        !heel.flex.isDoubly && heel_shear_ok &&
        !toe.flex.isDoubly && toe_shear_ok &&
        barsOk && anchorDetail !== 'insufficient'
    ) ? 'SAFE' : 'REVISE';

    return {
        H, H_stem, D_stem_base, D_stem_top, D_base, B, B_toe, B_heel, H_soil,
        phi, gamma_soil, gamma_concrete, q_surcharge, mu, sbc, waterTableDepth,
        fck, fy, grade, steelGrade, cover, loadFactor,
        Ka,
        Pa, Pa_arm, Pq, Pq_arm, Pa_water, Pa_water_arm, Pw_soil_submerged, SigmaH,
        W_stem, W_base, W_soil, W_surcharge, U, U_arm, W_dead,
        SigmaV: bWith.V,
        M_resisting, M_overturning,
        fos_overturning, fos_sliding, overturning_ok, sliding_ok,
        V_bearing: worse.V,
        x_bar: worse.xb, eccentricity: worse.e, p_toe: worse.pToe, p_heel: worse.pHeel, p_max, bearing_ok,
        bearingCase: worse.withSurcharge ? 'with surcharge' : 'without surcharge',
        stem_M_service, stem_Mu, stem_d, stem_Ast, stem_pt, stem_bars: stem.bars,
        stem_tau_v, stem_tau_c, stem_shear_ok, stem_horizontal, anchorage,
        heel_M_service, heel_Mu, heel_d, heel_Ast, heel_pt, heel_bars: heel.bars, heel_V_service: heelA.V,
        heel_tau_v, heel_tau_c, heel_shear_ok,
        toe_M_service, toe_Mu, toe_d, toe_Ast, toe_pt, toe_bars: toe.bars, toe_V_service: toeA.V,
        toe_tau_v, toe_tau_c, toe_shear_ok,
        base_distribution,
        steelWeight_kg: Math.round(steelWeight_kg * 10) / 10,
        concreteVol,
        overallStatus,
        tau_c_max: TAU_C_MAX[gradeC] ?? 2.8,
        messages,
        forcePoints,
    };
}

// ─── Optimizer ───────────────────────────────────────────────────────────────

export interface RetainingWallOptimizeParams {
    minB: number; maxB: number; stepB: number;       // base width (mm)
    minThk: number; maxThk: number; stepThk: number; // stem thickness at the base (mm)
    // Base slab thickness sweep (mm). Defaults to the stem range.
    minBase?: number; maxBase?: number; stepBase?: number;
    // Toe projection as a fraction of B. Default [0.2, 0.25, 0.3, 0.35, 0.4].
    toeRatios?: number[];
}

export interface OptimumRetainingWallDesign {
    B: number;
    B_toe: number;
    thk: number;            // stem thickness at the base (mm)
    D_base: number;         // base slab thickness (mm)
    concreteVol: number;    // m³ per metre run
    steelWeight: number;    // kg per metre run (provided bars)
    costTotal_INR: number;  // total cost per metre run (₹)
    result: RetainingWallResult;
}

export interface RetainingWallOptimizeResult {
    totalTrials: number;
    feasibleCount: number;
    topDesigns: OptimumRetainingWallDesign[];        // sorted by cost ascending
    optimum: OptimumRetainingWallDesign | null;
    costParams: CostParameters;
}

export type RetainingWallProgressCallback = (
    done: number, total: number, feasible: number,
) => void;

/**
 * Minimum-cost cantilever retaining wall: sweeps base width B, toe fraction,
 * stem thickness and base-slab thickness independently. The stem top
 * thickness is capped at the base thickness (no inverted taper).
 * Cost = concrete + provided steel (stem vertical + horizontal, heel, toe,
 * base distribution) + formwork (both stem faces + base edges).
 */
export function optimizeRetainingWall(
    baseInput: RetainingWallInput,
    bounds: RetainingWallOptimizeParams,
    costParams: CostParameters = { steelCost_per_kg: 82, concreteCost_per_m3: 6500, formworkCost_per_m2: 350, wastage_factor: 1.07 },
    onProgress?: RetainingWallProgressCallback,
): RetainingWallOptimizeResult {
    const results: OptimumRetainingWallDesign[] = [];
    let feasible = 0;

    const { minB, maxB, stepB, minThk, maxThk, stepThk } = bounds;
    const minBase = bounds.minBase ?? minThk, maxBase = bounds.maxBase ?? maxThk, stepBase = bounds.stepBase ?? stepThk;
    const toeRatios = bounds.toeRatios ?? [0.2, 0.25, 0.3, 0.35, 0.4];
    const steps = (lo: number, hi: number, st: number) => Math.max(1, Math.round((hi - lo) / st) + 1);
    const numB = steps(minB, maxB, stepB);
    const numThk = steps(minThk, maxThk, stepThk);
    const numBase = steps(minBase, maxBase, stepBase);
    const total = numB * numThk * numBase * toeRatios.length;
    let done = 0;

    for (let iB = 0; iB < numB; iB++) {
        const currentB = minB + iB * stepB;
        for (let iT = 0; iT < numThk; iT++) {
            const thk = minThk + iT * stepThk;
            for (let iD = 0; iD < numBase; iD++) {
                const dBase = minBase + iD * stepBase;
                for (const tr of toeRatios) {
                    done++;
                    const currentToe = Math.round((currentB * tr) / 50) * 50;
                    if (currentB - currentToe - thk < 0) continue;
                    const trialInput: RetainingWallInput = {
                        ...baseInput,
                        B: currentB,
                        B_toe: currentToe,
                        D_stem_base: thk,
                        D_stem_top: Math.min(baseInput.D_stem_top, thk),
                        D_base: dBase,
                    };
                    try {
                        const r = analyzeRetainingWall(trialInput);
                        if (r.overallStatus === 'SAFE') {
                            feasible++;
                            const formworkArea = 2 * (r.H_stem / 1000) + 2 * (r.D_base / 1000);
                            const costTotal_INR = computeCost(r.concreteVol, r.steelWeight_kg, formworkArea, costParams);
                            results.push({
                                B: currentB, B_toe: currentToe, thk, D_base: dBase,
                                concreteVol: r.concreteVol, steelWeight: r.steelWeight_kg,
                                costTotal_INR, result: r,
                            });
                        }
                    } catch {
                        // skip invalid combo
                    }
                    if (onProgress && (done % Math.max(1, Math.floor(total / 20)) === 0 || done === total)) {
                        onProgress(done, total, feasible);
                    }
                }
            }
        }
    }

    results.sort((a, b) => a.costTotal_INR - b.costTotal_INR);
    return {
        totalTrials: total,
        feasibleCount: feasible,
        topDesigns: results.slice(0, 10),
        optimum: results.length > 0 ? results[0] : null,
        costParams,
    };
}
