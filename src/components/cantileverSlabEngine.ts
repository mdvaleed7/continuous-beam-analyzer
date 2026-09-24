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
    combineStripDeflections,
    getRequiredDeflectionCamber,
    computeSpanDepthCheck,
    computeCost,
    type ConcreteGrade,
    type CostParameters,
    type DeflectionResult,
    type AnnexCDesign,
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

    // Support fixity for the deflection check.
    //  'fixed'    — rigid support, no rotation (default; unconservative when the
    //               cantilever is the extension of a flexible back-span).
    //  'backspan' — the cantilever continues from an adjoining slab span whose
    //               flexibility lets the root rotate; the tip moves θ·L.
    //  'beam'     — the cantilever is carried by a beam that twists between
    //               columns restraining it against twist.
    //  'beam_backspan' — both (beam torsion and back-span in parallel).
    supportFixity?: 'fixed' | 'backspan' | 'beam' | 'beam_backspan';
    backSpan_L?: number;                          // back-span c/c length (m)
    backSpan_farEnd?: 'pinned' | 'continuous';    // far-end restraint of the back-span
    beam_b?: number;                              // supporting beam width (mm)
    beam_D?: number;                              // supporting beam overall depth (mm)
    beam_span?: number;                           // beam span between torsional restraints (m)
    // Multiplier on the BS 8110-2 Cl. 2.4.3 torsional stiffness (default 1).
    // Reduce it when the beam cracks in torsion (see result.supportRotation.beam.cracked).
    beam_torsionStiffnessFactor?: number;
    
    // Optional parapet / railing line load at the free end
    parapetHeight?: number;    // m
    parapetThickness?: number; // mm
    parapetDensity?: number;   // kN/m3 (typically 20 for masonry)
    costParams?: CostParameters; // AUDIT FIX OPT-3: optional cost overrides
}

/** Supporting-beam torsion results for the cantilever support rotation. */
export interface CantileverBeamTorsion {
    b: number; D: number; span: number;   // beam width / depth (mm), span between torsional restraints (m)
    beta: number; C: number;              // St Venant β and C = 0.5·β·b³·h (mm⁴, BS 8110-2 Cl. 2.4.3)
    stiffnessFactor: number; GJ: number;  // user factor, short-term G·C (N·mm²)
    lambdaL: number;                      // λ·Lt (0 without a back-span)
    Tu_end: number; T_end: number;        // torque at each column end, factored / service (kN·m)
    tau_t: number; fcr: number;           // elastic torsional shear stress vs 0.7√fck (N/mm²)
    cracked: boolean;                     // τ_t > f_cr → torsional stiffness overestimated
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
    // Cantilever support condition → alpha = 1/4 (UDL), 1/3 (tip load), k3 = 0.5.
    // Root rotation from a flexible back-span is added when
    // supportFixity = 'backspan' (see below); rotation of a supporting beam in
    // torsion is not modelled.
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
    const deflConfig = { Lx: L_eff * 1000, D, cover, fck, fy };
    const deflLoading: AnnexCDesign = {
        barDia_x_bot: bar_main,
        Ast_x_bot: Ast_provided,
        Asc_x_top: Asc_provided,                   // bottom mat = compression steel for cantilever
        barDia_comp: bar_bot,                      // bottom bar dia (for d')
        cover_comp: cover_bot ?? cover,            // bottom cover
        M_service,
        M_perm,
        supportCondition: 'cantilever',
        // Parapet line load at the tip deflects with α = 1/3 (PL³/3EI),
        // not the UDL α = 1/4.
        M_service_tip: P_parapet * L_eff,
        M_perm_tip: P_parapet * L_eff,
    };
    const deflectionRoot: DeflectionResult = annexCDeflection(deflConfig, deflLoading);

