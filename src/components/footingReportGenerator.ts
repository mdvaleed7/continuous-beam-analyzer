import katex from 'katex';
import { logger } from '../lib/logger';
import { REPORT_CSS, calcRow, inputTable } from './reportCss';

// ═══════════════════════════════════════════════════════════════
//  FOOTING REPORT GENERATOR — Detailed Mathematical Textbook Layout
// ═══════════════════════════════════════════════════════════════

const kx = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: true, fleqn: true });
const kxInline = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: false });

function statusChip(status: string): string {
    const cls = (status === 'OK' || status === 'SAFE') ? '#10b981' : '#ef4444';
    return `<span style="color: ${cls}; font-weight: bold;">${status}</span>`;
}

export async function generateFootingReport(config: any, results: any[], isPreview: boolean = false): Promise<string | null> {
    const { material } = config;

    const footingSections = results.map((r: any) => {
        return r.footingType === 'slope' ? generateSlopeFootingSection(r, material) : generateFlatFootingSection(r, material);
    }).join('<div style="page-break-before: always;"></div>');

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Isolated Footing Design Report</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css" />
            ${REPORT_CSS}
        </head>
        <body>
            <div class="report-container">
                <div class="report-header">
                    <h1>IS 456 Isolated Footing Design Report</h1>
                    <p>Design Code: IS 456:2000 | Generated: ${new Date().toLocaleString()}</p>
                </div>
                ${footingSections}
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
                    logger.error('Footing print failed, falling back to new tab', e);
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

// ─── Formatting Helpers ─────────────────────────────────────────────────────────

function flexBlock(label: string, Mu: number, AstReq: number, AstMin: number, pt: number, governs: string, status: string, fck: number, fy: number, d: number): string {
    return `
        <div style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px 0; color: #334155;">${label}</h4>
            ${kx(`M_u = ${Mu.toFixed(2)} \\text{ kN}\\cdot\\text{m}`)}
            ${governs === 'design' ? 
                kx(`A_{st,req} = \\frac{0.5 f_{ck}}{f_y} \\left[ 1 - \\sqrt{1 - \\frac{4.6 M_u}{f_{ck} b d^2}} \\right] bd = ${AstReq} \\text{ mm}^2\\text{/m}`) : 
                kx(`A_{st,req} = ${AstReq} \\text{ mm}^2\\text{/m} \\quad (\\text{Min. governs: } ${AstMin})`)
            }
            ${kx(`p_t = ${pt}\\% `)}
            <div style="margin-top: 6px;">
                Status: ${statusChip(status)}
            </div>
        </div>
    `;
}

function oneWayShearBlock(label: string, rDir: any): string {
    return `
        <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px dashed #e2e8f0;">
            <h4 style="margin-top: 0;">${label}</h4>
            <div style="display: flex; gap: 20px;">
                <div style="flex: 1;">
                    ${kx(`V_u = ${rDir.Vu} \\text{ kN}`)}
                    ${kx(`\\tau_v = \\frac{V_u}{bd} = ${rDir.tau_v} \\text{ N/mm}^2`)}
                </div>
                <div style="flex: 1;">
                    ${kx(`\\tau_c = ${rDir.tau_c} \\text{ N/mm}^2`)}
                    <div style="margin: 10px 0; font-weight: bold; color: ${rDir.status === 'FAIL' ? '#ef4444' : '#10b981'}; text-align: left;">
                        Result: ${kxInline(`\\tau_v ${rDir.status === 'OK' ? '\\le' : '>'} \\tau_c`)} &rarr; ${rDir.status}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════
//  FLAT FOOTING
// ═══════════════════════════════════════════════════════════════

function generateFlatFootingSection(r: any, mat: any): string {
    return `
        <h2 style="color: #0f172a; margin-top: 30px;">Footing ${r.label} &mdash; Flat Footing</h2>

        <div class="section-box">
            <div class="section-header">1. Input Parameters</div>
            <div class="section-body">
                ${inputTable([
                    ['Column Size a&times;b', r.col_a + '&times;' + r.col_b + ' mm', 'F<sub>y</sub> (unfactored)', r.Fy + ' kN'],
                    ['M<sub>x</sub>', r.Mx + ' kN&middot;m', 'M<sub>z</sub>', r.Mz + ' kN&middot;m'],
                    ['Footing L&times;B', r.L + '&times;' + r.B + ' m', 'Depth D', r.D + ' m (' + (r.D * 1000) + ' mm)'],
                    ['SBC', r.sbc + ' kN/m&sup2;', 'Fill above NGL', (r.depthFill ?? mat.depthFill) + ' m'],
                    ['Concrete', r.grade + ' (f<sub>ck</sub>=' + r.fck + ' MPa)', 'Steel', r.steelGrade + ' (f<sub>y</sub>=' + r.fy + ' MPa)'],
                    ['Cover', r.cover + ' mm', 'Bar &phi; X / Z', r.barDiaX + 'mm / ' + r.barDiaZ + 'mm'],
                ])}
            </div>
        </div>

        <div class="section-box avoid-break">
            <div class="section-header">2. Base Area &amp; Soil Pressure</div>
            <div class="section-body">
                <p style="margin-top:0; color:#475569; font-size:13px;">
                    <strong>Variables:</strong><br/>
                    ${kxInline(`A_{req}`)}: Required area of footing<br/>
                    ${kxInline(`A_{prov}`)}: Provided area (${kxInline(`L \\times B`)})<br/>
                    ${kxInline(`p_{avg}`)}: Average soil pressure<br/>
                    ${kxInline(`p_{max}, p_{min}`)}: Maximum and minimum soil pressure
                </p>
                <div style="display: flex; gap: 20px; align-items: center;">
                    <div style="flex: 1; background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0;">
                        ${kx(`A_{req} = \\frac{F_y + W_{self}}{q_{net}} = ${r.areaReq} \\text{ m}^2`)}
                        ${kx(`A_{prov} = L \\times B = ${r.L} \\times ${r.B} = ${r.areaProv} \\text{ m}^2`)}
                        ${kx(`p_{avg} = \\frac{P_{total}}{A} = \\frac{${r.totalLoad}}{${r.areaProv}} = ${r.soilPressure.p_avg} \\text{ kN/m}^2`)}
                        ${r.Mx !== 0 || r.Mz !== 0 ? kx(`p_{max} = ${r.soilPressure.p_max} \\text{ kN/m}^2 \\le ${r.sbc * r.soilPressure.sbcCheckFactor} \\text{ kN/m}^2`) : ''}
                    </div>
                    <div style="flex: 1;">
                        <table class="result-table" style="margin: 0;">
                            <tr><th>A<sub>req</sub> (m&sup2;)</th><th>A<sub>prov</sub> (m&sup2;)</th><th>P<sub>total</sub> (kN)</th></tr>
                            <tr><td>${r.areaReq}</td><td>${r.areaProv}</td><td>${r.totalLoad}</td></tr>
                            <tr><th>p<sub>min</sub> (kN/m&sup2;)</th><th>p<sub>max</sub> (kN/m&sup2;)</th><th>SBC Check</th></tr>
                            <tr><td>${r.soilPressure.p_min}</td><td>${r.soilPressure.p_max}</td><td>${statusChip(r.soilPressure.sbcCheck ? 'OK' : 'FAIL')}</td></tr>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box avoid-break">
            <div class="section-header">3. Shear Checks</div>
            <div class="section-body">
                <p style="margin-top:0; color:#475569; font-size:13px;">
                    <strong>Variables:</strong><br/>
                    ${kxInline(`V_u`)}: Factored shear force<br/>
                    ${kxInline(`\\tau_v`)}: Nominal shear stress<br/>
                    ${kxInline(`\\tau_c`)}: Design shear strength of concrete
                </p>
                <div style="display: flex; gap: 20px;">
                    <div style="flex: 1; border-right: 1px solid #e2e8f0; padding-right: 20px;">
                        <h4 style="margin-top: 0;">A. Punching Shear (Two-Way)</h4>
                        ${kx(`V_u = p_{max} \\times (A_{prov} - A_{punched}) = ${r.punchingShear.Vu} \\text{ kN}`)}
                        ${kx(`u = ${r.punchingShear.perimeter_u} \\text{ mm} \\quad (\\text{perimeter})`)}
                        ${kx(`\\tau_v = \\frac{V_u}{u \\times d} = ${r.punchingShear.tau_v} \\text{ N/mm}^2`)}
                        ${kx(`\\tau_c = 0.25\\sqrt{f_{ck}} = ${r.punchingShear.tau_c} \\text{ N/mm}^2`)}
                        <div style="margin-top: 15px; font-weight: bold; color: ${r.punchingShear.status === 'FAIL' ? '#ef4444' : '#10b981'}; text-align: left;">
                            Result: ${kxInline(`\\tau_v ${r.punchingShear.tau_v <= r.punchingShear.tau_c ? '\\le' : '>'} \\tau_c`)} &rarr; ${r.punchingShear.status}
                        </div>
                    </div>
                    <div style="flex: 1;">
                        <h4 style="margin-top: 0;">B. One-Way Shear</h4>
                        ${oneWayShearBlock('X (along L)', r.oneWayShearX)}
                        ${oneWayShearBlock('Z (along B)', r.oneWayShearZ)}
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box avoid-break">
            <div class="section-header">4. Flexural Reinforcement &mdash; IS 456 Cl. 38.1</div>
            <div class="section-body">
                <p style="margin-top:0; color:#475569; font-size:13px;">
                    Effective depths: ${kxInline(`d_x = ${r.dEffX} \\text{ mm}`)}, ${kxInline(`d_z = ${r.dEffZ} \\text{ mm}`)}
                </p>
                <div style="display: flex; gap: 20px;">
                    <div style="flex: 1;">
                        ${flexBlock('X-Direction (parallel L)', r.flexureX.Mu, r.flexureX.Ast_req, r.flexureX.Ast_min, r.flexureX.pt, r.flexureX.governs, r.flexureX.status, r.fck, r.fy, r.dEffX)}
                    </div>
                    <div style="flex: 1;">
                        ${flexBlock('Z-Direction (parallel B)', r.flexureZ.Mu, r.flexureZ.Ast_req, r.flexureZ.Ast_min, r.flexureZ.pt, r.flexureZ.governs, r.flexureZ.status, r.fck, r.fy, r.dEffZ)}
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box avoid-break">
            <div class="section-header">5. Overall Status</div>
            <div class="section-body">
                <table class="result-table" style="margin: 0;">
                    <tr><th>Check</th><th>Result</th><th>Check</th><th>Result</th></tr>
                    <tr>
                        <td>SBC</td><td>${statusChip(r.soilPressure.sbcCheck ? 'OK' : 'FAIL')}</td>
                        <td>Punching Shear</td><td>${statusChip(r.punchingShear.status)}</td>
                    </tr>
                    <tr>
                        <td>One-Way Shear X</td><td>${statusChip(r.oneWayShearX.status)}</td>
                        <td>One-Way Shear Z</td><td>${statusChip(r.oneWayShearZ.status)}</td>
                    </tr>
                    <tr>
                        <td>Flexure X</td><td>${statusChip(r.flexureX.status)}</td>
                        <td>Flexure Z</td><td>${statusChip(r.flexureZ.status)}</td>
                    </tr>
                    <tr>
                        <td><strong>Overall</strong></td><td colspan="3">${statusChip(r.overallStatus)}</td>
                    </tr>
                </table>
            </div>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════
//  SLOPE FOOTING
// ═══════════════════════════════════════════════════════════════

function generateSlopeFootingSection(r: any, mat: any): string {
    return `
        <h2 style="color: #0f172a; margin-top: 30px;">Footing ${r.label} &mdash; Slope Footing</h2>

        <div class="section-box">
            <div class="section-header">1. Input Parameters</div>
            <div class="section-body">
                ${inputTable([
                    ['Column Size a&times;b', r.col_a + '&times;' + r.col_b + ' mm', 'F<sub>y</sub> (unfactored)', r.Fy + ' kN'],
                    ['M<sub>x</sub>', r.Mx + ' kN&middot;m', 'M<sub>z</sub>', r.Mz + ' kN&middot;m'],
                    ['Footing L&times;B', r.L + '&times;' + r.B + ' m', 'Depth D (at edge)', r.D + ' m'],
                    ['D<sub>1</sub> (at pedestal)', (r.D1 ?? '&mdash;') + ' mm', 'SBC', r.sbc + ' kN/m&sup2;'],
                    ['Concrete', r.grade + ' (f<sub>ck</sub>=' + r.fck + ' MPa)', 'Steel', r.steelGrade + ' (f<sub>y</sub>=' + r.fy + ' MPa)'],
                    ['Cover', r.cover + ' mm', 'Bar &phi; X / Z', r.barDiaX + 'mm / ' + r.barDiaZ + 'mm'],
                ])}
                <div class="info-note">
                    <strong>Slope footing:</strong> Top surface slopes from pedestal edge (D<sub>1</sub> = ${r.D1} mm) to footing edge (D = ${r.D} m).
                    The effective depth at the pedestal governs the flexural and shear design.
                </div>
            </div>
        </div>

        <div class="section-box avoid-break">
            <div class="section-header">2. Base Area &amp; Soil Pressure</div>
            <div class="section-body">
                <div style="display: flex; gap: 20px; align-items: center;">
                    <div style="flex: 1; background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0;">
                        ${kx(`A_{req} = ${r.areaReq} \\text{ m}^2`)}
                        ${kx(`A_{prov} = ${r.areaProv} \\text{ m}^2`)}
                        ${kx(`p_{max} = ${r.soilPressure.p_max} \\text{ kN/m}^2`)}
                    </div>
                    <div style="flex: 1;">
                        <table class="result-table" style="margin: 0;">
                            <tr><th>A<sub>req</sub></th><th>A<sub>prov</sub></th><th>P<sub>total</sub></th></tr>
                            <tr><td>${r.areaReq} m&sup2;</td><td>${r.areaProv} m&sup2;</td><td>${r.totalLoad} kN</td></tr>
                            <tr><th>p<sub>min</sub></th><th>p<sub>max</sub></th><th>SBC Check</th></tr>
                            <tr><td>${r.soilPressure.p_min}</td><td>${r.soilPressure.p_max}</td><td>${statusChip(r.soilPressure.sbcCheck ? 'OK' : 'FAIL')}</td></tr>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box avoid-break">
            <div class="section-header">3. Shear Checks</div>
            <div class="section-body">
                <div style="display: flex; gap: 20px;">
                    <div style="flex: 1; border-right: 1px solid #e2e8f0; padding-right: 20px;">
                        <h4 style="margin-top: 0;">A. Punching Shear (Two-Way)</h4>
                        ${kx(`V_u = ${r.punchingShear.Vu} \\text{ kN}`)}
                        ${kx(`u = ${r.punchingShear.perimeter_u} \\text{ mm}`)}
                        ${kx(`\\tau_v = ${r.punchingShear.tau_v} \\text{ N/mm}^2`)}
                        ${kx(`\\tau_c = ${r.punchingShear.tau_c} \\text{ N/mm}^2`)}
                        <div style="margin-top: 15px; font-weight: bold; color: ${r.punchingShear.status === 'FAIL' ? '#ef4444' : '#10b981'}; text-align: left;">
                            Result: ${kxInline(`\\tau_v ${r.punchingShear.tau_v <= r.punchingShear.tau_c ? '\\le' : '>'} \\tau_c`)} &rarr; ${r.punchingShear.status}
                        </div>
                    </div>
                    <div style="flex: 1;">
                        <h4 style="margin-top: 0;">B. One-Way Shear</h4>
                        ${oneWayShearBlock('X', r.oneWayShearX)}
                        ${oneWayShearBlock('Z', r.oneWayShearZ)}
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box avoid-break">
            <div class="section-header">4. Flexural Reinforcement</div>
            <div class="section-body">
                <p style="margin-top:0; color:#475569; font-size:13px;">
                    Effective depths at pedestal: ${kxInline(`d_x = ${r.dEffX} \\text{ mm}`)}, ${kxInline(`d_z = ${r.dEffZ} \\text{ mm}`)}
                </p>
                <div style="display: flex; gap: 20px;">
                    <div style="flex: 1;">
                        ${flexBlock('X-Direction', r.flexureX.Mu, r.flexureX.Ast_req, r.flexureX.Ast_min, r.flexureX.pt, r.flexureX.governs, r.flexureX.status, r.fck, r.fy, r.dEffX)}
                    </div>
                    <div style="flex: 1;">
                        ${flexBlock('Z-Direction', r.flexureZ.Mu, r.flexureZ.Ast_req, r.flexureZ.Ast_min, r.flexureZ.pt, r.flexureZ.governs, r.flexureZ.status, r.fck, r.fy, r.dEffZ)}
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box avoid-break">
            <div class="section-header">5. Slope Adequacy Check</div>
            <div class="section-body">
                <div style="display: flex; gap: 20px; align-items: center;">
                    <div style="flex: 1;">
                        <table class="result-table" style="margin: 0;">
                            <tr><th>Slope Angle</th><td>${r.slopeCheck?.slopeAngleDeg ?? '&mdash;'} &deg;</td></tr>
                            <tr><th>Adequacy</th><td>${statusChip(r.slopeCheck?.isAdequate ? 'OK' : 'FAIL')}</td></tr>
                        </table>
                    </div>
                    <div style="flex: 1; color: #475569; font-size: 13px;">
                        <strong>Note:</strong> ${r.slopeCheck?.note ?? ''}
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box avoid-break">
            <div class="section-header">6. Overall Status</div>
            <div class="section-body">
                <table class="result-table" style="margin: 0;">
                    <tr><th>Check</th><th>Result</th><th>Check</th><th>Result</th></tr>
                    <tr>
                        <td>SBC</td><td>${statusChip(r.soilPressure.sbcCheck ? 'OK' : 'FAIL')}</td>
                        <td>Punching Shear</td><td>${statusChip(r.punchingShear.status)}</td>
                    </tr>
                    <tr>
                        <td>One-Way Shear X</td><td>${statusChip(r.oneWayShearX.status)}</td>
                        <td>One-Way Shear Z</td><td>${statusChip(r.oneWayShearZ.status)}</td>
                    </tr>
                    <tr>
                        <td>Flexure X</td><td>${statusChip(r.flexureX.status)}</td>
                        <td>Flexure Z</td><td>${statusChip(r.flexureZ.status)}</td>
                    </tr>
                    <tr>
                        <td>Slope Check</td><td>${statusChip(r.slopeCheck?.isAdequate ? 'OK' : 'FAIL')}</td>
                        <td><strong>Overall</strong></td><td>${statusChip(r.overallStatus)}</td>
                    </tr>
                </table>
            </div>
        </div>
    `;
}
