"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { analyzeWall, optimizeWall } from "./wallEngine";
import { drawWallDiagram } from "./wallRender";
import { renderWallDesignTable, renderOptimizationTable } from "./wallHtml";
import { generateWallReport } from "./wallReportGenerator";
import CodeRef from "./CodeRef";
import { exportToJSON, timestampForFilename, copyToClipboard, fmt } from "../lib/exportResults";
import { useToast } from './ToastProvider';
import { logger } from "../lib/logger";

// PERF-01: the optimizer runs in a Web Worker so the main thread stays
// responsive during the up-to-30-second brute-force enumeration.
interface OptProgress {
    done: number;
    total: number;
    feasible: number;
}

export default function BasementWallAnalyzer() {
    const { toast } = useToast();
    const [isTapered, setIsTapered] = useState<boolean>(false);
    const [zones, setZones] = useState([
        { height: 3.0, thickness: 300, thicknessTop: 300, thicknessBot: 300 }
    ]);
    const [nZones, setNZones] = useState(1);
    const [soilParams, setSoilParams] = useState({ phi: 30, gamma_soil: 18, gamma_water: 9.81, waterTableDepth: 3.0, groundLevelDepth: 0.0, surcharge: 10, waterMode: 'dry' });
    const [material, setMaterial] = useState({ grade: 'M25', fck: 25, steelGrade: 'Fe500', fy: 500, cover: 50, E: 27386 });
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
    const lastDrawnResult = useRef<any>(null);
    const rafRef = useRef<number | null>(null);

    // Shared worker factory — extracted to avoid duplicating the onmessage/onerror
    // handler verbatim in both the mount useEffect and handleCancelOptimize.
    const createWorker = useCallback(() => {
        const worker = new Worker(new URL('../workers/wallOptimizer.worker.ts', import.meta.url));
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
                    const newZones = zones.map((z: any, i: number) => isTapered
                        ? { ...z, thicknessTop: msg.result.optimum?.thicknesses[i], thicknessBot: msg.result.optimum?.thicknesses[i + 1] }
                        : { ...z, thickness: msg.result.optimum?.thicknesses[i] });
                    setZones(newZones as any);
                }
            } else if (msg.type === 'error') {
                setOptRunning(false);
                setOptProgress(null);
                setError(msg.error);
                logger.error('Worker error:', msg.error);
            }
        };
        worker.onerror = (e) => {
            setOptRunning(false);
            setOptProgress(null);
            setError('Worker error: ' + e.message);
            logger.error('Worker error:', e);
        };
        return worker;
    }, [zones, isTapered]);

    // PERF-01: create the worker on mount, terminate on unmount.
    useEffect(() => {
        try {
            workerRef.current = createWorker();
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
    }, [createWorker]);

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
                const result = optimizeWall(config as any);
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
            workerRef.current = createWorker();
        } catch (e: any) {
            logger.warn('Could not recreate optimizer worker:', e);
        }
    }, [createWorker]);

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
                            <label htmlFor="wall-nzones" className="extracted-style-1">
                                Number of Zones
                                {/* GUI-001 / CALC-002: clarify that each zone boundary is a lateral support */}
                                <span
                                    data-testid="wall-nzones-info"
                                    title={"Each zone boundary is modelled as a lateral support (floor slab / ground anchor).\nPlace zone boundaries at floor slab levels. For partial submergence, a boundary\nat the water table depth improves load accuracy. Base = fixed; top = pinned."}
                                    aria-label="Each zone boundary is modelled as a lateral support (floor slab / ground anchor). Place zone boundaries at floor slab levels. For partial submergence, a boundary at the water table depth improves load accuracy. Base = fixed; top = pinned."
                                    className="extracted-style-2"
                                >&#9432;</span>
                            </label>
                            <select title="Select option"  id="wall-nzones" value={nZones}
                                onChange={e => handleNZonesChange(e.target.value)}>
                                {[1,2,3,4,5,6].map(n =>
                                    <option key={n} value={n}>{n} Zone{n>1?'s':''}</option>
                                )}
                            </select>
                        </div>
                        
                        <div className="control-group">
                            <label>Wall Geometry</label>
                            <div className="extracted-style-3">
                                <label className="extracted-style-4">
                                    <input title="Input"  type="radio" name="wall-taper" checked={!isTapered} onChange={() => setIsTapered(false)} /> Prismatic
                                </label>
                                <label className="extracted-style-5">
                                    <input title="Input"  type="radio" name="wall-taper" checked={isTapered} onChange={() => setIsTapered(true)} /> Tapered
                                </label>
                            </div>
                        </div>
                        
                        <div className="wall-zones-section">
                            <div className="span-props-title">Zone Geometry</div>
                            <div className="span-props-table extracted-style-6" >
                                {zones.map((z, i) => (
                                    <div key={i} className={`zone-geometry-item ${i < zones.length - 1 ? 'has-border' : ''}`}>
                                        <div className="extracted-style-8">
                                            <span className="span-prop-cell span-prop-label extracted-style-9" >
                                                Zone {i+1}
                                            </span>
                                            <div className="extracted-style-10">
                                                <span className="extracted-style-11">H (m):</span>
                                                <input title="Input" placeholder="Value"  type="number" className="span-prop-input extracted-style-12" 
                                                    value={z.height} min="0.3" step="0.1"
                                                    onChange={e => updateZone(i, 'height', parseFloat(e.target.value) || 1)} />
                                            </div>
                                            {!isTapered ? (
                                                <div className="extracted-style-13">
                                                    <span className="extracted-style-14">Thk (mm):</span>
                                                    <input title="Input" placeholder="Value"  type="number" className="span-prop-input extracted-style-15" 
                                                        value={z.thickness} min="150" step="25"
                                                        onChange={e => updateZone(i, 'thickness', parseInt(e.target.value) || 200)} />
                                                </div>
                                            ) : (
                                                <div className="extracted-style-16">
                                                    <div className="extracted-style-17">
                                                        <span className="extracted-style-18">Top (mm):</span>
                                                        <input title="Input" placeholder="Value"  type="number" className="span-prop-input extracted-style-19" 
                                                            value={z.thicknessTop || z.thickness} min="150" step="25"
                                                            onChange={e => updateZone(i, 'thicknessTop', parseInt(e.target.value) || 200)} />
                                                    </div>
                                                    <div className="extracted-style-20">
                                                        <span className="extracted-style-21">Bot (mm):</span>
                                                        <input title="Input" placeholder="Value"  type="number" className="span-prop-input extracted-style-22" 
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
                            <p className="input-hint extracted-style-23" data-testid="wall-zones-hint" >
                                Zone boundaries = lateral supports (floor slabs). Base is clamped; top is a roller.
                            </p>
                        </div>

                        <div className="wall-section-divider" />

                        <div className="span-props-title">Soil Parameters</div>
                        <div className="control-group">
                            <label>Angle of Internal Friction (°)</label>
                            <input title="Input" placeholder="Value"  type="number" value={soilParams.phi} min="15" max="45" step="1"
                                onChange={e => setSoilParams(p => ({...p, phi: parseFloat(e.target.value)||30}))} />
                        </div>
                        <div className="control-group">
                            <label>Soil Unit Weight (kN/m³)</label>
                            <input title="Input" placeholder="Value"  type="number" value={soilParams.gamma_soil} min="10" max="25" step="0.5"
                                onChange={e => setSoilParams(p => ({...p, gamma_soil: parseFloat(e.target.value)||18}))} />
                        </div>
                        <div className="control-group">
                            <label>Ground Level from Top (m)</label>
                            <input title="Input" placeholder="Value"  type="number" value={soilParams.groundLevelDepth} min="0" max={totalHeight} step="0.5"
                                onChange={e => setSoilParams(p => ({...p, groundLevelDepth: parseFloat(e.target.value)||0}))} />
                        </div>
                        <div className="control-group">
                            <label>Groundwater Condition</label>
                            <select title="Select option"  data-testid="wall-watermode-select" value={soilParams.waterMode || 'submerged'} onChange={e => setSoilParams(p => ({...p, waterMode: e.target.value}))}>
                                <option value="dry">Dry Backfill (No Hydrostatic Pressure)</option>
                                <option value="partial">Partial Water Table</option>
                                <option value="submerged">Fully Submerged (Full Height Hydrostatic)</option>
                            </select>
                        </div>
                        {soilParams.waterMode === 'partial' && (
                            <div className="control-group">
                                <label>Water Table Depth (m from top)</label>
                                <input title="Input" placeholder="Value"  type="number" data-testid="wall-wtd-input" value={soilParams.waterTableDepth} min="0" max={totalHeight} step="0.5"
                                    className={wtdInvalid ? "invalid-input" : ""}
                                    onChange={e => setSoilParams(p => ({...p, waterTableDepth: parseFloat(e.target.value)||0}))} />
                                {wtdInvalid && (
                                    <div className="config-note extracted-style-24" >
                                        Water table must be between 0 and {totalHeight.toFixed(2)} m.
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="control-group">
                            <label>Water Unit Weight γ_w (kN/m³)</label>
                            <input title="Input" placeholder="Value"  type="number" value={soilParams.gamma_water} min="9" max="11" step="0.01"
                                onChange={e => setSoilParams(p => ({...p, gamma_water: parseFloat(e.target.value) || 9.81}))} />
                        </div>
                        <div
                            data-testid="wall-submersion-badge"
                            className={`config-note submersion-badge ${submersionClass}`}
                        >
                            {submersionLabel}
                            {hydroHead > 1e-6 && (
                                <span className="extracted-style-25">
                                    Hydrostatic head: {hydroHead.toFixed(2)} m · u_max ≈ {(soilParams.gamma_water * hydroHead).toFixed(1)} kN/m² (×LF at base)
                                </span>
                            )}
                        </div>
                        <div className="control-group">
                            <label>Surcharge (kN/m²)</label>
                            <input title="Input" placeholder="Value"  type="number" value={soilParams.surcharge} min="0" step="1"
                                onChange={e => setSoilParams(p => ({...p, surcharge: parseFloat(e.target.value)||0}))} />
                        </div>

                        {/* OVERTURNING DATA & HYDROSTATIC STATE */}
                        {currentResult && (
                            <div className="extracted-style-26">
                                <div>
                                    <div className="extracted-style-27">Total Lateral Force (K₀)</div>
                                    <div className="extracted-style-28">{currentResult.totalLateralForce.toFixed(1)} kN/m</div>
                                </div>
                                <div className="extracted-style-29">
                                    <div className="extracted-style-30">Center of Pressure (from base)</div>
                                    <div className="extracted-style-31">{currentResult.centerOfPressure.toFixed(2)} m</div>
                                </div>
                            </div>
                        )}

                        <div className="wall-section-divider" />

                        <div className="span-props-title">Material Properties</div>
                        <div className="control-group">
                            <label>Concrete Grade</label>
                            <select title="Select option"  value={material.grade} onChange={e => handleGradeChange(e.target.value)}>
                                {['M20','M25','M30','M35','M40'].map(g =>
                                    <option key={g} value={g}>{g}</option>
                                )}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Steel Grade</label>
                            <select title="Select option"  value={material.steelGrade} onChange={e => handleSteelChange(e.target.value)}>
                                {['Fe250','Fe415','Fe500','Fe550'].map(g =>
                                    <option key={g} value={g}>{g}</option>
                                )}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Clear Cover (mm)</label>
                            <input title="Input" placeholder="Value"  type="number" value={material.cover} min="20" max="75" step="5"
                                onChange={e => setMaterial(p => ({...p, cover: parseInt(e.target.value)||40}))} />
                        </div>

                        <div className="wall-section-divider" />

                        <div className="span-props-title extracted-style-32" >Load Combination</div>
                        <div className="norm-ref-row extracted-style-33" >
                            {['service', 'ultimate', 'custom'].map(mode => (
                                <button
                                    key={mode}
                                    onClick={() => handleLoadCombChange(mode)}
                                    className={`load-comb-btn ${loadCombMode === mode ? 'active' : ''}`}
                                >
                                    {mode === 'service' ? 'Service (1.0)' : mode === 'ultimate' ? 'Ultimate (1.5)' : 'Custom'}
                                </button>
                            ))}
                        </div>
                        {loadCombMode === 'custom' && (
                            <div className="control-group extracted-style-35" >
                                <label>Load Factor (IS 456)</label>
                                <input title="Input" placeholder="Value"  type="number" value={loadFactor} min="1" max="2" step="0.1"
                                    onChange={e => setLoadFactor(parseFloat(e.target.value)||1.5)} />
                            </div>
                        )}

                        <div className="wall-section-divider" />

                        <div className="span-props-title">Optimization Bounds</div>
                        <div className="norm-ref-row">
                            <div className="control-group">
                                <label>Min t (mm)</label>
                                <input title="Input" placeholder="Value"  type="number" value={optBounds.minThk} min="150" step="25"
                                    onChange={e => setOptBounds(p => ({...p, minThk: parseInt(e.target.value)||200}))} />
                            </div>
                            <div className="control-group">
                                <label>Max t (mm)</label>
                                <input title="Input" placeholder="Value"  type="number" value={optBounds.maxThk} min="200" step="25"
                                    onChange={e => setOptBounds(p => ({...p, maxThk: parseInt(e.target.value)||400}))} />
                            </div>
                        </div>
                        <div className="control-group">
                            <label>Thickness Step (mm)</label>
                            <input title="Input" placeholder="Value"  type="number" value={optBounds.thkStep} min="10" step="10"
                                onChange={e => setOptBounds(p => ({...p, thkStep: parseInt(e.target.value)||50}))} />
                        </div>
                        <button className={`btn-primary opt-run-btn ${optRunning ? 'running' : ''}`} onClick={handleOptimize}
                            disabled={optRunning}>
                            <span className="btn-icon">&#9881;</span> {optRunning ? 'Optimizing…' : 'Run Optimization'}
                        </button>
                        {optRunning && (
                            <button className="btn-secondary extracted-style-37" onClick={handleCancelOptimize}
                                >
                                <span className="btn-icon">&#10005;</span> Cancel
                            </button>
                        )}
                        {optProgress && optProgress.total > 0 && (
                            <div className="extracted-style-38">
                                <div className="extracted-style-39">
                                    {Math.round((optProgress.done / optProgress.total) * 100)}% — {optProgress.done.toLocaleString()} / {optProgress.total.toLocaleString()} combos · {optProgress.feasible} feasible
                                </div>
                                <div className="extracted-style-40">
                                    <div className="opt-progress-bar" ref={el => { if (el) el.style.width = `${(optProgress.done / optProgress.total) * 100}%`; }} />
                                </div>
                            </div>
                        )}
                        {optRunning && (!optProgress || optProgress.total === 0) && (
                            <div className="extracted-style-41">
                                Precomputing pressure mesh…
                            </div>
                        )}
                    </section>
                </aside>

                <main className="content">
                    {error && (
                        <div className="equil-note error extracted-style-42" >
                            Error: {error}
                        </div>
                    )}

                    <section className="panel" id="sec-wall-diagram" >
                        <h2 className="panel-title">
                            <span className="panel-icon">&#9881;</span>Wall Schematic &amp; Pressure Diagram
                        </h2>
                        <div className="canvas-wrapper">
                            <canvas id="wall-canvas"></canvas>
                        </div>
                    </section>

                    <section className="panel" id="sec-wall-design" >
                        <div className="extracted-style-45">
                            <h2 className="panel-title extracted-style-46" >
                                <span className="panel-icon">&#128203;</span>Zone Design — IS 456:2000 (<CodeRef clause="38.1">Cl. 38.1</CodeRef> flexure, <CodeRef clause="40.2">Cl. 40</CodeRef> shear)
                            </h2>
                            <div className="extracted-style-47">
                                <button className="btn-primary extracted-style-48" onClick={handlePreviewReport}
                                    >
                                    <span className="btn-icon">&#128065;</span> Preview PDF
                                </button>
                                <button className="btn-primary extracted-style-49" onClick={handleDownloadReport}
                                    >
                                    <span className="btn-icon">&#128196;</span> Download PDF
                                </button>
                                <button className="btn-primary extracted-style-48" onClick={() => exportToJSON({ zones, soilParams, material, loadFactor, result: currentResult }, `retaining_wall_${timestampForFilename()}`, 'Retaining Wall Design (IS 456:2000)')} title="Export results to JSON file">
                                    <span className="btn-icon">📋</span> Export JSON
                                </button>
                                <button className="btn-primary extracted-style-48" onClick={async () => {
                                    const r = currentResult;
                                    if (!r) { toast('⚠ Run analysis first', { type: 'info' }); return; }
                                    const zoneLines = r.zoneDesigns?.map((z: any) => `  Z${z.zone}: thk=${z.thickness}mm | shear=${z.shear?.status||'—'} | hog=${z.flex_hogging?.utilization?.toFixed(2)||'—'} | sag=${z.flex_sagging?.utilization?.toFixed(2)||'—'}`) || [];
                                    const s = `RETAINING WALL DESIGN SUMMARY (IS 456:2000)
${'='.repeat(50)}
Total Height: ${r.totalHeight?.toFixed(2)}m | Zones: ${r.zoneDesigns?.length ?? 0} | K0=${r.K0?.toFixed(3)}
Total Lateral Force: ${fmt(r.totalLateralForce,1)} kN/m | Governing Zone: ${r.governingZone ?? '—'}
Max Utilization: ${fmt(r.maxUtilization,3)} | Feasible: ${r.feasible ? 'YES' : 'NO'}
Concrete: ${fmt(r.totalConcreteVol,2)} m³/m | Steel: ${fmt(r.totalSteelWeight,0)} kg/m

Zone Details:
${zoneLines.join('\n')}
${'='.repeat(50)}`;
                                    const ok = await copyToClipboard(s);
                                    toast(ok ? '✅ Summary copied to clipboard' : '❌ Copy failed', { type: ok ? 'success' : 'error' });
                                }} title="Copy key results to clipboard">
                                    <span className="btn-icon">📄</span> Copy Summary
                                </button>
                            </div>
                        </div>
                        <div className="table-wrap extracted-style-50" id="wall-design-table" ></div>
                    </section>

                    {/* GUI-004: Validation Summary with REAL structural equilibrium check */}
                    {currentResult && (
                        <section className="panel" id="sec-wall-validation" data-testid="wall-validation">
                            <h2 className="panel-title">
                                <span className="panel-icon">&#9989;</span>Validation Summary
                            </h2>
                            <div className="table-wrap extracted-style-51" >
                                <table className="extracted-style-52">
                                    <thead>
                                        <tr className="extracted-style-53">
                                            <th className="extracted-style-54">Check</th>
                                            <th className="extracted-style-55">Computed</th>
                                            <th className="extracted-style-56">Reference</th>
                                            <th className="extracted-style-57">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {/* Structural equilibrium: ΣReactions vs total applied lateral load */}
                                        {equilibrium && (
                                            <tr data-testid="equilibrium-row" className="extracted-style-58">
                                                <td className="extracted-style-59">Structural Equilibrium</td>
                                                <td className="extracted-style-60">
                                                    &Sigma;R = {equilibrium.sumReactions.toFixed(2)} kN/m
                                                </td>
                                                <td className="extracted-style-61">
                                                    Load = {equilibrium.totalLoad.toFixed(2)} kN/m
                                                </td>
                                                <td className={`status-cell ${equilibrium.ok ? 'pass' : 'fail'}`}>
                                                    {equilibrium.ok ? '\u2713 PASS' : '\u2717 FAIL'}
                                                </td>
                                            </tr>
                                        )}
                                        {/* Design-code shear check (per-zone roll-up, distinct from equilibrium) */}
                                        <tr data-testid="shear-row" className="extracted-style-63">
                                            <td className="extracted-style-64">Shear Capacity (IS 456 <CodeRef clause="40.2">Cl. 40</CodeRef>)</td>
                                            <td className="extracted-style-65">
                                                max util = {(currentResult.maxUtilization ?? 0).toFixed(3)}
                                            </td>
                                            <td className="extracted-style-66">&le; 1.000</td>
                                            <td className={`status-cell ${currentResult.feasible ? 'pass' : 'fail'}`}>
                                                {currentResult.feasible ? '\u2713 PASS' : '\u2717 FAIL'}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                                <p className="config-note extracted-style-68" >
                                    Equilibrium compares the summed support reactions (&Sigma;(V<sub>L</sub>&minus;V<sub>R</sub>) from the
                                    beam analysis) against the independently-integrated applied lateral load — a true static check,
                                    not a code pass/fail flag.
                                </p>
                            </div>
                        </section>
                    )}

                    <section className="panel" id="sec-wall-opt" >
                        <h2 className="panel-title extracted-style-70" >
                            <span><span className="panel-icon">&#128200;</span>Thickness Optimization</span>
                            {/* CALC-005: optimal vs approximate badge mirrors the table badge */}
                            {optResult && (
                                optResult.approximate ? (
                                    <span
                                        data-testid="opt-badge-approx"
                                        title="Combination count exceeded the full-enumeration limit. Result shown is the best found by sequential greedy search and may not be globally optimal."
                                        className="extracted-style-71"
                                    >
                                        &#9888; Approximate
                                    </span>
                                ) : (
                                    <span
                                        data-testid="opt-badge-optimal"
                                        title="Full enumeration completed — every thickness combination was evaluated, so this result is the global optimum."
                                        className="extracted-style-72"
                                    >
                                        &#10003; Optimal
                                    </span>
                                )
                            )}
                        </h2>
                        <div className="table-wrap" id="wall-opt-table">
                            <div className="extracted-style-73">
                                <div className="extracted-style-74">💡</div>
                                <h3 className="extracted-style-75">Optimization Not Run</h3>
                                <p className="config-note extracted-style-76" >Click &quot;Run Optimization&quot; to search for the most efficient thickness distribution.</p>
                            </div>
                        </div>
                    </section>

                    {/* PDF Preview Modal */}
                    {pdfPreviewUrl && (
                        <div className="pdf-preview-overlay" onClick={() => setPdfPreviewUrl(null)}>
                            <div className="pdf-preview-modal" onClick={e => e.stopPropagation()}>
                                <div className="pdf-preview-header">
                                    <h3>PDF Report Preview</h3>
                                    <div className="extracted-style-77">
                                        <button className="btn-primary extracted-style-78" onClick={handleDownloadReport}
                                            >
                                            &#128196; Download
                                        </button>
                                        <button onClick={() => setPdfPreviewUrl(null)}
                                            className="extracted-style-79">
                                            ✕ Close
                                        </button>
                                    </div>
                                </div>
                                <iframe
                                    src={pdfPreviewUrl}
                                    className="extracted-style-80"
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