    // ─── Support rotation: flexible back-span and/or supporting beam torsion ─
    // The cantilever root moment M (per metre) rotates the root; the tip then
    // moves θ·L. Two sources of flexibility, acting in parallel:
    //
    //  • Back-span (slab continuing behind the support): rotational stiffness
    //    per metre k_b = E·I/(k·Lb), k = 1/3 far end pinned, 1/4 far end
    //    continuous (3EI/L and 4EI/L). E·I is the cracked hogging root section
    //    (I_eff with Ec short-term, I_eff,lt with Ece for creep) — conservative.
    //    Back-span loads and shrinkage are ignored — conservative.
    //
    //  • Supporting beam twisting between columns that restrain it against
    //    twist (span Lt). Torsional stiffness per BS 8110-2:1985 Cl. 2.4.3:
    //    G = 0.42·E and C = half the St Venant constant of the plain section,
    //    C = 0.5·β·b³·h, β = (1/3)(1 − 0.63 b/h + 0.052 (b/h)⁵) (b ≤ h). A
    //    user factor reduces it for a torsionally cracked beam.
    //
    //  The distributed torque t = M acts along the beam. With both sources
    //  (GJ·θ'' − k_b·θ = −t, θ = 0 at the columns) the mid-length rotation is
    //     θ = (t/k_b)·[1 − 1/cosh(λ·Lt/2)],  λ = √(k_b/GJ)
    //  which reduces to t·Lt²/(8GJ) for the beam alone (k_b → 0) and to t/k_b
    //  for the back-span alone. The deflection reported is at mid-length of
    //  the beam, where the rotation is largest.
    const mode = input.supportFixity ?? 'fixed';
    const Lb_m = (mode === 'backspan' || mode === 'beam_backspan') ? Math.max(0, input.backSpan_L ?? 0) : 0;
    const beamOn = (mode === 'beam' || mode === 'beam_backspan')
        && (input.beam_b ?? 0) > 0 && (input.beam_D ?? 0) > 0 && (input.beam_span ?? 0) > 0;
    let supportRotation: {
        mode: 'backspan' | 'beam' | 'beam_backspan';
        Lb: number; farEnd: 'pinned' | 'continuous'; k: number;
        theta_i_mrad: number; theta_perm_mrad: number; theta_lt_mrad: number;
        a_i: number; a_i_perm: number; a1_perm: number; a_creep: number;
        beam: CantileverBeamTorsion | null;
    } | null = null;
    let deflection: DeflectionResult = annexCDeflection(deflConfig, { ...deflLoading, camber: input.camber ?? 0 });
    if (Lb_m > 0 || beamOn) {
        const farEnd = input.backSpan_farEnd ?? 'pinned';
        const k = farEnd === 'continuous' ? 1 / 4 : 1 / 3;
        const Lb = Lb_m * 1000;                    // mm
        const Lc = deflectionRoot.L;               // mm
        const Ec = deflectionRoot.Ec, Ece = deflectionRoot.Ece;

        // Beam torsion constant (mm⁴) — BS 8110-2 Cl. 2.4.3
        const bb = Math.min(input.beam_b ?? 0, input.beam_D ?? 0);
        const hb = Math.max(input.beam_b ?? 0, input.beam_D ?? 0);
        const rb = hb > 0 ? bb / hb : 0;
        const beta = (1 / 3) * (1 - 0.63 * rb + 0.052 * Math.pow(rb, 5));
        const C = beamOn ? 0.5 * beta * Math.pow(bb, 3) * hb : 0;
        const fT = input.beam_torsionStiffnessFactor && input.beam_torsionStiffnessFactor > 0
            ? input.beam_torsionStiffnessFactor : 1;
        const Lt = (input.beam_span ?? 0) * 1000;  // mm

        // Rotation (rad) for a root moment M (kN·m per m) with the section
        // stiffness E·I (per 1000 mm strip) and concrete modulus E.
        const rotation = (M_kNm: number, E: number, I: number) => {
            const t = Math.abs(M_kNm) * 1e6 / 1000;                  // N·mm per mm
            const kb = Lb > 0 ? (E * I / 1000) / (k * Lb) : 0;        // N·mm/rad per mm
            if (!beamOn) return t / kb;
            const GJ = fT * 0.42 * E * C;                            // N·mm²
            if (kb <= 0) return t * Lt * Lt / (8 * GJ);
            const lam = Math.sqrt(kb / GJ);
            return (t / kb) * (1 - 1 / Math.cosh(lam * Lt / 2));
        };
        const theta_i = rotation(M_service, Ec, deflectionRoot.Ieff);
        const theta_perm = rotation(M_perm, Ec, deflectionRoot.Ieff_perm);
        const theta_lt = rotation(M_perm, Ece, deflectionRoot.Ieff_lt);
        const a_i = theta_i * Lc, a_i_perm = theta_perm * Lc, a1_perm = theta_lt * Lc;
        const a_creep = Math.max(0, a1_perm - a_i_perm);
        const rotPart: DeflectionResult = {
            ...deflectionRoot,
            ai: a_i, ai_perm: a_i_perm, a_live: Math.max(0, a_i - a_i_perm),
            a1_perm, a_creep, a_shrinkage: 0,
        };
        deflection = combineStripDeflections([deflectionRoot, rotPart], Lc, input.camber ?? 0);
        const r2 = (v: number) => Math.round(v * 100) / 100;

        let beam: CantileverBeamTorsion | null = null;
        if (beamOn) {
            // Torque at the column ends (short-term stiffness distribution):
            //   T_end = GJ·θ'(0) = t·tanh(λLt/2)/λ  →  t·Lt/2 for the beam alone.
            // With no back-span this is equilibrium torsion and the beam MUST be
            // designed for it (IS 456 Cl. 41).
            const GJ = fT * 0.42 * Ec * C;
            const kb = Lb > 0 ? (Ec * deflectionRoot.Ieff / 1000) / (k * Lb) : 0;
            const lam = kb > 0 ? Math.sqrt(kb / GJ) : 0;
            const endTorque = (M_kNm: number) => {
                const t = Math.abs(M_kNm) * 1e6 / 1000;
                return (lam > 0 ? t * Math.tanh(lam * Lt / 2) / lam : t * Lt / 2) / 1e6;  // kN·m
            };
            const T_end = endTorque(M_service);
            // Elastic torsional shear stress τ = T/(α·b²·h), α ≈ 1/(3 + 1.8 b/h),
            // compared with f_cr = 0.7√fck as a torsional-cracking indicator.
            const alphaT = 1 / (3 + 1.8 * rb);
            const tau_t = T_end * 1e6 / (alphaT * bb * bb * hb);
            const fcr = 0.7 * Math.sqrt(fck);
            beam = {
                b: input.beam_b!, D: input.beam_D!, span: input.beam_span!,
                beta: Math.round(beta * 10000) / 10000, C,
                stiffnessFactor: fT, GJ,
                lambdaL: Math.round(lam * Lt * 1000) / 1000,
                Tu_end: r2(endTorque(Mu)), T_end: r2(T_end),
                tau_t: Math.round(tau_t * 1000) / 1000, fcr: Math.round(fcr * 1000) / 1000,
                cracked: tau_t > fcr,
            };
        }
        supportRotation = {
            mode: mode as 'backspan' | 'beam' | 'beam_backspan',
            Lb: Lb_m, farEnd, k,
            theta_i_mrad: r2(theta_i * 1000), theta_perm_mrad: r2(theta_perm * 1000), theta_lt_mrad: r2(theta_lt * 1000),
            a_i: r2(a_i), a_i_perm: r2(a_i_perm), a1_perm: r2(a1_perm), a_creep: r2(a_creep),
            beam,
        };
    }
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
        deflectionRoot,   // fixed-root cantilever deflection (before support rotation)
        supportRotation,  // null when the support is taken as fixed
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
