/**
 * flatSlabEngine.ts — Flat slab design by the Direct Design Method,
 * IS 456:2000 Cl. 31.
 *
 *  • Total static moment M0 = W·Ln/8 (Cl. 31.4.2.2), W including the smeared
 *    self-weight of the drop panels.
 *  • Longitudinal distribution (Cl. 31.4.3): interior span 0.65 / 0.35; end
 *    span (Cl. 31.4.3.3) with αc = ΣKc/Ks of the exterior joint:
 *        interior negative  0.75 − 0.10/(1 + 1/αc)
 *        positive           0.63 − 0.28/(1 + 1/αc)
 *        exterior negative  0.65/(1 + 1/αc)
 *  • Transverse distribution (Cl. 31.5.5): column strip 75 % of the interior
 *    negative moment, 100 % of the exterior negative moment (unless the
 *    support is at least 0.75·l2 wide), 60 % of the positive moment.
 *  • Both span directions are designed (L2 direction from its own M0).
 *  • Punching (Cl. 31.6): interior column, edge and corner columns with the
 *    reduced critical section of Fig. 13, the section outside the drop panel,
 *    and the part of the unbalanced moment transferred by eccentricity of
 *    shear (Cl. 31.6.2.2 / 31.3.3; unbalanced moment at interior columns from
 *    Cl. 31.4.5.2, at exterior columns the exterior negative moment).
 *  • Drop panels: plan size ≥ l/3 each way (Cl. 31.2.2).
 *  • DDM limitations of Cl. 31.4.1 checked.
 */
import {
    flexuralDesign as flexuralDesignShared, selectBars, flexuralCapacity,
    annexCDeflection, combineStripDeflections, staticBeta, getRequiredDeflectionCamber,
    computeSpanDepthCheck, computeCost,
    type SupportCondition, type CostParameters, type SpanDepthCheckResult, type BarResult,
} from '../lib/is456';

export type FlatPanelType = 'interior' | 'exterior' | 'corner';

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
    // 'interior' — interior panel; 'exterior' — end span in the L1 direction
    // (edge column at one L1 support); 'corner' — end span in both directions.
    panelType: FlatPanelType;
    deflectionSupport?: SupportCondition; // sets the Annex C shrinkage coefficient k3 — default 'continuous'
    // Column-strip BOTTOM (positive) bars in the L1 direction. The analysis
    // checks them against the steel required; the other zones get bars
    // selected automatically.
    bar_dia?: number;      // bar diameter (mm)
    bar_spacing?: number;  // spacing (mm)
    camber?: number; // explicit upward camber (mm), used by optimizer
    costParams?: CostParameters;
    // ── End-span stiffness (Cl. 31.4.3.3) ──────────────────────────────────
    // αc = ΣKc/Ks at the exterior joint. When omitted it is computed with
    // K = 4EI/L for the columns (Ic = c2·c1³/12, height colHeight, colsAtJoint
    // columns) and the slab (Is = L2·D³/12, span L1).
    alpha_c?: number;
    colHeight?: number;     // storey height for the column stiffness (m) — default 3.0
    colsAtJoint?: number;   // columns meeting at the joint (above + below) — default 2
    // Slab projection beyond the outer face of an edge / corner column (m), default 0.
    edgeOverhang?: number;
    // Number of continuous spans in each direction (DDM Cl. 31.4.1 a) — default 3.
    nSpansL1?: number;
    nSpansL2?: number;
}

export interface PunchingCheck {
    location: string;          // e.g. 'Interior column', 'Edge column', 'Outside drop'
    a1: number; b1: number;    // critical-section dimensions (mm): a1 along L1, b1 along L2
    u: number;                 // perimeter (mm)
    d: number;                 // effective depth (mm)
    V: number;                 // factored shear (kN)
    M1: number; M2: number;    // transferred moments about the critical-section centroid (kN·m), L1 / L2 bending
    gammaV1: number; gammaV2: number; // fractions transferred by eccentric shear
    tau_v: number;             // governing shear stress (N/mm²)
    tau_c: number;             // ks·0.25·√fck (N/mm²)
    ok: boolean;
}

export interface MomentTransferCheck {
    location: string;
    bandWidth: number;         // effective slab width for flexural transfer (mm)
    M_flex: number;            // fraction transferred by flexure (kN·m)
    Ast_req: number;           // steel needed in the band (mm²)
    Ast_available: number;     // negative steel already in the band (mm²)
    Ast_extra: number;         // additional bars to concentrate in the band (mm²)
    ok: boolean;               // false only if the band cannot carry M_flex singly reinforced
}

interface ZoneSteel {
    M: number;                 // design moment on the strip (kN·m)
    width: number;             // strip width (m)
    d: number;                 // effective depth (mm)
    Ast: number;               // required steel on the strip (mm²) — NaN if the section fails
    bars: BarResult;           // bars per metre
    capacity: number;          // moment capacity of the provided bars on the strip (kN·m)
}

