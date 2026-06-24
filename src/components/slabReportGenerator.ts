import katex from 'katex';
import { logger } from '../lib/logger';
import { REPORT_CSS, inputTable } from './reportCss';

// ═══════════════════════════════════════════════════════════════
//  SLAB REPORT GENERATOR — Detailed Mathematical Textbook Layout
// ═══════════════════════════════════════════════════════════════

const kx = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: true, fleqn: true });
const kxInline = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: false });

function statusChip(status: string): string {
    const cls = (status === 'OK' || status === 'SAFE') ? '#10b981' : '#ef4444';
    return `<span style="color: ${cls}; font-weight: bold;">${status}</span>`;
}

export async function generateSlabReport(config: any, results: any[], isPreview: boolean = false): Promise<string | null> {
    const panelSections = results.map((r: any) => {
        if (r.slabType === 'cantilever') return generateCantileverSection(r);
        if (r.slabType === 'one-way') return generateOneWaySection(r);
        return generateTwoWaySection(r);
    }).join('<div style="page-break-before: always;"></div>');

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Slab Design Report</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css" />
            ${REPORT_CSS}
            <style>.katex-display { text-align: left !important; margin: 10px 0 !important; }</style>
        </head>
        <body>
            <div class="report-container">
                <div class="report-header">
                    <h1>IS 456 Slab Design Report</h1>
                    <p>Design Code: IS 456:2000 | Generated: ${new Date().toLocaleString()}</p>
                </div>
                ${panelSections}
            </div>
        </body>
        </html>
    `;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    if (isPreview) {
        return Promise.resolve(blobUrl);
    } else {
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
                    logger.error('Slab print failed, falling back to new tab', e);
                    window.open(blobUrl, '_blank');
                }
                setTimeout(() => cleanup(iframe), 2000);
            };

            document.body.appendChild(iframe);
            iframe.src = blobUrl;
            setTimeout(() => { if (!settled) cleanup(iframe); }, 5000);
        });
    }
}

// ─── Mathematical Formatting Blocks ────────────────────────────────────────

function flexBlock(label: string, Mu: number, AstReq: number, barsLabel: string, AstProv: number, isDoubly: boolean, governs: string, fck: number, fy: number, d: number): string {
    return `
        <div style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px 0; color: #334155;">${label}</h4>
            ${kx(`M_u = ${Mu} \\text{ kN}\\cdot\\text{m/m}`)}
            ${governs === 'design' ? 
                kx(`A_{st,req} = \\frac{0.5 f_{ck}}{f_y} \\left[ 1 - \\sqrt{1 - \\frac{4.6 M_u}{f_{ck} b d^2}} \\right] bd = ${AstReq} \\text{ mm}^2\\text{/m}`) : 
                kx(`A_{st,req} = ${AstReq} \\text{ mm}^2\\text{/m} \\quad (\\text{Min. governs})`)
            }
            <div style="margin-top: 10px; padding: 6px; background: #f8fafc; border-left: 3px solid #0ea5e9;">
                <strong>Provided:</strong> ${barsLabel} <br/>
                <span style="color: #64748b; font-size: 12px;">(${kxInline(`A_{st,prov} = ${AstProv} \\text{ mm}^2\\text{/m}`)})</span>
            </div>
            <div style="margin-top: 6px;">
                ${statusChip(isDoubly ? 'REVISE (Doubly Reinforced)' : 'SAFE (Singly Reinforced)')}
            </div>
        </div>
    `;
}

function deflectionSection(r: any): string {
    const dfl = r.deflection;
    const Igr_str = (dfl.Igr/1e6).toFixed(2);
    const Icr_str = (dfl.Icr/1e6).toFixed(2);
    const Ieff_str = (dfl.Ieff/1e6).toFixed(2);
    const Icr_lt_str = (dfl.Icr_lt/1e6).toFixed(2);

    return `
    <div class="section-box avoid-break">
        <div class="section-header">Deflection Check &mdash; IS 456 Annex C</div>
        <div class="section-body">
            <p style="margin-top:0; color:#475569; font-size:13px;">
                <strong>Variables:</strong><br/>
                ${kxInline(`I_{gr}`)}: Gross moment of inertia<br/>
                ${kxInline(`I_{cr}`)}: Cracked moment of inertia<br/>
                ${kxInline(`I_{eff}`)}: Effective moment of inertia<br/>
                ${kxInline(`E_{ce}`)}: Effective modulus of elasticity of concrete
            </p>
            <div style="display: flex; gap: 20px;">
                <div style="flex: 1;">
                    <h4 style="margin-top:0;">A. Short-Term Deflection</h4>
                    ${kx(`I_{gr} = \\frac{bD^3}{12} = ${Igr_str} \\times 10^6 \\text{ mm}^4`)}
                    ${kx(`M_{cr} = \\frac{f_{cr} I_{gr}}{y_t} = ${dfl.Mcr} \\text{ kN}\\cdot\\text{m}`)}
                    ${kx(`I_{cr} = \\frac{bx^3}{3} + m A_{st} (d-x)^2 = ${Icr_str} \\times 10^6 \\text{ mm}^4`)}
                    ${kx(`I_{eff} = \\frac{I_{cr}}{1.2 - \\frac{M_{cr}}{M_a} \\frac{z}{d} \\left(1 - \\frac{x}{d}\\right)} = ${Ieff_str} \\times 10^6 \\text{ mm}^4 \\le I_{gr}`)}
                    ${kx(`a_i = \\alpha \\frac{M_{service} L^2}{E_c I_{eff}} = ${dfl.ai} \\text{ mm} \\quad (\\text{short-term})`)}

                    <h4 style="margin-top:15px;">B. Shrinkage Deflection</h4>
                    ${kx(`k_3 = ${dfl.k3} \\quad (\\text{from Cl. C-3.1})`)}
                    ${kx(`\\psi_{cs} = k_4 \\frac{\\epsilon_{cs}}{D} = ${dfl.psi_cs.toExponential(2)}`)}
                    ${kx(`a_{cs} = k_3 \\psi_{cs} L^2 = ${dfl.a_shrinkage} \\text{ mm}`)}
                </div>
                <div style="flex: 1;">
                    <h4 style="margin-top:0;">C. Creep Deflection</h4>
                    ${kx(`\\theta = ${dfl.theta} \\quad (\\text{creep coefficient})`)}
                    ${kx(`E_{ce} = \\frac{E_c}{1 + \\theta} = ${Math.round(dfl.Ece)} \\text{ N/mm}^2`)}
                    ${kx(`I_{cr,lt} = ${Icr_lt_str} \\times 10^6 \\text{ mm}^4`)}
                    ${kx(`a_{i,cc} = \\alpha \\frac{M_{perm} L^2}{E_{ce} I_{eff,lt}} = ${dfl.a1_perm} \\text{ mm}`)}
                    ${kx(`a_{cc} = a_{i,cc} - a_{i,perm} = ${dfl.a_creep} \\text{ mm}`)}

                    <h4 style="margin-top:15px;">D. Summary</h4>
                    ${dfl.camber > 0 ? kx(`a_{camber} = ${dfl.camber} \\text{ mm (upward)}`) : ''}
                    
                    ${dfl.camber > 0 ? 
                        kx(`a_{total} = a_i + a_{cc} + a_{cs} - a_{camber} = ${dfl.a_total} \\text{ mm}`) : 
                        kx(`a_{total} = a_i + a_{cc} + a_{cs} = ${dfl.a_total} \\text{ mm}`)
                    }
                    <div style="font-weight: bold; color: ${dfl.status_total === 'FAIL' ? '#ef4444' : '#10b981'}; text-align: center;">
                        Result: ${kxInline(`a_{total} ${dfl.status_total === 'OK' ? '\\le' : '>'} ${dfl.limit_total} \\text{ mm}`)} &rarr; ${dfl.status_total}
                    </div>

                    <div style="margin-top:15px;"></div>
                    ${dfl.camber > 0 ? 
                        kx(`a_{post} = a_{cc} + a_{cs} - a_{camber} = ${dfl.a_post_construction} \\text{ mm}`) : 
                        kx(`a_{post} = a_{cc} + a_{cs} = ${dfl.a_post_construction} \\text{ mm}`)
                    }
                    <div style="font-weight: bold; color: ${dfl.status_post === 'FAIL' ? '#ef4444' : '#10b981'}; text-align: center;">
                        Result: ${kxInline(`a_{post} ${dfl.status_post === 'OK' ? '\\le' : '>'} ${dfl.limit_post} \\text{ mm}`)} &rarr; ${dfl.status_post}
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

function spanDepthSection(r: any): string {
    return `
    <div class="section-box avoid-break">
        <div class="section-header">Span/Depth Ratio &mdash; IS 456 Cl. 23.2</div>
        <div class="section-body">
            <p style="margin-top:0; color:#475569; font-size:13px;">
                <strong>Variables:</strong><br/>
                ${kxInline(`f_s`)}: Estimated steel stress under service load
            </p>
            <div style="display: flex; gap: 20px;">
                <div style="flex: 1;">
                    ${kx(`\\text{Basic } (l/d) = ${r.ldCheck.basicRatio}`)}
                    ${kx(`f_s = 0.58 f_y \\frac{A_{st,req}}{A_{st,prov}} = ${r.ldCheck.fs} \\text{ N/mm}^2`)}
                    ${kx(`\\text{Modification Factor (MF)} = ${r.ldCheck.mf}`)}
                </div>
                <div style="flex: 1;">
                    ${kx(`\\text{Modified } (l/d) = \\text{Basic} \\times \\text{MF} = ${r.ldCheck.modifiedRatio}`)}
                    ${kx(`d_{req} = \\frac{l}{\\text{Modified } (l/d)} = ${r.ldCheck.d_req} \\text{ mm}`)}
                    ${kx(`d_{prov} = ${r.ldCheck.d_provided} \\text{ mm}`)}
                    <p style="margin-top: 10px; color: #64748b; font-style: italic; text-align: center;">
                        Note: Empirical span/depth ratio is a preliminary check. Rigorous deflection calculation governs.
                    </p>
                </div>
            </div>
        </div>
    </div>`;
}

function shearSection(r: any, directions: {label: string, dir: any}[]): string {
    const shearBlocks = directions.map(({label, dir}) => `
        <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px dashed #e2e8f0;">
            <h4 style="margin-top: 0;">${label} Direction</h4>
            <div style="display: flex; gap: 20px;">
                <div style="flex: 1;">
                    ${kx(`V_u = ${dir.Vu} \\text{ kN}`)}
                    ${kx(`\\tau_v = \\frac{V_u}{bd} = ${dir.tau_v} \\text{ N/mm}^2`)}
                    ${kx(`\\tau_c = ${dir.tau_c} \\text{ N/mm}^2 \\quad (p_t = ${dir.pt}\\%)`)}
                </div>
                <div style="flex: 1;">
                    ${kx(`k = ${dir.k} \\quad (\\text{depth factor})`)}
                    ${kx(`k \\cdot \\tau_c = ${dir.allowable} \\text{ N/mm}^2`)}
                    <div style="margin: 10px 0; font-weight: bold; color: ${dir.status === 'FAIL' ? '#ef4444' : '#10b981'}; text-align: center;">
                        Result: ${kxInline(`\\tau_v ${dir.status === 'OK' ? '\\le' : '>'} k \\tau_c`)} &rarr; ${dir.status}
                    </div>
                </div>
            </div>
        </div>
    `).join('');

    return `
    <div class="section-box avoid-break">
        <div class="section-header">Shear Check &mdash; IS 456 Cl. 40</div>
        <div class="section-body">
            <p style="margin-top:0; color:#475569; font-size:13px;">
                <strong>Variables:</strong><br/>
                ${kxInline(`V_u`)}: Factored shear force<br/>
                ${kxInline(`\\tau_v`)}: Nominal shear stress<br/>
                ${kxInline(`\\tau_c`)}: Design shear strength of concrete<br/>
                ${kxInline(`k`)}: Depth factor for solid slabs
            </p>
            ${shearBlocks}
        </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
//  FLEXURAL DEPTH CHECK
// ═══════════════════════════════════════════════════════════════

function flexuralDepthSection(r: any): string {
    if (!r.flexDepthCheck) return '';
    return `
    <div class="section-box avoid-break">
        <div class="section-header">Flexural Depth &mdash; IS 456 Annex G</div>
        <div class="section-body">
            <p style="margin-top:0; color:#475569; font-size:13px;">
                <strong>Variables:</strong><br/>
                ${kxInline(`M_{u,max}`)}: Maximum factored moment<br/>
                ${kxInline(`R_u`)}: Limiting moment coefficient parameter (${kxInline(`R_u = \\text{coeff} \\times f_{ck}`)} )
            </p>
            <div style="display: flex; gap: 20px;">
                <div style="flex: 1;">
                    ${kx(`M_{u,max} = ${r.flexDepthCheck.Mu_max} \\text{ kN}\\cdot\\text{m}`)}
                    ${kx(`R_u = ${(r.flexDepthCheck.coeff * r.fck).toFixed(2)} \\text{ N/mm}^2`)}
                </div>
                <div style="flex: 1;">
                    ${kx(`d_{req} = \\sqrt{\\frac{M_{u,max} \\times 10^6}{R_u b}} = ${r.flexDepthCheck.d_req} \\text{ mm}`)}
                    ${kx(`d_{prov} = ${r.flexDepthCheck.d_provided} \\text{ mm}`)}
                    <div style="margin-top: 10px; font-weight: bold; color: ${r.flexDepthCheck.status === 'FAIL' ? '#ef4444' : '#10b981'}; text-align: center;">
                        Result: ${kxInline(`d_{prov} ${r.flexDepthCheck.status === 'OK' ? '\\ge' : '<'} d_{req}`)} &rarr; ${r.flexDepthCheck.status}
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
//  TWO-WAY SLAB
// ═══════════════════════════════════════════════════════════════

function generateTwoWaySection(r: any): string {
    return `
        <h2 style="color: #0f172a; margin-top: 30px;">Panel ${r.label} &mdash; Two-Way Restrained Slab</h2>

        <div class="section-box">
            <div class="section-header">1. Input Parameters</div>
            <div class="section-body">
                ${inputTable([
                    ['L<sub>x</sub> (Short)', r.Lx + ' m', 'L<sub>y</sub> (Long)', r.Ly + ' m'],
                    ['L<sub>y</sub>/L<sub>x</sub>', String(r.lyLx), 'Boundary Case', 'Case ' + r.boundaryCase],
                    ['Thickness D', r.D + ' mm', 'Cover', r.cover + ' mm'],
                    ['Concrete', r.grade + ' (f<sub>ck</sub>=' + r.fck + ' MPa)', 'Steel', r.steelGrade + ' (f<sub>y</sub>=' + r.fy + ' MPa)'],
                    ['Dead Load (incl. SW)', r.totalDL + ' kN/m&sup2;', 'Live Load', r.LL + ' kN/m&sup2;'],
                    ['w<sub>u</sub> (Factored)', r.wFactored + ' kN/m&sup2;', 'Load Factor', String(r.loadFactor)],
                ])}
            </div>
        </div>

        <div class="section-box avoid-break">
            <div class="section-header">2. Design Moments &mdash; IS 456 Table 26</div>
            <div class="section-body">
                <p style="margin-top:0; color:#475569; font-size:13px;">
                    <strong>Variables:</strong><br/>
                    ${kxInline(`\\alpha`)}: Bending moment coefficient<br/>
                    ${kxInline(`w_u`)}: Factored uniform load
                </p>
                <div style="margin-bottom:10px; font-weight: 500;">For ${kxInline(`L_y/L_x = ${r.lyLx}`)}, Boundary Case ${r.boundaryCase}:</div>
                <table class="result-table" style="margin-bottom:15px;">
                    <tr><th>Direction</th><th>Positive &alpha;<sup>+</sup> (Mid-span)</th><th>Negative &alpha;<sup>&minus;</sup> (Support)</th></tr>
                    <tr><td>Short Span (X)</td><td>${r.ax_pos ?? '&mdash;'}</td><td>${r.ax_neg ?? '&mdash;'}</td></tr>
                    <tr><td>Long Span (Y)</td><td>${r.ay_pos ?? '&mdash;'}</td><td>${r.ay_neg ?? '&mdash;'}</td></tr>
                </table>
                <div style="background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    ${kx(`M_u = \\alpha \\cdot w_u \\cdot L_x^2`)}
                    ${kx(`M_{x,pos} = ${r.ax_pos} \\times ${r.wFactored} \\times ${r.Lx}^2 = ${r.Mx_pos} \\text{ kN}\\cdot\\text{m/m}`)}
                    ${kx(`M_{y,pos} = ${r.ay_pos} \\times ${r.wFactored} \\times ${r.Lx}^2 = ${r.My_pos} \\text{ kN}\\cdot\\text{m/m}`)}
                    ${r.Mx_neg > 0 ? kx(`M_{x,neg} = ${r.ax_neg} \\times ${r.wFactored} \\times ${r.Lx}^2 = ${r.Mx_neg} \\text{ kN}\\cdot\\text{m/m}`) : ''}
                    ${r.My_neg > 0 ? kx(`M_{y,neg} = ${r.ay_neg} \\times ${r.wFactored} \\times ${r.Lx}^2 = ${r.My_neg} \\text{ kN}\\cdot\\text{m/m}`) : ''}
                </div>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">3. Flexural Reinforcement &mdash; IS 456 Cl. 38.1</div>
            <div class="section-body">
                <p style="margin-top:0; color:#475569; font-size:13px;">
                    <strong>Variables:</strong><br/>
                    ${kxInline(`A_{st,req}`)}: Required area of steel<br/>
                    ${kxInline(`A_{st,prov}`)}: Provided area of steel<br/>
                    ${kxInline(`d`)}: Effective depth (${kxInline(`d_x = ${r.dx} \\text{ mm}, d_y = ${r.dy} \\text{ mm}`)})
                </p>
                <div style="display: flex; gap: 20px;">
                    <div style="flex: 1;">
                        ${flexBlock('X-Bot (Mid-span +ve)', r.Mx_pos, r.flex_x_bot.Ast_req, r.bars_x_bot.label, r.bars_x_bot.Ast_provided, r.flex_x_bot.isDoubly, r.flex_x_bot.governs, r.fck, r.fy, r.dx)}
                        ${r.Mx_neg > 0 ? flexBlock('X-Top (Support &minus;ve)', r.Mx_neg, r.flex_x_top.Ast_req, r.bars_x_top.label, r.bars_x_top.Ast_provided, r.flex_x_top.isDoubly, r.flex_x_top.governs, r.fck, r.fy, r.dx) : ''}
                    </div>
                    <div style="flex: 1;">
                        ${flexBlock('Y-Bot (Mid-span +ve)', r.My_pos, r.flex_y_bot.Ast_req, r.bars_y_bot.label, r.bars_y_bot.Ast_provided, r.flex_y_bot.isDoubly, r.flex_y_bot.governs, r.fck, r.fy, r.dy)}
                        ${r.My_neg > 0 ? flexBlock('Y-Top (Support &minus;ve)', r.My_neg, r.flex_y_top.Ast_req, r.bars_y_top.label, r.bars_y_top.Ast_provided, r.flex_y_top.isDoubly, r.flex_y_top.governs, r.fck, r.fy, r.dy) : ''}
                    </div>
                </div>
            </div>
        </div>

        ${deflectionSection(r)}
        ${flexuralDepthSection(r)}
        ${spanDepthSection(r)}
        ${shearSection(r, [
            {label: 'Short (L_x)', dir: r.shear.shortDir},
            {label: 'Long (L_y)', dir: r.shear.longDir},
        ])}
    `;
}

// ═══════════════════════════════════════════════════════════════
//  ONE-WAY SLAB
// ═══════════════════════════════════════════════════════════════

function generateOneWaySection(r: any): string {
    const supportLabels: Record<string, string> = {
        'simply': 'Simply Supported',
        'one_end': 'One-End Continuous',
        'continuous': 'Both Ends Continuous',
    };
    const supportLabel = supportLabels[r.supportCondition] ?? r.supportCondition;

    return `
        <h2 style="color: #0f172a; margin-top: 30px;">Panel ${r.label} &mdash; One-Way Slab</h2>

        <div class="section-box">
            <div class="section-header">1. Input Parameters</div>
            <div class="section-body">
                ${inputTable([
                    ['Span L<sub>x</sub>', r.Lx + ' m', 'Width L<sub>y</sub>', r.Ly + ' m'],
                    ['Support', supportLabel, 'Thickness D', r.D + ' mm'],
                    ['Cover', r.cover + ' mm', 'Concrete', r.grade + ' (f<sub>ck</sub>=' + r.fck + ' MPa)'],
                    ['Steel', r.steelGrade + ' (f<sub>y</sub>=' + r.fy + ' MPa)', 'Load Factor', String(r.loadFactor)],
                    ['Dead Load (incl. SW)', r.totalDL + ' kN/m&sup2;', 'Live Load', r.LL + ' kN/m&sup2;'],
                    ['w<sub>u</sub> (Factored)', r.wFactored + ' kN/m&sup2;', 'SDL', r.SDL + ' kN/m&sup2;'],
                ])}
            </div>
        </div>

        <div class="section-box avoid-break">
            <div class="section-header">2. Design Moments</div>
            <div class="section-body">
                <div class="info-note">
                    <strong>One-way slab:</strong> Bending in L<sub>x</sub> direction only.
                    ${r.supportCondition === 'simply' ? kxInline('M = w_u L_x^2/8 \\quad (\\text{simply supported})') : ''}
                    ${r.supportCondition === 'one_end' ? kxInline('M^+ = w_u L_x^2/10, M^- = w_u L_x^2/10 \\quad (\\text{one-end continuous})') : ''}
                    ${r.supportCondition === 'continuous' ? kxInline('M^+ = w_u L_x^2/12, M^- = w_u L_x^2/10 \\quad (\\text{both ends continuous})') : ''}
                </div>
                <div style="background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    ${kx(`M_{x,pos} = ${r.ax_pos} \\times ${r.wFactored} \\times ${r.Lx}^2 = ${r.Mx_pos} \\text{ kN}\\cdot\\text{m/m}`)}
                    ${r.Mx_neg > 0 ? kx(`M_{x,neg} = ${r.ax_neg} \\times ${r.wFactored} \\times ${r.Lx}^2 = ${r.Mx_neg} \\text{ kN}\\cdot\\text{m/m}`) : ''}
                </div>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">3. Flexural Reinforcement &mdash; IS 456 Cl. 38.1</div>
            <div class="section-body">
                <p style="margin-top:0; color:#475569; font-size:13px;">
                    <strong>Variables:</strong><br/>
                    ${kxInline(`A_{st,req}`)}: Required area of steel<br/>
                    ${kxInline(`A_{st,prov}`)}: Provided area of steel<br/>
                    ${kxInline(`d`)}: Effective depth (${kxInline(`d_x = ${r.dx} \\text{ mm}`)})
                </p>
                <div style="display: flex; gap: 20px;">
                    <div style="flex: 1;">
                        ${flexBlock('X-Bot (Mid-span +ve)', r.Mx_pos, r.flex_x_bot.Ast_req, r.bars_x_bot.label, r.bars_x_bot.Ast_provided, r.flex_x_bot.isDoubly, r.flex_x_bot.governs, r.fck, r.fy, r.dx)}
                        ${r.Mx_neg > 0 ? flexBlock('X-Top (Support &minus;ve)', r.Mx_neg, r.flex_x_top.Ast_req, r.bars_x_top.label, r.bars_x_top.Ast_provided, r.flex_x_top.isDoubly, r.flex_x_top.governs, r.fck, r.fy, r.dx) : ''}
                    </div>
                    <div style="flex: 1;">
                        <div style="margin-bottom: 20px;">
                            <h4 style="margin: 0 0 10px 0; color: #334155;">Distribution Steel (Y-dir)</h4>
                            <div style="margin-top: 10px; padding: 6px; background: #f8fafc; border-left: 3px solid #0ea5e9;">
                                <strong>Provided:</strong> ${r.bars_y_bot.label}<br/>
                                <span style="color: #64748b; font-size: 12px;">(${kxInline(`A_{st,prov} = ${r.bars_y_bot.Ast_provided} \\text{ mm}^2\\text{/m}`)})</span><br/>
                                <span style="color: #64748b; font-size: 11px;">Min. steel per IS 456 Cl. 26.5.2.1</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        ${deflectionSection(r)}
        ${flexuralDepthSection(r)}
        ${spanDepthSection(r)}
        ${shearSection(r, [
            {label: 'Span (L_x)', dir: r.shear.shortDir},
        ])}
    `;
}

// ═══════════════════════════════════════════════════════════════
//  CANTILEVER SLAB
// ═══════════════════════════════════════════════════════════════

function generateCantileverSection(r: any): string {
    return `
        <h2 style="color: #0f172a; margin-top: 30px;">Panel ${r.label} &mdash; Cantilever Slab</h2>

        <div class="section-box">
            <div class="section-header">1. Input Parameters</div>
            <div class="section-body">
                ${inputTable([
                    ['Span L', r.Lx + ' m', 'Thickness D', r.D + ' mm'],
                    ['Cover', r.cover + ' mm', 'Concrete', r.grade + ' (f<sub>ck</sub>=' + r.fck + ' MPa)'],
                    ['Steel', r.steelGrade + ' (f<sub>y</sub>=' + r.fy + ' MPa)', 'Load Factor', String(r.loadFactor)],
                    ['Dead Load (incl. SW)', r.totalDL + ' kN/m&sup2;', 'Live Load', r.LL + ' kN/m&sup2;'],
                    ['w<sub>u</sub> (Factored)', r.wFactored + ' kN/m&sup2;', 'SDL', r.SDL + ' kN/m&sup2;'],
                ])}
            </div>
        </div>

        <div class="section-box avoid-break">
            <div class="section-header">2. Design Moment</div>
            <div class="section-body">
                <div class="info-note">
                    <strong>Cantilever slab:</strong> Fixed at support, free at tip. Governing moment is hogging at support: ${kxInline('M = w_u L^2/2')}
                </div>
                <div style="background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    ${kx(`M_{x,neg} = \\frac{w_u \\cdot L^2}{2} = \\frac{${r.wFactored} \\times ${r.Lx}^2}{2} = ${r.Mx_neg} \\text{ kN}\\cdot\\text{m/m}`)}
                </div>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">3. Flexural Reinforcement &mdash; IS 456 Cl. 38.1</div>
            <div class="section-body">
                <p style="margin-top:0; color:#475569; font-size:13px;">
                    <strong>Variables:</strong><br/>
                    ${kxInline(`A_{st,req}`)}: Required area of steel<br/>
                    ${kxInline(`A_{st,prov}`)}: Provided area of steel<br/>
                    ${kxInline(`d`)}: Effective depth (${kxInline(`d = ${r.dx} \\text{ mm}`)})
                </p>
                <div style="display: flex; gap: 20px;">
                    <div style="flex: 1;">
                        ${flexBlock('Top (Support &mdash; Hogging)', r.Mx_neg, r.flex_x_top.Ast_req, r.bars_x_top.label, r.bars_x_top.Ast_provided, r.flex_x_top.isDoubly, r.flex_x_top.governs, r.fck, r.fy, r.dx)}
                    </div>
                    <div style="flex: 1;">
                        ${flexBlock('Bottom (Distribution)', 0, r.flex_x_bot.Ast_req, r.bars_x_bot.label, r.bars_x_bot.Ast_provided, r.flex_x_bot.isDoubly, r.flex_x_bot.governs, r.fck, r.fy, r.dx)}
                    </div>
                </div>
            </div>
        </div>

        ${deflectionSection(r)}
        ${flexuralDepthSection(r)}
        ${spanDepthSection(r)}
        ${shearSection(r, [
            {label: 'Support (L_x)', dir: r.shear.shortDir},
        ])}
    `;
}
