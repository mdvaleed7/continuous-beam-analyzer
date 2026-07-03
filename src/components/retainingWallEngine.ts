/**
 * retainingWallEngine.ts — IS 456:2000 Cantilever Retaining Wall Design
 *
 * A cantilever retaining wall is a statically DETERMINATE structure:
 *   • A vertical STEM fixed into a BASE slab (heel + toe).
 *   • Earth pressure (active) acts on the back of the stem, producing a
 *     cantilever moment at the stem-base junction.
 *   • Stability against overturning (about the toe) and sliding (along the
 *     base) is checked from the free-body of the whole wall.
 *   • Bearing pressure under the base is computed from ΣV and ΣM about the
 *     centroid of the base (trapezoidal distribution).
 *   • Stem and base are designed as rectangular RC sections per IS 456 Cl. 38.1
 *     (flexure) and Cl. 40 (shear).
 *
 * This engine is deliberately simple — no counterforts, no anchorage, no
 * water-table iteration (a single water table depth is handled). For more
 * complex cases the user should fall back to the zone-based basement wall.
 */

import {
    getTauC,
    TAU_C_MAX,
    flexuralDesign as flexuralDesignShared,
    type ConcreteGrade,
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
    // B_heel = B − B_toe − D_stem_base (derived)
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
    loadFactor: number;   // 1.5 for ultimate (used for stem/base flexure)
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

    // ── Earth pressure coefficients ─────────────────────────────────────────
    Ka: number;            // active earth pressure coefficient (Rankine)

    // ── Forces (per metre length of wall) ───────────────────────────────────
    Pa: number;            // active earth pressure resultant from soil (kN)
    Pa_arm: number;        // lever arm of Pa above base (m)
    Pq: number;            // surcharge pressure resultant (kN)
    Pq_arm: number;        // lever arm of Pq above base (m)
    Pa_water: number;      // water pressure resultant (kN), if water table present
    Pa_water_arm: number;  // lever arm of water pressure (m)
    Pw_soil_submerged: number; // submerged soil pressure correction (kN)

    // ── Resisting vertical forces (kN) and moments about toe (kN·m) ─────────
    W_stem: number;        // self-weight of stem
    W_base: number;        // self-weight of base slab
    W_soil: number;        // weight of soil on the heel
    W_surcharge: number;   // weight of surcharge on the heel (if any)
    SigmaV: number;        // total vertical force = ΣW
    M_resisting: number;   // Σ resisting moments about the toe
    M_overturning: number; // Σ overturning moments about the toe

    // ── Stability factors of safety ─────────────────────────────────────────
    fos_overturning: number;   // M_resisting / M_overturning  (≥ 1.4 typical)
    fos_sliding: number;       // μ·ΣV / ΣH                    (≥ 1.4 typical; passive ignored)
    overturning_ok: boolean;
    sliding_ok: boolean;

    // ── Bearing pressure ────────────────────────────────────────────────────
    x_bar: number;         // distance of resultant ΣV from the toe (m)
    eccentricity: number;  // eccentricity from base centreline (m)
    p_toe: number;         // bearing pressure at toe (kN/m²)
    p_heel: number;        // bearing pressure at heel (kN/m²)
    p_max: number;         // max(p_toe, p_heel)
    bearing_ok: boolean;   // p_max ≤ sbc

    // ── Stem design (cantilever, fixed at base) ─────────────────────────────
    stem_M_service: number;  // service moment at stem base per m (kN·m/m)
    stem_Mu: number;         // factored moment (kN·m/m)
    stem_d: number;          // effective depth (mm)
    stem_Ast: number;        // required steel area (mm²/m)
    stem_pt: number;         // % steel
    stem_tau_v: number;      // shear stress at stem base (N/mm²)
    stem_tau_c: number;      // permissible shear stress (N/mm²)
    stem_shear_ok: boolean;

    // ── Base design ─────────────────────────────────────────────────────────
    // Heel: tension at TOP — moment from (soil weight + surcharge + self-weight
    //       of heel) − (upward bearing pressure over the heel).
    // Toe:  tension at BOTTOM — moment from (upward bearing pressure over the toe)
    //       − (self-weight of toe).
    heel_M_service: number;  // net moment at stem face on the heel (kN·m/m)
    heel_Mu: number;
    heel_d: number;
    heel_Ast: number;
    heel_pt: number;
    heel_tau_v: number;
    heel_tau_c: number;
    heel_shear_ok: boolean;

    toe_M_service: number;   // net moment at stem face on the toe (kN·m/m)
    toe_Mu: number;
    toe_d: number;
    toe_Ast: number;
    toe_pt: number;
    toe_tau_v: number;
    toe_tau_c: number;
    toe_shear_ok: boolean;

    overallStatus: 'SAFE' | 'REVISE';
    tau_c_max: number;       // Table 20 max shear stress for the grade
    messages: string[];      // human-readable check messages
    
    // ── SFD/BMD points for rendering ────────────────────────────────────────
    forcePoints: { y: number; V: number; M: number; p: number }[]; // y is depth from top of wall (0 to H_stem)
}

