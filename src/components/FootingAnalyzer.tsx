/* eslint-disable react/forbid-component-props, react/forbid-dom-props */
"use client";

import React, { useState, useCallback } from "react";
import { analyzeFooting, analyzeFootings, FOOTING_TYPES, type FootingConfig, type FootingAnalysisResult } from "./footingEngine";
import { generateFootingReport } from "./footingReportGenerator";
import { logger } from "../lib/logger";

const DEFAULT_FOOTING: FootingConfig = {
    label: 'F1',
    footingType: 'flat',
    col_a: 500,
    col_b: 500,
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
    addnWtPercent: 10,
    shearStrength: 0.3,
};

export default function FootingAnalyzer() {
    const [footings, setFootings] = useState<FootingConfig[]>([{ ...DEFAULT_FOOTING }]);
    const [activeFooting, setActiveFooting] = useState(0);
    const [results, setResults] = useState<FootingAnalysisResult[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optProgress, setOptProgress] = useState({ done: 0, total: 0, feasible: 0 });
    
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
        gammaFill: 18, gammaConcrete: 25, addnWtPercent: 10, shearStrength: 0.3,
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
                addnWtPercent: sharedMaterial.addnWtPercent,
                shearStrength: sharedMaterial.shearStrength,
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
            addnWtPercent: sharedMaterial.addnWtPercent,
            shearStrength: sharedMaterial.shearStrength,
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
                                    <option key={g} value={g}>{g} (f<sub>ck</sub>={g.replace('M', '')})</option>)}
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
                        <div className="control-group">
                            <label>Addl. Wt. of Footing (%)</label>
                            <input title="Value" type="number" min="0" max="30" step="1" value={sharedMaterial.addnWtPercent}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, addnWtPercent: +e.target.value }))} />
                        </div>
                        <div className="control-group">
                            <label>Shear Strength τc (N/mm²)</label>
                            <input title="Value" type="number" min="0.1" max="1.0" step="0.01" value={sharedMaterial.shearStrength}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, shearStrength: +e.target.value }))} />
                        </div>
                    </div>
                </div>

                <div className="panel" style={{ marginTop: '16px' }}>
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

                    <div style={{ marginTop: '12px' }}>
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

                        {/* Column Forces */}
                        <div className="control-group">
                            <label>F<sub>y</sub> Axial Load (kN)</label>
                            <input title="Value" type="number" min="0" step="10" value={f.Fy}
                                onChange={e => updateFooting(activeFooting, 'Fy', +e.target.value)} />
                        </div>
                        <div className="control-group">
                            <label>M<sub>x</sub> Moment (kN·m)</label>
                            <input title="Value" type="number" step="10" value={f.Mx}
                                onChange={e => updateFooting(activeFooting, 'Mx', +e.target.value)} />
                        </div>
                        <div className="control-group">
                            <label>M<sub>z</sub> Moment (kN·m)</label>
                            <input title="Value" type="number" step="10" value={f.Mz}
                                onChange={e => updateFooting(activeFooting, 'Mz', +e.target.value)} />
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

                        {/* SBC */}
                        <div className="control-group">
                            <label>SBC (kN/m²)</label>
                            <input title="Value" type="number" min="50" step="10" value={f.sbc}
                                onChange={e => updateFooting(activeFooting, 'sbc', +e.target.value)} />
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
                        
                        <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                            <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--primary)' }}>Auto-Optimize Dimensions</h4>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)', alignSelf: 'end' }}>L (m)</label>
                                <div>
                                    <input type="number" min="0.5" step="0.1" value={minL} onChange={e => setMinL(+e.target.value)} style={{ width: '100%', padding: '4px' }} title="Min L" placeholder="Min" />
                                </div>
                                <div>
                                    <input type="number" min="0.5" step="0.1" value={maxL} onChange={e => setMaxL(+e.target.value)} style={{ width: '100%', padding: '4px' }} title="Max L" placeholder="Max" />
                                </div>
                            </div>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)', alignSelf: 'end' }}>B (m)</label>
                                <div>
                                    <input type="number" min="0.5" step="0.1" value={minB} onChange={e => setMinB(+e.target.value)} style={{ width: '100%', padding: '4px' }} title="Min B" placeholder="Min" />
                                </div>
                                <div>
                                    <input type="number" min="0.5" step="0.1" value={maxB} onChange={e => setMaxB(+e.target.value)} style={{ width: '100%', padding: '4px' }} title="Max B" placeholder="Max" />
                                </div>
                            </div>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)', alignSelf: 'end' }}>D (m)</label>
                                <div>
                                    <input type="number" min="0.1" step="0.05" value={minD} onChange={e => setMinD(+e.target.value)} style={{ width: '100%', padding: '4px' }} title="Min D" placeholder="Min" />
                                </div>
                                <div>
                                    <input type="number" min="0.1" step="0.05" value={maxD} onChange={e => setMaxD(+e.target.value)} style={{ width: '100%', padding: '4px' }} title="Max D" placeholder="Max" />
                                </div>
                            </div>

                            {isOptimizing ? (
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                                        <span>Optimizing...</span>
                                        <span>{Math.round((optProgress.done / optProgress.total) * 100) || 0}%</span>
                                    </div>
                                    <div style={{ height: '6px', background: 'var(--bg-input)', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
                                        <div style={{ height: '100%', background: 'var(--primary)', width: `${(optProgress.done / optProgress.total) * 100}%`, transition: 'width 0.2s' }}></div>
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textAlign: 'center', marginBottom: '8px' }}>
                                        Evaluating {optProgress.done} / {optProgress.total} combinations
                                    </div>
                                    <button className="btn btn-danger" style={{ width: '100%', padding: '6px' }} onClick={cancelOptimization}>
                                        Cancel Optimization
                                    </button>
                                </div>
                            ) : (
                                <button className="btn" style={{ width: '100%', padding: '8px', border: '1px solid var(--primary)', color: 'var(--primary)', background: 'transparent' }} onClick={runOptimization}>
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
                        {f.pedestalOffset > 0 && (
                            <>
                                <div className="control-group">
                                    <label>Pedestal a (mm) — X</label>
                                    <input title="Value" type="number" min="100" step="50" value={f.pedestal_a}
                                        onChange={e => updateFooting(activeFooting, 'pedestal_a', +e.target.value)} />
                                </div>
                                <div className="control-group">
                                    <label>Pedestal b (mm) — Z</label>
                                    <input title="Value" type="number" min="100" step="50" value={f.pedestal_b}
                                        onChange={e => updateFooting(activeFooting, 'pedestal_b', +e.target.value)} />
                                </div>
                            </>
                        )}
                    </div>

                    {footings.length > 1 && (
                        <button className="btn btn-danger" style={{ marginTop: '10px', width: '100%' }}
                            onClick={() => removeFooting(activeFooting)}>
                            Remove Footing {f.label}
                        </button>
                    )}
                </div>

                <button id="analyze-btn" className="btn btn-primary" style={{ marginTop: '16px', width: '100%' }}
                    onClick={runAnalysis}>
                    ⚡ Analyze All Footings
                </button>
            </aside>

            {/* MAIN CONTENT */}
            <section className="content">
                {error && <div className="panel" style={{ borderColor: 'var(--negative)' }}><p style={{ color: 'var(--negative)' }}>{error}</p></div>}

                {r && (
                    <>
                        {/* SUMMARY BANNER */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
                            <div className={`panel status-banner ${r.overallStatus === 'SAFE' ? 'status-safe' : 'status-fail'}`} style={{ flex: 1, margin: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                                    <div>
                                        <h2 style={{ margin: '0 0 8px 0', fontSize: '1.4rem' }}>{r.label} — {r.footingType === 'flat' ? 'Flat' : 'Slope'} Footing</h2>
                                        <p style={{ margin: '0 0 12px 0', opacity: 0.9 }}>{r.overallStatus === 'SAFE' ? 'All IS 456 checks passed.' : 'One or more checks failed.'}</p>
                                        <div className="status-chips">
                                            <span className={`chip ${r.overallStatus === 'SAFE' ? 'chip-safe' : 'chip-fail'}`}>{r.overallStatus}</span>
                                            <span className="chip chip-info">L×B = {r.L}×{r.B} m</span>
                                            <span className="chip chip-info">D = {r.D} m</span>
                                            <span className="chip chip-info">SBC = {r.sbc} kN/m²</span>
                                            <span className="chip chip-info">p_max = {r.soilPressure.p_max} kN/m²</span>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        <button className="btn-primary" onClick={handlePreviewReport}
                                            style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
                                            <span className="btn-icon">👁</span> Preview PDF
                                        </button>
                                        <button className="btn-primary" onClick={handleDownloadReport}
                                            style={{ padding: '8px 16px', fontSize: '0.85rem', background: 'linear-gradient(135deg, #00e5a0 0%, #00b87a 100%)' }}>
                                            <span className="btn-icon">📥</span> Download PDF
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* SOIL PRESSURE */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">🌍</span> Soil Pressure Check</h3>
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
                            <h3 className="panel-title"><span className="panel-icon">⚔️</span> Punching Shear (Two-Way)</h3>
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
                            <h3 className="panel-title"><span className="panel-icon">📐</span> One-Way Shear</h3>
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
                                            <tr key={i} className={i === activeFooting ? 'row-active' : ''}
                                                onClick={() => setActiveFooting(i)} style={{ cursor: 'pointer' }}>
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
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button className="btn-primary" onClick={handleDownloadReport}
                                                style={{ padding: '8px 18px', fontSize: '0.82rem', background: 'linear-gradient(135deg, #00e5a0 0%, #00b87a 100%)' }}>
                                                📥 Download
                                            </button>
                                            <button onClick={() => setPdfPreviewUrl(null)}
                                                style={{ padding: '8px 18px', fontSize: '0.82rem', fontWeight: 600, border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-input)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                                                ✕ Close
                                            </button>
                                        </div>
                                    </div>
                                    <iframe srcDoc={pdfPreviewUrl}
                                        style={{ width: '100%', height: 'calc(100% - 60px)', border: 'none', borderRadius: '0 0 12px 12px', background: 'white' }}
                                        title="PDF Preview" />
                                </div>
                            </div>
                        )}
                    </>
                )}

                {!results && (
                    <div className="panel" style={{ textAlign: 'center', padding: '60px 20px' }}>
                        <h2 style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>Isolated Footing Designer</h2>
                        <p style={{ color: 'var(--text-dim)' }}>Configure footings in the sidebar and click <strong>Analyze All Footings</strong></p>
                        <p style={{ color: 'var(--text-dim)', marginTop: '8px', fontSize: '0.85rem' }}>
                            Supports flat footings and slope (sloped) footings per IS 456:2000
                        </p>
                    </div>
                )}
            </section>
        </div>
    );
}
