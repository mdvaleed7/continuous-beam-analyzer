/**
 * waffleSlabEngine.ts — Waffle (Ribbed) Slab Design
 *
 * ponytail (this pass):
 *  • BUG-WS1 fix: when the neutral axis exits the flange (xu > Df), the rib
 *    must be designed as a true T-beam. Previously the code flagged
 *    `NA_in_flange=false` but kept the rectangular-flange Ast, which is
 *    incorrect for heavily-loaded waffles. Now falls back to the T-beam
 *    stress block: C = 0.36·fck·bw·xu + 0.45·fck·(bf−bw)·Df.
 *  • Dead-code removal: `tau_c_max = 0.62·√fck` was declared but never used
 *    (shear_safe compared to tau_c, not tau_c_max). Removed. The real IS 456
 *    Table 20 τc,max check is now added via getTauCMax.
 *  • DRY: Ast now calls the shared `flexuralDesign` from ../lib/is456 for the
 *    NA-in-flange case (rectangular width bf), and getTauC for shear.
 */
import {
    flexuralDesign as flexuralDesignShared,
    getTauC,
    getTauCMax,
    getMinSteelRatio,
    annexCDeflection,
    tBeamDeflection,
    getRequiredDeflectionCamber,
    computeSpanDepthCheck,
    type ConcreteGrade,
    type DeflectionResult,
    type SupportCondition,
    type CostParameters,
    type SpanDepthCheckResult,
    computeCost,
} from '../lib/is456';

export interface WaffleSlabInput {
    Lx: number; // short span (m)
    Ly: number; // long span (m)
    spacing_x: number; // rib spacing c/c parallel to X (m)
    spacing_y: number; // rib spacing c/c parallel to Y (m)
    bw: number; // rib width (mm)
    D: number; // overall depth (mm)
    Df: number; // topping thickness (mm)
    cover: number;
    fck: number;
    fy: number;
    grade?: string;      // e.g. 'M25' (optional, for UI dropdown sync)
    steelGrade?: string; // e.g. 'Fe500' (optional, for UI dropdown sync)
    w_live: number;
    w_finish: number;
    deflectionSupport?: SupportCondition; // 'continuous' | 'simply' | 'one_end' — default 'continuous'
    // Rib reinforcement for the T-beam deflection check. If provided, the
    // actual Ast controls the cracked inertia I_cr → I_eff → deflection.
    rib_bar_dia?: number;    // rib BOTTOM (tension) bar diameter (mm)
    rib_n_bars?: number;     // number of bottom (tension) bars in the rib
    // Rib TOP (compression) bars — hanger / anchor bars at midspan top face.
    // When supplied, they enter the Annex C deflection formula via the pc /
    // (m−1)·Asc terms, exactly as in PI-EX-106A. Defaults to no top steel.
    rib_top_bar_dia?: number; // rib TOP (compression) bar diameter (mm)
    rib_top_n_bars?: number;  // number of top (compression) bars in the rib
    camber?: number; // explicit upward camber (mm), used by optimizer
    costParams?: CostParameters;
}

