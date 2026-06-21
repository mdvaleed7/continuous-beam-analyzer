/**
 * beamHtml.ts — HTML rendering for the continuous beam analyzer.
 *
 * Split from beamEngine.ts (ARCH-01): the original 1,895-line file mixed the
 * mathematical solver, canvas drawing, and HTML rendering into a single
 * module. This file holds only the HTML string generators that produce the
 * reactions table, span cards, validation summary, and numeric results table.
 *
 * Dependencies on beamEngine.ts: `alphaLabel`, `formatCoeffTerm`, `toFrac`,
 * `F`, `ZERO` — all re-exported from the engine for use in the symbolic
 * equation rendering.
 */

import { alphaLabel, formatCoeffTerm, toFrac, F, ZERO, ONE } from './beamEngine';

export function renderReactionsHTML(result: any, wVal: number, LVal: any): { reactionsHtml: string; eqHtml: string } {
    const { reactions, endCond, labels, alphas, refSpanL, loadCase } = result;
    const isCombined = loadCase === 'udl+uvl';
    const allAlphaOne = alphas.every((a: any) => a.eq(ONE));
    const refSuffix = allAlphaOne ? '' : `<sub>${refSpanL + 1}</sub>`;
    const unitF = isCombined ? `l${refSuffix}` : `wl${refSuffix}`;
    const unitM = isCombined ? `l${refSuffix}²` : `wl${refSuffix}²`;

    // When tapered beams are present, display decimals (3 dp) instead of fractions
    const isTapered = !!(result.spanTapers && result.spanTapers.some((t: any) => t));
    const fmt = (v: any) => isTapered ? v.fl(result.w1Val, result.w2Val).toFixed(3) : v.html();
    const fmtStr = (v: any) => isTapered ? v.fl(result.w1Val, result.w2Val).toFixed(3) : v.str();

    const headerLabel = isTapered ? 'Reaction (Numeric)' : 'Reaction (Exact)';
    let html = `<div style="overflow-x: auto;"><table><thead><tr><th>Support</th><th>Type</th><th>${headerLabel}</th><th>Expression</th></tr></thead><tbody>`;
    for (let i = 0; i < reactions.length; i++) {
        const r = reactions[i];
        const isFixedLeft = i === 0 && (endCond === 'fixed' || endCond === 'fixed-fixed');
        const isFixedRight = i === reactions.length - 1 && endCond === 'fixed-fixed';
        const isFixed = isFixedLeft || isFixedRight;
        const Rv = r.Rv;
        html += `<tr>
            <td><strong>R<sub>${r.label}</sub></strong></td>
            <td>Force</td>
            <td>${fmt(Rv)}<span class="unit-label"> × ${unitF}</span></td>
            <td class="val-decimal">${fmtStr(Rv)}</td>
        </tr>`;
        if (isFixed) {
            const Mt = isFixedLeft ? r.Rt.neg() : r.Rt;
            html += `<tr>
                <td><strong>M<sub>${r.label}</sub></strong></td>
                <td>Moment</td>
                <td>${fmt(Mt)}<span class="unit-label"> × ${unitM}</span></td>
                <td class="val-decimal">${fmtStr(Mt)}</td>
            </tr>`;
        }
    }
    html += '</tbody></table></div>';

    // Equilibrium check
    let eqHtml = '';
    const TOL = isTapered ? 1e-6 : 1e-10;

    if (isCombined && result.totalReaction.isLinExpr && result.totalLoad.isLinExpr) {
        // Check both components independently (only possible for non-tapered
        // beams where LinExpr arithmetic is preserved end-to-end)
        const eq1 = result.totalReaction.c1.sub(result.totalLoad.c1);
        const eq2 = result.totalReaction.c2.sub(result.totalLoad.c2);
        if (Math.abs(eq1.fl()) < TOL && Math.abs(eq2.fl()) < TOL) {
            eqHtml = `<div class="equil-note">✓ Equilibrium verified for both w₁ and w₂ components independently</div>`;
        } else {
            const errStr1 = isTapered ? eq1.fl().toExponential(2) : eq1.str();
            const errStr2 = isTapered ? eq2.fl().toExponential(2) : eq2.str();
            eqHtml = `<div class="equil-note error">✗ Equilibrium error in components: Δw₁=${errStr1}, Δw₂=${errStr2}</div>`;
        }
    } else {
        // For tapered beams or non-combined loads, use numeric comparison
        const tr = result.totalReaction.fl(result.w1Val, result.w2Val);
        const tl = result.totalLoad.fl(result.w1Val, result.w2Val);
        const diff = Math.abs(tr - tl);
        if (diff < TOL * Math.max(1, Math.abs(tl))) {
            const rStr = isTapered ? tr.toFixed(3) : result.totalReaction.str();
            const lStr = isTapered ? tl.toFixed(3) : result.totalLoad.str();
            eqHtml = `<div class="equil-note">✓ Equilibrium verified: ΣR = ${rStr} = Total load = ${lStr}</div>`;
        } else {
            const rStr = isTapered ? tr.toFixed(3) : result.totalReaction.str();
            const lStr = isTapered ? tl.toFixed(3) : result.totalLoad.str();
            eqHtml = `<div class="equil-note error">✗ Equilibrium error: ΣR = ${rStr}, Load = ${lStr}, Diff = ${diff.toExponential(2)}</div>`;
        }
    }
    
    return { reactionsHtml: html, eqHtml };
}

