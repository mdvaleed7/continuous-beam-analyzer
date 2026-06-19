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
                <th>Shear Links</th>
                <th>τv / τc</th>
                <th>Status</th>
            </tr></thead>
            <tbody>`;

    for (const zd of zoneDesigns) {
        const shearOk = zd.shear.status !== 'FAIL';
        const flexOk = !zd.flex_hogging.isDoubly && !zd.flex_sagging.isDoubly;
        const hogOk = zd.mainBars_hogging.Ast_provided >= zd.flex_hogging.Ast_req;
        const sagOk = zd.mainBars_sagging.Ast_provided >= zd.flex_sagging.Ast_req;
        const ok = shearOk && flexOk;
        const statusClass = ok ? 'color:var(--positive)' : 'color:var(--negative)';
        const statusText = ok ? 'OK' : (zd.shear.status === 'FAIL' ? 'Shear FAIL' : 'Doubly req.');

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
            <td style="font-size:0.85em">${zd.shear.links ? zd.shear.links.label : '—'}</td>
            <td>${zd.shear.tau_v} / ${zd.shear.tau_c}</td>
            <td style="${statusClass};font-weight:700">${statusText}</td>
        </tr>`;
    }
    html += '</tbody></table>';

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

