/**
 * wallHtml.ts — HTML table rendering for the basement wall designer.
 *
 * Split from wallEngine.ts (ARCH-01): the original 1,690-line file mixed the
 * mathematical solver, IS 456 design, optimizer, canvas drawing, and HTML
 * table rendering into a single module. This file holds only the HTML table
 * generators (`renderWallDesignTable`, `renderOptimizationTable`).
 *
 * Dependencies on wallEngine.ts: `WallAnalysisResult`, `OptimizeResult` types.
 */

import type { WallAnalysisResult, OptimizeResult } from './wallEngine';

// ───────────────────── Results Table Rendering ─────────────────────

export function renderWallDesignTable(container: HTMLElement | null, wallResult: WallAnalysisResult): void {
    if (!container) return;
    const { zoneDesigns, feasible, totalConcreteVol, totalSteelWeight, governingZone, maxUtilization, config } = wallResult;
    const mat = config.material;
    const lf = config.loadFactor || 1.5;
    const waterLabel = { submerged: 'Fully Submerged', partial: 'Partial W.T.', dry: 'Dry' }[config.soilParams?.waterMode ?? 'submerged'] || '—';

    let html = `
        <div style="margin-bottom:16px">
            <div class="span-row"><span class="span-row-label">K0</span><span class="span-row-value">${wallResult.K0.toFixed(3)}</span></div>
            <div class="span-row"><span class="span-row-label">Concrete</span><span class="span-row-value">${mat.grade} (fck=${mat.fck} MPa)</span></div>
            <div class="span-row"><span class="span-row-label">Steel</span><span class="span-row-value">Fe ${mat.fy} (fy=${mat.fy} MPa)</span></div>
            <div class="span-row"><span class="span-row-label">Cover</span><span class="span-row-value">${mat.cover} mm</span></div>
            <div class="span-row"><span class="span-row-label">Load Factor</span><span class="span-row-value">${lf}</span></div>
            <div class="span-row"><span class="span-row-label">Water Condition</span><span class="span-row-value">${waterLabel}</span></div>
        </div>
        <table class="data-table">
            <thead><tr>
                <th>Zone</th>
                <th>t (mm)</th>
                <th>d Hog (mm)</th>
                <th>d Sag (mm)</th>
                <th>Vu (kN)</th>
                <th>Mu hog (kN·m)</th>
                <th>Earth Face</th>
                <th>Mu sag (kN·m)</th>
                <th>Inner Face</th>
                <th>Horiz. / face</th>
                <th title="Shear without links, IS 456 Cl. 40.2.1.1">τv / k·τc</th>
                <th title="Crack width, IS 456 Annex F / Cl. 35.3.2">w earth / inner (mm)</th>
                <th title="Axial + bending with slenderness, IS 456 Cl. 32.2 / 39">Mu,P / cap (He/t)</th>
                <th>Status</th>
            </tr></thead>
            <tbody>`;

    for (const zd of zoneDesigns) {
        const hogOk = zd.mainBars_hogging.Ast_provided >= zd.flex_hogging.Ast_req;
        const sagOk = zd.mainBars_sagging.Ast_provided >= zd.flex_sagging.Ast_req;
        const fails: string[] = [];
        if (zd.flex_hogging.isDoubly || zd.flex_sagging.isDoubly) fails.push('Doubly req.');
        if (zd.flex_hogging.governs === 'maximum' || zd.flex_sagging.governs === 'maximum') fails.push('Ast > 4%');
        if (zd.mainBars_hogging.adequate === false || zd.mainBars_sagging.adequate === false) fails.push('Bars short');
        if (!zd.shearOk) fails.push('Shear');
        if (!zd.crack.hogging.ok || !zd.crack.sagging.ok) fails.push('Crack');
        if (!zd.pm.ok) fails.push(zd.pm.slendernessOk ? 'P–M' : 'He/t > 30');
        if (zd.thickness < 150) fails.push('t < 150');
        const statusClass = zd.ok ? 'color:var(--positive)' : 'color:var(--negative)';
        const statusText = zd.ok ? 'OK' : fails.join(', ') || 'FAIL';
        const kTauC = zd.shear_k * zd.shear.tau_c;
        // Governing face for axial + bending: the larger Mu / capacity
        const rH = zd.pm.cap_h > 0 ? zd.pm.Mu_h / zd.pm.cap_h : Infinity;
        const rS = zd.pm.cap_s > 0 ? zd.pm.Mu_s / zd.pm.cap_s : Infinity;
        const pmMu = rS > rH ? `${zd.pm.Mu_s} / ${zd.pm.cap_s}` : `${zd.pm.Mu_h} / ${zd.pm.cap_h}`;

        // Build bar cell with Ast demand/provided
        const hogCell = `<span style="font-size:0.85em">${zd.mainBars_hogging.label}</span><br/>`
            + `<span style="font-size:0.75em;color:var(--text-muted)">`
            + `${zd.flex_hogging.Ast_req}/${zd.mainBars_hogging.Ast_provided} mm²`
            + `${hogOk ? '' : ' <span style="color:var(--negative)">✗</span>'}</span>`;
        const sagCell = `<span style="font-size:0.85em">${zd.mainBars_sagging.label}</span><br/>`
            + `<span style="font-size:0.75em;color:var(--text-muted)">`
            + `${zd.flex_sagging.Ast_req}/${zd.mainBars_sagging.Ast_provided} mm²`
            + `${sagOk ? '' : ' <span style="color:var(--negative)">✗</span>'}</span>`;

        html += `<tr>
            <td><strong>${zd.zone}</strong></td>
            <td>${zd.thickness}</td>
            <td>${zd.d_hogging}</td>
            <td>${zd.d_sagging}</td>
            <td>${zd.V_governing.toFixed(1)}</td>
            <td>${zd.M_hogging.toFixed(2)}</td>
            <td>${hogCell}</td>
            <td>${zd.M_sagging.toFixed(2)}</td>
            <td>${sagCell}</td>
            <td style="font-size:0.85em">${zd.distBars.label}</td>
            <td>${zd.shear.tau_v} / ${kTauC.toFixed(3)}</td>
            <td>${zd.crack.hogging.w.toFixed(3)} / ${zd.crack.sagging.w.toFixed(3)}</td>
            <td style="font-size:0.85em">${pmMu} (${zd.pm.slenderness})</td>
            <td style="${statusClass};font-weight:700">${statusText}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    const consChecked = config.checkConstructionStage === true;
    html += `<div class="config-note" style="margin-top:8px;font-size:0.78rem;color:var(--text-muted)">
        Shear is resisted without links (τv ≤ k·τc, Cl. 40.2.1.1); where needed the tension bars are increased to raise τc (Table 19).
        Crack width limits ${(config.crackWidthLimitEarth ?? 0.2)} mm earth face / ${(config.crackWidthLimitInner ?? 0.3)} mm inner face (Cl. 35.3.2, Annex F${config.checkCrackWidth === false ? ' — check switched off' : ''}).
        Horizontal steel ${mat.fy >= 415 ? '0.20' : '0.25'} % of b·t, half per face (Cl. 32.5 c).
        ${consChecked ? 'Construction stage (cantilever before floors are cast) included.' : 'Construction stage not checked — backfill only after the floor slabs are cast.'}
    </div>`;

    // Summary
    const summaryColor = feasible ? 'var(--positive)' : 'var(--negative)';
    html += `
        <div class="equil-note${feasible ? '' : ' error'}" style="margin-top:16px">
            <strong>${feasible ? 'DESIGN FEASIBLE' : 'DESIGN NOT FEASIBLE'}</strong> |
            Concrete: ${totalConcreteVol} m³/m |
            Steel: ${totalSteelWeight} kg/m |
            Governing: Zone ${governingZone} (${(maxUtilization * 100).toFixed(0)}%)
        </div>`;

    container.innerHTML = html;
}

export function renderOptimizationTable(container: HTMLElement | null, optResult: OptimizeResult): void {
    if (!container || !optResult) return;

    // CALC-005: clearly distinguish a provably-global optimum (full enumeration of
    // every thickness combination) from an approximate result produced by the
    // sequential-greedy fallback when the search space was too large to enumerate.
    const isApprox = optResult.approximate === true;
    const badge = isApprox
        ? `<span class="opt-badge opt-badge-approx" title="Combination count exceeded the full-enumeration limit. Result shown is the best found by sequential greedy search and may not be globally optimal."
                style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:0.74rem;font-weight:700;
                       background:rgba(255,176,32,0.14);color:#ffb020;border:1px solid rgba(255,176,32,0.45);cursor:help;">
                &#9888; Approximate</span>`
        : `<span class="opt-badge opt-badge-optimal" title="Full enumeration completed — every thickness combination was evaluated, so this result is the global optimum."
                style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:0.74rem;font-weight:700;
                       background:rgba(0,229,160,0.14);color:#00e5a0;border:1px solid rgba(0,229,160,0.45);cursor:help;">
                &#10003; Optimal</span>`;
    const methodLabel = isApprox ? 'sequential greedy search' : 'full enumeration';

    let html = `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <div style="color:var(--text-muted); font-size:0.85rem">
            Evaluated ${optResult.totalTrials} combinations, ${optResult.feasibleCount} feasible (${methodLabel}).
        </div>
        ${badge}
    </div>`;
    if (isApprox) {
        html += `<div class="config-note" data-testid="opt-approx-note" style="margin:-4px 0 12px;font-size:0.78rem;color:#ffb020">
            Search space exceeded the full-enumeration limit; the design below is the best found by sequential greedy search and may not be globally optimal. Lower the thickness step or zone count for an exhaustive search.
        </div>`;
    }

    if (optResult.topDesigns && optResult.topDesigns.length > 0) {
        html += `<table class="data-table">
            <thead><tr>
                <th>#</th>
                <th>Thicknesses (mm)</th>
                <th>Concrete (m³/m)</th>
                <th>Steel (kg/m)</th>
                <th>Max Util.</th>
            </tr></thead><tbody>`;

        for (let i = 0; i < Math.min(optResult.topDesigns.length, 10); i++) {
            const d = optResult.topDesigns[i];
            const isBest = i === 0;
            html += `<tr${isBest ? ' style="background:rgba(0,229,160,0.06)"' : ''}>
                <td>${isBest ? '<strong>BEST</strong>' : i + 1}</td>
                <td style="font-family:var(--mono)">${d.thicknesses.join(' / ')}</td>
                <td>${d.concreteVol}</td>
                <td>${d.steelWeight}</td>
                <td>${(d.maxUtilization * 100).toFixed(0)}%</td>
            </tr>`;
        }
        html += '</tbody></table>';
    } else {
        html += '<div class="equil-note error">No feasible design found in the given thickness range. Increase maximum thickness or adjust loads.</div>';
    }

    container.innerHTML = html;
}

