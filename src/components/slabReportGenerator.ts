import { logger } from '../lib/logger';

// ═══════════════════════════════════════════════════════════════
//  SLAB REPORT GENERATOR — two-column book layout
// ═══════════════════════════════════════════════════════════════

const SLAB_REPORT_CSS = `<style>
    @page { size: A4 portrait; margin: 15mm; }
    body {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        color: #111; font-size: 11px; line-height: 1.4;
        background: white; margin: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .report-container { max-width: 800px; margin: 0 auto; padding: 20px 30px; }
    .report-header { text-align: center; margin-bottom: 20px; }
    .report-header h1 { color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 5px; font-size: 22px; }
    .report-header p { color: #475569; margin: 0; font-size: 10px; }
    h2 { color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 20px; font-size: 14px; }
    h3 { color: #334155; font-size: 12px; margin: 12px 0 6px 0; }
    h4 { color: #475569; font-size: 11px; margin: 8px 0 4px 0; }
    .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 10px; }
    .meta-table td { padding: 5px 8px; border: 1px solid #e2e8f0; }
    .meta-table td strong { color: #475569; }
    .result-table { width: 100%; border-collapse: collapse; margin: 8px 0 15px 0; font-size: 10px; }
    .result-table th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 5px 6px; font-weight: bold; text-align: center; font-size: 9px; }
    .result-table td { border: 1px solid #e2e8f0; padding: 4px 6px; text-align: center; }
    .two-col { display: flex; gap: 12px; }
    .two-col > .col { flex: 1; }
    .two-col > .col-left { border-right: 1px dashed #e2e8f0; padding-right: 12px; }
    .calc-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 10px; }
    .calc-row .label { color: #475569; }
    .calc-row .value { font-weight: 600; color: #111; }
    .calc-block { background: #f8fafc; border-left: 3px solid #0ea5e9; padding: 8px 10px; margin: 6px 0; border-radius: 0 4px 4px 0; font-size: 10px; }
    .provided-box { margin-top: 6px; padding: 5px 8px; background: #f8fafc; border-left: 3px solid #0ea5e9; font-size: 10px; }
    .status-safe { color: #10b981; font-weight: bold; }
    .status-fail { color: #ef4444; font-weight: bold; }
    .section-box { border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; margin-bottom: 15px; page-break-inside: avoid; }
    .section-header { background: #f1f5f9; padding: 6px 12px; margin: 0; color: #0f172a; font-size: 11px; font-weight: bold; border-bottom: 1px solid #e2e8f0; }
    .section-body { padding: 10px 12px; }
    .info-note { background: #eff6ff; border-left: 3px solid #3b82f6; padding: 5px 8px; margin: 6px 0; font-size: 9px; color: #444; }
    @media print {
        .report-container { max-width: 100%; margin: 0; }
        .page-break { page-break-before: always; }
    }
</style>`;

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
            ${SLAB_REPORT_CSS}
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

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════

function calcRow(label: string, value: string | number, unit: string = ''): string {
    return `<div class="calc-row"><span class="label">${label}</span><span class="value">${value}${unit ? ' ' + unit : ''}</span></div>`;
}

function inputTable(rows: [string, string, string, string][]): string {
    return `<table class="meta-table">${rows.map(([k1, v1, k2, v2]) =>
        `<tr><td style="width:25%;"><strong>${k1}</strong></td><td style="width:25%;">${v1}</td><td style="width:25%;"><strong>${k2}</strong></td><td style="width:25%;">${v2}</td></tr>`
    ).join('')}</table>`;
}

function statusChip(status: string): string {
    const cls = (status === 'OK' || status === 'SAFE') ? 'status-safe' : 'status-fail';
    return `<span class="${cls}">${status}</span>`;
}

/** Flexure calc block for one direction */
function flexBlock(label: string, Mu: number, AstReq: number, barsLabel: string, AstProv: number, isDoubly: boolean, governs: string): string {
    return `
        <h4>${label}</h4>
        ${calcRow('Mu', Mu, 'kN.m/m')}
        ${calcRow('Ast,req', AstReq, 'mm2/m')}
        ${calcRow('Governs', governs)}
        <div class="provided-box">
            <strong>Provided:</strong> ${barsLabel}<br/>
            Ast,prov = ${AstProv} mm2/m &nbsp; ${statusChip(isDoubly ? 'REVISE' : 'SAFE')}
        </div>
    `;
}

