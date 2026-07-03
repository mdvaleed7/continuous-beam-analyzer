"use client";

import React, { useState, useCallback } from 'react';
import { analyzeWaffleSlab, optimizeWaffleSlab, WaffleSlabInput, WaffleSlabOptimizeParams } from './waffleSlabEngine';
import CodeRef from './CodeRef';
import { generateWaffleSlabPDF } from './waffleSlabReportGenerator';
import { exportToJSON, timestampForFilename, copyToClipboard, fmt } from '../lib/exportResults';
import { useToast } from './ToastProvider';

export default function WaffleSlabAnalyzer() {
    const { toast } = useToast();
    const [input, setInput] = useState<WaffleSlabInput>({
        Lx: 8.0,
        Ly: 10.0,
        spacing_x: 1.0,
        spacing_y: 1.0,
        bw: 150,
        D: 400,
        Df: 100,
        cover: 25,
        fck: 25,
        fy: 500,
        w_live: 5.0,
        w_finish: 1.5,
        camber: 0,
    });

    const results = analyzeWaffleSlab(input);

    // ── Optimizer state ──
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optProgress, setOptProgress] = useState({ done: 0, total: 0, feasible: 0 });
    const [optResult, setOptResult] = useState<ReturnType<typeof optimizeWaffleSlab> | null>(null);
    const [optParams, setOptParams] = useState<WaffleSlabOptimizeParams>({
        minD: 300, maxD: 500, stepD: 25,
        minDf: 75, maxDf: 125, stepDf: 25,
        minBw: 100, maxBw: 200, stepBw: 25,
        minSpacing: 0.75, maxSpacing: 1.5, stepSpacing: 0.25,
    });

    const runOptimization = useCallback(() => {
        setIsOptimizing(true);
        setOptProgress({ done: 0, total: 0, feasible: 0 });
        setOptResult(null);
        setTimeout(() => {
            try {
                const res = optimizeWaffleSlab(input, optParams, 90, (done, total, feasible) => {
                    setOptProgress({ done, total, feasible });
                });
                setOptResult(res);
                if (res.optimum) {
                    setInput(prev => ({
                        ...prev,
                        D: res.optimum!.D,
                        Df: res.optimum!.Df,
                        bw: res.optimum!.bw,
                        spacing_x: res.optimum!.spacing,
                        spacing_y: res.optimum!.spacing,
                        rib_bar_dia: res.optimum!.rib_bar_dia,
                        rib_n_bars: res.optimum!.rib_n_bars,
                        camber: res.optimum!.camber,
                    }));
                }
            } finally {
                setIsOptimizing(false);
            }
        }, 50);
    }, [input, optParams]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        if (name === 'deflectionSupport') {
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
                        Panel &amp; Rib Geometry
                    </h3>
                    <div className="control-group">
                        <label htmlFor="Lx">Short Span Lx (m)</label>
                        <input title="Lx" type="number" name="Lx" value={input.Lx} onChange={handleInputChange} id="Lx" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="Ly">Long Span Ly (m)</label>
                        <input title="Ly" type="number" name="Ly" value={input.Ly} onChange={handleInputChange} id="Ly" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="spacing_x">Rib spacing parallel to X (m)</label>
                        <input title="spacing_x" type="number" step="0.1" name="spacing_x" value={input.spacing_x} onChange={handleInputChange} id="spacing_x" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="spacing_y">Rib spacing parallel to Y (m)</label>
                        <input title="spacing_y" type="number" step="0.1" name="spacing_y" value={input.spacing_y} onChange={handleInputChange} id="spacing_y" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="bw">Rib Width bw (mm)</label>
                        <input title="bw" type="number" name="bw" value={input.bw} onChange={handleInputChange} id="bw" />
                        {input.bw < 65 && (
                            <span className="input-validation-warn">⚠ bw &lt; 65 mm violates IS 456 <CodeRef clause="30.5">Cl. 30.5</CodeRef></span>
                        )}
                    </div>
                    <div className="control-group">
                        <label htmlFor="D">Overall Depth D (mm)</label>
                        <input title="D" type="number" name="D" value={input.D} onChange={handleInputChange} id="D" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="Df">Topping Thickness Df (mm)</label>
                        <input title="Df" type="number" name="Df" value={input.Df} onChange={handleInputChange} id="Df" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="cover">Clear Cover (mm)</label>
                        <input title="cover" type="number" name="cover" value={input.cover} onChange={handleInputChange} id="cover" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="camber">Initial Upward Camber (mm)</label>
                        <input title="camber" type="number" min="0" step="5" name="camber" value={input.camber ?? 0} onChange={handleInputChange} id="camber" />
                    </div>
                </div>

                <div className="panel">
                    <h3 className="panel-title">
                        <span className="panel-icon">🔩</span>
                        Loads &amp; Material
                    </h3>
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
                        <label>Deflection Support Condition (Annex C)</label>
                        <select title="deflectionSupport" name="deflectionSupport" value={input.deflectionSupport || 'continuous'} onChange={handleInputChange} id="deflectionSupport">
                            <option value="continuous">Continuous (both ends) — α=1/16, k₃=0.063</option>
                            <option value="one_end">One-end continuous — α=1/12, k₃=0.086</option>
                            <option value="simply">Simply supported — α=5/48, k₃=0.125</option>
                        </select>
                    </div>
                    <div className="control-group">
                        <label htmlFor="rib_bar_dia">Rib Tension Bar Ø (mm)</label>
                        <input title="rib_bar_dia" type="number" name="rib_bar_dia" value={input.rib_bar_dia || 16} onChange={handleInputChange} id="rib_bar_dia" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="rib_n_bars">No. of Tension Bars in Rib</label>
                        <input title="rib_n_bars" type="number" name="rib_n_bars" value={input.rib_n_bars || 2} onChange={handleInputChange} id="rib_n_bars" />
                    </div>
                    {/* ─── Rib TOP (compression) bars — used in the Annex C deflection
                         check. Including them reduces the predicted deflection (pc term). */}
                    <div className="control-group">
                        <label htmlFor="rib_top_bar_dia">Rib Top (Compression) Bar Ø (mm)</label>
                        <input title="rib_top_bar_dia" type="number" name="rib_top_bar_dia" value={input.rib_top_bar_dia ?? 0} onChange={handleInputChange} id="rib_top_bar_dia" placeholder="0 = no top steel" />
                    </div>
                    <div className="control-group">
                        <label htmlFor="rib_top_n_bars">No. of Top Bars in Rib</label>
                        <input title="rib_top_n_bars" type="number" name="rib_top_n_bars" value={input.rib_top_n_bars ?? 0} onChange={handleInputChange} id="rib_top_n_bars" placeholder="0 = no top steel" />
                    </div>
                </div>

                <div className="panel">
                    <div className="opt-panel opt-panel-transparent">
                        <h4 className="opt-title">Auto-Optimize (D / Df / bw / Spacing)</h4>
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
                        <div className="flex-row-gap-8-mb-12">
                            <div className="flex-1">
                                <label className="opt-label" htmlFor="opt-minDf">Min Df (mm)</label>
                                <input title="Min Df" type="number" value={optParams.minDf} onChange={e => setOptParams(p => ({ ...p, minDf: +e.target.value }))} className="opt-input" id="opt-minDf" />
                            </div>
                            <div className="flex-1">
                                <label className="opt-label" htmlFor="opt-maxDf">Max Df (mm)</label>
                                <input title="Max Df" type="number" value={optParams.maxDf} onChange={e => setOptParams(p => ({ ...p, maxDf: +e.target.value }))} className="opt-input" id="opt-maxDf" />
                            </div>
                            <div className="flex-1">
                                <label className="opt-label" htmlFor="opt-stepDf">Step Df (mm)</label>
                                <input title="Step Df" type="number" value={optParams.stepDf} onChange={e => setOptParams(p => ({ ...p, stepDf: +e.target.value }))} className="opt-input" id="opt-stepDf" />
                            </div>
                        </div>
                        <div className="flex-row-gap-8-mb-12">
                            <div className="flex-1">
                                <label className="opt-label" htmlFor="opt-minBw">Min bw (mm)</label>
                                <input title="Min bw" type="number" value={optParams.minBw} onChange={e => setOptParams(p => ({ ...p, minBw: +e.target.value }))} className="opt-input" id="opt-minBw" />
                            </div>
                            <div className="flex-1">
                                <label className="opt-label" htmlFor="opt-maxBw">Max bw (mm)</label>
                                <input title="Max bw" type="number" value={optParams.maxBw} onChange={e => setOptParams(p => ({ ...p, maxBw: +e.target.value }))} className="opt-input" id="opt-maxBw" />
                            </div>
                            <div className="flex-1">
                                <label className="opt-label" htmlFor="opt-stepBw">Step bw (mm)</label>
                                <input title="Step bw" type="number" value={optParams.stepBw} onChange={e => setOptParams(p => ({ ...p, stepBw: +e.target.value }))} className="opt-input" id="opt-stepBw" />
                            </div>
                        </div>
                        <div className="flex-row-gap-8-mb-12">
                            <div className="flex-1">
                                <label className="opt-label" htmlFor="opt-minSp">Min Sp (m)</label>
                                <input title="Min Sp" type="number" step="0.25" value={optParams.minSpacing} onChange={e => setOptParams(p => ({ ...p, minSpacing: +e.target.value }))} className="opt-input" id="opt-minSp" />
                            </div>
                            <div className="flex-1">
                                <label className="opt-label" htmlFor="opt-maxSp">Max Sp (m)</label>
                                <input title="Max Sp" type="number" step="0.25" value={optParams.maxSpacing} onChange={e => setOptParams(p => ({ ...p, maxSpacing: +e.target.value }))} className="opt-input" id="opt-maxSp" />
                            </div>
                            <div className="flex-1">
                                <label className="opt-label" htmlFor="opt-stepSp">Step Sp (m)</label>
                                <input title="Step Sp" type="number" step="0.25" value={optParams.stepSpacing} onChange={e => setOptParams(p => ({ ...p, stepSpacing: +e.target.value }))} className="opt-input" id="opt-stepSp" />
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
                                        <h2 className="status-title">Waffle Slab — {input.Lx}×{input.Ly} m, D = {input.D} mm</h2>
                                        <p className="status-subtitle">{safe ? 'All IS 456 checks passed successfully.' : 'One or more IS 456 checks failed.'}</p>
                                        <div className="status-chips">
                                            <span className={`chip ${safe ? 'chip-safe' : 'chip-fail'}`}>{results.overallStatus}</span>
                                            <span className="chip chip-info">w<sub>u</sub> = {results.wu.toFixed(2)} kN/m²</span>
                                            <span className="chip chip-info">Rib {input.bw}×{input.D - input.Df}mm @ {input.spacing_x}m</span>
                                            <span className="chip chip-info">Df = {input.Df}mm</span>
                                        </div>
                                    </div>
                                    <div className="flex-row-gap-8-wrap">
                                        <button className="btn-primary btn-preview" onClick={() => generateWaffleSlabPDF(input, results, true)}>
                                            <span className="btn-icon">👁</span> Preview PDF
                                        </button>
                                        <button className="btn-primary btn-download" onClick={() => generateWaffleSlabPDF(input, results, false)}>
                                            <span className="btn-icon">📥</span> Download PDF
                                        </button>
                                        <button className="btn-primary btn-preview" onClick={() => exportToJSON({ input, results }, `waffle_slab_${timestampForFilename()}`, 'Waffle Slab Design (IS 456)')} title="Export results to JSON file">
                                            <span className="btn-icon">📋</span> Export JSON
                                        </button>
                                        <button className="btn-primary btn-preview" onClick={async () => {
                                            const r = results;
                                            const gov = r.ribX?.tau_v >= (r.ribY?.tau_v ?? 0) ? r.ribX : r.ribY;
                                            const s = `WAFFLE SLAB DESIGN SUMMARY (IS 456:2000)\n${'='.repeat(50)}\nSpan: ${input.Lx}×${input.Ly}m | D=${input.D}mm | Df=${input.Df}mm | fck=${input.fck} | fy=${input.fy}\n\nGoverning Rib Shear (at d_eff):\n  V_crit=${fmt(gov?.V_critical,2)} kN | τv=${fmt(gov?.tau_v,3)} vs τc=${fmt(gov?.tau_c,3)} N/mm² → ${gov?.shear_safe ? 'SAFE' : 'FAIL'}\nDeflection: ${fmt(r.deflection.a_total,2)}mm vs ${fmt(r.deflection.limit_total,2)}mm → ${r.deflection_safe ? 'SAFE' : 'FAIL'}\nSpan/Depth: d_prov=${r.ldCheck.d_provided}mm vs d_req=${r.ldCheck.d_req}mm → IGNORED (Annex C governs)\nOverall Status: ${r.overallStatus}\n${'='.repeat(50)}`;
                                            const ok = await copyToClipboard(s);
                                            toast(ok ? '✅ Summary copied to clipboard' : '❌ Copy failed', { type: ok ? 'success' : 'error' });
                                        }} title="Copy key results to clipboard">
                                            <span className="btn-icon">📄</span> Copy Summary
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Loads */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">📊</span>Loads &amp; Moments</h3>
                            <table className="result-table compact">
                                <tbody>
                                    <tr><td>Eq. Dead Load</td><td>{results.w_dead.toFixed(2)} kN/m²</td></tr>
                                    <tr><td>Factored Load w<sub>u</sub></td><td>{results.wu.toFixed(2)} kN/m²</td></tr>
                                    <tr><td>M<sub>x</sub> per metre</td><td>{results.Mx_per_m.toFixed(1)} kN·m/m</td></tr>
                                    <tr><td>M<sub>y</sub> per metre</td><td>{results.My_per_m.toFixed(1)} kN·m/m</td></tr>
                                </tbody>
                            </table>
                        </div>

                        {/* Rib design */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">🔩</span>Rib Design — IS 456 flexure + <CodeRef clause="40.1.1">Cl. 40</CodeRef> shear (at d<sub>eff</sub> from face of support)</h3>
                            <div className="shear-info-note">
                                Per IS 456 <CodeRef clause="40.1.1">Cl. 40.1.1</CodeRef>, the critical section for shear in each rib is at a distance d<sub>eff</sub>
                                from the face of the support. V<sub>crit</sub> = V<sub>support</sub> − w<sub>rib</sub>·d<sub>eff</sub> governs the τ<sub>v</sub> check.
                            </div>
                            <table className="result-table">
                                <thead>
                                    <tr>
                                        <th>Direction</th>
                                        <th>M (kN·m)</th>
                                        <th>V<sub>sup</sub> (kN)</th>
                                        <th>d<sub>eff</sub> (mm)</th>
                                        <th>V<sub>crit</sub> (kN)</th>
                                        <th>Ast (mm²)</th>
                                        <th>τ<sub>v</sub> (N/mm²)</th>
                                        <th>τ<sub>c</sub> (N/mm²)</th>
                                        <th>Shear</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>X (L<sub>x</sub>)</td>
                                        <td>{results.M_rib_x.toFixed(1)}</td>
                                        <td>{results.V_rib_x.toFixed(1)}</td>
                                        <td>{results.ribX.d_eff}</td>
                                        <td><strong>{results.ribX.V_critical.toFixed(2)}</strong></td>
                                        <td>{Number.isNaN(results.ribX.Ast_req) ? <span className="chip chip-fail">Fails</span> : `${results.ribX.Ast_req.toFixed(0)} mm²`}</td>
                                        <td>{results.ribX.tau_v.toFixed(2)}</td>
                                        <td>{results.ribX.tau_c.toFixed(2)}</td>
                                        <td><span className={`chip ${results.ribX.shear_safe ? 'chip-safe' : 'chip-fail'}`}>{results.ribX.shear_safe ? 'OK' : 'LINKS'}</span></td>
                                    </tr>
                                    <tr>
                                        <td>Y (L<sub>y</sub>)</td>
                                        <td>{results.M_rib_y.toFixed(1)}</td>
                                        <td>{results.V_rib_y.toFixed(1)}</td>
                                        <td>{results.ribY.d_eff}</td>
                                        <td><strong>{results.ribY.V_critical.toFixed(2)}</strong></td>
                                        <td>{Number.isNaN(results.ribY.Ast_req) ? <span className="chip chip-fail">Fails</span> : `${results.ribY.Ast_req.toFixed(0)} mm²`}</td>
                                        <td>{results.ribY.tau_v.toFixed(2)}</td>
                                        <td>{results.ribY.tau_c.toFixed(2)}</td>
                                        <td><span className={`chip ${results.ribY.shear_safe ? 'chip-safe' : 'chip-fail'}`}>{results.ribY.shear_safe ? 'OK' : 'LINKS'}</span></td>
                                    </tr>
                                </tbody>
                            </table>
                            <table className="result-table compact">
                                <tbody>
                                    <tr><td>Topping Ast (bottom mat, +M)</td><td><strong>{results.Ast_topping_bot.toFixed(0)} mm²/m</strong></td></tr>
                                    <tr><td>Topping Ast (top mat, −M)</td><td><strong>{results.Ast_topping_top.toFixed(0)} mm²/m</strong></td></tr>
                                </tbody>
                            </table>
                        </div>

                        {/* Deflection Check */}
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">📏</span>Deflection Check — IS 456 <CodeRef clause="Annex C">Annex C</CodeRef> (governing rib)</h3>
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
                                    .defl-dynamic-width-waffle {
                                        width: ${Math.min(100, results.deflection.a_total / results.deflection.limit_total * 100)}%;
                                    }
                                `}</style>
                                <div className="defl-util-track">
                                    <div
                                        className={`defl-util-fill defl-dynamic-width-waffle ${results.deflection.a_total / results.deflection.limit_total <= 0.7 ? 'ok' : results.deflection.a_total / results.deflection.limit_total <= 0.9 ? 'warn' : 'fail'}`}
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
                                Simplified L/d check is informational only — the rigorous IS 456 <CodeRef clause="Annex C">Annex C</CodeRef> T-beam deflection calculation governs the design.
                            </div>
                        </div>

                        {/* IS 456 code checks */}
                        {results.barChecks && (
                            <div className="panel">
                                <h3 className="panel-title"><span className="panel-icon">📐</span>IS 456 Code Checks — <CodeRef clause="26.3.3">Cl. 26.3.3</CodeRef></h3>
                                <table className="result-table">
                                    <thead>
                                        <tr><th>Check</th><th>Limit</th><th>Status</th></tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td>Topping max bar Ø (Df/8)</td>
                                            <td>≤ {results.barChecks.topping.maxBarDia}mm</td>
                                            <td><span className={`chip ${results.barChecks.topping.astFeasible ? 'chip-safe' : 'chip-fail'}`}>{results.barChecks.topping.astFeasible ? 'OK' : 'REVISE'}</span></td>
                                        </tr>
                                        <tr>
                                            <td>Topping max spacing (3d or 300)</td>
                                            <td>≤ {results.barChecks.topping.maxSpacing}mm</td>
                                            <td><span className={`chip ${results.barChecks.topping.astFeasible ? 'chip-safe' : 'chip-fail'}`}>{results.barChecks.topping.astFeasible ? 'OK' : 'REVISE'}</span></td>
                                        </tr>
                                        <tr>
                                            <td>Rib max bar Ø (D/8)</td>
                                            <td>≤ {results.barChecks.rib.maxBarDia}mm</td>
                                            <td><span className={`chip ${results.barChecks.topping.astFeasible ? 'chip-safe' : 'chip-fail'}`}>{results.barChecks.topping.astFeasible ? 'OK' : 'REVISE'}</span></td>
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
                                                <span><strong>✓ Optimum:</strong> D = {optResult.optimum.D} mm, Df = {optResult.optimum.Df} mm (Dr = {optResult.optimum.ribDepth} mm), bw = {optResult.optimum.bw} mm, Sp = {optResult.optimum.spacing} m</span>
                                                <span className="chip chip-info">Total Cost = ₹{Math.round(optResult.optimum.costTotal_INR).toLocaleString('en-IN')}</span>
                                            </div>
                                            <div className="defl-result">
                                                <span>Rib: {optResult.optimum.rib_n_bars}×Ø{optResult.optimum.rib_bar_dia}mm</span>
                                                <span>Concrete: {optResult.optimum.concreteVol.toFixed(3)} m³</span>
                                                <span>Steel: {optResult.optimum.steelWeight_gross.toFixed(2)} kg (incl. wastage)</span>
                                                {optResult.fallback && <span className="chip chip-info">greedy fallback</span>}
                                            </div>
                                        </div>
                                        {optResult.optimum.camber > 0 && (
                                            <div className="defl-result defl-warn extracted-style-84" >
                                                <span><strong>Optimizer Note:</strong> An upward camber of <strong>{optResult.optimum.camber.toFixed(1)} mm</strong> is required to satisfy long-term deflection.</span>
                                            </div>
                                        )}
                                        <table className="result-table">
                                            <thead>
                                                <tr>
                                                    <th>Rank</th><th>D</th><th>Df</th><th>Dr</th><th>bw</th><th>Sp</th>
                                                    <th>Rib Bar</th><th>n</th>
                                                    <th>Util (Flx | Sh | Defl)</th><th>Camber</th><th>Cost (₹)</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {optResult.topDesigns.map((d, i) => (
                                                    <tr key={i}>
                                                        <td>{i + 1}</td>
                                                        <td>{d.D}</td>
                                                        <td>{d.Df}</td>
                                                        <td>{d.ribDepth}</td>
                                                        <td>{d.bw}</td>
                                                        <td>{d.spacing}</td>
                                                        <td>Ø{d.rib_bar_dia}</td>
                                                        <td>{d.rib_n_bars}</td>
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

