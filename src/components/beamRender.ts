/**
 * beamRender.ts — Canvas rendering for the continuous beam analyzer.
 *
 * Split from beamEngine.ts (ARCH-01): the original 1,895-line file mixed the
 * mathematical solver, canvas drawing, and HTML rendering into a single
 * module. This file holds only the canvas drawing routines.
 *
 * Dependencies on beamEngine.ts: `alphaLabel`, `toFrac` (re-exported here for
 * the drawing helpers that need them).
 */

import { alphaLabel, toFrac, ONE } from './beamEngine';

// ───────────────────── Canvas Rendering ─────────────────────

const C = {
    beam: '#64748b', support: '#475569', supportFill: '#1e293b',
    fixedHatch: '#94a3b8', load: '#2563eb', loadFill: 'rgba(37,99,235,0.1)',
    reaction: '#059669', reactionTxt: '#059669',
    text: '#1e293b', muted: '#64748b', dim: '#94a3b8',
    sfdPos: 'rgba(37,99,235,0.15)', sfdNeg: 'rgba(220,38,38,0.15)',
    sfdLine: '#2563eb',
    bmdPos: 'rgba(5,150,105,0.15)', bmdNeg: 'rgba(234,88,12,0.15)',
    bmdLine: '#059669',
    grid: 'rgba(0,0,0,0.05)', axis: 'rgba(0,0,0,0.2)'
};

function initCanvas(canvas: HTMLCanvasElement | null, height?: number): { ctx: CanvasRenderingContext2D | null; w: number; h: number } {
    if (typeof window === 'undefined') return { ctx: null, w: 800, h: height || 320 };
    if (!canvas) return { ctx: null, w: 800, h: height || 320 };
    const p = canvas!.parentElement;
    const w = p ? (p.clientWidth || 800) : 800;
    const dpr = window.devicePixelRatio || 1;
    const h = height ?? 320;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas!.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
}