export function renderSpanCardsHTML(result: any, wVal: number, LVal: any): string {
    const { alphas, refSpanL, loadCase } = result;
    const isCombined = loadCase === 'udl+uvl';    const allAlphaOne = alphas.every((a: any) => a.eq(ONE));
    const refSuffix = allAlphaOne ? '' : `<sub>${refSpanL + 1}</sub>`;
    const unitM = isCombined ? `l${refSuffix}²` : `wl${refSuffix}²`;
    const unitV = isCombined ? `l${refSuffix}` : `wl${refSuffix}`;

    let html = '';
    for (const sp of result.spans) {
        const si = sp.spanIdx;
        const delay = si * 80;
        const alpha = sp.alpha;
        const aLabel = alphaLabel(alpha);

        // Info badge
        const betaStr = result.betas[si].eq(ONE) ? '' : ` | EI ratio: ${result.betas[si].str()}`;
        const spanInfo = `Length: ${aLabel}${betaStr}`;

        let loadDesc;
        const wlf = sp.wL_frac, wrf = sp.wR_frac;
        if (wlf.isLinExpr) {
            loadDesc = wlf.eq(wrf) ? `Load: ${wlf.str()}` : `Load: ${wlf.str()} → ${wrf.str()}`;
        } else {
            loadDesc = wlf.eq(wrf) ? `UDL: w = ${wlf.str()}` : `Trapezoidal: ${wlf.str()} → ${wrf.str()}`;
        }
        if (sp.isPartialLoad) {
            loadDesc += ` [Partial up to x=${sp.loadStopDistA.toFixed(2)}]`;
        }
            // Shear equation
            let vEq = `V(x) = ${sp.VLeft_frac.str()}`;
            if (sp.isPartialLoad) {
                vEq = `V(x) [piecewise at a=${sp.loadStopDistA.toFixed(2)}]`;
            } else {
                if (!wlf.isZero()) {
                    if (wlf.isLinExpr) {
                        vEq += ` − (${wlf.str()})·x`;
                    } else {
                        vEq += formatCoeffTerm(wlf.neg(), 'x');
                    }
                }
                if (!wlf.eq(wrf)) {
                    const dwExpr = wlf.sub(wrf);
                    if (dwExpr.isLinExpr) {
                        vEq += ` + (${dwExpr.str()})·x²/(2·${alphaLabel(alpha)})`;
                    } else {
                        const dwCoeff = dwExpr.div(new F(2).mul(alpha));
                        vEq += formatCoeffTerm(dwCoeff, 'x²');
                    }
                }
            }
            // Moment equation
            let mEq = `M(x) = ${sp.MLeft_frac.str()}`;
            if (sp.isPartialLoad) {
                mEq = `M(x) [piecewise at a=${sp.loadStopDistA.toFixed(2)}]`;
            } else {
                if (sp.VLeft_frac.isLinExpr) {
                    mEq += ` + (${sp.VLeft_frac.str()})·x`;
                } else {
                    mEq += formatCoeffTerm(sp.VLeft_frac, 'x');
                }
                if (!wlf.isZero()) {
                    if (wlf.isLinExpr) {
                        mEq += ` − (${wlf.str()})·x²/2`;
                    } else {
                        mEq += formatCoeffTerm(wlf.div(new F(2)).neg(), 'x²');
                    }
                }
                if (!wlf.eq(wrf)) {
                    const dwExpr = wlf.sub(wrf);
                    if (dwExpr.isLinExpr) {
                        mEq += ` + (${dwExpr.str()})·x³/(6·${alphaLabel(alpha)})`;
                    } else {
                        const dw6a = dwExpr.div(new F(6).mul(alpha));
                        mEq += formatCoeffTerm(dw6a, 'x³');
                    }
                }
            }
            const isTapered = !!(result.spanTapers && result.spanTapers[si]);
            const fmtFl = (frac: any) => frac.fl(result.w1Val, result.w2Val).toFixed(3);
            const vLStr = isTapered ? fmtFl(sp.VLeft_frac) : sp.VLeft_frac.html();
            const vRStr = isTapered ? fmtFl(sp.VRight_frac) : sp.VRight_frac.html();
            const mLStr = isTapered ? fmtFl(sp.MLeft_frac) : sp.MLeft_frac.html();
            const mRStr = isTapered ? fmtFl(sp.MRight_frac) : sp.MRight_frac.html();

            const eqBlock = `
            <div class="span-section-title">Shear Force</div>
            <div class="span-expr">${vEq}</div>
            <div class="span-row"><span class="span-row-label">V(0)</span><span class="span-row-value">${vLStr}<span class="unit-label"> × ${unitV}</span></span></div>
            <div class="span-row"><span class="span-row-label">V(${aLabel})</span><span class="span-row-value">${vRStr}<span class="unit-label"> × ${unitV}</span></span></div>
            <div class="span-section-title">Bending Moment</div>
            <div class="span-expr">${mEq}</div>
            <div class="span-row"><span class="span-row-label">M(0)</span><span class="span-row-value">${mLStr}<span class="unit-label"> × ${unitM}</span></span></div>
            <div class="span-row"><span class="span-row-label">M(${aLabel})</span><span class="span-row-value">${mRStr}<span class="unit-label"> × ${unitM}</span></span></div>`;

        // Zero shear and max moment
        let zeroShearStr = '—', maxMStr = '—', distStr = '—';
        if (isTapered) {
            // Tapered: show decimals (3 dp)
            if (sp.zeroShearX !== null) {
                zeroShearStr = `${sp.zeroShearX.toFixed(3)} l`;
            }
            if (sp.maxM !== null) {
                maxMStr = `${sp.maxM.toFixed(3)} ${unitM}`;
            }
            if (sp.maxMx !== null) {
                const cumDist = result.cumAlphas[si].fl();
                distStr = `${(cumDist + sp.maxMx).toFixed(3)} l from ${result.labels[0]}`;
            }
        } else {
            // Non-tapered: show exact fractions/surds
            if (sp.zeroShearExact) {
                zeroShearStr = `${sp.zeroShearExact.html()} l`;
            } else if (sp.zeroShearX !== null) {
                const xFrac = toFrac(Math.round(sp.zeroShearX * 1e8) / 1e8);
                zeroShearStr = `${xFrac.html()} l`;
            }
            if (sp.maxMExact) {
                maxMStr = sp.maxMExact.isText ? sp.maxMExact.html() : `${sp.maxMExact.html()} ${unitM}`;
            } else if (sp.maxM !== null) {
                const mFrac = toFrac(Math.round(sp.maxM * 1e8) / 1e8);
                maxMStr = `${mFrac.html()} ${unitM}`;
            }
            if (sp.exactDistFromA_HTML) {
                distStr = `${sp.exactDistFromA_HTML} from Support A`;
            } else if (sp.maxMx !== null) {
                const cumDist = result.cumAlphas[si];
                const localX = toFrac(Math.round(sp.maxMx * 1e8) / 1e8);
                const distFrac = cumDist.add(localX);
                distStr = `${distFrac.html()} l from ${result.labels[0]}`;
            }
        }

        html += `<div class="span-card" style="animation-delay:${delay}ms">
            <div class="span-card-header">
                <span class="span-card-title">Span ${si + 1} (${sp.leftLabel} → ${sp.rightLabel})</span>
                <span class="span-card-badge">${loadDesc}</span>
            </div>
            <div class="span-info-row">${spanInfo}</div>
            ${eqBlock}
            <div class="span-highlight">
                <div class="span-row"><span class="span-row-label">Zero Shear at</span><span class="span-row-value">${zeroShearStr}</span></div>
                <div class="span-row"><span class="span-row-label">Max Moment</span><span class="span-row-value">${maxMStr}</span></div>
                <div class="span-row"><span class="span-row-label">Distance from ${result.labels[0]}</span><span class="span-row-value">${distStr}</span></div>
            </div>
        </div>`;
    }
    return html;
}

