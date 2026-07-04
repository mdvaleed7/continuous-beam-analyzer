/**
 * cantileverSlabEngine.ts — IS 456:2000 Cantilever Slab Design
 *
 * ponytail (this pass):
 *  • BUG-CS1 fix: clamp pt to [0.15, 3.0] BEFORE computing β for τc (IS 456
 *    Table 19 only applies in that range — previously β used the unclamped
 *    pt_provided, giving a wrong τc for over-reinforced sections).
 *  • Dead-code removal: the duplicate τc computation (lines 67 & 73 in the
 *    previous version — the second overwrote the first) is gone.
 *  • DRY: Ast and τc now call the shared `flexuralDesign` / `getTauC` from
 *    ../lib/is456 instead of re-implementing the `4.6` formula a third time.
 *  • The mislabeled `tau_c` return field (which was actually k·τc, the
 *    depth-enhanced allowable — NOT Table 20's τc,max) is kept under the same
 *    name for UI compatibility, but is now computed correctly.
 */
import {
    flexuralDesign as flexuralDesignShared,
    getTauC,
    getMinSteelRatio,
    annexCDeflection,
    getRequiredDeflectionCamber,
    computeSpanDepthCheck,
    computeCost,
    type ConcreteGrade,
    type CostParameters,
    type DeflectionResult,
    type SpanDepthCheckResult,
} from '../lib/is456';

export interface CantileverSlabInput {
    L: number; // Clear Span in m
    D: number; // Overall depth in mm
    cover: number; // clear cover in mm
    fck: number;
    fy: number;
    grade?: string;      // e.g. 'M25' (optional, for UI dropdown sync)
    steelGrade?: string; // e.g. 'Fe500' (optional, for UI dropdown sync)
    w_live: number; // kN/m2
    w_finish: number; // kN/m2
    // Top (tension face) reinforcement — the main hogging steel.
    bar_main: number; // Top main bar diameter mm
    spacing_main: number; // Top main bar spacing mm
    bar_dist: number; // Top distribution bar diameter mm
    spacing_dist: number; // Top distribution bar spacing mm
    // Bottom (compression face) reinforcement — contributes to the deflection
    // calculation per IS 456 Annex C (pc term). Optional; defaults to no
    // compression steel for back-compat with legacy inputs.
    bar_bot?: number;     // Bottom bar diameter (mm)
    spacing_bot?: number; // Bottom bar spacing (mm)
    cover_bot?: number;   // Clear cover on the bottom (compression) face (mm); defaults to `cover`
    camber?: number; // explicit upward camber (mm), used by optimizer
    
    // Optional parapet / railing line load at the free end
    parapetHeight?: number;    // m
    parapetThickness?: number; // mm
    parapetDensity?: number;   // kN/m3 (typically 20 for masonry)
    costParams?: CostParameters; // AUDIT FIX OPT-3: optional cost overrides
}