const round = (v: number, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

/** End-span / interior-span moment coefficients — IS 456 Cl. 31.4.3.2 / 31.4.3.3. */
export function ddmCoefficients(isEndSpan: boolean, alpha_c: number) {
    if (!isEndSpan) return { negInt: 0.65, pos: 0.35, negExt: 0, f: 1 };
    const f = alpha_c > 0 ? 1 / (1 + 1 / alpha_c) : 0;
    return { negInt: 0.75 - 0.10 * f, pos: 0.63 - 0.28 * f, negExt: 0.65 * f, f };
}

/** Fraction of the unbalanced moment transferred by eccentricity of shear. */
const gammaV = (a: number, b: number) => 1 - 1 / (1 + (2 / 3) * Math.sqrt(a / b));

export function analyzeFlatSlab(input: FlatSlabInput) {
    const { L1, L2, c1, c2, hasDrop, dropL1, dropL2, dropDepth, D, cover, fck, fy, w_live, w_finish } = input;
    const panelType: FlatPanelType = input.panelType ?? 'interior';
    const endSpan1 = panelType === 'exterior' || panelType === 'corner';
    const endSpan2 = panelType === 'corner';
    const deflSupport: SupportCondition = input.deflectionSupport || 'continuous';
    const warnings: string[] = [];

    // ── Clear spans (Cl. 31.4.2.2: Ln ≥ 0.65·L) ─────────────────────────────
    const Ln = Math.max(L1 - c1, 0.65 * L1);
    const Ln2 = Math.max(L2 - c2, 0.65 * L2);

    // ── Effective depths ────────────────────────────────────────────────────
    // L1 bars in the outer layer, L2 bars inside them; punching uses the mean
    // of the two layers.
    const phi = input.bar_dia || 12;
    const d_slab = D - cover - phi / 2;
    const d_slab2 = d_slab - phi;
    const d_slab_avg = D - cover - phi;
    const d_drop = hasDrop ? dropDepth - cover - phi / 2 : d_slab;
    const d_drop2 = d_drop - phi;
    const d_drop_avg = hasDrop ? dropDepth - cover - phi : d_slab_avg;
    const D_neg = hasDrop ? dropDepth : D;        // gross depth over the column

    // ── Loads (drop panel weight smeared over the panel) ────────────────────
    const w_dead_slab = (D / 1000) * 25;
    const w_drop = hasDrop ? ((dropDepth - D) / 1000) * 25 * (dropL1 * dropL2) / (L1 * L2) : 0;
    const w_dead = w_dead_slab + w_drop + w_finish;       // design dead load (service)
    const w_total = w_dead + w_live;
    const wu = 1.5 * w_total;
    const wlu = 1.5 * w_live;

    // ── Total static moments (Cl. 31.4.2.2) ─────────────────────────────────
    const W = wu * L2 * Ln;
    const M0 = (W * Ln) / 8;
    const M0_2 = (wu * L1 * Ln2 * Ln2) / 8;

    // ── αc (Cl. 31.4.3.3) — K = 4EI/L, E cancels ────────────────────────────
    const Hc = input.colHeight && input.colHeight > 0 ? input.colHeight : 3.0;
    const nCols = input.colsAtJoint && input.colsAtJoint > 0 ? input.colsAtJoint : 2;
    const Dm = D / 1000;
    const Kc1 = nCols * (c2 * c1 ** 3 / 12) / Hc;         // bending in the L1 direction
    const Kc2 = nCols * (c1 * c2 ** 3 / 12) / Hc;         // bending in the L2 direction
    const Ks1 = (L2 * Dm ** 3 / 12) / L1;
    const Ks2 = (L1 * Dm ** 3 / 12) / L2;
    const alpha_c_ext1 = input.alpha_c ?? Kc1 / Ks1;
    const alpha_c_ext2 = input.alpha_c ?? Kc2 / Ks2;
    const alpha_c_int1 = Kc1 / (2 * Ks1);                  // two slabs frame into an interior joint
    const alpha_c_int2 = Kc2 / (2 * Ks2);
    const co1 = ddmCoefficients(endSpan1, alpha_c_ext1);
    const co2 = ddmCoefficients(endSpan2, alpha_c_ext2);

    // ── Strip widths (Cl. 31.1.1) ───────────────────────────────────────────
    const colStripWidth = 0.5 * Math.min(L1, L2);
    const midStripWidth = L2 - colStripWidth;
    const colStripWidth2 = colStripWidth;
    const midStripWidth2 = L1 - colStripWidth2;

    // ── Flexural design of one zone ─────────────────────────────────────────
    const maxBarDia = D / 8;                                   // practical slab limit
    const barDias = [8, 10, 12, 16, 20, 25].filter(x => x <= maxBarDia);
    const barSet = barDias.length > 0 ? barDias : [8];
    const zone = (M: number, width: number, d: number, Dg: number, userBars?: BarResult): ZoneSteel => {
        const r = flexuralDesignShared(M, width * 1000, d, fck, fy, Dg);
        const Ast = r.isDoubly || r.governs === 'maximum' ? NaN : r.Ast_req;
        const reqPerM = Number.isNaN(Ast) ? r.Ast_req / width : Ast / width;
        const bars = userBars ?? selectBars(reqPerM, barSet, undefined, 1000, d);
        const capacity = flexuralCapacity(bars.Ast_provided * width, width * 1000, d, fck, fy);
        return { M, width, d, Ast, bars, capacity };
    };
    const userBar: BarResult | undefined = input.bar_dia && input.bar_spacing
        ? {
            dia: input.bar_dia, spacing: input.bar_spacing,
            Ast_provided: Math.round((1000 / input.bar_spacing) * Math.PI * input.bar_dia ** 2 / 4),
            label: `${input.bar_dia}mm @ ${input.bar_spacing} c/c`, adequate: true,
        }
        : undefined;

    // L1 direction
    const M_neg_col = 0.75 * co1.negInt * M0;
    const M_neg_mid = 0.25 * co1.negInt * M0;
    const M_pos_col = 0.60 * co1.pos * M0;
    const M_pos_mid = 0.40 * co1.pos * M0;
    // Exterior negative: whole moment to the column strip (Cl. 31.5.5.2 a)
    // unless the support is at least 0.75·l2 wide (then spread over l2).
    const extShare1 = c2 >= 0.75 * L2 ? colStripWidth / L2 : 1;
    const M_negExt_col = endSpan1 ? extShare1 * co1.negExt * M0 : 0;
    const M_negExt_mid = endSpan1 ? (1 - extShare1) * co1.negExt * M0 : 0;

    const z1 = {
        negCol: zone(M_neg_col, colStripWidth, d_drop, D_neg),
        posCol: zone(M_pos_col, colStripWidth, d_slab, D, userBar),
        negMid: zone(M_neg_mid, midStripWidth, d_slab, D),
        posMid: zone(M_pos_mid, midStripWidth, d_slab, D),
        negExtCol: endSpan1 ? zone(M_negExt_col, colStripWidth, d_drop, D_neg) : null,
        negExtMid: endSpan1 ? zone(M_negExt_mid, midStripWidth, d_slab, D) : null,
    };
    // L2 direction (inner layer)
    const extShare2 = c1 >= 0.75 * L1 ? colStripWidth2 / L1 : 1;
    const z2 = {
        negCol: zone(0.75 * co2.negInt * M0_2, colStripWidth2, d_drop2, D_neg),
        posCol: zone(0.60 * co2.pos * M0_2, colStripWidth2, d_slab2, D),
        negMid: zone(0.25 * co2.negInt * M0_2, midStripWidth2, d_slab2, D),
        posMid: zone(0.40 * co2.pos * M0_2, midStripWidth2, d_slab2, D),
        negExtCol: endSpan2 ? zone(extShare2 * co2.negExt * M0_2, colStripWidth2, d_drop2, D_neg) : null,
        negExtMid: endSpan2 ? zone((1 - extShare2) * co2.negExt * M0_2, midStripWidth2, d_slab2, D) : null,
    };
    const zones1 = Object.values(z1).filter((z): z is ZoneSteel => z !== null);
    const zones2 = Object.values(z2).filter((z): z is ZoneSteel => z !== null);
    const allZones = [...zones1, ...zones2];

    const Ast_neg_col = z1.negCol.Ast;
    const Ast_pos_col = z1.posCol.Ast;
    const Ast_neg_mid = z1.negMid.Ast;
    const Ast_pos_mid = z1.posMid.Ast;
    const Ast_negExt_col = z1.negExtCol?.Ast ?? 0;
    const allAstFinite = allZones.every(z => !Number.isNaN(z.Ast));

    // Provided steel: every zone's bars must reach the required steel; the
    // user's column-strip bottom bars must also respect the spacing / bar size
    // limits (Cl. 26.3.3 b: s ≤ min(3d, 300); bar ≤ D/8).
    const maxSpacingMain = Math.min(3 * d_slab, 300);
    const userBarsOk = !userBar || (userBar.spacing <= maxSpacingMain && userBar.dia <= maxBarDia);
    const zonesAdequate = allZones.every(z => !Number.isNaN(z.Ast) && z.bars.Ast_provided * z.width >= z.Ast - 1e-6);
    const providedSteelCheck = {
        ok: userBarsOk && zonesAdequate,
        colBottomRequired: round(Number.isNaN(Ast_pos_col) ? NaN : Ast_pos_col / colStripWidth, 0),
        colBottomProvided: z1.posCol.bars.Ast_provided,
        userBarsOk,
        messages: [] as string[],
    };
    if (!userBarsOk && userBar) providedSteelCheck.messages.push(
        `Column-strip bottom bars ${userBar.label}: spacing ≤ ${Math.floor(maxSpacingMain)} mm and bar ≤ D/8 = ${Math.floor(maxBarDia)} mm (Cl. 26.3.3)`);
    for (const [name, z] of Object.entries({ ...prefix(z1, 'L1 '), ...prefix(z2, 'L2 ') })) {
        if (z && !Number.isNaN(z.Ast) && z.bars.Ast_provided * z.width < z.Ast - 1e-6) {
            providedSteelCheck.messages.push(
                `${name}: provided ${z.bars.label} = ${Math.round(z.bars.Ast_provided * z.width)} mm² < required ${Math.round(z.Ast)} mm²`);
        }
    }

    // ── Steel quantity per panel (for costing) ──────────────────────────────
    // Bottom bars run the full span; top bars are costed 0.3·Ln into the panel
    // from each support (a curtailment estimate — detail per IS 456 Fig. 16).
    const kgOf = (z: ZoneSteel | null, length: number) =>
        z ? z.bars.Ast_provided * z.width * length * 7850 / 1e6 : 0;
    const topLen1 = 0.3 * Ln, topLen2 = 0.3 * Ln2;
    const steelWeight_kg =
        kgOf(z1.posCol, L1) + kgOf(z1.posMid, L1)
        + kgOf(z1.negCol, endSpan1 ? topLen1 : 2 * topLen1) + kgOf(z1.negMid, endSpan1 ? topLen1 : 2 * topLen1)
        + kgOf(z1.negExtCol, topLen1) + kgOf(z1.negExtMid, topLen1)
        + kgOf(z2.posCol, L2) + kgOf(z2.posMid, L2)
        + kgOf(z2.negCol, endSpan2 ? topLen2 : 2 * topLen2) + kgOf(z2.negMid, endSpan2 ? topLen2 : 2 * topLen2)
        + kgOf(z2.negExtCol, topLen2) + kgOf(z2.negExtMid, topLen2);

    // ── Punching shear (Cl. 31.6) ───────────────────────────────────────────
    const tauC = (short: number, long: number) => {
        const beta_c = long > 0 ? short / long : 1;
        return Math.min(1.0, 0.5 + beta_c) * 0.25 * Math.sqrt(fck);
    };
    const tau_c_col = tauC(Math.min(c1, c2), Math.max(c1, c2));
    const e_o = Math.max(0, input.edgeOverhang ?? 0);
    const punchingChecks: PunchingCheck[] = [];
    // The eccentric-shear model of Cl. 31.6.2.2 varies the stress linearly
    // about the CENTROID of the critical section, so the transferred moment is
    // taken about that centroid: for edge / corner columns the column reaction
    // V acts at the column centre (x_col, y_col from the free edges), offset
    // from the section centroid, and M_c = M − V·e (ACI 421.1R-08 §3.2).
    const addCheck = (
        location: string, kind: 'interior' | 'edge' | 'corner',
        a1: number, b1: number, d: number, V_kN: number, M1: number, M2: number, tau_c: number,
        x_col = 0, y_col = 0,
    ) => {
        let u: number, J1: number, cc1: number, J2 = 0, cc2 = 0;
        let e1 = 0, e2 = 0;
        if (kind === 'interior') {
            u = 2 * (a1 + b1);
            J1 = d * a1 ** 3 / 6 + a1 * d ** 3 / 6 + d * b1 * a1 * a1 / 2;
            cc1 = a1 / 2;
            J2 = d * b1 ** 3 / 6 + b1 * d ** 3 / 6 + d * a1 * b1 * b1 / 2;
            cc2 = b1 / 2;
        } else if (kind === 'edge') {
            // Free edge parallel to L2; two sides of length a1, one of b1.
            u = 2 * a1 + b1;
            const xbar = (a1 * a1 + b1 * a1) / u;
            J1 = 2 * (d * a1 ** 3 / 12 + a1 * d ** 3 / 12 + a1 * d * (a1 / 2 - xbar) ** 2) + b1 * d * (a1 - xbar) ** 2;
            cc1 = a1 - xbar;
            e1 = Math.max(0, xbar - x_col);
        } else {
            // Corner: one side of a1 (along L1), one of b1 (along L2).
            u = a1 + b1;
            const xbar = (a1 * a1 / 2 + b1 * a1) / u;
            const ybar = (b1 * b1 / 2 + a1 * b1) / u;
            J1 = d * a1 ** 3 / 12 + a1 * d ** 3 / 12 + a1 * d * (a1 / 2 - xbar) ** 2 + b1 * d * (a1 - xbar) ** 2;
            cc1 = a1 - xbar;
            J2 = d * b1 ** 3 / 12 + b1 * d ** 3 / 12 + b1 * d * (b1 / 2 - ybar) ** 2 + a1 * d * (b1 - ybar) ** 2;
            cc2 = b1 - ybar;
            e1 = Math.max(0, xbar - x_col);
            e2 = Math.max(0, ybar - y_col);
        }
        // Moments about the critical-section centroid (kN·m)
        M1 = Math.max(0, M1 - V_kN * e1 / 1000);
        M2 = Math.max(0, M2 - V_kN * e2 / 1000);
        const g1 = gammaV(a1, b1), g2 = gammaV(b1, a1);
        const tau_direct = V_kN * 1000 / (u * d);
        const t1 = J1 > 0 ? g1 * M1 * 1e6 * cc1 / J1 : 0;
        const t2 = J2 > 0 ? g2 * M2 * 1e6 * cc2 / J2 : 0;
        // Interior columns: the two directions' pattern-load moments are not
        // concurrent → the larger governs. Corner columns: both concurrent.
        const tau_v = kind === 'corner' ? tau_direct + t1 + t2 : tau_direct + Math.max(t1, t2);
        punchingChecks.push({
            location, a1: round(a1, 0), b1: round(b1, 0), u: round(u, 0), d: round(d, 1),
            V: round(V_kN, 1), M1: round(M1, 1), M2: round(M2, 1),
            gammaV1: round(g1, 3), gammaV2: round(g2, 3),
            tau_v: round(tau_v, 3), tau_c: round(tau_c, 3), ok: tau_v <= tau_c,
        });
    };

    // Unbalanced moments at interior columns — Cl. 31.4.5.2 with equal
    // adjacent spans: M = 0.08·(0.5·wl)·l2·ln²/(1 + 1/αc). At the interior
    // column of an end span the difference of the two interior negative
    // moments is shared in proportion to stiffness (Cl. 31.4.3.4).
    const colShare = (a: number) => (a > 0 ? 1 / (1 + 1 / a) : 0);
    const Munb1 = Math.max(
        0.08 * 0.5 * wlu * L2 * Ln * Ln * colShare(alpha_c_int1),
        endSpan1 ? (co1.negInt - 0.65) * M0 * colShare(alpha_c_int1) : 0,
    );
    const Munb2 = Math.max(
        0.08 * 0.5 * wlu * L1 * Ln2 * Ln2 * colShare(alpha_c_int2),
        endSpan2 ? (co2.negInt - 0.65) * M0_2 * colShare(alpha_c_int2) : 0,
    );
    // End-span shear increase at the interior column from the moment gradient.
    const dV1 = endSpan1 ? (co1.negInt - co1.negExt) * M0 / Ln : 0;
    const dV2 = endSpan2 ? (co2.negInt - co2.negExt) * M0_2 / Ln2 : 0;

    const c1mm = c1 * 1000, c2mm = c2 * 1000;
    {
        const d = d_drop_avg;
        const a1 = c1mm + d, b1 = c2mm + d;
        const V = wu * (L1 * L2 - a1 * b1 / 1e6) + dV1 + dV2;
        addCheck('Interior column', 'interior', a1, b1, d, V, Munb1, Munb2, tau_c_col);
        if (hasDrop) {
            const ds = d_slab_avg;
            const A1 = dropL1 * 1000 + ds, B1 = dropL2 * 1000 + ds;
            const Vd = wu * (L1 * L2 - A1 * B1 / 1e6) + dV1 + dV2;
            addCheck('Outside drop (interior)', 'interior', A1, B1, ds, Vd, Munb1, Munb2,
                tauC(Math.min(dropL1, dropL2), Math.max(dropL1, dropL2)));
        }
    }
    const eo = e_o * 1000;
    if (panelType === 'exterior') {
        const d = d_drop_avg;
        const a1 = eo + c1mm + d / 2, b1 = c2mm + d;
        const V = wu * (L2 * (e_o + c1 / 2 + L1 / 2) - a1 * b1 / 1e6);
        addCheck('Edge column', 'edge', a1, b1, d, V, co1.negExt * M0, 0, tau_c_col, eo + c1mm / 2);
    }
    if (panelType === 'corner') {
        const d = d_drop_avg;
        const a1 = eo + c1mm + d / 2, b1 = eo + c2mm + d / 2;
        const V = wu * ((e_o + c1 / 2 + L1 / 2) * (e_o + c2 / 2 + L2 / 2) - a1 * b1 / 1e6);
        addCheck('Corner column', 'corner', a1, b1, d, V, co1.negExt * M0, co2.negExt * M0_2, tau_c_col,
            eo + c1mm / 2, eo + c2mm / 2);
    }
    const punching_safe = punchingChecks.every(p => p.ok);
    const govPunch = punchingChecks.reduce((g, p) => (p.tau_v / p.tau_c > g.tau_v / g.tau_c ? p : g), punchingChecks[0]);
    // Legacy scalar fields = governing check
    const tau_v = govPunch.tau_v;
    const tau_c = govPunch.tau_c;
    const crit_perimeter = govPunch.u / 1000;
    const shear_force = govPunch.V;

    // ── Flexural part of the moment transfer (Cl. 31.3.3) ───────────────────
    // (1 − γv)·M is carried by flexure within c2 + 1.5·D each side of the
    // column (D = drop depth where a drop is provided). The full column-face
    // moment is used here (conservative).
    const transferChecks: MomentTransferCheck[] = [];
    const transfer = (location: string, M: number, gv: number, band_m: number, z: ZoneSteel) => {
        if (M <= 0) return;
        const Mf = (1 - gv) * M;
        const r = flexuralDesignShared(Mf, band_m * 1000, z.d, fck, fy, D_neg);
        const avail = z.bars.Ast_provided * band_m;
        const req = r.Ast_req;
        transferChecks.push({
            location, bandWidth: round(band_m * 1000, 0), M_flex: round(Mf, 1),
            Ast_req: Math.round(req), Ast_available: Math.round(avail),
            Ast_extra: Math.max(0, Math.round(req - avail)), ok: !r.isDoubly,
        });
    };
    const Dt = D_neg / 1000;
    const intCheck = punchingChecks[0];
    transfer('Interior column', Munb1, gammaV(intCheck.a1, intCheck.b1), c2 + 3 * Dt, z1.negCol);
    const edgeCheck = punchingChecks.find(p => p.location === 'Edge column' || p.location === 'Corner column');
    if (edgeCheck && z1.negExtCol) {
        const band = panelType === 'corner' ? c2 + 1.5 * Dt + e_o : c2 + 3 * Dt;
        transfer(edgeCheck.location, co1.negExt * M0, gammaV(edgeCheck.a1, edgeCheck.b1), band, z1.negExtCol);
    }
    const transfer_ok = transferChecks.every(t => t.ok);
    const transferExtraSteel_kg = transferChecks.reduce((s, t) => s + t.Ast_extra * 2 * topLen1 * 7850 / 1e6, 0);

    // ── Deflection (IS 456 Annex C) — crossing strips ───────────────────────
    // Panel-centre deflection = column strip one way + middle strip the other
    // way; both combinations evaluated, the larger governs. Positive-moment
    // fractions as designed; α = 0.104(1 − β/10) with β from equilibrium.
    const w_service = w_total;
    const w_perm = w_dead;
    const posFrac1 = co1.pos;
    const posFrac2 = co2.pos;
    const cover2 = cover + phi;
    const Ast_req_defl_per_m = Number.isNaN(Ast_pos_col) || colStripWidth <= 0 ? 0 : Ast_pos_col / colStripWidth;
    const Ast_defl = Math.max(z1.posCol.bars.Ast_provided, Ast_req_defl_per_m);
    const stripDefl = (
        span: number, Ln_: number, trib: number, posFrac: number, share: number,
        width: number, cov: number, z: ZoneSteel, AstFloor: number,
    ) => {
        const M0_s = (w_service * trib * Ln_ * Ln_) / 8;
        const M0_p = (w_perm * trib * Ln_ * Ln_) / 8;
        const AstPerM = Math.max(Number.isNaN(z.Ast) ? 0 : z.Ast / width, z.bars.Ast_provided, AstFloor);
        return annexCDeflection(
            { Lx: span * 1000, D, cover: cov, fck, fy },
            {
                barDia_x_bot: phi,
                Ast_x_bot: AstPerM,
                Asc_x_top: 0,
                M_service: posFrac * share * M0_s / width,
                M_perm: posFrac * share * M0_p / width,
                supportCondition: deflSupport,
                beta: staticBeta(posFrac / 8),
            },
        );
    };
    const cs1 = stripDefl(L1, Ln, L2, posFrac1, 0.60, colStripWidth, cover, z1.posCol, Ast_defl);
    const ms1 = stripDefl(L1, Ln, L2, posFrac1, 0.40, midStripWidth, cover, z1.posMid, 0);
    const cs2 = stripDefl(L2, Ln2, L1, posFrac2, 0.60, colStripWidth2, cover2, z2.posCol, 0);
    const ms2 = stripDefl(L2, Ln2, L1, posFrac2, 0.40, midStripWidth2, cover2, z2.posMid, 0);
    const L_defl = Math.max(L1, L2) * 1000;  // panel-centre deflection judged on the longer span
    const comboA = combineStripDeflections([cs1, ms2], L_defl, input.camber ?? 0);
    const comboB = combineStripDeflections([cs2, ms1], L_defl, input.camber ?? 0);
    const deflection = comboA.a_total >= comboB.a_total ? comboA : comboB;
    const deflectionStrips = { cs1, ms1, cs2, ms2, governing: deflection === comboA ? 'cs(L1)+ms(L2)' : 'cs(L2)+ms(L1)' };
    const deflection_safe = deflection.status_total === 'OK' && deflection.status_post === 'OK';
    const Ld_actual = deflection.a_total;
    const Ld_max = deflection.limit_total;
    const mf = deflection.alpha;

    // ── Drop panels (Cl. 31.2.2) ────────────────────────────────────────────
    let dropChecks: {
        ok: boolean; planOk: boolean; projectionOk: boolean;
        dropL1_min: number; dropL2_min: number; projection: number; projection_min: number;
        messages: string[];
    } | null = null;
    if (hasDrop) {
        const projection = dropDepth - D;
        const dropL1_min = L1 / 3, dropL2_min = L2 / 3;
        const planOk = dropL1 >= dropL1_min - 1e-9 && dropL2 >= dropL2_min - 1e-9;
        const projectionOk = projection >= D / 4;
        const messages: string[] = [];
        if (!planOk) messages.push(
            `Drop ${dropL1}×${dropL2} m < l/3 = ${dropL1_min.toFixed(2)}×${dropL2_min.toFixed(2)} m (IS 456 Cl. 31.2.2)`);
        if (projection <= 0) messages.push(`Drop depth ${dropDepth} mm is not greater than the slab depth ${D} mm`);
        if (!projectionOk && projection > 0) messages.push(
            `Advisory: drop projects ${projection} mm < D/4 = ${Math.ceil(D / 4)} mm (ACI 318-19 Cl. 8.2.4; not an IS 456 requirement)`);
        dropChecks = {
            ok: planOk && projection > 0, planOk, projectionOk,
            dropL1_min: round(dropL1_min), dropL2_min: round(dropL2_min),
            projection, projection_min: Math.ceil(D / 4), messages,
        };
    }

    // ── Span/Depth Ratio — IS 456 Cl. 31.2.1 / 23.2 (informational) ─────────
    // Longer span; ratios × 0.9 unless drops conforming to Cl. 31.2.2 exist.
    const ldRaw: SpanDepthCheckResult = computeSpanDepthCheck({
        L: Math.max(L1, L2) * 1000,
        D, cover, fy,
        barDia: phi,
        AstProvided: Ast_defl,
        AstRequired: Ast_req_defl_per_m,
        supportType: deflSupport,
    });
    const ldFactor = hasDrop && dropChecks?.planOk ? 1.0 : 0.9;
    const ldCheck: SpanDepthCheckResult = {
        ...ldRaw,
        modifiedRatio: round(ldRaw.modifiedRatio * ldFactor, 1),
        d_req: round(ldRaw.d_req / ldFactor, 1),
        note: ldFactor < 1
            ? `${ldRaw.note}; ×0.9 (no drops conforming to Cl. 31.2.2), longer span (Cl. 31.2.1)`
            : `${ldRaw.note}; longer span (Cl. 31.2.1)`,
    };

    // ── Minimum thickness (Cl. 31.2.1) ──────────────────────────────────────
    const MIN_FLAT_SLAB_THICKNESS = 125;
    const thicknessOk = D >= MIN_FLAT_SLAB_THICKNESS;
    const thicknessCheck = {
        ok: thicknessOk,
        D,
        D_min: MIN_FLAT_SLAB_THICKNESS,
        message: thicknessOk ? '' : `Slab thickness ${D}mm < ${MIN_FLAT_SLAB_THICKNESS}mm (IS 456 Cl. 31.2.1)`,
    };

    // ── Direct design method limitations (Cl. 31.4.1) ───────────────────────
    const nS1 = input.nSpansL1 ?? 3, nS2 = input.nSpansL2 ?? 3;
    const spansOk = nS1 >= 3 && nS2 >= 3;                                  // (a)
    const aspect = Math.max(L1, L2) / Math.min(L1, L2);
    const aspectOk = aspect <= 2.0;                                        // (b)
    const loadRatio = w_live / w_dead;
    const loadOk = w_live <= 3 * w_dead;                                   // (e)
    const ddmChecks = {
        ok: spansOk && aspectOk && loadOk,
        spansOk, aspectOk, loadOk,
        nSpansL1: nS1, nSpansL2: nS2,
        aspect: round(aspect, 2), loadRatio: round(loadRatio, 2),
        messages: [] as string[],
    };
    if (!spansOk) ddmChecks.messages.push(`DDM needs ≥ 3 continuous spans each way (Cl. 31.4.1 a) — use the equivalent frame method (Cl. 31.5)`);
    if (!aspectOk) ddmChecks.messages.push(`Long/short span ${aspect.toFixed(2)} > 2.0 (Cl. 31.4.1 b)`);
    if (!loadOk) ddmChecks.messages.push(`Live load ${w_live} > 3 × dead load ${w_dead.toFixed(2)} kN/m² (Cl. 31.4.1 e)`);
    ddmChecks.messages.push('Confirm: column offsets ≤ 10 % of span (Cl. 31.4.1 c) and successive spans differ by ≤ 1/3 of the longer (Cl. 31.4.1 d).');
    if (w_live / w_dead > 0.5) warnings.push(
        `Live/dead = ${loadRatio.toFixed(2)} > 0.5: check αc ≥ αc,min for pattern loading (Cl. 31.4.6) — not evaluated here.`);

    // ── Reinforcement detailing checks (Cl. 26.3.3 + 26.5) ──────────────────
    const standardDias = [8, 10, 12, 16, 20, 25, 32].filter(x => x <= maxBarDia);
    const largestBar = standardDias.length > 0 ? standardDias[standardDias.length - 1] : 8;
    const maxAstPerM = Math.PI * largestBar * largestBar / 4 * (1000 / 75);
    const barChecks = {
        maxBarDia: Math.floor(maxBarDia),
        maxSpacingMain: Math.floor(maxSpacingMain),
        maxAstPerM: Math.round(maxAstPerM),
        astFeasible: allZones.every(z => Number.isNaN(z.Ast) || z.Ast / z.width <= maxAstPerM),
    };

    const totalAstPerPanel = Ast_neg_col + Ast_pos_col + Ast_neg_mid + Ast_pos_mid + Ast_negExt_col;

    const overallStatus: 'SAFE' | 'REVISE' =
        (thicknessOk && punching_safe && deflection_safe && allAstFinite && barChecks.astFeasible
            && providedSteelCheck.ok && transfer_ok && ddmChecks.ok && (!dropChecks || dropChecks.ok))
            ? 'SAFE' : 'REVISE';

    return {
        Ln, Ln2,
        W,
        M0, M0_2,
        wu, w_dead, w_drop,
        panelType,
        coefficients: {
            dir1: { ...co1, alpha_c_ext: round(alpha_c_ext1, 3), alpha_c_int: round(alpha_c_int1, 3) },
            dir2: { ...co2, alpha_c_ext: round(alpha_c_ext2, 3), alpha_c_int: round(alpha_c_int2, 3) },
        },
        colStripWidth,
        midStripWidth,
        M_neg_col,
        M_pos_col,
        M_neg_mid,
        M_pos_mid,
        M_negExt_col,
        M_negExt_mid,
        Ast_neg_col,
        Ast_pos_col,
        Ast_neg_mid,
        Ast_pos_mid,
        Ast_negExt_col,
        zones: { dir1: z1, dir2: z2 },
        dir2: {
            colStripWidth: colStripWidth2, midStripWidth: midStripWidth2,
            M_neg_col: z2.negCol.M, M_pos_col: z2.posCol.M, M_neg_mid: z2.negMid.M, M_pos_mid: z2.posMid.M,
            M_negExt_col: z2.negExtCol?.M ?? 0,
            Ast_neg_col: z2.negCol.Ast, Ast_pos_col: z2.posCol.Ast, Ast_neg_mid: z2.negMid.Ast, Ast_pos_mid: z2.posMid.Ast,
            Ast_negExt_col: z2.negExtCol?.Ast ?? 0,
        },
        providedSteelCheck,
        steelWeight_kg: steelWeight_kg + transferExtraSteel_kg,
        // punching (legacy scalars = governing check)
        punchingChecks,
        crit_perimeter,
        shear_force,
        tau_v,
        tau_c,
        punching_safe,
        transferChecks,
        d_slab,
        d_slab2,
        d_slab_avg,
        d_drop,
        d_drop_avg,
        // deflection (Annex C)
        deflection,
        deflection_safe,
        deflectionStrips,
        Ld_actual,  // = a_total (mm) for UI compat
        Ld_max,     // = limit_total (mm) for UI compat
        mf,         // = alpha of the governing strip
        ldCheck,
        // feasibility
        allAstFinite,
        overallStatus,
        thicknessCheck,
        dropChecks,
        ddmChecks,
        barChecks,
        warnings,
        deflectionSupport: deflSupport,
        totalAstPerPanel,
    };
}

function prefix<T extends Record<string, ZoneSteel | null>>(o: T, p: string): Record<string, ZoneSteel | null> {
    const out: Record<string, ZoneSteel | null> = {};
    for (const [k, v] of Object.entries(o)) out[p + k] = v;
    return out;
}

// ═══════════════════════════════════════════════════════════════
//  FLAT SLAB OPTIMIZER — minimum cost (concrete + steel + formwork)
//  Sweeps slab depth D, the drop depth (if any) and the column-strip
//  bottom bars. A design is kept only if analyzeFlatSlab reports SAFE,
//  which includes the check that every zone's bars reach the steel
//  required. Steel is the PROVIDED steel of all zones in both
//  directions; the wastage factor is applied once (in computeCost).
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
    const D_min = Math.max(125, Math.ceil((d_min + 30) / 10) * 10);
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
    steelWeight_net:    number;   // kg per panel (provided bars)
    steelWeight_gross:  number;   // kg per panel incl. wastage factor
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
    Ds = Ds.filter(d => d >= 125);   // IS 456 Cl. 31.2.1

    const hasDrop = input.hasDrop;
    const dropDepths: number[] = [];
    if (hasDrop && params.minDropDepth !== undefined && params.maxDropDepth !== undefined && params.stepDropDepth !== undefined) {
        for (let v = params.minDropDepth; v <= params.maxDropDepth + 1e-6; v += params.stepDropDepth) dropDepths.push(Math.round(v));
    } else {
        dropDepths.push(0);
    }

    const barDias = params.barDias ?? [10, 12, 16];
    const barSpacings = params.barSpacings ?? [100, 125, 150, 175, 200, 250];
    const fw = costParams.wastage_factor ?? 1.07;

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
                            ...input, D, dropDepth: actualDropDepth,
                            bar_dia: dia, bar_spacing: spacing,
                            camber: input.camber ?? 0,
                        };
                        let res = analyzeFlatSlab(trialInput);

                        if (res.overallStatus !== 'SAFE' && res.barChecks.astFeasible && !res.deflection_safe) {
                            const reqCamber = getRequiredDeflectionCamber(res.deflection, 5);
                            if (reqCamber > 0 && reqCamber <= 20) {
                                const withCamber = analyzeFlatSlab({ ...trialInput, camber: reqCamber });
                                if (withCamber.overallStatus === 'SAFE') res = withCamber;
                            }
                        }
                        if (res.overallStatus !== 'SAFE') continue;

                        const slabVol = (D / 1000) * input.L1 * input.L2;
                        const dropExtraVol = hasDrop ? ((actualDropDepth - D) / 1000) * input.dropL1 * input.dropL2 : 0;
                        const concreteVol = slabVol + dropExtraVol;
                        const steelWeight_net = res.steelWeight_kg;
                        const slabArea_m2 = input.L1 * input.L2;

                        const costTotal_INR = computeCost(concreteVol, steelWeight_net, slabArea_m2, costParams);
                        const concrete_INR = concreteVol * (costParams.concreteCost_per_m3 ?? 6500);
                        const steel_INR = steelWeight_net * (costParams.steelCost_per_kg ?? 82) * fw;
                        const formwork_INR = slabArea_m2 * (costParams.formworkCost_per_m2 ?? 350);

                        // Flexure utilization: max over all zones of M / capacity of the provided bars.
                        const zones = [...Object.values(res.zones.dir1), ...Object.values(res.zones.dir2)]
                            .filter((z): z is NonNullable<typeof z> => z !== null && z.M > 0);
                        const flexure_u = zones.reduce((m, z) => Math.max(m, z.capacity > 0 ? z.M / z.capacity : Infinity), 0);
                        const deflection_u = res.deflection.a_total / res.deflection.limit_total;
                        const shear_u = res.punchingChecks.reduce((m, p) => Math.max(m, p.tau_v / p.tau_c), 0);

                        results.push({
                            D, dropDepth: actualDropDepth, bar_dia: dia, bar_spacing: spacing,
                            camber: res.deflection.camber ?? 0,
                            costTotal_INR,
                            costBreakdown: { concrete_INR, steel_INR, formwork_INR },
                            steelWeight_net, steelWeight_gross: steelWeight_net * fw, concreteVol,
                            utilizationRatio: { flexure: flexure_u, deflection: deflection_u, shear: shear_u },
                            result: res,
                        });
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
