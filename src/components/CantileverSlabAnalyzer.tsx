"use client";

import React, { useState, useCallback } from 'react';
import { analyzeCantileverSlab, optimizeCantileverSlab, CantileverSlabInput, CantileverSlabOptimizeParams } from './cantileverSlabEngine';
import CodeRef from './CodeRef';
import { generateCantileverSlabPDF } from './cantileverSlabReportGenerator';
import { exportToJSON, timestampForFilename, copyToClipboard, fmt } from '../lib/exportResults';
import { useToast } from './ToastProvider';

export default function CantileverSlabAnalyzer() {
    const { toast } = useToast();
    const [input, setInput] = useState<CantileverSlabInput>({
        L: 1.5,
        D: 150,
        cover: 20,
        fck: 25,
        fy: 415,
        w_live: 3,
        w_finish: 1,
        bar_main: 10,
        spacing_main: 150,
        bar_dist: 8,
        spacing_dist: 200,
        // Bottom (compression face) mat — enters the IS 456 Annex C deflection
        // calculation. Default to 0 (no bottom steel) so the field is opt-in.
        bar_bot: 0,
        spacing_bot: 0,
        camber: 0,
        parapetHeight: 0,
        parapetThickness: 230,
        parapetDensity: 20,
    });

    const results = analyzeCantileverSlab(input);

    // ── Optimizer state ── (restores the optimizer the cantilever had when it
    // was inside NormalSlabAnalyzer's "Auto-Optimize Thickness" panel)
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optProgress, setOptProgress] = useState({ done: 0, total: 0, feasible: 0 });
    const [optResult, setOptResult] = useState<ReturnType<typeof optimizeCantileverSlab> | null>(null);
    const [optParams, setOptParams] = useState<CantileverSlabOptimizeParams>({
        minD: 100, maxD: 300, stepD: 25,
    });

    const runOptimization = useCallback(() => {
        setIsOptimizing(true);
        setOptProgress({ done: 0, total: 0, feasible: 0 });
        setOptResult(null);
        setTimeout(() => {
            try {
                const res = optimizeCantileverSlab(input, optParams, 90, (done, total, feasible) => {
                    setOptProgress({ done, total, feasible });
                });
                setOptResult(res);
                if (res.optimum) {
                    setInput(prev => ({
                        ...prev,
                        D: res.optimum!.D,
                        bar_main: res.optimum!.bar_main,
                        spacing_main: res.optimum!.spacing_main,
                        // BUG-CS-OPT-02 FIX: also adopt the optimum's bottom-mat selection.
                        bar_bot: res.optimum!.bar_bot > 0 ? res.optimum!.bar_bot : undefined,
                        spacing_bot: res.optimum!.bar_bot > 0 ? res.optimum!.spacing_bot : undefined,
                        camber: res.optimum!.result.deflection.camber,
                    }));
                }
            } finally {
                setIsOptimizing(false);
            }
        }, 50);
    }, [input, optParams]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        if (name === 'grade') {
            const fck = parseInt(value.replace('M', ''));
            setInput(prev => ({ ...prev, grade: value, fck }));
        } else if (name === 'steelGrade') {
            const fy = parseInt(value.replace('Fe', ''));
            setInput(prev => ({ ...prev, steelGrade: value, fy }));
        } else {
            setInput(prev => ({ ...prev, [name]: parseFloat(value) }));
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
                        Cantilever Slab — Inputs
                    </h3>
                    <div className="control-group">
                        <label htmlFor="L">Clear Span L (m)</label>
                        <input title="L" type="number" name="L" value={input.L} onChange={handleInputChange} id="L" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="D">Depth D (mm)</label>
                        <input title="D" type="number" name="D" value={input.D} onChange={handleInputChange} id="D" />
                        {input.L > 0 && input.D > 0 && (input.L * 1000) / input.D > 7 && (
                            <span className="input-validation-warn">⚠ L/D = {((input.L * 1000) / input.D).toFixed(1)} &gt; 7 (basic <CodeRef clause="23.2.1">Cl. 23.2.1</CodeRef> cantilever)</span>
                        )}
                    </div>
                    <div className="control-group">
                        <label htmlFor="camber">Initial Upward Camber (mm)</label>
                        <input title="camber" type="number" min="0" step="5" name="camber" value={input.camber ?? 0} onChange={handleInputChange} id="camber" />
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
                        <label htmlFor="w_live">Live Load (kN/m²)</label>
                        <input title="w_live" type="number" name="w_live" value={input.w_live} onChange={handleInputChange} id="w_live" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="w_finish">Floor Finish (kN/m²)</label>
                        <input title="w_finish" type="number" name="w_finish" value={input.w_finish} onChange={handleInputChange} id="w_finish" />
                    </div>
                    
                    <h3 className="panel-title mt-24px">
                        <span className="panel-icon">🧱</span>
                        Parapet / Free-End Load
                    </h3>
                    <div className="control-group">
                        <label htmlFor="parapetHeight">Parapet Height (m) — 0 for none</label>
                        <input title="parapetHeight" type="number" min="0" step="0.1" name="parapetHeight" value={input.parapetHeight} onChange={handleInputChange} id="parapetHeight" />
                    </div>
                    {input.parapetHeight! > 0 && (
                        <>
                            <div className="control-group">
                                <label htmlFor="parapetThickness">Parapet Thickness (mm)</label>
                                <input title="parapetThickness" type="number" min="0" step="10" name="parapetThickness" value={input.parapetThickness} onChange={handleInputChange} id="parapetThickness" />
                            </div>
                            <div className="control-group">
                                <label htmlFor="parapetDensity">Material Density (kN/m³) <br/><small>(20 for masonry, 25 for concrete)</small></label>
                                <input title="parapetDensity" type="number" min="1" step="1" name="parapetDensity" value={input.parapetDensity} onChange={handleInputChange} id="parapetDensity" />
                            </div>
                        </>
                    )}
                    <div className="control-group">
                        <label>Main Bar Ø (mm)</label>
                        <select title="bar_main" name="bar_main" value={input.bar_main} onChange={handleInputChange} id="bar_main">
                            {[8, 10, 12, 16, 20].map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                    </div>
                    <div className="control-group">
                        <label htmlFor="spacing_main">Main Spacing (mm)</label>
                        <input title="spacing_main" type="number" name="spacing_main" value={input.spacing_main} onChange={handleInputChange} id="spacing_main" />
                    </div>
                    <div className="control-group">
                        <label>Distribution Bar Ø (mm)</label>
                        <select title="bar_dist" name="bar_dist" value={input.bar_dist} onChange={handleInputChange} id="bar_dist">
                            {[8, 10, 12].map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                    </div>
                    <div className="control-group">
                        <label htmlFor="spacing_dist">Dist Spacing (mm)</label>
                        <input title="spacing_dist" type="number" name="spacing_dist" value={input.spacing_dist} onChange={handleInputChange} id="spacing_dist" />
                    </div>
                    {/* ─── Bottom (compression face) mat — used in the Annex C
                        deflection check. Both top and bottom provided steels
                        contribute via the pt and pc terms (per PI-EX-106A). */}
                    <div className="control-group">
                        <label>Bottom Bar Ø (mm)</label>
                        <select title="bar_bot" name="bar_bot" value={input.bar_bot ?? 0} onChange={handleInputChange} id="bar_bot">
                            <option value={0}>None</option>
                            {[8, 10, 12, 16].map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                    </div>
                    <div className="control-group">
                        <label htmlFor="spacing_bot">Bottom Spacing (mm)</label>
                        <input title="spacing_bot" type="number" name="spacing_bot" value={input.spacing_bot ?? 0} onChange={handleInputChange} id="spacing_bot" placeholder="0 = no bottom steel" />
                    </div>

                    <div className="opt-panel">
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
                                        <h2 className="status-title">Cantilever Slab — L = {input.L} m, D = {input.D} mm</h2>
                                        <p className="status-subtitle">{safe ? 'All IS 456 checks passed successfully.' : 'One or more IS 456 checks failed.'}</p>
                                        <div className="status-chips">
                                            <span className={`chip ${safe ? 'chip-safe' : 'chip-fail'}`}>{results.overallStatus}</span>
                                            <span className="chip chip-info">w<sub>u</sub> = {results.wu.toFixed(2)} kN/m²</span>
                                            <span className="chip chip-info">M<sub>u</sub> = {results.Mu.toFixed(2)} kN·m</span>
                                            <span className="chip chip-info">Ø{input.bar_main} @ {input.spacing_main}mm c/c</span>
                                        </div>
                                    </div>
                                    <div className="flex-row-gap-8-wrap">
                                        <button className="btn-primary btn-preview" onClick={() => generateCantileverSlabPDF(input, results, true)}>
                                            <span className="btn-icon">👁</span> Preview PDF
                                        </button>
                                        <button className="btn-primary btn-download" onClick={() => generateCantileverSlabPDF(input, results, false)}>
                                            <span className="btn-icon">📥</span> Download PDF
                                        </button>
                                        <button className="btn-primary btn-preview" onClick={() => exportToJSON({ input, results }, `cantilever_slab_${timestampForFilename()}`, 'Cantilever Slab Design (IS 456)')} title="Export results to JSON file">
                                            <span className="btn-icon">📋</span> Export JSON
                                        </button>
                                        <button className="btn-primary btn-preview" onClick={async () => {
                                            const s = `CANTILEVER SLAB DESIGN SUMMARY (IS 456:2000)\n${'='.repeat(50)}\nSpan: ${input.L}m | D=${input.D}mm | fck=${input.fck} | fy=${input.fy}\n\nShear at d_eff: Vu_crit=${fmt(results.Vu_critical,2)} kN/m\nτv=${fmt(results.tau_v,3)} vs τc=${fmt(results.tau_c,3)} N/mm² → ${results.shear_safe ? 'SAFE' : 'FAIL'}\nTotal Deflection: ${fmt(results.deflection.a_total,2)}mm vs ${fmt(results.deflection.limit_total,2)}mm → ${results.defl_safe ? 'SAFE' : 'FAIL'}\nSpan/Depth: d_prov=${results.ldCheck.d_provided}mm vs d_req=${results.ldCheck.d_req}mm → IGNORED\nOverall Status: ${results.overallStatus}\n${'='.repeat(50)}`;
                                            const ok = await copyToClipboard(s);
                                            toast(ok ? '✅ Summary copied to clipboard' : '❌ Copy failed', { type: ok ? 'success' : 'error' });
                                        }} title="Copy key results to clipboard">
                                            <span className="btn-icon">📄</span> Copy Summary
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Design summary */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">📊</span>Design Summary</h3>
                            <table className="result-table compact">
                                <tbody>
                                    <tr><td>Factored Load w<sub>u</sub></td><td>{results.wu.toFixed(2)} kN/m²</td></tr>
                                    <tr><td>Design Moment M<sub>u</sub></td><td>{results.Mu.toFixed(2)} kN·m/m</td></tr>
                                    <tr><td>Effective Depth d</td><td>{results.d.toFixed(0)} mm</td></tr>
                                    <tr><td>Ast Required</td><td>{Number.isNaN(results.Ast_req) ? <span className="chip chip-fail">Section Fails</span> : `${results.Ast_req.toFixed(2)} mm²/m`}</td></tr>
                                    <tr>
                                        <td>Ast Provided</td>
                                        <td>
                                            <span className={`chip ${results.Ast_provided >= results.Ast_req ? 'chip-safe' : 'chip-fail'}`}>
                                                {results.Ast_provided.toFixed(2)} mm²/m
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* Shear Check */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">⚔️</span>Shear Check — IS 456 <CodeRef clause="40.1.1">Cl. 40</CodeRef> (at d<sub>eff</sub> from face of support)</h3>
                            <div className="shear-info-note">
                                Per IS 456 <CodeRef clause="40.1.1">Cl. 40.1.1</CodeRef>, the critical section for shear in a cantilever is at a distance d<sub>eff</sub>
                                from the face of the support. V<sub>u,crit</sub> = V<sub>u,support</sub> − w<sub>u</sub>·d<sub>eff</sub> governs the τ<sub>v</sub> check.
                            </div>
                            <table className="result-table compact">
                                <tbody>
                                    <tr><td>V<sub>u</sub> at support</td><td>{results.Vu.toFixed(2)} kN/m</td></tr>
                                    <tr><td>d<sub>eff</sub> (effective depth)</td><td>{results.d_eff.toFixed(0)} mm</td></tr>
                                    <tr><td>V<sub>u,crit</sub> at d<sub>eff</sub> from face</td><td><strong>{results.Vu_critical.toFixed(2)} kN/m</strong></td></tr>
                                    <tr><td>τ<sub>v</sub> = V<sub>u,crit</sub>/(b·d<sub>eff</sub>)</td><td>{results.tau_v.toFixed(3)} N/mm²</td></tr>
                                    <tr><td>τ<sub>c,allowable</sub> = k·τ<sub>c</sub></td><td>{results.tau_c.toFixed(3)} N/mm²</td></tr>
                                    <tr>
                                        <td>Status</td>
                                        <td><span className={`chip ${results.shear_safe ? 'chip-safe' : 'chip-fail'}`}>{results.shear_safe ? 'OK' : 'FAIL'}</span></td>
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
                                            <tr><td>p<sub>t</sub> (top, tension)</td><td>{results.deflection.pt}%</td></tr>
                                            <tr><td>p<sub>c</sub> (bottom, comp.)</td><td>{results.deflection.pc}%</td></tr>
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
                                <div className="defl-result defl-ok opacity-70">
                                    <span>{results.deflection.camber > 0 ? 'Net Post-construction' : 'Post-construction'}: {results.deflection.a_post_construction} mm</span>
                                    <span>Limit (L/350 or 20mm): {results.deflection.limit_post} mm</span>
                                    <span className="chip chip-ignored">
                                        IGNORED
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
                                    .defl-dynamic-width {
                                        width: ${Math.min(100, results.deflection.a_total / results.deflection.limit_total * 100)}%;
                                    }
                                `}</style>
                                <div className="defl-util-track">
                                    <div
                                        className={`defl-util-fill defl-dynamic-width ${results.deflection.a_total / results.deflection.limit_total <= 0.7 ? 'ok' : results.deflection.a_total / results.deflection.limit_total <= 0.9 ? 'warn' : 'fail'}`}
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
                                Simplified L/d = 7 check is informational only — the rigorous IS 456 <CodeRef clause="Annex C">Annex C</CodeRef> deflection calculation governs the design.
                            </div>
                        </div>

                        {/* IS 456 code checks */}
                        {results.barChecks && (
                            <div className="panel">
                                <h3 className="panel-title"><span className="panel-icon">📐</span>IS 456 Code Checks — <CodeRef clause="26.3.3">Cl. 26.3.3</CodeRef> + <CodeRef clause="26.5.2.1">26.5</CodeRef></h3>
                                <table className="result-table">
                                    <thead>
                                        <tr><th>Check</th><th>Limit</th><th>Status</th></tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td>Max bar Ø (D/8)</td>
                                            <td>≤ {results.barChecks.maxBarDia}mm</td>
                                            <td><span className={`chip ${results.barChecks.barDiaOK ? 'chip-safe' : 'chip-fail'}`}>{results.barChecks.barDiaOK ? 'OK' : 'REVISE'}</span></td>
                                        </tr>
                                        <tr>
                                            <td>Main spacing (3d or 300)</td>
                                            <td>≤ {results.barChecks.maxSpacingMain}mm</td>
                                            <td><span className={`chip ${results.barChecks.spacingMainOK ? 'chip-safe' : 'chip-fail'}`}>{results.barChecks.spacingMainOK ? 'OK' : 'REVISE'}</span></td>
                                        </tr>
                                        <tr>
                                            <td>Dist spacing (5d or 450)</td>
                                            <td>≤ {results.barChecks.maxSpacingDist}mm</td>
                                            <td><span className={`chip ${results.barChecks.spacingDistOK ? 'chip-safe' : 'chip-fail'}`}>{results.barChecks.spacingDistOK ? 'OK' : 'REVISE'}</span></td>
                                        </tr>
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
                                                <span><strong>✓ Optimum:</strong> D = {optResult.optimum.D} mm, top Ø{optResult.optimum.bar_main}@{optResult.optimum.spacing_main}{optResult.optimum.bar_bot > 0 ? `, bottom Ø${optResult.optimum.bar_bot}@${optResult.optimum.spacing_bot}` : ''}{optResult.optimum.camber > 0 ? `, camber ${optResult.optimum.camber.toFixed(0)}mm` : ''}</span>
                                                <span className="chip chip-info">Cost Index = {optResult.optimum.costIndex.toFixed(2)}</span>
                                            </div>
                                            <div className="defl-result">
                                                <span>Concrete: {optResult.optimum.concreteVol.toFixed(3)} m³/m</span>
                                                <span>Steel: {optResult.optimum.steelWeight.toFixed(2)} kg/m</span>
                                            </div>
                                        </div>
                                        <table className="result-table">
                                            <thead>
                                                <tr><th>Rank</th><th>D (mm)</th><th>Bar</th><th>Spacing</th><th>Concrete (m³/m)</th><th>Steel (kg/m)</th><th>Cost Index</th></tr>
                                            </thead>
                                            <tbody>
                                                {optResult.topDesigns.map((d, i) => (
                                                    <tr key={i}>
                                                        <td>{i + 1}</td>
                                                        <td>{d.D}</td>
                                                        <td>Ø{d.bar_main}</td>
                                                        <td>{d.spacing_main}</td>
                                                        <td>{d.concreteVol.toFixed(3)}</td>
                                                        <td>{d.steelWeight.toFixed(2)}</td>
                                                        <td>{d.costIndex.toFixed(2)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        <p className="progress-text">{optResult.feasibleCount} feasible designs out of {optResult.totalTrials} trials. Optimum applied to inputs above.</p>
                                    </>
                                ) : (
                                    <p className="text-error">No feasible design found in the given range. Widen the depth range or reduce loads.</p>
                                )}
                            </div>
                        )}
                    </>
                )}
            </section>
        </div>
    );
}

