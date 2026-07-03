import katex from 'katex';
import { logger } from '../lib/logger';
import { REPORT_CSS, FIT_FORMULAS_SCRIPT, inputTable, calcRow } from './reportCss';
import { WaffleSlabInput } from './waffleSlabEngine';

// ═══════════════════════════════════════════════════════════════
//  WAFFLE SLAB REPORT GENERATOR — IS 456:2000
//  Replaces the previous "coming soon" stub with a full KaTeX-rendered
//  HTML report covering the Rankine-Grashoff load sharing, per-rib
//  T-beam design (with NA-in-flange check + T-beam fallback), and
//  topping slab design.
// ═══════════════════════════════════════════════════════════════

const kx = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: true, flexn: true });
const kxInline = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: false });

function statusChip(ok: boolean, label: string): string {
    const cls = ok ? '#10b981' : '#ef4444';
    return `<span style="color: ${cls}; font-weight: bold;">${label}</span>`;
}

// ─── IS 456 Cl. 30.5 (ribbed/waffle slab geometry) status block ─────────
// Prints a checker-friendly compliance row for every Cl. 30.5 sub-limit
// plus the topping minimum thickness (Cl. 30.3 / topping span between ribs).
// Driven entirely by `result.ribGeometryCheck` produced by waffleSlabEngine,
// so no recalculation happens inside the report layer.
function cl305StatusBlock(rg: any): string {
    if (!rg) return '';
    const row = (label: string, ok: boolean, actual: string, limit: string, clause: string): string => `
        <tr>
            <td style="padding:4px 8px;">${label}</td>
            <td style="padding:4px 8px;">${actual}</td>
            <td style="padding:4px 8px;">${limit}</td>
            <td style="padding:4px 8px;">${statusChip(ok, ok ? 'OK' : 'FAIL')}</td>
            <td style="padding:4px 8px;color:#64748b;font-size:11px;">${clause}</td>
        </tr>`;
    const overallOk = rg.bwOk && rg.spacingOk && rg.depthOk && rg.toppingOk;
    return `
        <div class="section-box avoid-break">
            <div class="section-header">IS 456 Cl. 30.5 — Ribbed-Slab Geometry Compliance &nbsp; ${statusChip(overallOk, overallOk ? 'COMPLIANT' : 'NON-COMPLIANT')}</div>
            <div class="section-body">
                <p style="font-size:12px;color:#64748b;margin:0 0 6px 0;">
                    Cl. 30.5 imposes <strong>hard</strong> code limits on rib width, c/c spacing, and
                    rib depth. A section that fails any of these is <em>not</em> a waffle slab per IS 456
                    and must be revised — it is not a serviceability warning.
                </p>
                <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
                    <thead>
                        <tr style="background:#f1f5f9;">
                            <th style="padding:4px 8px;text-align:left;">Check</th>
                            <th style="padding:4px 8px;text-align:left;">Provided</th>
                            <th style="padding:4px 8px;text-align:left;">Code Limit</th>
                            <th style="padding:4px 8px;text-align:left;">Status</th>
                            <th style="padding:4px 8px;text-align:left;">Clause</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${row('Rib width, b<sub>w</sub>',
                              rg.bwOk,
                              `${rg.bw} mm`,
                              `&ge; ${rg.bw_min} mm`,
                              'Cl. 30.5')}
                        ${row('Rib c/c spacing (max)',
                              rg.spacingOk,
                              `${Math.max(rg.spacing_x_mm, rg.spacing_y_mm)} mm`,
                              `&le; ${rg.spacing_cc_max} mm`,
                              'Cl. 30.5')}
                        ${row('Rib depth, D<sub>r</sub> = D &minus; D<sub>f</sub>',
                              rg.depthOk,
                              `${rg.Dr} mm`,
                              `&le; 4&middot;b<sub>w</sub> = ${rg.Dr_max} mm`,
                              'Cl. 30.5')}
                        ${row('Topping thickness, D<sub>f</sub>',
                              rg.toppingOk,
                              `${rg.Df} mm`,
                              `&ge; max(50, clearSpacing/12 = ${rg.Df_min_geom}) = ${Math.round(rg.Df_min)} mm`,
                              'Cl. 30.3')}
                    </tbody>
                </table>
                ${(rg.messages && rg.messages.length > 0) ? `
                    <div style="margin-top:8px;padding:6px 10px;background:#fef2f2;border-left:3px solid #ef4444;font-size:12px;color:#991b1b;">
                        <strong>Non-compliance notes:</strong>
                        <ul style="margin:4px 0 0 18px;padding:0;">
                            ${rg.messages.map((m: string) => `<li>${m}</li>`).join('')}
                        </ul>
                    </div>` : ''}
            </div>
        </div>
    `;
}