export function analyzeCantileverSlab(input: CantileverSlabInput) {
    const {
        L, D, cover, fck, fy, w_live, w_finish,
        bar_main, spacing_main, bar_dist, spacing_dist,
        bar_bot, spacing_bot, cover_bot,
        parapetHeight = 0, parapetThickness = 0, parapetDensity = 20,
    } = input;

    // Effective depth (measured from compression face down to tension steel
    // — in a cantilever, tension is on top so d = D − top_cover − bar_main/2)
    const d = D - cover - (bar_main / 2);

    // Loads
    const w_dead = D / 1000 * 25; // Self weight in kN/m2
    const w_total = w_dead + w_live + w_finish;
    const wu = 1.5 * w_total;

    // Parapet Point Load at free end (Line load P in kN/m width)
    const P_parapet = parapetHeight * (parapetThickness / 1000) * parapetDensity;
    const Pu_parapet = 1.5 * P_parapet;

    // Effective span: clear span + d/2 or clear span + support_width/2
    // IS 456 Cl 22.2: Cantilever effective span = clear span + d/2
    const L_eff = L + (d / 1000 / 2);

    // Bending moment and shear force (cantilever)
    // Mu = wu * L_eff^2 / 2 + Pu_parapet * L_eff
    const Mu = (wu * Math.pow(L_eff, 2)) / 2 + Pu_parapet * L_eff; // kN.m
    const Vu = wu * L_eff + Pu_parapet; // kN

    // Ast required — via shared IS 456 flexural design (Cl. 38.1)
    const b = 1000;
    const flex = flexuralDesignShared(Mu, b, d, fck, fy, D);
    let Ast_req = flex.Ast_req;
    const Ast_min = flex.Ast_min ?? 0;
    Ast_req = Math.max(Ast_req, Ast_min);

    // Main steel provided (top — tension)
    const a_st_main = (Math.PI / 4) * Math.pow(bar_main, 2);
    const Ast_provided = (1000 / spacing_main) * a_st_main;
    const pt_provided = (Ast_provided / (b * d)) * 100;

    // Distribution steel required = min steel
    const Ast_dist_req = Ast_min;
    const a_st_dist = (Math.PI / 4) * Math.pow(bar_dist, 2);
    const Ast_dist_provided = (1000 / spacing_dist) * a_st_dist;

    // Bottom (compression face) steel provided — used in the Annex C deflection
    // calculation. A cantilever slab typically has a bottom mat for crack
    // control / detailing; including it reduces the predicted deflection.
    const Asc_provided = (bar_bot && spacing_bot && bar_bot > 0 && spacing_bot > 0)
        ? ((Math.PI / 4) * Math.pow(bar_bot, 2)) * (1000 / spacing_bot)
        : 0;
    const pc_provided = (Asc_provided / (b * d)) * 100;

    // Shear Check — IS 456 Cl. 40
    //
    // Per IS 456 Cl. 40.1.1, the critical section for shear in a slab/beam is
    // at a distance d (effective depth) from the FACE of the support. The shear
    // at that section = (shear at the support) − (load between the support face
    // and the critical section). For a cantilever carrying a UDL wu, that is:
    //     Vu_critical = Vu_support − wu · d_eff
    // `Vu` (support) is retained for the BM/Shear summary; `Vu_critical` governs
    // the τv stress check.
    const d_eff = d;                                   // effective depth (mm)
    const a_critical = d_eff;                          // distance of critical section from face (mm)
    const Vu_critical = Math.max(0, Vu - wu * (d_eff / 1000));  // kN (per m width)
    const tau_v = (Vu_critical * 1000) / (b * d_eff);  // N/mm² — at critical section
    // BUG-CS1 FIX: clamp pt to the Table 19 domain [0.15, 3.0] BEFORE computing
    // the τc formula. The shared getTauC helper already does this clamping
    // internally, so calling it directly is both correct and DRY.
    const grade = `M${fck}` as ConcreteGrade;
    const tau_c_base = getTauC(pt_provided, grade);

    // Depth factor k (IS 456 Cl. 40.2.1.1 — enhancement for thin slabs)
    let k: number;
    if (D <= 150) k = 1.30;
    else if (D <= 300) k = 1.30 - ((D - 150) / 50) * 0.10; // linear 1.30→1.00 over 150–300
    else k = 1.00;

    const tau_c_allowable = k * tau_c_base; // depth-enhanced allowable
    const shear_safe = tau_v <= tau_c_allowable;

    // Deflection Check — IS 456 Annex C (short-term + shrinkage + creep).
    // Per the user's instruction: the simplified L/d = 7 span/depth check is NOT
    // used for cantilever slabs; instead the full Annex C deflection calculation governs.
    // Cantilever support condition → alpha = 1/4, k3 = 0.5.
    const w_service_total = w_dead + w_live + w_finish;   // kN/m² (per m width)
    const w_perm = w_dead + w_finish;                      // permanent (dead) load
    const M_service = (w_service_total * Math.pow(L_eff, 2)) / 2 + P_parapet * L_eff;  // kN·m/m
    const M_perm = (w_perm * Math.pow(L_eff, 2)) / 2 + P_parapet * L_eff;              // kN·m/m
    // Pass BOTH top (tension) and bottom (compression) provided reinforcement
    // to the IS 456 Annex C routine. The `annexCDeflection` formula uses the
    // generic names (x_bot / x_top) but is geometrically symmetric — we map:
    //   barDia_x_bot / Ast_x_bot   → TOP main steel (the tension steel for a cantilever)
    //   Asc_x_top + barDia_comp    → BOTTOM mat (the compression steel)
    // d' is supplied via the explicit barDia_comp / cover_comp fields so the
    // compression-face geometry is honoured exactly (matches PI-EX-106A XLS).
    const deflection: DeflectionResult = annexCDeflection(
        { Lx: L_eff * 1000, D, cover, fck, fy },
        {
            barDia_x_bot: bar_main,
            Ast_x_bot: Ast_provided,
            Asc_x_top: Asc_provided,                   // bottom mat = compression steel for cantilever
            barDia_comp: bar_bot,                      // bottom bar dia (for d')
            cover_comp: cover_bot ?? cover,            // bottom cover
            M_service,
            M_perm,
            supportCondition: 'cantilever',
            camber: input.camber ?? 0,
        },
    );
    // User instruction: evaluate both total and post-construction checks.
    const defl_safe = deflection.status_total === 'OK' && deflection.status_post === 'OK';
    // Keep legacy fields for UI/PDF backwards-compat (mapped from Annex C result)
    const Ld_actual = deflection.a_total;
    const Ld_max = deflection.limit_total;
    const mod_factor = deflection.alpha;

    // ─── Span/Depth Ratio check — IS 456 Cl. 23.2 (informational) ──────────
    // Per the user's instruction: the simplified L/d = 7 check is now computed
    // for cantilever slabs "just as it is in the normal slab case". It is
    // IGNORED for design purposes (Annex C governs), but the calculation is
    // surfaced so the engineer can inspect basicRatio / mf / d_req.
    const ldCheck: SpanDepthCheckResult = computeSpanDepthCheck({
        L: L_eff * 1000,          // effective span (mm)
        D, cover, fy,
        barDia: bar_main,         // top (tension) main bar
        AstProvided: Ast_provided,
        AstRequired: Ast_req,
        supportType: 'cantilever',
    });

    // Overall feasibility for the optimizer: flexure (provided ≥ required),
    // shear (τv ≤ k·τc), and Annex C deflection all OK.
    const flexure_safe = Ast_provided >= Ast_req && !Number.isNaN(Ast_req);

    // ─── IS 456 Reinforcement detailing checks (Cl. 26.3.3 + 26.5) ──────────
    // Max main bar spacing ≤ 3d or 300mm (whichever less) — Cl. 26.3.3
    // Max distribution bar spacing ≤ 5d or 450mm — Cl. 26.3.3
    // Max bar diameter ≤ D/8 (practical slab limit)
    const maxBarDia = D / 8;
    const maxSpacingMain = Math.min(3 * d, 300);
    const maxSpacingDist = Math.min(5 * d, 450);
    const barChecks = {
        maxBarDia: Math.floor(maxBarDia),
        maxSpacingMain: Math.floor(maxSpacingMain),
        maxSpacingDist: Math.floor(maxSpacingDist),
        barDiaOK: bar_main <= maxBarDia,
        spacingMainOK: spacing_main <= maxSpacingMain,
        spacingDistOK: spacing_dist <= maxSpacingDist,
    };

    const overallStatus: 'SAFE' | 'REVISE' =
        (flexure_safe && shear_safe && defl_safe &&
            barChecks.barDiaOK && barChecks.spacingMainOK && barChecks.spacingDistOK) ? 'SAFE' : 'REVISE';

    return {
        L_eff,
        d,
        w_dead,
        w_total,
        P_parapet,
        Pu_parapet,
        wu,
        Mu,
        Vu,
        Ast_req,
        Ast_min,
        Ast_provided,
        pt_provided,
        Ast_dist_req,
        Ast_dist_provided,
        tau_v,
        tau_c: tau_c_allowable, // depth-enhanced allowable (k·τc) — preserved name for UI compat
        shear_safe,
        flexure_safe,
        // Shear at the critical section (distance d_eff from face of support)
        // — IS 456 Cl. 40.1.1. `Vu` (above) is the support shear; `Vu_critical`
        // governs the τv check and is surfaced for the UI / report.
        d_eff,
        a_critical,
        Vu_critical,
        // Bottom (compression face) steel for deflection — surfaced for the UI
        // and the report so the user can see what was used.
        Asc_provided,
        pc_provided,
        // Deflection (Annex C) — replaced the legacy L/d=7 check
        deflection,
        defl_safe,
        Ld_actual,  // now = a_total (mm) for UI compat
        Ld_max,     // now = limit_total (mm) for UI compat
        mod_factor, // now = alpha (cantilever = 1/4)
        M_service,
        M_perm,
        // Span/Depth ratio check (IS 456 Cl. 23.2) — informational, IGNORED for
        // design (Annex C governs). Surfaced for all slabs per user request.
        ldCheck,
        overallStatus,
        // IS 456 code checks
        barChecks,
    };
}

