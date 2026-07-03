import type { RetainingWallResult } from './retainingWallEngine';

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

export function drawRetainingWallDiagram(canvas: HTMLCanvasElement | null, r: RetainingWallResult): void {
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

    const pad = { l: 80, r: 80, t: 40, b: 60 };
    const drawH = totalH - pad.t - pad.b;
    const drawW = totalW - pad.l - pad.r;

    const H_m = r.H / 1000;
    const H_stem_m = r.H_stem / 1000;
    const H_soil_m = r.H_soil / 1000;
    const B_m = r.B / 1000;
    const B_toe_m = r.B_toe / 1000;
    const B_heel_m = r.B_heel / 1000;
    const D_base_m = r.D_base / 1000;
    const D_stem_base_m = r.D_stem_base / 1000;
    const D_stem_top_m = r.D_stem_top / 1000;

    const yScale = drawH / H_m;
    // Scale X so the base takes up about 30% of the drawing width
    const xScale = (drawW * 0.3) / Math.max(B_m, 1);

    const depthToY = (d: number) => pad.t + d * yScale;
    const wallX = pad.l + drawW * 0.25; // Stem front face

    const toeFrontX = wallX - B_toe_m * xScale;
    const stemBackBaseX = wallX + D_stem_base_m * xScale;
    const stemBackTopX = wallX + D_stem_top_m * xScale;
    const heelBackX = stemBackBaseX + B_heel_m * xScale;

    const topY = depthToY(0);
    const baseTopY = depthToY(H_stem_m);
    const baseBotY = depthToY(H_m);
    const soilTopY = depthToY(H_m - H_soil_m);
    const wtY = r.waterTableDepth > 0 ? soilTopY + (r.waterTableDepth / 1000) * yScale : Infinity;

    // ─── 1. Soil Fill & Water ───
    ctx.fillStyle = WC.soilFill;
    ctx.fillRect(stemBackTopX, soilTopY, heelBackX - stemBackTopX + 30, baseBotY - soilTopY);
    
    if (wtY < baseBotY) {
        ctx.fillStyle = WC.waterFill;
        ctx.fillRect(stemBackTopX, wtY, heelBackX - stemBackTopX + 30, baseBotY - wtY);
        // WT line
        ctx.strokeStyle = WC.water;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(stemBackTopX, wtY);
        ctx.lineTo(heelBackX + 20, wtY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = WC.water;
        ctx.font = '10px "JetBrains Mono"';
        ctx.textAlign = 'left';
        ctx.fillText('WT', heelBackX + 25, wtY + 4);
    }

    // ─── 2. Wall Geometry ───
    ctx.fillStyle = WC.wallFill;
    ctx.strokeStyle = WC.wall;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wallX, topY); // stem front top
    ctx.lineTo(stemBackTopX, topY); // stem back top
    ctx.lineTo(stemBackBaseX, baseTopY); // stem back base
    ctx.lineTo(heelBackX, baseTopY); // heel back top
    ctx.lineTo(heelBackX, baseBotY); // heel back bot
    ctx.lineTo(toeFrontX, baseBotY); // toe front bot
    ctx.lineTo(toeFrontX, baseTopY); // toe front top
    ctx.lineTo(wallX, baseTopY); // stem front base
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Surcharge
    if (r.q_surcharge > 0) {
        ctx.fillStyle = WC.pressureFill;
        ctx.fillRect(stemBackTopX, soilTopY - 15, heelBackX - stemBackTopX + 30, 15);
        ctx.fillStyle = WC.pressure;
        ctx.font = '10px "JetBrains Mono"';
        ctx.textAlign = 'center';
        ctx.fillText(`q = ${r.q_surcharge} kN/m²`, stemBackTopX + (heelBackX - stemBackTopX)/2, soilTopY - 20);
    }

    // ─── 3. Bearing Pressure (Bottom) ───
    const pressScale = (drawH * 0.15) / Math.max(r.p_max, 1);
    const pToeY = baseBotY + r.p_toe * pressScale;
    const pHeelY = baseBotY + r.p_heel * pressScale;
    
    ctx.fillStyle = WC.pressureFill;
    ctx.beginPath();
    ctx.moveTo(toeFrontX, baseBotY);
    ctx.lineTo(heelBackX, baseBotY);
    ctx.lineTo(heelBackX, pHeelY);
    ctx.lineTo(toeFrontX, pToeY);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = WC.pressure;
    ctx.beginPath();
    ctx.moveTo(heelBackX, pHeelY);
    ctx.lineTo(toeFrontX, pToeY);
    ctx.stroke();
    
    ctx.fillStyle = WC.pressure;
    ctx.textAlign = 'center';
    ctx.fillText(`${r.p_toe.toFixed(0)}`, toeFrontX, pToeY + 15);
    ctx.fillText(`${r.p_heel.toFixed(0)}`, heelBackX, pHeelY + 15);
    ctx.font = '11px Inter';
    ctx.fillStyle = WC.dim;
    ctx.fillText(`Bearing Pressure`, wallX, pToeY + 30);

    // ─── 4. SFD and BMD (Stem Only) ───
    const sfdX = pad.l + drawW * 0.65;
    const bmdX = pad.l + drawW * 0.85;
    const chartW = drawW * 0.15;

    let maxV = 0, maxM = 0;
    r.forcePoints.forEach(pt => {
        maxV = Math.max(maxV, Math.abs(pt.V));
        maxM = Math.max(maxM, Math.abs(pt.M));
    });

    const drawCurve = (centerX: number, maxVal: number, unit: string, key: 'V' | 'M', label: string) => {
        ctx.strokeStyle = WC.muted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, topY);
        ctx.lineTo(centerX, baseTopY);
        ctx.stroke();

        if (maxVal === 0) return;
        const scale = (chartW / 2) / maxVal;

        ctx.strokeStyle = label === 'SFD' ? WC.sfd : WC.bmd;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        
        r.forcePoints.forEach((pt, i) => {
            const px = centerX + pt[key] * scale;
            const py = depthToY(pt.y);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.stroke();

        // Label max at bottom
        const maxPt = r.forcePoints[r.forcePoints.length - 1];
        const px = centerX + maxPt[key] * scale;
        ctx.fillStyle = label === 'SFD' ? WC.sfd : WC.bmd;
        ctx.font = '9px "JetBrains Mono"';
        ctx.textAlign = maxPt[key] >= 0 ? 'left' : 'right';
        ctx.fillText(maxPt[key].toFixed(1), px + (maxPt[key] >= 0 ? 3 : -3), baseTopY + 12);

        // Title
        ctx.fillStyle = WC.dim;
        ctx.font = '11px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(label, centerX, pad.t - 22);
        ctx.font = '9px Inter';
        ctx.fillText(`(Max ${maxVal.toFixed(1)} ${unit})`, centerX, pad.t - 10);
    };

    drawCurve(sfdX, maxV, 'kN', 'V', 'SFD');
    drawCurve(bmdX, maxM, 'kN·m', 'M', 'BMD');

    // ─── 5. Dimensions ───
    ctx.fillStyle = WC.text;
    ctx.font = '10px Inter';
    ctx.textAlign = 'right';
    // H
    ctx.fillText(`${r.H}mm`, toeFrontX - 10, depthToY(H_m / 2));
    // D_base
    ctx.fillText(`${r.D_base}mm`, toeFrontX - 10, depthToY(H_stem_m + D_base_m / 2) + 4);
}
