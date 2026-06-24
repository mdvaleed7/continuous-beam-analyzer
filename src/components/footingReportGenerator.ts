import katex from "katex";
import { REPORT_CSS } from './reportStyles';

const kx = (tex: string): string => {
    try { return katex.renderToString(tex, { displayMode: true, throwOnError: false }); }
    catch { return `<div style="color:red">[KaTeX Error]</div>`; }
};

const kxInline = (tex: string): string => {
    try { return katex.renderToString(tex, { displayMode: false, throwOnError: false }); }
    catch { return `<span style="color:red">[KaTeX Error]</span>`; }
};

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
            <div class="report-header">
                <h1>IS 456 Isolated Footing Design Report</h1>
                <p>Generated on ${new Date().toLocaleDateString()}</p>
            </div>
            ${footingSections}
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
        <h2>Footing ${r.label} — Flat Footing</h2>

        <table class="meta-table">
            <tr>
                <td><strong>Column Size a×b</strong></td><td>${r.col_a}×${r.col_b} mm</td>
                <td><strong>F<sub>y</sub> (unfactored)</strong></td><td>${r.Fy} kN</td>
            </tr>
            <tr>
                <td><strong>M<sub>x</sub></strong></td><td>${r.Mx} kN·m</td>
                <td><strong>M<sub>z</sub></strong></td><td>${r.Mz} kN·m</td>
            </tr>
            <tr>
                <td><strong>Footing L×B</strong></td><td>${r.L}×${r.B} m</td>
                <td><strong>Depth D</strong></td><td>${r.D} m (${r.D * 1000} mm)</td>
            </tr>
            <tr>
                <td><strong>SBC</strong></td><td>${r.sbc} kN/m²</td>
                <td><strong>Fill above NGL</strong></td><td>${r.depthFill ?? mat.depthFill} m</td>
            </tr>
            <tr>
                <td><strong>Concrete</strong></td><td>${r.grade} (f<sub>ck</sub>=${r.fck} MPa)</td>
                <td><strong>Steel</strong></td><td>${r.steelGrade} (f<sub>y</sub>=${r.fy} MPa)</td>
            </tr>
            <tr>
                <td><strong>Cover</strong></td><td>${r.cover} mm</td>
                <td><strong>Bar dia X / Z</strong></td><td>${r.barDiaX}mm / ${r.barDiaZ}mm</td>
            </tr>
        </table>

        <h3>1. Base Area & Soil Pressure</h3>
        <div class="calc-block">
            ${kx(`A_{req} = \\frac{F_y + W_{self}}{q_{net}} = ${r.areaReq} \\text{ m}^2`)}
            ${kx(`A_{prov} = L \\times B = ${r.L} \\times ${r.B} = ${r.areaProv} \\text{ m}^2`)}
            ${kx(`p_{avg} = \\frac{P_{total}}{A} = \\frac{${r.totalLoad}}{${r.areaProv}} = ${r.soilPressure.p_avg} \\text{ kN/m}^2`)}
            ${r.Mx !== 0 || r.Mz !== 0 ? kx(`p_{max} = ${r.soilPressure.p_max} \\text{ kN/m}^2 \\leq ${r.sbc} \\times ${r.soilPressure.sbcCheckFactor} = ${r.sbc * r.soilPressure.sbcCheckFactor} \\text{ kN/m}^2`) : ''}
        </div>
        <table class="result-table">
            <tr><th>Area Req (m²)</th><th>Area Prov (m²)</th><th>Total Load (kN)</th><th>p_min (kN/m²)</th><th>p_max (kN/m²)</th><th>SBC Check</th></tr>
            <tr>
                <td>${r.areaReq}</td><td>${r.areaProv}</td><td>${r.totalLoad}</td>
                <td>${r.soilPressure.p_min}</td><td>${r.soilPressure.p_max}</td>
                <td class="${r.soilPressure.sbcCheck ? 'status-safe' : 'status-fail'}">${r.soilPressure.sbcCheck ? 'OK' : 'FAIL'}</td>
            </tr>
        </table>

        <h3>2. Punching Shear (Two-Way)</h3>
        <div class="calc-block">
            ${kx(`V_u = p_{max} \\times (A_{prov} - A_{punched}) = ${r.punchingShear.Vu} \\text{ kN}`)}
            ${kx(`\\tau_v = \\frac{V_u}{u \\cdot d} = \\frac{${r.punchingShear.Vu} \\times 10^3}{${r.punchingShear.perimeter_u} \\times d_{eff}} = ${r.punchingShear.tau_v} \\text{ N/mm}^2`)}
            ${kx(`\\tau_v = ${r.punchingShear.tau_v} \\text{ N/mm}^2 ${r.punchingShear.tau_v <= r.punchingShear.tau_c ? '\\leq' : '>'} \\tau_c = ${r.punchingShear.tau_c} \\text{ N/mm}^2`)}
        </div>
        <table class="result-table">
            <tr><th>Perimeter (mm)</th><th>Area Punched (m²)</th><th>V<sub>u</sub> (kN)</th><th>τ<sub>v</sub> (N/mm²)</th><th>τ<sub>c</sub> (N/mm²)</th><th>Status</th></tr>
            <tr>
                <td>${r.punchingShear.perimeter_u}</td><td>${r.punchingShear.area_punched}</td><td>${r.punchingShear.Vu}</td>
                <td>${r.punchingShear.tau_v}</td><td>${r.punchingShear.tau_c}</td>
                <td class="${r.punchingShear.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.punchingShear.status}</td>
            </tr>
        </table>

        <h3>3. One-Way Shear</h3>
        <table class="result-table">
            <tr><th>Direction</th><th>V<sub>u</sub> (kN)</th><th>τ<sub>v</sub> (N/mm²)</th><th>τ<sub>c</sub> (N/mm²)</th><th>Status</th></tr>
            <tr>
                <td>X (parallel L)</td><td>${r.oneWayShearX.Vu}</td><td>${r.oneWayShearX.tau_v}</td><td>${r.oneWayShearX.tau_c}</td>
                <td class="${r.oneWayShearX.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.oneWayShearX.status}</td>
            </tr>
            <tr>
                <td>Z (parallel B)</td><td>${r.oneWayShearZ.Vu}</td><td>${r.oneWayShearZ.tau_v}</td><td>${r.oneWayShearZ.tau_c}</td>
                <td class="${r.oneWayShearZ.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.oneWayShearZ.status}</td>
            </tr>
        </table>

        <h3>4. Flexural Reinforcement (IS 456 Cl. 38.1)</h3>
        <p>Effective depths: $d_x = ${r.dEffX}$ mm, $d_z = ${r.dEffZ}$ mm</p>
        <table class="result-table">
            <tr><th>Direction</th><th>M<sub>u</sub> (kN·m)</th><th>A<sub>st,req</sub> (mm²/m)</th><th>A<sub>st,min</sub> (mm²/m)</th><th>p<sub>t</sub> (%)</th><th>Governs</th><th>Status</th></tr>
            <tr>
                <td>X (parallel L)</td><td>${r.flexureX.Mu.toFixed(2)}</td><td>${r.flexureX.Ast_req}</td><td>${r.flexureX.Ast_min}</td><td>${r.flexureX.pt}</td><td>${r.flexureX.governs}</td>
                <td class="${r.flexureX.status === 'SAFE' ? 'status-safe' : 'status-fail'}">${r.flexureX.status}</td>
            </tr>
            <tr>
                <td>Z (parallel B)</td><td>${r.flexureZ.Mu.toFixed(2)}</td><td>${r.flexureZ.Ast_req}</td><td>${r.flexureZ.Ast_min}</td><td>${r.flexureZ.pt}</td><td>${r.flexureZ.governs}</td>
                <td class="${r.flexureZ.status === 'SAFE' ? 'status-safe' : 'status-fail'}">${r.flexureZ.status}</td>
            </tr>
        </table>

        <h3>5. Overall Status</h3>
        <table class="result-table">
            <tr><th>Check</th><th>Result</th></tr>
            <tr><td>SBC Check</td><td class="${r.soilPressure.sbcCheck ? 'status-safe' : 'status-fail'}">${r.soilPressure.sbcCheck ? 'OK' : 'FAIL'}</td></tr>
            <tr><td>Punching Shear</td><td class="${r.punchingShear.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.punchingShear.status}</td></tr>
            <tr><td>One-Way Shear X</td><td class="${r.oneWayShearX.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.oneWayShearX.status}</td></tr>
            <tr><td>One-Way Shear Z</td><td class="${r.oneWayShearZ.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.oneWayShearZ.status}</td></tr>
            <tr><td>Flexure X</td><td class="${r.flexureX.status === 'SAFE' ? 'status-safe' : 'status-fail'}">${r.flexureX.status}</td></tr>
            <tr><td>Flexure Z</td><td class="${r.flexureZ.status === 'SAFE' ? 'status-safe' : 'status-fail'}">${r.flexureZ.status}</td></tr>
            <tr><td><strong>Overall</strong></td><td class="${r.overallStatus === 'SAFE' ? 'status-safe' : 'status-fail'}"><strong>${r.overallStatus}</strong></td></tr>
        </table>
    `;
}

function generateSlopeFootingSection(r: any, mat: any): string {
    return `
        <h2>Footing ${r.label} — Slope Footing</h2>

        <table class="meta-table">
            <tr>
                <td><strong>Column Size a×b</strong></td><td>${r.col_a}×${r.col_b} mm</td>
                <td><strong>F<sub>y</sub> (unfactored)</strong></td><td>${r.Fy} kN</td>
            </tr>
            <tr>
                <td><strong>M<sub>x</sub></strong></td><td>${r.Mx} kN·m</td>
                <td><strong>M<sub>z</sub></strong></td><td>${r.Mz} kN·m</td>
            </tr>
            <tr>
                <td><strong>Footing L×B</strong></td><td>${r.L}×${r.B} m</td>
                <td><strong>Depth D (at edge)</strong></td><td>${r.D} m</td>
            </tr>
            <tr>
                <td><strong>D₁ (at pedestal)</strong></td><td>${r.D1 ?? '—'} mm</td>
                <td><strong>SBC</strong></td><td>${r.sbc} kN/m²</td>
            </tr>
            <tr>
                <td><strong>Concrete</strong></td><td>${r.grade} (f<sub>ck</sub>=${r.fck} MPa)</td>
                <td><strong>Steel</strong></td><td>${r.steelGrade} (f<sub>y</sub>=${r.fy} MPa)</td>
            </tr>
            <tr>
                <td><strong>Cover</strong></td><td>${r.cover} mm</td>
                <td><strong>Bar dia X / Z</strong></td><td>${r.barDiaX}mm / ${r.barDiaZ}mm</td>
            </tr>
        </table>

        <div class="info-note">
            <strong>Slope footing:</strong> The top surface is sloped from the pedestal edge to the
            footing edge. The effective depth at the pedestal (D₁ = ${r.D1} mm) governs the flexural
            and shear design. The base thickness D = ${r.D} m is maintained at the edge for
            constructability.
        </div>

        <h3>1. Base Area & Soil Pressure</h3>
        <div class="calc-block">
            ${kx(`A_{req} = ${r.areaReq} \\text{ m}^2, \\quad A_{prov} = ${r.areaProv} \\text{ m}^2`)}
            ${kx(`p_{max} = ${r.soilPressure.p_max} \\text{ kN/m}^2`)}
        </div>
        <table class="result-table">
            <tr><th>Area Req</th><th>Area Prov</th><th>Total Load</th><th>p_min</th><th>p_max</th><th>SBC Check</th></tr>
            <tr>
                <td>${r.areaReq} m²</td><td>${r.areaProv} m²</td><td>${r.totalLoad} kN</td>
                <td>${r.soilPressure.p_min}</td><td>${r.soilPressure.p_max}</td>
                <td class="${r.soilPressure.sbcCheck ? 'status-safe' : 'status-fail'}">${r.soilPressure.sbcCheck ? 'OK' : 'FAIL'}</td>
            </tr>
        </table>

        <h3>2. Punching Shear</h3>
        <table class="result-table">
            <tr><th>Perimeter</th><th>V<sub>u</sub></th><th>τ<sub>v</sub></th><th>τ<sub>c</sub></th><th>Status</th></tr>
            <tr>
                <td>${r.punchingShear.perimeter_u} mm</td><td>${r.punchingShear.Vu} kN</td>
                <td>${r.punchingShear.tau_v} N/mm²</td><td>${r.punchingShear.tau_c} N/mm²</td>
                <td class="${r.punchingShear.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.punchingShear.status}</td>
            </tr>
        </table>

        <h3>3. One-Way Shear</h3>
        <table class="result-table">
            <tr><th>Direction</th><th>V<sub>u</sub></th><th>τ<sub>v</sub></th><th>τ<sub>c</sub></th><th>Status</th></tr>
            <tr>
                <td>X</td><td>${r.oneWayShearX.Vu} kN</td><td>${r.oneWayShearX.tau_v} N/mm²</td><td>${r.oneWayShearX.tau_c} N/mm²</td>
                <td class="${r.oneWayShearX.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.oneWayShearX.status}</td>
            </tr>
            <tr>
                <td>Z</td><td>${r.oneWayShearZ.Vu} kN</td><td>${r.oneWayShearZ.tau_v} N/mm²</td><td>${r.oneWayShearZ.tau_c} N/mm²</td>
                <td class="${r.oneWayShearZ.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.oneWayShearZ.status}</td>
            </tr>
        </table>

        <h3>4. Flexural Reinforcement</h3>
        <p>Effective depths at pedestal: $d_x = ${r.dEffX}$ mm, $d_z = ${r.dEffZ}$ mm</p>
        <table class="result-table">
            <tr><th>Direction</th><th>M<sub>u</sub></th><th>A<sub>st,req</sub></th><th>p<sub>t</sub></th><th>Status</th></tr>
            <tr>
                <td>X</td><td>${r.flexureX.Mu.toFixed(2)} kN·m</td><td>${r.flexureX.Ast_req} mm²/m</td><td>${r.flexureX.pt}%</td>
                <td class="${r.flexureX.status === 'SAFE' ? 'status-safe' : 'status-fail'}">${r.flexureX.status}</td>
            </tr>
            <tr>
                <td>Z</td><td>${r.flexureZ.Mu.toFixed(2)} kN·m</td><td>${r.flexureZ.Ast_req} mm²/m</td><td>${r.flexureZ.pt}%</td>
                <td class="${r.flexureZ.status === 'SAFE' ? 'status-safe' : 'status-fail'}">${r.flexureZ.status}</td>
            </tr>
        </table>

        <h3>5. Slope Adequacy Check</h3>
        <table class="result-table">
            <tr><th>Slope Angle</th><th>Adequacy</th><th>Note</th></tr>
            <tr>
                <td>${r.slopeCheck?.slopeAngleDeg ?? '—'}°</td>
                <td class="${r.slopeCheck?.isAdequate ? 'status-safe' : 'status-fail'}">${r.slopeCheck?.isAdequate ? 'OK' : 'ALTER'}</td>
                <td>${r.slopeCheck?.note ?? ''}</td>
            </tr>
        </table>

        <h3>6. Overall Status</h3>
        <table class="result-table">
            <tr><th>Check</th><th>Result</th></tr>
            <tr><td>SBC Check</td><td class="${r.soilPressure.sbcCheck ? 'status-safe' : 'status-fail'}">${r.soilPressure.sbcCheck ? 'OK' : 'FAIL'}</td></tr>
            <tr><td>Punching Shear</td><td class="${r.punchingShear.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.punchingShear.status}</td></tr>
            <tr><td>One-Way Shear X</td><td class="${r.oneWayShearX.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.oneWayShearX.status}</td></tr>
            <tr><td>One-Way Shear Z</td><td class="${r.oneWayShearZ.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.oneWayShearZ.status}</td></tr>
            <tr><td>Flexure X</td><td class="${r.flexureX.status === 'SAFE' ? 'status-safe' : 'status-fail'}">${r.flexureX.status}</td></tr>
            <tr><td>Flexure Z</td><td class="${r.flexureZ.status === 'SAFE' ? 'status-safe' : 'status-fail'}">${r.flexureZ.status}</td></tr>
            <tr><td>Slope Check</td><td class="${r.slopeCheck?.isAdequate ? 'status-safe' : 'status-fail'}">${r.slopeCheck?.isAdequate ? 'OK' : 'ALTER'}</td></tr>
            <tr><td><strong>Overall</strong></td><td class="${r.overallStatus === 'SAFE' ? 'status-safe' : 'status-fail'}"><strong>${r.overallStatus}</strong></td></tr>
        </table>
    `;
}
