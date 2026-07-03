 
"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { analyzeFooting, analyzeFootings, FOOTING_TYPES, type FootingConfig, type FootingAnalysisResult, type LoadCase } from "./footingEngine";
import { generateFootingReport } from "./footingReportGenerator";
import CodeRef from "./CodeRef";
import { exportToJSON, timestampForFilename, copyToClipboard, fmt } from "../lib/exportResults";
import { useToast } from './ToastProvider';
import { logger } from "../lib/logger";

const DEFAULT_LOAD_CASES: LoadCase[] = [
    { label: 'LC1: DL+LL',  Fy: 1000, Mx: 0,    Mz: 0, sbc: 150 },
    { label: 'LC2: DL+LL+WX', Fy: 900,  Mx: 1500, Mz: 0, sbc: 185 },
    { label: 'LC3: DL+LL+WZ', Fy: 900,  Mx: 0,    Mz: 1500, sbc: 185 },
];

const DEFAULT_FOOTING: FootingConfig = {
    label: 'F1',
    footingType: 'flat',
    col_a: 500,
    col_b: 500,
    loadCases: DEFAULT_LOAD_CASES,
    Fy: 1000,
    Mx: 0,
    Mz: 0,
    sbc: 150,
    depthFill: 1.0,
    gammaFill: 18,
    gammaConcrete: 25,
    fck: 25,
    fy: 500,
    grade: 'M25',
    steelGrade: 'Fe500',
    cover: 50,
    barDiaX: 16,
    barDiaZ: 16,
    L: 2.5,
    B: 2.5,
    D: 0.5,
    pedestalOffset: 0,
    pedestal_a: 0,
    pedestal_b: 0,
    D1: 300,
};

