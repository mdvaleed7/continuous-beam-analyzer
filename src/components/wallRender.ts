/**
 * wallRender.ts — Canvas rendering for the basement wall designer.
 *
 * Split from wallEngine.ts (ARCH-01): the original 1,690-line file mixed the
 * mathematical solver, IS 456 design, optimizer, canvas drawing, and HTML
 * table rendering into a single module. This file holds only the canvas
 * drawing routine (`drawWallDiagram`).
 *
 * Dependencies on wallEngine.ts: `WallAnalysisResult`, `ProfileNode` types.
 */

import type { WallAnalysisResult, ProfileNode } from './wallEngine';

// ───────────────────── Wall Canvas Drawing ─────────────────────

const WC = {
    wall: '#475569', wallFill: 'rgba(71,85,105,0.12)',
    soil: '#92602b', soilFill: 'rgba(146,96,43,0.08)',
    water: '#2563eb', waterFill: 'rgba(37,99,235,0.06)',
    pressure: '#e11d48', pressureFill: 'rgba(225,29,72,0.08)',
    support: '#7c3aed', dim: '#94a3b8', text: '#1e293b',
    muted: '#64748b', zone: 'rgba(37,99,235,0.06)',
    zoneBorder: 'rgba(37,99,235,0.2)',
    sfd: '#2563eb',
    bmd: '#ea580c',
};

