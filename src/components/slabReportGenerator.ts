import { logger } from '../lib/logger';
import { REPORT_CSS as SLAB_REPORT_CSS, calcRow, inputTable } from './reportCss';

// ═══════════════════════════════════════════════════════════════
//  SLAB REPORT GENERATOR — two-column book layout with HTML symbols
// ═══════════════════════════════════════════════════════════════

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


// ponytail: calcRow + inputTable imported from ./reportCss


function statusChip(status: string): string {
    const cls = (status === 'OK' || status === 'SAFE') ? 'status-safe' : 'status-fail';
    return `<span class="${cls}">${status}</span>`;
}

/** Flexure calc block for one direction */
function flexBlock(label: string, Mu: number, AstReq: number, barsLabel: string, AstProv: number, isDoubly: boolean, governs: string): string {
    return `
        <h4>${label}</h4>
        ${calcRow('M<sub>u</sub>', Mu, 'kN&middot;m/m')}
        ${calcRow('A<sub>st,req</sub>', AstReq, 'mm&sup2;/m')}
        ${calcRow('Governs', governs)}
        <div class="provided-box">
            <strong>Provided:</strong> ${barsLabel}<br/>
            A<sub>st,prov</sub> = ${AstProv} mm&sup2;/m &nbsp; ${statusChip(isDoubly ? 'REVISE' : 'SAFE')}
        </div>
    `;
}

/** Deflection section in two-column layout */
function deflectionSection(r: any): string {
    return `
    <div class="section-box">
        <div class="section-header">Deflection Check &mdash; IS 456 Annex C</div>
        <div class="section-body">
            <div class="two-col">
                <div class="col col-left">
                    <h4>A. Short-Term Deflection</h4>
                    ${calcRow('I<sub>gr</sub>', (r.deflection.Igr / 1e6).toFixed(2), '&times;10&sup3; mm<sup>4</sup>')}
                    ${calcRow('M<sub>cr</sub>', r.deflection.Mcr, 'kN&middot;m')}
                    ${calcRow('I<sub>cr</sub>', (r.deflection.Icr / 1e6).toFixed(2), '&times;10&sup3; mm<sup>4</sup>')}
                    ${calcRow('I<sub>eff</sub>', (r.deflection.Ieff / 1e6).toFixed(2), '&times;10&sup3; mm<sup>4</sup>')}
                    ${calcRow('a<sub>i</sub> (short-term)', r.deflection.ai, 'mm')}

                    <h4>B. Shrinkage</h4>
                    ${calcRow('k<sub>3</sub>', r.deflection.k3)}
                    ${calcRow('&psi;<sub>cs</sub>', r.deflection.psi_cs.toExponential(2))}
                    ${calcRow('a<sub>shrinkage</sub>', r.deflection.a_shrinkage, 'mm')}
                </div>
                <div class="col">
                    <h4>C. Creep</h4>
                    ${calcRow('&theta;', r.deflection.theta)}
                    ${calcRow('E<sub>ce</sub>', Math.round(r.deflection.Ece), 'N/mm&sup2;')}
                    ${calcRow('I<sub>cr,lt</sub>', (r.deflection.Icr_lt / 1e6).toFixed(2), '&times;10&sup3; mm<sup>4</sup>')}
                    ${calcRow('a<sub>creep</sub>', r.deflection.a_creep, 'mm')}

                    <h4>D. Summary</h4>
                    ${calcRow('Total (a<sub>i</sub> + a<sub>cc</sub> + a<sub>cs</sub>)', r.deflection.a_total, 'mm')}
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
        <div class="section-header">Span/Depth Ratio &mdash; IS 456 Cl. 23.2</div>
        <div class="section-body">
            <div class="two-col">
                <div class="col col-left">
                    ${calcRow('Basic l/d', r.ldCheck.basicRatio)}
                    ${calcRow('f<sub>s</sub>', r.ldCheck.fs, 'N/mm&sup2;')}
                    ${calcRow('Modification Factor', r.ldCheck.mf)}
                </div>
                <div class="col">
                    ${calcRow('Modified l/d', r.ldCheck.modifiedRatio)}
                    ${calcRow('d<sub>req</sub>', r.ldCheck.d_req, 'mm')}
                    ${calcRow('d<sub>provided</sub>', r.ldCheck.d_provided, 'mm')}
                    ${calcRow('Status', '<span style="color:#666;font-style:italic;">IGNORED</span>')}
                </div>
            </div>
        </div>
    </div>`;
}

