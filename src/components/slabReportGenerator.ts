import katex from "katex";

// ═══════════════════════════════════════════════════════════════
//  KaTeX Helper Functions
// ═══════════════════════════════════════════════════════════════
const kx = (tex: string): string => {
    try { return katex.renderToString(tex, { displayMode: true, throwOnError: false }); }
    catch { return `<div style="color:red">[KaTeX Error: ${tex}]</div>`; }
};

const kxInline = (tex: string): string => {
    try { return katex.renderToString(tex, { displayMode: false, throwOnError: false }); }
    catch { return `<span style="color:red">[KaTeX Error]</span>`; }
};

// ═══════════════════════════════════════════════════════════════
//  REPORT GENERATOR
// ═══════════════════════════════════════════════════════════════
export async function generateSlabReport(config: any, results: any[], isPreview: boolean = false): Promise<string | null> {
    const { material } = config;

    // Generate the HTML for each panel using the type-specific formatter.
    const panelSections = results.map((r: any) => {
        if (r.slabType === 'cantilever') return generateCantileverSection(r, material);
        if (r.slabType === 'one-way') return generateOneWaySection(r, material);
        return generateTwoWaySection(r, material);
    }).join('<div style="page-break-before: always;"></div>');

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Slab Design Report</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css" />
            <style>
                @page { size: A4; margin: 20mm; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    line-height: 1.5;
                    color: #333;
                    background: #fff;
                    font-size: 11pt;
                }
                .report-header { text-align: center; border-bottom: 2px solid #222; margin-bottom: 20px; padding-bottom: 10px; }
                h1 { margin: 0; font-size: 20pt; color: #111; }
                h2 { font-size: 16pt; color: #222; border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-top: 30px; }
                h3 { font-size: 13pt; color: #444; margin-top: 20px; }
                h4 { font-size: 11pt; color: #555; margin-top: 14px; margin-bottom: 6px; }
                .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 10pt; }
                .meta-table td { border: 1px solid #ccc; padding: 6px 10px; }
                .meta-table strong { color: #555; }
                .result-table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; font-size: 10pt; text-align: center; }
                .result-table th { background: #f4f4f4; border: 1px solid #aaa; padding: 8px; font-weight: bold; }
                .result-table td { border: 1px solid #ccc; padding: 6px; }
                .calc-block { background: #fafafa; border-left: 4px solid #b5179e; padding: 10px 15px; margin: 15px 0; border-radius: 0 4px 4px 0; }
                .status-safe { color: #008a00; font-weight: bold; }
                .status-fail { color: #d00000; font-weight: bold; }
                .info-note { background: #e8f4fd; border-left: 4px solid #2196f3; padding: 8px 12px; margin: 10px 0; font-size: 9.5pt; color: #444; }
                @media print {
                    body { font-size: 10pt; }
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="report-header">
                <h1>IS 456 Slab Design Report</h1>
                <p>Generated on ${new Date().toLocaleDateString()}</p>
            </div>
            ${panelSections}
        </body>
        </html>
    `;

    if (isPreview) {
        return htmlContent;
    } else {
        const win = window.open('', '_blank')!;
        win.document.write(htmlContent);
        win.document.close();
        setTimeout(() => {
            win.print();
        }, 500);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
//  COMMON HELPERS
// ═══════════════════════════════════════════════════════════════

/** Generate the deflection section (shared by all slab types). */
function generateDeflectionSection(r: any): string {
    return `
        <h3>Deflection Check — IS 456 Annex C</h3>
        <h4>A. Short-Term Deflection</h4>
        <div class="calc-block">
            ${kx(`I_{gr} = ${(r.deflection.Igr / 1e6).toFixed(2)} \\times 10^6 \\text{ mm}^4`)}
            ${kx(`M_{cr} = 0.7 \\sqrt{f_{ck}} \\frac{I_{gr}}{y_t} = ${r.deflection.Mcr} \\text{ kN\\cdot m}`)}
            ${kx(`I_{cr} = ${(r.deflection.Icr / 1e6).toFixed(2)} \\times 10^6 \\text{ mm}^4`)}
            ${kx(`I_{eff} = ${(r.deflection.Ieff / 1e6).toFixed(2)} \\times 10^6 \\text{ mm}^4`)}
            ${kx(`a_i = \\alpha \\frac{M_s L^2}{E_c I_{eff}} = ${r.deflection.ai} \\text{ mm}`)}
        </div>

        <h4>B. Shrinkage Deflection</h4>
        <div class="calc-block">
            ${kx(`k_3 = ${r.deflection.k3}`)}
            ${kx(`\\psi_{cs} = k_4 \\frac{\\epsilon_{cs}}{D} = ${r.deflection.psi_cs.toExponential(2)}`)}
            ${kx(`a_{cs} = k_3 \\psi_{cs} L^2 = ${r.deflection.a_shrinkage} \\text{ mm}`)}
        </div>

        <h4>C. Creep Deflection</h4>
        <div class="calc-block">
            ${kx(`\\theta = ${r.deflection.theta}`)}
            ${kx(`E_{ce} = \\frac{E_c}{1+\\theta} = ${Math.round(r.deflection.Ece)} \\text{ MPa}`)}
            ${kx(`a_{cc} = a_{1,perm} - a_{i,perm} = ${r.deflection.a_creep} \\text{ mm}`)}
        </div>

        <h4>Deflection Summary</h4>
        <table class="result-table">
            <tr>
                <th>Condition</th>
                <th>Calculated (mm)</th>
                <th>Allowable (mm)</th>
                <th>Status</th>
            </tr>
            <tr>
                <td>Total Deflection ($a_i + a_{cc} + a_{cs}$)</td>
                <td>${r.deflection.a_total}</td>
                <td>${r.deflection.limit_total} ($L/250$)</td>
                <td class="${r.deflection.status_total === 'OK' ? 'status-safe' : 'status-fail'}">${r.deflection.status_total}</td>
            </tr>
            <tr>
                <td>Post-Construction ($a_{cc} + a_{cs}$)</td>
                <td>${r.deflection.a_post_construction}</td>
                <td>${r.deflection.limit_post} ($\\min(L/350, 20)$)</td>
                <td class="${r.deflection.status_post === 'OK' ? 'status-safe' : 'status-fail'}">${r.deflection.status_post}</td>
            </tr>
        </table>
    `;
}

/** Generate the span/depth ratio section (shared by all slab types). */
function generateSpanDepthSection(r: any): string {
    return `
        <h3>Span/Depth Ratio — IS 456 Cl. 23.2</h3>
        <table class="result-table">
            <tr><th>Parameter</th><th>Value</th></tr>
            <tr><td>Basic l/d</td><td>${r.ldCheck.basicRatio}</td></tr>
            <tr><td>$f_s$ (steel stress at service)</td><td>${r.ldCheck.fs} N/mm²</td></tr>
            <tr><td>Modification Factor</td><td>${r.ldCheck.mf}</td></tr>
            <tr><td>Modified l/d</td><td>${r.ldCheck.modifiedRatio}</td></tr>
            <tr><td>$d_{req}$</td><td>${r.ldCheck.d_req} mm</td></tr>
            <tr><td>$d_{provided}$</td><td>${r.ldCheck.d_provided} mm</td></tr>
            <tr>
                <td>Status</td>
                <td class="${r.ldCheck.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.ldCheck.status}</td>
            </tr>
        </table>
        <p style="font-size: 9pt; color: #777; font-style: italic;">${r.ldCheck.note}</p>
    `;
}

// ═══════════════════════════════════════════════════════════════
//  TWO-WAY SLAB REPORT
// ═══════════════════════════════════════════════════════════════

function generateTwoWaySection(r: any, mat: any): string {
    return `
        <h2>Panel ${r.label} — Two-Way Restrained Slab</h2>

        <table class="meta-table">
            <tr>
                <td><strong>L<sub>x</sub> (Short Span)</strong></td><td>${r.Lx} m</td>
                <td><strong>L<sub>y</sub> (Long Span)</strong></td><td>${r.Ly} m</td>
            </tr>
            <tr>
                <td><strong>L<sub>y</sub>/L<sub>x</sub></strong></td><td>${r.lyLx}</td>
                <td><strong>Boundary Case</strong></td><td>Case ${r.boundaryCase}</td>
            </tr>
            <tr>
                <td><strong>Thickness (D)</strong></td><td>${r.D} mm</td>
                <td><strong>Cover</strong></td><td>${r.cover} mm</td>
            </tr>
            <tr>
                <td><strong>Concrete</strong></td><td>${r.grade} (f<sub>ck</sub> = ${r.fck} MPa)</td>
                <td><strong>Steel</strong></td><td>${r.steelGrade} (f<sub>y</sub> = ${r.fy} MPa)</td>
            </tr>
            <tr>
                <td><strong>Dead Load (incl. SW)</strong></td><td>${r.totalDL} kN/m²</td>
                <td><strong>Live Load</strong></td><td>${r.LL} kN/m²</td>
            </tr>
            <tr>
                <td><strong>Total Factored Load (w<sub>u</sub>)</strong></td><td>${r.wFactored} kN/m²</td>
                <td><strong>Load Factor</strong></td><td>${r.loadFactor}</td>
            </tr>
        </table>

        <h3>1. Bending Moment Coefficients (IS 456 Table 26)</h3>
        <p>For $L_y / L_x = ${r.lyLx}$ and Boundary Case ${r.boundaryCase}:</p>
        <table class="result-table">
            <tr>
                <th>Direction</th>
                <th>Positive (Mid-span) $\\alpha^+$</th>
                <th>Negative (Support) $\\alpha^-$</th>
            </tr>
            <tr>
                <td>Short Span (X)</td>
                <td>${r.ax_pos !== null ? r.ax_pos : '—'}</td>
                <td>${r.ax_neg !== null ? r.ax_neg : '—'}</td>
            </tr>
            <tr>
                <td>Long Span (Y)</td>
                <td>${r.ay_pos !== null ? r.ay_pos : '—'}</td>
                <td>${r.ay_neg !== null ? r.ay_neg : '—'}</td>
            </tr>
        </table>

        <h3>2. Design Moments ($M_u$)</h3>
        <p>Using $M_u = \\alpha \\cdot w_u \\cdot L_x^2$:</p>
        <div class="calc-block">
            ${kx(`M_{x,pos} = ${r.ax_pos} \\times ${r.wFactored} \\times ${r.Lx}^2 = ${r.Mx_pos} \\text{ kN\\cdot m/m}`)}
            ${kx(`M_{y,pos} = ${r.ay_pos} \\times ${r.wFactored} \\times ${r.Lx}^2 = ${r.My_pos} \\text{ kN\\cdot m/m}`)}
            ${r.Mx_neg > 0 ? kx(`M_{x,neg} = ${r.ax_neg} \\times ${r.wFactored} \\times ${r.Lx}^2 = ${r.Mx_neg} \\text{ kN\\cdot m/m}`) : ''}
            ${r.My_neg > 0 ? kx(`M_{y,neg} = ${r.ay_neg} \\times ${r.wFactored} \\times ${r.Lx}^2 = ${r.My_neg} \\text{ kN\\cdot m/m}`) : ''}
        </div>

        <h3>3. Flexural Reinforcement (IS 456 Cl. 38.1)</h3>
        <p>Effective depths: $d_x = ${r.dx}$ mm, $d_y = ${r.dy}$ mm</p>
        <table class="result-table">
            <tr>
                <th>Position</th>
                <th>$M_u$ (kN·m)</th>
                <th>$A_{st,req}$ (mm²)</th>
                <th>Provided</th>
                <th>$A_{st,prov}$ (mm²)</th>
                <th>Status</th>
            </tr>
            <tr>
                <td>X-Bot (Mid-span)</td>
                <td>${r.Mx_pos}</td>
                <td>${r.flex_x_bot.Ast_req}</td>
                <td>${r.bars_x_bot.label}</td>
                <td>${r.bars_x_bot.Ast_provided}</td>
                <td class="${r.flex_x_bot.isDoubly ? 'status-fail' : 'status-safe'}">${r.flex_x_bot.isDoubly ? 'Doubly' : 'SAFE'}</td>
            </tr>
            <tr>
                <td>Y-Bot (Mid-span)</td>
                <td>${r.My_pos}</td>
                <td>${r.flex_y_bot.Ast_req}</td>
                <td>${r.bars_y_bot.label}</td>
                <td>${r.bars_y_bot.Ast_provided}</td>
                <td class="${r.flex_y_bot.isDoubly ? 'status-fail' : 'status-safe'}">${r.flex_y_bot.isDoubly ? 'Doubly' : 'SAFE'}</td>
            </tr>
            ${r.Mx_neg > 0 ? `
            <tr>
                <td>X-Top (Support)</td>
                <td>${r.Mx_neg}</td>
                <td>${r.flex_x_top.Ast_req}</td>
                <td>${r.bars_x_top.label}</td>
                <td>${r.bars_x_top.Ast_provided}</td>
                <td class="${r.flex_x_top.isDoubly ? 'status-fail' : 'status-safe'}">${r.flex_x_top.isDoubly ? 'Doubly' : 'SAFE'}</td>
            </tr>
            ` : ''}
            ${r.My_neg > 0 ? `
            <tr>
                <td>Y-Top (Support)</td>
                <td>${r.My_neg}</td>
                <td>${r.flex_y_top.Ast_req}</td>
                <td>${r.bars_y_top.label}</td>
                <td>${r.bars_y_top.Ast_provided}</td>
                <td class="${r.flex_y_top.isDoubly ? 'status-fail' : 'status-safe'}">${r.flex_y_top.isDoubly ? 'Doubly' : 'SAFE'}</td>
            </tr>
            ` : ''}
        </table>

        ${generateDeflectionSection(r)}
        ${generateSpanDepthSection(r)}

        <h3>Shear Check (IS 456 Cl. 40)</h3>
        <table class="result-table">
            <tr>
                <th>Direction</th>
                <th>$V_u$ (kN)</th>
                <th>$\\tau_v$ (N/mm²)</th>
                <th>$\\tau_c$ (N/mm²)</th>
                <th>$k$</th>
                <th>$k \\cdot \\tau_c$</th>
                <th>Status</th>
            </tr>
            <tr>
                <td>Short ($L_x$)</td>
                <td>${r.shear.shortDir.Vu}</td>
                <td>${r.shear.shortDir.tau_v}</td>
                <td>${r.shear.shortDir.tau_c}</td>
                <td>${r.shear.shortDir.k}</td>
                <td>${r.shear.shortDir.allowable}</td>
                <td class="${r.shear.shortDir.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.shear.shortDir.status}</td>
            </tr>
            <tr>
                <td>Long ($L_y$)</td>
                <td>${r.shear.longDir.Vu}</td>
                <td>${r.shear.longDir.tau_v}</td>
                <td>${r.shear.longDir.tau_c}</td>
                <td>${r.shear.longDir.k}</td>
                <td>${r.shear.longDir.allowable}</td>
                <td class="${r.shear.longDir.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.shear.longDir.status}</td>
            </tr>
        </table>
    `;
}

// ═══════════════════════════════════════════════════════════════
//  ONE-WAY SLAB REPORT
// ═══════════════════════════════════════════════════════════════

function generateOneWaySection(r: any, mat: any): string {
    const supportLabels: Record<string, string> = {
        'simply': 'Simply Supported',
        'one_end': 'One-End Continuous',
        'continuous': 'Both Ends Continuous',
    };
    const supportLabel = supportLabels[r.supportCondition] ?? r.supportCondition;

    return `
        <h2>Panel ${r.label} — One-Way Slab</h2>

        <table class="meta-table">
            <tr>
                <td><strong>Span L<sub>x</sub></strong></td><td>${r.Lx} m</td>
                <td><strong>Width L<sub>y</sub></strong></td><td>${r.Ly} m</td>
            </tr>
            <tr>
                <td><strong>Support Condition</strong></td><td>${supportLabel}</td>
                <td><strong>Thickness (D)</strong></td><td>${r.D} mm</td>
            </tr>
            <tr>
                <td><strong>Cover</strong></td><td>${r.cover} mm</td>
                <td><strong>Concrete</strong></td><td>${r.grade} (f<sub>ck</sub> = ${r.fck} MPa)</td>
            </tr>
            <tr>
                <td><strong>Steel</strong></td><td>${r.steelGrade} (f<sub>y</sub> = ${r.fy} MPa)</td>
                <td><strong>Load Factor</strong></td><td>${r.loadFactor}</td>
            </tr>
            <tr>
                <td><strong>Dead Load (incl. SW)</strong></td><td>${r.totalDL} kN/m²</td>
                <td><strong>Live Load</strong></td><td>${r.LL} kN/m²</td>
            </tr>
            <tr>
                <td><strong>Total Factored Load (w<sub>u</sub>)</strong></td><td>${r.wFactored} kN/m²</td>
                <td><strong> SDL</strong></td><td>${r.SDL} kN/m²</td>
            </tr>
        </table>

        <div class="info-note">
            <strong>One-way slab:</strong> Bending is in the L<sub>x</sub> direction only.
            The moment coefficient depends on the support condition:
            ${r.supportCondition === 'simply' ? 'M = wL²/8 (simply supported)' : ''}
            ${r.supportCondition === 'one_end' ? 'M⁺ = wL²/10, M⁻ = wL²/10 (one-end continuous)' : ''}
            ${r.supportCondition === 'continuous' ? 'M⁺ = wL²/12, M⁻ = wL²/10 (both ends continuous)' : ''}
        </div>

        <h3>1. Design Moments ($M_u$)</h3>
        <div class="calc-block">
            ${kx(`M_{x,pos} = ${r.ax_pos} \\times ${r.wFactored} \\times ${r.Lx}^2 = ${r.Mx_pos} \\text{ kN\\cdot m/m}`)}
            ${r.Mx_neg > 0 ? kx(`M_{x,neg} = ${r.ax_neg} \\times ${r.wFactored} \\times ${r.Lx}^2 = ${r.Mx_neg} \\text{ kN\\cdot m/m}`) : ''}
        </div>

        <h3>2. Flexural Reinforcement (IS 456 Cl. 38.1)</h3>
        <p>Effective depth: $d_x = ${r.dx}$ mm</p>
        <table class="result-table">
            <tr>
                <th>Position</th>
                <th>$M_u$ (kN·m)</th>
                <th>$A_{st,req}$ (mm²)</th>
                <th>Provided</th>
                <th>$A_{st,prov}$ (mm²)</th>
                <th>Status</th>
            </tr>
            <tr>
                <td>X-Bot (Mid-span)</td>
                <td>${r.Mx_pos}</td>
                <td>${r.flex_x_bot.Ast_req}</td>
                <td>${r.bars_x_bot.label}</td>
                <td>${r.bars_x_bot.Ast_provided}</td>
                <td class="${r.flex_x_bot.isDoubly ? 'status-fail' : 'status-safe'}">${r.flex_x_bot.isDoubly ? 'Doubly' : 'SAFE'}</td>
            </tr>
            ${r.Mx_neg > 0 ? `
            <tr>
                <td>X-Top (Support)</td>
                <td>${r.Mx_neg}</td>
                <td>${r.flex_x_top.Ast_req}</td>
                <td>${r.bars_x_top.label}</td>
                <td>${r.bars_x_top.Ast_provided}</td>
                <td class="${r.flex_x_top.isDoubly ? 'status-fail' : 'status-safe'}">${r.flex_x_top.isDoubly ? 'Doubly' : 'SAFE'}</td>
            </tr>
            ` : ''}
        </table>

        <div class="info-note">
            <strong>Distribution steel</strong> (Y-direction): ${r.bars_y_bot.label} —
            minimum reinforcement per IS 456 Cl. 26.5.2.1.
        </div>

        ${generateDeflectionSection(r)}
        ${generateSpanDepthSection(r)}

        <h3>Shear Check (IS 456 Cl. 40)</h3>
        <p>Shear is critical in the spanning direction (L<sub>x</sub>).</p>
        <table class="result-table">
            <tr>
                <th>Direction</th>
                <th>$V_u$ (kN)</th>
                <th>$\\tau_v$ (N/mm²)</th>
                <th>$\\tau_c$ (N/mm²)</th>
                <th>$k$</th>
                <th>$k \\cdot \\tau_c$</th>
                <th>Status</th>
            </tr>
            <tr>
                <td>Span ($L_x$)</td>
                <td>${r.shear.shortDir.Vu}</td>
                <td>${r.shear.shortDir.tau_v}</td>
                <td>${r.shear.shortDir.tau_c}</td>
                <td>${r.shear.shortDir.k}</td>
                <td>${r.shear.shortDir.allowable}</td>
                <td class="${r.shear.shortDir.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.shear.shortDir.status}</td>
            </tr>
        </table>
    `;
}

// ═══════════════════════════════════════════════════════════════
//  CANTILEVER SLAB REPORT
// ═══════════════════════════════════════════════════════════════

function generateCantileverSection(r: any, mat: any): string {
    return `
        <h2>Panel ${r.label} — Cantilever Slab</h2>

        <table class="meta-table">
            <tr>
                <td><strong>Span L</strong></td><td>${r.Lx} m</td>
                <td><strong>Thickness (D)</strong></td><td>${r.D} mm</td>
            </tr>
            <tr>
                <td><strong>Cover</strong></td><td>${r.cover} mm</td>
                <td><strong>Concrete</strong></td><td>${r.grade} (f<sub>ck</sub> = ${r.fck} MPa)</td>
            </tr>
            <tr>
                <td><strong>Steel</strong></td><td>${r.steelGrade} (f<sub>y</sub> = ${r.fy} MPa)</td>
                <td><strong>Load Factor</strong></td><td>${r.loadFactor}</td>
            </tr>
            <tr>
                <td><strong>Dead Load (incl. SW)</strong></td><td>${r.totalDL} kN/m²</td>
                <td><strong>Live Load</strong></td><td>${r.LL} kN/m²</td>
            </tr>
            <tr>
                <td><strong>Total Factored Load (w<sub>u</sub>)</strong></td><td>${r.wFactored} kN/m²</td>
                <td><strong>SDL</strong></td><td>${r.SDL} kN/m²</td>
            </tr>
        </table>

        <div class="info-note">
            <strong>Cantilever slab:</strong> Fixed at the support, free at the tip.
            The governing moment is hogging at the support: $M = wL^2 / 2$.
            Top steel is the main reinforcement; bottom steel acts as
            compression steel for deflection control.
        </div>

        <h3>1. Design Moment ($M_u$)</h3>
        <div class="calc-block">
            ${kx(`M_{x,neg} = \\frac{w_u \\cdot L^2}{2} = \\frac{${r.wFactored} \\times ${r.Lx}^2}{2} = ${r.Mx_neg} \\text{ kN\\cdot m/m}`)}
        </div>

        <h3>2. Flexural Reinforcement (IS 456 Cl. 38.1)</h3>
        <p>Effective depth: $d = ${r.dx}$ mm</p>
        <table class="result-table">
            <tr>
                <th>Position</th>
                <th>$M_u$ (kN·m)</th>
                <th>$A_{st,req}$ (mm²)</th>
                <th>Provided</th>
                <th>$A_{st,prov}$ (mm²)</th>
                <th>Status</th>
            </tr>
            <tr>
                <td><strong>Top (Support — Hogging)</strong></td>
                <td>${r.Mx_neg}</td>
                <td>${r.flex_x_top.Ast_req}</td>
                <td>${r.bars_x_top.label}</td>
                <td>${r.bars_x_top.Ast_provided}</td>
                <td class="${r.flex_x_top.isDoubly ? 'status-fail' : 'status-safe'}">${r.flex_x_top.isDoubly ? 'Doubly' : 'SAFE'}</td>
            </tr>
            <tr>
                <td>Bottom (Tip — Distribution)</td>
                <td>—</td>
                <td>${r.flex_x_bot.Ast_req}</td>
                <td>${r.bars_x_bot.label}</td>
                <td>${r.bars_x_bot.Ast_provided}</td>
                <td class="${r.flex_x_bot.isDoubly ? 'status-fail' : 'status-safe'}">${r.flex_x_bot.isDoubly ? 'Doubly' : 'SAFE'}</td>
            </tr>
        </table>

        ${generateDeflectionSection(r)}
        ${generateSpanDepthSection(r)}

        <h3>Shear Check (IS 456 Cl. 40)</h3>
        <p>Shear is critical at the support face.</p>
        <table class="result-table">
            <tr>
                <th>Direction</th>
                <th>$V_u$ (kN)</th>
                <th>$\\tau_v$ (N/mm²)</th>
                <th>$\\tau_c$ (N/mm²)</th>
                <th>$k$</th>
                <th>$k \\cdot \\tau_c$</th>
                <th>Status</th>
            </tr>
            <tr>
                <td>Support ($L$)</td>
                <td>${r.shear.shortDir.Vu}</td>
                <td>${r.shear.shortDir.tau_v}</td>
                <td>${r.shear.shortDir.tau_c}</td>
                <td>${r.shear.shortDir.k}</td>
                <td>${r.shear.shortDir.allowable}</td>
                <td class="${r.shear.shortDir.status === 'OK' ? 'status-safe' : 'status-fail'}">${r.shear.shortDir.status}</td>
            </tr>
        </table>
    `;
}
