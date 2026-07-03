import katex from 'katex';
import { logger } from '../lib/logger';
import { REPORT_CSS, FIT_FORMULAS_SCRIPT, inputTable, calcRow } from './reportCss';
import { FlatSlabInput } from './flatSlabEngine';

// ═══════════════════════════════════════════════════════════════
//  FLAT SLAB REPORT GENERATOR — IS 456:2000 Cl. 31 (DDM)
//  Replaces the previous "coming soon" stub with a full KaTeX-rendered
//  HTML report for IS 456:2000 flat slab design.
// ═══════════════════════════════════════════════════════════════

const kx = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: true, fleqn: true });
const kxInline = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: false });

function statusChip(ok: boolean, label: string): string {
    const cls = ok ? '#10b981' : '#ef4444';
    return `<span style="color: ${cls}; font-weight: bold;">${label}</span>`;
}

export async function generateFlatSlabPDF(input: FlatSlabInput, results: any, preview: boolean = false): Promise<string | null> {
    const { L1, L2, c1, c2, hasDrop, dropL1, dropL2, dropDepth, D, cover, fck, fy, w_live, w_finish, panelType } = input;
    const r = results;
    const dPunch = hasDrop ? r.d_drop : r.d_slab;
    const critPerimeterM = r.crit_perimeter;
    const critPerimeterMm = critPerimeterM * 1000;
    const dPunchM = dPunch / 1000;
    const punchingAreaInside = (c1 + dPunchM) * (c2 + dPunchM);

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Flat Slab Design Report</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css" />
            ${REPORT_CSS}
        </head>
        <body>
            <div class="report-container">
                <div class="report-header">
                    <h1>Flat Slab Design Report</h1>
                    <p>Direct Design Method &mdash; IS 456:2000 Cl. 31 | Generated: ${new Date().toLocaleString()}</p>
                </div>

                <h2>1. Input Parameters</h2>
                ${inputTable([
                    ['Span L<sub>1</sub> (analysis dir.)', `${L1} m`, 'Transverse Span L<sub>2</sub>', `${L2} m`],
                    ['Column c<sub>1</sub> (‖ L<sub>1</sub>)', `${c1} m`, 'Column c<sub>2</sub> (‖ L<sub>2</sub>)', `${c2} m`],
                    ['Slab Depth, D', `${D} mm`, 'Clear Cover', `${cover} mm`],
                    ['Concrete, f<sub>ck</sub>', `${fck} N/mm²`, 'Steel, f<sub>y</sub>', `${fy} N/mm²`],
                    ['Live Load', `${w_live} kN/m²`, 'Floor Finish', `${w_finish} kN/m²`],
                    ['Panel Type', panelType, 'Drop Panel', hasDrop ? `Yes (${dropL1}×${dropL2} m, ${dropDepth} mm)` : 'No'],
                ])}

                <h2>2. Effective Depth &amp; Clear Span</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Section Properties</div>
                    <div class="section-body">
                        ${kx(`d_{slab} = D - \\text{cover} - 10 = ${D} - ${cover} - 10 = ${r.d_slab.toFixed(0)} \\text{ mm}`)}
                        ${hasDrop ? kx(`d_{drop} = ${dropDepth} - \\text{cover} - 10 = ${r.d_drop.toFixed(0)} \\text{ mm}`) : ''}
                        ${kx(`L_n = L_1 - c_1 = ${L1} - ${c1} = ${r.Ln.toFixed(2)} \\text{ m}`)}
                        <p style="font-size:12px;color:#64748b;margin:4px 0 0 0;">(IS 456 Cl. 31.3.3: clear span face-to-face; ${r.Ln < 0.65 * L1 ? 'clamped to 0.65·L₁ = ' + (0.65 * L1).toFixed(2) : '≥ 0.65·L₁ OK'})</p>
                    </div>
                </div>

                <div class="section-box avoid-break">
                    <div class="section-header">Minimum Slab Thickness &mdash; IS 456 Cl. 31.2.1</div>
                    <div class="section-body">
                        <p style="margin-top:0; color:#475569; font-size:13px;">
                            Cl. 31.2.1: the thickness of a flat slab shall be not less than
                            ${r.thicknessCheck.D_min} mm. This is an absolute lower bound independent of the
                            L/d (deflection) check.
                        </p>
                        ${kx(`D = ${r.thicknessCheck.D} \\text{ mm} \\quad \\text{vs} \\quad D_{min} = ${r.thicknessCheck.D_min} \\text{ mm}`)}
                        <div style="margin-top:6px;">
                            ${r.thicknessCheck.ok
                                ? `${statusChip(true, 'SAFE')} &nbsp; ${kxInline(`D = ${r.thicknessCheck.D} \\geq ${r.thicknessCheck.D_min} \\text{ mm}`)}`
                                : `${statusChip(false, 'REVISE')} &nbsp; ${kxInline(`D = ${r.thicknessCheck.D} < ${r.thicknessCheck.D_min} \\text{ mm}`)} &mdash; ${r.thicknessCheck.message}`}
                        </div>
                    </div>
                </div>

                <h2>3. Loads &amp; Total Static Moment</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Load &amp; M₀ (IS 456 Cl. 31.3.3)</div>
                    <div class="section-body">
                        ${calcRow('Self-weight (slab)', `(${D}/1000 × 25) = ${(D / 1000 * 25).toFixed(2)}`, 'kN/m²')}
                        ${calcRow('Live Load', w_live, 'kN/m²')}
                        ${calcRow('Floor Finish', w_finish, 'kN/m²')}
                        ${calcRow('Total Service Load', `${(D / 1000 * 25 + w_live + w_finish).toFixed(2)}`, 'kN/m²')}
                        ${kx(`w_u = 1.5 \\times w_{total} = ${r.wu.toFixed(2)} \\text{ kN/m}^2`)}
                        ${kx(`W = w_u \\cdot L_2 \\cdot L_n = ${r.wu.toFixed(2)} \\times ${L2} \\times ${r.Ln.toFixed(2)} = ${r.W.toFixed(1)} \\text{ kN}`)}
                        ${kx(`M_0 = \\frac{W \\cdot L_n}{8} = \\frac{${r.W.toFixed(1)} \\times ${r.Ln.toFixed(2)}}{8} = ${r.M0.toFixed(1)} \\text{ kN·m}`)}
                    </div>
                </div>

                <h2>4. Longitudinal Moment Distribution</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">M₀ split into Negative / Positive (IS 456 Cl. 31.3.4)</div>
                    <div class="section-body">
                        ${panelType === 'interior'
                            ? kx(`M_{neg} = 0.65 M_0 = ${r.M_neg_col ? (0.65 * r.M0).toFixed(1) : '—'} \\text{ kN·m}, \\quad M_{pos} = 0.35 M_0 = ${(0.35 * r.M0).toFixed(1)} \\text{ kN·m}`)
                            : kx(`\\text{Exterior panel: } M_{neg} = 0.75 M_0, \\quad M_{pos} = 0.52 M_0`)}
                    </div>
                </div>
                <table class="result-table">
                    <thead><tr><th>Strip</th><th>Width (m)</th><th>M<sub>neg</sub> (kN·m)</th><th>M<sub>pos</sub> (kN·m)</th><th>% Neg</th><th>% Pos</th></tr></thead>
                    <tbody>
                        <tr><td><strong>Column Strip</strong></td><td>${r.colStripWidth.toFixed(2)}</td><td>${r.M_neg_col.toFixed(1)}</td><td>${r.M_pos_col.toFixed(1)}</td><td>75%</td><td>60%</td></tr>
                        <tr><td><strong>Middle Strip</strong></td><td>${r.midStripWidth.toFixed(2)}</td><td>${r.M_neg_mid.toFixed(1)}</td><td>${r.M_pos_mid.toFixed(1)}</td><td>25%</td><td>40%</td></tr>
                    </tbody>
                </table>
                <p style="font-size:12px;color:#64748b;">
                    Column strip width = L<sub>2</sub>/2 = ${r.colStripWidth.toFixed(2)} m (IS 456 Cl. 31.2).
                    Middle strip width = L<sub>2</sub> − col. strip = ${r.midStripWidth.toFixed(2)} m.
                </p>

                <h2>5. Flexural Design &mdash; IS 456 Cl. 38.1</h2>
                <p style="font-size:13px;color:#475569;">${kxInline(`A_{st} = \\frac{0.5 f_{ck}}{f_y} \\left[ 1 - \\sqrt{1 - \\frac{4.6 M_u}{f_{ck} b d^2}} \\right] b d`)} per strip width.</p>
                <table class="result-table">
                    <thead><tr><th>Location</th><th>Strip</th><th>M<sub>u</sub> (kN·m)</th><th>b (mm)</th><th>d (mm)</th><th>A<sub>st,req</sub> (mm²)</th><th>Status</th></tr></thead>
                    <tbody>
                        <tr><td>Negative (Top)</td><td>Column</td><td>${r.M_neg_col.toFixed(1)}</td><td>${(r.colStripWidth * 1000).toFixed(0)}</td><td>${(hasDrop ? r.d_drop : r.d_slab).toFixed(0)}</td><td>${Number.isNaN(r.Ast_neg_col) ? 'Fails' : r.Ast_neg_col.toFixed(0)}</td><td>${Number.isNaN(r.Ast_neg_col) ? statusChip(false,'FAIL') : statusChip(true,'OK')}</td></tr>
                        <tr><td>Positive (Bot)</td><td>Column</td><td>${r.M_pos_col.toFixed(1)}</td><td>${(r.colStripWidth * 1000).toFixed(0)}</td><td>${r.d_slab.toFixed(0)}</td><td>${Number.isNaN(r.Ast_pos_col) ? 'Fails' : r.Ast_pos_col.toFixed(0)}</td><td>${Number.isNaN(r.Ast_pos_col) ? statusChip(false,'FAIL') : statusChip(true,'OK')}</td></tr>
                        <tr><td>Negative (Top)</td><td>Middle</td><td>${r.M_neg_mid.toFixed(1)}</td><td>${(r.midStripWidth * 1000).toFixed(0)}</td><td>${r.d_slab.toFixed(0)}</td><td>${Number.isNaN(r.Ast_neg_mid) ? 'Fails' : r.Ast_neg_mid.toFixed(0)}</td><td>${Number.isNaN(r.Ast_neg_mid) ? statusChip(false,'FAIL') : statusChip(true,'OK')}</td></tr>
                        <tr><td>Positive (Bot)</td><td>Middle</td><td>${r.M_pos_mid.toFixed(1)}</td><td>${(r.midStripWidth * 1000).toFixed(0)}</td><td>${r.d_slab.toFixed(0)}</td><td>${Number.isNaN(r.Ast_pos_mid) ? 'Fails' : r.Ast_pos_mid.toFixed(0)}</td><td>${Number.isNaN(r.Ast_pos_mid) ? statusChip(false,'FAIL') : statusChip(true,'OK')}</td></tr>
                    </tbody>
                </table>

                <h2>6. Punching Shear Check &mdash; IS 456 Cl. 31.6</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Two-Way (Punching) Shear at d/2 from Face</div>
                    <div class="section-body">
                        ${kx(`\\beta_c = \\frac{\\min(c_1, c_2)}{\\max(c_1, c_2)} = \\frac{${Math.min(c1, c2)}}{${Math.max(c1, c2)}} = ${(Math.min(c1, c2) / Math.max(c1, c2)).toFixed(3)}`)}
                        ${kx(`k_s = \\min(0.5 + \\beta_c,\\; 1.0) = ${Math.min(0.5 + Math.min(c1, c2) / Math.max(c1, c2), 1.0).toFixed(3)}`)}
                        ${kx(`\\tau_c = k_s \\cdot 0.25 \\sqrt{f_{ck}} = ${Math.min(0.5 + Math.min(c1, c2) / Math.max(c1, c2), 1.0).toFixed(3)} \\times 0.25 \\times \\sqrt{${fck}} = ${r.tau_c.toFixed(3)} \\text{ N/mm}^2`)}
                        ${kx(`u = 2\\left[(c_1 + d) + (c_2 + d)\\right] = ${critPerimeterM.toFixed(2)} \\text{ m} = ${critPerimeterMm.toFixed(0)} \\text{ mm}`)}
                        ${kx(`V_u = w_u \\cdot (L_1 L_2 - \\text{area inside } u) = ${r.wu.toFixed(2)} \\times (${L1} \\times ${L2} - ${punchingAreaInside.toFixed(2)}) = ${r.shear_force.toFixed(1)} \\text{ kN}`)}
                        ${kx(`\\tau_v = \\frac{V_u}{u \\cdot d} = \\frac{${r.shear_force.toFixed(1)} \\times 1000}{(${critPerimeterM.toFixed(2)} \\times 1000) \\times ${dPunch.toFixed(0)}} = ${r.tau_v.toFixed(3)} \\text{ N/mm}^2`)}
                        <div style="margin-top:6px;">
                            ${r.punching_safe
                                ? `${statusChip(true, 'SAFE')} &nbsp; ${kxInline(`\\tau_v = ${r.tau_v.toFixed(3)} \\leq \\tau_c = ${r.tau_c.toFixed(3)}`)}`
                                : `${statusChip(false, 'FAIL')} &nbsp; ${kxInline(`\\tau_v = ${r.tau_v.toFixed(3)} > \\tau_c = ${r.tau_c.toFixed(3)}`)}`}
                        </div>
                    </div>
                </div>

                <h2>7. Deflection Check &mdash; IS 456 Annex C</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Short-term + Shrinkage + Creep (Continuous: α=1/16, k₃=0.063)</div>
                    <div class="section-body">
                        <p style="margin-top:0; color:#475569; font-size:13px;">
                            The full Annex C deflection calculation governs the design. The simplified
                            L/d span/depth check (Cl. 23.2) is computed below for reference but is
                            IGNORED for design purposes.
                        </p>
                        ${kx(`E_c = ${r.deflection.Ec} \\text{ N/mm}^2, \\quad m = ${r.deflection.m}, \\quad M_{cr} = ${r.deflection.Mcr.toFixed(2)} \\text{ kN·m/m}`)}
                        ${kx(`I_{eff} = ${(r.deflection.Ieff/1e6).toFixed(2)}\\times 10^6 \\text{ mm}^4 \\quad (I_{gr} = ${(r.deflection.Igr/1e6).toFixed(2)}, I_{cr} = ${(r.deflection.Icr/1e6).toFixed(2)}\\times 10^6)`)}
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

                <h2>8. Span/Depth Ratio &mdash; IS 456 Cl. 23.2 (informational)</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Simplified L/d Check &mdash; IGNORED for design (Annex C governs)</div>
                    <div class="section-body">
                        <p style="margin-top:0; color:#475569; font-size:13px;">
                            Computed for all slabs per user request. The status is IGNORED because the
                            rigorous Annex C deflection check governs the design.
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

                <h2>9. Summary</h2>
                <table class="result-table">
                    <thead><tr><th>Check</th><th>Demand</th><th>Capacity</th><th>Status</th></tr></thead>
                    <tbody>
                        <tr><td>Min. Thickness (Cl. 31.2.1)</td><td>${r.thicknessCheck.D} mm</td><td>${r.thicknessCheck.D_min} mm</td><td>${r.thicknessCheck.ok ? statusChip(true,'OK') : statusChip(false,'FAIL')}</td></tr>
                        <tr><td>Static Moment M₀</td><td>${r.M0.toFixed(1)} kN·m</td><td>—</td><td>—</td></tr>
                        <tr><td>Punching Shear τ<sub>v</sub> (Cl. 31.6)</td><td>${r.tau_v.toFixed(3)} N/mm²</td><td>${r.tau_c.toFixed(3)} N/mm²</td><td>${r.punching_safe ? statusChip(true,'OK') : statusChip(false,'FAIL')}</td></tr>
                        <tr><td>Col. Strip Neg. Ast</td><td>${Number.isNaN(r.Ast_neg_col) ? '—' : r.Ast_neg_col.toFixed(0)+' mm²'}</td><td>—</td><td>${Number.isNaN(r.Ast_neg_col) ? statusChip(false,'FAIL') : statusChip(true,'OK')}</td></tr>
                        <tr><td>Col. Strip Pos. Ast</td><td>${Number.isNaN(r.Ast_pos_col) ? '—' : r.Ast_pos_col.toFixed(0)+' mm²'}</td><td>—</td><td>${Number.isNaN(r.Ast_pos_col) ? statusChip(false,'FAIL') : statusChip(true,'OK')}</td></tr>
                        <tr><td>Span/Depth (Cl. 23.2)</td><td>d<sub>prov</sub>=${r.ldCheck.d_provided} mm</td><td>d<sub>req</sub>=${r.ldCheck.d_req} mm</td><td><span style="color:#64748b; font-weight:bold;">IGNORED</span></td></tr>
                    </tbody>
                </table>

                <div class="info-note" style="margin-top:20px;">
                    <strong>Disclaimer:</strong> Outputs are for preliminary design only and must be independently
                    verified by a qualified licensed structural engineer before use.
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
                logger.error('Flat slab print failed, falling back to new tab', e);
                window.open(blobUrl, '_blank');
            }
            setTimeout(() => cleanup(iframe), 2000);
        };

        document.body.appendChild(iframe);
        iframe.src = blobUrl;
        setTimeout(() => { if (!settled) cleanup(iframe); }, 5000);
    });
}