/** Shear check table */
function shearSection(r: any, directions: {label: string, dir: any}[]): string {
    const headerRow = '<tr><th>Dir</th><th>V<sub>u</sub> (kN)</th><th>&tau;<sub>v</sub> (N/mm&sup2;)</th><th>&tau;<sub>c</sub> (N/mm&sup2;)</th><th>k</th><th>k&middot;&tau;<sub>c</sub></th><th>Status</th></tr>';
    const dataRows = directions.map(({label, dir}) => `
        <tr>
            <td>${label}</td><td>${dir.Vu}</td><td>${dir.tau_v}</td>
            <td>${dir.tau_c}</td><td>${dir.k}</td><td>${dir.allowable}</td>
            <td>${statusChip(dir.status)}</td>
        </tr>
    `).join('');

    return `
    <div class="section-box">
        <div class="section-header">Shear Check &mdash; IS 456 Cl. 40</div>
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
        <h2>Panel ${r.label} &mdash; Two-Way Restrained Slab</h2>

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

        <div class="section-box">
            <div class="section-header">2. Moment Coefficients &mdash; IS 456 Table 26</div>
            <div class="section-body">
                <div style="font-size:10px;margin-bottom:6px;">For L<sub>y</sub>/L<sub>x</sub> = ${r.lyLx}, Boundary Case ${r.boundaryCase}:</div>
                <table class="result-table">
                    <tr><th>Direction</th><th>Positive &alpha;<sup>+</sup> (Mid-span)</th><th>Negative &alpha;<sup>&minus;</sup> (Support)</th></tr>
                    <tr><td>Short Span (X)</td><td>${r.ax_pos ?? '&mdash;'}</td><td>${r.ax_neg ?? '&mdash;'}</td></tr>
                    <tr><td>Long Span (Y)</td><td>${r.ay_pos ?? '&mdash;'}</td><td>${r.ay_neg ?? '&mdash;'}</td></tr>
                </table>
                <div class="calc-block">
                    M<sub>u</sub> = &alpha; &times; w<sub>u</sub> &times; L<sub>x</sub>&sup2;<br/>
                    M<sub>x,pos</sub> = ${r.ax_pos} &times; ${r.wFactored} &times; ${r.Lx}&sup2; = <strong>${r.Mx_pos} kN&middot;m/m</strong><br/>
                    M<sub>y,pos</sub> = ${r.ay_pos} &times; ${r.wFactored} &times; ${r.Lx}&sup2; = <strong>${r.My_pos} kN&middot;m/m</strong>
                    ${r.Mx_neg > 0 ? `<br/>M<sub>x,neg</sub> = ${r.ax_neg} &times; ${r.wFactored} &times; ${r.Lx}&sup2; = <strong>${r.Mx_neg} kN&middot;m/m</strong>` : ''}
                    ${r.My_neg > 0 ? `<br/>M<sub>y,neg</sub> = ${r.ay_neg} &times; ${r.wFactored} &times; ${r.Lx}&sup2; = <strong>${r.My_neg} kN&middot;m/m</strong>` : ''}
                </div>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">3. Flexural Reinforcement &mdash; IS 456 Cl. 38.1</div>
            <div class="section-body">
                <div style="font-size:10px;margin-bottom:8px;">Effective depths: d<sub>x</sub> = ${r.dx} mm, d<sub>y</sub> = ${r.dy} mm</div>
                <div class="two-col">
                    <div class="col col-left">
                        ${flexBlock('X-Bot (Mid-span +ve)', r.Mx_pos, r.flex_x_bot.Ast_req, r.bars_x_bot.label, r.bars_x_bot.Ast_provided, r.flex_x_bot.isDoubly, r.flex_x_bot.governs)}
                        ${r.Mx_neg > 0 ? flexBlock('X-Top (Support &minus;ve)', r.Mx_neg, r.flex_x_top.Ast_req, r.bars_x_top.label, r.bars_x_top.Ast_provided, r.flex_x_top.isDoubly, r.flex_x_top.governs) : ''}
                    </div>
                    <div class="col">
                        ${flexBlock('Y-Bot (Mid-span +ve)', r.My_pos, r.flex_y_bot.Ast_req, r.bars_y_bot.label, r.bars_y_bot.Ast_provided, r.flex_y_bot.isDoubly, r.flex_y_bot.governs)}
                        ${r.My_neg > 0 ? flexBlock('Y-Top (Support &minus;ve)', r.My_neg, r.flex_y_top.Ast_req, r.bars_y_top.label, r.bars_y_top.Ast_provided, r.flex_y_top.isDoubly, r.flex_y_top.governs) : ''}
                    </div>
                </div>
            </div>
        </div>

        ${deflectionSection(r)}
        ${spanDepthSection(r)}
        ${shearSection(r, [
            {label: 'Short (L<sub>x</sub>)', dir: r.shear.shortDir},
            {label: 'Long (L<sub>y</sub>)', dir: r.shear.longDir},
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
        <h2>Panel ${r.label} &mdash; One-Way Slab</h2>

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

        <div class="section-box">
            <div class="section-header">2. Design Moments</div>
            <div class="section-body">
                <div class="info-note">
                    <strong>One-way slab:</strong> Bending in L<sub>x</sub> direction only.
                    ${r.supportCondition === 'simply' ? 'M = wL&sup2;/8 (simply supported)' : ''}
                    ${r.supportCondition === 'one_end' ? 'M<sup>+</sup> = wL&sup2;/10, M<sup>&minus;</sup> = wL&sup2;/10 (one-end continuous)' : ''}
                    ${r.supportCondition === 'continuous' ? 'M<sup>+</sup> = wL&sup2;/12, M<sup>&minus;</sup> = wL&sup2;/10 (both ends continuous)' : ''}
                </div>
                <div class="calc-block">
                    M<sub>x,pos</sub> = ${r.ax_pos} &times; ${r.wFactored} &times; ${r.Lx}&sup2; = <strong>${r.Mx_pos} kN&middot;m/m</strong>
                    ${r.Mx_neg > 0 ? `<br/>M<sub>x,neg</sub> = ${r.ax_neg} &times; ${r.wFactored} &times; ${r.Lx}&sup2; = <strong>${r.Mx_neg} kN&middot;m/m</strong>` : ''}
                </div>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">3. Flexural Reinforcement &mdash; IS 456 Cl. 38.1</div>
            <div class="section-body">
                <div style="font-size:10px;margin:6px 0;">Effective depth: d<sub>x</sub> = ${r.dx} mm</div>
                <div class="two-col">
                    <div class="col col-left">
                        ${flexBlock('X-Bot (Mid-span +ve)', r.Mx_pos, r.flex_x_bot.Ast_req, r.bars_x_bot.label, r.bars_x_bot.Ast_provided, r.flex_x_bot.isDoubly, r.flex_x_bot.governs)}
                        ${r.Mx_neg > 0 ? flexBlock('X-Top (Support &minus;ve)', r.Mx_neg, r.flex_x_top.Ast_req, r.bars_x_top.label, r.bars_x_top.Ast_provided, r.flex_x_top.isDoubly, r.flex_x_top.governs) : ''}
                    </div>
                    <div class="col">
                        <h4>Distribution Steel (Y-dir)</h4>
                        <div class="provided-box">
                            <strong>Provided:</strong> ${r.bars_y_bot.label}<br/>
                            A<sub>st,prov</sub> = ${r.bars_y_bot.Ast_provided} mm&sup2;/m (min. steel per IS 456 Cl. 26.5.2.1)
                        </div>
                    </div>
                </div>
            </div>
        </div>

        ${deflectionSection(r)}
        ${spanDepthSection(r)}
        ${shearSection(r, [
            {label: 'Span (L<sub>x</sub>)', dir: r.shear.shortDir},
        ])}
    `;
}