/** Deflection section in two-column layout */
function deflectionSection(r: any): string {
    return `
    <div class="section-box">
        <div class="section-header">Deflection Check - IS 456 Annex C</div>
        <div class="section-body">
            <div class="two-col">
                <div class="col col-left">
                    <h4>A. Short-Term Deflection</h4>
                    ${calcRow('Igr', (r.deflection.Igr / 1e6).toFixed(2), 'x10^6 mm4')}
                    ${calcRow('Mcr', r.deflection.Mcr, 'kN.m')}
                    ${calcRow('Icr', (r.deflection.Icr / 1e6).toFixed(2), 'x10^6 mm4')}
                    ${calcRow('Ieff', (r.deflection.Ieff / 1e6).toFixed(2), 'x10^6 mm4')}
                    ${calcRow('ai (short-term)', r.deflection.ai, 'mm')}

                    <h4>B. Shrinkage</h4>
                    ${calcRow('k3', r.deflection.k3)}
                    ${calcRow('psi_cs', r.deflection.psi_cs.toExponential(2))}
                    ${calcRow('a_shrinkage', r.deflection.a_shrinkage, 'mm')}
                </div>
                <div class="col">
                    <h4>C. Creep</h4>
                    ${calcRow('theta', r.deflection.theta)}
                    ${calcRow('Ece', Math.round(r.deflection.Ece), 'N/mm2')}
                    ${calcRow('Icr,lt', (r.deflection.Icr_lt / 1e6).toFixed(2), 'x10^6 mm4')}
                    ${calcRow('a_creep', r.deflection.a_creep, 'mm')}

                    <h4>D. Summary</h4>
                    ${calcRow('Total (ai + acc + acs)', r.deflection.a_total, 'mm')}
                    ${calcRow('Limit (L/250)', r.deflection.limit_total, 'mm')}
                    ${calcRow('Status', statusChip(r.deflection.status_total))}
                    <div style="margin-top:4px;"></div>
                    ${calcRow('Post-construction', r.deflection.a_post_construction, 'mm')}
                    ${calcRow('Limit (L/350 or 20)', r.deflection.limit_post, 'mm')}
                    ${calcRow('Status', statusChip(r.deflection.status_post))}
                </div>
            </div>
        </div>
    </div>`;
}

/** Span/depth ratio section */
function spanDepthSection(r: any): string {
    return `
    <div class="section-box">
        <div class="section-header">Span/Depth Ratio - IS 456 Cl. 23.2</div>
        <div class="section-body">
            <div class="two-col">
                <div class="col col-left">
                    ${calcRow('Basic l/d', r.ldCheck.basicRatio)}
                    ${calcRow('fs', r.ldCheck.fs, 'N/mm2')}
                    ${calcRow('Modification Factor', r.ldCheck.mf)}
                </div>
                <div class="col">
                    ${calcRow('Modified l/d', r.ldCheck.modifiedRatio)}
                    ${calcRow('d_req', r.ldCheck.d_req, 'mm')}
                    ${calcRow('d_provided', r.ldCheck.d_provided, 'mm')}
                    ${calcRow('Status', '<span style="color:#666;font-style:italic;">IGNORED</span>')}
                </div>
            </div>
        </div>
    </div>`;
}

/** Shear check table */
function shearSection(r: any, directions: {label: string, dir: any}[]): string {
    const headerRow = '<tr><th>Dir</th><th>Vu (kN)</th><th>tv (N/mm2)</th><th>tc (N/mm2)</th><th>k</th><th>k.tc</th><th>Status</th></tr>';
    const dataRows = directions.map(({label, dir}) => `
        <tr>
            <td>${label}</td><td>${dir.Vu}</td><td>${dir.tau_v}</td>
            <td>${dir.tau_c}</td><td>${dir.k}</td><td>${dir.allowable}</td>
            <td>${statusChip(dir.status)}</td>
        </tr>
    `).join('');

    return `
    <div class="section-box">
        <div class="section-header">Shear Check - IS 456 Cl. 40</div>
        <div class="section-body">
            <table class="result-table">${headerRow}${dataRows}</table>
        </div>
    </div>`;
}