function ribSection(label: string, M: number, V: number, rib: any, bf_m: number, input: WaffleSlabInput): string {
    const { spacing_x, spacing_y, bw, D, Df, cover, fck, fy } = input;
    const d = D - cover - 10;
    return `
        <div class="section-box avoid-break">
            <div class="section-header">${label}</div>
            <div class="section-body">
                ${calcRow('Moment per rib, M', `${M.toFixed(1)} kN·m`, '')}
                ${calcRow('Shear per rib, V', `${V.toFixed(1)} kN`, '')}
                ${kx(`d = D - \\text{cover} - 10 = ${D} - ${cover} - 10 = ${d} \\text{ mm}`)}
                ${kx(`b_f = ${bf_m} \\text{ m} = ${bf_m * 1000} \\text{ mm} \\text{ (flange width = spacing)}`)}
                <p style="font-size:12px;color:#64748b;margin:4px 0;">
                    Initial assumption: NA within flange → rectangular design of width b<sub>f</sub>.
                </p>
                ${kx(`A_{st,req} = \\frac{0.5 f_{ck}}{f_y} \\left[ 1 - \\sqrt{1 - \\frac{4.6 M}{f_{ck} b_f d^2}} \\right] b_f d`)}
                <div class="calc-block">
                    ${Number.isNaN(rib.Ast_req)
                        ? '<span style="color:#ef4444;font-weight:bold;">Section FAILS — NA outside limit. Revise section.</span>'
                        : kxInline(`A_{st,req} = ${rib.Ast_req.toFixed(0)} \\text{ mm}^2`)}
                    <br/>
                    ${kxInline(`x_u = \\frac{0.87 f_y A_{st}}{0.36 f_{ck} b_f} = ${(0.87 * fy * (rib.Ast_req || 0) / (0.36 * fck * bf_m * 1000)).toFixed(1)} \\text{ mm}`)}
                    ${rib.NA_in_flange
                        ? `&nbsp; ${kxInline(`\\leq D_f = ${Df} \\text{ mm}`)} &nbsp; ✓ NA in flange`
                        : `&nbsp; ${kxInline(`> D_f = ${Df} \\text{ mm}`)} &nbsp; ⚠ NA in web — T-beam design applied`}
                </div>
                ${!rib.NA_in_flange && !Number.isNaN(rib.Ast_req) ? `
                    <p style="font-size:12px;color:#64748b;margin:4px 0;">
                        T-beam stress block: C = 0.36·f<sub>ck</sub>·b<sub>w</sub>·x<sub>u</sub> + 0.45·f<sub>ck</sub>·(b<sub>f</sub>−b<sub>w</sub>)·D<sub>f</sub>.
                        Re-solved quadratic for x<sub>u</sub>, then A<sub>st</sub> = C/(0.87·f<sub>y</sub>).
                    </p>
                ` : ''}
                ${kx(`A_{st,min} = 0.0012 \\times b_w \\times d = ${rib.Ast_min.toFixed(0)} \\text{ mm}^2`)}
                <div class="provided-box">
                    <strong>Provided A<sub>st</sub>:</strong> ${rib.Ast_req.toFixed(0)} mm² (≥ min: ${rib.Ast_req >= rib.Ast_min ? 'OK' : 'LOW'})
                </div>
            </div>
        </div>
        <div class="section-box avoid-break">
            <div class="section-header">Shear Check (per web width b<sub>w</sub> = ${bw} mm) — critical section at d<sub>eff</sub> from face of support (Cl. 40.1.1)</div>
            <div class="section-body">
                <p style="margin-top:0; color:#475569; font-size:13px;">
                    Per IS 456 Cl. 40.1.1, the critical section for shear is at a distance d<sub>eff</sub> from
                    the face of the support. V<sub>u,crit</sub> = V<sub>support</sub> − w<sub>rib</sub>·d<sub>eff</sub> governs the τ<sub>v</sub> check.
                </p>
                ${kx(`d_{eff} = ${rib.d_eff} \\text{ mm}, \\quad V_{support} = ${rib.V.toFixed(1)} \\text{ kN}`)}
                ${kx(`V_{u,crit} = ${rib.V.toFixed(1)} - w_{rib} \\cdot d_{eff} = ${rib.V_critical.toFixed(2)} \\text{ kN}`)}
                ${kx(`\\tau_v = \\frac{V_{u,crit}}{b_w d_{eff}} = \\frac{${rib.V_critical.toFixed(2)} \\times 1000}{${bw} \\times ${rib.d_eff}} = ${rib.tau_v.toFixed(3)} \\text{ N/mm}^2`)}
                ${kx(`\\tau_c = \\frac{0.85\\sqrt{0.8 f_{ck}}(\\sqrt{1+5\\beta}-1)}{6\\beta} = ${rib.tau_c.toFixed(3)} \\text{ N/mm}^2`)}
                ${kx(`\\tau_{c,max} = ${rib.tau_c_max.toFixed(3)} \\text{ N/mm}^2 \\quad \\text{(IS 456 Table 20)}`)}
                <div style="margin-top:6px;">
                    ${rib.shear_safe
                        ? `${statusChip(true, 'SAFE')} &nbsp; ${kxInline(`\\tau_v = ${rib.tau_v.toFixed(3)} \\leq \\tau_c = ${rib.tau_c.toFixed(3)}`)}`
                        : rib.shear_over_max
                            ? `${statusChip(false, 'FAIL')} &nbsp; ${kxInline(`\\tau_v = ${rib.tau_v.toFixed(3)} > \\tau_{c,max} = ${rib.tau_c_max.toFixed(3)}`)} — REVISE SECTION`
                            : `${statusChip(false, 'NEEDS LINKS')} &nbsp; ${kxInline(`\\tau_c < \\tau_v = ${rib.tau_v.toFixed(3)} \\leq \\tau_{c,max}`)} — provide shear reinforcement`}
                </div>
            </div>
        </div>
    `;
}