// ═══════════════════════════════════════════════════════════════
//  CANTILEVER SLAB
// ═══════════════════════════════════════════════════════════════

function generateCantileverSection(r: any): string {
    return `
        <h2>Panel ${r.label} &mdash; Cantilever Slab</h2>

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

        <div class="section-box">
            <div class="section-header">2. Design Moment</div>
            <div class="section-body">
                <div class="info-note">
                    <strong>Cantilever slab:</strong> Fixed at support, free at tip. Governing moment is hogging at support: M = wL&sup2;/2.
                </div>
                <div class="calc-block">
                    M<sub>x,neg</sub> = w<sub>u</sub> &times; L&sup2; / 2 = ${r.wFactored} &times; ${r.Lx}&sup2; / 2 = <strong>${r.Mx_neg} kN&middot;m/m</strong>
                </div>
            </div>
        </div>

        <div class="section-box">
            <div class="section-header">3. Flexural Reinforcement &mdash; IS 456 Cl. 38.1</div>
            <div class="section-body">
                <div style="font-size:10px;margin:6px 0;">Effective depth: d = ${r.dx} mm</div>
                <div class="two-col">
                    <div class="col col-left">
                        ${flexBlock('Top (Support &mdash; Hogging)', r.Mx_neg, r.flex_x_top.Ast_req, r.bars_x_top.label, r.bars_x_top.Ast_provided, r.flex_x_top.isDoubly, r.flex_x_top.governs)}
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