function drawBeamDiagram(canvas: HTMLCanvasElement | null, result: any, wVal: number, LVal: any): void {
    const { ctx, w, h } = initCanvas(canvas, 280);
    if (!ctx) return;
    const { nSpans, loadCase, endCond, spanLoads, reactions, labels, alphas, totalAlpha, w1Val, w2Val, spanTapers, lastSpanLoadStop } = result;
    const pad = { l: 60, r: 60, t: 55, b: 55 };
    const bw = w - pad.l - pad.r;
    const by = h * 0.52;
    const totalA = totalAlpha.fl();

    // Helper: x position of node i (proportional to cumulative alpha)
    const cumA = result.cumAlphas.map((a: any) => a.fl());
    const nx = (i: number): number => pad.l + (cumA[i] / totalA) * bw;

    // --- Draw load arrows ---
    const arrowH = 40;
    ctx.save();
    for (let sp = 0; sp < nSpans; sp++) {
        const { wL, wR } = spanLoads[sp];
        let x0 = nx(sp), x1 = nx(sp + 1);
        let prop = 1;
        
        // Check partial load on last span
        if (sp === nSpans - 1 && lastSpanLoadStop > 0) {
            const L_phys = LVal * alphas[sp].fl();
            if (lastSpanLoadStop < L_phys) {
                prop = lastSpanLoadStop / L_phys;
                x1 = x0 + (x1 - x0) * prop;
            }
        }

        const sw = x1 - x0;
        if (sw <= 0) continue;

        const maxWAll = Math.max(...spanLoads.map((s: any) => Math.max(s.wL.fl(w1Val, w2Val), s.wR.fl(w1Val, w2Val))));
        const wL_val = wL.fl(w1Val, w2Val);
        const wR_val_full = wR.fl(w1Val, w2Val);
        const wR_val = wL_val + (wR_val_full - wL_val) * prop;

        const na = Math.max(4, Math.round(8 * sw / (bw / nSpans)));
        for (let j = 0; j <= na; j++) {
            const t = j / na;
            const x = x0 + t * sw;
            const intensity = wL_val * (1 - t) + wR_val * t;
            const ah = maxWAll > 0 ? (intensity / maxWAll) * arrowH : 0;
            if (ah < 2) continue;
            ctx.strokeStyle = C.load;
            ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(x, by - ah - 4); ctx.lineTo(x, by - 6); ctx.stroke();
            ctx.fillStyle = C.load;
            ctx.beginPath(); ctx.moveTo(x, by - 4); ctx.lineTo(x - 3, by - 10); ctx.lineTo(x + 3, by - 10); ctx.fill();
        }
        // Load line connecting tops
        ctx.strokeStyle = C.load; ctx.lineWidth = 1.5;
        ctx.beginPath();
        const hL = maxWAll > 0 ? (wL_val / maxWAll) * arrowH : 0;
        const hR = maxWAll > 0 ? (wR_val / maxWAll) * arrowH : 0;
        ctx.moveTo(x0, by - hL - 4);
        ctx.lineTo(x1, by - hR - 4);
        ctx.stroke();
        // Shade
        ctx.fillStyle = C.loadFill;
        ctx.beginPath();
        ctx.moveTo(x0, by - 4); ctx.lineTo(x0, by - hL - 4);
        ctx.lineTo(x1, by - hR - 4); ctx.lineTo(x1, by - 4); ctx.fill();
    }
    ctx.restore();

    // --- Draw beam ---
    ctx.fillStyle = C.beam;
    for (let sp = 0; sp < nSpans; sp++) {
        const x0 = nx(sp), x1 = nx(sp + 1);
        let d1 = 4, d2 = 4; // base half-depth
        if (spanTapers && spanTapers[sp]) {
            const ratio = spanTapers[sp].d1 / spanTapers[sp].d2;
            d2 = d1 / ratio;
        }
        ctx.beginPath();
        ctx.moveTo(x0, by - d1);
        ctx.lineTo(x1, by - d2);
        ctx.lineTo(x1, by + d2);
        ctx.lineTo(x0, by + d1);
        ctx.fill();
    }

    // --- Draw supports ---
    for (let i = 0; i < nSpans + 1; i++) {
        const x = nx(i);
        if (i === 0 && (endCond === 'fixed' || endCond === 'fixed-fixed')) {
            drawFixedSupport(ctx, x, by);
        } else if (i === nSpans && endCond === 'fixed-fixed') {
            drawFixedSupportRight(ctx, x, by);
        } else {
            drawPinSupport(ctx, x, by);
        }
        // Label
        ctx.fillStyle = C.text; ctx.font = 'bold 13px Inter'; ctx.textAlign = 'center';
        ctx.fillText(labels[i], x, by + 65);
    }

    // --- Dimension lines ---
    ctx.strokeStyle = C.dim; ctx.lineWidth = 0.8;
    ctx.fillStyle = C.muted; ctx.font = '11px "JetBrains Mono"'; ctx.textAlign = 'center';
    for (let sp = 0; sp < nSpans; sp++) {
        const x0 = nx(sp), x1 = nx(sp + 1), yd = by + 85;
        ctx.beginPath(); ctx.moveTo(x0, yd); ctx.lineTo(x1, yd); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x0, yd - 3); ctx.lineTo(x0, yd + 3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1, yd - 3); ctx.lineTo(x1, yd + 3); ctx.stroke();
        const Ltxt = alphaLabel(alphas[sp]);
        ctx.fillText(Ltxt, (x0 + x1) / 2, yd - 5);
    }

    // --- Load label ---
    ctx.fillStyle = C.load; ctx.font = 'italic 11px Inter'; ctx.textAlign = 'left';
    const loadLabel = loadCase === 'udl' ? `w = ${wVal}` :
        loadCase === 'uvl-global' ? `UVL: w=${wVal} at ${labels[0]} → 0 at ${labels[nSpans]}` :
        loadCase === 'udl+uvl' ? `Combined: w₁ at ${labels[0]} → w₂ at ${labels[nSpans]}  [plotted w₁=${w1Val}, w₂=${w2Val}]` :
        `UVL: w=${wVal}→0 per span`;
    ctx.fillText(loadLabel, pad.l, 20);

    // --- Reaction arrows ---
    ctx.font = '10px "JetBrains Mono"'; ctx.textAlign = 'center';
    for (let i = 0; i < nSpans + 1; i++) {
        const x = nx(i);
        const Rv = reactions[i].Rv.fl(w1Val, w2Val);
        if (Math.abs(Rv) < 1e-15) continue;
        const dir = Rv > 0 ? 1 : -1;
        const ay = by + 26;
        ctx.strokeStyle = C.reaction; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(x, ay + 16 * dir); ctx.lineTo(x, ay); ctx.stroke();
        ctx.fillStyle = C.reaction;
        ctx.beginPath();
        ctx.moveTo(x, ay - 4 * dir);
        ctx.lineTo(x - 4, ay + 4 * dir);
        ctx.lineTo(x + 4, ay + 4 * dir); ctx.fill();
    }
}

function drawFixedSupport(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const hw = 14, hh = 24;
    ctx.fillStyle = C.supportFill;
    ctx.fillRect(x - hw, y - hh / 2, hw, hh);
    ctx.strokeStyle = C.support; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - hh / 2); ctx.lineTo(x, y + hh / 2); ctx.stroke();
    ctx.strokeStyle = C.fixedHatch; ctx.lineWidth = 0.8;
    for (let i = 0; i < 6; i++) {
        const hy = y - hh / 2 + i * 4;
        ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(x - 8, hy + 6); ctx.stroke();
    }
}

