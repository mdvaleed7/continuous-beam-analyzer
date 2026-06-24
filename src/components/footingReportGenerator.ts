import { logger } from '../lib/logger';
import { REPORT_CSS as FOOTING_REPORT_CSS, calcRow, inputTable } from './reportCss';

// ═══════════════════════════════════════════════════════════════
//  FOOTING REPORT GENERATOR — two-column book layout with HTML symbols
// ═══════════════════════════════════════════════════════════════


function statusChip(status: string): string {
    const cls = (status === 'OK' || status === 'SAFE') ? 'status-safe' : 'status-fail';
    return `<span class="${cls}">${status}</span>`;
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
            ${FOOTING_REPORT_CSS}
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

    if (isPreview) {
        return htmlContent;
    } else {
        const win = window.open('', '_blank')!;
        win.document.write(htmlContent);
        win.document.close();
        setTimeout(() => { win.print(); }, 500);
        return null;
    }
}

function generateFlatFootingSection(r: any, mat: any): string {
    return `
        <h2>Footing ${r.label} &mdash; Flat Footing</h2>

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

        <div class="section-box">
            <div class="section-header">2. Base Area &amp; Soil Pressure</div>
            <div class="section-body">
                <div class="two-col">
                    <div class="col col-left">
                        <div class="calc-block">
                            A<sub>req</sub> = F<sub>y</sub> + W<sub>self</sub> / q<sub>net</sub> = <strong>${r.areaReq} m&sup2;</strong><br/>
                            A<sub>prov</sub> = L &times; B = ${r.L} &times; ${r.B} = <strong>${r.areaProv} m&sup2;</strong><br/>
                            p<sub>avg</sub> = P<sub>total</sub> / A = ${r.totalLoad} / ${r.areaProv} = <strong>${r.soilPressure.p_avg} kN/m&sup2;</strong>
                            ${r.Mx !== 0 || r.Mz !== 0 ? `<br/>p<sub>max</sub> = <strong>${r.soilPressure.p_max} kN/m&sup2;</strong> &le; ${r.sbc * r.soilPressure.sbcCheckFactor} kN/m&sup2;` : ''}
                        </div>
                    </div>
                    <div class="col">
                        <table class="result-table">
                            <tr><th>A<sub>req</sub> (m&sup2;)</th><th>A<sub>prov</sub> (m&sup2;)</th><th>P<sub>total</sub> (kN)</th></tr>
                            <tr><td>${r.areaReq}</td><td>${r.areaProv}</td><td>${r.totalLoad}</td></tr>
                            <tr><th>p<sub>min</sub> (kN/m&sup2;)</th><th>p<sub>max</sub> (kN/m&sup2;)</th><th>SBC Check</th></tr>
                            <tr><td>${r.soilPressure.p_min}</td><td>${r.soilPressure.p_max}</td><td>${statusChip(r.soilPressure.sbcCheck ? 'OK' : 'FAIL')}</td></tr>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">3. Shear Checks</div>
            <div class="section-body">
                <div class="two-col">
                    <div class="col col-left">
                        <h4>A. Punching Shear (Two-Way)</h4>
                        <div class="calc-block">
                            V<sub>u</sub> = p<sub>max</sub> &times; (A<sub>prov</sub> &minus; A<sub>punched</sub>) = <strong>${r.punchingShear.Vu} kN</strong><br/>
                            Perimeter u = <strong>${r.punchingShear.perimeter_u} mm</strong><br/>
                            &tau;<sub>v</sub> = V<sub>u</sub> / (u &times; d) = <strong>${r.punchingShear.tau_v} N/mm&sup2;</strong><br/>
                            &tau;<sub>c</sub> = 0.25&radic;f<sub>ck</sub> = <strong>${r.punchingShear.tau_c} N/mm&sup2;</strong><br/>
                            &tau;<sub>v</sub> ${r.punchingShear.tau_v <= r.punchingShear.tau_c ? '&le;' : '&gt;'} &tau;<sub>c</sub> &rarr; ${statusChip(r.punchingShear.status)}
                        </div>
                    </div>
                    <div class="col">
                        <h4>B. One-Way Shear</h4>
                        <table class="result-table">
                            <tr><th>Dir</th><th>V<sub>u</sub> (kN)</th><th>&tau;<sub>v</sub> (N/mm&sup2;)</th><th>&tau;<sub>c</sub> (N/mm&sup2;)</th><th>Status</th></tr>
                            <tr>
                                <td>X (along L)</td><td>${r.oneWayShearX.Vu}</td><td>${r.oneWayShearX.tau_v}</td><td>${r.oneWayShearX.tau_c}</td>
                                <td>${statusChip(r.oneWayShearX.status)}</td>
                            </tr>
                            <tr>
                                <td>Z (along B)</td><td>${r.oneWayShearZ.Vu}</td><td>${r.oneWayShearZ.tau_v}</td><td>${r.oneWayShearZ.tau_c}</td>
                                <td>${statusChip(r.oneWayShearZ.status)}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">4. Flexural Reinforcement &mdash; IS 456 Cl. 38.1</div>
            <div class="section-body">
                <div style="font-size:10px;margin-bottom:6px;">Effective depths: d<sub>x</sub> = ${r.dEffX} mm, d<sub>z</sub> = ${r.dEffZ} mm</div>
                <div class="two-col">
                    <div class="col col-left">
                        <h4>X-Direction (parallel L)</h4>
                        ${calcRow('M<sub>u</sub>', r.flexureX.Mu.toFixed(2), 'kN&middot;m')}
                        ${calcRow('A<sub>st,req</sub>', r.flexureX.Ast_req, 'mm&sup2;/m')}
                        ${calcRow('A<sub>st,min</sub>', r.flexureX.Ast_min, 'mm&sup2;/m')}
                        ${calcRow('p<sub>t</sub>', r.flexureX.pt, '%')}
                        ${calcRow('Governs', r.flexureX.governs)}
                        ${calcRow('Status', statusChip(r.flexureX.status))}
                    </div>
                    <div class="col">
                        <h4>Z-Direction (parallel B)</h4>
                        ${calcRow('M<sub>u</sub>', r.flexureZ.Mu.toFixed(2), 'kN&middot;m')}
                        ${calcRow('A<sub>st,req</sub>', r.flexureZ.Ast_req, 'mm&sup2;/m')}
                        ${calcRow('A<sub>st,min</sub>', r.flexureZ.Ast_min, 'mm&sup2;/m')}
                        ${calcRow('p<sub>t</sub>', r.flexureZ.pt, '%')}
                        ${calcRow('Governs', r.flexureZ.governs)}
                        ${calcRow('Status', statusChip(r.flexureZ.status))}
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">5. Overall Status</div>
            <div class="section-body">
                <table class="result-table">
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

function generateSlopeFootingSection(r: any, mat: any): string {
    return `
        <h2>Footing ${r.label} &mdash; Slope Footing</h2>

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

        <div class="section-box">
            <div class="section-header">2. Base Area &amp; Soil Pressure</div>
            <div class="section-body">
                <div class="two-col">
                    <div class="col col-left">
                        <div class="calc-block">
                            A<sub>req</sub> = <strong>${r.areaReq} m&sup2;</strong><br/>
                            A<sub>prov</sub> = <strong>${r.areaProv} m&sup2;</strong><br/>
                            p<sub>max</sub> = <strong>${r.soilPressure.p_max} kN/m&sup2;</strong>
                        </div>
                    </div>
                    <div class="col">
                        <table class="result-table">
                            <tr><th>A<sub>req</sub></th><th>A<sub>prov</sub></th><th>P<sub>total</sub></th></tr>
                            <tr><td>${r.areaReq} m&sup2;</td><td>${r.areaProv} m&sup2;</td><td>${r.totalLoad} kN</td></tr>
                            <tr><th>p<sub>min</sub></th><th>p<sub>max</sub></th><th>SBC Check</th></tr>
                            <tr><td>${r.soilPressure.p_min}</td><td>${r.soilPressure.p_max}</td><td>${statusChip(r.soilPressure.sbcCheck ? 'OK' : 'FAIL')}</td></tr>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">3. Shear Checks</div>
            <div class="section-body">
                <div class="two-col">
                    <div class="col col-left">
                        <h4>A. Punching Shear (Two-Way)</h4>
                        <table class="result-table">
                            <tr><th>Perimeter</th><th>V<sub>u</sub></th><th>&tau;<sub>v</sub></th><th>&tau;<sub>c</sub></th><th>Status</th></tr>
                            <tr>
                                <td>${r.punchingShear.perimeter_u} mm</td><td>${r.punchingShear.Vu} kN</td>
                                <td>${r.punchingShear.tau_v} N/mm&sup2;</td><td>${r.punchingShear.tau_c} N/mm&sup2;</td>
                                <td>${statusChip(r.punchingShear.status)}</td>
                            </tr>
                        </table>
                    </div>
                    <div class="col">
                        <h4>B. One-Way Shear</h4>
                        <table class="result-table">
                            <tr><th>Dir</th><th>V<sub>u</sub></th><th>&tau;<sub>v</sub></th><th>&tau;<sub>c</sub></th><th>Status</th></tr>
                            <tr>
                                <td>X</td><td>${r.oneWayShearX.Vu} kN</td><td>${r.oneWayShearX.tau_v}</td><td>${r.oneWayShearX.tau_c}</td>
                                <td>${statusChip(r.oneWayShearX.status)}</td>
                            </tr>
                            <tr>
                                <td>Z</td><td>${r.oneWayShearZ.Vu} kN</td><td>${r.oneWayShearZ.tau_v}</td><td>${r.oneWayShearZ.tau_c}</td>
                                <td>${statusChip(r.oneWayShearZ.status)}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">4. Flexural Reinforcement</div>
            <div class="section-body">
                <div style="font-size:10px;margin-bottom:6px;">Effective depths at pedestal: d<sub>x</sub> = ${r.dEffX} mm, d<sub>z</sub> = ${r.dEffZ} mm</div>
                <div class="two-col">
                    <div class="col col-left">
                        <h4>X-Direction</h4>
                        ${calcRow('M<sub>u</sub>', r.flexureX.Mu.toFixed(2), 'kN&middot;m')}
                        ${calcRow('A<sub>st,req</sub>', r.flexureX.Ast_req, 'mm&sup2;/m')}
                        ${calcRow('p<sub>t</sub>', r.flexureX.pt, '%')}
                        ${calcRow('Status', statusChip(r.flexureX.status))}
                    </div>
                    <div class="col">
                        <h4>Z-Direction</h4>
                        ${calcRow('M<sub>u</sub>', r.flexureZ.Mu.toFixed(2), 'kN&middot;m')}
                        ${calcRow('A<sub>st,req</sub>', r.flexureZ.Ast_req, 'mm&sup2;/m')}
                        ${calcRow('p<sub>t</sub>', r.flexureZ.pt, '%')}
                        ${calcRow('Status', statusChip(r.flexureZ.status))}
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">5. Slope Adequacy Check</div>
            <div class="section-body">
                <div class="two-col">
                    <div class="col col-left">
                        ${calcRow('Slope Angle', (r.slopeCheck?.slopeAngleDeg ?? '&mdash;'), '&deg;')}
                        ${calcRow('Adequacy', statusChip(r.slopeCheck?.isAdequate ? 'OK' : 'FAIL'))}
                    </div>
                    <div class="col">
                        ${calcRow('Note', r.slopeCheck?.note ?? '')}
                    </div>
                </div>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">6. Overall Status</div>
            <div class="section-body">
                <table class="result-table">
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
