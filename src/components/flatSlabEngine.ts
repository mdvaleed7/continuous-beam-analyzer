export interface FlatSlabInput {
    L1: number; // Span in direction of analysis (m)
    L2: number; // Transverse span (m)
    c1: number; // Column dimension parallel to L1 (m)
    c2: number; // Column dimension parallel to L2 (m)
    hasDrop: boolean;
    dropL1: number; // Drop dimension parallel to L1 (m)
    dropL2: number; // Drop dimension parallel to L2 (m)
    dropDepth: number; // Total depth at drop (mm)
    D: number; // Slab thickness outside drop (mm)
    cover: number; // Clear cover (mm)
    fck: number;
    fy: number;
    grade?: string;      // e.g. 'M25' (optional, for UI dropdown sync)
    steelGrade?: string; // e.g. 'Fe500' (optional, for UI dropdown sync)
    w_live: number; // kN/m2
    w_finish: number; // kN/m2
    panelType: 'interior' | 'exterior'; // simplified
    deflectionSupport?: SupportCondition; // 'continuous' | 'simply' | 'one_end' — default 'continuous'
    // Reinforcement for deflection check (column strip bottom steel governs
    // positive mid-span deflection). If provided, the actual Ast is used;
    // otherwise the required Ast is used as a fallback.
    bar_dia?: number;      // bar diameter (mm) for column strip bottom steel
    bar_spacing?: number;  // spacing (mm) for column strip bottom steel
    camber?: number; // explicit upward camber (mm), used by optimizer
    costParams?: CostParameters;
}

import { flexuralDesign as flexuralDesignShared, annexCDeflection, getRequiredDeflectionCamber, computeSpanDepthCheck, type SupportCondition, type CostParameters, type SpanDepthCheckResult, computeCost } from '../lib/is456';