// ───────────────────── Validation ─────────────────────

const WB = {
    UDL_fixed: {
        1: { Ra: [5, 8], Ma: [-1, 8], Rb: [3, 8] },
        2: { Ra: [13, 28], Ma: [-1, 14], Rb: [8, 7], Rc: [11, 28] },
        3: { Ra: [53, 104], Ma: [-9, 104], Rb: [25, 26], Rc: [59, 52], Rd: [41, 104] },
        4: { Ra: [193, 388], Ma: [-8, 97], Rb: [98, 97], Rc: [187, 194], Rd: [110, 97], Re: [153, 388] }
    },
    UVL_global_fixed: {
        1: { Ra: [2, 5], Ma: [-1, 15], Rb: [1, 10] },
        2: { Ra: [25, 56], Ma: [-31, 420], Rb: [18, 35], Rc: [11, 280] },
        3: { Ra: [181, 390], Ma: [-1, 13], Rb: [44, 65], Rc: [43, 130], Rd: [11, 390] },
        4: { Ra: [3671, 7760], Ma: [-457, 5820], Rb: [147, 194], Rc: [483, 970], Rd: [243, 970], Re: [161, 7760] }
    }
};

export function renderValidationHTML(result: any): string {
    const { nSpans, spanLoads, reactions, alphas } = result;
    const isTapered = !!(result.spanTapers && result.spanTapers.some((t: any) => t));

    // --- Force equilibrium: ΣR vs total applied load ---
    // Use the already-computed totalReaction and totalLoad from analyzeBeam
    // (avoids re-summing and possibly diverging from the engine's own bookkeeping).
    const loadFy = result.totalLoad;
    const sumFy = result.totalReaction;

    let isEquilFy, isEquilM;
    let detailsFy, detailsM;

    if (isTapered) {
        // Tapered beams use numeric stiffness matrices → exact fraction equality
        // cannot hold.  Fall back to a numeric tolerance check.
        const numericFl = (v: any): any => {
            if (!v) return 0;
            if (v.isLinExpr) return v.fl(result.w1Val || 1, result.w2Val || 1);
            return v.fl();
        };
        const sumR_n = numericFl(sumFy);
        const load_n = numericFl(loadFy);
        const tol = Math.max(1e-6, Math.abs(load_n) * 1e-6);
        isEquilFy = Math.abs(sumR_n - load_n) < tol;
        detailsFy = `Applied ≈ ${load_n.toFixed(6)}, Reactions ≈ ${sumR_n.toFixed(6)} (numeric tolerance ${tol.toExponential(1)})`;

        // Moment equilibrium: same numeric approach
        let sumM_n = 0;
        let cumX_n = 0;
        const w1 = result.w1Val || 1, w2 = result.w2Val || 1;
        for (let i = 0; i <= nSpans; i++) {
            const rv = numericFl(reactions[i].Rv);
            const rt = numericFl(reactions[i].Rt);
            sumM_n += rt;
            if (i > 0) sumM_n += rv * cumX_n;
            if (i < nSpans) cumX_n += alphas[i].fl();
        }
        const loadM_n = numericFl(result.totalMoment);
        const tolM = Math.max(1e-6, Math.abs(loadM_n) * 1e-6);
        isEquilM = isFinite(sumM_n) && Math.abs(sumM_n - loadM_n) < tolM;
        detailsM = `Applied ≈ ${loadM_n.toFixed(6)}, Reactions ≈ ${isFinite(sumM_n) ? sumM_n.toFixed(6) : 'N/A'} (numeric tolerance ${tolM.toExponential(1)})`;
    } else {
        // Prismatic beams: exact fraction comparison
        const remFy = sumFy.sub(loadFy);
        isEquilFy = remFy.isZero();
        detailsFy = `Applied = ${loadFy.str()}, Reactions = ${sumFy.str()}`;

        // Moment equilibrium
        let cumX = ZERO;
        const cumAlphas: any[] = [ZERO];
        for (const a of alphas) { cumX = cumX.add(a); cumAlphas.push(cumX); }
        let sumM = ZERO;
        reactions.forEach((r: any, i: number) => {
            sumM = sumM.add(r.Rt);
            if (i > 0) sumM = sumM.add(r.Rv.mul(cumAlphas[i]));
        });
        const loadM = result.totalMoment || ZERO;
        const remM = sumM.sub(loadM);
        isEquilM = remM.isZero();
        detailsM = `Applied = ${loadM.str()}, Reactions = ${sumM.str()}`;
    }

    let html = `<div style="overflow-x: auto;"><table class="valid-table"><thead><tr><th>Condition</th><th>Status</th><th>Details</th></tr></thead><tbody>`;

    const statusFy = isEquilFy
        ? '<span class="valid-match">✓ Perfect</span>'
        : '<span class="valid-mismatch">✗ Failed</span>';
    html += `<tr>
        <td><strong>ΣF<sub>y</sub> = 0</strong> (Vertical Equilibrium)</td>
        <td>${statusFy}</td>
        <td>${detailsFy}</td>
    </tr>`;

    const statusM = isEquilM
        ? '<span class="valid-match">✓ Perfect</span>'
        : '<span class="valid-mismatch">✗ Failed</span>';
    html += `<tr>
        <td><strong>ΣM<sub>0</sub> = 0</strong> (Moment Equilibrium about Node A)</td>
        <td>${statusM}</td>
        <td>${detailsM}</td>
    </tr>`;

    html += '</tbody></table></div>';

    if (isEquilFy && isEquilM) {
        html += isTapered
            ? `<div class="valid-ok-note">✓ Global equilibrium verified numerically (tapered beam — numeric integration stiffness).</div>`
            : `<div class="valid-ok-note">✓ Global equilibrium mathematically verified via exact fractional integration across all spans.</div>`;
    } else {
        html += `<div class="valid-note"><strong>⚠ Error:</strong> The system is NOT in global equilibrium.</div>`;
    }

    return html;
}