export function drawWallDiagram(canvas: HTMLCanvasElement | null, wallResult: WallAnalysisResult): void {
    if (!canvas || !canvas.parentElement) return;
    const dpr = window.devicePixelRatio || 1;
    const totalW = Math.max(canvas.parentElement.clientWidth, 950);
    const totalH = 500;
    canvas.style.width = totalW + 'px';
    canvas.style.height = totalH + 'px';
    canvas.width = totalW * dpr;
    canvas.height = totalH * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, totalW, totalH);

    const { zoneDesigns, totalHeight, cumDepths, zonePressures, config } = wallResult;
    const nZones = zoneDesigns.length;
    const pad = { l: 120, r: 160, t: 40, b: 40 };
    const drawH = totalH - pad.t - pad.b;
    const drawW = totalW - pad.l - pad.r;

    // Scale: y maps depth, x maps wall thickness
    const isTapered = config.isTapered || false;
    let maxThk = 0;
    if (isTapered) {
        maxThk = Math.max(...config.zones.flatMap(z => [z.thicknessTop || z.thickness, z.thicknessBot || z.thickness]));
    } else {
        maxThk = Math.max(...config.zones.map(z => z.thickness));
    }
    const wallDrawW = Math.min(60, drawW * 0.1);
    const wallX = pad.l + drawW * 0.25;
    const yScale = drawH / totalHeight;
    const depthToY = (d: number): number => pad.t + d * yScale;

    // Draw soil fill (left of wall)
    ctx.fillStyle = WC.soilFill;
    ctx.fillRect(pad.l - 20, pad.t, wallX - pad.l + 20, drawH);

    // Draw wall zones
    for (let i = 0; i < nZones; i++) {
        const y1 = depthToY(cumDepths[i]);
        const y2 = depthToY(cumDepths[i + 1]);
        const zCfg = config.zones[i];
        
        const tTop = isTapered ? (zCfg.thicknessTop || zCfg.thickness) : zCfg.thickness;
        const tBot = isTapered ? (zCfg.thicknessBot || zCfg.thickness) : zCfg.thickness;
        
        const wTop = (tTop / maxThk) * wallDrawW;
        const wBot = (tBot / maxThk) * wallDrawW;
        
        const xL_top = wallX - wTop / 2;
        const xR_top = wallX + wTop / 2;
        const xL_bot = wallX - wBot / 2;
        const xR_bot = wallX + wBot / 2;

        ctx.beginPath();
        ctx.moveTo(xL_top, y1);
        ctx.lineTo(xR_top, y1);
        ctx.lineTo(xR_bot, y2);
        ctx.lineTo(xL_bot, y2);
        ctx.closePath();

        // Zone fill
        ctx.fillStyle = i % 2 === 0 ? 'rgba(71,85,105,0.12)' : 'rgba(71,85,105,0.08)';
        ctx.fill();

        // Zone border
        ctx.strokeStyle = WC.wall;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Thickness label
        ctx.fillStyle = WC.text;
        ctx.font = 'bold 11px "JetBrains Mono"';
        ctx.textAlign = 'center';
        if (isTapered && tTop !== tBot) {
            ctx.fillText(`${tTop}`, wallX, y1 + 10);
            ctx.fillText(`${tBot}`, wallX, y2 - 4);
        } else {
            ctx.fillText(`${tTop}mm`, wallX, (y1 + y2) / 2 + 4);
        }

        // Zone height dimension on right
        ctx.fillStyle = WC.muted;
        ctx.font = '10px "JetBrains Mono"';
        ctx.textAlign = 'left';
        const dimX = wallX + wallDrawW / 2 + 15;
        ctx.fillText(`${zoneDesigns[i].height}m`, dimX, (y1 + y2) / 2 + 4);

        // Zone label
        ctx.fillStyle = WC.dim;
        ctx.font = '10px Inter';
        ctx.textAlign = 'right';
        ctx.fillText(`Zone ${i + 1}`, wallX - wallDrawW / 2 - 10, (y1 + y2) / 2 + 4);
    }

    // ── Lateral pressure diagram (left side) ─────────────────────────────────
    // Uses the full analysis-node profile so the slope kink at the water table
    // is drawn correctly (instead of a straight line through the kink).
    const profile = (wallResult.pressureProfile && wallResult.pressureProfile.length > 1)
        ? wallResult.pressureProfile
        : ([
            { depth: 0, ...zonePressures[0].top },
            { depth: totalHeight, ...zonePressures[nZones - 1].bottom },
          ] as ProfileNode[]);
    const maxP = Math.max(...profile.map(p => p.combined), 0.01);
    const pressDrawW = drawW * 0.25;
    const pressBaseX = wallX - wallDrawW / 2 - 10;
    const pToX = (p: number): number => pressBaseX - (p / maxP) * pressDrawW;

    // Combined pressure polygon (earth + water + surcharge)
    ctx.beginPath();
    ctx.moveTo(pressBaseX, depthToY(profile[0].depth));
    for (const pt of profile) ctx.lineTo(pToX(pt.combined), depthToY(pt.depth));
    ctx.lineTo(pressBaseX, depthToY(profile[profile.length - 1].depth));
    ctx.closePath();
    ctx.fillStyle = WC.pressureFill;
    ctx.fill();
    ctx.strokeStyle = WC.pressure;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Hydrostatic (water) pressure component — drawn as a distinct blue overlay
    const hasWater = profile.some(p => (p.waterP || 0) > 1e-6);
    if (hasWater) {
        ctx.beginPath();
        ctx.moveTo(pressBaseX, depthToY(profile[0].depth));
        for (const pt of profile) ctx.lineTo(pToX(pt.waterP || 0), depthToY(pt.depth));
        ctx.lineTo(pressBaseX, depthToY(profile[profile.length - 1].depth));
        ctx.closePath();
        ctx.fillStyle = WC.waterFill;
        ctx.fill();
        ctx.strokeStyle = WC.water;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Pressure arrows (sampled uniformly, interpolating the kinked profile)
    const interpP = (depth: number): number => {
        for (let k = 0; k < profile.length - 1; k++) {
            const a = profile[k], bb = profile[k + 1];
            if (depth >= a.depth - 1e-9 && depth <= bb.depth + 1e-9) {
                const t = bb.depth > a.depth ? (depth - a.depth) / (bb.depth - a.depth) : 0;
                return a.combined + t * (bb.combined - a.combined);
            }
        }
        return profile[profile.length - 1].combined;
    };
    const nArrTotal = 16;
    for (let j = 0; j <= nArrTotal; j++) {
        const depth = (j / nArrTotal) * totalHeight;
        const y = depthToY(depth);
        const pw = ((interpP(depth)) / maxP) * pressDrawW;
        if (pw < 3) continue;
        ctx.strokeStyle = WC.pressure;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pressBaseX - pw, y);
        ctx.lineTo(pressBaseX - 4, y);
        ctx.stroke();
        ctx.fillStyle = WC.pressure;
        ctx.beginPath();
        ctx.moveTo(pressBaseX - 2, y);
        ctx.lineTo(pressBaseX - 8, y - 3);
        ctx.lineTo(pressBaseX - 8, y + 3);
        ctx.fill();
    }

    // Water-table marker line + hydrostatic head annotation
    const wtDepth = wallResult.waterTableDepth;
    if (wtDepth !== null && wtDepth !== undefined && wtDepth < totalHeight - 1e-6) {
        const wtY = depthToY(wtDepth);
        ctx.strokeStyle = WC.water;
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pressBaseX - pressDrawW - 10, wtY);
        ctx.lineTo(wallX + wallDrawW / 2 + 10, wtY);
        ctx.stroke();
        ctx.setLineDash([]);
        // Inverted-triangle water-table symbol
        ctx.fillStyle = WC.water;
        ctx.beginPath();
        ctx.moveTo(pressBaseX - pressDrawW - 16, wtY - 6);
        ctx.lineTo(pressBaseX - pressDrawW - 8, wtY - 6);
        ctx.lineTo(pressBaseX - pressDrawW - 12, wtY);
        ctx.closePath();
        ctx.fill();
        ctx.font = 'bold 9px "JetBrains Mono"';
        ctx.textAlign = 'left';
        ctx.fillText(`W.T. ${wtDepth.toFixed(2)}m`, pressBaseX - pressDrawW - 10, wtY - 9);
    }

    // Submersion-state badge (top-right, clear of the chart titles)
    const stateMap: Record<string, string> = { dry: 'DRY · NO HYDROSTATIC', partial: 'PARTIALLY SUBMERGED', fully: 'FULLY SUBMERGED' };
    const stateColor: Record<string, string> = { dry: WC.muted, partial: WC.water, fully: WC.water };
    const st = wallResult.submersionState || 'dry';
    ctx.fillStyle = stateColor[st] || WC.muted;
    ctx.font = 'bold 10px "JetBrains Mono"';
    ctx.textAlign = 'right';
    ctx.fillText(stateMap[st] || st, totalW - 10, pad.t - 8);

    // Pressure value labels (top & bottom)
    ctx.font = '9px "JetBrains Mono"';
    ctx.fillStyle = WC.pressure;
    ctx.textAlign = 'right';
    const gldDraw = (wallResult.config?.soilParams?.groundLevelDepth as number) || 0;
    const topLoadPoints = profile.filter(p => Math.abs(p.depth - gldDraw) < 1e-6);
    const topLoadP = topLoadPoints.length > 0 ? topLoadPoints[topLoadPoints.length - 1] : profile[0];
    ctx.fillText(`${topLoadP.combined.toFixed(1)} kN/m²`, pressBaseX - pressDrawW - 5, depthToY(gldDraw) + 12);
    ctx.fillText(`${profile[profile.length - 1].combined.toFixed(1)} kN/m²`, pressBaseX - pressDrawW - 5, depthToY(totalHeight) - 4);
    if (hasWater) {
        const wBot = profile[profile.length - 1].waterP || 0;
        ctx.fillStyle = WC.water;
        ctx.textAlign = 'left';
        ctx.fillText(`u=${wBot.toFixed(1)} kN/m²`, pToX(wBot) + 4, depthToY(totalHeight) - 4);
    }

    // Draw supports
    // Top and intermediate supports (Rollers)
    for (let i = 0; i < nZones; i++) {
        const supportY = depthToY(cumDepths[i]);
        ctx.strokeStyle = WC.support;
        ctx.fillStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        
        // Roller circle
        ctx.beginPath();
        ctx.arc(wallX + wallDrawW/2 + 8, supportY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // Vertical restraint line
        ctx.beginPath();
        ctx.moveTo(wallX + wallDrawW/2 + 14, supportY - 12);
        ctx.lineTo(wallX + wallDrawW/2 + 14, supportY + 12);
        ctx.stroke();
        
        // Hatching for roller restraint
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 0.8;
        for (let k = -2; k <= 2; k++) {
            const hy = supportY + k * 4;
            ctx.beginPath();
            ctx.moveTo(wallX + wallDrawW/2 + 14, hy);
            ctx.lineTo(wallX + wallDrawW/2 + 18, hy + 4);
            ctx.stroke();
        }
    }

    // Bottom support (fixed)
    const botY = depthToY(totalHeight);
    // Fixed support hatching
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(wallX - 25, botY, 50, 12);
    ctx.strokeStyle = WC.support;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wallX - 25, botY);
    ctx.lineTo(wallX + 25, botY);
    ctx.stroke();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 0.8;
    for (let k = 0; k < 8; k++) {
        const hx = wallX - 22 + k * 6;
        ctx.beginPath();
        ctx.moveTo(hx, botY);
        ctx.lineTo(hx - 4, botY + 8);
        ctx.stroke();
    }

    // Title
    ctx.fillStyle = WC.dim;
    ctx.font = '11px Inter';
    ctx.textAlign = 'left';
    ctx.fillText('Lateral Pressure', pad.l - 10, pad.t - 10);
    ctx.textAlign = 'center';
    ctx.fillText('Wall Section', wallX, pad.t - 10);

    // Elevation labels on right (starting from 0 at bottom)
    ctx.fillStyle = WC.muted;
    ctx.font = '10px "JetBrains Mono"';
    ctx.textAlign = 'left';
    const rightX = wallX + wallDrawW / 2 + 15;
    for (let i = 0; i <= nZones; i++) {
        const elevation = totalHeight - cumDepths[i];
        ctx.fillText(`+${elevation.toFixed(1)}m`, rightX, depthToY(cumDepths[i]) + 4);
    }

    // ── SFD and BMD ────────────────────────────────────────────────────────
    const sfdX = pad.l + drawW * 0.58;
    const bmdX = pad.l + drawW * 0.86;
    const chartW = drawW * 0.20;
    const Lscale = wallResult.beamResult.spanLengths[0].fl();
    const spans = wallResult.beamResult.spans;

    let maxAbsM = 0;
    let maxAbsV = 0;
    spans.forEach((sp: any) => {
        maxAbsM = Math.max(maxAbsM, Math.abs(sp.MLeft * Lscale * Lscale), Math.abs(sp.MRight * Lscale * Lscale));
        maxAbsV = Math.max(maxAbsV, Math.abs(sp.VLeft * Lscale), Math.abs(sp.VRight * Lscale));
        if (sp.maxM !== null) maxAbsM = Math.max(maxAbsM, Math.abs(sp.maxM * Lscale * Lscale));
        for(let i=0; i<=10; i++){
            const x = (i/10)*sp.alpha.fl();
            maxAbsM = Math.max(maxAbsM, Math.abs(sp.M(x) * Lscale * Lscale));
            maxAbsV = Math.max(maxAbsV, Math.abs(sp.V(x) * Lscale));
        }
    });

    const drawCurve = (
        centerX: number,
        maxVal: number,
        unit: string,
        getValueFn: (sp: any, x: number) => number,
        label: string,
    ): void => {
        // Center line
        ctx.strokeStyle = WC.muted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, depthToY(0));
        ctx.lineTo(centerX, depthToY(totalHeight));
        ctx.stroke();

        if (maxVal === 0) return;
        const scaleX = (chartW / 2) / maxVal;

        // 1. Draw the entire curve path
        ctx.strokeStyle = label === 'SFD' ? WC.sfd : WC.bmd; 
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        
        let currentY = depthToY(0);
        let first = true;

        spans.forEach((sp: any, i: number) => {
            const spanL = sp.alpha.fl() * Lscale;
            const spanH = spanL * yScale;
            const steps = 20;
            
            for (let step = 0; step <= steps; step++) {
                const normX = (step / steps) * sp.alpha.fl();
                const val = getValueFn(sp, normX);
                const px = centerX + val * scaleX;
                const py = currentY + (step / steps) * spanH;
                if (first) { ctx.moveTo(px, py); first = false; }
                else { ctx.lineTo(px, py); }
            }
            currentY += spanH;
        });
        ctx.stroke();

        // 2. Draw Annotations
        currentY = depthToY(0);
        spans.forEach((sp: any, i: number) => {
            const spanL = sp.alpha.fl() * Lscale;
            const spanH = spanL * yScale;
            
            // Draw support values (Hogging/Shear at supports)
            ctx.fillStyle = label === 'SFD' ? WC.sfd : WC.bmd; 
            ctx.font = '9px "JetBrains Mono"';
            
            const isTopSupport = wallResult.supportMask[i];
            const isBotSupport = wallResult.supportMask[i + 1];

            if (isTopSupport) {
                const valLeft = getValueFn(sp, 0);
                const pxL = centerX + valLeft * scaleX;
                ctx.textAlign = valLeft >= 0 ? 'left' : 'right';
                let yOff = 3;
                if (i > 0 && label === 'SFD') yOff = 10;
                ctx.fillText(valLeft.toFixed(2), pxL + (valLeft >= 0 ? 3 : -3), currentY + yOff);
            }

            if (isBotSupport) {
                if (label === 'SFD' || i === spans.length - 1) {
                    const valRight = getValueFn(sp, sp.alpha.fl());
                    const pxR = centerX + valRight * scaleX;
                    ctx.textAlign = valRight >= 0 ? 'left' : 'right';
                    let yOff = 3;
                    if (i < spans.length - 1 && label === 'SFD') yOff = -4;
                    ctx.fillText(valRight.toFixed(2), pxR + (valRight >= 0 ? 3 : -3), currentY + spanH + yOff);
                }
            }

            // Draw max sagging moments
            if (label === 'BMD' && sp.maxM !== null) {
                const x0 = sp.zeroShearX;
                if (x0 > 0 && x0 < sp.alpha.fl()) {
                    const mMax = sp.maxM * Lscale * Lscale;
                    const py = currentY + (x0 / sp.alpha.fl()) * spanH;
                    const px = centerX + mMax * scaleX;
                    ctx.fillStyle = WC.bmd; // Highlight sagging
                    ctx.textAlign = mMax >= 0 ? 'left' : 'right';
                    ctx.fillText(mMax.toFixed(2), px + (mMax >= 0 ? 3 : -3), py + 3);
                    
                    ctx.beginPath();
                    ctx.arc(px, py, 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            currentY += spanH;
        });

        // Title
        ctx.fillStyle = WC.dim;
        ctx.font = '11px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(label, centerX, pad.t - 22);
        ctx.font = '9px Inter';
        ctx.fillText(`(Max ${maxVal.toFixed(1)} ${unit})`, centerX, pad.t - 10);
    };

    drawCurve(sfdX, maxAbsV, 'kN', (sp, x) => sp.V(x) * Lscale, 'SFD');
    drawCurve(bmdX, maxAbsM, 'kN·m', (sp, x) => sp.M(x) * Lscale * Lscale, 'BMD');
}