// ═══════════════════════════════════════════════════════════════
//  CANTILEVER SLAB OPTIMIZER — minimize steel + concrete cost
//  while controlling flexure, shear, and Annex C deflection.
//
//  Sweeps THREE variables:
//    • Slab depth D
//    • Main bar diameter (bar_main)
//    • Main bar spacing (spacing_main)
//  For each combination, runs analyzeCantileverSlab and keeps only
//  SAFE designs. Ranks by a cost index = concrete volume + steel
//  weight × ratio. The optimum is applied back to the inputs (D,
//  bar_main, spacing_main) so the user sees the optimized design.
// ═══════════════════════════════════════════════════════════════

export interface CantileverSlabOptimizeParams {
    minD: number; maxD: number; stepD: number;          // slab depth sweep (mm)
    barDias?: number[];                                  // TOP (tension) bar diameters to try (mm)
    spacings?: number[];                                 // TOP (tension) bar spacings to try (mm)
    // BUG-CS-OPT-02 FIX (2026-06-26 audit): the bottom (compression-face) mat
    // contributes to the Annex C deflection (Asc/pc term) and the user
    // explicitly listed it as an optimization variable. Defaults below keep
    // the legacy behaviour of "no bottom mat" available via the `[0]` entry.
    bottomBarDias?: number[];                            // BOTTOM (compression) bar diameters (mm); 0 = none
    bottomSpacings?: number[];                           // BOTTOM (compression) bar spacings (mm)
}

