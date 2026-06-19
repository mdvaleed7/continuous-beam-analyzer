"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { analyzeWall } from "./wallEngine";
import { drawWallDiagram } from "./wallRender";
import { renderWallDesignTable, renderOptimizationTable } from "./wallHtml";
import { generateWallReport } from "./wallReportGenerator";
import { logger } from "../lib/logger";

// PERF-01: the optimizer runs in a Web Worker so the main thread stays
// responsive during the up-to-30-second brute-force enumeration.
interface OptProgress {
    done: number;
    total: number;
    feasible: number;
}

export default function WallAnalyzer() {
    const [isTapered, setIsTapered] = useState<boolean>(false);
    const [zones, setZones] = useState([
        { height: 1.5, thickness: 300, thicknessTop: 300, thicknessBot: 300 },
        { height: 1.5, thickness: 250, thicknessTop: 250, thicknessBot: 250 },
    ]);
    const [nZones, setNZones] = useState(2);
    const [soilParams, setSoilParams] = useState({ phi: 30, gamma_soil: 18, gamma_water: 9.81, waterTableDepth: 2.0, groundLevelDepth: 0.0, surcharge: 10, waterMode: 'partial' });
    const [material, setMaterial] = useState({ grade: 'M30', fck: 30, steelGrade: 'Fe500', fy: 500, cover: 50, E: 27386 });
    const [loadFactor, setLoadFactor] = useState(1.5);
    const [loadCombMode, setLoadCombMode] = useState('ultimate'); // 'service' | 'ultimate' | 'custom'
    const [optBounds, setOptBounds] = useState({ minThk: 200, maxThk: 400, thkStep: 50 });
    const [optResult, setOptResult] = useState<any>(null);
    const [currentResult, setCurrentResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
    // PERF-01: optimization progress + worker state
    const [optProgress, setOptProgress] = useState<OptProgress | null>(null);
    const [optRunning, setOptRunning] = useState(false);
    const workerRef = useRef<Worker | null>(null);
    const initialized = useRef(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // PERF-002: guards so the canvas / design table are only re-rendered when the
    // analysis RESULT actually changes — never on incidental re-renders (e.g. PDF
    // modal open/close, optBounds typing, hover state). We keep the reference of
    // the last-drawn result and coalesce draws into a single requestAnimationFrame.
    const lastDrawnResult = useRef<any>(null);
    const rafRef = useRef<number | null>(null);

    // PERF-01: create the worker on mount, terminate on unmount.
    useEffect(() => {
        try {
            const worker = new Worker(
                new URL('../workers/wallOptimizer.worker.ts', import.meta.url)
            );
            worker.onmessage = (e: MessageEvent) => {
                const msg = e.data;
                if (msg.type === 'progress') {
                    setOptProgress({ done: msg.done, total: msg.total, feasible: msg.feasible });
                } else if (msg.type === 'done') {
                    setOptRunning(false);
                    setOptProgress(null);
                    setOptResult(msg.result);
                    const optContainer = document.getElementById('wall-opt-table');
                    if (optContainer) renderOptimizationTable(optContainer, msg.result);
                    // If optimum found, update zones to show it
                    if (msg.result.optimum) {
                        const newZones = zones.map((z: any, i: number) => {
                            if (isTapered) {
                                return {
                                    ...z,
                                    thicknessTop: msg.result.optimum?.thicknesses[i],
                                    thicknessBot: msg.result.optimum?.thicknesses[i + 1],
                                };
                            } else {
                                return {
                                    ...z,
                                    thickness: msg.result.optimum?.thicknesses[i],
                                };
                            }
                        });
                        setZones(newZones as any);
                    }
                } else if (msg.type === 'error') {
                    setOptRunning(false);
                    setOptProgress(null);
                    setError(msg.error);
                    logger.error('Worker optimization error:', msg.error);
                }
            };
            worker.onerror = (e) => {
                setOptRunning(false);
                setOptProgress(null);
                setError('Worker error: ' + e.message);
                logger.error('Worker error:', e);
            };
            workerRef.current = worker;
        } catch (e: any) {
            logger.warn('Could not create optimizer worker, falling back to sync:', e);
            workerRef.current = null;
        }
        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
            }
        };
    }, [zones, isTapered]);

    // Load combination presets
    const handleLoadCombChange = useCallback((mode: string) => {
        setLoadCombMode(mode);
        if (mode === 'service') setLoadFactor(1.0);
        else if (mode === 'ultimate') setLoadFactor(1.5);
        // 'custom' keeps current value
    }, []);

    // Update zones array when nZones changes. Originally implemented as a
    // useEffect that called setZones synchronously — that triggered ESLint's
    // react-hooks/set-state-in-effect rule (and the rule is right: cascading
    // renders). The handler below is invoked directly from the onChange of
    // the nZones <select>, so state updates happen in the event-handler phase
    // (where setState is allowed) rather than during the effect phase.
    const handleNZonesChange = useCallback((newN: string | number) => {
        const n = parseInt(String(newN), 10);
        setNZones(n);
        setZones(prev => {
            const totalH = prev.reduce((s, z) => s + z.height, 0) || 3;
            const zoneH = Math.round((totalH / n) * 100) / 100;
            const newZones = [];
            for (let i = 0; i < n; i++) {
                const prevZ = i < prev.length ? prev[i] : null;
                newZones.push({
                    height: prevZ ? prevZ.height : zoneH,
                    thickness: prevZ ? prevZ.thickness : 250,
                    thicknessTop: prevZ ? (prevZ.thicknessTop || prevZ.thickness) : 250,
                    thicknessBot: prevZ ? (prevZ.thicknessBot || prevZ.thickness) : 250,
                });
            }
            return newZones;
        });
    }, []);

    // Update fck and E when grade changes
    const handleGradeChange = useCallback((grade: string) => {
        const fckMap = { M20: 20, M25: 25, M30: 30, M35: 35, M40: 40 };
        const fck = fckMap[grade as keyof typeof fckMap] || 25;
        const E = Math.round(5000 * Math.sqrt(fck));
        setMaterial(prev => ({ ...prev, grade, fck, E }));
    }, []);

    const handleSteelChange = useCallback((steelGrade: string) => {
        const fyMap = { Fe250: 250, Fe415: 415, Fe500: 500, Fe550: 550 };
        const fy = fyMap[steelGrade as keyof typeof fyMap] || 415;
        setMaterial(prev => ({ ...prev, steelGrade, fy }));
    }, []);

    // Run analysis whenever inputs change (debounced)
    const runAnalysis = useCallback(() => {
        setError(null);
        setOptResult(null);
        let result = null;
        try {
            const config = {
                zones, soilParams, material, loadFactor, isTapered,
                barDias: [8, 10, 12, 16, 20, 25],
                spacings: [100, 125, 150, 175, 200, 250, 300],
            };
            result = analyzeWall(config as any);
            // PERF-002: the canvas/table draw is no longer done here. We only update
            // state; a dedicated useEffect keyed on `currentResult` performs the draw,
            // so rendering happens once per *result change* and never on unrelated
            // re-renders.
            setCurrentResult(result);

        } catch (e: any) {
            logger.error('Wall analysis error:', e);
            setError(e.message);
        }
    }, [zones, soilParams, material, loadFactor, isTapered]);

    // PERF-002: draw the wall diagram + design table ONLY when the analysis result
    // reference changes. Guard against redundant redraws (same result object) and
    // coalesce into a single animation frame.
    useEffect(() => {
        if (!currentResult) return;
        if (lastDrawnResult.current === currentResult) return; // already drawn
        if (rafRef.current) cancelAnimationFrame(rafRef.current);

        const draw = () => {
            try {
                const wallCanvas = document.getElementById('wall-canvas') as HTMLCanvasElement;
                if (wallCanvas) drawWallDiagram(wallCanvas, currentResult);

                const designTable = document.getElementById('wall-design-table');
                if (designTable) renderWallDesignTable(designTable, currentResult);

                ['sec-wall-diagram', 'sec-wall-design', 'sec-wall-opt'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = '';
                });
                lastDrawnResult.current = currentResult;
            } catch (drawError) {
                logger.error("Wall Visualization Error:", drawError);
            }
        };

        if (typeof requestAnimationFrame === 'function') {
            rafRef.current = requestAnimationFrame(draw);
        } else {
            draw();
        }
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [currentResult]);

    // Debounced run on input changes
    useEffect(() => {
        if (!initialized.current) {
            initialized.current = true;
            setTimeout(runAnalysis, 100);
        } else {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(runAnalysis, 150);
        }
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [runAnalysis]);

    // Optimization handler — PERF-01: runs in a Web Worker when available,
    // falls back to synchronous call when workers are not supported.
    const handleOptimize = useCallback(() => {
        setError(null);
        const config = {
            zones, soilParams, material, loadFactor, isTapered,
            barDias: [8, 10, 12, 16, 20, 25],
            spacings: [100, 125, 150, 175, 200, 250, 300],
            minThk: optBounds.minThk,
            maxThk: optBounds.maxThk,
            thkStep: optBounds.thkStep,
        };

        if (workerRef.current) {
            // Worker path — non-blocking, with progress
            setOptRunning(true);
            setOptProgress({ done: 0, total: 0, feasible: 0 });
            workerRef.current.postMessage({ type: 'optimize', config });
        } else {
            // Fallback synchronous path (very old browsers)
            try {
                const { optimizeWall } = require('./wallEngine');
                const result = optimizeWall(config);
                setOptResult(result);
                const optContainer = document.getElementById('wall-opt-table');
                if (optContainer) renderOptimizationTable(optContainer, result);
                if (result.optimum) {
                    const newZones = zones.map((z: any, i: number) => {
                        if (isTapered) {
                            return { ...z, thicknessTop: result.optimum?.thicknesses[i], thicknessBot: result.optimum?.thicknesses[i + 1] };
                        } else {
                            return { ...z, thickness: result.optimum?.thicknesses[i] };
                        }
                    });
                    setZones(newZones as any);
                }
            } catch (e: any) {
                logger.error('Optimization error:', e);
                setError(e.message);
            }
        }
    }, [zones, soilParams, material, loadFactor, optBounds, isTapered]);

    // PERF-01: cancel an in-progress optimization by terminating the worker.
    // The worker is recreated on the next optimize click.
    const handleCancelOptimize = useCallback(() => {
        if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
        }
        setOptRunning(false);
        setOptProgress(null);
        // Recreate the worker for the next run
        try {
            const worker = new Worker(
                new URL('../workers/wallOptimizer.worker.ts', import.meta.url)
            );
            worker.onmessage = (e: MessageEvent) => {
                const msg = e.data;
                if (msg.type === 'progress') {
                    setOptProgress({ done: msg.done, total: msg.total, feasible: msg.feasible });
                } else if (msg.type === 'done') {
                    setOptRunning(false);
                    setOptProgress(null);
                    setOptResult(msg.result);
                    const optContainer = document.getElementById('wall-opt-table');
                    if (optContainer) renderOptimizationTable(optContainer, msg.result);
                    if (msg.result.optimum) {
                        const newZones = zones.map((z: any, i: number) => {
                            if (isTapered) {
                                return { ...z, thicknessTop: msg.result.optimum?.thicknesses[i], thicknessBot: msg.result.optimum?.thicknesses[i + 1] };
                            } else {
                                return { ...z, thickness: msg.result.optimum?.thicknesses[i] };
                            }
                        });
                        setZones(newZones as any);
                    }
                } else if (msg.type === 'error') {
                    setOptRunning(false);
                    setOptProgress(null);
                    setError(msg.error);
                }
            };
            worker.onerror = (e) => {
                setOptRunning(false);
                setOptProgress(null);
                setError('Worker error: ' + e.message);
            };
            workerRef.current = worker;
        } catch (e: any) {
            logger.warn('Could not recreate optimizer worker:', e);
        }
    }, [zones, isTapered]);

    // PDF preview handler
    const handlePreviewReport = useCallback(async () => {
        if (!currentResult) {
            alert('Please run the analysis first (set valid inputs) before generating a report.');
            return;
        }
        try {
            const config = {
                zones, soilParams, material, loadFactor, isTapered
            };
            const canvas = document.getElementById('wall-canvas') as HTMLCanvasElement;
            const blobUrl = await generateWallReport(config, currentResult, canvas, true); // preview mode
            if (blobUrl) setPdfPreviewUrl(blobUrl as string);
        } catch (e: any) {
            logger.error('Preview report error:', e);
            alert('Failed to generate report preview: ' + (e?.message || e));
        }
    }, [currentResult, zones, soilParams, material, loadFactor, isTapered]);

    const handleDownloadReport = useCallback(async () => {
        if (!currentResult) {
            alert('Please run the analysis first (set valid inputs) before generating a report.');
            return;
        }
        try {
            const config = {
                zones, soilParams, material, loadFactor, isTapered
            };
            const canvas = document.getElementById('wall-canvas') as HTMLCanvasElement;
            await generateWallReport(config, currentResult, canvas, false); // download mode
        } catch (e: any) {
            logger.error('Download report error:', e);
            alert('Failed to generate report for download: ' + (e?.message || e));
        }
    }, [currentResult, zones, soilParams, material, loadFactor, isTapered]);

    const updateZone = (idx: number, field: string, value: any): void => {
        setZones(prev => prev.map((z, i) => i === idx ? { ...z, [field]: value } : z));
    };

    const totalHeight = zones.reduce((s, z) => s + z.height, 0);

    // ── Hydrostatic state derived from inputs (for clear GUI feedback) ────────
    const waterMode = soilParams.waterMode || 'submerged';
    let submersionLabel, submersionClass, hydroHead;
    if (waterMode === 'dry') {
        submersionLabel = 'DRY — no hydrostatic pressure';
        submersionClass = 'dry';
        hydroHead = 0;
    } else if (waterMode === 'submerged') {
        submersionLabel = 'FULLY SUBMERGED — hydrostatic over full height';
        submersionClass = 'fully';
        hydroHead = totalHeight;
    } else {
        const clamped = Math.max(0, Math.min(soilParams.waterTableDepth, totalHeight));
        hydroHead = Math.max(0, totalHeight - clamped);
        if (hydroHead <= 1e-6) { submersionLabel = 'DRY — water table at/below base'; submersionClass = 'dry'; }
        else if (clamped <= 1e-6) { submersionLabel = 'FULLY SUBMERGED — water table at top'; submersionClass = 'fully'; }
        else { submersionLabel = `PARTIALLY SUBMERGED — W.T. at ${clamped.toFixed(2)} m`; submersionClass = 'partial'; }
    }
    const wtdInvalid = waterMode === 'partial' && (soilParams.waterTableDepth < 0 || soilParams.waterTableDepth > totalHeight + 1e-6);

    // ── GUI-004: REAL structural-equilibrium check from the actual analysis ───────
    // ΣReactions must balance the total applied lateral load. We reconstruct the
    // support reactions from the engine's PHYSICAL zone shears (V_left at the top
    // of each zone, V_right at the bottom — both in kN/m, already ×LF), rather than
    // from the beam solver's NORMALIZED reaction fractions (which carry the unit-load
    // scaling and per-span L_ref and therefore do not directly sum to the physical
    // load). For a statically-admissible solution the sum of all support reactions
    // equals Σ(V_left − V_right) over every zone, which in turn equals the engine's
    // independently-computed totalLateralForce. Comparing those two INDEPENDENT
    // quantities is a genuine equilibrium test — NOT a design-code pass/fail flag.
    // PERF-001: memoise on currentResult so the reduce only re-runs when a NEW
    // analysis result arrives — not on every unrelated re-render (pdfPreviewUrl,
    // error, optResult, typing into optimization-bound fields, etc.).
    const equilibrium = useMemo(() => {
        if (!currentResult || !Array.isArray(currentResult.zoneDesigns) || !currentResult.zoneDesigns.length) {
            return null;
        }
        const zd = currentResult.zoneDesigns;
        // Sum of support reactions = top reaction + internal jumps + base reaction
        //   = Σ over zones of (V_left − V_right)  (telescopes to the same value)
        let sumReactions = 0;
        for (const z of zd) {
            const vL = Number(z.V_left) || 0;
            const vR = Number(z.V_right) || 0;
            sumReactions += vL - vR;
        }
        const totalLoad = Number(currentResult.totalLateralForce) || 0;
        const residual = Math.abs(sumReactions - totalLoad);
        // Relative tolerance (0.1 kN/m absolute floor) — robust across LF and scale.
        const tol = Math.max(0.1, 1e-4 * Math.abs(totalLoad));
        return {
            sumReactions,
            totalLoad,
            residual,
            ok: residual <= tol,
        };
    }, [currentResult]);

    return (
        <div className="container">
            <header className="header">
                <h1>Basement Wall Designer</h1>
                <p className="subtitle">Zone-by-Zone IS 456:2000 Design &amp; Optimization</p>
            </header>

            <div className="layout">
                <aside className="sidebar">
                    <section className="panel">
                        <h2 className="panel-title">
                            <span className="panel-icon">&#9881;</span>Wall Configuration
                        </h2>

                        <div className="control-group">
                            <label htmlFor="wall-nzones" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                Number of Zones
                                {/* GUI-001 / CALC-002: clarify that each zone boundary is a lateral support */}
                                <span
                                    data-testid="wall-nzones-info"
                                    title={"Each zone boundary is modelled as a lateral support (floor slab / ground anchor).\nPlace zone boundaries at floor slab levels. For partial submergence, a boundary\nat the water table depth improves load accuracy. Base = fixed; top = pinned."}
                                    aria-label="Each zone boundary is modelled as a lateral support (floor slab / ground anchor). Place zone boundaries at floor slab levels. For partial submergence, a boundary at the water table depth improves load accuracy. Base = fixed; top = pinned."
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                        width: '16px', height: '16px', borderRadius: '50%',
                                        border: '1px solid var(--border-bright, rgba(255,255,255,0.25))',
                                        color: 'var(--accent3, #4cc9f0)', fontSize: '11px', fontWeight: 700,
                                        cursor: 'help', lineHeight: 1,
                                    }}
                                >&#9432;</span>
                            </label>
                            <select id="wall-nzones" value={nZones}
                                onChange={e => handleNZonesChange(e.target.value)}>
                                {[1,2,3,4,5,6].map(n =>
                                    <option key={n} value={n}>{n} Zone{n>1?'s':''}</option>
                                )}
                            </select>
                        </div>
                        
                        <div className="control-group">
                            <label>Wall Geometry</label>
                            <div style={{display: 'flex', gap: '15px', marginTop: '5px'}}>
                                <label style={{display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '13px'}}>
                                    <input type="radio" name="wall-taper" checked={!isTapered} onChange={() => setIsTapered(false)} /> Prismatic
                                </label>
                                <label style={{display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '13px'}}>
                                    <input type="radio" name="wall-taper" checked={isTapered} onChange={() => setIsTapered(true)} /> Tapered
                                </label>
                            </div>
                        </div>
                        
                        <div className="wall-zones-section">
                            <div className="span-props-title">Zone Geometry</div>
                            <div className="span-props-table" style={{ display: 'flex', flexDirection: 'column' }}>
                                {zones.map((z, i) => (
                                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 0', borderBottom: i < zones.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                            <span className="span-prop-cell span-prop-label" style={{ flex: '0 0 75px', fontSize: '13px' }}>
                                                Zone {i+1}
                                            </span>
                                            <div style={{ display: 'flex', flex: 1, gap: '6px', alignItems: 'center' }}>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>H (m):</span>
                                                <input type="number" className="span-prop-input" style={{ flex: 1, padding: '6px 4px', minWidth: '60px' }}
                                                    value={z.height} min="0.3" step="0.1"
                                                    onChange={e => updateZone(i, 'height', parseFloat(e.target.value) || 1)} />
                                            </div>
                                            {!isTapered ? (
                                                <div style={{ display: 'flex', flex: 1, gap: '6px', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Thk (mm):</span>
                                                    <input type="number" className="span-prop-input" style={{ flex: 1, padding: '6px 4px', minWidth: '60px' }}
                                                        value={z.thickness} min="150" step="25"
                                                        onChange={e => updateZone(i, 'thickness', parseInt(e.target.value) || 200)} />
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1.5, gap: '6px' }}>
                                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', width: '45px' }}>Top (mm):</span>
                                                        <input type="number" className="span-prop-input" style={{ flex: 1, padding: '6px 4px', minWidth: '60px' }}
                                                            value={z.thicknessTop || z.thickness} min="150" step="25"
                                                            onChange={e => updateZone(i, 'thicknessTop', parseInt(e.target.value) || 200)} />
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', width: '45px' }}>Bot (mm):</span>
                                                        <input type="number" className="span-prop-input" style={{ flex: 1, padding: '6px 4px', minWidth: '60px' }}
                                                            value={z.thicknessBot || z.thickness} min="150" step="25"
                                                            onChange={e => updateZone(i, 'thicknessBot', parseInt(e.target.value) || 200)} />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="config-note">
                                Total wall height: {totalHeight.toFixed(2)} m
                            </div>
                            {/* GUI-001 / CALC-002: explain the zone-boundary = lateral-support model */}
                            <p className="input-hint" data-testid="wall-zones-hint" style={{ marginTop: '6px', fontSize: '11px', lineHeight: 1.5, color: 'var(--text-muted, #8b9bb4)' }}>
                                Zone boundaries = lateral supports (floor slabs). Base is clamped; top is a roller.
                            </p>
                        </div>

                        <div className="wall-section-divider" />

                        <div className="span-props-title">Soil Parameters</div>
                        <div className="control-group">
                            <label>Angle of Internal Friction (°)</label>
                            <input type="number" value={soilParams.phi} min="15" max="45" step="1"
                                onChange={e => setSoilParams(p => ({...p, phi: parseFloat(e.target.value)||30}))} />
                        </div>
                        <div className="control-group">
                            <label>Soil Unit Weight (kN/m³)</label>
                            <input type="number" value={soilParams.gamma_soil} min="10" max="25" step="0.5"
                                onChange={e => setSoilParams(p => ({...p, gamma_soil: parseFloat(e.target.value)||18}))} />
                        </div>
                        <div className="control-group">
                            <label>Ground Level from Top (m)</label>
                            <input type="number" value={soilParams.groundLevelDepth} min="0" max={totalHeight} step="0.5"
                                onChange={e => setSoilParams(p => ({...p, groundLevelDepth: parseFloat(e.target.value)||0}))} />
                        </div>
                        <div className="control-group">
                            <label>Groundwater Condition</label>
                            <select data-testid="wall-watermode-select" value={soilParams.waterMode || 'submerged'} onChange={e => setSoilParams(p => ({...p, waterMode: e.target.value}))}>
                                <option value="dry">Dry Backfill (No Hydrostatic Pressure)</option>
                                <option value="partial">Partial Water Table</option>
                                <option value="submerged">Fully Submerged (Full Height Hydrostatic)</option>
                            </select>
                        </div>
                        {soilParams.waterMode === 'partial' && (
                            <div className="control-group">
                                <label>Water Table Depth (m from top)</label>
                                <input type="number" data-testid="wall-wtd-input" value={soilParams.waterTableDepth} min="0" max={totalHeight} step="0.5"
                                    style={wtdInvalid ? { borderColor: 'var(--negative, #ff5470)' } : undefined}
                                    onChange={e => setSoilParams(p => ({...p, waterTableDepth: parseFloat(e.target.value)||0}))} />
                                {wtdInvalid && (
                                    <div className="config-note" style={{ color: 'var(--negative, #ff5470)' }}>
                                        Water table must be between 0 and {totalHeight.toFixed(2)} m.
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="control-group">
                            <label>Water Unit Weight γ_w (kN/m³)</label>
                            <input type="number" value={soilParams.gamma_water} min="9" max="11" step="0.01"
                                onChange={e => setSoilParams(p => ({...p, gamma_water: parseFloat(e.target.value) || 9.81}))} />
                        </div>
                        <div
                            data-testid="wall-submersion-badge"
                            className="config-note"
                            style={{
                                marginTop: '4px',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                borderLeft: `3px solid ${submersionClass === 'dry' ? '#6a7a9f' : '#4a90ff'}`,
                                background: submersionClass === 'dry' ? 'rgba(106,122,159,0.10)' : 'rgba(74,144,255,0.10)',
                                color: submersionClass === 'dry' ? 'var(--text-muted, #6a7a9f)' : '#7fb0ff',
                                fontWeight: 600,
                            }}
                        >
                            {submersionLabel}
                            {hydroHead > 1e-6 && (
                                <span style={{ display: 'block', fontWeight: 400, marginTop: '2px', color: 'var(--text-muted, #8a96b5)' }}>
                                    Hydrostatic head: {hydroHead.toFixed(2)} m · u_max ≈ {(soilParams.gamma_water * hydroHead).toFixed(1)} kN/m² (×LF at base)
                                </span>
                            )}
                        </div>
                        <div className="control-group">
                            <label>Surcharge (kN/m²)</label>
                            <input type="number" value={soilParams.surcharge} min="0" step="1"
                                onChange={e => setSoilParams(p => ({...p, surcharge: parseFloat(e.target.value)||0}))} />
                        </div>

                        {/* OVERTURNING DATA & HYDROSTATIC STATE */}
                        {currentResult && (
                            <div style={{marginTop: '16px', background: 'rgba(74, 144, 255, 0.05)', padding: '12px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(74, 144, 255, 0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                <div>
                                    <div style={{fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px'}}>Total Lateral Force (K₀)</div>
                                    <div style={{fontWeight: 'bold', color: 'var(--text)'}}>{currentResult.totalLateralForce.toFixed(1)} kN/m</div>
                                </div>
                                <div style={{textAlign: 'right'}}>
                                    <div style={{fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px'}}>Center of Pressure (from base)</div>
                                    <div style={{fontWeight: 'bold', color: 'var(--text)'}}>{currentResult.centerOfPressure.toFixed(2)} m</div>
                                </div>
                            </div>
                        )}

                        <div className="wall-section-divider" />

                        <div className="span-props-title">Material Properties</div>
                        <div className="control-group">
                            <label>Concrete Grade</label>
                            <select value={material.grade} onChange={e => handleGradeChange(e.target.value)}>
                                {['M20','M25','M30','M35','M40'].map(g =>
                                    <option key={g} value={g}>{g}</option>
                                )}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Steel Grade</label>
                            <select value={material.steelGrade} onChange={e => handleSteelChange(e.target.value)}>
                                {['Fe250','Fe415','Fe500','Fe550'].map(g =>
                                    <option key={g} value={g}>{g}</option>
                                )}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Clear Cover (mm)</label>
                            <input type="number" value={material.cover} min="20" max="75" step="5"
                                onChange={e => setMaterial(p => ({...p, cover: parseInt(e.target.value)||40}))} />
                        </div>

                        <div className="wall-section-divider" />

                        <div className="span-props-title" style={{ marginTop: '14px' }}>Load Combination</div>
                        <div className="norm-ref-row" style={{ gap: '8px', marginTop: '0' }}>
                            {['service', 'ultimate', 'custom'].map(mode => (
                                <button
                                    key={mode}
                                    onClick={() => handleLoadCombChange(mode)}
                                    className={loadCombMode === mode ? 'btn-primary' : ''}
                                    style={{
                                        padding: '6px 12px',
                                        fontSize: '0.78rem',
                                        fontWeight: 600,
                                        borderRadius: '6px',
                                        border: loadCombMode === mode ? 'none' : '1px solid var(--border)',
                                        background: loadCombMode === mode ? 'linear-gradient(135deg, #4a90ff 0%, #3570d4 100%)' : 'var(--bg-input)',
                                        color: loadCombMode === mode ? '#fff' : 'var(--text-muted)',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        boxShadow: loadCombMode === mode ? '0 2px 10px rgba(74,144,255,0.25)' : 'none',
                                        textTransform: 'capitalize',
                                    }}
                                >
                                    {mode === 'service' ? 'Service (1.0)' : mode === 'ultimate' ? 'Ultimate (1.5)' : 'Custom'}
                                </button>
                            ))}
                        </div>
                        {loadCombMode === 'custom' && (
                            <div className="control-group" style={{ marginTop: '8px' }}>
                                <label>Load Factor (IS 456)</label>
                                <input type="number" value={loadFactor} min="1" max="2" step="0.1"
                                    onChange={e => setLoadFactor(parseFloat(e.target.value)||1.5)} />
                            </div>
                        )}

                        <div className="wall-section-divider" />

                        <div className="span-props-title">Optimization Bounds</div>
                        <div className="norm-ref-row">
                            <div className="control-group">
                                <label>Min t (mm)</label>
                                <input type="number" value={optBounds.minThk} min="150" step="25"
                                    onChange={e => setOptBounds(p => ({...p, minThk: parseInt(e.target.value)||200}))} />
                            </div>
                            <div className="control-group">
                                <label>Max t (mm)</label>
                                <input type="number" value={optBounds.maxThk} min="200" step="25"
                                    onChange={e => setOptBounds(p => ({...p, maxThk: parseInt(e.target.value)||400}))} />
                            </div>
                        </div>
                        <div className="control-group">
                            <label>Thickness Step (mm)</label>
                            <input type="number" value={optBounds.thkStep} min="10" step="10"
                                onChange={e => setOptBounds(p => ({...p, thkStep: parseInt(e.target.value)||50}))} />
                        </div>
                        <button className="btn-primary" onClick={handleOptimize}
                            disabled={optRunning}
                            style={{width:'100%', justifyContent:'center', marginTop:'8px', opacity: optRunning ? 0.6 : 1}}>
                            <span className="btn-icon">&#9881;</span> {optRunning ? 'Optimizing…' : 'Run Optimization'}
                        </button>
                        {optRunning && (
                            <button className="btn-secondary" onClick={handleCancelOptimize}
                                style={{width:'100%', justifyContent:'center', marginTop:'6px'}}>
                                <span className="btn-icon">&#10005;</span> Cancel
                            </button>
                        )}
                        {optProgress && optProgress.total > 0 && (
                            <div style={{marginTop: '8px'}}>
                                <div style={{fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px'}}>
                                    {Math.round((optProgress.done / optProgress.total) * 100)}% — {optProgress.done.toLocaleString()} / {optProgress.total.toLocaleString()} combos · {optProgress.feasible} feasible
                                </div>
                                <div style={{width: '100%', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden'}}>
                                    <div style={{
                                        width: `${(optProgress.done / optProgress.total) * 100}%`,
                                        height: '100%',
                                        background: 'var(--accent)',
                                        transition: 'width 0.2s ease',
                                    }} />
                                </div>
                            </div>
                        )}
                        {optRunning && (!optProgress || optProgress.total === 0) && (
                            <div style={{marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)'}}>
                                Precomputing pressure mesh…
                            </div>
                        )}
                    </section>
                </aside>

                <main className="content">
                    {error && (
                        <div className="equil-note error" style={{marginBottom:'16px'}}>
                            Error: {error}
                        </div>
                    )}

                    <section className="panel" id="sec-wall-diagram" style={{display:'none'}}>
                        <h2 className="panel-title">
                            <span className="panel-icon">&#9881;</span>Wall Schematic &amp; Pressure Diagram
                        </h2>
                        <div className="canvas-wrapper">
                            <canvas id="wall-canvas"></canvas>
                        </div>
                    </section>

                    <section className="panel" id="sec-wall-design" style={{display:'none'}}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <h2 className="panel-title" style={{ margin: 0 }}>
                                <span className="panel-icon">&#128203;</span>Zone Design — IS 456:2000
                            </h2>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button className="btn-primary" onClick={handlePreviewReport}
                                    style={{ padding: '10px 20px', fontSize: '0.85rem' }}>
                                    <span className="btn-icon">&#128065;</span> Preview PDF
                                </button>
                                <button className="btn-primary" onClick={handleDownloadReport}
                                    style={{ padding: '10px 20px', fontSize: '0.85rem', background: 'linear-gradient(135deg, #00e5a0 0%, #00b87a 100%)' }}>
                                    <span className="btn-icon">&#128196;</span> Download PDF
                                </button>
                            </div>
                        </div>
                        <div className="table-wrap" id="wall-design-table" style={{ marginTop: '16px' }}></div>
                    </section>

                    {/* GUI-004: Validation Summary with REAL structural equilibrium check */}
                    {currentResult && (
                        <section className="panel" id="sec-wall-validation" data-testid="wall-validation">
                            <h2 className="panel-title">
                                <span className="panel-icon">&#9989;</span>Validation Summary
                            </h2>
                            <div className="table-wrap" style={{ marginTop: '12px' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                            <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)' }}>Check</th>
                                            <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)' }}>Computed</th>
                                            <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)' }}>Reference</th>
                                            <th style={{ textAlign: 'center', padding: '8px 10px', color: 'var(--text-muted)' }}>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {/* Structural equilibrium: ΣReactions vs total applied lateral load */}
                                        {equilibrium && (
                                            <tr data-testid="equilibrium-row" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                                <td style={{ padding: '8px 10px', fontWeight: 600 }}>Structural Equilibrium</td>
                                                <td style={{ padding: '8px 10px', fontFamily: 'var(--mono, monospace)' }}>
                                                    &Sigma;R = {equilibrium.sumReactions.toFixed(2)} kN/m
                                                </td>
                                                <td style={{ padding: '8px 10px', fontFamily: 'var(--mono, monospace)' }}>
                                                    Load = {equilibrium.totalLoad.toFixed(2)} kN/m
                                                </td>
                                                <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: equilibrium.ok ? 'var(--positive, #00f5d4)' : 'var(--negative, #f72585)' }}>
                                                    {equilibrium.ok ? '\u2713 PASS' : '\u2717 FAIL'}
                                                </td>
                                            </tr>
                                        )}
                                        {/* Design-code shear check (per-zone roll-up, distinct from equilibrium) */}
                                        <tr data-testid="shear-row" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                            <td style={{ padding: '8px 10px', fontWeight: 600 }}>Shear Capacity (IS 456)</td>
                                            <td style={{ padding: '8px 10px', fontFamily: 'var(--mono, monospace)' }}>
                                                max util = {(currentResult.maxUtilization ?? 0).toFixed(3)}
                                            </td>
                                            <td style={{ padding: '8px 10px', fontFamily: 'var(--mono, monospace)' }}>&le; 1.000</td>
                                            <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: currentResult.feasible ? 'var(--positive, #00f5d4)' : 'var(--negative, #f72585)' }}>
                                                {currentResult.feasible ? '\u2713 PASS' : '\u2717 FAIL'}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                                <p className="config-note" style={{ marginTop: '8px', fontSize: '11px' }}>
                                    Equilibrium compares the summed support reactions (&Sigma;(V<sub>L</sub>&minus;V<sub>R</sub>) from the
                                    beam analysis) against the independently-integrated applied lateral load — a true static check,
                                    not a code pass/fail flag.
                                </p>
                            </div>
                        </section>
                    )}

                    <section className="panel" id="sec-wall-opt" style={{display:'none'}}>
                        <h2 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <span><span className="panel-icon">&#128200;</span>Thickness Optimization</span>
                            {/* CALC-005: optimal vs approximate badge mirrors the table badge */}
                            {optResult && (
                                optResult.approximate ? (
                                    <span
                                        data-testid="opt-badge-approx"
                                        title="Combination count exceeded the full-enumeration limit. Result shown is the best found by sequential greedy search and may not be globally optimal."
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: '999px', fontSize: '0.74rem', fontWeight: 700, background: 'rgba(255,176,32,0.14)', color: '#ffb020', border: '1px solid rgba(255,176,32,0.45)', cursor: 'help' }}
                                    >
                                        &#9888; Approximate
                                    </span>
                                ) : (
                                    <span
                                        data-testid="opt-badge-optimal"
                                        title="Full enumeration completed — every thickness combination was evaluated, so this result is the global optimum."
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: '999px', fontSize: '0.74rem', fontWeight: 700, background: 'rgba(0,229,160,0.14)', color: '#00e5a0', border: '1px solid rgba(0,229,160,0.45)', cursor: 'help' }}
                                    >
                                        &#10003; Optimal
                                    </span>
                                )
                            )}
                        </h2>
                        <div className="table-wrap" id="wall-opt-table">
                            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', background: 'rgba(10, 16, 38, 0.3)', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border)' }}>
                                <div style={{ fontSize: '2rem', marginBottom: '12px', opacity: 0.6 }}>💡</div>
                                <h3 style={{ fontSize: '1rem', color: 'var(--text)', marginBottom: '8px' }}>Optimization Not Run</h3>
                                <p className="config-note" style={{ margin: 0 }}>Click &quot;Run Optimization&quot; to search for the most efficient thickness distribution.</p>
                            </div>
                        </div>
                    </section>

                    {/* PDF Preview Modal */}
                    {pdfPreviewUrl && (
                        <div className="pdf-preview-overlay" onClick={() => setPdfPreviewUrl(null)}>
                            <div className="pdf-preview-modal" onClick={e => e.stopPropagation()}>
                                <div className="pdf-preview-header">
                                    <h3>PDF Report Preview</h3>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button className="btn-primary" onClick={handleDownloadReport}
                                            style={{ padding: '8px 18px', fontSize: '0.82rem', background: 'linear-gradient(135deg, #00e5a0 0%, #00b87a 100%)' }}>
                                            &#128196; Download
                                        </button>
                                        <button onClick={() => setPdfPreviewUrl(null)}
                                            style={{
                                                padding: '8px 18px', fontSize: '0.82rem', fontWeight: 600,
                                                border: '1px solid var(--border)', borderRadius: '6px',
                                                background: 'var(--bg-input)', color: 'var(--text-muted)',
                                                cursor: 'pointer',
                                            }}>
                                            ✕ Close
                                        </button>
                                    </div>
                                </div>
                                <iframe
                                    src={pdfPreviewUrl}
                                    style={{ width: '100%', height: 'calc(100% - 60px)', border: 'none', borderRadius: '0 0 12px 12px' }}
                                    title="PDF Preview"
                                />
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