export function analyzeWaffleSlab(input: WaffleSlabInput) {
    const { Lx, Ly, spacing_x, spacing_y, bw, D, Df, cover, fck, fy, w_live, w_finish } = input;
    const deflSupport: SupportCondition = input.deflectionSupport || 'continuous';

    const d = D - cover - 10; // effective depth
    const Dr = D - Df; // rib depth

    // Self weight calculation
    // Volume of a unit cell: spacing_x * spacing_y * D
    // Volume of void in a unit cell: (spacing_x - bw/1000) * (spacing_y - bw/1000) * (Dr/1000)
    const cell_area = spacing_x * spacing_y;
    const void_vol = (spacing_x - bw / 1000) * (spacing_y - bw / 1000) * (Dr / 1000);
    const solid_vol = (cell_area * D / 1000) - void_vol;
    const w_dead = (solid_vol / cell_area) * 25; // equivalent uniform dead load kN/m2

    const wu = 1.5 * (w_dead + w_live + w_finish);

    // Rankine-Grashoff Method for approximate grid moments
    // load shared inversely proportional to L^4
    const Lx4 = Math.pow(Lx, 4);
    const Ly4 = Math.pow(Ly, 4);
    const qx = wu * (Ly4 / (Lx4 + Ly4));
    const qy = wu * (Lx4 / (Lx4 + Ly4));

    // Max Moment per meter (assuming simply supported boundaries for approximation)
    const Mx_per_m = (qx * Lx * Lx) / 8; // kN.m / m
    const My_per_m = (qy * Ly * Ly) / 8;

    // Moment per rib
    const M_rib_x = Mx_per_m * spacing_y; // Rib parallel to X takes moment from spacing_y width
    const M_rib_y = My_per_m * spacing_x;

    // Shear per rib
    const V_rib_x = (qx * Lx / 2) * spacing_y;
    const V_rib_y = (qy * Ly / 2) * spacing_x;

    // Load per unit length on each rib (kN/m) — used to reduce the support
    // shear to the critical section (d_eff from face of support, IS 456 Cl. 40.1.1).
    const w_rib_x = qx * spacing_y;   // kN/m on each X-parallel rib
    const w_rib_y = qy * spacing_x;   // kN/m on each Y-parallel rib

    // Design Rib as T-Beam
    const grade = `M${fck}` as ConcreteGrade;
    const designRib = (M: number, V: number, bf_m: number, w_rib: number) => {
        const bf = bf_m * 1000; // flange width in mm
        let Ast_req = 0;
        let NA_in_flange = true;

        // First assume NA in flange → rectangular design of width bf (via shared helper)
        const flexRect = flexuralDesignShared(M, bf, d, fck, fy);
        Ast_req = flexRect.Ast_req;

        // Check if NA is actually in flange
        const xu = (0.87 * fy * Ast_req) / (0.36 * fck * bf);
        NA_in_flange = xu <= Df;

        // BUG-WS1 FIX: if NA exits the flange, recompute Ast using the T-beam
        // stress block.  C = 0.36·fck·bw·xu + 0.45·fck·(bf−bw)·Df
        // Solve the quadratic for xu, then Ast = C / (0.87·fy).
        if (!NA_in_flange) {
            // Mu = 0.36·fck·bw·xu·(d − 0.42·xu) + 0.45·fck·(bf−bw)·Df·(d − Df/2)
            // Rearranged as a quadratic in xu:
            //   0.36·fck·bw·(d − 0.42·xu)·xu + 0.45·fck·(bf−bw)·Df·(d − Df/2) − Mu = 0
            //   −0.1512·fck·bw·xu² + 0.36·fck·bw·d·xu + [0.45·fck·(bf−bw)·Df·(d − Df/2) − Mu] = 0
            const Mu_Nmm = M * 1e6;
            const a = -0.1512 * fck * bw;
            const b_ = 0.36 * fck * bw * d;
            const c = 0.45 * fck * (bf - bw) * Df * (d - Df / 2) - Mu_Nmm;
            const disc = b_ * b_ - 4 * a * c;
            if (disc >= 0) {
                const xu_t = (-b_ + Math.sqrt(disc)) / (2 * a); // positive root
                const C = 0.36 * fck * bw * xu_t + 0.45 * fck * (bf - bw) * Df;
                Ast_req = C / (0.87 * fy);
            } else {
                Ast_req = NaN; // section fails
            }
        }

        // Min steel for rib (based on web width bw, per IS 456 Cl. 26.5.2.1)
        const p_min = getMinSteelRatio(fy);
        const Ast_min = p_min * bw * d;
        if (!Number.isNaN(Ast_req)) Ast_req = Math.max(Ast_req, Ast_min);

        // Shear check (per web width bw) — at the CRITICAL section.
        // Per IS 456 Cl. 40.1.1 the critical section is at distance d (effective
        // depth) from the face of the support. The support shear `V` is reduced
        // by the load over that distance (w_rib · d_eff) to give Vu_critical,
        // which governs the τv check.
        const d_eff = d;                                          // effective depth (mm)
        const a_critical = d_eff;                                 // distance from face (mm)
        const V_critical = Math.max(0, V - w_rib * (d_eff / 1000)); // kN
        const tau_v = (V_critical * 1000) / (bw * d_eff);        // N/mm² — at critical section
        const pt = Math.max(0.15, Math.min((Ast_req / (bw * d)) * 100, 3.0));
        const tau_c = getTauC(pt, grade);
        const tau_c_max = getTauCMax(grade);

        const shear_safe = tau_v <= tau_c;
        const needs_shear_reinforcement = tau_v > tau_c;
        const shear_over_max = tau_v > tau_c_max; // Table 20 limit

        return {
            Ast_req,
            Ast_min,
            V,
            V_critical,
            d_eff,
            a_critical,
            tau_v,
            tau_c,
            tau_c_max,
            shear_safe,
            needs_shear_reinforcement,
            shear_over_max,
            NA_in_flange
        };
    };

    const ribX = designRib(M_rib_x, V_rib_x, spacing_y, w_rib_x);
    const ribY = designRib(M_rib_y, V_rib_y, spacing_x, w_rib_y);

    // Topping Slab Design ─ BUG-WS1 FIX (2026-06-26 audit):
    // The topping spans continuously between rib top flanges and behaves as a
    // continuous one-way slab; per IS 456 Cl. 22.5 (continuous slab moment
    // coefficients) the topping needs reinforcement on BOTH faces:
    //   • Bottom (positive, mid-span):  M+ = wL\u00b2/16   (interior continuous strip)
    //   • Top    (negative, over rib):  M\u2212 = wL\u00b2/12   (over the rib support)
    // The earlier code computed only a single mat (wL\u00b2/10) and the optimizer
    // then double-counted it via a hand-rolled \u00d72 multiplier, which mis-stated
    // the actual steel mass. Both mats are now sized explicitly and the
    // optimizer simply sums them.
    const topping_span = Math.max(spacing_x, spacing_y) - (bw / 1000);
    const topping_M_pos = (wu * topping_span * topping_span) / 16; // bottom mat (mid-span +M)
    const topping_M_neg = (wu * topping_span * topping_span) / 12; // top mat (over rib \u2212M)
    const topping_d = Df - cover - 5; // using 8mm bar

    const calcAstTopping = (M_kNm: number): number => {
        const term = 1 - (4.6 * M_kNm * 1e6) / (fck * 1000 * topping_d * topping_d);
        const Ast = (0.5 * fck / fy) * (1 - Math.sqrt(Math.max(0, term))) * 1000 * topping_d;
        const Ast_min_half = getMinSteelRatio(fy) * 1000 * Df / 2;  // half min steel per face
        return Math.max(Ast, Ast_min_half);
    };
    const Ast_topping_bot = calcAstTopping(topping_M_pos);
    const Ast_topping_top = calcAstTopping(topping_M_neg);
    // Legacy single-mat alias retained for UI / report back-compat \u2014 reports
    // the larger of the two so the existing display still gives a meaningful
    // \u201cgoverning topping steel\u201d number.
    const Ast_topping = Math.max(Ast_topping_bot, Ast_topping_top);
    const Ast_topping_min = getMinSteelRatio(fy) * 1000 * Df;
    const topping_M = Math.max(topping_M_pos, topping_M_neg);  // legacy alias

    // ─── Deflection check (IS 456 Annex C — T-BEAM: combined rib + flange) ───
    // The deflection is computed on the COMBINED rib + topping as a T-beam
    // transformed section (per ACI 318 / StructurePoint waffle slab guide +
    // IS 456 Annex C). The rib reinforcement (Ast) directly controls I_cr
    // and I_eff, and therefore the deflection. This replaces the previous
    // per-meter strip approximation which lost the T-beam geometry.
    const govRib = ribX.Ast_req >= ribY.Ast_req ? ribX : ribY;
    const govSpan = Lx >= Ly ? Lx : Ly; // governing (longer) rib span
    const govSpacing = (govRib === ribX ? spacing_y : spacing_x) * 1000; // mm (flange width bf)
    // Rib reinforcement: use provided bars, or fall back to required Ast
    const ribBarDia = input.rib_bar_dia || 16;
    const ribNBars = input.rib_n_bars || 2;
    const Abar_rib = Math.PI * ribBarDia * ribBarDia / 4;
    const Ast_rib_provided = ribNBars * Abar_rib; // mm²
    const Ast_rib_defl = Number.isNaN(govRib.Ast_req) ? Ast_rib_provided : Math.max(Ast_rib_provided, govRib.Ast_req);
    // Rib TOP (compression face) bars — used in the Annex C deflection only.
    const ribTopBarDia = input.rib_top_bar_dia || 0;
    const ribTopNBars = input.rib_top_n_bars || 0;
    const Asc_rib_provided = (ribTopBarDia > 0 && ribTopNBars > 0)
        ? ribTopNBars * (Math.PI * ribTopBarDia * ribTopBarDia / 4)
        : 0;
    // Service moments on the governing rib (unfactored, per rib)
    const govM_rib = govRib === ribX ? M_rib_x : M_rib_y; // kN·m (factored, per rib)
    const M_service_rib = govM_rib / 1.5; // unfactor
    const M_perm_rib = M_service_rib * ((w_dead + w_finish) / (w_dead + w_live + w_finish || 1));
    const deflection: DeflectionResult = tBeamDeflection(
        {
            L: govSpan * 1000,     // span (mm)
            bf: govSpacing,        // flange width = rib spacing (mm)
            Df,                    // topping thickness (mm)
            bw,                    // rib width (mm)
            D,                     // overall depth (mm)
            cover,
            barDia: ribBarDia,
            Ast: Ast_rib_defl,     // provided rib BOTTOM (tension) steel (mm²)
            // Pass BOTH top and bottom rib reinforcement so the Annex C
            // formula uses both pt and pc terms (matches PI-EX-106A XLS).
            Asc: Asc_rib_provided, // provided rib TOP (compression) steel (mm²)
            barDia_top: ribTopBarDia,
            cover_top: cover,      // assume same cover on the top face
            fck, fy,
        },
        {
            M_service: M_service_rib,
            M_perm: M_perm_rib,
            supportCondition: deflSupport,
            camber: input.camber ?? 0,
        },
    );
    const deflection_safe = deflection.status_total === 'OK' && deflection.status_post === 'OK';
    // Legacy-field aliases for UI/PDF backwards-compat
    const Ld_actual = deflection.a_total;
    const Ld_max = deflection.limit_total;
    const mf = deflection.alpha;

    // ─── Span/Depth Ratio check — IS 456 Cl. 23.2 (informational) ──────────
    // Per the user's instruction: the simplified L/d check is computed for
    // waffle slabs too (on the governing rib, treated as a T-beam). It is
    // IGNORED for design purposes (Annex C T-beam deflection governs), but the
    // calculation is surfaced so the engineer can inspect basicRatio / mf / d_req.
    const ldCheck: SpanDepthCheckResult = computeSpanDepthCheck({
        L: govSpan * 1000,         // governing rib span (mm)
        D, cover, fy,
        barDia: ribBarDia,         // rib bottom (tension) bar
        AstProvided: Ast_rib_provided,
        AstRequired: Number.isNaN(govRib.Ast_req) ? Ast_rib_provided : govRib.Ast_req,
        b: bw,                     // rib web width (T-beam treated on the web)
        supportType: deflSupport,
    });

    const allAstFinite = !Number.isNaN(ribX.Ast_req) && !Number.isNaN(ribY.Ast_req);

    // ─── IS 456 Cl. 30.5 — Size and position of ribs (HARD code limits) ────
    // Quoting the code verbatim:
    //   'In-situ ribs shall be not less than 65 mm wide.
    //    They shall be spaced at centres not greater than 1.5 m apart and
    //    their depth, excluding any topping, shall be not more than four
    //    times their width.'
    // In addition, Cl. 30.3 / common practice limits the topping thickness to
    //   Df >= 50 mm  AND  Df >= clearRibSpacing / 12
    // because the topping spans one-way between the rib top flanges.
    const rib_bw_min = 65;                                   // mm  — Cl. 30.5
    const rib_cc_max = 1500;                                 // mm  — Cl. 30.5
    const rib_Dr_max = 4 * bw;                               // mm  — Cl. 30.5
    const Dr_actual  = D - Df;                               // mm  rib depth excl. topping
    const sx_mm = spacing_x * 1000;
    const sy_mm = spacing_y * 1000;
    const clearRibSpacing_mm = Math.max(sx_mm, sy_mm) - bw;
    const Df_min_geom = clearRibSpacing_mm / 12;             // mm
    const Df_min      = Math.max(50, Df_min_geom);

    const ribGeometryCheck = {
        bwOk:       bw >= rib_bw_min,
        spacingOk:  sx_mm <= rib_cc_max && sy_mm <= rib_cc_max,
        depthOk:    Dr_actual <= rib_Dr_max,
        toppingOk:  Df >= Df_min,
        bw, bw_min: rib_bw_min,
        spacing_x_mm: sx_mm, spacing_y_mm: sy_mm, spacing_cc_max: rib_cc_max,
        Dr: Dr_actual, Dr_max: rib_Dr_max,
        Df, Df_min, Df_min_geom: Math.round(Df_min_geom),
        messages: [] as string[],
    };
    if (!ribGeometryCheck.bwOk)
        ribGeometryCheck.messages.push(`Rib width ${bw}mm < 65mm (IS 456 Cl. 30.5)`);
    if (!ribGeometryCheck.spacingOk)
        ribGeometryCheck.messages.push(
            `Rib c/c spacing ${Math.max(sx_mm, sy_mm)}mm > 1500mm (IS 456 Cl. 30.5)`);
    if (!ribGeometryCheck.depthOk)
        ribGeometryCheck.messages.push(
            `Rib depth (D−Df)=${Dr_actual}mm > 4·bw=${rib_Dr_max}mm (IS 456 Cl. 30.5)`);
    if (!ribGeometryCheck.toppingOk)
        ribGeometryCheck.messages.push(
            `Topping ${Df}mm < required min ${Math.round(Df_min)}mm `
            + `(>= max(50, clearSpacing/12=${Math.round(Df_min_geom)})) `
            + `(IS 456 Cl. 30.3 / topping span between ribs)`);
    const ribGeometryOk = ribGeometryCheck.bwOk
        && ribGeometryCheck.spacingOk
        && ribGeometryCheck.depthOk
        && ribGeometryCheck.toppingOk;

    // ─── IS 456 Reinforcement detailing checks (Cl. 26.3.3 + 26.5) ──────────
    // For the topping slab (which IS a slab): max spacing ≤ 3d or 300mm, max bar dia ≤ Df/8.
    // For ribs (which are beams): spacing rules differ — max bar dia ≤ D/8 practical.
    // (topping_d already computed above for the topping Ast calc — reuse it)
    const maxBarDiaTopping = Df / 8;
    const maxSpacingTopping = Math.min(3 * topping_d, 300);
    // Max Ast for topping: largest standard bar ≤ Df/8 at min practical spacing
    const topDias = [8, 10, 12, 16].filter(d => d <= maxBarDiaTopping);
    const topLargest = topDias.length > 0 ? topDias[topDias.length - 1] : 8;
    const Abar_top = Math.PI * topLargest * topLargest / 4;
    const maxAstTopping = Abar_top * (1000 / 75);  // 75mm min spacing
    const maxBarDiaRib = D / 8;
    const barChecks = {
        topping: {
            maxBarDia: Math.floor(maxBarDiaTopping),
            maxSpacing: Math.floor(maxSpacingTopping),
            maxAstPerM: Math.round(maxAstTopping),
            astFeasible: Ast_topping <= maxAstTopping,
        },
        rib: {
            maxBarDia: Math.floor(maxBarDiaRib),
        },
    };

    const overallStatus: 'SAFE' | 'REVISE' =
        (ribGeometryOk && !ribX.shear_over_max && !ribY.shear_over_max &&
            allAstFinite && deflection_safe && barChecks.topping.astFeasible) ? 'SAFE' : 'REVISE';

    return {
        w_dead,
        wu,
        qx, qy,
        Mx_per_m, My_per_m,
        M_rib_x, M_rib_y,
        V_rib_x, V_rib_y,
        ribX,
        ribY,
        topping_M,
        topping_M_pos,
        topping_M_neg,
        Ast_topping,
        Ast_topping_bot,
        Ast_topping_top,
        Ast_topping_min,
        topping_span,
        // Rib reinforcement actually used in the deflection check (surfaced
        // for UI + report so the user sees both top and bottom contributions).
        Ast_rib_provided,
        Asc_rib_provided,
        // deflection (Annex C)
        deflection,
        deflection_safe,
        Ld_actual,  // = a_total (mm) for UI compat
        Ld_max,     // = limit_total (mm) for UI compat
        mf,         // = alpha (continuous = 1/16)
        // Span/Depth ratio check (IS 456 Cl. 23.2) — informational, IGNORED for
        // design (Annex C governs). Surfaced for all slabs per user request.
        ldCheck,
        // feasibility
        allAstFinite,
        overallStatus,
        // IS 456 code checks
        ribGeometryCheck,  // Cl. 30.5 (bw >= 65 mm, c/c <= 1500 mm, Dr <= 4bw) + topping >= max(50, clearSpacing/12)
        barChecks,
        deflectionSupport: deflSupport,
    };
}

