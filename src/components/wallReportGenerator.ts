import katex from 'katex';
import { logger } from '../lib/logger';
import { REPORT_CSS, FIT_FORMULAS_SCRIPT } from './reportCss';
import { computeRequiredDepthForBM } from '../lib/is456';

export async function generateWallReport(config: any, result: any, canvas: HTMLCanvasElement | null, previewMode: boolean = false): Promise<string | null | void> {
    const kx = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: true, fleqn: true });
    const kxInline = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: false });

    // Defensive guard: bail out gracefully if the analysis result is missing the
    // expected shape instead of throwing inside an async click handler (which
    // silently does nothing and makes the buttons "not work").
    if (!result || !Array.isArray(result.zoneDesigns)) {
        logger.error('generateWallReport: invalid result object', result);
        if (typeof window !== 'undefined') {
            window.alert('Cannot generate report: run the analysis first.');
        }
        return previewMode ? null : undefined;
    }

    const soilParams = config.soilParams || {};
    const material = config.material || {};

    const waterModeLabels = { submerged: 'Fully Submerged', partial: 'Partial Water Table', dry: 'Dry Backfill' };
    const waterModeStr = waterModeLabels[soilParams.waterMode as keyof typeof waterModeLabels] || 'Fully Submerged';

    // The engine returns zone results under `zoneDesigns`, with cumulative depths in
    // `cumDepths` ([0, h1, h1+h2, ...]). Build a normalized `ReportZone` array
    // carrying the top/bottom depth and an effective depth so the report template
    // can render cleanly.
    //
    // ARCH-04: this transformation used to be inline and implicit. Promoting it
    // to a named `toReportZone` function makes the engine→report shape contract
    // explicit and discoverable. If the engine ever renames `d_hogging` /
    // `d_sagging` / `Mu_applied`, this function is the single place to update.
    const cumDepths = Array.isArray(result.cumDepths) ? result.cumDepths : null;
    const toReportZone = (zd: any, i: number) => {
        const topDepth = cumDepths ? cumDepths[i] : 0;
        const bottomDepth = cumDepths ? cumDepths[i + 1] : (topDepth + (zd.height || 0));
        return {
            ...zd,
            topDepth,
            bottomDepth,
            // Normalize d_eff onto the flexure objects expected by the template.
            flex_hogging: { ...zd.flex_hogging, d_eff: zd.d_hogging, Mu: zd.flex_hogging.Mu_applied },
            flex_sagging: { ...zd.flex_sagging, d_eff: zd.d_sagging, Mu: zd.flex_sagging.Mu_applied },
        };
    };
    const reportZones = result.zoneDesigns.map(toReportZone);

    let html = `
    <div id="pdf-report">
        <div class="report-header">
            <h1>Basement Wall Design Report</h1>
            <p>Design Code: IS 456:2000 | Generated: ${new Date().toLocaleString()}</p>
        </div>

        <h2>1. Input Parameters</h2>
        <table class="meta-table">
            <tr>
                <td style="padding: 6px; border: 1px solid #e2e8f0; font-weight: bold; width: 25%;">Concrete Grade</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0; width: 25%;">${material.grade}</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0; font-weight: bold; width: 25%;">Soil Friction Angle (${kxInline('\\phi')})</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0; width: 25%;">${soilParams.phi}°</td>
            </tr>
            <tr>
                <td style="padding: 6px; border: 1px solid #e2e8f0; font-weight: bold;">Steel Grade</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0;">${material.steelGrade}</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0; font-weight: bold;">${kxInline('K_0')} (At Rest)</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0;">${(result.K0 ?? 0).toFixed(4)}</td>
            </tr>
            <tr>
                <td style="padding: 6px; border: 1px solid #e2e8f0; font-weight: bold;">Clear Cover</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0;">${material.cover} mm</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0; font-weight: bold;">Soil Unit Weight (${kxInline('\\gamma_{soil}')})</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0;">${soilParams.gamma_soil} kN/m³</td>
            </tr>
            <tr>
                <td style="padding: 6px; border: 1px solid #e2e8f0; font-weight: bold;">End Conditions</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0;">Base Fixed, Slabs Pinned</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0; font-weight: bold;">Water Condition</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0;">${waterModeStr}</td>
            </tr>
            <tr>
                <td style="padding: 6px; border: 1px solid #e2e8f0; font-weight: bold;">Load Factor</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0;">${config.loadFactor}</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0; font-weight: bold;">Water Table Depth</td>
                <td style="padding: 6px; border: 1px solid #e2e8f0;">${soilParams.waterMode === 'partial' ? soilParams.waterTableDepth + ' m' : 'N/A'}</td>
            </tr>
        </table>
        
        <h2>2. Global Stability &amp; Pressures</h2>
        <table style="width: 100%; font-size: 13px; margin-bottom: 20px;">
            <tr><td style="padding: 4px 0;"><strong>Total Wall Height:</strong> ${(result.totalHeight ?? 0).toFixed(2)} m</td>
            <td style="padding: 4px 0;"><strong>Total Lateral Force:</strong> ${(result.totalLateralForce ?? 0).toFixed(2)} kN/m</td></tr>
            <tr><td style="padding: 4px 0;"><strong>Center of Pressure:</strong> ${(result.centerOfPressure ?? 0).toFixed(2)} m (from base)</td>
            <td style="padding: 4px 0;"><strong>Surcharge:</strong> ${soilParams.surcharge} kN/m²</td></tr>
        </table>

        ${canvas ? `
        <h2>3. Wall Schematic &amp; Diagrams</h2>
        <div style="text-align: center; margin: 15px 0;">
            <img src="${canvas.toDataURL('image/png')}" style="max-width: 90%; max-height: 350px; border: 1px solid #e2e8f0; padding: 10px; background: #fff;" />
        </div>
        ` : ''}

        <div style="page-break-before: always;"></div>
        <h2>4. Zone-by-Zone IS 456 Design</h2>
    `;
    
    reportZones.forEach((z: any, i: number) => {
        const Vu_num = z.shear.Vu_applied || 0;
        const Vu_str = Vu_num.toFixed(1);
        const b = 1000;
        const d_hog = z.flex_hogging.d_eff.toFixed(1);
        const d_sag = z.flex_sagging.d_eff.toFixed(1);
        const d_shear = Math.min(z.flex_hogging.d_eff, z.flex_sagging.d_eff).toFixed(1);
        
        html += `
        <div class="section-box">
            <h3 class="section-header">
                Zone ${i + 1} (${z.topDepth.toFixed(2)} m to ${z.bottomDepth.toFixed(2)} m) &mdash; Thickness: ${z.thickness} mm
            </h3>

            <div class="section-body">
                <div class="two-col">
                    <div class="col col-left">
                        <h4 style="margin-top: 0;">A. Flexure (Earth Face / Hogging)</h4>
                        ${kx(`d_{eff} = ${d_hog} \\text{ mm}`)}
                        ${kx(`M_u = ${z.flex_hogging.Mu.toFixed(2)}\\text{ kNm}, \\; M_{u,lim} = ${z.flex_hogging.Mu_lim.toFixed(2)}\\text{ kNm}`)}
                        ${(() => {
                            const bmDepth = computeRequiredDepthForBM(z.flex_hogging.Mu, material.fck, material.fy, b);
                            return kx(`d_{req} = \\sqrt{\\frac{M_u \\times 10^6}{R_u b}} = \\sqrt{\\frac{${(z.flex_hogging.Mu * 1e6).toFixed(0)}}{${bmDepth.R.toFixed(2)} \\times ${b}}} = ${bmDepth.d_req.toFixed(1)} \\text{ mm}`);
                        })()}
                        ${kx(`A_{st} = \\frac{0.5 f_{ck}}{f_y} \\left[ 1 - \\sqrt{1 - \\frac{4.6 M_u}{f_{ck} b d^2}} \\right] bd`)}
                        ${kx(`A_{st} = \\frac{0.5(${material.fck})}{${material.fy}} \\left[ 1 - \\sqrt{1 - \\frac{4.6(${z.flex_hogging.Mu.toFixed(2)} \\times 10^6)}{${material.fck}(${b})(${d_hog})^2}} \\right] (${b})(${d_hog})`)}
                        ${kx(`A_{st,req} = ${z.flex_hogging.Ast_req} \\text{ mm}^2\\text{/m} \\quad (${z.flex_hogging.governs === 'minimum' ? '\\text{Min. governs}' : '\\text{Formula}'})`)}
                        <div class="provided-box">
                            <strong>Provided:</strong> ${z.mainBars_hogging.label} <br/>
                            <span style="color: #64748b; font-size: 12px;">(${kxInline(`A_{st} = ${z.mainBars_hogging.Ast_provided} \\text{ mm}^2\\text{/m}`)})</span>
                        </div>
                    </div>
                    <div class="col">
                        <h4 style="margin-top: 0;">B. Flexure (Inner Face / Sagging)</h4>
                        ${kx(`d_{eff} = ${d_sag} \\text{ mm}`)}
                        ${kx(`M_u = ${z.flex_sagging.Mu.toFixed(2)}\\text{ kNm}, \\; M_{u,lim} = ${z.flex_sagging.Mu_lim.toFixed(2)}\\text{ kNm}`)}
                        ${(() => {
                            const bmDepth = computeRequiredDepthForBM(z.flex_sagging.Mu, material.fck, material.fy, b);
                            return kx(`d_{req} = \\sqrt{\\frac{M_u \\times 10^6}{R_u b}} = \\sqrt{\\frac{${(z.flex_sagging.Mu * 1e6).toFixed(0)}}{${bmDepth.R.toFixed(2)} \\times ${b}}} = ${bmDepth.d_req.toFixed(1)} \\text{ mm}`);
                        })()}
                        ${kx(`A_{st} = \\frac{0.5 f_{ck}}{f_y} \\left[ 1 - \\sqrt{1 - \\frac{4.6 M_u}{f_{ck} b d^2}} \\right] bd`)}
                        ${kx(`A_{st} = \\frac{0.5(${material.fck})}{${material.fy}} \\left[ 1 - \\sqrt{1 - \\frac{4.6(${z.flex_sagging.Mu.toFixed(2)} \\times 10^6)}{${material.fck}(${b})(${d_sag})^2}} \\right] (${b})(${d_sag})`)}
                        ${kx(`A_{st,req} = ${z.flex_sagging.Ast_req} \\text{ mm}^2\\text{/m} \\quad (${z.flex_sagging.governs === 'minimum' ? '\\text{Min. governs}' : '\\text{Formula}'})`)}
                        <div class="provided-box">
                            <strong>Provided:</strong> ${z.mainBars_sagging.label || z.mainBars_sagging.dia+'mm@'+z.mainBars_sagging.spacing} <br/>
                            <span style="color: #64748b; font-size: 12px;">(${kxInline(`A_{st} = ${z.mainBars_sagging.Ast_provided} \\text{ mm}^2\\text{/m}`)})</span>
                        </div>
                    </div>
                </div>

                <div style="border-top: 1px solid #e2e8f0; padding-top: 15px; margin-top: 15px;">
                    <h4 style="margin-top: 0;">C. Shear Check</h4>
                    <div class="two-col">
                        <div class="col">
                            ${kx(`V_u = ${Vu_str} \\text{ kN}`)}
                            ${kx(`\\tau_v = \\frac{V_u}{bd} = \\frac{${Vu_str} \\times 10^3}{${b} \\times ${d_shear}} = ${z.shear.tau_v} \\text{ N/mm}^2`)}
                            ${kx(`\\tau_c = ${z.shear.tau_c} \\text{ N/mm}^2 \\quad (p_t = ${z.shear.pt}\\%)`)}
                        </div>
                        <div class="col">
                            ${kx(`\\tau_{c,max} = ${z.shear.tau_c_max} \\text{ N/mm}^2`)}
                            <p style="margin: 10px 0; font-weight: bold; color: ${z.shear.status === 'FAIL' ? '#ef4444' : '#10b981'};">
                                Result: ${kxInline(`\\tau_v ${z.shear.tau_v <= z.shear.tau_c ? '\\le' : '>'} \\tau_c`)} &rarr; ${z.shear.status.toUpperCase()}
                            </p>
                            ${z.shear.status === 'design' && z.shear.links ? `
                                ${kx(`V_{us} = V_u - \\tau_c\\,bd = ${(Vu_num - z.shear.tau_c*b*Number(d_shear)/1000).toFixed(1)} \\text{ kN}`)}
                                <div style="margin-top: 8px; padding: 6px; background: #f0fdf4; border-left: 3px solid #10b981;">
                                    <strong>Shear Links Provided:</strong> ${z.shear.links.label}
                                </div>
                            ` : ''}
                            ${z.shear.status === 'minimum' && z.shear.links ? `
                                <div style="margin-top: 8px; padding: 6px; background: #f8fafc; border-left: 3px solid #64748b;">
                                    <strong>Min. Links Provided:</strong> ${z.shear.links.label}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
    });
    
    // KaTeX CSS is loaded from CDN in the generated PDF HTML. The previous
    // approach of inlining via `?raw` import broke font loading because the
    // CSS contains relative @font-face URLs (url(fonts/KaTeX_Main-Regular.woff2))
    // that don't resolve inside an about:srcdoc iframe. The CDN link ensures
    // both the CSS and the fonts load correctly in the standalone PDF document.
    const htmlDocString = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Basement Wall Design Report</title>
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
        // Return HTML as a data URI to bypass any Blob CSP or iframe src restrictions
        const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlDocString);
        return Promise.resolve(dataUrl);
    }

    // ── Download / Save-as-PDF path ──────────────────────────────────────────────
    // Render the report inside a hidden (but real-sized) iframe and trigger the
    // browser's native print dialog, where the user chooses "Save as PDF". This
    // yields crisp vector text and equations. We wait for the iframe's `load`
    // event (so KaTeX CSS is applied) and fall back to opening the report in a
    // new tab if printing is blocked.
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
            // Give the frame real dimensions off-screen — some browsers refuse to
            // print/layout a 1px frame.
            printFrame.style.position = 'fixed';
            printFrame.style.right = '0';
            printFrame.style.bottom = '0';
            printFrame.style.width = '210mm';   // A4 width
            printFrame.style.height = '297mm';  // A4 height
            printFrame.style.border = '0';
            printFrame.style.opacity = '0';
            printFrame.style.pointerEvents = 'none';
            printFrame.style.zIndex = '-1';
            printFrame.setAttribute('aria-hidden', 'true');
            // Use srcdoc so the load event reliably fires after the document
            // (including the KaTeX stylesheet) is parsed.
            printFrame.srcdoc = htmlDocString;

            printFrame.onload = () => {
                // Small extra delay to let the remote KaTeX font/CSS settle.
                setTimeout(() => {
                    try {
                        const win = printFrame.contentWindow!;
                        win.focus();
                        // Clean up only after the print dialog is dismissed where
                        // supported; otherwise fall back to a timed cleanup.
                        if ('onafterprint' in win) {
                            win.onafterprint = () => cleanup(printFrame);
                        }
                        win.print();
                        // Safety-net cleanup in case onafterprint never fires.
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