interface OptimumCantileverSlabDesign {
    D: number;
    bar_main: number;
    spacing_main: number;
    bar_bot: number;       // BOTTOM (compression) bar diameter (mm); 0 = none
    spacing_bot: number;   // BOTTOM (compression) bar spacing (mm)
    camber: number;        // upward camber applied (mm)
    concreteVol: number;   // m³ per meter width
    steelWeight: number;   // kg per meter width
    costTotal_INR: number; // AUDIT FIX OPT-3 (2026-07-04): was `costIndex` (m³-equivalent), now proper INR
    costBreakdown: {
        concrete_INR: number;
        steel_INR: number;
        formwork_INR: number;
    };
    result: ReturnType<typeof analyzeCantileverSlab>;
}

export interface CantileverSlabOptimizeResult {
    totalTrials: number;
    feasibleCount: number;
    topDesigns: OptimumCantileverSlabDesign[];
    optimum: OptimumCantileverSlabDesign | null;
    costParams: CostParameters;   // AUDIT FIX OPT-3: was `costRatioUsed`, now full costParams
}

export type CantileverSlabProgressCallback = (done: number, total: number, feasible: number) => void;

export function optimizeCantileverSlab(
    input: CantileverSlabInput,
    params: CantileverSlabOptimizeParams,
    costRatio: number = 90,
    onProgress?: CantileverSlabProgressCallback,
): CantileverSlabOptimizeResult {
    // AUDIT FIX OPT-3 (2026-07-04): the previous `costIndex` returned a
    // dimensionless "concrete-equivalent volume" (`concreteVol + steelWeight *
    // (costRatio / 7850)`), inconsistent with the slab/flat-slab/waffle-slab
    // optimizers which return `costTotal_INR` in INR. The fix uses the shared
    // `computeCost` helper to return proper INR, including formwork. The caller
    // can override any cost parameter via `input.costParams`.
    const costParams: CostParameters = input.costParams ?? {
        steelCost_per_kg: costRatio,
        concreteCost_per_m3: 6500,
        formworkCost_per_m2: 350,
        wastage_factor: 1.07,
    };
    const results: OptimumCantileverSlabDesign[] = [];

    const Ds: number[] = [];
    for (let d = params.minD; d <= params.maxD + 1e-6; d += params.stepD) Ds.push(Math.round(d));
    const barDias = params.barDias ?? [8, 10, 12, 16, 20];
    const spacings = params.spacings ?? [100, 125, 150, 175, 200, 250];
    // BUG-CS-OPT-02 FIX: bottom (compression) mat sweep. `0` means "no bottom mat".
    const bottomBarDias = params.bottomBarDias ?? [0, 8, 10];
    const bottomSpacings = params.bottomSpacings ?? [150, 200, 250];

    const total = Ds.length * barDias.length * spacings.length
        * bottomBarDias.length * bottomSpacings.length;
    let done = 0;

    for (const D of Ds) {
        for (const bar_main of barDias) {
            for (const spacing_main of spacings) {
                for (const bar_bot of bottomBarDias) {
                    for (const spacing_bot of bottomSpacings) {
                        done++;
                        try {
                            const trialInput: CantileverSlabInput = {
                                ...input, D, bar_main, spacing_main,
                                bar_bot: bar_bot > 0 ? bar_bot : undefined,
                                spacing_bot: bar_bot > 0 ? spacing_bot : undefined,
                                camber: input.camber ?? 0,
                            };
                            let result = analyzeCantileverSlab(trialInput);

                            // BUG-CS-OPT-01 FIX (2026-06-26 audit): mirror the camber retry
                            // used by the slab / flat / waffle optimizers. If flexure and
                            // shear are OK but the Annex C deflection fails, try an
                            // upward camber on the standard 5 mm step (up to 20 mm).
                            if (result.overallStatus !== 'SAFE'
                                && result.flexure_safe && result.shear_safe
                                && !result.defl_safe) {
                                const reqCamber = getRequiredDeflectionCamber(result.deflection, 5);
                                if (reqCamber > 0 && reqCamber <= 20) {
                                    const withCamber = analyzeCantileverSlab({ ...trialInput, camber: reqCamber });
                                    if (withCamber.overallStatus === 'SAFE') {
                                        result = withCamber;
                                    }
                                }
                            }

                            if (result.overallStatus === 'SAFE') {
                                // Concrete volume per meter width (L_eff × 1m × D)
                                const concreteVol = (D / 1000) * result.L_eff;  // m³/m
                                // Steel weight per meter width: top main + top distribution + bottom mat
                                const steelWeight = (
                                    result.Ast_provided + result.Ast_dist_provided + result.Asc_provided
                                ) / 1e6 * result.L_eff * 7850;  // kg/m
                                // AUDIT FIX OPT-3 (2026-07-04): use the shared `computeCost`
                                // helper for a proper INR cost (concrete + steel + formwork).
                                // Formwork area per metre width ≈ L_eff (soffit) + L_eff (top
                                // surface) = 2 × L_eff. This is consistent with the slab /
                                // flat-slab / waffle-slab optimizers.
                                const formworkArea = 2 * result.L_eff;
                                const costTotal_INR = computeCost(
                                    concreteVol, steelWeight, formworkArea, costParams,
                                );
                                const concrete_INR = concreteVol * (costParams.concreteCost_per_m3 ?? 6500);
                                const steel_INR = steelWeight * (costParams.steelCost_per_kg ?? 82) * (costParams.wastage_factor ?? 1.07);
                                const formwork_INR = formworkArea * (costParams.formworkCost_per_m2 ?? 350);

                                results.push({
                                    D, bar_main, spacing_main,
                                    bar_bot: bar_bot > 0 ? bar_bot : 0,
                                    spacing_bot: bar_bot > 0 ? spacing_bot : 0,
                                    camber: result.deflection.camber ?? 0,
                                    concreteVol, steelWeight, costTotal_INR,
                                    costBreakdown: { concrete_INR, steel_INR, formwork_INR },
                                    result,
                                });
                            }
                        } catch {
                            // skip invalid combo
                        }
                        if (onProgress && (done % 20 === 0 || done === total)) {
                            onProgress(done, total, results.length);
                        }
                    }
                }
            }
        }
    }

    results.sort((a, b) => a.costTotal_INR - b.costTotal_INR);

    return {
        totalTrials: total,
        feasibleCount: results.length,
        topDesigns: results.slice(0, 5),
        optimum: results.length > 0 ? results[0] : null,
        costParams,
    };
}
