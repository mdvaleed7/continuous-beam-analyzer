"use client";

import React, { useState, useCallback } from 'react';
import { analyzeFlatSlab, optimizeFlatSlab, FlatSlabInput, FlatSlabOptimizeParams } from './flatSlabEngine';
import CodeRef from './CodeRef';
import { generateFlatSlabPDF } from './flatSlabReportGenerator';
import { exportToJSON, timestampForFilename, copyToClipboard, fmt } from '../lib/exportResults';
import { useToast } from './ToastProvider';

export default function FlatSlabAnalyzer() {
    const { toast } = useToast();
    const [input, setInput] = useState<FlatSlabInput>({
        L1: 6.0,
        L2: 6.0,
        c1: 0.5,
        c2: 0.5,
        hasDrop: false,
        dropL1: 2.0,
        dropL2: 2.0,
        dropDepth: 250,
        D: 200,
        cover: 20,
        fck: 25,
        fy: 500,
        w_live: 4.0,
        w_finish: 1.5,
        panelType: 'interior',
        camber: 0,
    });

    const results = analyzeFlatSlab(input);

    // ── Optimizer state ──
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optProgress, setOptProgress] = useState({ done: 0, total: 0, feasible: 0 });
    const [optResult, setOptResult] = useState<ReturnType<typeof optimizeFlatSlab> | null>(null);
    const [optParams, setOptParams] = useState<FlatSlabOptimizeParams>({
        minD: 150, maxD: 350, stepD: 25,
    });

    const runOptimization = useCallback(() => {
        setIsOptimizing(true);
        setOptProgress({ done: 0, total: 0, feasible: 0 });
        setOptResult(null);
        // Run in a microtask so the UI can paint the "optimizing" state.
        setTimeout(() => {
            try {
                const params: FlatSlabOptimizeParams = {
                    ...optParams,
                    ...(input.hasDrop ? { minDropDepth: input.D + 50, maxDropDepth: input.D + 250, stepDropDepth: 25 } : {}),
                };
                const res = optimizeFlatSlab(input, params, undefined, (done, total, feasible) => {
                    setOptProgress({ done, total, feasible });
                });
                setOptResult(res);
                // Apply the optimum to the inputs so the user sees it.
                if (res.optimum) {
                    setInput(prev => ({
                        ...prev,
                        D: res.optimum!.D,
                        dropDepth: res.optimum!.dropDepth,
                        bar_dia: res.optimum!.bar_dia,
                        bar_spacing: res.optimum!.bar_spacing,
                        camber: res.optimum!.camber,
                    }));
                }
            } finally {
                setIsOptimizing(false);
            }
        }, 50);
    }, [input, optParams]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        if (type === 'checkbox') {
            const checked = (e.target as HTMLInputElement).checked;
            setInput(prev => ({ ...prev, [name]: checked }));
        } else if (name === 'panelType') {
            setInput(prev => ({ ...prev, [name]: value as 'interior' | 'exterior' }));
        } else if (name === 'deflectionSupport') {
            setInput(prev => ({ ...prev, [name]: value as 'continuous' | 'simply' | 'one_end' }));
        } else if (name === 'grade') {
            const fck = parseInt(value.replace('M', ''));
            setInput(prev => ({ ...prev, grade: value, fck }));
        } else if (name === 'steelGrade') {
            const fy = parseInt(value.replace('Fe', ''));
            setInput(prev => ({ ...prev, steelGrade: value, fy }));
        } else {
            setInput(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
        }
    };

    const safe = results.overallStatus === 'SAFE';

    return (
        <div className="layout">
            {/* ───── SIDEBAR ───── */}
            <aside className="sidebar">
                <div className="panel">
                    <h3 className="panel-title">
                        <span className="panel-icon">🏗</span>
                        Panel &amp; Loads
                    </h3>
                    <div className="control-group">
                        <label htmlFor="L1">Span L1 (m)</label>
                        <input title="L1" type="number" name="L1" value={input.L1} onChange={handleInputChange} id="L1" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="L2">Span L2 (m)</label>
                        <input title="L2" type="number" name="L2" value={input.L2} onChange={handleInputChange} id="L2" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="D">Slab Depth D (mm)</label>
                        <input title="D" type="number" name="D" value={input.D} onChange={handleInputChange} id="D" />
                        {input.D < 125 && <span className="input-validation-warn">⚠ D &lt; 125 mm violates IS 456 <CodeRef clause="31.2.1">Cl. 31.2.1</CodeRef></span>}
                    </div>
                    <div className="control-group">
                        <label htmlFor="cover">Clear Cover (mm)</label>
                        <input title="cover" type="number" name="cover" value={input.cover} onChange={handleInputChange} id="cover" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="camber">Initial Upward Camber (mm)</label>
                        <input title="camber" type="number" min="0" step="5" name="camber" value={input.camber ?? 0} onChange={handleInputChange} id="camber" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="w_live">Live Load (kN/m²)</label>
                        <input title="w_live" type="number" name="w_live" value={input.w_live} onChange={handleInputChange} id="w_live" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="w_finish">Floor Finish (kN/m²)</label>
                        <input title="w_finish" type="number" name="w_finish" value={input.w_finish} onChange={handleInputChange} id="w_finish" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="grade">Concrete Grade</label>
                        <select title="grade" name="grade" value={input.grade || `M${input.fck}`} onChange={handleInputChange} id="grade">
                            {['M20', 'M25', 'M30', 'M35', 'M40'].map(g =>
                                <option key={g} value={g}>{g} (f_ck={g.replace('M', '')})</option>)}
                        </select>
                    </div>
                    <div className="control-group">
                        <label htmlFor="steelGrade">Steel Grade</label>
                        <select title="steelGrade" name="steelGrade" value={input.steelGrade || `Fe${input.fy}`} onChange={handleInputChange} id="steelGrade">
                            {['Fe250', 'Fe415', 'Fe500', 'Fe550'].map(s =>
                                <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div className="control-group">
                        <label>Panel Type</label>
                        <select title="panelType" name="panelType" value={input.panelType} onChange={handleInputChange} id="panelType">
                            <option value="interior">Interior Panel</option>
                            <option value="exterior">Exterior Panel</option>
                        </select>
                    </div>
                    <div className="control-group">
                        <label>Deflection Support Condition (Annex C)</label>
                        <select title="deflectionSupport" name="deflectionSupport" value={input.deflectionSupport || 'continuous'} onChange={handleInputChange} id="deflectionSupport">
                            <option value="continuous">Continuous (both ends) — α=1/16, k₃=0.063</option>
                            <option value="one_end">One-end continuous — α=1/12, k₃=0.086</option>
                            <option value="simply">Simply supported — α=5/48, k₃=0.125</option>
                        </select>
                    </div>
                    <div className="control-group">
                        <label htmlFor="bar_dia">Reinf. Bar Ø (mm) — col. strip bot</label>
                        <input title="bar_dia" type="number" name="bar_dia" value={input.bar_dia || 12} onChange={handleInputChange} id="bar_dia" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="bar_spacing">Reinf. Spacing (mm) — col. strip bot</label>
                        <input title="bar_spacing" type="number" name="bar_spacing" value={input.bar_spacing || 150} onChange={handleInputChange} id="bar_spacing" />
                    </div>
                </div>

                <div className="panel">
                    <h3 className="panel-title">
                        <span className="panel-icon">🏛</span>
                        Columns &amp; Drops
                    </h3>
                    <div className="control-group">
                        <label htmlFor="c1">Column c1 (m)</label>
                        <input title="c1" type="number" step="0.1" name="c1" value={input.c1} onChange={handleInputChange} id="c1" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="c2">Column c2 (m)</label>
                        <input title="c2" type="number" step="0.1" name="c2" value={input.c2} onChange={handleInputChange} id="c2" />
                    </div>
                    <div className="control-group">
                        <label className="opt-label extracted-style-81" htmlFor="hasDrop" >
                            <input title="hasDrop" type="checkbox" name="hasDrop" checked={input.hasDrop} onChange={handleInputChange} id="hasDrop" />
                            Include Drop Panel
                        </label>
                    </div>
                    {input.hasDrop && (
                        <>
                            <div className="control-group">
                                <label htmlFor="dropL1">Drop L1 (m)</label>
                                <input title="dropL1" type="number" step="0.1" name="dropL1" value={input.dropL1} onChange={handleInputChange} id="dropL1" />
                            </div>
                            <div className="control-group">
                                <label htmlFor="dropL2">Drop L2 (m)</label>
                                <input title="dropL2" type="number" step="0.1" name="dropL2" value={input.dropL2} onChange={handleInputChange} id="dropL2" />
                            </div>
                            <div className="control-group">
                                <label htmlFor="dropDepth">Drop Total Depth (mm)</label>
                                <input title="dropDepth" type="number" name="dropDepth" value={input.dropDepth} onChange={handleInputChange} id="dropDepth" />
                            </div>
                        </>
                    )}
                </div>

                <div className="panel">
                    <div className="opt-panel extracted-style-82" >
                        <h4 className="opt-title">Auto-Optimize Depth</h4>
                        <div className="flex-row-gap-8-mb-12">
                            <div className="flex-1">
                                <label className="opt-label" htmlFor="opt-minD">Min D (mm)</label>
                                <input title="Min D" type="number" value={optParams.minD} onChange={e => setOptParams(p => ({ ...p, minD: +e.target.value }))} className="opt-input" id="opt-minD" />
                            </div>
                            <div className="flex-1">
                                <label className="opt-label" htmlFor="opt-maxD">Max D (mm)</label>
                                <input title="Max D" type="number" value={optParams.maxD} onChange={e => setOptParams(p => ({ ...p, maxD: +e.target.value }))} className="opt-input" id="opt-maxD" />
                            </div>
                            <div className="flex-1">
                                <label className="opt-label" htmlFor="opt-stepD">Step D (mm)</label>
                                <input title="Step D" type="number" value={optParams.stepD} onChange={e => setOptParams(p => ({ ...p, stepD: +e.target.value }))} className="opt-input" id="opt-stepD" />
                            </div>
                        </div>

                        {isOptimizing ? (
                            <div>
                                <div className="progress-header">
                                    <span>Optimizing…</span>
                                    <span>{optProgress.total ? Math.round((optProgress.done / optProgress.total) * 100) : 0}%</span>
                                </div>
                                <progress className="progress-bar-native" value={optProgress.done} max={optProgress.total || 1} />
                                <div className="progress-text">
                                    Evaluating {optProgress.done}/{optProgress.total} ({optProgress.feasible} feasible)
                                </div>
                            </div>
                        ) : (
                            <button className="btn-opt-run" onClick={runOptimization}>✨ Optimize</button>
                        )}
                    </div>
                </div>
            </aside>

            {/* ───── MAIN CONTENT ───── */}
            <section className="content">
                {results && (
                    <>
                        {/* ───── STATUS BANNER ───── */}
                        <div className="status-banner-container">
                            <div className={`panel status-banner status-banner-inner ${safe ? 'status-safe' : 'status-fail'}`}>
                                <div className="status-banner-content">
                                    <div>
                                        <h2 className="status-title">Flat Slab — {input.panelType === 'interior' ? 'Interior' : 'Exterior'} Panel {input.L1}×{input.L2} m</h2>
                                        <p className="status-subtitle">{safe ? 'All IS 456 checks passed successfully.' : 'One or more IS 456 checks failed.'}</p>
                                        <div className="status-chips">
                                            <span className={`chip ${safe ? 'chip-safe' : 'chip-fail'}`}>{results.overallStatus}</span>
                                            <span className="chip chip-info">W = {results.W.toFixed(1)} kN</span>
                                            <span className="chip chip-info">M₀ = {results.M0.toFixed(1)} kN·m</span>
                                            <span className="chip chip-info">w<sub>u</sub> = {results.wu.toFixed(2)} kN/m²</span>
                                        </div>
                                    </div>
                                    <div className="flex-row-gap-8-wrap">
                                        <button className="btn-primary btn-preview" onClick={() => generateFlatSlabPDF(input, results, true)}>
                                            <span className="btn-icon">👁</span> Preview PDF
                                        </button>
                                        <button className="btn-primary btn-download" onClick={() => generateFlatSlabPDF(input, results, false)}>
                                            <span className="btn-icon">📥</span> Download PDF
                                        </button>
                                        <button className="btn-primary btn-preview" onClick={() => exportToJSON({ input, results }, `flat_slab_${timestampForFilename()}`, 'Flat Slab Design (IS 456 DDM)')} title="Export results to JSON file">
                                            <span className="btn-icon">📋</span> Export JSON
                                        </button>
                                        <button className="btn-primary btn-preview" onClick={async () => {
                                            const s = `FLAT SLAB DESIGN SUMMARY (IS 456:2000 DDM)\n${'='.repeat(50)}\nSpan: ${input.L1}×${input.L2}m | D=${input.D}mm | fck=${input.fck} | fy=${input.fy}\nPanel: ${input.panelType} | Drop: ${input.hasDrop ? 'Yes' : 'No'}\n\nStatic Moment M0: ${fmt(results.M0,1)} kN·m\nPunching Shear: τv=${fmt(results.tau_v,3)} vs τc=${fmt(results.tau_c,3)} N/mm² → ${results.punching_safe ? 'SAFE' : 'FAIL'}\nDeflection: ${fmt(results.deflection.a_total,2)}mm vs ${fmt(results.deflection.limit_total,2)}mm → ${results.deflection_safe ? 'SAFE' : 'FAIL'}\nSpan/Depth: d_prov=${results.ldCheck.d_provided}mm vs d_req=${results.ldCheck.d_req}mm → IGNORED (Annex C governs)\nOverall Status: ${results.overallStatus}\n${'='.repeat(50)}`;
                                            const ok = await copyToClipboard(s);
                                            toast(ok ? '✅ Summary copied to clipboard' : '❌ Copy failed', { type: ok ? 'success' : 'error' });
                                        }} title="Copy key results to clipboard">
                                            <span className="btn-icon">📄</span> Copy Summary
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Punching Shear */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">⚔️</span>Punching Shear — IS 456 <CodeRef clause="31.6">Cl. 31.6</CodeRef></h3>
                            <table className="result-table">
                                <thead>
                                    <tr>
                                        <th>τ<sub>v</sub> (N/mm²)</th>
                                        <th>τ<sub>c</sub> (N/mm²)</th>
                                        <th>Crit. Perimeter (m)</th>
                                        <th>V<sub>u</sub> (kN)</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>{results.tau_v.toFixed(2)}</td>
                                        <td>{results.tau_c.toFixed(2)}</td>
                                        <td>{results.crit_perimeter.toFixed(2)}</td>
                                        <td>{results.shear_force.toFixed(1)}</td>
                                        <td><span className={`chip ${results.punching_safe ? 'chip-safe' : 'chip-fail'}`}>{results.punching_safe ? 'OK' : 'FAIL'}</span></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* Column & Middle Strip Moments */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">📊</span>Strip Moments &amp; Steel</h3>
                            <table className="result-table">
                                <thead>
                                    <tr>
                                        <th>Strip</th>
                                        <th>Width (m)</th>
                                        <th>M<sub>neg</sub> (kN·m)</th>
                                        <th>Ast<sub>neg</sub> (mm²)</th>
                                        <th>M<sub>pos</sub> (kN·m)</th>
                                        <th>Ast<sub>pos</sub> (mm²)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>Column</td>
                                        <td>{results.colStripWidth.toFixed(2)}</td>
                                        <td>{results.M_neg_col.toFixed(1)}</td>
                                        <td>{Number.isNaN(results.Ast_neg_col) ? <span className="chip chip-fail">Fails</span> : results.Ast_neg_col.toFixed(0)}</td>
                                        <td>{results.M_pos_col.toFixed(1)}</td>
                                        <td>{Number.isNaN(results.Ast_pos_col) ? <span className="chip chip-fail">Fails</span> : results.Ast_pos_col.toFixed(0)}</td>
                                    </tr>
                                    <tr>
                                        <td>Middle</td>
                                        <td>{results.midStripWidth.toFixed(2)}</td>
                                        <td>{results.M_neg_mid.toFixed(1)}</td>
                                        <td>{Number.isNaN(results.Ast_neg_mid) ? <span className="chip chip-fail">Fails</span> : results.Ast_neg_mid.toFixed(0)}</td>
                                        <td>{results.M_pos_mid.toFixed(1)}</td>
                                        <td>{Number.isNaN(results.Ast_pos_mid) ? <span className="chip chip-fail">Fails</span> : results.Ast_pos_mid.toFixed(0)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* Deflection Check */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">📏</span>Deflection Check — IS 456 <CodeRef clause="Annex C">Annex C</CodeRef></h3>
                            <div className="defl-grid">
                                <div className="defl-section">
                                    <h4>A. Short-term Deflection</h4>
                                    <table className="result-table compact">
                                        <tbody>
                                            <tr><td>I<sub>gr</sub></td><td>{(results.deflection.Igr / 1e6).toFixed(2)} ×10⁶ mm⁴</td></tr>
                                            <tr><td>M<sub>cr</sub></td><td>{results.deflection.Mcr} kN·m</td></tr>
                                            <tr><td>I<sub>eff</sub></td><td>{(results.deflection.Ieff / 1e6).toFixed(2)} ×10⁶ mm⁴</td></tr>
                                            <tr><td>a<sub>i</sub> (short-term)</td><td><strong>{results.deflection.ai} mm</strong></td></tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div className="defl-section">
                                    <h4>B. Shrinkage</h4>
                                    <table className="result-table compact">
                                        <tbody>
                                            <tr><td>k₃</td><td>{results.deflection.k3}</td></tr>
                                            <tr><td>ψ<sub>cs</sub></td><td>{results.deflection.psi_cs.toExponential(2)}</td></tr>
                                            <tr><td>a<sub>shrinkage</sub></td><td><strong>{results.deflection.a_shrinkage} mm</strong></td></tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div className="defl-section">
                                    <h4>C. Creep</h4>
                                    <table className="result-table compact">
                                        <tbody>
                                            <tr><td>θ (creep coeff.)</td><td>{results.deflection.theta}</td></tr>
                                            <tr><td>E<sub>ce</sub></td><td>{Math.round(results.deflection.Ece)} N/mm²</td></tr>
                                            <tr><td>I<sub>cr,lt</sub></td><td>{(results.deflection.Icr_lt / 1e6).toFixed(2)} ×10⁶ mm⁴</td></tr>
                                            <tr><td>a<sub>creep</sub></td><td><strong>{results.deflection.a_creep} mm</strong></td></tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div className="defl-summary">
                                {results.deflection.camber > 0 && (
                                    <div className="defl-result defl-ok">
                                        <span>Initial Upward Camber: <strong>{results.deflection.camber} mm</strong></span>
                                        <span>Applied to net deflection</span>
                                    </div>
                                )}
                                <div className={`defl-result ${results.deflection.status_total === 'OK' ? 'defl-ok' : 'defl-fail'}`}>
                                    <span>{results.deflection.camber > 0 ? 'Net Total' : 'Total'}: {results.deflection.a_total} mm</span>
                                    <span>Limit (L/250): {results.deflection.limit_total} mm</span>
                                    <span className={`chip ${results.deflection.status_total === 'OK' ? 'chip-safe' : 'chip-fail'}`}>
                                        {results.deflection.status_total}
                                    </span>
                                </div>
                                <div className={`defl-result ${results.deflection.status_post === 'OK' ? 'defl-ok' : 'defl-fail'}`}>
                                    <span>{results.deflection.camber > 0 ? 'Net Post-construction' : 'Post-construction'}: {results.deflection.a_post_construction} mm</span>
                                    <span>Limit (L/350 or 20mm): {results.deflection.limit_post} mm</span>
                                    <span className={`chip ${results.deflection.status_post === 'OK' ? 'chip-safe' : 'chip-fail'}`}>
                                        {results.deflection.status_post}
                                    </span>
                                </div>
                            </div>
                            {/* Deflection Utilization Bar */}
                            <div className="defl-util-bar">
                                <div className="defl-util-label">
                                    <span>Total deflection utilization</span>
                                    <span>{(results.deflection.a_total / results.deflection.limit_total * 100).toFixed(1)}%</span>
                                </div>
                                <style>{`
                                    .defl-dynamic-width-flat {
                                        width: ${Math.min(100, results.deflection.a_total / results.deflection.limit_total * 100)}%;
                                    }
                                `}</style>
                                <div className="defl-util-track">
                                    <div
                                        className={`defl-util-fill defl-dynamic-width-flat ${results.deflection.a_total / results.deflection.limit_total <= 0.7 ? 'ok' : results.deflection.a_total / results.deflection.limit_total <= 0.9 ? 'warn' : 'fail'}`}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Span/Depth Ratio — IS 456 Cl. 23.2 (informational, IGNORED) */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">📐</span>Span/Depth Ratio — IS 456 <CodeRef clause="23.2">Cl. 23.2</CodeRef></h3>
                            <table className="result-table compact">
                                <tbody>
                                    <tr><td>Basic l/d</td><td>{results.ldCheck.basicRatio}</td></tr>
                                    <tr><td>f<sub>s</sub></td><td>{results.ldCheck.fs} N/mm²</td></tr>
                                    <tr><td>Modification Factor</td><td>{results.ldCheck.mf}</td></tr>
                                    <tr><td>Modified l/d</td><td>{results.ldCheck.modifiedRatio}</td></tr>
                                    <tr><td>d<sub>req</sub></td><td>{results.ldCheck.d_req} mm</td></tr>
                                    <tr><td>d<sub>provided</sub></td><td>{results.ldCheck.d_provided} mm</td></tr>
                                    <tr>
                                        <td>Status</td>
                                        <td><span className="text-ignored">IGNORED</span></td>
                                    </tr>
                                </tbody>
                            </table>
                            <div className="ld-note">
                                Simplified L/d check is informational only — the rigorous IS 456 <CodeRef clause="Annex C">Annex C</CodeRef> deflection calculation governs the design.
                            </div>
                        </div>

                        {/* IS 456 code checks */}
                        {(results.dropChecks || results.barChecks) && (
                            <div className="panel">
                                <h3 className="panel-title"><span className="panel-icon">📐</span>IS 456 Code Checks</h3>
                                <table className="result-table">
                                    <thead>
                                        <tr><th>Check</th><th>Detail</th><th>Status</th></tr>
                                    </thead>
                                    <tbody>
                                        {results.dropChecks && (
                                            <>
                                                <tr>
                                                    <td>Drop Panel Depth ≥ 1.25·D (<CodeRef clause="31.4.1">Cl. 31.4</CodeRef>)</td>
                                                    <td>{input.dropDepth}mm vs {Math.ceil(1.25 * input.D)}mm</td>
                                                    <td><span className={`chip ${results.dropChecks.depthOk ? 'chip-safe' : 'chip-fail'}`}>{results.dropChecks.depthOk ? 'OK' : 'REVISE'}</span></td>
                                                </tr>
                                                <tr>
                                                    <td>Drop Width ≥ L/6 (<CodeRef clause="31.4.1">Cl. 31.4</CodeRef>)</td>
                                                    <td>{input.dropL1}×{input.dropL2}m vs {(input.L1 / 6).toFixed(2)}m</td>
                                                    <td><span className={`chip ${results.dropChecks.widthOk ? 'chip-safe' : 'chip-fail'}`}>{results.dropChecks.widthOk ? 'OK' : 'REVISE'}</span></td>
                                                </tr>
                                                <tr>
                                                    <td>Drop Slope ≤ 45° (<CodeRef clause="31.4.1">Cl. 31.4</CodeRef>)</td>
                                                    <td>{results.dropChecks.slopeOk ? 'Within limit' : 'Too steep'}</td>
                                                    <td><span className={`chip ${results.dropChecks.slopeOk ? 'chip-safe' : 'chip-fail'}`}>{results.dropChecks.slopeOk ? 'OK' : 'REVISE'}</span></td>
                                                </tr>
                                            </>
                                        )}
                                        {results.barChecks && (
                                            <>
                                                <tr>
                                                    <td>Max Bar Ø ≤ D/8 (<CodeRef clause="26.3.3">Cl. 26.3.3</CodeRef>)</td>
                                                    <td>≤ {results.barChecks.maxBarDia}mm</td>
                                                    <td><span className={`chip ${results.barChecks.astFeasible ? 'chip-safe' : 'chip-fail'}`}>{results.barChecks.astFeasible ? 'OK' : 'REVISE'}</span></td>
                                                </tr>
                                                <tr>
                                                    <td>Max Spacing ≤ 3d or 300mm</td>
                                                    <td>≤ {results.barChecks.maxSpacingMain}mm</td>
                                                    <td><span className={`chip ${results.barChecks.astFeasible ? 'chip-safe' : 'chip-fail'}`}>{results.barChecks.astFeasible ? 'OK' : 'REVISE'}</span></td>
                                                </tr>
                                            </>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* Optimizer results */}
                        {optResult && (
                            <div className="panel">
                                <h3 className="panel-title"><span className="panel-icon">⚙</span>Optimizer Results</h3>
                                {optResult.optimum ? (
                                    <>
                                        <div className="defl-summary">
                                            <div className="defl-result defl-ok">
                                                <span><strong>✓ Optimum:</strong> D = {optResult.optimum.D} mm, Drop = {optResult.optimum.dropDepth} mm, Bar: Ø{optResult.optimum.bar_dia}@{optResult.optimum.bar_spacing}</span>
                                                <span className="chip chip-info">Total Cost = ₹{Math.round(optResult.optimum.costTotal_INR).toLocaleString('en-IN')}</span>
                                            </div>
                                            <div className="defl-result">
                                                <span>Concrete: {optResult.optimum.concreteVol.toFixed(3)} m³</span>
                                                <span>Steel: {optResult.optimum.steelWeight_gross.toFixed(2)} kg (incl. wastage)</span>
                                            </div>
                                        </div>
                                        {optResult.optimum.camber > 0 && (
                                            <div className="defl-result defl-warn extracted-style-83" >
                                                <span><strong>Optimizer Note:</strong> An upward camber of <strong>{optResult.optimum.camber.toFixed(1)} mm</strong> is required to satisfy long-term deflection.</span>
                                            </div>
                                        )}
                                        <table className="result-table">
                                            <thead>
                                                <tr>
                                                    <th>Rank</th><th>D</th><th>Drop D</th><th>Bar</th><th>Sp.</th>
                                                    <th>Util (Flx | Sh | Defl)</th><th>Camber</th><th>Cost (₹)</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {optResult.topDesigns.map((d, i) => (
                                                    <tr key={i}>
                                                        <td>{i + 1}</td>
                                                        <td>{d.D}</td>
                                                        <td>{d.dropDepth}</td>
                                                        <td>Ø{d.bar_dia}</td>
                                                        <td>{d.bar_spacing}</td>
                                                        <td>
                                                            <span className={`chip ${d.utilizationRatio.flexure > 0.95 ? 'chip-warn' : 'chip-safe'}`}>F: {d.utilizationRatio.flexure.toFixed(2)}</span>
                                                            <span className={`chip ${d.utilizationRatio.shear > 0.95 ? 'chip-warn' : 'chip-safe'}`}>S: {d.utilizationRatio.shear.toFixed(2)}</span>
                                                            <span className={`chip ${d.utilizationRatio.deflection > 0.95 ? 'chip-warn' : 'chip-safe'}`}>D: {d.utilizationRatio.deflection.toFixed(2)}</span>
                                                        </td>
                                                        <td>{d.camber > 0 ? `${d.camber.toFixed(1)}mm` : 'None'}</td>
                                                        <td>₹{Math.round(d.costTotal_INR).toLocaleString('en-IN')}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        <p className="progress-text">{optResult.feasibleCount} feasible designs out of {optResult.totalTrials} trials. Optimum applied to inputs above.</p>
                                    </>
                                ) : (
                                    <p className="text-error">No feasible design found in the given range. Widen the ranges or revise loads.</p>
                                )}
                            </div>
                        )}
                    </>
                )}
            </section>
        </div>
    );
}