// ═══════════════════════════════════════════════════════════════
//  TWO-WAY SLAB
// ═══════════════════════════════════════════════════════════════

function generateTwoWaySection(r: any): string {
    return `
        <h2>Panel ${r.label} - Two-Way Restrained Slab</h2>

        <div class="section-box">
            <div class="section-header">1. Input Parameters</div>
            <div class="section-body">
                ${inputTable([
                    ['Lx (Short)', r.Lx + ' m', 'Ly (Long)', r.Ly + ' m'],
                    ['Ly/Lx', String(r.lyLx), 'Boundary Case', 'Case ' + r.boundaryCase],
                    ['Thickness D', r.D + ' mm', 'Cover', r.cover + ' mm'],
                    ['Concrete', r.grade + ' (fck=' + r.fck + ')', 'Steel', r.steelGrade + ' (fy=' + r.fy + ')'],
                    ['Dead Load', r.totalDL + ' kN/m2', 'Live Load', r.LL + ' kN/m2'],
                    ['wu (Factored)', r.wFactored + ' kN/m2', 'Load Factor', String(r.loadFactor)],
                ])}
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">2. Moment Coefficients (IS 456 Table 26)</div>
            <div class="section-body">
                <table class="result-table">
                    <tr><th>Direction</th><th>Positive (Mid-span)</th><th>Negative (Support)</th></tr>
                    <tr><td>Short (X)</td><td>${r.ax_pos ?? '-'}</td><td>${r.ax_neg ?? '-'}</td></tr>
                    <tr><td>Long (Y)</td><td>${r.ay_pos ?? '-'}</td><td>${r.ay_neg ?? '-'}</td></tr>
                </table>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">3. Flexural Reinforcement (IS 456 Cl. 38.1)</div>
            <div class="section-body">
                <div style="font-size:10px;margin-bottom:8px;">Effective depths: dx = ${r.dx} mm, dy = ${r.dy} mm</div>
                <div class="two-col">
                    <div class="col col-left">
                        ${flexBlock('X-Bot (Mid-span +ve)', r.Mx_pos, r.flex_x_bot.Ast_req, r.bars_x_bot.label, r.bars_x_bot.Ast_provided, r.flex_x_bot.isDoubly, r.flex_x_bot.governs)}
                        ${r.Mx_neg > 0 ? flexBlock('X-Top (Support -ve)', r.Mx_neg, r.flex_x_top.Ast_req, r.bars_x_top.label, r.bars_x_top.Ast_provided, r.flex_x_top.isDoubly, r.flex_x_top.governs) : ''}
                    </div>
                    <div class="col">
                        ${flexBlock('Y-Bot (Mid-span +ve)', r.My_pos, r.flex_y_bot.Ast_req, r.bars_y_bot.label, r.bars_y_bot.Ast_provided, r.flex_y_bot.isDoubly, r.flex_y_bot.governs)}
                        ${r.My_neg > 0 ? flexBlock('Y-Top (Support -ve)', r.My_neg, r.flex_y_top.Ast_req, r.bars_y_top.label, r.bars_y_top.Ast_provided, r.flex_y_top.isDoubly, r.flex_y_top.governs) : ''}
                    </div>
                </div>
            </div>
        </div>

        ${deflectionSection(r)}
        ${spanDepthSection(r)}
        ${shearSection(r, [
            {label: 'Short (Lx)', dir: r.shear.shortDir},
            {label: 'Long (Ly)', dir: r.shear.longDir},
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
        <h2>Panel ${r.label} - One-Way Slab</h2>

        <div class="section-box">
            <div class="section-header">1. Input Parameters</div>
            <div class="section-body">
                ${inputTable([
                    ['Span Lx', r.Lx + ' m', 'Width Ly', r.Ly + ' m'],
                    ['Support', supportLabel, 'Thickness D', r.D + ' mm'],
                    ['Cover', r.cover + ' mm', 'Concrete', r.grade + ' (fck=' + r.fck + ')'],
                    ['Steel', r.steelGrade + ' (fy=' + r.fy + ')', 'Load Factor', String(r.loadFactor)],
                    ['Dead Load', r.totalDL + ' kN/m2', 'Live Load', r.LL + ' kN/m2'],
                    ['wu (Factored)', r.wFactored + ' kN/m2', 'SDL', r.SDL + ' kN/m2'],
                ])}
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">2. Flexural Reinforcement (IS 456 Cl. 38.1)</div>
            <div class="section-body">
                <div class="info-note">
                    One-way slab: bending in Lx direction only.
                    ${r.supportCondition === 'simply' ? 'M = wL2/8' : ''}
                    ${r.supportCondition === 'one_end' ? 'M+ = wL2/10, M- = wL2/10' : ''}
                    ${r.supportCondition === 'continuous' ? 'M+ = wL2/12, M- = wL2/10' : ''}
                </div>
                <div style="font-size:10px;margin:6px 0;">Effective depth: dx = ${r.dx} mm</div>
                <div class="two-col">
                    <div class="col col-left">
                        ${flexBlock('X-Bot (Mid-span +ve)', r.Mx_pos, r.flex_x_bot.Ast_req, r.bars_x_bot.label, r.bars_x_bot.Ast_provided, r.flex_x_bot.isDoubly, r.flex_x_bot.governs)}
                        ${r.Mx_neg > 0 ? flexBlock('X-Top (Support -ve)', r.Mx_neg, r.flex_x_top.Ast_req, r.bars_x_top.label, r.bars_x_top.Ast_provided, r.flex_x_top.isDoubly, r.flex_x_top.governs) : ''}
                    </div>
                    <div class="col">
                        <h4>Distribution Steel (Y-dir)</h4>
                        <div class="provided-box">
                            <strong>Provided:</strong> ${r.bars_y_bot.label}<br/>
                            Ast,prov = ${r.bars_y_bot.Ast_provided} mm2/m (min. steel)
                        </div>
                    </div>
                </div>
            </div>
        </div>

        ${deflectionSection(r)}
        ${spanDepthSection(r)}
        ${shearSection(r, [
            {label: 'Span (Lx)', dir: r.shear.shortDir},
        ])}
    `;
}