// ───────────────────── Numeric Results ─────────────────────

// (Old UI logic removed)

export function renderNumericResultsHTML(result: any, wVal: number, w1Val: number, w2Val: number): string {
    try {
        const { nSpans, reactions, spans, spanLengths, refSpanL, loadCase } = result;
        const refL = spanLengths[refSpanL].fl();

        const getPhysV = (val: any): any => {
            if (!val) return 0;
            if (val.isLinExpr) {
                return val.fl(w1Val, w2Val) * refL;
            }
            return val.fl() * wVal * refL;
        };

        const getPhysM = (val: any): any => {
            if (!val) return 0;
            if (val.isLinExpr) {
                return val.fl(w1Val, w2Val) * refL * refL;
            }
            return val.fl() * wVal * refL * refL;
        };

        const fmt = (num: any): any => {
            if (Math.abs(num) < 1e-10) return "0.000";
            return num.toFixed(3);
        };

        // 1. Reactions Table
        let html = `
            <div style="margin-bottom: 24px; overflow-x: auto;">
                <h3 style="margin-top: 0; color: var(--text-primary); font-size: 16px;">Support Reactions & Moments</h3>
                <table class="data-table" style="min-width: 500px;">
                    <thead>
                        <tr>
                            <th>Support</th>
                            <th>Vertical Reaction (R)</th>
                            <th>Bending Moment (M)</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        for (let i = 0; i <= nSpans; i++) {
        const R = getPhysV(reactions[i].Rv);
        const M = (i < nSpans) ? getPhysM(spans[i].MLeft_frac) : getPhysM(spans[nSpans - 1].MRight_frac);
        const supportName = String.fromCharCode(65 + i);
            html += `
                <tr>
                    <td><strong>${supportName}</strong></td>
                    <td>${fmt(R)}</td>
                    <td>${fmt(M)}</td>
                </tr>
            `;
        }
        html += `</tbody></table></div>`;

        // 2. Span Maximums Table
        html += `
            <div style="overflow-x: auto;">
                <h3 style="margin-top: 0; color: var(--text-primary); font-size: 16px;">Span Maximum Sagging Moments</h3>
                <table class="data-table" style="min-width: 500px;">
                    <thead>
                        <tr>
                            <th>Span</th>
                            <th>Max Sagging Moment</th>
                            <th>Distance from Left Support</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        for (let i = 0; i < nSpans; i++) {
            const sp = spans[i];
            const VL = getPhysV(sp.VLeft_frac);
            const ML = getPhysM(sp.MLeft_frac);
            const L = spanLengths[i].fl();

            let phys_wL, phys_wR;
            if (loadCase === 'udl+uvl') {
                phys_wL = sp.wL_frac.fl(w1Val, w2Val);
                phys_wR = sp.wR_frac.fl(w1Val, w2Val);
            } else {
                phys_wL = sp.wL_frac.fl() * wVal;
                phys_wR = sp.wR_frac.fl() * wVal;
            }

            const dw = phys_wL - phys_wR;
            const isUDL = Math.abs(dw) < 1e-10;

            let x0 = null;
            let maxM = null;

            if (isUDL && Math.abs(phys_wL) > 1e-10) {
                const temp_x0 = VL / phys_wL;
                if (temp_x0 >= 0 && temp_x0 <= L) {
                    x0 = temp_x0;
                }
            } else if (!isUDL) {
                const A = dw / (2 * L);
                const B = -phys_wL;
                const C = VL;
                const disc = B * B - 4 * A * C;
                if (disc >= 0) {
                    const root1 = (-B + Math.sqrt(disc)) / (2 * A);
                    const root2 = (-B - Math.sqrt(disc)) / (2 * A);
                    const candidates = [root1, root2].filter(r => r >= -1e-10 && r <= L + 1e-10).map(r => Math.max(0, Math.min(L, r)));
                    if (candidates.length > 0) x0 = candidates[0];
                }
            }

            if (x0 !== null) {
                maxM = ML + VL * x0 - 0.5 * phys_wL * x0 * x0 + (dw / (6 * L)) * x0 * x0 * x0;
                if (maxM < 0) {
                    // If it's negative, it's actually hogging, not sagging.
                    maxM = null;
                    x0 = null;
                }
            }

            const spanName = `${String.fromCharCode(65 + i)}-${String.fromCharCode(66 + i)}`;
            html += `
                <tr>
                    <td><strong>${spanName}</strong> (L = ${fmt(L)})</td>
                    <td>${maxM !== null ? fmt(maxM) : '<em>None</em>'}</td>
                    <td>${x0 !== null ? fmt(x0) : '<em>N/A</em>'}</td>
                </tr>
            `;
        }

        html += `</tbody></table></div>`;
        return html;
    } catch (e: any) {
        return '<pre style="color:red; overflow:auto;">' + e.stack + '</pre>';
    }
}