export function analyzeFlatSlab(input: FlatSlabInput) {
    const { L1, L2, c1, c2, hasDrop, dropL1, dropL2, dropDepth, D, cover, fck, fy, w_live, w_finish, panelType } = input;
    const deflSupport: SupportCondition = input.deflectionSupport || 'continuous';
    
    // Clear span Ln
    let Ln = L1 - c1;
    // IS 456 31.4.2.2: Ln shall not be less than 0.65 L1
    if (Ln < 0.65 * L1) Ln = 0.65 * L1;
    
    // Effective depth
    const d_slab = D - cover - 10; // assuming 10mm bar and using avg depth
    const d_drop = hasDrop ? (dropDepth - cover - 10) : d_slab;
    
    // Load
    const w_dead_slab = (D / 1000) * 25;
    // We assume drop weight is spread over the panel for total W simplify, or ignore extra drop weight in total M0 as per standard approx
    const w_total = w_dead_slab + w_live + w_finish; 
    const wu = 1.5 * w_total; // factored load per m2
    
    // Total Load on panel (for moment) W = wu * L2 * Ln
    const W = wu * L2 * Ln; // kN
    
    // Total Design Moment M0
    const M0 = (W * Ln) / 8; // kN.m
    
    // Distribution for Interior Panel
    // Negative = 0.65 M0, Positive = 0.35 M0
    // If exterior, IS 456 varies depending on edge support. We will assume interior for this simplified engine unless specified.
    let M_neg = 0.65 * M0;
    let M_pos = 0.35 * M0;
    if (panelType === 'exterior') {
        // approx values without edge beam
        M_neg = 0.75 * M0; // interior negative
        M_pos = 0.52 * M0; 
    }
    
    // Column Strip Width — IS 456 Cl. 31.2: one-quarter of the transverse span
    // L2 on each side of the column centreline → total width = L2/2.
    // (The previous min(0.25·L1, 0.25·L2)·2 was only correct for square panels.)
    const colStripWidth = 0.5 * L2; // m
    const midStripWidth = L2 - colStripWidth; // m
    
    // Distribution to Column and Middle strips
    // Column strip takes 75% of negative M
    const M_neg_col = 0.75 * M_neg;
    const M_neg_mid = 0.25 * M_neg;
    
    // Column strip takes 60% of positive M
    const M_pos_col = 0.60 * M_pos;
    const M_pos_mid = 0.40 * M_pos;
    
    // Punching Shear
    // Critical section at d/2 from face of column. Keep u in metres for
    // geometry, then convert to mm only in the stress denominator.
    let crit_perimeter = 0;
    let shear_force = 0;
    let tau_v = 0;
    const d_punch = hasDrop ? d_drop : d_slab;
    const d_punch_m = d_punch / 1000;
    crit_perimeter = 2 * ((c1 + d_punch_m) + (c2 + d_punch_m)); // m
    const area_inside = (c1 + d_punch_m) * (c2 + d_punch_m); // m2
    shear_force = wu * (L1 * L2 - area_inside);
    tau_v = (shear_force * 1000) / (crit_perimeter * 1000 * d_punch); // N/mm2
    
    // Allowable Punching Shear tau_c
    // IS 456 31.6.3: tau_c = 0.25 * sqrt(fck) * ks
    const beta_c = Math.min(c1, c2) / Math.max(c1, c2);
    const ks = Math.min(1.0, 0.5 + beta_c);
    const tau_c = ks * 0.25 * Math.sqrt(fck);
    const punching_safe = tau_v <= tau_c;
    
    // Ast via the shared IS 456 flexural design helper (Cl. 38.1) — ponytail DRY:
    // previously this re-implemented the 4.6 formula locally. The shared helper
    // also applies Ast_min (Cl. 26.5.2.1) and Ast_max (Cl. 26.5.1.1) consistently.
    const calcAst = (M: number, width_m: number, effective_d: number) => {
        const b_mm = width_m * 1000;
        const D_gross = effective_d + cover + 10; // gross thickness ≈ d + cover + bar/2
        const r = flexuralDesignShared(M, b_mm, effective_d, fck, fy, D_gross);
        return r.Ast_req;
    };
    
    // Note: Negative moment in column strip acts at column, so it has drop thickness if drop exists
    const Ast_neg_col = calcAst(M_neg_col, colStripWidth, hasDrop ? d_drop : d_slab);
    const Ast_pos_col = calcAst(M_pos_col, colStripWidth, d_slab);
    const Ast_neg_mid = calcAst(M_neg_mid, midStripWidth, d_slab);
    const Ast_pos_mid = calcAst(M_pos_mid, midStripWidth, d_slab);

    // ─── Deflection check (IS 456 Annex C — full short-term + shrinkage + creep) ──
    // Per the user's instruction: the simplified L/d check is NOT used; the full
    // Annex C deflection calculation governs. The support condition is now
    // user-selectable (continuous / simply / one_end) via the deflectionSupport
    // input — default 'continuous' for flat slabs.
    const w_service = w_dead_slab + w_live + w_finish;  // kN/m²
    const w_perm = w_dead_slab + w_finish;              // permanent (dead) load
    const M0_service = (w_service * L2 * Ln * Ln) / 8;
    const M0_perm = (w_perm * L2 * Ln * Ln) / 8;
    const M_pos_col_service = 0.35 * 0.60 * M0_service;  // positive column-strip moment
    const M_pos_col_perm = 0.35 * 0.60 * M0_perm;
    const M_service_per_m = M_pos_col_service / colStripWidth;
    const M_perm_per_m = M_pos_col_perm / colStripWidth;
    // Use the PROVIDED reinforcement (bar dia + spacing) for the deflection
    // check — not the required Ast. The user provides the actual steel; the
    // deflection is controlled by what's actually in the slab.
    const barDia_defl = input.bar_dia || 12;
    const barSpacing_defl = input.bar_spacing || 150;
    const Abar_defl = Math.PI * barDia_defl * barDia_defl / 4;
    const Ast_provided_defl = (1000 / barSpacing_defl) * Abar_defl; // mm²/m
    const Ast_req_defl_per_m = Number.isNaN(Ast_pos_col) || colStripWidth <= 0 ? 0 : Ast_pos_col / colStripWidth;
    const Ast_defl = Math.max(Ast_provided_defl, Ast_req_defl_per_m);
    const deflection = annexCDeflection(
        { Lx: Ln * 1000, D, cover, fck, fy },
        {
            barDia_x_bot: barDia_defl,
            Ast_x_bot: Ast_defl,
            Asc_x_top: 0,
            M_service: M_service_per_m,
            M_perm: M_perm_per_m,
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
    // Per the user's instruction: the simplified L/d check is computed for flat
    // slabs too. It is IGNORED for design purposes (Annex C deflection governs),
    // but the calculation is surfaced so the engineer can inspect it.
    const ldCheck: SpanDepthCheckResult = computeSpanDepthCheck({
        L: Ln * 1000,             // clear span (mm)
        D, cover, fy,
        barDia: barDia_defl,      // column-strip bottom bar
        AstProvided: Ast_defl,    // provided steel per m (mm²/m)
        AstRequired: Ast_req_defl_per_m,
        supportType: deflSupport,
    });

    // Total strip steel for one panel direction. calcAst() already returns the
    // Ast required across each strip width, so do not multiply by width again.
    const totalAstPerPanel =
        Ast_neg_col + Ast_pos_col + Ast_neg_mid + Ast_pos_mid;

    const allAstFinite = [Ast_neg_col, Ast_pos_col, Ast_neg_mid, Ast_pos_mid].every(v => !Number.isNaN(v));

    // ─── IS 456 Drop Panel code checks (Cl. 31.4) ───────────────────────────
    // 31.4.1: drop shall project below slab ≥ D/4  →  dropDepth ≥ 1.25·D
    // 31.4.2: drop horizontal extent from column face ≥ drop projection (45° slope)
    // Recommended: drop width ≥ L/6 each side (so total drop ≥ L/3)
    let dropChecks: { ok: boolean; depthOk: boolean; widthOk: boolean; slopeOk: boolean; messages: string[] } | null = null;
    if (hasDrop) {
        const dropProjection = dropDepth - D;              // mm below slab
        const depthOk = dropProjection >= D / 4;            // Cl. 31.4.1
        const dropL1_min = L1 / 6;                          // recommended min each side
        const dropL2_min = L2 / 6;
        const widthOk = dropL1 >= dropL1_min && dropL2 >= dropL2_min;
        // Slope: horizontal extent from column face (m) ≥ dropProjection (m)
        const horizL1 = (dropL1 - c1) / 2;                  // m from column face
        const horizL2 = (dropL2 - c2) / 2;
        const slopeOk = horizL1 >= dropProjection / 1000 && horizL2 >= dropProjection / 1000;
        const messages: string[] = [];
        if (!depthOk) messages.push(`Drop depth ${dropDepth}mm < 1.25·D=${(1.25 * D).toFixed(0)}mm (Cl. 31.4.1: projection ≥ D/4)`);
        if (!widthOk) messages.push(`Drop width ${dropL1}×${dropL2}m < L/6=${dropL1_min.toFixed(2)}×${dropL2_min.toFixed(2)}m (recommended)`);
        if (!slopeOk) messages.push(`Drop slope > 45° — increase horizontal extent or reduce projection`);
        dropChecks = { ok: depthOk && widthOk && slopeOk, depthOk, widthOk, slopeOk, messages };
    }

    // ─── IS 456 Cl. 31.2.1 — Minimum thickness of flat slab ────────────
    //   'The minimum thickness of slab shall be 125 mm.'
    // This is an absolute lower bound, independent of the L/d (deflection)
    // check. It is reported on the result so the UI can flag it, and is also
    // enforced as a hard infeasibility filter in the optimizer (see below).
    const MIN_FLAT_SLAB_THICKNESS = 125;                    // mm — Cl. 31.2.1
    const thicknessOk = D >= MIN_FLAT_SLAB_THICKNESS;
    const thicknessCheck = {
        ok: thicknessOk,
        D,
        D_min: MIN_FLAT_SLAB_THICKNESS,
        message: thicknessOk
            ? ''
            : `Slab thickness ${D}mm < ${MIN_FLAT_SLAB_THICKNESS}mm (IS 456 Cl. 31.2.1)`,
    };

    // ─── IS 456 Reinforcement detailing checks (Cl. 26.3.3 + 26.5) ──────────
    // Max main bar spacing ≤ 3d or 300mm (whichever less)
    // Max bar diameter ≤ D/8 (practical slab limit)
    const maxBarDia = D / 8;                                // mm
    const maxSpacingMain = Math.min(3 * d_slab, 300);       // mm
    // Max Ast achievable: use the largest standard bar ≤ D/8 at the minimum
    // practical spacing (75mm). This determines whether the required Ast is
    // physically achievable within the code limits.
    const standardDias = [8, 10, 12, 16, 20, 25, 32].filter(d => d <= maxBarDia);
    const largestBar = standardDias.length > 0 ? standardDias[standardDias.length - 1] : 8;
    const Abar_max = Math.PI * largestBar * largestBar / 4;
    const minSpacing = 75;                                  // mm (practical min for slabs)
    const maxAstPerM = Abar_max * (1000 / minSpacing);      // mm²/m
    const stripAstPerM = [
        Ast_neg_col / colStripWidth,
        Ast_pos_col / colStripWidth,
        Ast_neg_mid / midStripWidth,
        Ast_pos_mid / midStripWidth,
    ];
    const barChecks = {
        maxBarDia: Math.floor(maxBarDia),
        maxSpacingMain: Math.floor(maxSpacingMain),
        maxAstPerM: Math.round(maxAstPerM),
        // Flag if any strip Ast per metre exceeds what's achievable within the limits.
        astFeasible: stripAstPerM.every(v => Number.isNaN(v) || v <= maxAstPerM),
    };

    const overallStatus: 'SAFE' | 'REVISE' =
        (thicknessOk && punching_safe && deflection_safe && allAstFinite && barChecks.astFeasible &&
         (!dropChecks || dropChecks.ok)) ? 'SAFE' : 'REVISE';

    return {
        Ln,
        W,
        M0,
        colStripWidth,
        midStripWidth,
        M_neg_col,
        M_pos_col,
        M_neg_mid,
        M_pos_mid,
        Ast_neg_col,
        Ast_pos_col,
        Ast_neg_mid,
        Ast_pos_mid,
        crit_perimeter,
        shear_force,
        tau_v,
        tau_c,
        punching_safe,
        wu,
        d_slab,
        d_drop,
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
        thicknessCheck,    // Cl. 31.2.1 (D >= 125 mm)
        dropChecks,
        barChecks,
        deflectionSupport: deflSupport,
        totalAstPerPanel,
    };
}

// ═══════════════════════════════════════════════════════════════
//  FLAT SLAB OPTIMIZER — minimize steel reinforcement while
//  controlling deflection (L/d) and punching shear.
//
//  Sweeps slab depth D over a range (and drop depth if hasDrop).
//  For each combination, runs analyzeFlatSlab and keeps only SAFE
//  designs. Ranks by a cost index = concrete volume + steel weight
//  × ratio (matching slabEngine.optimizeSlab convention).
// ═══════════════════════════════════════════════════════════════

export interface FlatSlabOptimizeParams {
    minD?: number; maxD?: number; stepD?: number;          // slab depth sweep (mm)
    minDropDepth?: number; maxDropDepth?: number; stepDropDepth?: number;  // optional drop depth sweep
    barDias?: number[];                                  // column-strip bar diameters to try (mm)
    barSpacings?: number[];                              // column-strip bar spacings to try (mm)
}

export function suggestFlatThicknessRange(input: FlatSlabInput): number[] {
    const { L1, fy = 500 } = input;
    const basicRatio = 26; // continuous
    const mf_est = fy >= 500 ? 1.20 : 1.40;
    const d_min = (L1 * 1000) / (basicRatio * mf_est);
    // IS 456 Cl. 31.2.1: minimum flat-slab thickness is 125 mm. The suggested
    // sweep range must never start below this absolute code minimum, even if
    // the L/d-derived estimate would.
    const D_min = Math.max(125, Math.ceil((d_min + 30) / 10) * 10);
    // BUG-S-02 FIX (2026-06-26 audit): widen the suggested range so flat-slab
    // optimization can reach deflection-controlled depths for longer spans.
    const range: number[] = [];
    for (let d = D_min; d <= D_min + 250; d += 25) range.push(d);
    return range;
}

export interface OptimumFlatSlabDesign {
    D: number;
    dropDepth: number;
    bar_dia: number;
    bar_spacing: number;
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
    result: ReturnType<typeof analyzeFlatSlab>;
}

export interface FlatSlabOptimizeResult {
    totalTrials: number;
    feasibleCount: number;
    topDesigns: OptimumFlatSlabDesign[];
    optimum: OptimumFlatSlabDesign | null;
    paretoFront: OptimumFlatSlabDesign[];
    costParams: CostParameters;
}

export type FlatSlabProgressCallback = (done: number, total: number, feasible: number) => void;

export function optimizeFlatSlab(
    input: FlatSlabInput,
    params: FlatSlabOptimizeParams,
    costParams: CostParameters = input.costParams ?? { steelCost_per_kg: 82, concreteCost_per_m3: 6500 },
    onProgress?: FlatSlabProgressCallback,
): FlatSlabOptimizeResult {
    const results: OptimumFlatSlabDesign[] = [];

    let Ds: number[] = [];
    if (params.minD !== undefined && params.maxD !== undefined && params.stepD !== undefined) {
        for (let v = params.minD; v <= params.maxD + 1e-6; v += params.stepD) Ds.push(Math.round(v));
    } else { Ds = suggestFlatThicknessRange(input); }
    // IS 456 Cl. 31.2.1 — strip any trial depth below the 125 mm code minimum
    // for flat slabs, regardless of how the depth list was sourced.
    Ds = Ds.filter(d => d >= 125);
    
    const hasDrop = input.hasDrop;
    const dropDepths: number[] = [];
    if (hasDrop) {
        if (params.minDropDepth !== undefined && params.maxDropDepth !== undefined && params.stepDropDepth !== undefined) {
            for (let v = params.minDropDepth; v <= params.maxDropDepth + 1e-6; v += params.stepDropDepth) dropDepths.push(Math.round(v));
        } else {
            dropDepths.push(0);
        }
    } else {
        dropDepths.push(0);
    }

    const barDias = params.barDias ?? [10, 12, 16];
    const barSpacings = params.barSpacings ?? [100, 125, 150, 175, 200, 250];

    const total = Ds.length * dropDepths.length * barDias.length * barSpacings.length;
    let done = 0;

    for (const D of Ds) {
        for (const dropD of dropDepths) {
            for (const dia of barDias) {
                for (const spacing of barSpacings) {
                    done++;
                    try {
                        const actualDropDepth = hasDrop ? (dropD === 0 ? D + 50 : dropD) : D;
                        if (hasDrop && actualDropDepth <= D) continue;

                        const trialInput: FlatSlabInput = {
                            ...input,
                            D: D,
                            dropDepth: actualDropDepth,
                            bar_dia: dia,
                            bar_spacing: spacing,
                            camber: input.camber ?? 0,
                        };

                        let res = analyzeFlatSlab(trialInput);

                        if (res.overallStatus !== 'SAFE'
                            && res.barChecks.astFeasible
                            && !res.deflection_safe) {
                            const reqCamber = getRequiredDeflectionCamber(res.deflection, 5);
                            if (reqCamber > 0 && reqCamber <= 20) {
                                const withCamber = analyzeFlatSlab({ ...trialInput, camber: reqCamber });
                                if (withCamber.overallStatus === 'SAFE') {
                                    res = withCamber;
                                }
                            }
                        }

                        if (res.overallStatus === 'SAFE') {
                            const slabVol = (D / 1000) * input.L1 * input.L2;
                            const dropExtraVol = input.hasDrop
                                ? ((actualDropDepth - D) / 1000) * input.dropL1 * input.dropL2
                                : 0;
                            const concreteVol = slabVol + dropExtraVol;

                            const totalAst = res.totalAstPerPanel;
                            const LAP_WASTAGE_FACTOR = 1.08;
                            const steelWeight_net = (totalAst / 1e6) * 7850; 
                            const steelWeight_gross = steelWeight_net * LAP_WASTAGE_FACTOR;
                            const slabArea_m2 = input.L1 * input.L2;
                            
                            const costTotal_INR = computeCost(concreteVol, steelWeight_gross, slabArea_m2, costParams);
                            const concrete_INR = concreteVol * (costParams.concreteCost_per_m3 ?? 6500);
                            const steel_INR = steelWeight_gross * (costParams.steelCost_per_kg ?? 82) * (costParams.wastage_factor ?? 1.07);
                            const formwork_INR = slabArea_m2 * (costParams.formworkCost_per_m2 ?? 350);

                            const Ast_provided_defl = (1000 / spacing) * (Math.PI * dia * dia / 4);
                            const flexure_u = (res.Ast_pos_col / res.colStripWidth) / Ast_provided_defl;
                            const deflection_u = res.deflection.a_total / res.deflection.limit_total;
                            
                            let shear_u = res.tau_v / res.tau_c;

                            results.push({
                                D, dropDepth: actualDropDepth, bar_dia: dia, bar_spacing: spacing,
                                camber: res.deflection.camber ?? 0,
                                costTotal_INR,
                                costBreakdown: { concrete_INR, steel_INR, formwork_INR },
                                steelWeight_gross, concreteVol,
                                utilizationRatio: { flexure: flexure_u, deflection: deflection_u, shear: shear_u },
                                result: res
                            });
                        }
                    } catch {
                        // skip invalid combo
                    }
                    if (onProgress && (done % 30 === 0 || done === total)) {
                        onProgress(done, total, results.length);
                    }
                }
            }
        }
    }

    results.sort((a, b) => a.costTotal_INR - b.costTotal_INR);

    const paretoFront: OptimumFlatSlabDesign[] = [];
    let minDeflection = Infinity;
    for (const r of results) {
        if (r.utilizationRatio.deflection < minDeflection) {
            paretoFront.push(r);
            minDeflection = r.utilizationRatio.deflection;
        }
    }

    return {
        totalTrials: total,
        feasibleCount: results.length,
        topDesigns: results.slice(0, 5),
        optimum: results.length > 0 ? results[0] : null,
        paretoFront,
        costParams,
    };
}