// ═══════════════════════════════════════════════════════════════
//  CANTILEVER SLAB
// ═══════════════════════════════════════════════════════════════

function generateCantileverSection(r: any): string {
    return `
        <h2>Panel ${r.label} - Cantilever Slab</h2>

        <div class="section-box">
            <div class="section-header">1. Input Parameters</div>
            <div class="section-body">
                ${inputTable([
                    ['Span L', r.Lx + ' m', 'Thickness D', r.D + ' mm'],
                    ['Cover', r.cover + ' mm', 'Concrete', r.grade + ' (fck=' + r.fck + ')'],
                    ['Steel', r.steelGrade + ' (fy=' + r.fy + ')', 'Load Factor', String(r.loadFactor)],
                    ['Dead Load', r.totalDL + ' kN/m2', 'Live Load', r.LL + ' kN/m2'],
                    ['wu (Factored)', r.wFactored + ' kN/m2', 'SDL', r.SDL + ' kN/m2'],
                ])}
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">2. Flexural Reinforcement (IS 456 Cl. 38.1)</div>
            <div class="section-body">
                <div class="info-note">
                    Cantilever slab: Fixed at support, free at tip. Governing moment is hogging at support: M = wL2/2.
                </div>
                <div style="font-size:10px;margin:6px 0;">Effective depth: d = ${r.dx} mm</div>
                <div class="two-col">
                    <div class="col col-left">
                        ${flexBlock('Top (Support - Hogging)', r.Mx_neg, r.flex_x_top.Ast_req, r.bars_x_top.label, r.bars_x_top.Ast_provided, r.flex_x_top.isDoubly, r.flex_x_top.governs)}
                    </div>
                    <div class="col">
                        ${flexBlock('Bottom (Distribution)', 0, r.flex_x_bot.Ast_req, r.bars_x_bot.label, r.bars_x_bot.Ast_provided, r.flex_x_bot.isDoubly, r.flex_x_bot.governs)}
                    </div>
                </div>
            </div>
        </div>

        ${deflectionSection(r)}
        ${spanDepthSection(r)}
        ${shearSection(r, [
            {label: 'Support (L)', dir: r.shear.shortDir},
        ])}
    `;
}
