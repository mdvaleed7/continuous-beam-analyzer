import katex from 'katex';
import { logger } from '../lib/logger';
import { REPORT_CSS, FIT_FORMULAS_SCRIPT, inputTable, calcRow } from './reportCss';
import { FlatSlabInput } from './flatSlabEngine';

// ═══════════════════════════════════════════════════════════════
//  FLAT SLAB REPORT GENERATOR — IS 456:2000 Cl. 31 (DDM)
//  Replaces the previous "coming soon" stub with a full KaTeX-rendered
//  HTML report for IS 456:2000 flat slab design.
// ═══════════════════════════════════════════════════════════════

const kx = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: true, fleqn: true });
const kxInline = (expr: string): string => katex.renderToString(expr, { throwOnError: false, displayMode: false });

function statusChip(ok: boolean, label: string): string {
    const cls = ok ? '#10b981' : '#ef4444';
    return `<span style="color: ${cls}; font-weight: bold;">${label}</span>`;
}

export async function generateFlatSlabPDF(input: FlatSlabInput, results: any, preview: boolean = false): Promise<string | null> {
    const { L1, L2, c1, c2, hasDrop, dropL1, dropL2, dropDepth, D, cover, fck, fy, w_live, w_finish, panelType } = input;
    const r = results;
    const co1 = r.coefficients.dir1;
    const co2 = r.coefficients.dir2;
    const f3 = (v: number) => (Number.isNaN(v) ? 'Fails' : v.toFixed(0));

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Flat Slab Design Report</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css" />
            ${REPORT_CSS}
        </head>
        <body>
            <div class="report-container">
                <div class="report-header">
                    <h1>Flat Slab Design Report</h1>
                    <p>Direct Design Method &mdash; IS 456:2000 Cl. 31 | Generated: ${new Date().toLocaleString()}</p>
                </div>

                <h2>1. Input Parameters</h2>
                ${inputTable([
                    ['Span L<sub>1</sub> (analysis dir.)', `${L1} m`, 'Transverse Span L<sub>2</sub>', `${L2} m`],
                    ['Column c<sub>1</sub> (‖ L<sub>1</sub>)', `${c1} m`, 'Column c<sub>2</sub> (‖ L<sub>2</sub>)', `${c2} m`],
                    ['Slab Depth, D', `${D} mm`, 'Clear Cover', `${cover} mm`],
                    ['Concrete, f<sub>ck</sub>', `${fck} N/mm²`, 'Steel, f<sub>y</sub>', `${fy} N/mm²`],
                    ['Live Load', `${w_live} kN/m²`, 'Floor Finish', `${w_finish} kN/m²`],
                    ['Panel Type', panelType, 'Drop Panel', hasDrop ? `Yes (${dropL1}×${dropL2} m, ${dropDepth} mm)` : 'No'],
                ])}

                <h2>2. Effective Depth &amp; Clear Span</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Section Properties</div>
                    <div class="section-body">
                        ${kx(`d_{L1} = D - \\text{cover} - \\phi/2 = ${r.d_slab.toFixed(0)} \\text{ mm}, \\quad d_{L2} = d_{L1} - \\phi = ${r.d_slab2.toFixed(0)} \\text{ mm}, \\quad d_{punch} = D - \\text{cover} - \\phi = ${r.d_slab_avg.toFixed(0)} \\text{ mm}`)}
                        ${hasDrop ? kx(`d_{drop} = ${dropDepth} - \\text{cover} - \\phi/2 = ${r.d_drop.toFixed(0)} \\text{ mm}, \\quad d_{drop,punch} = ${r.d_drop_avg.toFixed(0)} \\text{ mm}`) : ''}
                        ${kx(`L_n = \\max(L_1 - c_1,\\ 0.65 L_1) = ${r.Ln.toFixed(2)} \\text{ m}, \\quad L_{n2} = ${r.Ln2.toFixed(2)} \\text{ m}`)}
                        <p style="font-size:12px;color:#64748b;margin:4px 0 0 0;">(IS 456 Cl. 31.4.2.2: clear span face-to-face, not less than 0.65·L)</p>
                    </div>
                </div>

                <div class="section-box avoid-break">
                    <div class="section-header">Minimum Slab Thickness &mdash; IS 456 Cl. 31.2.1</div>
                    <div class="section-body">
                        <p style="margin-top:0; color:#475569; font-size:13px;">
                            Cl. 31.2.1: the thickness of a flat slab shall be not less than
                            ${r.thicknessCheck.D_min} mm. This is an absolute lower bound independent of the
                            L/d (deflection) check.
                        </p>
                        ${kx(`D = ${r.thicknessCheck.D} \\text{ mm} \\quad \\text{vs} \\quad D_{min} = ${r.thicknessCheck.D_min} \\text{ mm}`)}
                        <div style="margin-top:6px;">
                            ${r.thicknessCheck.ok
                                ? `${statusChip(true, 'SAFE')} &nbsp; ${kxInline(`D = ${r.thicknessCheck.D} \\geq ${r.thicknessCheck.D_min} \\text{ mm}`)}`
                                : `${statusChip(false, 'REVISE')} &nbsp; ${kxInline(`D = ${r.thicknessCheck.D} < ${r.thicknessCheck.D_min} \\text{ mm}`)} &mdash; ${r.thicknessCheck.message}`}
                        </div>
                    </div>
                </div>

                <h2>3. Loads &amp; Total Static Moment</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Load &amp; M₀ (IS 456 Cl. 31.3.3)</div>
                    <div class="section-body">
                        ${calcRow('Self-weight (slab)', `(${D}/1000 × 25) = ${(D / 1000 * 25).toFixed(2)}`, 'kN/m²')}
                        ${hasDrop ? calcRow('Drop panel (smeared)', r.w_drop.toFixed(2), 'kN/m²') : ''}
                        ${calcRow('Live Load', w_live, 'kN/m²')}
                        ${calcRow('Floor Finish', w_finish, 'kN/m²')}
                        ${calcRow('Total Service Load', `${(r.w_dead + w_live).toFixed(2)}`, 'kN/m²')}
                        ${kx(`w_u = 1.5 \\times w_{total} = ${r.wu.toFixed(2)} \\text{ kN/m}^2`)}
                        ${kx(`W = w_u \\cdot L_2 \\cdot L_n = ${r.wu.toFixed(2)} \\times ${L2} \\times ${r.Ln.toFixed(2)} = ${r.W.toFixed(1)} \\text{ kN}`)}
                        ${kx(`M_0 = \\frac{W \\cdot L_n}{8} = \\frac{${r.W.toFixed(1)} \\times ${r.Ln.toFixed(2)}}{8} = ${r.M0.toFixed(1)} \\text{ kN·m}`)}
                    </div>
                </div>

                <h2>4. Longitudinal Moment Distribution &mdash; IS 456 Cl. 31.4.3</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">${panelType === 'interior' ? 'Interior span (Cl. 31.4.3.2)' : 'End span (Cl. 31.4.3.3)'}</div>
                    <div class="section-body">
                        ${panelType === 'interior'
                            ? kx(`M_{neg} = 0.65 M_0, \\quad M_{pos} = 0.35 M_0`)
                            : `${kx(`\\alpha_c = \\frac{\\Sigma K_c}{K_s} = ${co1.alpha_c_ext}, \\quad f = \\frac{1}{1 + 1/\\alpha_c} = ${co1.f.toFixed(3)}`)}
                               ${kx(`M_{neg,int} = (0.75 - 0.10 f) M_0 = ${co1.negInt.toFixed(3)} M_0, \\quad M_{pos} = (0.63 - 0.28 f) M_0 = ${co1.pos.toFixed(3)} M_0, \\quad M_{neg,ext} = 0.65 f\\, M_0 = ${co1.negExt.toFixed(3)} M_0`)}`}
                        ${panelType === 'corner' ? kx(`\\text{L2 direction (end span): } \\alpha_c = ${co2.alpha_c_ext}, \\ M_{neg,int} = ${co2.negInt.toFixed(3)} M_{0,2}, \\ M_{pos} = ${co2.pos.toFixed(3)} M_{0,2}, \\ M_{neg,ext} = ${co2.negExt.toFixed(3)} M_{0,2}`) : ''}
                        <p style="font-size:12px;color:#64748b;">Column strip: 75% of interior negative (Cl. 31.5.5.1), 100% of exterior negative (Cl. 31.5.5.2), 60% of positive (Cl. 31.5.5.3). Column-strip width 0.25·l₂ each side, not more than 0.25·l₁ (Cl. 31.1.1) = ${r.colStripWidth.toFixed(2)} m.</p>
                    </div>
                </div>

                <h2>5. Flexural Design &mdash; IS 456 Cl. 38.1 (both directions)</h2>
                <p style="font-size:13px;color:#475569;">${kxInline(`A_{st} = \\frac{0.5 f_{ck}}{f_y} \\left[ 1 - \\sqrt{1 - \\frac{4.6 M_u}{f_{ck} b d^2}} \\right] b d`)} per strip width; bars per metre selected to cover the requirement.</p>
                <table class="result-table">
                    <thead><tr><th>Direction / zone</th><th>M<sub>u</sub> (kN·m)</th><th>b (m)</th><th>d (mm)</th><th>A<sub>st,req</sub> (mm²)</th><th>Bars</th></tr></thead>
                    <tbody>
                        ${(['dir1', 'dir2'] as const).map(dir => Object.entries(r.zones[dir]).filter(([, z]: any) => z).map(([k, z]: any) => `
                        <tr><td>${dir === 'dir1' ? 'L1' : 'L2'} ${({ negCol: 'column strip, top (interior support)', posCol: 'column strip, bottom', negMid: 'middle strip, top', posMid: 'middle strip, bottom', negExtCol: 'column strip, top (exterior support)', negExtMid: 'middle strip, top (exterior support)' } as Record<string, string>)[k] ?? k}</td>
                            <td>${z.M.toFixed(1)}</td><td>${z.width.toFixed(2)}</td><td>${z.d.toFixed(0)}</td><td>${f3(z.Ast)}</td>
                            <td>${z.bars.label}${!Number.isNaN(z.Ast) && z.bars.Ast_provided * z.width < z.Ast ? ' ' + statusChip(false, 'INSUFFICIENT') : ''}</td></tr>`).join('')).join('')}
                    </tbody>
                </table>
                ${r.providedSteelCheck.messages.map((m: string) => `<p style="font-size:12px;color:#991b1b;">${m}</p>`).join('')}

                <h2>6. Punching Shear Check &mdash; IS 456 Cl. 31.6</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Critical sections at d/2 (Cl. 31.6.1, Fig. 13) with moment transfer (Cl. 31.6.2.2)</div>
                    <div class="section-body">
                        ${kx(`\\tau_v = \\frac{V_u}{u\\,d} + \\gamma_v \\frac{M\\,c}{J_c}, \\quad \\gamma_v = 1 - \\frac{1}{1 + \\frac{2}{3}\\sqrt{a_1/b_1}}, \\quad \\tau_c = k_s \\cdot 0.25\\sqrt{f_{ck}},\\ k_s = \\min(0.5 + \\beta_c, 1)`)}
                        <p style="font-size:12px;color:#64748b;">Interior columns: unbalanced moment from Cl. 31.4.5.2 (equal adjacent spans), and for an end span the share of the difference in interior negative moments (Cl. 31.4.3.4). Edge / corner columns: the exterior negative moment is transferred; the critical section extends to the slab edge (Fig. 13).</p>
                        <table class="result-table">
                            <thead><tr><th>Section</th><th>a₁×b₁ (mm)</th><th>u (mm)</th><th>d (mm)</th><th>V<sub>u</sub> (kN)</th><th>M (kN·m)</th><th>γ<sub>v</sub></th><th>τ<sub>v</sub></th><th>τ<sub>c</sub></th><th>Status</th></tr></thead>
                            <tbody>
                                ${r.punchingChecks.map((p: any) => `<tr><td>${p.location}</td><td>${p.a1}×${p.b1}</td><td>${p.u}</td><td>${p.d}</td><td>${p.V.toFixed(1)}</td><td>${p.M1.toFixed(1)}${p.M2 > 0 ? ' / ' + p.M2.toFixed(1) : ''}</td><td>${p.gammaV1.toFixed(3)}</td><td>${p.tau_v.toFixed(3)}</td><td>${p.tau_c.toFixed(3)}</td><td>${statusChip(p.ok, p.ok ? 'OK' : 'FAIL')}</td></tr>`).join('')}
                            </tbody>
                        </table>
                        ${r.transferChecks.length ? `<p style="font-size:12px;color:#475569;">Flexural part of the transferred moment (1 − γ<sub>v</sub>)·M within c₂ + 1.5·D each side (Cl. 31.3.3):</p>
                        <table class="result-table"><thead><tr><th>Column</th><th>Band (mm)</th><th>M (kN·m)</th><th>A<sub>st</sub> req (mm²)</th><th>In band (mm²)</th><th>Extra</th></tr></thead><tbody>
                        ${r.transferChecks.map((t: any) => `<tr><td>${t.location}</td><td>${t.bandWidth}</td><td>${t.M_flex.toFixed(1)}</td><td>${t.Ast_req}</td><td>${t.Ast_available}</td><td>${t.ok ? (t.Ast_extra > 0 ? '+' + t.Ast_extra + ' mm²' : 'none') : statusChip(false, 'SECTION FAILS')}</td></tr>`).join('')}
                        </tbody></table>` : ''}
                    </div>
                </div>

                <h2>7. Deflection Check &mdash; IS 456 Annex C</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Short-term + Shrinkage + Creep — crossing strips, α = 0.104(1 − β/10)</div>
                    <div class="section-body">
                        <p style="margin-top:0; color:#475569; font-size:13px;">
                            The full Annex C deflection calculation governs the design. The simplified
                            L/d span/depth check (Cl. 23.2) is computed below for reference but is
                            IGNORED for design purposes.
                        </p>
                        ${kx(`E_c = ${r.deflection.Ec} \\text{ N/mm}^2, \\quad m = ${r.deflection.m}, \\quad M_{cr} = ${r.deflection.Mcr.toFixed(2)} \\text{ kN·m/m}`)}
                        ${kx(`I_{eff} = ${(r.deflection.Ieff/1e6).toFixed(2)}\\times 10^6 \\text{ mm}^4 \\quad (I_{gr} = ${(r.deflection.Igr/1e6).toFixed(2)}, I_{cr} = ${(r.deflection.Icr/1e6).toFixed(2)}\\times 10^6)`)}
                        ${kx(`a_i = ${r.deflection.ai.toFixed(2)} \\text{ mm (short-term)}, \\quad a_{shrinkage} = ${r.deflection.a_shrinkage.toFixed(2)} \\text{ mm}, \\quad a_{creep} = ${r.deflection.a_creep.toFixed(2)} \\text{ mm}`)}
                        ${r.deflection.camber > 0 ? kx(`a_{camber} = ${r.deflection.camber.toFixed(2)} \\text{ mm (upward)}`) : ''}
                        ${kx(`a_{total,net} = ${r.deflection.a_total.toFixed(2)} \\text{ mm} \\quad \\text{vs} \\quad L/250 = ${r.deflection.limit_total.toFixed(2)} \\text{ mm}`)}
                        ${kx(`a_{post} = (a_i - a_{i,perm}) + a_{creep} + a_{shrinkage}${r.deflection.camber > 0 ? ' - a_{camber}' : ''} = ${r.deflection.a_post_construction.toFixed(2)} \\text{ mm} \\quad \\text{vs} \\quad \\min(L/350, 20) = ${r.deflection.limit_post.toFixed(2)} \\text{ mm}`)}
                        ${r.deflectionStrips ? `<p style="font-size:12px;margin:6px 0 0;">Panel-centre deflection by the crossing-strip method (governing: ${r.deflectionStrips.governing}); column strip ${r.deflectionStrips.governing === 'cs(L1)+ms(L2)' ? r.deflectionStrips.cs1.a_total.toFixed(2) : r.deflectionStrips.cs2.a_total.toFixed(2)} mm + middle strip ${r.deflectionStrips.governing === 'cs(L1)+ms(L2)' ? r.deflectionStrips.ms2.a_total.toFixed(2) : r.deflectionStrips.ms1.a_total.toFixed(2)} mm (strip totals before camber).</p>` : ''}
                        <div style="margin-top:6px;">
                            ${r.deflection_safe
                                ? `${statusChip(true, 'SAFE')} &nbsp; Total ${r.deflection.a_total.toFixed(2)} ≤ ${r.deflection.limit_total.toFixed(2)} mm`
                                : `${statusChip(false, 'REVISE')} &nbsp; ${r.deflection.status_total === 'FAIL' ? `Total ${r.deflection.a_total.toFixed(2)} > ${r.deflection.limit_total.toFixed(2)} mm` : `Post-construction ${r.deflection.a_post_construction.toFixed(2)} > ${r.deflection.limit_post.toFixed(2)} mm`}`}
                        </div>
                    </div>
                </div>

                <h2>8. Span/Depth Ratio &mdash; IS 456 Cl. 23.2 (informational)</h2>
                <div class="section-box avoid-break">
                    <div class="section-header">Simplified L/d Check &mdash; IGNORED for design (Annex C governs)</div>
                    <div class="section-body">
                        <p style="margin-top:0; color:#475569; font-size:13px;">
                            Computed for all slabs per user request. The status is IGNORED because the
                            rigorous Annex C deflection check governs the design.
                        </p>
                        ${kx(`\\text{Basic } l/d = ${r.ldCheck.basicRatio} \\quad (\\text{support: } ${r.deflectionSupport}; \\text{ longer span, Cl. 31.2.1})`)}
                        <p style="font-size:12px;color:#64748b;">${r.ldCheck.note}</p>
                        ${kx(`f_s = ${r.ldCheck.fs} \\text{ N/mm}^2, \\quad p_t = ${r.ldCheck.pt}\\%`)}
                        ${kx(`\\text{Modification factor} = ${r.ldCheck.mf}, \\quad \\text{Modified } l/d = ${r.ldCheck.modifiedRatio}`)}
                        ${kx(`d_{req} = ${r.ldCheck.d_req} \\text{ mm}, \\quad d_{provided} = ${r.ldCheck.d_provided} \\text{ mm}`)}
                        <div style="margin-top:6px;">
                            <span style="color:#64748b; font-weight:bold; border:1px solid #cbd5e1; padding:2px 10px; border-radius:4px;">IGNORED</span>
                            &mdash; Annex C governs
                        </div>
                    </div>
                </div>

                <h2>9. Summary</h2>
                <table class="result-table">
                    <thead><tr><th>Check</th><th>Demand</th><th>Capacity</th><th>Status</th></tr></thead>
                    <tbody>
                        <tr><td>Min. Thickness (Cl. 31.2.1)</td><td>${r.thicknessCheck.D} mm</td><td>${r.thicknessCheck.D_min} mm</td><td>${r.thicknessCheck.ok ? statusChip(true,'OK') : statusChip(false,'FAIL')}</td></tr>
                        <tr><td>Static Moment M₀</td><td>${r.M0.toFixed(1)} kN·m</td><td>—</td><td>—</td></tr>
                        <tr><td>Punching Shear τ<sub>v</sub> (Cl. 31.6, governing section)</td><td>${r.tau_v.toFixed(3)} N/mm²</td><td>${r.tau_c.toFixed(3)} N/mm²</td><td>${r.punching_safe ? statusChip(true,'OK') : statusChip(false,'FAIL')}</td></tr>
                        <tr><td>Provided steel ≥ required (all zones)</td><td>col. strip bottom ${r.providedSteelCheck.colBottomProvided} mm²/m</td><td>${Number.isNaN(r.providedSteelCheck.colBottomRequired) ? '—' : r.providedSteelCheck.colBottomRequired + ' mm²/m'}</td><td>${r.providedSteelCheck.ok ? statusChip(true,'OK') : statusChip(false,'REVISE')}</td></tr>
                        ${r.dropChecks ? `<tr><td>Drop plan ≥ l/3 (Cl. 31.2.2)</td><td>${dropL1}×${dropL2} m</td><td>${r.dropChecks.dropL1_min}×${r.dropChecks.dropL2_min} m</td><td>${r.dropChecks.planOk ? statusChip(true,'OK') : statusChip(false,'REVISE')}</td></tr>` : ''}
                        <tr><td>DDM limitations (Cl. 31.4.1)</td><td>${r.ddmChecks.nSpansL1}×${r.ddmChecks.nSpansL2} spans, ratio ${r.ddmChecks.aspect}, LL/DL ${r.ddmChecks.loadRatio}</td><td>≥3 spans, ≤2.0, ≤3.0</td><td>${r.ddmChecks.ok ? statusChip(true,'OK') : statusChip(false,'REVISE')}</td></tr>
                        <tr><td>Span/Depth (Cl. 23.2)</td><td>d<sub>prov</sub>=${r.ldCheck.d_provided} mm</td><td>d<sub>req</sub>=${r.ldCheck.d_req} mm</td><td><span style="color:#64748b; font-weight:bold;">IGNORED</span></td></tr>
                    </tbody>
                </table>

                ${[...r.ddmChecks.messages, ...r.warnings, ...(r.dropChecks ? r.dropChecks.messages : [])].map((m: string) => `<p style="font-size:12px;color:#475569;">${m}</p>`).join('')}
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

async function printHtml(htmlContent: string, preview: boolean = false): Promise<string | null> {
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    if (preview) {
        window.open(blobUrl, '_blank');
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
                logger.error('Flat slab print failed, falling back to new tab', e);
                window.open(blobUrl, '_blank');
            }
            setTimeout(() => cleanup(iframe), 2000);
        };

        document.body.appendChild(iframe);
        iframe.src = blobUrl;
        setTimeout(() => { if (!settled) cleanup(iframe); }, 5000);
    });
}