// ═══════════════════════════════════════════════════════════════
//  WAFFLE SLAB OPTIMIZER — minimize steel + concrete while
//  controlling deflection (per-rib L/d), shear, and flexure.
//
//  Optimizes FOUR variables:
//    • Overall depth D        (→ rib depth Dr = D − Df)
//    • Topping thickness Df
//    • Rib width bw
//    • Rib spacing (sx = sy for a square grid, or independent)
//
//  For each combination, runs analyzeWaffleSlab and keeps only SAFE
//  designs. Ranks by a cost index = concrete volume + steel weight ×
//  ratio (matching the slab/footing optimizer convention).
//
//  To keep the search tractable, the sweep is capped at MAX_TRIALS
//  (default 2000); beyond that a greedy sequential fallback is used.
// ═══════════════════════════════════════════════════════════════

export interface WaffleSlabOptimizeParams {
    minD?: number; maxD?: number; stepD?: number;            // overall depth (mm)
    minDf?: number; maxDf?: number; stepDf?: number;         // topping thickness (mm)
    minBw?: number; maxBw?: number; stepBw?: number;         // rib width (mm)
    minSpacing?: number; maxSpacing?: number; stepSpacing?: number;  // rib spacing (m) — applied to both sx, sy
    ribBarDias?: number[];   // rib tension bar diameters to try (mm)
    ribNBars?: number[];     // number of tension bars per rib to try
    ribTopBarDias?: number[];
    ribTopNBars?: number[];
}

