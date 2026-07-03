import katex from 'katex';
import { logger } from '../lib/logger';
import { REPORT_CSS, FIT_FORMULAS_SCRIPT, inputTable, calcRow } from './reportCss';
import { CantileverSlabInput } from './cantileverSlabEngine';

// ═══════════════════════════════════════════════════════════════
//  CANTILEVER SLAB REPORT GENERATOR — IS 456:2000
//  Replaces the previous "coming soon" stub with a full KaTeX-rendered
//  HTML report matching the layout of slabReportGenerator.ts.
// ═══════════════════════════════════════════════════════════════

const kx = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: true, fleqn: true });
const kxInline = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: false });

function statusChip(ok: boolean, label: string): string {
    const cls = ok ? '#10b981' : '#ef4444';
    return `<span style="color: ${cls}; font-weight: bold;">${label}</span>`;
}

export async function generateCantileverSlabPDF(input: CantileverSlabInput, results: any, preview: boolean = false): Promise<string | null> {
    const { L, D, cover, fck, fy, w_live, w_finish, bar_main, spacing_main, bar_dist, spacing_dist } = input;
    const r = results;

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Cantilever Slab Design Report</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css" />
            ${REPORT_CSS}
        </head>
        <body>
            <div class="report-container">
                <div class="report-header">
                    <h1>Cantilever Slab Design Report</h1>
                    <p>Design Code: IS 456:2000 | Generated: ${new Date().toLocaleString()}</p>
                </div>

                <h2>1. Input Parameters</h2>
                ${inputTable([
                    ['Clear Span, L', `${L} m`, 'Overall Depth, D', `${D} mm`],
                    ['Clear Cover', `${cover} mm`, 'Concrete, f<sub>ck</sub>', `${fck} N/mm²`],
                    ['Steel, f<sub>y</sub>', `${fy} N/mm²`, 'Live Load', `${w_live} kN/m²`],
                    ['Floor Finish', `${w_finish} kN/m²`, 'Main Bar', `${bar_main} mm Ø @ ${spacing_main} c/c`],
                    ['Dist. Bar', `${bar_dist} mm Ø @ ${spacing_dist} c/c`, 'Load Factor', '1.5'],
                ])}

                <h2>2. Effective Depth &amp; Loads</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Section Properties</div>
                    <div class="section-body">
                        ${kx(`d = D - \\text{cover} - \\frac{\\phi}{2} = ${D} - ${cover} - \\frac{${bar_main}}{2} = ${r.d.toFixed(0)} \\text{ mm}`)}
                        ${kx(`L_{eff} = L + \\frac{d}{2} = ${L} + \\frac{${r.d.toFixed(0)}/1000}{2} = ${r.L_eff.toFixed(3)} \\text{ m}`)}
                        <p style="font-size:12px;color:#64748b;margin:4px 0 0 0;">(IS 456 Cl. 22.2: cantilever effective span = clear span + d/2)</p>
                    </div>
                </div>
                <div class="section-box avoid-break">
                    <div class="section-header">Load Computation</div>
                    <div class="section-body">
                        ${calcRow('Self-weight', `(${D}/1000 × 25) = ${r.w_dead.toFixed(2)}`, 'kN/m²')}
                        ${calcRow('Live Load', w_live, 'kN/m²')}
                        ${calcRow('Floor Finish', w_finish, 'kN/m²')}
                        ${calcRow('Total Service UDL', `${(r.w_dead + w_live + w_finish).toFixed(2)}`, 'kN/m²')}
                        ${kx(`w_u = 1.5 \\times w_{service} = ${r.wu.toFixed(2)} \\text{ kN/m}^2`)}
                        ${r.P_parapet > 0 ? calcRow('Parapet Line Load (Service)', `${input.parapetHeight}m × ${input.parapetThickness}mm/1000 × ${input.parapetDensity}kN/m³`, `${r.P_parapet.toFixed(2)} kN/m`) : ''}
                        ${r.P_parapet > 0 ? kx(`P_{u,parapet} = 1.5 \\times ${r.P_parapet.toFixed(2)} = ${r.Pu_parapet.toFixed(2)} \\text{ kN/m}`) : ''}
                    </div>
                </div>

                <h2>3. Bending Moment &amp; Shear Force</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Cantilever Actions (UDL over effective span)</div>
                    <div class="section-body">
                        ${r.P_parapet > 0 
                            ? kx(`M_u = \\frac{w_u L_{eff}^2}{2} + P_{u,parapet} L_{eff} = \\frac{${r.wu.toFixed(2)} \\times ${r.L_eff.toFixed(3)}^2}{2} + ${r.Pu_parapet.toFixed(2)} \\times ${r.L_eff.toFixed(3)} = ${r.Mu.toFixed(2)} \\text{ kN·m/m}`)
                            : kx(`M_u = \\frac{w_u \\cdot L_{eff}^2}{2} = \\frac{${r.wu.toFixed(2)} \\times ${r.L_eff.toFixed(3)}^2}{2} = ${r.Mu.toFixed(2)} \\text{ kN·m/m}`)}
                        ${r.P_parapet > 0
                            ? kx(`V_{u,support} = w_u L_{eff} + P_{u,parapet} = ${r.wu.toFixed(2)} \\times ${r.L_eff.toFixed(3)} + ${r.Pu_parapet.toFixed(2)} = ${r.Vu.toFixed(2)} \\text{ kN/m}`)
                            : kx(`V_{u,support} = w_u \\cdot L_{eff} = ${r.wu.toFixed(2)} \\times ${r.L_eff.toFixed(3)} = ${r.Vu.toFixed(2)} \\text{ kN/m}`)}
                        ${kx(`V_{u,crit} = V_{u,support} - w_u \\cdot d_{eff} = ${r.Vu.toFixed(2)} - ${r.wu.toFixed(2)} \\times ${(r.d_eff/1000).toFixed(3)} = ${r.Vu_critical.toFixed(2)} \\text{ kN/m} \\quad (d_{eff}=${r.d_eff.toFixed(0)}\\text{ mm from face of support})`)}
                    </div>
                </div>

                <h2>4. Flexural Design &mdash; IS 456 Cl. 38.1</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Steel Area Calculation</div>
                    <div class="section-body">
                        ${kx(`A_{st,req} = \\frac{0.5 f_{ck}}{f_y} \\left[ 1 - \\sqrt{1 - \\frac{4.6 M_u}{f_{ck} b d^2}} \\right] b d`)}
                        <div class="calc-block">
                            ${kxInline(`b = 1000 \\text{ mm}`)}, ${kxInline(`d = ${r.d.toFixed(0)} \\text{ mm}`)}<br/>
                            ${Number.isNaN(r.Ast_req)
                                ? '<span style="color:#ef4444;font-weight:bold;">Section FAILS — NA outside flange limit. Revise section.</span>'
                                : kxInline(`A_{st,req} = ${r.Ast_req.toFixed(0)} \\text{ mm}^2\\text{/m}`)}
                        </div>
                        ${kx(`A_{st,min} = 0.0012 \\times b \\times D = ${r.Ast_min.toFixed(0)} \\text{ mm}^2\\text{/m} \\quad \\text{(IS 456 Cl. 26.5.2.1)}`)}
                        <div class="provided-box">
                            <strong>Provided:</strong> ${bar_main} mm Ø @ ${spacing_main} mm c/c<br/>
                            ${kxInline(`A_{st,prov} = \\frac{1000}{${spacing_main}} \\times \\frac{\\pi}{4}${bar_main}^2 = ${r.Ast_provided.toFixed(0)} \\text{ mm}^2\\text{/m}`)}
                        </div>
                        <div style="margin-top:6px;">
                            ${r.Ast_provided >= r.Ast_req ? statusChip(true, 'SAFE') : statusChip(false, 'REVISE')}
                            &nbsp;(${kxInline(`p_t = ${r.pt_provided.toFixed(3)}\\%`)})
                        </div>
                    </div>
                </div>

                <h2>5. Shear Check &mdash; IS 456 Cl. 40</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">One-Way Shear at Critical Section (d<sub>eff</sub> from face of support) — Cl. 40.1.1</div>
                    <div class="section-body">
                        <p style="margin-top:0; color:#475569; font-size:13px;">
                            Per IS 456 Cl. 40.1.1, the critical section for shear is at a distance d<sub>eff</sub>
                            from the face of the support. The shear at that section governs the τ<sub>v</sub> check.
                        </p>
                        ${kx(`\\tau_v = \\frac{V_{u,crit}}{b \\cdot d_{eff}} = \\frac{${r.Vu_critical.toFixed(2)} \\times 1000}{1000 \\times ${r.d_eff.toFixed(0)}} = ${r.tau_v.toFixed(3)} \\text{ N/mm}^2`)}
                        ${kx(`\\tau_c = k \\cdot \\frac{0.85\\sqrt{0.8 f_{ck}}(\\sqrt{1+5\\beta}-1)}{6\\beta}`)}
                        <div class="calc-block">
                            ${kxInline(`\\beta = \\frac{0.8 f_{ck}}{6.89 p_t}, \\quad p_t = ${r.pt_provided.toFixed(3)}\\%`)}<br/>
                            ${kxInline(`k = \\text{depth factor (IS 456 Cl. 40.2.1.1)}`)}<br/>
                            ${kxInline(`\\tau_{c,allowable} = k \\cdot \\tau_c = ${r.tau_c.toFixed(3)} \\text{ N/mm}^2`)}
                        </div>
                        <div style="margin-top:6px;">
                            ${r.shear_safe
                                ? `${statusChip(true, 'SAFE')} &nbsp; ${kxInline(`\\tau_v = ${r.tau_v.toFixed(3)} \\leq \\tau_{c,allowable} = ${r.tau_c.toFixed(3)}`)}`
                                : `${statusChip(false, 'REVISE')} &nbsp; ${kxInline(`\\tau_v = ${r.tau_v.toFixed(3)} > \\tau_{c,allowable} = ${r.tau_c.toFixed(3)}`)}`}
                        </div>
                    </div>
                </div>

                <h2>6. Deflection Check &mdash; IS 456 Annex C</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Short-term + Shrinkage + Creep (Cantilever: α=1/4, k₃=0.5)</div>
                    <div class="section-body">
                        <p style="margin-top:0; color:#475569; font-size:13px;">
                            The full Annex C deflection calculation governs the design. The simplified
                            L/d span/depth check (Cl. 23.2) is computed below for reference but is
                            IGNORED for design purposes.
                        </p>
                        ${kx(`E_c = 5000\\sqrt{f_{ck}} = ${r.deflection.Ec} \\text{ N/mm}^2, \\quad m = \\frac{280}{f_{ck}} = ${r.deflection.m}`)}
                        ${kx(`A_{st,top} = ${r.Ast_provided.toFixed(0)} \\text{ mm}^2\\text{/m}, \\quad A_{sc,bot} = ${(r.Asc_provided ?? 0).toFixed(0)} \\text{ mm}^2\\text{/m}`)}
                        ${kx(`p_t = ${r.deflection.pt}\\%, \\quad p_c = ${r.deflection.pc}\\% \\quad \\text{(both top and bottom reinforcement included per PI-EX-106A)}`)}
                        ${kx(`f_{cr} = 0.7\\sqrt{f_{ck}} = ${r.deflection.fcr.toFixed(3)} \\text{ N/mm}^2, \\quad M_{cr} = ${r.deflection.Mcr.toFixed(2)} \\text{ kN·m/m}`)}
                        ${kx(`I_{gr} = ${(r.deflection.Igr/1e6).toFixed(2)}\\times 10^6 \\text{ mm}^4, \\quad I_{cr} = ${(r.deflection.Icr/1e6).toFixed(2)}\\times 10^6, \\quad I_{eff} = ${(r.deflection.Ieff/1e6).toFixed(2)}\\times 10^6 \\text{ mm}^4`)}
                        ${kx(`a_i = \\alpha \\frac{M_s L^2}{E_c I_{eff}} = ${r.deflection.ai.toFixed(2)} \\text{ mm (short-term)}`)}
                        ${kx(`a_{shrinkage} = k_3 \\psi_{cs} L^2 = ${r.deflection.a_shrinkage.toFixed(2)} \\text{ mm} \\quad (k_3=0.5, \\psi_{cs}=${(r.deflection.psi_cs*1e6).toFixed(2)}\\times 10^{-6})`)}
                        ${kx(`a_{creep} = a_{1,perm} - a_{i,perm} = ${r.deflection.a_creep.toFixed(2)} \\text{ mm} \\quad (\\theta=${r.deflection.theta}, E_{ce}=${r.deflection.Ece.toFixed(0)})`)}
                        ${r.deflection.camber > 0 ? kx(`\\text{Camber} = ${r.deflection.camber.toFixed(2)} \\text{ mm}`) : ''}
                        ${r.deflection.camber > 0
                            ? kx(`a_{total,net} = a_i + a_{creep} + a_{shrinkage} - a_{camber} = ${r.deflection.a_total.toFixed(2)} \\text{ mm} \\quad \\text{vs} \\quad L/250 = ${r.deflection.limit_total.toFixed(2)} \\text{ mm}`)
                            : kx(`a_{total} = a_i + a_{creep} + a_{shrinkage} = ${r.deflection.a_total.toFixed(2)} \\text{ mm} \\quad \\text{vs} \\quad L/250 = ${r.deflection.limit_total.toFixed(2)} \\text{ mm}`)
                        }
                        ${r.deflection.camber > 0
                            ? kx(`a_{post,net} = a_{creep} + a_{shrinkage} - a_{camber} = ${r.deflection.a_post_construction.toFixed(2)} \\text{ mm} \\quad \\text{vs} \\quad L/350 = ${r.deflection.limit_post.toFixed(2)} \\text{ mm}`)
                            : kx(`a_{post} = a_{creep} + a_{shrinkage} = ${r.deflection.a_post_construction.toFixed(2)} \\text{ mm} \\quad \\text{vs} \\quad L/350 = ${r.deflection.limit_post.toFixed(2)} \\text{ mm}`)
                        }
                        <div style="margin-top:6px;">
                            ${r.defl_safe
                                ? `${statusChip(true, 'SAFE')} &nbsp; Total ${r.deflection.a_total.toFixed(2)} ≤ ${r.deflection.limit_total.toFixed(2)} mm &amp; Post-construction IGNORED`
                                : `${statusChip(false, 'REVISE')} &nbsp; Total ${r.deflection.a_total.toFixed(2)} > ${r.deflection.limit_total.toFixed(2)} mm`}
                        </div>
                    </div>
                </div>

                <h2>7. Span/Depth Ratio &mdash; IS 456 Cl. 23.2 (informational)</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Simplified L/d Check &mdash; IGNORED for design (Annex C governs)</div>
                    <div class="section-body">
                        <p style="margin-top:0; color:#475569; font-size:13px;">
                            Computed for all slabs per user request. The status is IGNORED because the
                            rigorous Annex C deflection check governs the design.
                        </p>
                        ${kx(`\\text{Basic } l/d = ${r.ldCheck.basicRatio} \\quad (\\text{cantilever})`)}
                        ${kx(`f_s = 0.58 f_y \\cdot \\frac{A_{st,req}}{A_{st,prov}} = ${r.ldCheck.fs} \\text{ N/mm}^2, \\quad p_t = ${r.ldCheck.pt}\\%`)}
                        ${kx(`\\text{Modification factor} = ${r.ldCheck.mf}, \\quad \\text{Modified } l/d = ${r.ldCheck.modifiedRatio}`)}
                        ${kx(`d_{req} = \\frac{L_{eff}}{\\text{modified } l/d} = ${r.ldCheck.d_req} \\text{ mm}, \\quad d_{provided} = ${r.ldCheck.d_provided} \\text{ mm}`)}
                        <div style="margin-top:6px;">
                            <span style="color:#64748b; font-weight:bold; border:1px solid #cbd5e1; padding:2px 10px; border-radius:4px;">IGNORED</span>
                            &nbsp; ${kxInline(`d_{provided}=${r.ldCheck.d_provided} \\text{ mm} \\;\\text{vs}\\; d_{req}=${r.ldCheck.d_req} \\text{ mm}`)} &mdash; Annex C governs
                        </div>
                    </div>
                </div>

                <h2>8. Distribution Steel</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Distribution Reinforcement</div>
                    <div class="section-body">
                        ${kx(`A_{st,dist,min} = 0.0012 \\times b \\times D = ${r.Ast_dist_req.toFixed(0)} \\text{ mm}^2\\text{/m}`)}
                        <div class="provided-box">
                            <strong>Provided:</strong> ${bar_dist} mm Ø @ ${spacing_dist} mm c/c
                            (${kxInline(`A_{st,dist,prov} = ${r.Ast_dist_provided.toFixed(0)} \\text{ mm}^2\\text{/m}`)})
                        </div>
                    </div>
                </div>

                <h2>9. Summary</h2>
                <table class="result-table">
                    <thead><tr><th>Check</th><th>Value</th><th>Limit</th><th>Status</th></tr></thead>
                    <tbody>
                        <tr><td>Flexure (A<sub>st</sub>)</td><td>${r.Ast_req.toFixed(0)} mm²/m</td><td>${r.Ast_provided.toFixed(0)} mm²/m</td><td>${r.Ast_provided >= r.Ast_req ? statusChip(true,'OK') : statusChip(false,'REVISE')}</td></tr>
                        <tr><td>Shear (τ<sub>v</sub>) at d<sub>eff</sub></td><td>${r.tau_v.toFixed(3)} N/mm²</td><td>${r.tau_c.toFixed(3)} N/mm²</td><td>${r.shear_safe ? statusChip(true,'OK') : statusChip(false,'REVISE')}</td></tr>
                        <tr><td>Deflection (Annex C)</td><td>Total: ${r.Ld_actual.toFixed(2)} mm</td><td>${r.Ld_max.toFixed(2)} mm</td><td>${r.defl_safe ? statusChip(true,'OK') : statusChip(false,'REVISE')}</td></tr>
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

// ─── Shared print/preview helper ────────────────────────────────────────────
// preview=true → open the report HTML in a new browser tab so the user can
// review it before printing. preview=false (default) → silent iframe print.
async function printHtml(htmlContent: string, preview: boolean = false): Promise<string | null> {
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    if (preview) {
        // Open in a new tab so the user can review before printing.
        window.open(blobUrl, '_blank');
        // Revoke after a delay to let the tab load.
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
                logger.error('Cantilever slab print failed, falling back to new tab', e);
                window.open(blobUrl, '_blank');
            }
            setTimeout(() => cleanup(iframe), 2000);
        };

        document.body.appendChild(iframe);
        iframe.src = blobUrl;
        setTimeout(() => { if (!settled) cleanup(iframe); }, 5000);
    });
}