function drawFixedSupportRight(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const hw = 14, hh = 24;
    ctx.fillStyle = C.supportFill;
    ctx.fillRect(x, y - hh / 2, hw, hh);
    ctx.strokeStyle = C.support; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - hh / 2); ctx.lineTo(x, y + hh / 2); ctx.stroke();
    ctx.strokeStyle = C.fixedHatch; ctx.lineWidth = 0.8;
    for (let i = 0; i < 6; i++) {
        const hy = y - hh / 2 + i * 4;
        ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(x + 8, hy + 6); ctx.stroke();
    }
}

function drawPinSupport(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const sz = 12;
    ctx.strokeStyle = C.support; ctx.lineWidth = 2; ctx.fillStyle = C.supportFill;
    ctx.beginPath();
    ctx.moveTo(x, y + 2); ctx.lineTo(x - sz, y + sz + 4); ctx.lineTo(x + sz, y + sz + 4); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = C.dim; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - sz - 4, y + sz + 6); ctx.lineTo(x + sz + 4, y + sz + 6); ctx.stroke();
}

function drawDiagramPlot(canvas: HTMLCanvasElement | null, result: any, type: 'sfd' | 'bmd', height?: number): void {
    const { ctx, w, h } = initCanvas(canvas, height || 320);
    if (!ctx) return;
    const { nSpans, spans, alphas, totalAlpha } = result;
    const pad = { l: 70, r: 40, t: 30, b: 35 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const totalA = totalAlpha.fl();
    const cumA = result.cumAlphas.map((a: any) => a.fl());
    const nx = (i: number): number => pad.l + (cumA[i] / totalA) * pw;

    // Collect all values
    let vals: number[] = [];
    for (const sp of spans) {
        const pts = type === 'sfd' ? sp.vPts : sp.mPts;
        pts.forEach((p: any) => vals.push(type === 'sfd' ? p.v : p.m));
    }
    let vMax = Math.max(...vals.map(Math.abs), 0.001);
    vMax *= 1.15;
    const scale = (ph / 2) / vMax;
    const zeroY = pad.t + ph / 2;

    // Grid
    ctx.strokeStyle = C.grid; ctx.lineWidth = 0.5;
    const nGrid = 6;
    for (let i = 0; i <= nGrid; i++) {
        const y = pad.t + (i / nGrid) * ph;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    }
    // Support verticals
    ctx.strokeStyle = C.dim; ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]);
    for (let i = 0; i <= nSpans; i++) {
        const x = nx(i);
        ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Zero axis
    ctx.strokeStyle = C.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, zeroY); ctx.lineTo(w - pad.r, zeroY); ctx.stroke();

    // Helper to draw outlined text
    const drawOutlinedText = (txt: string, x: number, y: number, align: CanvasTextAlign, color: string): void => {
        ctx.textAlign = align;
        ctx.fillStyle = color;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#e2e8f0';
        ctx.strokeText(txt, x, y);
        ctx.fillText(txt, x, y);
    };

    // Unit labels for annotations
    const allAlphaOne = alphas.every((a: any) => a.eq(ONE));
    const refSuffix = allAlphaOne ? '' : `_${result.refSpanL + 1}`;
    const isComb = result.loadCase === 'udl+uvl';
    const unitSfd = isComb ? ` l${refSuffix}` : ` wl${refSuffix}`;
    const unitBmd = isComb ? ` l${refSuffix}²` : ` wl${refSuffix}²`;

    // Plot each span
    for (let si = 0; si < spans.length; si++) {
        const sp = spans[si];
        const pts = type === 'sfd' ? sp.vPts : sp.mPts;
        const x0 = nx(si);
        const spanPW = nx(si + 1) - nx(si);
        const spanL = alphas[si].fl();

        // Fill
        ctx.beginPath();
        ctx.moveTo(x0, zeroY);
        for (const p of pts) {
            const x = x0 + (p.x / spanL) * spanPW;
            const v = type === 'sfd' ? p.v : p.m;
            const y = type === 'bmd' ? zeroY + v * scale : zeroY - v * scale;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(x0 + spanPW, zeroY);
        ctx.closePath();
        const posCol = type === 'sfd' ? C.sfdPos : C.bmdPos;
        const negCol = type === 'sfd' ? C.sfdNeg : C.bmdNeg;
        ctx.fillStyle = posCol;
        ctx.fill();
        // Overlay negative regions
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x0, zeroY);
        for (const p of pts) {
            const x = x0 + (p.x / spanL) * spanPW;
            const v = type === 'sfd' ? p.v : p.m;
            const y = type === 'bmd' ? zeroY + v * scale : zeroY - v * scale;
            if (v < 0) ctx.lineTo(x, y); else ctx.lineTo(x, zeroY);
        }
        ctx.lineTo(x0 + spanPW, zeroY); ctx.closePath();
        ctx.fillStyle = negCol; ctx.fill();
        ctx.restore();

        // Line
        ctx.strokeStyle = type === 'sfd' ? C.sfdLine : C.bmdLine;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const x = x0 + (p.x / spanL) * spanPW;
            const v = type === 'sfd' ? p.v : p.m;
            const y = type === 'bmd' ? zeroY + v * scale : zeroY - v * scale;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Mark support values
        const textColor = type === 'sfd' ? '#2563eb' : '#059669';
        ctx.font = 'bold 11px "JetBrains Mono"';

        const unit = type === 'sfd' ? unitSfd : unitBmd;

        const valLeft = type === 'sfd' ? sp.VLeft_frac : sp.MLeft_frac;
        const valRight = type === 'sfd' ? sp.VRight_frac : sp.MRight_frac;

        if (!valLeft.isZero() || si === 0) {
            const vL = valLeft.fl(result.w1Val, result.w2Val);
            const yL = type === 'bmd' ? zeroY + vL * scale : zeroY - vL * scale;
            let yOff = yL < zeroY ? -6 : 14;
            if (Math.abs(yL - zeroY) < 1e-5) yOff = -6;
            drawOutlinedText(valLeft.str(true) + unit, x0 + 4, yL + yOff, 'left', textColor);
        }

        const printRight = type === 'sfd' ? (!valRight.isZero() || si === nSpans - 1) : (si === nSpans - 1);
        if (printRight) {
            const vR = valRight.fl(result.w1Val, result.w2Val);
            const yR = type === 'bmd' ? zeroY + vR * scale : zeroY - vR * scale;
            let yOff = yR < zeroY ? -6 : 14;
            if (Math.abs(yR - zeroY) < 1e-5) yOff = -6;
            drawOutlinedText(valRight.str(true) + unit, x0 + spanPW - 4, yR + yOff, 'right', textColor);
        }

        // Mark max moment / zero shear
        if (type === 'sfd' && sp.zeroShearX !== null) {
            const x = x0 + (sp.zeroShearX / spanL) * spanPW;
            ctx.fillStyle = '#e11d48'; ctx.beginPath();
            ctx.arc(x, zeroY, 4, 0, Math.PI * 2); ctx.fill();
        }
        if (type === 'bmd' && sp.maxMx !== null && sp.maxM !== null) {
            const x = x0 + (sp.maxMx / spanL) * spanPW;
            const y = zeroY + sp.maxM * scale;
            ctx.fillStyle = '#ea580c'; ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();

            ctx.font = '10px "JetBrains Mono"';
            let label = '';
            if (sp.maxMExact) {
                label = sp.maxMExact.isText ? sp.maxMExact.str() : sp.maxMExact.str(true) + unitBmd;
            } else if (sp.maxM !== null) {
                label = isComb ? "Depends on w₁/w₂" : toFrac(Math.round(sp.maxM * 1e8) / 1e8).str() + unitBmd;
            }
            drawOutlinedText(label, x, y + (sp.maxM > 0 ? 14 : -10), 'center', '#ea580c');

            if (sp.exactDistFromA_Text) {
                drawOutlinedText('at ' + sp.exactDistFromA_Text + ' from A', x, y + (sp.maxM > 0 ? 26 : -22), 'center', '#fb923c');
            }
        }
    }

    // Y-axis labels
    ctx.fillStyle = C.muted; ctx.font = '10px "JetBrains Mono"'; ctx.textAlign = 'right';
    for (let i = 0; i <= nGrid; i++) {
        const y = pad.t + (i / nGrid) * ph;
        const v = vMax * (1 - 2 * i / nGrid);
        ctx.fillText(v.toFixed(3), pad.l - 8, y + 3);
    }

    // Support labels
    ctx.fillStyle = C.muted; ctx.font = '10px Inter'; ctx.textAlign = 'center';
    for (let i = 0; i <= nSpans; i++) {
        ctx.fillText(result.labels[i], nx(i), h - pad.b + 16);
    }

    // Title label
    ctx.fillStyle = C.dim; ctx.font = '10px Inter'; ctx.textAlign = 'left';
    ctx.fillText(type === 'sfd' ? 'V(x)' : 'M(x)', pad.l - 50, pad.t + 5);
}

export { initCanvas, drawBeamDiagram, drawDiagramPlot, drawFixedSupport, drawFixedSupportRight, drawPinSupport };