export function suggestWaffleThicknessRange(input: WaffleSlabInput): number[] {
    const { Lx, fy = 500 } = input;
    const basicRatio = 26; // continuous
    const mf_est = fy >= 500 ? 1.20 : 1.40;
    const d_min = (Lx * 1000) / (basicRatio * mf_est);
    const D_min = Math.ceil((d_min + 30) / 10) * 10;
    // BUG-S-02 FIX (2026-06-26 audit): widen the suggested range so waffle
    // optimization can reach deflection-controlled depths for longer spans.
    const range: number[] = [];
    for (let d = D_min; d <= D_min + 250; d += 25) range.push(d);
    return range;
}

export interface OptimumWaffleSlabDesign {
    D: number;
    Df: number;
    bw: number;
    spacing: number;
    ribDepth: number;     // Dr = D − Df
    rib_bar_dia: number;  // rib BOTTOM (tension) bar diameter (mm)
    rib_n_bars: number;   // number of BOTTOM (tension) bars per rib
    rib_top_bar_dia: number; // rib TOP (compression) bar diameter (mm)
    rib_top_n_bars: number;  // number of TOP (compression) bars per rib
    camber:             number;
    costTotal_INR:      number;
    costBreakdown: {
        concrete_INR:   number;
        steel_INR:      number;
        formwork_INR:   number;
    };
    steelWeight_gross:  number;
    concreteVol:        number;
    utilizationRatio: {
        flexure:        number;
        deflection:     number;
        shear:          number;
    };
    result: ReturnType<typeof analyzeWaffleSlab>;
}