export default function FootingAnalyzer() {
    const { toast } = useToast();
    const [footings, setFootings] = useState<FootingConfig[]>([{ ...DEFAULT_FOOTING, loadCases: DEFAULT_LOAD_CASES.map(lc => ({ ...lc })) }]);
    const [activeFooting, setActiveFooting] = useState(0);
    const [results, setResults] = useState<FootingAnalysisResult[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optProgress, setOptProgress] = useState({ done: 0, total: 0, feasible: 0 });
    
    const progressRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (progressRef.current && optProgress.total > 0) {
            progressRef.current.style.width = `${(optProgress.done / optProgress.total) * 100}%`;
            progressRef.current.style.transition = 'width 0.2s';
        } else if (progressRef.current) {
            progressRef.current.style.width = '0%';
        }
    }, [optProgress]);
    const [minL, setMinL] = useState(1.0);
    const [maxL, setMaxL] = useState(4.0);
    const [stepL, setStepL] = useState(0.1);
    
    const [minB, setMinB] = useState(1.0);
    const [maxB, setMaxB] = useState(4.0);
    const [stepB, setStepB] = useState(0.1);
    
    const [minD, setMinD] = useState(0.3);
    const [maxD, setMaxD] = useState(1.0);
    const [stepD, setStepD] = useState(0.05);

    const workerRef = React.useRef<Worker | null>(null);

    const [sharedMaterial, setSharedMaterial] = useState({
        grade: 'M25', fck: 25, steelGrade: 'Fe500', fy: 500, cover: 50,
        gammaFill: 18, gammaConcrete: 25,
        depthFill: 1.0,
    });

    const handleGradeChange = useCallback((grade: string) => {
        const fckMap: Record<string, number> = { M20: 20, M25: 25, M30: 30, M35: 35, M40: 40 };
        const fck = fckMap[grade] || 25;
        setSharedMaterial(prev => ({ ...prev, grade, fck }));
    }, []);

    const handleSteelChange = useCallback((steelGrade: string) => {
        const fyMap: Record<string, number> = { Fe250: 250, Fe415: 415, Fe500: 500, Fe550: 550 };
        const fy = fyMap[steelGrade] || 500;
        setSharedMaterial(prev => ({ ...prev, steelGrade, fy }));
    }, []);

    const updateFooting = useCallback((idx: number, field: string, value: any) => {
        setFootings(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], [field]: value };
            return next;
        });
    }, []);

    const addFooting = useCallback(() => {
        setFootings(prev => {
            const n = prev.length;
            return [...prev, { ...DEFAULT_FOOTING, label: `F${n + 1}` }];
        });
    }, []);

    const removeFooting = useCallback((idx: number) => {
        setFootings(prev => {
            if (prev.length <= 1) return prev;
            return prev.filter((_, i) => i !== idx).map((f, i) => ({ ...f, label: f.label || `F${i + 1}` }));
        });
        setActiveFooting(prev => Math.min(prev, footings.length - 2));
    }, [footings.length]);

    const runAnalysis = useCallback(() => {
        setError(null);
        try {
            const configs = footings.map(f => ({
                ...f,
                fck: sharedMaterial.fck,
                fy: sharedMaterial.fy,
                grade: sharedMaterial.grade,
                steelGrade: sharedMaterial.steelGrade,
                cover: sharedMaterial.cover,
                gammaFill: sharedMaterial.gammaFill,
                gammaConcrete: sharedMaterial.gammaConcrete,
                depthFill: sharedMaterial.depthFill,
            }));
            const res = analyzeFootings(configs);
            setResults(res);
        } catch (e: any) {
            setError(e.message);
            setResults(null);
        }
    }, [footings, sharedMaterial]);

    const runOptimization = useCallback(() => {
        if (workerRef.current) {
            workerRef.current.terminate();
        }
        
        setError(null);
        setIsOptimizing(true);
        setOptProgress({ done: 0, total: 0, feasible: 0 });

        const worker = new Worker(new URL('../workers/footingOptimizer.worker', import.meta.url), { type: 'module' });
        workerRef.current = worker;

        const f = footings[activeFooting];
        const config = {
            ...f,
            fck: sharedMaterial.fck,
            fy: sharedMaterial.fy,
            grade: sharedMaterial.grade,
            steelGrade: sharedMaterial.steelGrade,
            cover: sharedMaterial.cover,
            gammaFill: sharedMaterial.gammaFill,
            gammaConcrete: sharedMaterial.gammaConcrete,
            depthFill: sharedMaterial.depthFill,
        };

        const params = { minL, maxL, stepL, minB, maxB, stepB, minD, maxD, stepD };

        worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'progress') {
                setOptProgress({ done: msg.done, total: msg.total, feasible: msg.feasible });
            } else if (msg.type === 'done') {
                setIsOptimizing(false);
                if (msg.result.optimum) {
                    const newFootings = [...footings];
                    newFootings[activeFooting] = {
                        ...newFootings[activeFooting],
                        L: msg.result.optimum.L,
                        B: msg.result.optimum.B,
                        D: msg.result.optimum.D
                    };
                    setFootings(newFootings);
                    
                    setTimeout(() => {
                        const btn = document.getElementById('analyze-btn');
                        if (btn) btn.click();
                    }, 50);
                } else {
                    setError('No feasible dimension combination found in the given range.');
                }
                worker.terminate();
                workerRef.current = null;
            } else if (msg.type === 'error') {
                setIsOptimizing(false);
                setError(msg.error);
                worker.terminate();
                workerRef.current = null;
            }
        };

        worker.postMessage({ type: 'optimize', config, params });
    }, [footings, activeFooting, sharedMaterial, minL, maxL, stepL, minB, maxB, stepB, minD, maxD, stepD]);

    const cancelOptimization = useCallback(() => {
        if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
            setIsOptimizing(false);
        }
    }, []);
    
    React.useEffect(() => {
        return () => {
            if (workerRef.current) workerRef.current.terminate();
        };
    }, []);

    const handlePreviewReport = useCallback(async () => {
        if (!results) return;
        try {
            const url = await generateFootingReport(
                { footings, material: sharedMaterial },
                results,
                true
            );
            setPdfPreviewUrl(url);
        } catch (e: any) {
            logger.error('Report preview failed:', e);
        }
    }, [results, footings, sharedMaterial]);

    const handleDownloadReport = useCallback(async () => {
        if (!results) return;
        try {
            await generateFootingReport(
                { footings, material: sharedMaterial },
                results,
                false
            );
        } catch (e: any) {
            logger.error('Report download failed:', e);
        }
    }, [results, footings, sharedMaterial]);

    const f = footings[activeFooting] || footings[0];
    const r = results ? results[activeFooting] : null;

    return (
        <div className="layout">
            {/* SIDEBAR */}
            <aside className="sidebar">
                <div className="panel">
                    <h3 className="panel-title">
                        <span className="panel-icon">🏗</span>
                        Material & Soil
                    </h3>
                    <div>
                        <div className="control-group">
                            <label>Concrete</label>
                            <select title="Select option" value={sharedMaterial.grade} onChange={e => handleGradeChange(e.target.value)}>
                                {['M20', 'M25', 'M30', 'M35', 'M40'].map(g =>
                                    <option key={g} value={g}>{g} (f_ck={g.replace('M', '')})</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Steel</label>
                            <select title="Select option" value={sharedMaterial.steelGrade} onChange={e => handleSteelChange(e.target.value)}>
                                {['Fe250', 'Fe415', 'Fe500', 'Fe550'].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Cover (mm)</label>
                            <input title="Value" type="number" min="25" max="100" value={sharedMaterial.cover}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, cover: +e.target.value }))} />
                        </div>
                        <div className="control-group">
                            <label>γ Fill (kN/m³)</label>
                            <input title="Value" type="number" min="10" max="25" step="0.5" value={sharedMaterial.gammaFill}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, gammaFill: +e.target.value }))} />
                        </div>
                        <div className="control-group">
                            <label>γ Concrete (kN/m³)</label>
                            <input title="Value" type="number" min="20" max="30" step="0.5" value={sharedMaterial.gammaConcrete}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, gammaConcrete: +e.target.value }))} />
                        </div>
                        <div className="control-group">
                            <label>Fill Depth above NGL (m)</label>
                            <input title="Value" type="number" min="0" max="5" step="0.1" value={sharedMaterial.depthFill}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, depthFill: +e.target.value }))} />
                        </div>
                        <div className="info-note-inline">
                            τ<sub>c</sub> computed inbuilt from IS 456 Table 19 (getTauC for grade {sharedMaterial.grade}). Footing self-weight computed from actual L×B×D geometry.
                        </div>
                    </div>
                </div>

                <div className="panel mt-16px">
                    <h3 className="panel-title">
                        <span className="panel-icon">📐</span>
                        Footings ({footings.length})
                    </h3>
                    <div className="slab-panel-tabs">
                        {footings.map((footing, i) => (
                            <button key={i}
                                className={`slab-panel-tab ${i === activeFooting ? 'active' : ''}`}
                                onClick={() => setActiveFooting(i)}>
                                {footing.label || `F${i + 1}`}
                            </button>
                        ))}
                        <button className="slab-panel-tab add-btn" onClick={addFooting}>+</button>
                    </div>

                    <div className="mt-12px">
                        <div className="control-group">
                            <label>Label</label>
                            <input title="Value" value={f.label} onChange={e => updateFooting(activeFooting, 'label', e.target.value)} />
                        </div>
                        <div className="control-group">
                            <label>Footing Type</label>
                            <select title="Select option" value={f.footingType} onChange={e => updateFooting(activeFooting, 'footingType', e.target.value)}>
                                {FOOTING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                        </div>

                        {/* ─── Multiple Load Cases ─────────────────────────────────── */}
                        {/* Each footing supports multiple load cases. The engine envelopes
                            them to find the governing combination for max |Mx|, max |Mz|,
                            and max Fy (with corresponding values). */}
                        <div className="control-group load-cases-group">
                            <div className="load-cases-header">
                                <label>Load Cases (envelope: max |Mx|, max |Mz|, max Fy)</label>
                                <button
                                    type="button"
                                    className="btn-add-lc"
                                    onClick={() => {
                                        const n = (f.loadCases?.length ?? 0) + 1;
                                        const newLC: LoadCase = { label: `LC${n}`, Fy: 0, Mx: 0, Mz: 0, sbc: f.sbc || 150 };
                                        updateFooting(activeFooting, 'loadCases', [...(f.loadCases ?? []), newLC]);
                                    }}
                                    title="Add load case"
                                >+ LC</button>
                            </div>
                            <div className="load-cases-list">
                                {(f.loadCases ?? []).map((lc, li) => (
                                    <div key={li} className="load-case-row">
                                        <div className="lc-label-cell">
                                            <input
                                                title="Load case label"
                                                value={lc.label}
                                                onChange={e => {
                                                    const newLCs = [...(f.loadCases ?? [])];
                                                    newLCs[li] = { ...lc, label: e.target.value };
                                                    updateFooting(activeFooting, 'loadCases', newLCs);
                                                }}
                                            />
                                            {(f.loadCases ?? []).length > 1 && (
                                                <button
                                                    type="button"
                                                    className="btn-remove-lc"
                                                    onClick={() => {
                                                        const newLCs = (f.loadCases ?? []).filter((_, i) => i !== li);
                                                        updateFooting(activeFooting, 'loadCases', newLCs);
                                                    }}
                                                    title="Remove load case"
                                                >×</button>
                                            )}
                                        </div>
                                        <input title="Fy (kN)" type="number" step="10" value={lc.Fy}
                                            onChange={e => {
                                                const newLCs = [...(f.loadCases ?? [])];
                                                newLCs[li] = { ...lc, Fy: +e.target.value };
                                                updateFooting(activeFooting, 'loadCases', newLCs);
                                            }} />
                                        <input title="Mx (kN·m)" type="number" step="10" value={lc.Mx}
                                            onChange={e => {
                                                const newLCs = [...(f.loadCases ?? [])];
                                                newLCs[li] = { ...lc, Mx: +e.target.value };
                                                updateFooting(activeFooting, 'loadCases', newLCs);
                                            }} />
                                        <input title="Mz (kN·m)" type="number" step="10" value={lc.Mz}
                                            onChange={e => {
                                                const newLCs = [...(f.loadCases ?? [])];
                                                newLCs[li] = { ...lc, Mz: +e.target.value };
                                                updateFooting(activeFooting, 'loadCases', newLCs);
                                            }} />
                                        <input title="SBC (kN/m²)" type="number" min="50" step="10" value={lc.sbc}
                                            onChange={e => {
                                                const newLCs = [...(f.loadCases ?? [])];
                                                newLCs[li] = { ...lc, sbc: +e.target.value };
                                                updateFooting(activeFooting, 'loadCases', newLCs);
                                            }} />
                                    </div>
                                ))}
                                <div className="load-case-row lc-header-row">
                                    <span></span>
                                    <span>F<sub>y</sub> (kN)</span>
                                    <span>M<sub>x</sub> (kN·m)</span>
                                    <span>M<sub>z</sub> (kN·m)</span>
                                    <span>SBC (kN/m²)</span>
                                </div>
                            </div>
                        </div>

                        {/* Column Size */}
                        <div className="control-group">
                            <label>Column a (mm) — parallel X</label>
                            <input title="Value" type="number" min="100" step="50" value={f.col_a}
                                onChange={e => updateFooting(activeFooting, 'col_a', +e.target.value)} />
                        </div>
                        <div className="control-group">
                            <label>Column b (mm) — parallel Z</label>
                            <input title="Value" type="number" min="100" step="50" value={f.col_b}
                                onChange={e => updateFooting(activeFooting, 'col_b', +e.target.value)} />
                        </div>

                        {/* Footing Dimensions */}
                        <div className="control-group">
                            <label>L (m) — parallel X</label>
                            <input title="Value" type="number" min="0.5" step="0.1" value={f.L}
                                onChange={e => updateFooting(activeFooting, 'L', +e.target.value)} />
                        </div>
                        <div className="control-group">
                            <label>B (m) — parallel Z</label>
                            <input title="Value" type="number" min="0.5" step="0.1" value={f.B}
                                onChange={e => updateFooting(activeFooting, 'B', +e.target.value)} />
                        </div>
                        <div className="control-group">
                            <label>D (m) — overall depth</label>
                            <input title="Value" type="number" min="0.2" step="0.05" value={f.D}
                                onChange={e => updateFooting(activeFooting, 'D', +e.target.value)} />
                        </div>
                        
                        <div className="fa-opt-card">
                            <h4 className="fa-opt-header">Auto-Optimize Dimensions</h4>
                            
                            <div className="fa-opt-grid mb-8px">
                                <label className="fa-opt-label">L (m)</label>
                                <div>
                                    <input type="number" min="0.5" step="0.1" value={minL} onChange={e => setMinL(+e.target.value)} className="w-full fa-p-4px" title="Min L" placeholder="Min" />
                                </div>
                                <div>
                                    <input type="number" min="0.5" step="0.1" value={maxL} onChange={e => setMaxL(+e.target.value)} className="w-full fa-p-4px" title="Max L" placeholder="Max" />
                                </div>
                            </div>
                            
                            <div className="fa-opt-grid mb-8px">
                                <label className="fa-opt-label">B (m)</label>
                                <div>
                                    <input type="number" min="0.5" step="0.1" value={minB} onChange={e => setMinB(+e.target.value)} className="w-full fa-p-4px" title="Min B" placeholder="Min" />
                                </div>
                                <div>
                                    <input type="number" min="0.5" step="0.1" value={maxB} onChange={e => setMaxB(+e.target.value)} className="w-full fa-p-4px" title="Max B" placeholder="Max" />
                                </div>
                            </div>
                            
                            <div className="fa-opt-grid mb-12px">
                                <label className="fa-opt-label">D (m)</label>
                                <div>
                                    <input type="number" min="0.1" step="0.05" value={minD} onChange={e => setMinD(+e.target.value)} className="w-full fa-p-4px" title="Min D" placeholder="Min" />
                                </div>
                                <div>
                                    <input type="number" min="0.1" step="0.05" value={maxD} onChange={e => setMaxD(+e.target.value)} className="w-full fa-p-4px" title="Max D" placeholder="Max" />
                                </div>
                            </div>

                            {isOptimizing ? (
                                <div>
                                    <div className="fa-flex-between-sm mb-4px">
                                        <span>Optimizing...</span>
                                        <span>{Math.round((optProgress.done / optProgress.total) * 100) || 0}%</span>
                                    </div>
                                    <div className="fa-progress-bg mb-8px">
                                        <div className="fa-progress-fill" ref={progressRef}></div>
                                    </div>
                                    <div className="fa-text-dim-right mb-8px text-center">
                                        Evaluating {optProgress.done} / {optProgress.total} combinations
                                    </div>
                                    <button className="btn btn-danger w-full fa-p-6px" onClick={cancelOptimization}>
                                        Cancel Optimization
                                    </button>
                                </div>
                            ) : (
                                <button className="btn w-full fa-btn-outline" onClick={runOptimization}>
                                    ✨ Optimize Current Footing
                                </button>
                            )}
                        </div>

                        {/* Slope footing: D1 */}
                        {f.footingType === 'slope' && (
                            <div className="control-group">
                                <label>D₁ (mm) — depth at pedestal edge</label>
                                <input title="Value" type="number" min="150" step="25" value={f.D1 || 300}
                                    onChange={e => updateFooting(activeFooting, 'D1', +e.target.value)} />
                            </div>
                        )}

                        {/* Bars */}
                        <div className="control-group">
                            <label>Bar dia X (mm)</label>
                            <select title="Select option" value={f.barDiaX} onChange={e => updateFooting(activeFooting, 'barDiaX', +e.target.value)}>
                                {[8, 10, 12, 16, 20, 25, 32].map(d => <option key={d} value={d}>{d}mm</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Bar dia Z (mm)</label>
                            <select title="Select option" value={f.barDiaZ} onChange={e => updateFooting(activeFooting, 'barDiaZ', +e.target.value)}>
                                {[8, 10, 12, 16, 20, 25, 32].map(d => <option key={d} value={d}>{d}mm</option>)}
                            </select>
                        </div>

                        {/* Pedestal (optional) */}
                        <div className="control-group">
                            <label>Pedestal offset (mm) — 0 = no pedestal</label>
                            <input title="Value" type="number" min="0" step="50" value={f.pedestalOffset}
                                onChange={e => updateFooting(activeFooting, 'pedestalOffset', +e.target.value)} />
                        </div>
                    </div>

                    {footings.length > 1 && (
                        <button className="btn btn-danger w-full mt-10px"
                            onClick={() => removeFooting(activeFooting)}>
                            Remove Footing {f.label}
                        </button>
                    )}
                </div>

                <button id="analyze-btn" className="btn btn-primary w-full mt-16px"
                    onClick={runAnalysis}>
                    ⚡ Analyze All Footings
                </button>
            </aside>

            {/* MAIN CONTENT */}
            <section className="content">
                {error && <div className="panel fa-error-panel"><p className="fa-error-text">{error}</p></div>}

                {r && (
                    <>
                        {/* SUMMARY BANNER */}
                        <div className="fa-flex-wrap mb-24px fa-summary-banner-layout">
                            <div className={`panel status-banner ${r.overallStatus === 'SAFE' ? 'status-safe' : 'status-fail'} fa-flex-1`}>
                                <div className="fa-flex-wrap fa-summary-banner-layout">
                                    <div>
                                        <h2 className="fa-status-title">{r.label} — {r.footingType === 'flat' ? 'Flat' : 'Slope'} Footing</h2>
                                        <p className="fa-status-desc">{r.overallStatus === 'SAFE' ? 'All IS 456 checks passed.' : 'One or more checks failed.'}</p>
                                        <div className="status-chips">
                                            <span className={`chip ${r.overallStatus === 'SAFE' ? 'chip-safe' : 'chip-fail'}`}>{r.overallStatus}</span>
                                            <span className="chip chip-info">L×B = {r.L}×{r.B} m</span>
                                            <span className="chip chip-info">D = {r.D} m</span>
                                            <span className="chip chip-info">SBC = {r.sbc} kN/m²</span>
                                            <span className="chip chip-info">p_max = {r.soilPressure.p_max} kN/m²</span>
                                        </div>
                                    </div>
                                    <div className="fa-flex-wrap-gap-8">
                                        <button className="btn-primary fa-btn-pill" onClick={handlePreviewReport}>
                                            <span className="btn-icon">👁</span> Preview PDF
                                        </button>
                                        <button className="btn-primary fa-btn-pill fa-btn-gradient" onClick={handleDownloadReport}>
                                            <span className="btn-icon">📥</span> Download PDF
                                        </button>
                                        <button className="btn-primary fa-btn-pill" onClick={() => exportToJSON({ footings, results }, `footing_analysis_${timestampForFilename()}`, 'Isolated Footing Design (IS 456:2000)')} title="Export results to JSON file">
                                            <span className="btn-icon">📋</span> Export JSON
                                        </button>
                                        <button className="btn-primary fa-btn-pill" onClick={async () => {
                                            if (!results || results.length === 0) { toast('⚠ Run analysis first', { type: 'info' }); return; }
                                            const lines = results.map((r, i) => {
                                                const f = footings[i];
                                                return `${f?.label||'F'+(i+1)}: ${f?.footingType} ${r.L}×${r.B}mm | p_max=${fmt(r.soilPressure?.p_max,0)} vs SBC=${fmt(r.sbc,0)} kN/m² ${r.soilPressure?.sbcCheck?'OK':'FAIL'} | Punching ${r.punchingShear?.status === 'OK'?'OK':'FAIL'} | OneWay ${r.oneWayShearX?.status === 'OK'?'OK':'FAIL'} | ${r.overallStatus}`;
                                            });
                                            const s = `FOOTING DESIGN SUMMARY (IS 456:2000)\n${'='.repeat(50)}\nFootings: ${results.length}\n\n${lines.join('\n')}\n${'='.repeat(50)}`;
                                            const ok = await copyToClipboard(s);
                                            toast(ok ? '✅ Summary copied to clipboard' : '❌ Copy failed', { type: ok ? 'success' : 'error' });
                                        }} title="Copy key results to clipboard">
                                            <span className="btn-icon">📄</span> Copy Summary
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ─── LOAD CASE ENVELOPE (multi-load-case results) ────────── */}
                        {r.loadCases && r.loadCases.length > 1 && (
                            <div className="panel">
                                <h3 className="panel-title"><span className="panel-icon">📋</span> Load Case Envelope — {r.loadCases.length} cases · Governing: <strong>{r.governingLoadCase}</strong></h3>
                                <table className="result-table compact">
                                    <thead>
                                        <tr>
                                            <th>Load Case</th>
                                            <th>F<sub>y</sub> (kN)</th>
                                            <th>M<sub>x</sub> (kN·m)</th>
                                            <th>M<sub>z</sub> (kN·m)</th>
                                            <th>SBC (kN/m²)</th>
                                            <th>Self Wt (kN)</th>
                                            <th>p<sub>max</sub> (kN/m²)</th>
                                            <th>τ<sub>v</sub> punch</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {r.loadCases.map((lc, i) => (
                                            <tr key={i} className={lc.label === r.governingLoadCase ? 'row-governing' : ''}>
                                                <td>
                                                    {lc.label}
                                                    {r.envelope.maxMx?.label === lc.label && <span className="badge-env" title="Governs max |Mx|">Mx↓</span>}
                                                    {r.envelope.maxMz?.label === lc.label && <span className="badge-env" title="Governs max |Mz|">Mz↓</span>}
                                                    {r.envelope.maxFy?.label === lc.label && <span className="badge-env" title="Governs max Fy">Fy↓</span>}
                                                </td>
                                                <td>{fmt(lc.Fy, 0)}</td>
                                                <td>{fmt(lc.Mx, 0)}</td>
                                                <td>{fmt(lc.Mz, 0)}</td>
                                                <td>{fmt(lc.sbc, 0)}</td>
                                                <td>{fmt(lc.selfWeight, 1)}</td>
                                                <td>{fmt(lc.soilPressure.p_max, 1)}</td>
                                                <td>{fmt(lc.punchingShear.tau_v, 3)}</td>
                                                <td><span className={`chip ${lc.overallStatus === 'SAFE' ? 'chip-safe' : 'chip-fail'}`}>{lc.overallStatus}</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="ld-note">
                                    τ<sub>c</sub> = {fmt(r.tau_c_inbuilt, 3)} N/mm² (inbuilt from IS 456 Table 19, grade {r.grade}, p<sub>t</sub>={fmt(r.pt_used, 2)}%). Footing self-weight = {fmt(r.selfWeight, 1)} kN (actual L×B×D), fill = {fmt(r.fillWeight, 1)} kN.
                                </div>
                            </div>
                        )}

                        {/* SOIL PRESSURE */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">🌍</span> Soil Pressure Check (<CodeRef clause="34.1.2">Cl. 34.1.2</CodeRef>)</h3>
                            <table className="result-table">
                                <thead>
                                    <tr>
                                        <th>Area Req (m²)</th>
                                        <th>Area Prov (m²)</th>
                                        <th>Total Load (kN)</th>
                                        <th>p_min (kN/m²)</th>
                                        <th>p_max (kN/m²)</th>
                                        <th>p_avg (kN/m²)</th>
                                        <th>e<sub>X</sub> (m)</th>
                                        <th>e<sub>Z</sub> (m)</th>
                                        <th>SBC Check</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>{r.areaReq}</td>
                                        <td>{r.areaProv}</td>
                                        <td>{r.totalLoad}</td>
                                        <td>{r.soilPressure.p_min}</td>
                                        <td>{r.soilPressure.p_max}</td>
                                        <td>{r.soilPressure.p_avg}</td>
                                        <td>{r.soilPressure.eccentricityX}</td>
                                        <td>{r.soilPressure.eccentricityZ}</td>
                                        <td><span className={`chip ${r.soilPressure.sbcCheck ? 'chip-safe' : 'chip-fail'}`}>{r.soilPressure.sbcCheck ? 'OK' : 'FAIL'}</span></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* PUNCHING SHEAR */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">⚔️</span> Punching Shear (Two-Way) — <CodeRef clause="34.2.3">Cl. 34.2.3</CodeRef></h3>
                            <table className="result-table">
                                <thead>
                                    <tr>
                                        <th>Critical Perimeter (mm)</th>
                                        <th>Area Punched (m²)</th>
                                        <th>V<sub>u</sub> (kN)</th>
                                        <th>τ<sub>v</sub> (N/mm²)</th>
                                        <th>τ<sub>c</sub> (N/mm²)</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>{r.punchingShear.perimeter_u}</td>
                                        <td>{r.punchingShear.area_punched}</td>
                                        <td>{r.punchingShear.Vu}</td>
                                        <td>{r.punchingShear.tau_v}</td>
                                        <td>{r.punchingShear.tau_c}</td>
                                        <td><span className={`chip ${r.punchingShear.status === 'OK' ? 'chip-safe' : 'chip-fail'}`}>{r.punchingShear.status}</span></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* ONE-WAY SHEAR */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">📐</span> One-Way Shear — <CodeRef clause="34.2.4">Cl. 34.2.4</CodeRef></h3>
                            <table className="result-table">
                                <thead>
                                    <tr>
                                        <th>Direction</th>
                                        <th>V<sub>u</sub> (kN)</th>
                                        <th>τ<sub>v</sub> (N/mm²)</th>
                                        <th>τ<sub>c</sub> (N/mm²)</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>X (parallel L)</td>
                                        <td>{r.oneWayShearX.Vu}</td>
                                        <td>{r.oneWayShearX.tau_v}</td>
                                        <td>{r.oneWayShearX.tau_c}</td>
                                        <td><span className={`chip ${r.oneWayShearX.status === 'OK' ? 'chip-safe' : 'chip-fail'}`}>{r.oneWayShearX.status}</span></td>
                                    </tr>
                                    <tr>
                                        <td>Z (parallel B)</td>
                                        <td>{r.oneWayShearZ.Vu}</td>
                                        <td>{r.oneWayShearZ.tau_v}</td>
                                        <td>{r.oneWayShearZ.tau_c}</td>
                                        <td><span className={`chip ${r.oneWayShearZ.status === 'OK' ? 'chip-safe' : 'chip-fail'}`}>{r.oneWayShearZ.status}</span></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* FLEXURAL DESIGN */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">📊</span> Flexural Reinforcement (per meter)</h3>
                            <table className="result-table">
                                <thead>
                                    <tr>
                                        <th>Direction</th>
                                        <th>M<sub>u</sub> (kN·m)</th>
                                        <th>d<sub>eff</sub> (mm)</th>
                                        <th>A<sub>st,req</sub> (mm²/m)</th>
                                        <th>A<sub>st,min</sub> (mm²/m)</th>
                                        <th>p<sub>t</sub> (%)</th>
                                        <th>Governs</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>X (parallel L)</td>
                                        <td>{r.flexureX.Mu.toFixed(2)}</td>
                                        <td>{r.flexureX.d}</td>
                                        <td>{r.flexureX.Ast_req}</td>
                                        <td>{r.flexureX.Ast_min}</td>
                                        <td>{r.flexureX.pt}</td>
                                        <td>{r.flexureX.governs}</td>
                                        <td><span className={`chip ${r.flexureX.status === 'SAFE' ? 'chip-safe' : 'chip-fail'}`}>{r.flexureX.status}</span></td>
                                    </tr>
                                    <tr>
                                        <td>Z (parallel B)</td>
                                        <td>{r.flexureZ.Mu.toFixed(2)}</td>
                                        <td>{r.flexureZ.d}</td>
                                        <td>{r.flexureZ.Ast_req}</td>
                                        <td>{r.flexureZ.Ast_min}</td>
                                        <td>{r.flexureZ.pt}</td>
                                        <td>{r.flexureZ.governs}</td>
                                        <td><span className={`chip ${r.flexureZ.status === 'SAFE' ? 'chip-safe' : 'chip-fail'}`}>{r.flexureZ.status}</span></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* SLOPE CHECK (slope footing only) */}
                        {r.slopeCheck && (
                            <div className="panel">
                                <h3 className="panel-title"><span className="panel-icon">📐</span> Slope Check</h3>
                                <table className="result-table">
                                    <tbody>
                                        <tr><td>Slope Angle</td><td>{r.slopeCheck.slopeAngleDeg}°</td></tr>
                                        <tr><td>Adequacy</td><td><span className={`chip ${r.slopeCheck.isAdequate ? 'chip-safe' : 'chip-fail'}`}>{r.slopeCheck.isAdequate ? 'OK' : 'ALTER'}</span></td></tr>
                                        <tr><td colSpan={2}>{r.slopeCheck.note}</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* MULTI-FOOTING SUMMARY */}
                        {results && results.length > 1 && (
                            <div className="panel">
                                <h3 className="panel-title"><span className="panel-icon">📋</span> All Footings Summary</h3>
                                <table className="result-table">
                                    <thead>
                                        <tr>
                                            <th>Footing</th>
                                            <th>Type</th>
                                            <th>L×B</th>
                                            <th>D</th>
                                            <th>SBC</th>
                                            <th>p_max</th>
                                            <th>Punching</th>
                                            <th>Flexure</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {results.map((res: FootingAnalysisResult, i: number) => (
                                            <tr key={i} className={`result-row ${i === activeFooting ? 'active-row' : ''} cursor-pointer`}
                                                onClick={() => setActiveFooting(i)}>
                                                <td><strong>{res.label}</strong></td>
                                                <td>{res.footingType}</td>
                                                <td>{res.L}×{res.B}</td>
                                                <td>{res.D}m</td>
                                                <td>{res.sbc}</td>
                                                <td>{res.soilPressure.p_max}</td>
                                                <td><span className={`chip ${res.punchingShear.status === 'OK' ? 'chip-safe' : 'chip-fail'}`}>{res.punchingShear.status}</span></td>
                                                <td><span className={`chip ${res.flexureX.status === 'SAFE' && res.flexureZ.status === 'SAFE' ? 'chip-safe' : 'chip-fail'}`}>{res.flexureX.status === 'SAFE' && res.flexureZ.status === 'SAFE' ? 'SAFE' : 'REVISE'}</span></td>
                                                <td><span className={`chip ${res.overallStatus === 'SAFE' ? 'chip-safe' : 'chip-fail'}`}>{res.overallStatus}</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* PDF PREVIEW MODAL */}
                        {pdfPreviewUrl && (
                            <div className="pdf-preview-overlay" onClick={() => setPdfPreviewUrl(null)}>
                                <div className="pdf-preview-modal" onClick={e => e.stopPropagation()}>
                                    <div className="pdf-preview-header">
                                        <h3>PDF Report Preview</h3>
                                        <div className="fa-flex-gap-8">
                                            <button className="btn-primary fa-btn-pill-sm fa-btn-gradient" onClick={handleDownloadReport}>
                                                📥 Download
                                            </button>
                                            <button onClick={() => setPdfPreviewUrl(null)} className="fa-btn-pill-sm-close">
                                                ✕ Close
                                            </button>
                                        </div>
                                    </div>
                                    <iframe src={pdfPreviewUrl}
                                        className="fa-iframe"
                                        title="PDF Preview" />
                                </div>
                            </div>
                        )}
                    </>
                )}

                {!results && (
                    <div className="panel fa-placeholder">
                        <h2 className="fa-placeholder-title">Isolated Footing Designer</h2>
                        <p className="fa-placeholder-desc">Configure footings in the sidebar and click <strong>Analyze All Footings</strong></p>
                        <p className="fa-placeholder-hint">
                            Supports flat footings and slope (sloped) footings per IS 456:2000
                        </p>
                    </div>
                )}
            </section>
        </div>
    );
}