// ─── Main Analysis ───────────────────────────────────────────────────────────

export function analyzeRetainingWall(input: RetainingWallInput): RetainingWallResult {
    const {
        H, D_stem_base, D_stem_top, D_base, B, B_toe,
        phi, gamma_soil, gamma_concrete, q_surcharge, mu, sbc, waterTableDepth,
        fck, fy, grade, steelGrade, cover, loadFactor,
    } = input;

    const messages: string[] = [];

    // ── Derived geometry ────────────────────────────────────────────────────
    const H_stem = H - D_base;                 // stem height (mm)
    const B_heel = B - B_toe - D_stem_base;    // heel projection (mm)
    const H_soil = input.H_soil ?? H;          // soil height (mm)
    const H_m = H / 1000;
    const H_soil_m = H_soil / 1000;
    const H_stem_m = H_stem / 1000;
    const B_m = B / 1000;
    const B_toe_m = B_toe / 1000;
    const B_heel_m = B_heel / 1000;
    const D_base_m = D_base / 1000;
    const D_stem_base_m = D_stem_base / 1000;
    const D_stem_top_m = D_stem_top / 1000;

    // ── Active earth pressure coefficient (Rankine, horizontal backfill) ────
    const phi_rad = phi * Math.PI / 180;
    const Ka = (1 - Math.sin(phi_rad)) / (1 + Math.sin(phi_rad));

    // ── Water table handling ────────────────────────────────────────────────
    // If waterTableDepth is between 0 and H_stem, soil above WT is moist (γ_soil)
    // and soil below WT is submerged (γ' = γ_soil − γ_water). For simplicity we
    // use γ_water = 9.81 kN/m³. The water table is measured from the TOP of the
    // backfill. 0 = dry (no water).
    // Water table is measured from the TOP of the backfill.
    const gamma_water = 9.81;
    let Pa = 0, Pa_arm = 0;
    let Pa_water = 0, Pa_water_arm = 0;
    let Pw_soil_submerged = 0;
    const wt_m = waterTableDepth > 0 ? waterTableDepth / 1000 : H_soil_m + 1; // +1 → "no WT"

    if (waterTableDepth <= 0 || wt_m >= H_soil_m) {
        // Fully dry
        Pa = 0.5 * Ka * gamma_soil * H_soil_m * H_soil_m;
        Pa_arm = H_soil_m / 3;
    } else {
        const h_dry = wt_m;                                  // dry height
        const h_wet = H_soil_m - wt_m;                       // submerged height
        const gamma_sub = gamma_soil - gamma_water;          // submerged unit weight
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

    // Surcharge
    const Pq = Ka * q_surcharge * H_soil_m;
    const Pq_arm = H_soil_m / 2;

    // ── Resisting vertical forces (per metre) — about the TOE ───────────────
    // Take the heel/soil weight over the heel projection.
    // Stem: trapezoid if tapered, else rectangle. Centroid from the toe.
    const stem_area = 0.5 * (D_stem_base_m + D_stem_top_m) * H_stem_m; // m²
    const W_stem = stem_area * gamma_concrete; // kN/m
    // Stem centroid measured from the toe (front face):
    // the stem sits at B_toe + D_stem_base/2 from the toe (approx for trapezoid
    // the centroid x-offset within the stem is small; use D_stem_base/2).
    const x_stem = B_toe_m + D_stem_base_m / 2;

    const W_base = B_m * D_base_m * gamma_concrete;
    const x_base = B_m / 2;

    // Soil on the heel: (B_heel × H) × γ_soil, centroid at B_toe + D_stem_base + B_heel/2
    // Soil on the heel
    const W_soil = B_heel_m * H_soil_m * gamma_soil;
    const x_soil = B_toe_m + D_stem_base_m + B_heel_m / 2;

    // Surcharge on the heel (if present)
    const W_surcharge = B_heel_m * q_surcharge;
    const x_surcharge = x_soil; // same centroid as the heel soil

    const SigmaV = W_stem + W_base + W_soil + W_surcharge;

    // Resisting moments about the toe
    const M_resisting = W_stem * x_stem + W_base * x_base + W_soil * x_soil + W_surcharge * x_surcharge;

    // Overturning moments about the toe
    const M_overturning = Pa * Pa_arm + Pq * Pq_arm + Pa_water * Pa_water_arm;

    // ── Stability checks ────────────────────────────────────────────────────
    const fos_overturning = M_overturning > 0 ? M_resisting / M_overturning : Infinity;
    const SigmaH = Pa + Pq + Pa_water;
    const fos_sliding = SigmaH > 0 ? (mu * SigmaV) / SigmaH : Infinity;
    const overturning_ok = fos_overturning >= 1.4;
    const sliding_ok = fos_sliding >= 1.4;
    if (!overturning_ok) messages.push(`Overturning FoS ${fos_overturning.toFixed(2)} < 1.4`);
    if (!sliding_ok) messages.push(`Sliding FoS ${fos_sliding.toFixed(2)} < 1.4`);

    // ── Bearing pressure (trapezoidal, eccentric load) ──────────────────────
    // Resultant ΣV acts at x_bar from the toe. Eccentricity from base centre.
    const x_bar = SigmaV > 0 ? M_resisting / SigmaV : 0; // (M_resist − M_ot) gives the resultant position
    // Net moment about the centroid:
    const M_net = SigmaV * x_bar - M_overturning; // = M_resisting - M_overturning about toe, then shift
    // Simpler: resultant x measured from centroid = x_bar - B/2
    const eccentricity = x_bar - B_m / 2;
    // Bearing: p = ΣV/B ± ΣV·e/(B²/6) = (ΣV/B)·(1 ± 6e/B)
    const p_avg = SigmaV / B_m;
    const p_toe = p_avg + p_avg * (6 * eccentricity / B_m) * 1; // toe side (e positive → toe pressure higher)
    const p_heel = p_avg - p_avg * (6 * eccentricity / B_m);
    // Note: if 6e/B > 1 the pressure at heel goes into tension — we clip to 0
    // and report a REVISE (the pressure distribution becomes triangular).
    const p_max = Math.max(p_toe, Math.max(p_heel, 0));
    const p_min = Math.min(p_toe, Math.min(p_heel, 0));
    const bearing_ok = p_max <= sbc && p_min >= 0;
    if (p_max > sbc) messages.push(`Bearing p_max ${p_max.toFixed(0)} > SBC ${sbc} kN/m²`);
    if (p_min < 0) messages.push(`Tension at heel (e=${(eccentricity*1000).toFixed(0)}mm > B/6) — revise base`);

    // ── Stem flexure & SFD/BMD Numerical Integration ────────────────────────
    const forcePoints: { y: number, V: number, M: number, p: number }[] = [];
    const n_steps = 100;
    const dy = H_stem_m / n_steps;
    const y_soil = H_m - H_soil_m; // depth of soil surface from top of stem
    const wt_depth_from_stem_top = y_soil + (waterTableDepth > 0 ? waterTableDepth / 1000 : Infinity);

    let V = 0;
    let M = 0;

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
            p += Ka * q_surcharge; // Surcharge is uniform below y_soil
        }
        
        if (i > 0) {
            const p_prev = forcePoints[i - 1].p;
            const p_avg = (p + p_prev) / 2;
            const dV = p_avg * dy;
            M += forcePoints[i - 1].V * dy + dV * (dy / 2);
            V += dV;
        }
        forcePoints.push({ y, V, M, p });
    }

    const stem_M_service = forcePoints[n_steps].M;
    const stem_Mu = loadFactor * stem_M_service;
    const stem_d = D_stem_base - cover - 12 / 2; 
    const stem_flex = flexuralDesignShared(stem_Mu, 1000, stem_d, fck, fy, D_stem_base);
    const stem_Ast = stem_flex.Ast_req;
    const stem_pt = stem_flex.pt ?? 0;

    const stem_Vu = loadFactor * forcePoints[n_steps].V;
    const stem_tau_v = (stem_Vu * 1000) / (1000 * stem_d);
    const stem_tau_c = getTauC(stem_pt, grade as ConcreteGrade);
    const stem_shear_ok = stem_tau_v <= stem_tau_c;

    // ── Heel design (tension at TOP) ────────────────────────────────────────
    // Net downward pressure on heel = (soil weight + surcharge + heel self-weight)
    //   − (upward bearing pressure over the heel).
    // Heel cantilever length = B_heel, per metre width.
    const heel_self_wt = B_heel_m * D_base_m * gamma_concrete;
    const heel_soil_wt = B_heel_m * H_soil_m * gamma_soil;
    const heel_surcharge_wt = B_heel_m * q_surcharge;
    // Average bearing pressure over the heel (linear interp from p_heel at the
    // back to p_stem_back at the stem back face):
    const p_at_heel_back = p_heel; // at the very back of the heel
    // The stem back face is at B_toe + D_stem_base from the toe. Pressure there:
    const x_stem_back = B_toe_m + D_stem_base_m;
    const p_at_stem_back = p_avg + p_avg * (6 * eccentricity / B_m) * (1 - 2 * x_stem_back / B_m);
    const p_heel_avg = (p_at_heel_back + p_at_stem_back) / 2;
    const heel_upward = p_heel_avg * B_heel_m;
    const heel_net_down = heel_self_wt + heel_soil_wt + heel_surcharge_wt - heel_upward;
    // Moment at the stem back face (cantilever fixed there):
    const heel_M_service = Math.max(0, heel_net_down * B_heel_m / 2); // kN·m/m
    const heel_Mu = loadFactor * heel_M_service;
    const heel_d = D_base - cover - 12 / 2; // top steel
    const heel_flex = flexuralDesignShared(heel_Mu, 1000, heel_d, fck, fy, D_base);
    const heel_Ast = heel_flex.Ast_req;
    const heel_pt = heel_flex.pt ?? 0;
    const heel_Vu = loadFactor * Math.abs(heel_net_down);
    const heel_tau_v = (heel_Vu * 1000) / (1000 * heel_d);
    const heel_tau_c = getTauC(heel_pt, grade as ConcreteGrade);
    const heel_shear_ok = heel_tau_v <= heel_tau_c;

    // ── Toe design (tension at BOTTOM) ──────────────────────────────────────
    // Net upward pressure on toe = (bearing pressure over the toe)
    //   − (toe self-weight).
    const toe_self_wt = B_toe_m * D_base_m * gamma_concrete;
    const p_at_toe_front = p_toe;
    const p_at_stem_front = p_avg + p_avg * (6 * eccentricity / B_m) * (1 - 2 * B_toe_m / B_m);
    const p_toe_avg = (p_at_toe_front + p_at_stem_front) / 2;
    const toe_upward = p_toe_avg * B_toe_m;
    const toe_net_up = toe_upward - toe_self_wt;
    const toe_M_service = Math.max(0, toe_net_up * B_toe_m / 2);
    const toe_Mu = loadFactor * toe_M_service;
    const toe_d = D_base - cover - 12 / 2; // bottom steel
    const toe_flex = flexuralDesignShared(toe_Mu, 1000, toe_d, fck, fy, D_base);
    const toe_Ast = toe_flex.Ast_req;
    const toe_pt = toe_flex.pt ?? 0;
    const toe_Vu = loadFactor * Math.abs(toe_net_up);
    const toe_tau_v = (toe_Vu * 1000) / (1000 * toe_d);
    const toe_tau_c = getTauC(toe_pt, grade as ConcreteGrade);
    const toe_shear_ok = toe_tau_v <= toe_tau_c;

    // ── Overall status ──────────────────────────────────────────────────────
    const overallStatus: 'SAFE' | 'REVISE' = (
        overturning_ok && sliding_ok && bearing_ok &&
        !stem_flex.isDoubly && stem_shear_ok &&
        !heel_flex.isDoubly && heel_shear_ok &&
        !toe_flex.isDoubly && toe_shear_ok
    ) ? 'SAFE' : 'REVISE';

    return {
        H, H_stem, D_stem_base, D_stem_top, D_base, B, B_toe, B_heel, H_soil,
        phi, gamma_soil, gamma_concrete, q_surcharge, mu, sbc, waterTableDepth,
        fck, fy, grade, steelGrade, cover, loadFactor,
        Ka,
        Pa, Pa_arm, Pq, Pq_arm, Pa_water, Pa_water_arm, Pw_soil_submerged,
        W_stem, W_base, W_soil, W_surcharge, SigmaV,
        M_resisting, M_overturning,
        fos_overturning, fos_sliding, overturning_ok, sliding_ok,
        x_bar, eccentricity, p_toe, p_heel, p_max, bearing_ok,
        stem_M_service, stem_Mu, stem_d, stem_Ast, stem_pt, stem_tau_v, stem_tau_c, stem_shear_ok,
        heel_M_service, heel_Mu, heel_d, heel_Ast, heel_pt, heel_tau_v, heel_tau_c, heel_shear_ok,
        toe_M_service, toe_Mu, toe_d, toe_Ast, toe_pt, toe_tau_v, toe_tau_c, toe_shear_ok,
        overallStatus,
        tau_c_max: TAU_C_MAX[grade as ConcreteGrade] ?? 2.8,
        messages,
        forcePoints
    };
}