export interface WaffleSlabOptimizeResult {
    totalTrials: number;
    feasibleCount: number;
    topDesigns: OptimumWaffleSlabDesign[];
    optimum: OptimumWaffleSlabDesign | null;
    paretoFront: OptimumWaffleSlabDesign[];
    costParams: CostParameters;
    fallback: boolean;    // true if greedy fallback was used
}

export type WaffleSlabProgressCallback = (done: number, total: number, feasible: number) => void;

const WAFFLE_MAX_TRIALS = 2000;

export function optimizeWaffleSlab(
    input: WaffleSlabInput,
    params: WaffleSlabOptimizeParams,
    costRatio: number = 90,
    onProgress?: WaffleSlabProgressCallback,
): WaffleSlabOptimizeResult {
    const results: OptimumWaffleSlabDesign[] = [];

    const costParams: CostParameters = input.costParams ?? { steelCost_per_kg: costRatio, concreteCost_per_m3: 6500 };

    // Build sweep lists
    let Ds: number[] = [];
    if (params.minD !== undefined && params.maxD !== undefined && params.stepD !== undefined) {
        for (let v = params.minD; v <= params.maxD + 1e-6; v += params.stepD) Ds.push(Math.round(v));
    } else { Ds = suggestWaffleThicknessRange(input); }
    const Dfs = params.minDf ? [params.minDf] : [50, 75, 100];
    const Bws = params.minBw ? [params.minBw] : [100, 125, 150];
    const Spcs = params.minSpacing ? [params.minSpacing] : [0.6, 0.9, 1.2];
    if (params.maxDf && params.stepDf && params.minDf) { Dfs.length=0; for(let v=params.minDf; v<=params.maxDf+1e-6; v+=params.stepDf) Dfs.push(Math.round(v)); }
    if (params.maxBw && params.stepBw && params.minBw) { Bws.length=0; for(let v=params.minBw; v<=params.maxBw+1e-6; v+=params.stepBw) Bws.push(Math.round(v)); }
    if (params.maxSpacing && params.stepSpacing && params.minSpacing) { Spcs.length=0; for(let v=params.minSpacing; v<=params.maxSpacing+1e-6; v+=params.stepSpacing) Spcs.push(Math.round(v*100)/100); }

    const ribBarDias = params.ribBarDias ?? [12, 16, 20, 25];
    const ribNBars = params.ribNBars ?? [2, 3, 4];
    // BUG-WS-03 FIX (2026-06-26 audit): the user explicitly requested that top
    // and bottom rib reinforcement should BOTH be optimization variables. The
    // legacy implementation only swept the bottom (tension) bars. Top bars are
    // now an explicit sweep dimension; the default `[0]` for the count keeps
    // existing behaviour (no compression bars), but callers can pass e.g.
    // `ribTopNBars: [0, 2]` to let the optimizer decide whether to add them.
    const ribTopBarDias = params.ribTopBarDias ?? [12, 16];
    const ribTopNBars = params.ribTopNBars ?? [0];

    const fullTotal = Ds.length * Dfs.length * Bws.length * Spcs.length
        * ribBarDias.length * ribNBars.length
        * ribTopBarDias.length * ribTopNBars.length;

    // Decide: full enumeration or greedy fallback
    const useFull = fullTotal <= WAFFLE_MAX_TRIALS;
    let done = 0;
    let total: number;

    const evaluate = (
        D: number, Df: number, bw: number, spacing: number,
        rib_bar_dia: number, rib_n_bars: number,
        rib_top_bar_dia: number, rib_top_n_bars: number,
    ): OptimumWaffleSlabDesign | null => {
        try {
            // Df must be < D (rib needs positive depth)
            if (Df >= D) return null;
            // ─── IS 456 Cl. 30.5 hard pre-filter (skip cheap infeasibles) ───
            // Cuts the search space by rejecting combos that violate the
            // ribbed-slab geometry limits before the heavy analysis runs.
            const spacing_mm = spacing * 1000;
            if (bw < 65) return null;                       // Cl. 30.5: bw >= 65 mm
            if (spacing_mm > 1500) return null;             // Cl. 30.5: c/c <= 1500 mm
            if ((D - Df) > 4 * bw) return null;             // Cl. 30.5: Dr <= 4 bw
            const clearSpacing_mm = spacing_mm - bw;
            const Df_min_local = Math.max(50, clearSpacing_mm / 12);
            if (Df < Df_min_local) return null;             // topping min thickness
            const trialInput: WaffleSlabInput = {
                ...input, D, Df, bw,
                spacing_x: spacing, spacing_y: spacing,
                rib_bar_dia, rib_n_bars,
                rib_top_bar_dia, rib_top_n_bars,
                camber: input.camber ?? 0,
            };
            let result = analyzeWaffleSlab(trialInput);

            if (result.overallStatus !== 'SAFE'
                && result.allAstFinite && result.barChecks.topping.astFeasible
                && !result.deflection_safe) {
                const reqCamber = getRequiredDeflectionCamber(result.deflection, 5);
                if (reqCamber > 0 && reqCamber <= 20) {
                    const withCamber = analyzeWaffleSlab({ ...trialInput, camber: reqCamber });
                    if (withCamber.overallStatus === 'SAFE') {
                        result = withCamber;
                    }
                }
            }

            if (result.overallStatus !== 'SAFE') return null;

            // Concrete volume (solid + ribs) per panel
            const cellArea = spacing * spacing;
            const voidVol = (spacing - bw / 1000) * (spacing - bw / 1000) * ((D - Df) / 1000);
            const solidVol = cellArea * (D / 1000) - voidVol;
            const concreteVol = solidVol * (input.Lx * input.Ly) / cellArea;

            // Steel weight: rib Ast × rib length × n_ribs + topping Ast × area
            // Use the PROVIDED rib steel (rib_bar_dia × rib_n_bars), not required
            const Abar_rib = Math.PI * rib_bar_dia * rib_bar_dia / 4;
            const Ast_rib_prov = rib_n_bars * Abar_rib;
            const nRibsX = Math.ceil(input.Ly / spacing);
            const nRibsY = Math.ceil(input.Lx / spacing);
            
            // BUG-WS-04 FIX (2026-06-26 audit): the earlier code applied a flat
            // ×2 to result.Ast_topping to mock a two-mat layout while only ONE
            // mat was actually designed. With the engine now sizing both the
            // bottom (positive) and top (negative) topping mats explicitly, sum
            // the two areas directly. Rib top compression bars (when supplied)
            // are included alongside the rib tension steel.
            const LAP_WASTAGE_FACTOR = 1.08;
            // Rib steel: bottom (tension) + top (compression, if any) along
            // every rib in both directions.
            const Abar_rib_top = result.Asc_rib_provided; // already mm² per rib
            const ribSteel_net = (
                (Ast_rib_prov + Abar_rib_top) * input.Lx * nRibsX +
                (Ast_rib_prov + Abar_rib_top) * input.Ly * nRibsY
            ) / 1e6 * 7850;
            const Ast_topping_total = (result.Ast_topping_bot + result.Ast_topping_top); // mm²/m, both mats
            const toppingSteel_net = Ast_topping_total / 1e6 * (input.Lx * input.Ly) * 7850;
            const steelWeight_net = ribSteel_net + toppingSteel_net;
            const steelWeight_gross = steelWeight_net * LAP_WASTAGE_FACTOR;
            const slabArea_m2 = input.Lx * input.Ly;

            const costTotal_INR = computeCost(concreteVol, steelWeight_gross, slabArea_m2, costParams);
            const concrete_INR = concreteVol * (costParams.concreteCost_per_m3 ?? 6500);
            const steel_INR = steelWeight_gross * (costParams.steelCost_per_kg ?? 82) * (costParams.wastage_factor ?? 1.07);
            const formwork_INR = slabArea_m2 * (costParams.formworkCost_per_m2 ?? 350);

            const flexure_u = Math.max(
                result.ribX.Ast_req / result.Ast_rib_provided,
                result.ribY.Ast_req / result.Ast_rib_provided
            );
            const deflection_u = result.deflection.a_total / result.deflection.limit_total;
            const shear_u = Math.max(result.ribX.tau_v / result.ribX.tau_c, result.ribY.tau_v / result.ribY.tau_c);

            return {
                D, Df, bw, spacing, ribDepth: D - Df, rib_bar_dia, rib_n_bars,
                rib_top_bar_dia, rib_top_n_bars,
                camber: result.deflection.camber ?? 0,
                costTotal_INR,
                costBreakdown: { concrete_INR, steel_INR, formwork_INR },
                steelWeight_gross, concreteVol,
                utilizationRatio: { flexure: flexure_u, deflection: deflection_u, shear: shear_u },
                result
            };
        } catch {
            return null;
        }
    };

    if (useFull) {
        // Full enumeration over all 8 variables
        total = fullTotal;
        for (const D of Ds) {
            for (const Df of Dfs) {
                for (const bw of Bws) {
                    for (const sp of Spcs) {
                        for (const rbd of ribBarDias) {
                            for (const rnb of ribNBars) {
                                for (const rtd of ribTopBarDias) {
                                    for (const rtn of ribTopNBars) {
                                        done++;
                                        const design = evaluate(D, Df, bw, sp, rbd, rnb, rtd, rtn);
                                        if (design) results.push(design);
                                        if (onProgress && (done % 50 === 0 || done === total)) {
                                            onProgress(done, total, results.length);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    } else {
        // Greedy sequential fallback over all 8 variables
        total = (Ds.length + Dfs.length + Bws.length + Spcs.length
            + ribBarDias.length + ribNBars.length
            + ribTopBarDias.length + ribTopNBars.length) * 3;
        let bestD = Ds[Math.floor(Ds.length / 2)];
        let bestDf = Dfs[Math.floor(Dfs.length / 2)];
        let bestBw = Bws[Math.floor(Bws.length / 2)];
        let bestSp = Spcs[Math.floor(Spcs.length / 2)];
        let bestRbd = ribBarDias[Math.floor(ribBarDias.length / 2)];
        let bestRnb = ribNBars[Math.floor(ribNBars.length / 2)];
        let bestRtd = ribTopBarDias[Math.floor(ribTopBarDias.length / 2)];
        let bestRtn = ribTopNBars[Math.floor(ribTopNBars.length / 2)];
        let bestCost = Infinity;

        for (let pass = 0; pass < 3; pass++) {
            for (const D of Ds)         { done++; const d = evaluate(D, bestDf, bestBw, bestSp, bestRbd, bestRnb, bestRtd, bestRtn); if (d && d.costTotal_INR < bestCost) { bestCost = d.costTotal_INR; bestD = D; } }
            for (const Df of Dfs)       { done++; const d = evaluate(bestD, Df, bestBw, bestSp, bestRbd, bestRnb, bestRtd, bestRtn); if (d && d.costTotal_INR < bestCost) { bestCost = d.costTotal_INR; bestDf = Df; } }
            for (const bw of Bws)       { done++; const d = evaluate(bestD, bestDf, bw, bestSp, bestRbd, bestRnb, bestRtd, bestRtn); if (d && d.costTotal_INR < bestCost) { bestCost = d.costTotal_INR; bestBw = bw; } }
            for (const sp of Spcs)      { done++; const d = evaluate(bestD, bestDf, bestBw, sp, bestRbd, bestRnb, bestRtd, bestRtn); if (d && d.costTotal_INR < bestCost) { bestCost = d.costTotal_INR; bestSp = sp; } }
            for (const rbd of ribBarDias){ done++; const d = evaluate(bestD, bestDf, bestBw, bestSp, rbd, bestRnb, bestRtd, bestRtn); if (d && d.costTotal_INR < bestCost) { bestCost = d.costTotal_INR; bestRbd = rbd; } }
            for (const rnb of ribNBars) { done++; const d = evaluate(bestD, bestDf, bestBw, bestSp, bestRbd, rnb, bestRtd, bestRtn); if (d && d.costTotal_INR < bestCost) { bestCost = d.costTotal_INR; bestRnb = rnb; } }
            for (const rtd of ribTopBarDias){ done++; const d = evaluate(bestD, bestDf, bestBw, bestSp, bestRbd, bestRnb, rtd, bestRtn); if (d && d.costTotal_INR < bestCost) { bestCost = d.costTotal_INR; bestRtd = rtd; } }
            for (const rtn of ribTopNBars){ done++; const d = evaluate(bestD, bestDf, bestBw, bestSp, bestRbd, bestRnb, bestRtd, rtn); if (d && d.costTotal_INR < bestCost) { bestCost = d.costTotal_INR; bestRtn = rtn; } }
            if (onProgress) onProgress(Math.min(done, total), total, results.length);
        }
        const finalDesign = evaluate(bestD, bestDf, bestBw, bestSp, bestRbd, bestRnb, bestRtd, bestRtn);
        if (finalDesign) results.push(finalDesign);
    }

    results.sort((a, b) => a.costTotal_INR - b.costTotal_INR);

    const paretoFront: OptimumWaffleSlabDesign[] = [];
    let minDeflection = Infinity;
    for (const r of results) {
        if (r.utilizationRatio.deflection < minDeflection) {
            paretoFront.push(r);
            minDeflection = r.utilizationRatio.deflection;
        }
    }

    return {
        totalTrials: useFull ? total : done,
        feasibleCount: results.length,
        topDesigns: results.slice(0, 5),
        optimum: results.length > 0 ? results[0] : null,
        paretoFront,
        costParams,
        fallback: !useFull,
    };
}