export async function generateWaffleSlabPDF(input: WaffleSlabInput, results: any, preview: boolean = false): Promise<string | null> {
    const { Lx, Ly, spacing_x, spacing_y, bw, D, Df, cover, fck, fy, w_live, w_finish } = input;
    const r = results;

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Waffle Slab Design Report</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css" />
            ${REPORT_CSS}
        </head>
        <body>
            <div class="report-container">
                <div class="report-header">
                    <h1>Waffle Slab Design Report</h1>
                    <p>Grid Floor &mdash; IS 456:2000 | Generated: ${new Date().toLocaleString()}</p>
                </div>

                <h2>1. Input Parameters</h2>
                ${inputTable([
                    ['Short Span, L<sub>x</sub>', `${Lx} m`, 'Long Span, L<sub>y</sub>', `${Ly} m`],
                    ['Rib spacing (‖ X)', `${spacing_x} m`, 'Rib spacing (‖ Y)', `${spacing_y} m`],
                    ['Rib width, b<sub>w</sub>', `${bw} mm`, 'Overall Depth, D', `${D} mm`],
                    ['Topping Thickness, D<sub>f</sub>', `${Df} mm`, 'Clear Cover', `${cover} mm`],
                    ['Concrete, f<sub>ck</sub>', `${fck} N/mm²`, 'Steel, f<sub>y</sub>', `${fy} N/mm²`],
                    ['Live Load', `${w_live} kN/m²`, 'Floor Finish', `${w_finish} kN/m²`],
                ])}

                <h2>1A. IS 456 Cl. 30.5 &mdash; Ribbed-Slab Geometry Check</h2>
                ${cl305StatusBlock(r.ribGeometryCheck)}

                <h2>2. Effective Depth &amp; Self-Weight</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Section Properties</div>
                    <div class="section-body">
                        ${kx(`d = D - \\text{cover} - 10 = ${D} - ${cover} - 10 = ${(D - cover - 10)} \\text{ mm}`)}
                        ${kx(`D_r = D - D_f = ${D} - ${Df} = ${D - Df} \\text{ mm (rib depth)}`)}
                        <p style="font-size:12px;color:#64748b;margin:4px 0 0 0;">Self-weight computed from solid volume minus void volume per unit cell.</p>
                        ${calcRow('Eq. self-weight (w_dead)', `${r.w_dead.toFixed(2)}`, 'kN/m²')}
                        ${kx(`w_u = 1.5 \\times (w_{dead} + w_{live} + w_{finish}) = ${r.wu.toFixed(2)} \\text{ kN/m}^2`)}
                    </div>
                </div>

                <h2>3. Load Sharing &mdash; Rankine-Grashoff Method</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Biaxial Load Distribution</div>
                    <div class="section-body">
                        ${kx(`q_x = w_u \\cdot \\frac{L_y^4}{L_x^4 + L_y^4} = ${r.qx.toFixed(2)} \\text{ kN/m}^2`)}
                        ${kx(`q_y = w_u \\cdot \\frac{L_x^4}{L_x^4 + L_y^4} = ${r.qy.toFixed(2)} \\text{ kN/m}^2`)}
                        <p style="font-size:12px;color:#64748b;margin:4px 0 0 0;">Load shared inversely proportional to L⁴ (simply-supported grid approximation).</p>
                        ${kx(`M_{x,/m} = \\frac{q_x L_x^2}{8} = ${r.Mx_per_m.toFixed(2)} \\text{ kN·m/m}, \\quad M_{y,/m} = \\frac{q_y L_y^2}{8} = ${r.My_per_m.toFixed(2)} \\text{ kN·m/m}`)}
                        ${kx(`M_{rib,x} = M_{x,/m} \\times s_y = ${r.M_rib_x.toFixed(2)} \\text{ kN·m}, \\quad M_{rib,y} = M_{y,/m} \\times s_x = ${r.M_rib_y.toFixed(2)} \\text{ kN·m}`)}
                        ${kx(`V_{rib,x} = \\frac{q_x L_x}{2} \\times s_y = ${r.V_rib_x.toFixed(2)} \\text{ kN}, \\quad V_{rib,y} = \\frac{q_y L_y}{2} \\times s_x = ${r.V_rib_y.toFixed(2)} \\text{ kN}`)}
                    </div>
                </div>

                <h2>4. Rib Design (T-Beam)</h2>
                <p style="font-size:13px;color:#475569;">
                    Each rib designed as a T-beam with flange width = rib spacing.
                    Neutral-axis check performed; T-beam stress block applied when x<sub>u</sub> &gt; D<sub>f</sub>.
                </p>
                ${ribSection('Ribs Parallel to X (Short Span)', r.M_rib_x, r.V_rib_x, r.ribX, spacing_y, input)}
                <div style="page-break-before: always;"></div>
                ${ribSection('Ribs Parallel to Y (Long Span)', r.M_rib_y, r.V_rib_y, r.ribY, spacing_x, input)}

                <h2>5. Topping Slab Design</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Topping (Continuous Slab between Ribs — BOTH Faces Designed)</div>
                    <div class="section-body">
                        <p style="margin-top:0; color:#475569; font-size:13px;">
                            The topping spans continuously between rib top flanges and is designed as
                            a continuous one-way slab on both faces (IS 456 Cl. 22.5 coefficients):
                            positive moment at mid-span (bottom mat) and negative moment over the rib
                            (top mat). The earlier single-mat × w·L²/10 approximation has been replaced.
                        </p>
                        ${kx(`\\text{topping span} = \\max(s_x, s_y) - b_w/1000 = ${r.topping_span.toFixed(2)} \\text{ m}`)}
                        ${kx(`M^+_{topping} = \\frac{w_u \\cdot L^2}{16} = ${r.topping_M_pos.toFixed(2)} \\text{ kN·m/m} \\quad \\text{(bottom mat, mid-span)}`)}
                        ${kx(`M^-_{topping} = \\frac{w_u \\cdot L^2}{12} = ${r.topping_M_neg.toFixed(2)} \\text{ kN·m/m} \\quad \\text{(top mat, over rib)}`)}
                        ${kx(`A_{st,topping,bot} = ${r.Ast_topping_bot.toFixed(0)} \\text{ mm}^2\\text{/m}, \\quad A_{st,topping,top} = ${r.Ast_topping_top.toFixed(0)} \\text{ mm}^2\\text{/m}`)}
                        <div class="provided-box">
                            ${kxInline(`A_{st,topping,min,total} = 0.0012 \\times 1000 \\times D_f = ${(0.0012 * 1000 * Df).toFixed(0)} \\text{ mm}^2\\text{/m (split per face)}`)}
                        </div>
                    </div>
                </div>

                <h2>6. Deflection Check &mdash; IS 456 Annex C (T-Beam: rib + topping)</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Combined Rib + Flange T-Section Transformed Analysis</div>
                    <div class="section-body">
                        <p style="margin-top:0; color:#475569; font-size:13px;">
                            The deflection is computed on the COMBINED rib + topping as a T-beam
                            transformed section (per ACI 318 / StructurePoint waffle slab guide +
                            IS 456 Annex C). The rib reinforcement directly controls I_cr and I_eff.
                            The governing rib (larger Ast demand) is analyzed with its actual T-section
                            geometry (bf = spacing, Df = topping, bw = rib width, D = overall depth).
                        </p>
                        ${kx(`E_c = ${r.deflection.Ec} \\text{ N/mm}^2, \\quad m = ${r.deflection.m}, \\quad M_{cr} = ${r.deflection.Mcr.toFixed(2)} \\text{ kN·m}`)}
                        ${kx(`A_{st,bot} = ${r.Ast_rib_provided.toFixed(0)} \\text{ mm}^2, \\quad A_{sc,top} = ${(r.Asc_rib_provided ?? 0).toFixed(0)} \\text{ mm}^2 \\quad \\text{(both rib reinforcements included per PI-EX-106A)}`)}
                        ${kx(`p_t = ${r.deflection.pt}\\%, \\quad p_c = ${r.deflection.pc}\\%`)}
                        ${kx(`x = ${r.deflection.x} \\text{ mm (NA depth)}, \\quad ${r.deflection.x <= Df ? '\\text{NA in flange (rectangular)}' : '\\text{NA in web (true T-beam)}'}`)}
                        ${kx(`I_{gr} = ${(r.deflection.Igr/1e6).toFixed(2)}\\times 10^6, \\quad I_{cr} = ${(r.deflection.Icr/1e6).toFixed(2)}\\times 10^6, \\quad I_{eff} = ${(r.deflection.Ieff/1e6).toFixed(2)}\\times 10^6 \\text{ mm}^4`)}
                        ${kx(`a_i = ${r.deflection.ai.toFixed(2)} \\text{ mm (short-term)}, \\quad a_{shrinkage} = ${r.deflection.a_shrinkage.toFixed(2)} \\text{ mm}, \\quad a_{creep} = ${r.deflection.a_creep.toFixed(2)} \\text{ mm}`)}
                        ${r.deflection.camber > 0 ? kx(`a_{camber} = ${r.deflection.camber.toFixed(2)} \\text{ mm (upward)}`) : ''}
                        ${kx(`a_{total,net} = ${r.deflection.a_total.toFixed(2)} \\text{ mm} \\quad \\text{vs} \\quad L/250 = ${r.deflection.limit_total.toFixed(2)} \\text{ mm}`)}
                        ${kx(`a_{post,net} = ${r.deflection.a_post_construction.toFixed(2)} \\text{ mm} \\quad \\text{vs} \\quad L/350 = ${r.deflection.limit_post.toFixed(2)} \\text{ mm}`)}
                        <div style="margin-top:6px;">
                            ${r.deflection_safe
                                ? `${statusChip(true, 'SAFE')} &nbsp; Total ${r.deflection.a_total.toFixed(2)} ≤ ${r.deflection.limit_total.toFixed(2)} mm`
                                : `${statusChip(false, 'REVISE')} &nbsp; ${r.deflection.status_total === 'FAIL' ? `Total ${r.deflection.a_total.toFixed(2)} > ${r.deflection.limit_total.toFixed(2)} mm` : `Post-construction ${r.deflection.a_post_construction.toFixed(2)} > ${r.deflection.limit_post.toFixed(2)} mm`}`}
                        </div>
                    </div>
                </div>

                <h2>7. Span/Depth Ratio &mdash; IS 456 Cl. 23.2 (informational)</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Simplified L/d Check (governing rib) &mdash; IGNORED for design (Annex C governs)</div>
                    <div class="section-body">
                        <p style="margin-top:0; color:#475569; font-size:13px;">
                            Computed for all slabs per user request. The status is IGNORED because the rigorous
                            Annex C T-beam deflection check governs the design.
                        </p>
                        ${kx(`\\text{Basic } l/d = ${r.ldCheck.basicRatio} \\quad (\\text{support: } ${r.deflectionSupport})`)}
                        ${kx(`f_s = ${r.ldCheck.fs} \\text{ N/mm}^2, \\quad p_t = ${r.ldCheck.pt}\\%`)}
                        ${kx(`\\text{Modification factor} = ${r.ldCheck.mf}, \\quad \\text{Modified } l/d = ${r.ldCheck.modifiedRatio}`)}
                        ${kx(`d_{req} = ${r.ldCheck.d_req} \\text{ mm}, \\quad d_{provided} = ${r.ldCheck.d_provided} \\text{ mm}`)}
                        <div style="margin-top:6px;">
                            <span style="color:#64748b; font-weight:bold; border:1px solid #cbd5e1; padding:2px 10px; border-radius:4px;">IGNORED</span>
                            &mdash; Annex C governs
                        </div>
                    </div>
                </div>

                <h2>8. Summary</h2>
                <table class="result-table">
                    <thead><tr><th>Element</th><th>A<sub>st,req</sub> (mm²)</th><th>τ<sub>v</sub> (N/mm²)</th><th>τ<sub>c</sub> (N/mm²)</th><th>Shear</th></tr></thead>
                    <tbody>
                        <tr><td>Rib ‖ X (short)</td><td>${Number.isNaN(r.ribX.Ast_req) ? 'Fails' : r.ribX.Ast_req.toFixed(0)}</td><td>${r.ribX.tau_v.toFixed(3)}</td><td>${r.ribX.tau_c.toFixed(3)}</td><td>${r.ribX.shear_safe ? statusChip(true,'OK') : (r.ribX.shear_over_max ? statusChip(false,'FAIL') : statusChip(false,'LINKS'))}</td></tr>
                        <tr><td>Rib ‖ Y (long)</td><td>${Number.isNaN(r.ribY.Ast_req) ? 'Fails' : r.ribY.Ast_req.toFixed(0)}</td><td>${r.ribY.tau_v.toFixed(3)}</td><td>${r.ribY.tau_c.toFixed(3)}</td><td>${r.ribY.shear_safe ? statusChip(true,'OK') : (r.ribY.shear_over_max ? statusChip(false,'FAIL') : statusChip(false,'LINKS'))}</td></tr>
                        <tr><td>Topping (bottom mat)</td><td>${r.Ast_topping_bot.toFixed(0)} mm²/m</td><td>—</td><td>—</td><td>—</td></tr>
                        <tr><td>Topping (top mat)</td><td>${r.Ast_topping_top.toFixed(0)} mm²/m</td><td>—</td><td>—</td><td>—</td></tr>
                        <tr><td>Span/Depth (Cl. 23.2)</td><td>d<sub>prov</sub>=${r.ldCheck.d_provided} mm</td><td>—</td><td>d<sub>req</sub>=${r.ldCheck.d_req} mm</td><td><span style="color:#64748b; font-weight:bold;">IGNORED</span></td></tr>
                    </tbody>
                </table>

                <div class="info-note" style="margin-top:20px;">
                    <strong>Disclaimer:</strong> Outputs are for preliminary design only and must be independently
                    verified by a qualified licensed structural engineer before use. Waffle-slab load sharing uses
                    the Rankine-Grashoff approximation (simply-supported boundaries); for continuous waffle slabs
                    a finite-element or equivalent-frame analysis is recommended.
                </div>
            </div>
            ${FIT_FORMULAS_SCRIPT}
        </body>
        </html>
    `;

    return printHtml(htmlContent, preview);
}

async function printHtml(htmlContent: string, preview: boolean = false): Promise<string | null> {
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    if (preview) {
        window.open(blobUrl, '_blank');
        setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch { /* noop */ } }, 60000);
        return blobUrl;
    }

    return new Promise<null>((resolve) => {
        let settled = false;
        const cleanup = (frame: any) => {
            if (settled) return;
            settled = true;
            try { if (frame && frame.parentNode) document.body.removeChild(frame); } catch { /* noop */ }
            try { URL.revokeObjectURL(blobUrl); } catch { /* noop */ }
            resolve(null);
        };

        const iframe = document.createElement('iframe');
        iframe.style.position = 'absolute';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';

        iframe.onload = () => {
            try {
                iframe.contentWindow?.focus();
                iframe.contentWindow?.print();
            } catch (e) {
                logger.error('Waffle slab print failed, falling back to new tab', e);
                window.open(blobUrl, '_blank');
            }
            setTimeout(() => cleanup(iframe), 2000);
        };

        document.body.appendChild(iframe);
        iframe.src = blobUrl;
        setTimeout(() => { if (!settled) cleanup(iframe); }, 5000);
    });
}
