import katex from 'katex';
import { logger } from '../lib/logger';
import { REPORT_CSS, FIT_FORMULAS_SCRIPT } from './reportCss';
import type { RetainingWallInput, RetainingWallResult } from './retainingWallEngine';

const fmt = (v: number, d: number = 2) => v.toFixed(d);

export async function generateRetainingWallReport(
    config: RetainingWallInput,
    result: RetainingWallResult,
    canvas: HTMLCanvasElement | null,
    previewMode: boolean = false,
): Promise<string | null | void> {
    const kx = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: true, fleqn: true });
    const kxInline = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: false });

    if (!result || result.H === undefined) {
        logger.error('generateRetainingWallReport: invalid result object', result);
        if (typeof window !== 'undefined') {
            window.alert('Cannot generate report: run the analysis first.');
        }
        return previewMode ? null : undefined;
    }

    const r = result;
    const safe = r.overallStatus === 'SAFE';

    // Canvas image
    let canvasImgTag = '';
    if (canvas) {
        try {
            const imgData = canvas.toDataURL('image/png');
            canvasImgTag = `<img src="${imgData}" style="max-width:100%; height:auto; border:1px solid #e2e8f0; border-radius:4px;" />`;
        } catch { /* noop */ }
    }

    let html = `
    <div id="pdf-report">
        <div class="report-header">
            <h1>Cantilever Retaining Wall Design Report</h1>
            <p>Design Code: IS 456:2000 &amp; Rankine Earth Pressure | Generated: ${new Date().toLocaleString()}</p>
        </div>

        <!-- ───────── 1. Input Parameters ───────── -->
        <h2>1. Input Parameters</h2>
        <table class="meta-table">
            <tr>
                <td style="font-weight:bold; width:25%">Total Height (H)</td>
                <td style="width:25%">${config.H} mm</td>
                <td style="font-weight:bold; width:25%">Retained Soil (${kxInline('H_{soil}')})</td>
                <td style="width:25%">${config.H_soil ?? config.H} mm</td>
            </tr>
            <tr>
                <td style="font-weight:bold">Base Width (B)</td>
                <td>${config.B} mm</td>
                <td style="font-weight:bold">Toe Projection (${kxInline('B_{toe}')})</td>
                <td>${config.B_toe} mm</td>
            </tr>
            <tr>
                <td style="font-weight:bold">Stem Base Thickness</td>
                <td>${config.D_stem_base} mm</td>
                <td style="font-weight:bold">Stem Top Thickness</td>
                <td>${config.D_stem_top} mm</td>
            </tr>
            <tr>
                <td style="font-weight:bold">Base Slab Thickness</td>
                <td>${config.D_base} mm</td>
                <td style="font-weight:bold">SBC</td>
                <td>${config.sbc} kN/m²</td>
            </tr>
            <tr>
                <td style="font-weight:bold">Friction Angle (${kxInline('\\phi')})</td>
                <td>${config.phi}°</td>
                <td style="font-weight:bold">Soil Unit Wt. (${kxInline('\\gamma_{soil}')})</td>
                <td>${config.gamma_soil} kN/m³</td>
            </tr>
            <tr>
                <td style="font-weight:bold">Concrete Unit Wt.</td>
                <td>${config.gamma_concrete} kN/m³</td>
                <td style="font-weight:bold">Surcharge (q)</td>
                <td>${config.q_surcharge} kN/m²</td>
            </tr>
            <tr>
                <td style="font-weight:bold">Concrete Grade</td>
                <td>${config.grade}</td>
                <td style="font-weight:bold">Steel Grade</td>
                <td>${config.steelGrade}</td>
            </tr>
            <tr>
                <td style="font-weight:bold">Clear Cover</td>
                <td>${config.cover} mm</td>
                <td style="font-weight:bold">Base Friction (${kxInline('\\mu')})</td>
                <td>${config.mu}</td>
            </tr>
        </table>

        <!-- ───────── 2. Diagram ───────── -->
        ${canvasImgTag ? `
        <h2>2. Structural & Pressure Diagrams</h2>
        <div style="text-align:center; margin: 10px 0;">
            ${canvasImgTag}
        </div>
        ` : ''}

        <!-- ───────── 3. Earth Pressure Computation ───────── -->
        <h2>3. Earth Pressure Computation</h2>
        <div class="calc-block">
            ${kx('K_a = \\frac{1 - \\sin\\phi}{1 + \\sin\\phi} = \\frac{1 - \\sin ' + config.phi + '°}{1 + \\sin ' + config.phi + '°} = ' + fmt(r.Ka, 4))}
            ${kx('P_a = \\frac{1}{2} K_a \\gamma H_{soil}^2 = \\frac{1}{2} \\times ' + fmt(r.Ka, 3) + ' \\times ' + config.gamma_soil + ' \\times ' + fmt(r.H_soil / 1000, 2) + '^2 = ' + fmt(r.Pa, 2) + ' \\text{ kN/m}' )}
            ${config.q_surcharge > 0 ? kx('P_q = K_a \\cdot q \\cdot H_{soil} = ' + fmt(r.Ka, 3) + ' \\times ' + config.q_surcharge + ' \\times ' + fmt(r.H_soil / 1000, 2) + ' = ' + fmt(r.Pq, 2) + ' \\text{ kN/m}') : ''}
            ${r.Pa_water > 0 ? kx('P_w = \\frac{1}{2} \\gamma_w h_{wet}^2 = ' + fmt(r.Pa_water, 2) + ' \\text{ kN/m}') : ''}
        </div>

        <!-- ───────── 4. Stability Checks ───────── -->
        <h2>4. Stability Checks</h2>
        <table class="result-table">
            <tr>
                <th>Check</th><th>Achieved</th><th>Required</th><th>Status</th>
            </tr>
            <tr>
                <td style="font-weight:bold; text-align:left; padding-left:10px;">Overturning (about toe)</td>
                <td>${fmt(r.fos_overturning, 2)}</td>
                <td>≥ 1.4</td>
                <td class="${r.overturning_ok ? 'status-safe' : 'status-fail'}">${r.overturning_ok ? '✅ SAFE' : '❌ FAIL'}</td>
            </tr>
            <tr>
                <td style="font-weight:bold; text-align:left; padding-left:10px;">Sliding</td>
                <td>${fmt(r.fos_sliding, 2)}</td>
                <td>≥ 1.4</td>
                <td class="${r.sliding_ok ? 'status-safe' : 'status-fail'}">${r.sliding_ok ? '✅ SAFE' : '❌ FAIL'}</td>
            </tr>
            <tr>
                <td style="font-weight:bold; text-align:left; padding-left:10px;">Bearing (${kxInline('p_{max}')})</td>
                <td>${fmt(r.p_max, 0)} kN/m²</td>
                <td>≤ ${r.sbc} kN/m²</td>
                <td class="${r.bearing_ok ? 'status-safe' : 'status-fail'}">${r.bearing_ok ? '✅ SAFE' : '❌ FAIL'}</td>
            </tr>
        </table>

        <div class="calc-block">
            <strong>Overturning Check</strong>
            ${kx('M_{resist} = ' + fmt(r.M_resisting, 2) + ' \\text{ kN·m/m}, \\quad M_{over} = ' + fmt(r.M_overturning, 2) + ' \\text{ kN·m/m}')}
            ${kx('FoS_{OT} = \\frac{M_R}{M_O} = \\frac{' + fmt(r.M_resisting, 2) + '}{' + fmt(r.M_overturning, 2) + '} = ' + fmt(r.fos_overturning, 2))}
            <strong>Sliding Check</strong>
            ${kx('FoS_{SL} = \\frac{\\mu \\Sigma V}{\\Sigma H} = \\frac{' + fmt(r.mu, 2) + ' \\times ' + fmt(r.SigmaV, 2) + '}{' + fmt(r.Pa + r.Pq + r.Pa_water, 2) + '} = ' + fmt(r.fos_sliding, 2))}
            <strong>Bearing Pressure</strong>
            ${kx('p_{toe} = ' + fmt(r.p_toe, 1) + ' \\text{ kN/m²}, \\quad p_{heel} = ' + fmt(r.p_heel, 1) + ' \\text{ kN/m²}')}
        </div>

        <!-- ───────── 5. RC Design — Stem ───────── -->
        <h2>5. RC Design — Stem (Cantilever at base)</h2>
        <div class="two-col">
            <div class="col col-left">
                <h4>Flexure</h4>
                <div class="calc-row"><span class="label">Effective depth d</span><span class="value">${fmt(r.stem_d, 0)} mm</span></div>
                <div class="calc-row"><span class="label">${kxInline('M_u')}</span><span class="value">${fmt(r.stem_Mu, 2)} kN·m</span></div>
                <div class="calc-row"><span class="label">${kxInline('A_{st,req}')}</span><span class="value">${fmt(r.stem_Ast, 0)} mm²/m</span></div>
                <div class="calc-row"><span class="label">${kxInline('p_t')}</span><span class="value">${fmt(r.stem_pt ?? 0, 3)} %</span></div>
            </div>
            <div class="col">
                <h4>Shear</h4>
                <div class="calc-row"><span class="label">${kxInline('\\tau_v')}</span><span class="value">${fmt(r.stem_tau_v, 3)} MPa</span></div>
                <div class="calc-row"><span class="label">${kxInline('\\tau_c')}</span><span class="value">${fmt(r.stem_tau_c, 3)} MPa</span></div>
                <div class="calc-row"><span class="label">Status</span><span class="value ${r.stem_shear_ok ? 'status-safe' : 'status-fail'}">${r.stem_shear_ok ? 'SAFE' : 'FAIL'}</span></div>
            </div>
        </div>

        <!-- ───────── 6. RC Design — Heel ───────── -->
        <h2>6. RC Design — Heel Slab</h2>
        <div class="two-col">
            <div class="col col-left">
                <h4>Flexure</h4>
                <div class="calc-row"><span class="label">Effective depth d</span><span class="value">${fmt(r.heel_d, 0)} mm</span></div>
                <div class="calc-row"><span class="label">${kxInline('M_u')}</span><span class="value">${fmt(r.heel_Mu, 2)} kN·m</span></div>
                <div class="calc-row"><span class="label">${kxInline('A_{st,req}')}</span><span class="value">${fmt(r.heel_Ast, 0)} mm²/m</span></div>
            </div>
            <div class="col">
                <h4>Shear</h4>
                <div class="calc-row"><span class="label">${kxInline('\\tau_v')}</span><span class="value">${fmt(r.heel_tau_v, 3)} MPa</span></div>
                <div class="calc-row"><span class="label">${kxInline('\\tau_c')}</span><span class="value">${fmt(r.heel_tau_c, 3)} MPa</span></div>
                <div class="calc-row"><span class="label">Status</span><span class="value ${r.heel_shear_ok ? 'status-safe' : 'status-fail'}">${r.heel_shear_ok ? 'SAFE' : 'FAIL'}</span></div>
            </div>
        </div>

        <!-- ───────── 7. RC Design — Toe ───────── -->
        <h2>7. RC Design — Toe Slab</h2>
        <div class="two-col">
            <div class="col col-left">
                <h4>Flexure</h4>
                <div class="calc-row"><span class="label">Effective depth d</span><span class="value">${fmt(r.toe_d, 0)} mm</span></div>
                <div class="calc-row"><span class="label">${kxInline('M_u')}</span><span class="value">${fmt(r.toe_Mu, 2)} kN·m</span></div>
                <div class="calc-row"><span class="label">${kxInline('A_{st,req}')}</span><span class="value">${fmt(r.toe_Ast, 0)} mm²/m</span></div>
            </div>
            <div class="col">
                <h4>Shear</h4>
                <div class="calc-row"><span class="label">${kxInline('\\tau_v')}</span><span class="value">${fmt(r.toe_tau_v, 3)} MPa</span></div>
                <div class="calc-row"><span class="label">${kxInline('\\tau_c')}</span><span class="value">${fmt(r.toe_tau_c, 3)} MPa</span></div>
                <div class="calc-row"><span class="label">Status</span><span class="value ${r.toe_shear_ok ? 'status-safe' : 'status-fail'}">${r.toe_shear_ok ? 'SAFE' : 'FAIL'}</span></div>
            </div>
        </div>

        <!-- ───────── 8. Overall Conclusion ───────── -->
        <h2>8. Design Conclusion</h2>
        <div style="padding: 12px; border-radius: 6px; background: ${safe ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${safe ? '#86efac' : '#fca5a5'}; margin-top: 8px;">
            <strong style="font-size: 16px; color: ${safe ? '#16a34a' : '#dc2626'};">
                ${safe ? '✅ DESIGN IS SAFE — All checks pass per IS 456:2000' : '❌ DESIGN NEEDS REVISION'}
            </strong>
            ${!safe ? '<ul style="margin-top:8px; color:#dc2626;">' + r.messages.map(m => `<li>${m}</li>`).join('') + '</ul>' : ''}
        </div>
    </div>
    `;

    const htmlDocString = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Cantilever Retaining Wall Design Report</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css" />
            ${REPORT_CSS}
        </head>
        <body>
            <div class="report-container">
                ${html}
            </div>
            ${FIT_FORMULAS_SCRIPT}
        </body>
        </html>
    `;

    const blob = new Blob([htmlDocString], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    if (previewMode) {
        const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlDocString);
        return Promise.resolve(dataUrl);
    }

    // ── Download / Save-as-PDF path (browser print dialog) ──
    return new Promise<void>((resolve) => {
        let settled = false;
        const cleanup = (frame: any): void => {
            if (settled) return;
            settled = true;
            try { if (frame && frame.parentNode) document.body.removeChild(frame); } catch { /* noop */ }
            try { URL.revokeObjectURL(blobUrl); } catch { /* noop */ }
            resolve();
        };

        try {
            const printFrame = document.createElement('iframe');
            printFrame.style.position = 'fixed';
            printFrame.style.right = '0';
            printFrame.style.bottom = '0';
            printFrame.style.width = '210mm';
            printFrame.style.height = '297mm';
            printFrame.style.border = '0';
            printFrame.style.opacity = '0';
            printFrame.style.pointerEvents = 'none';
            printFrame.style.zIndex = '-1';
            printFrame.setAttribute('aria-hidden', 'true');
            printFrame.srcdoc = htmlDocString;

            printFrame.onload = () => {
                setTimeout(() => {
                    try {
                        const win = printFrame.contentWindow!;
                        win.focus();
                        if ('onafterprint' in win) {
                            win.onafterprint = () => cleanup(printFrame);
                        }
                        win.print();
                        setTimeout(() => cleanup(printFrame), 60000);
                    } catch (err) {
                        logger.error('Print failed, opening report in a new tab instead:', err);
                        window.open(blobUrl, '_blank');
                        cleanup(printFrame);
                    }
                }, 400);
            };

            document.body.appendChild(printFrame);
        } catch (err) {
            logger.error('Could not create print frame, opening report in a new tab instead:', err);
            try { window.open(blobUrl, '_blank'); } catch { /* noop */ }
            resolve();
        }
    });
}