// ─── Optimizer ───────────────────────────────────────────────────────────────

export function optimizeRetainingWall(
    baseInput: RetainingWallInput,
    bounds: { minB: number, maxB: number, stepB: number, minThk: number, maxThk: number, stepThk: number }
) {
    let bestResult: RetainingWallResult | null = null;
    let minVol = Infinity;
    let feasible = 0;
    let total = 0;

    const { minB, maxB, stepB, minThk, maxThk, stepThk } = bounds;

    for (let currentB = minB; currentB <= maxB; currentB += stepB) {
        for (let thk = minThk; thk <= maxThk; thk += stepThk) {
            // Toe projection heuristic: usually 1/3 of B
            const currentToe = Math.round((currentB / 3) / 50) * 50; 
            
            const trialInput: RetainingWallInput = {
                ...baseInput,
                B: currentB,
                B_toe: currentToe,
                D_stem_base: thk,
                D_base: thk,
            };

            const r = analyzeRetainingWall(trialInput);
            total++;

            if (r.overallStatus === 'SAFE') {
                feasible++;
                const vol = (r.B * r.D_base) / 1e6 + (0.5 * (r.D_stem_base + r.D_stem_top) * r.H_stem) / 1e6;
                if (vol < minVol) {
                    minVol = vol;
                    bestResult = r;
                }
            }
        }
    }

    return { bestResult, minVol, feasible, total };
}
