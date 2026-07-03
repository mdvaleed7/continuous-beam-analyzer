"use client";

import React, { useState, useCallback, useMemo } from "react";
import { analyzeSlab, analyzeSlabs, BOUNDARY_CASES, SUPPORT_CONDITIONS } from "./slabEngine";
import CodeRef from './CodeRef';
import { generateSlabReport } from "./slabReportGenerator";
import { exportToJSON, timestampForFilename, copyToClipboard, fmt } from "../lib/exportResults";
import { useToast } from './ToastProvider';
import { logger } from "../lib/logger";

const DEFAULT_PANEL = {
    label: 'S1',
    Lx: 4.0, Ly: 5.0, L: 2.0, D: 150, cover: 20,
    fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500',
    LL: 3, SDL: 1.5,
    loadFactor: 1.5,
    boundaryCase: 1,
    supportCondition: 'simply',
    slabType: 'auto',
    ageOfLoading: '28',
    camber: 0,
};

export default function NormalSlabAnalyzer() {
    const { toast } = useToast();
    const [panels, setPanels] = useState([{ ...DEFAULT_PANEL }]);
    const [activePanel, setActivePanel] = useState(0);
    const [results, setResults] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optProgress, setOptProgress] = useState({ done: 0, total: 0, feasible: 0 });
    const [minThk, setMinThk] = useState(100);
    const [maxThk, setMaxThk] = useState(300);
    const [thkStep, setThkStep] = useState(10);
    const workerRef = React.useRef<Worker | null>(null);


    // Shared material across all panels
    const [sharedMaterial, setSharedMaterial] = useState({
        grade: 'M25', fck: 25, steelGrade: 'Fe500', fy: 500, cover: 20,
        LL: 3, SDL: 1.5, loadFactor: 1.5, ageOfLoading: '28',
    });

    // Dynamically update maxThk based on required depth by L/d ratio
    React.useEffect(() => {
        const p = panels[activePanel];
        if (!p) return;
        
        // Cantilever slabs are handled by the dedicated CantileverSlabAnalyzer
        // (selectable in the slab-type dropdown). This panel handles only
        // one-way and two-way slabs.
        const ratio = (p.Ly || 1) / (p.Lx || 1);
        const autoType = ratio > 2 ? 'one-way' : 'two-way';
        const span = p.Lx * 1000;
        let basicRatio = 20;
        
        if (autoType === 'one-way') {
            basicRatio = p.supportCondition === 'continuous' ? 26 : 20;
        } else {
            basicRatio = p.boundaryCase === 1 ? 26 : (p.boundaryCase === 9 ? 20 : 23);
        }
        
        const d_req = span / basicRatio;
        const D_req = Math.ceil((d_req + sharedMaterial.cover + 5) / 10) * 10;

        // eslint-disable-next-line
        setMaxThk(D_req);

        setMinThk(prev => Math.min(prev, D_req));
     
    }, [panels, activePanel, sharedMaterial.cover]);

    const handleGradeChange = useCallback((grade: string) => {
        const fckMap = { M20: 20, M25: 25, M30: 30, M35: 35, M40: 40 };
        const fck = fckMap[grade as keyof typeof fckMap] || 25;
        setSharedMaterial(prev => ({ ...prev, grade, fck }));
    }, []);

    const handleSteelChange = useCallback((steelGrade: string) => {
        const fyMap = { Fe250: 250, Fe415: 415, Fe500: 500, Fe550: 550 };
        const fy = fyMap[steelGrade as keyof typeof fyMap] || 500;
        setSharedMaterial(prev => ({ ...prev, steelGrade, fy }));
    }, []);

    const updatePanel = useCallback((idx: number, field: string, value: any) => {
        setPanels(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], [field]: value };
            return next;
        });
    }, []);

    const addPanel = useCallback(() => {
        setPanels(prev => {
            const n = prev.length;
            return [...prev, { ...DEFAULT_PANEL, label: `S${n + 1}` }];
        });
    }, []);

    const removePanel = useCallback((idx: number) => {
        setPanels(prev => {
            if (prev.length <= 1) return prev;
            const next = prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, label: p.label || `S${i + 1}` }));
            return next;
        });
        setActivePanel(prev => Math.min(prev, panels.length - 2));
    }, [panels.length]);

    const runAnalysis = useCallback(() => {
        setError(null);
        try {
            const configs = panels.map(p => ({
                ...p,
                fck: sharedMaterial.fck,
                fy: sharedMaterial.fy,
                grade: sharedMaterial.grade,
                steelGrade: sharedMaterial.steelGrade,
                cover: sharedMaterial.cover,
                LL: sharedMaterial.LL,
                SDL: sharedMaterial.SDL,
                loadFactor: sharedMaterial.loadFactor,
                ageOfLoading: sharedMaterial.ageOfLoading,
            }));
            const res = analyzeSlabs(configs as any);
            setResults(res);
        } catch (e: any) {
            setError(e.message);
            setResults(null);
        }
    }, [panels, sharedMaterial]);

    const runOptimization = useCallback(() => {
        if (workerRef.current) {
            workerRef.current.terminate();
        }
        
        setError(null);
        setIsOptimizing(true);
        setOptProgress({ done: 0, total: 0, feasible: 0 });

        const worker = new Worker(new URL('../workers/slabOptimizer.worker', import.meta.url), { type: 'module' });
        workerRef.current = worker;

        const p = panels[activePanel];
        const config = {
            ...p,
            fck: sharedMaterial.fck,
            fy: sharedMaterial.fy,
            grade: sharedMaterial.grade,
            steelGrade: sharedMaterial.steelGrade,
            cover: sharedMaterial.cover,
            LL: sharedMaterial.LL,
            SDL: sharedMaterial.SDL,
            loadFactor: sharedMaterial.loadFactor,
            ageOfLoading: sharedMaterial.ageOfLoading,
        };

        const thicknesses = [];
        for (let t = minThk; t <= maxThk; t += thkStep) thicknesses.push(t);

        worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'progress') {
                setOptProgress({ done: msg.done, total: msg.total, feasible: msg.feasible });
            } else if (msg.type === 'done') {
                setIsOptimizing(false);
                if (msg.result.optimum) {
                    const optimum = msg.result.optimum;
                    const newPanels = [...panels];
                    newPanels[activePanel] = {
                        ...newPanels[activePanel],
                        D: optimum.thickness,
                        camber: optimum.result.deflection.camber,
                    };
                    setPanels(newPanels);
                    
                    // Small delay to allow state to settle, then run analysis (runAnalysis uses state, so it might still be stale. Better to analyze directly or rely on user).
                    // We'll let the panel update happen, then the user can analyze. But auto-analyzing is better.
                    setTimeout(() => {
                        const btn = document.getElementById('analyze-btn');
                        if (btn) btn.click();
                    }, 50);
                } else {
                    setError('No feasible thickness found in the given range.');
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

        worker.postMessage({ type: 'optimize', config, thicknesses });
    }, [panels, activePanel, sharedMaterial, minThk, maxThk, thkStep]);

    const cancelOptimization = useCallback(() => {
        if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
            setIsOptimizing(false);
        }
    }, []);
    
    // cleanup worker on unmount
    React.useEffect(() => {
        return () => {
            if (workerRef.current) workerRef.current.terminate();
        };
    }, []);

    const handlePreviewReport = useCallback(async () => {
        if (!results) return;
        try {
            const url = await generateSlabReport(
                { panels, material: sharedMaterial },
                results,
                true
            );
            setPdfPreviewUrl(url);
        } catch (e: any) {
            logger.error('Report preview failed:', e);
        }
    }, [results, panels, sharedMaterial]);

    const handleDownloadReport = useCallback(async () => {
        if (!results) return;
        try {
            await generateSlabReport(
                { panels, material: sharedMaterial },
                results,
                false
            );
        } catch (e: any) {
            logger.error('Report download failed:', e);
        }
    }, [results, panels, sharedMaterial]);

    const p = panels[activePanel] || panels[0];
    const r = results ? results[activePanel] : null;

    // Auto-detect slab type from Ly/Lx ratio (used for dynamic UI).
    // Cantilever is NOT detected here — it has its own dedicated analyzer.
    const detectedSlabType = useMemo(() => {
        const ratio = (p.Ly || 1) / (p.Lx || 1);
        return ratio > 2 ? 'one-way' as const : 'two-way' as const;
    }, [p.Lx, p.Ly]);

    const lyLxRatio = useMemo(() => {
        return Math.round(((p.Ly || 1) / (p.Lx || 1)) * 100) / 100;
    }, [p.Lx, p.Ly]);

    return (
        <div className="layout">
            {/* ───── SIDEBAR ───── */}
            <aside className="sidebar">
                <div className="panel">
                    <h3 className="panel-title">
                        <span className="panel-icon">🏗</span>
                        Material & Loads
                    </h3>
                    <div>
                        <div className="control-group">
                            <label>Concrete</label>
                            <select title="Select option" value={sharedMaterial.grade}
                                onChange={e => handleGradeChange(e.target.value)} id="input-field">
                                {['M20', 'M25', 'M30', 'M35', 'M40'].map(g =>
                                    <option key={g} value={g}>{g} (f_ck={g.replace('M', '')})</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Steel</label>
                            <select title="Select option" value={sharedMaterial.steelGrade}
                                onChange={e => handleSteelChange(e.target.value)} id="input-field">
                                {['Fe250', 'Fe415', 'Fe500', 'Fe550'].map(s =>
                                    <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="input-field">Cover (mm)</label>
                            <input title="Value" type="number" min="15" max="50" value={sharedMaterial.cover}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, cover: +e.target.value }))} id="input-field" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="input-field">Load Factor</label>
                            <input title="Value" type="number" min="1.0" max="2.0" step="0.1" value={sharedMaterial.loadFactor}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, loadFactor: +e.target.value }))} id="input-field" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="input-field">Self-weight (kN/m²)</label>
                            <input type="number" value={(p.D / 1000 * 25).toFixed(2)} disabled
                                title="Calculated automatically as D × 25 kN/m³. Not user-editable." id="input-field" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="input-field">SDL (kN/m²)</label>
                            <input title="Value" type="number" min="0" step="0.5" value={sharedMaterial.SDL}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, SDL: +e.target.value }))} id="input-field" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="input-field">LL (kN/m²)</label>
                            <input title="Value" type="number" min="0" step="0.5" value={sharedMaterial.LL}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, LL: +e.target.value }))} id="input-field" />
                        </div>
                        <div className="control-group">
                            <label>Age at Loading</label>
                            <select title="Select option" value={sharedMaterial.ageOfLoading}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, ageOfLoading: e.target.value }))} id="input-field">
                                <option value="7">7 Days (θ=2.2)</option>
                                <option value="28">28 Days (θ=1.6)</option>
                                <option value="365">1 Year (θ=1.1)</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className="panel mt-16">
                    <h3 className="panel-title">
                        <span className="panel-icon">📐</span>
                        Panels ({panels.length})
                    </h3>
                    <div className="slab-panel-tabs">
                        {panels.map((panel, i) => (
                            <button key={i}
                                className={`slab-panel-tab ${i === activePanel ? 'active' : ''}`}
                                onClick={() => setActivePanel(i)}>
                                {panel.label || `S${i + 1}`}
                            </button>
                        ))}
                        <button className="slab-panel-tab add-btn" onClick={addPanel}>+</button>
                    </div>

                    <div className="mt-12">
                        <div className="control-group">
                            <label htmlFor="input-field">Label</label>
                            <input title="Value" value={p.label}
                                onChange={e => updatePanel(activePanel, 'label', e.target.value)} id="input-field" />
                        </div>

                        {/* ── Lx and Ly for auto-detection ── */}
                        {/* Cantilever slabs have their own dedicated analyzer (select
                            "Cantilever Slab" in the slab-type dropdown above). This
                            panel handles only one-way and two-way slabs. */}
                        <div className="control-group">
                            <label htmlFor="input-field">L<sub>x</sub> Short Span (m)</label>
                            <input title="Value" type="number" min="0.5" step="0.1" value={p.Lx}
                                onChange={e => updatePanel(activePanel, 'Lx', +e.target.value)} id="input-field" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="input-field">L<sub>y</sub> Long Span (m)</label>
                            <input title="Value" type="number" min="0.5" step="0.1" value={p.Ly}
                                onChange={e => updatePanel(activePanel, 'Ly', +e.target.value)} id="input-field" />
                        </div>

                        {/* Auto-detected type indicator */}
                        <div className={`slab-type-indicator ${detectedSlabType === 'one-way' ? 'one-way' : 'two-way'}`}>
                            L<sub>y</sub>/L<sub>x</sub> = {lyLxRatio} → {detectedSlabType === 'one-way' ? '📏 One-Way Slab' : '📐 Two-Way Slab'}
                        </div>

                        {/* One-way: support condition */}
                        {detectedSlabType === 'one-way' && (
                            <div className="control-group">
                                <label>Support Condition</label>
                                <select title="Select option" value={p.supportCondition}
                                    onChange={e => updatePanel(activePanel, 'supportCondition', e.target.value)} id="input-field">
                                    {SUPPORT_CONDITIONS.map(sc =>
                                        <option key={sc.value} value={sc.value}>{sc.label}</option>)}
                                </select>
                            </div>
                        )}

                        {/* Two-way: boundary case */}
                        {detectedSlabType === 'two-way' && (
                            <div className="control-group">
                                <label>Boundary Case (IS 456 Table 26)</label>
                                <select title="Select option" value={p.boundaryCase}
                                    onChange={e => updatePanel(activePanel, 'boundaryCase', +e.target.value)} id="input-field">
                                    {BOUNDARY_CASES.map(bc =>
                                        <option key={bc.case} value={bc.case}>Case {bc.case}: {bc.label}</option>)}
                            </select>
                        </div>
                        )}

                        <div className="control-group">
                            <label htmlFor="input-field">Depth D (mm)</label>
                            <input title="Value" type="number" min="75" max="500" step="5" value={p.D}
                                onChange={e => updatePanel(activePanel, 'D', +e.target.value)} id="input-field" />
                            {(() => {
                                const ratio = (p.Ly || 1) / (p.Lx || 1);
                                const autoType = ratio > 2 ? 'one-way' : 'two-way';
                                const basicR = autoType === 'one-way'
                                    ? (p.supportCondition === 'continuous' ? 26 : 20)
                                    : (p.boundaryCase === 1 ? 26 : (p.boundaryCase === 9 ? 20 : 23));
                                const ld = (p.Lx * 1000) / Math.max(1, p.D - sharedMaterial.cover - 5);
                                if (ld > basicR) {
                                    return <span className="input-validation-warn">⚠ L/d = {ld.toFixed(1)} &gt; {basicR} (basic <CodeRef clause="23.2.1">Cl. 23.2.1</CodeRef> {autoType})</span>;
                                }
                                return null;
                            })()}
                        </div>
                        <div className="control-group">
                            <label htmlFor="input-field">Initial Upward Camber (mm)</label>
                            <input title="Value" type="number" min="0" step="5" value={p.camber ?? 0}
                                onChange={e => updatePanel(activePanel, 'camber', +e.target.value)} id="input-field" />
                        </div>
                        
                        <div className="opt-panel">
                            <h4 className="opt-title">Auto-Optimize Thickness</h4>
                            <div className="flex-row-gap-8-mb-12">
                                <div className="flex-1">
                                    <label className="opt-label" htmlFor="input-field">Min (mm)</label>
                                    <input title="Value" type="number" min="75" step="5" value={minThk} onChange={e => setMinThk(+e.target.value)} className="opt-input" id="input-field" />
                                </div>
                                <div className="flex-1">
                                    <label className="opt-label" htmlFor="input-field">Max (mm)</label>
                                    <input title="Value" type="number" min="75" step="5" value={maxThk} onChange={e => setMaxThk(+e.target.value)} className="opt-input" id="input-field" />
                                </div>
                                <div className="flex-1">
                                    <label className="opt-label" htmlFor="input-field">Step (mm)</label>
                                    <input title="Value" type="number" min="5" step="5" value={thkStep} onChange={e => setThkStep(+e.target.value)} className="opt-input" id="input-field" />
                                </div>
                            </div>
                            
                            {isOptimizing ? (
                                <div>
                                    <div className="progress-header">
                                        <span>Optimizing...</span>
                                        <span>{Math.round((optProgress.done / optProgress.total) * 100) || 0}%</span>
                                    </div>
                                    <progress className="progress-bar-native" value={optProgress.done} max={optProgress.total || 1}></progress>
                                    <div className="progress-text">
                                        Evaluating {optProgress.done} / {optProgress.total} combinations
                                    </div>
                                    <button className="btn btn-danger btn-opt-cancel" onClick={cancelOptimization}>
                                        Cancel Optimization
                                    </button>
                                </div>
                            ) : (
                                <button className="btn btn-opt-run" onClick={runOptimization}>
                                    ✨ Optimize Current Panel
                                </button>
                            )}
                        </div>
                    </div>

                    {panels.length > 1 && (
                        <button className="btn btn-danger btn-remove-panel"
                            onClick={() => removePanel(activePanel)}>
                            Remove Panel {p.label}
                        </button>
                    )}
                </div>

                <button id="analyze-btn" className="btn btn-primary btn-analyze-all"
                    onClick={runAnalysis}>
                    ⚡ Analyze All Panels
                </button>
            </aside>

            {/* ───── MAIN CONTENT ───── */}
            <section className="content">
                {error && <div className="panel panel-error"><p className="text-error">{error}</p></div>}

                {r && (
                    <>
                        {/* ───── SUMMARY AND BUTTONS ───── */}
                        <div className="status-banner-container">
                            <div className={`panel status-banner status-banner-inner ${r.overallStatus === 'SAFE' ? 'status-safe' : 'status-fail'}`}>
                                <div className="status-banner-content">
                                    <div>
                                        <h2 className="status-title">{r.label} — {r.slabType === 'two-way' ? 'Two-Way Restrained' : r.slabType === 'one-way' ? 'One-Way' : 'Cantilever'} Slab</h2>
                                        <p className="status-subtitle">{r.overallStatus === 'SAFE' ? 'All IS 456 checks passed successfully.' : 'One or more IS 456 checks failed.'}</p>
                                        <div className="status-chips">
                                            <span className={`chip ${r.overallStatus === 'SAFE' ? 'chip-safe' : 'chip-fail'}`}>
                                                {r.overallStatus}
                                            </span>
                                            {r.slabType === 'cantilever' ? (
                                                <span className="chip chip-info">L = {r.Lx} m</span>
                                            ) : (
                                                <span className="chip chip-info">L<sub>y</sub>/L<sub>x</sub> = {r.lyLx}</span>
                                            )}
                                            <span className="chip chip-info">w<sub>u</sub> = {r.wFactored} kN/m²</span>
                                            {r.slabType === 'two-way' && (
                                                <span className="chip chip-info">Case {r.boundaryCase}</span>
                                            )}
                                            {r.slabType === 'one-way' && (
                                                <span className="chip chip-info">{SUPPORT_CONDITIONS.find(sc => sc.value === r.supportCondition)?.label ?? r.supportCondition}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex-row-gap-8-wrap">
                                        <button className="btn-primary btn-preview" onClick={handlePreviewReport}>
                                            <span className="btn-icon">👁</span> Preview PDF
                                        </button>
                                        <button className="btn-primary btn-download" onClick={handleDownloadReport}>
                                            <span className="btn-icon">📥</span> Download PDF
                                        </button>
                                        <button className="btn-primary btn-preview" onClick={() => exportToJSON({ panels, results }, `slab_analysis_${timestampForFilename()}`, 'Slab Design (IS 456)')} title="Export results to JSON file">
                                            <span className="btn-icon">📋</span> Export JSON
                                        </button>
                                        <button className="btn-primary btn-preview" onClick={async () => {
                                            const lines = results ? results.map((r: any, i: number) => {
                                                const p = panels[i];
                                                const shx = r.shearX;
                                                const shy = r.shearY;
                                                return `${p?.label||'S'+(i+1)}: Lx=${p?.Lx}m Ly=${p?.Ly}m D=${p?.D}mm | ShearX τv=${fmt(shx?.tau_v,3)} vs τc=${fmt(shx?.tau_c,3)} ${shx?.safe?'OK':'FAIL'} | ShearY τv=${fmt(shy?.tau_v,3)} vs τc=${fmt(shy?.tau_c,3)} ${shy?.safe?'OK':'FAIL'} | Defl=${fmt(r.deflection?.a_total,2)}/${fmt(r.deflection?.limit_total,2)}mm ${r.deflection_safe?'OK':'FAIL'}`;
                                            }) : [];
                                            const s = `SLAB DESIGN SUMMARY (IS 456:2000)\n${'='.repeat(50)}\nPanels: ${results?.length ?? 0}\n\n${lines.join('\n')}\n${'='.repeat(50)}`;
                                            const ok = await copyToClipboard(s);
                                            toast(ok ? '✅ Summary copied to clipboard' : '❌ Copy failed', { type: ok ? 'success' : 'error' });
                                        }} title="Copy key results to clipboard">
                                            <span className="btn-icon">📄</span> Copy Summary
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Moments */}
                        <div className="panel">
                            <h3 className="panel-title">
                                <span className="panel-icon">📊</span>
                                Bending Moments (kN·m/m)
                            </h3>
                            <table className="result-table">
                                <thead>
                                    <tr>
                                        <th>Direction</th>
                                        <th>Coefficient</th>
                                        <th>M<sub>u</sub> (kN·m)</th>
                                        <th>A<sub>st,req</sub> (mm²)</th>
                                        <th>Provided</th>
                                        <th>A<sub>st,prov</sub> (mm²)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td><strong>X-Bot (+ve)</strong></td>
                                        <td>{r.ax_pos !== null ? r.ax_pos : '—'}</td>
                                        <td>{r.Mx_pos}</td>
                                        <td>{r.flex_x_bot.Ast_req}</td>
                                        <td className="mono">{r.bars_x_bot.label}</td>
                                        <td>{r.bars_x_bot.Ast_provided}</td>
                                    </tr>
                                    <tr>
                                        <td><strong>Y-Bot (+ve)</strong></td>
                                        <td>{r.ay_pos !== null ? r.ay_pos : '—'}</td>
                                        <td>{r.My_pos}</td>
                                        <td>{r.flex_y_bot.Ast_req}</td>
                                        <td className="mono">{r.bars_y_bot.label}</td>
                                        <td>{r.bars_y_bot.Ast_provided}</td>
                                    </tr>
                                    <tr>
                                        <td><strong>X-Top (−ve)</strong></td>
                                        <td>{r.ax_neg !== null ? r.ax_neg : '—'}</td>
                                        <td>{r.Mx_neg}</td>
                                        <td>{r.flex_x_top.Ast_req}</td>
                                        <td className="mono">{r.bars_x_top.label}</td>
                                        <td>{r.bars_x_top.Ast_provided}</td>
                                    </tr>
                                    <tr>
                                        <td><strong>Y-Top (−ve)</strong></td>
                                        <td>{r.ay_neg !== null ? r.ay_neg : '—'}</td>
                                        <td>{r.My_neg}</td>
                                        <td>{r.flex_y_top.Ast_req}</td>
                                        <td className="mono">{r.bars_y_top.label}</td>
                                        <td>{r.bars_y_top.Ast_provided}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* Deflection Check */}
                        <div className="panel">
                            <h3 className="panel-title">
                                <span className="panel-icon">📏</span>
                                Deflection Check — IS 456 <CodeRef clause="Annex C">Annex C</CodeRef>
                            </h3>
                            <div className="defl-grid">
                                <div className="defl-section">
                                    <h4>A. Short-term Deflection</h4>
                                    <table className="result-table compact">
                                        <tbody>
                                            <tr><td>I<sub>gr</sub></td><td>{(r.deflection.Igr / 1e6).toFixed(2)} ×10⁶ mm⁴</td></tr>
                                            <tr><td>M<sub>cr</sub></td><td>{r.deflection.Mcr} kN·m</td></tr>
                                            <tr><td>I<sub>cr</sub></td><td>{(r.deflection.Icr / 1e6).toFixed(2)} ×10⁶ mm⁴</td></tr>
                                            <tr><td>I<sub>eff</sub></td><td>{(r.deflection.Ieff / 1e6).toFixed(2)} ×10⁶ mm⁴</td></tr>
                                            <tr><td>a<sub>i</sub> (short-term)</td><td><strong>{r.deflection.ai} mm</strong></td></tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div className="defl-section">
                                    <h4>B. Shrinkage</h4>
                                    <table className="result-table compact">
                                        <tbody>
                                            <tr><td>k₃</td><td>{r.deflection.k3}</td></tr>
                                            <tr><td>ψ<sub>cs</sub></td><td>{r.deflection.psi_cs.toExponential(2)}</td></tr>
                                            <tr><td>a<sub>shrinkage</sub></td><td><strong>{r.deflection.a_shrinkage} mm</strong></td></tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div className="defl-section">
                                    <h4>C. Creep</h4>
                                    <table className="result-table compact">
                                        <tbody>
                                            <tr><td>θ (creep coeff.)</td><td>{r.deflection.theta}</td></tr>
                                            <tr><td>E<sub>ce</sub></td><td>{Math.round(r.deflection.Ece)} N/mm²</td></tr>
                                            <tr><td>I<sub>cr,lt</sub></td><td>{(r.deflection.Icr_lt / 1e6).toFixed(2)} ×10⁶ mm⁴</td></tr>
                                            <tr><td>a<sub>creep</sub></td><td><strong>{r.deflection.a_creep} mm</strong></td></tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div className="defl-summary">
                                {r.deflection.camber > 0 && (
                                    <div className="defl-result defl-ok ast-style-0dbcd8">
                                        <span>Initial Upward Camber: <strong>{r.deflection.camber} mm</strong></span>
                                        <span>Applied to net deflection</span>
                                    </div>
                                )}
                                <div className={`defl-result ${r.deflection.status_total === 'OK' ? 'defl-ok' : 'defl-fail'}`}>
                                    <span>{r.deflection.camber > 0 ? 'Net Total' : 'Total'}: {r.deflection.a_total} mm</span>
                                    <span>Limit (L/250): {r.deflection.limit_total} mm</span>
                                    <span className={`chip ${r.deflection.status_total === 'OK' ? 'chip-safe' : 'chip-fail'}`}>
                                        {r.deflection.status_total}
                                    </span>
                                </div>
                                <div className={`defl-result ${r.deflection.status_post === 'OK' ? 'defl-ok' : 'defl-fail'}`}>
                                    <span>{r.deflection.camber > 0 ? 'Net Post-construction' : 'Post-construction'}: {r.deflection.a_post_construction} mm</span>
                                    <span>Limit (L/350 or 20mm): {r.deflection.limit_post} mm</span>
                                    <span className={`chip ${r.deflection.status_post === 'OK' ? 'chip-safe' : 'chip-fail'}`}>
                                        {r.deflection.status_post}
                                    </span>
                                </div>
                            </div>
                            {/* Deflection Utilization Bar */}
                            <div className="defl-util-bar">
                                <div className="defl-util-label">
                                    <span>Total deflection utilization</span>
                                    <span>{(r.deflection.a_total / r.deflection.limit_total * 100).toFixed(1)}%</span>
                                </div>
                                <style>{`
                                    .defl-dynamic-width-normal {
                                        width: ${Math.min(100, r.deflection.a_total / r.deflection.limit_total * 100)}%;
                                    }
                                `}</style>
                                <div className="defl-util-track">
                                    <div
                                        className={`defl-util-fill defl-dynamic-width-normal ${r.deflection.a_total / r.deflection.limit_total <= 0.7 ? 'ok' : r.deflection.a_total / r.deflection.limit_total <= 0.9 ? 'warn' : 'fail'}`}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Span/Depth Ratio */}
                        <div className="panel">
                            <h3 className="panel-title">
                                <span className="panel-icon">📐</span>
                                Span/Depth Ratio — IS 456 <CodeRef clause="23.2">Cl. 23.2</CodeRef>
                            </h3>
                            <table className="result-table compact">
                                <tbody>
                                    <tr><td>Basic l/d</td><td>{r.ldCheck.basicRatio}</td></tr>
                                    <tr><td>f<sub>s</sub></td><td>{r.ldCheck.fs} N/mm²</td></tr>
                                    <tr><td>Modification Factor</td><td>{r.ldCheck.mf}</td></tr>
                                    <tr><td>Modified l/d</td><td>{r.ldCheck.modifiedRatio}</td></tr>
                                    <tr><td>d<sub>req</sub></td><td>{r.ldCheck.d_req} mm</td></tr>
                                    <tr><td>d<sub>provided</sub></td><td>{r.ldCheck.d_provided} mm</td></tr>
                                    <tr>
                                        <td>Status</td>
                                        <td>
                                            <span className="text-ignored">
                                                IGNORED
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                            <div className="ld-note">
                                Simplified L/d check is informational only — the rigorous IS 456 <CodeRef clause="Annex C">Annex C</CodeRef> deflection calculation governs the design.
                            </div>
                        </div>

                        {/* Flexural Depth */}
                        {r.flexDepthCheck && (
                        <div className="panel">
                            <h3 className="panel-title">
                                <span className="panel-icon">📐</span>
                                Flexural Depth — IS 456 <CodeRef clause="Annex G">Annex G</CodeRef>
                            </h3>
                            <table className="result-table compact">
                                <tbody>
                                    <tr><td>M<sub>u,max</sub></td><td>{r.flexDepthCheck.Mu_max} kN·m</td></tr>
                                    <tr><td>R<sub>u</sub></td><td>{(r.flexDepthCheck.coeff * r.fck).toFixed(2)} N/mm²</td></tr>
                                    <tr><td>d<sub>req</sub></td><td>{r.flexDepthCheck.d_req} mm</td></tr>
                                    <tr><td>d<sub>provided</sub></td><td>{r.flexDepthCheck.d_provided} mm</td></tr>
                                    <tr>
                                        <td>Status</td>
                                        <td>
                                            <span className={`chip ${r.flexDepthCheck.status === 'OK' ? 'chip-safe' : 'chip-fail'}`}>
                                                {r.flexDepthCheck.status}
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        )}

                        {/* Shear Check */}
                        <div className="panel">
                            <h3 className="panel-title">
                                <span className="panel-icon">⚔️</span>
                                Shear Check — IS 456 <CodeRef clause="40.1.1">Cl. 40</CodeRef> (at d<sub>eff</sub> from face of support)
                            </h3>
                            <div className="shear-info-note">
                                Per IS 456 <CodeRef clause="40.1.1">Cl. 40.1.1</CodeRef>, the critical section for shear is at a distance d<sub>eff</sub>
                                from the face of the support. V<sub>u,crit</sub> = V<sub>u,support</sub> − w·d<sub>eff</sub> governs the τ<sub>v</sub> check.
                            </div>
                            <table className="result-table">
                                <thead>
                                    <tr>
                                        <th>Direction</th>
                                        <th>V<sub>u</sub> support (kN)</th>
                                        <th>d<sub>eff</sub> (mm)</th>
                                        <th>V<sub>u,crit</sub> (kN)</th>
                                        <th>τ<sub>v</sub> (N/mm²)</th>
                                        <th>k·τ<sub>c</sub></th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>Short (L<sub>x</sub>)</td>
                                        <td>{r.shear.shortDir.Vu}</td>
                                        <td>{r.shear.shortDir.d_eff}</td>
                                        <td><strong>{r.shear.shortDir.Vu_critical}</strong></td>
                                        <td>{r.shear.shortDir.tau_v}</td>
                                        <td>{r.shear.shortDir.allowable}</td>
                                        <td>
                                            <span className={`chip ${r.shear.shortDir.status === 'OK' ? 'chip-safe' : 'chip-fail'}`}>
                                                {r.shear.shortDir.status}
                                            </span>
                                        </td>
                                    </tr>
                                    {r.slabType === 'two-way' && (
                                        <tr>
                                            <td>Long (L<sub>y</sub>)</td>
                                            <td>{r.shear.longDir.Vu}</td>
                                            <td>{r.shear.longDir.d_eff}</td>
                                            <td><strong>{r.shear.longDir.Vu_critical}</strong></td>
                                            <td>{r.shear.longDir.tau_v}</td>
                                            <td>{r.shear.longDir.allowable}</td>
                                            <td>
                                                <span className={`chip ${r.shear.longDir.status === 'OK' ? 'chip-safe' : 'chip-fail'}`}>
                                                    {r.shear.longDir.status}
                                                </span>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Multi-panel summary */}
                        {results && results.length > 1 && (
                            <div className="panel">
                                <h3 className="panel-title">
                                    <span className="panel-icon">📋</span>
                                    All Panels Summary
                                </h3>
                                <table className="result-table">
                                    <thead>
                                        <tr>
                                            <th>Panel</th>
                                            <th>Type</th>
                                            <th>L<sub>x</sub>×L<sub>y</sub></th>
                                            <th>D</th>
                                            <th>Steel</th>
                                            <th>Deflection</th>
                                            <th>Shear</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {results.map((res: any, i: number) => (
                                            <tr key={i} className={`cursor-pointer ${i === activePanel ? 'row-active' : ''}`}
                                                onClick={() => setActivePanel(i)}>
                                                <td><strong>{res.label}</strong></td>
                                                <td>{res.slabType}</td>
                                                <td>{res.Lx}×{res.Ly}</td>
                                                <td>{res.D}mm</td>
                                                <td><span className={`chip ${res.steelStatus === 'SAFE' ? 'chip-safe' : 'chip-fail'}`}>{res.steelStatus}</span></td>
                                                <td><span className={`chip ${res.deflStatus === 'OK' ? 'chip-safe' : 'chip-fail'}`}>{res.deflStatus}</span></td>
                                                <td><span className={`chip ${res.shearStatus === 'OK' ? 'chip-safe' : 'chip-fail'}`}>{res.shearStatus}</span></td>
                                                <td><span className={`chip ${res.overallStatus === 'SAFE' ? 'chip-safe' : 'chip-fail'}`}>{res.overallStatus}</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {/* PDF Preview Modal */}
                        {pdfPreviewUrl && (
                            <div className="pdf-preview-overlay" onClick={() => setPdfPreviewUrl(null)}>
                                <div className="pdf-preview-modal" onClick={e => e.stopPropagation()}>
                                    <div className="pdf-preview-header">
                                        <h3>PDF Report Preview</h3>
                                        <div className="flex-row-gap-8">
                                            <button className="btn-primary btn-download-modal" onClick={handleDownloadReport}>
                                                📥 Download
                                            </button>
                                            <button className="btn-close-modal" onClick={() => setPdfPreviewUrl(null)}>
                                                ✕ Close
                                            </button>
                                        </div>
                                    </div>
                                    <iframe
                                        src={pdfPreviewUrl}
                                        className="iframe-modal"
                                        title="PDF Preview"
                                    />
                                </div>
                            </div>
                        )}
                    </>
                )}

                {!results && (
                    <div className="panel modal-empty">
                        <div className="modal-empty-icon">🏗️</div>
                        <h2 className="modal-empty-title">Slab Designer</h2>
                        <p className="modal-empty-subtitle">Configure panels in the sidebar and click <strong>Analyze All Panels</strong></p>
                        <p className="modal-empty-text">
                            Supports two-way restrained (IS 456 Table 26), one-way, and cantilever slabs
                        </p>
                        <div className="modal-empty-features">
                            <div className="modal-empty-feature">
                                <span className="modal-empty-feature-icon">📏</span>
                                <span>Shear at d<sub>eff</sub> (<CodeRef clause="40.1.1">Cl. 40.1.1</CodeRef>)</span>
                            </div>
                            <div className="modal-empty-feature">
                                <span className="modal-empty-feature-icon">📐</span>
                                <span>Span/Depth ratio (<CodeRef clause="23.2">Cl. 23.2</CodeRef>)</span>
                            </div>
                            <div className="modal-empty-feature">
                                <span className="modal-empty-feature-icon">📋</span>
                                <span>Annex C deflection check</span>
                            </div>
                            <div className="modal-empty-feature">
                                <span className="modal-empty-feature-icon">⚡</span>
                                <span>Auto-optimize thickness</span>
                            </div>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
