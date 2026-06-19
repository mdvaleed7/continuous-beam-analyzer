"use client";

import React, { useState, useCallback, useMemo } from "react";
import { analyzeSlab, analyzeSlabs, BOUNDARY_CASES, SLAB_TYPES, SUPPORT_CONDITIONS } from "./slabEngine";
import { generateSlabReport } from "./slabReportGenerator";
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
};

export default function SlabAnalyzer() {
    const [panels, setPanels] = useState([{ ...DEFAULT_PANEL }]);
    const [activePanel, setActivePanel] = useState(0);
    const [results, setResults] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

    // Shared material across all panels
    const [sharedMaterial, setSharedMaterial] = useState({
        grade: 'M25', fck: 25, steelGrade: 'Fe500', fy: 500, cover: 20,
        LL: 3, SDL: 1.5, loadFactor: 1.5, ageOfLoading: '28',
    });

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
                            <select value={sharedMaterial.grade}
                                onChange={e => handleGradeChange(e.target.value)}>
                                {['M20', 'M25', 'M30', 'M35', 'M40'].map(g =>
                                    <option key={g} value={g}>{g} (f<sub>ck</sub>={g.replace('M', '')})</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Steel</label>
                            <select value={sharedMaterial.steelGrade}
                                onChange={e => handleSteelChange(e.target.value)}>
                                {['Fe250', 'Fe415', 'Fe500', 'Fe550'].map(s =>
                                    <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Cover (mm)</label>
                            <input type="number" min="15" max="50" value={sharedMaterial.cover}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, cover: +e.target.value }))} />
                        </div>
                        <div className="control-group">
                            <label>Load Factor</label>
                            <input type="number" min="1.0" max="2.0" step="0.1" value={sharedMaterial.loadFactor}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, loadFactor: +e.target.value }))} />
                        </div>
                        <div className="control-group">
                            <label>Self-weight (kN/m²)</label>
                            <input type="number" value={(p.D / 1000 * 25).toFixed(2)} disabled
                                title="Calculated automatically as D × 25 kN/m³. Not user-editable." />
                        </div>
                        <div className="control-group">
                            <label>SDL (kN/m²)</label>
                            <input type="number" min="0" step="0.5" value={sharedMaterial.SDL}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, SDL: +e.target.value }))} />
                        </div>
                        <div className="control-group">
                            <label>LL (kN/m²)</label>
                            <input type="number" min="0" step="0.5" value={sharedMaterial.LL}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, LL: +e.target.value }))} />
                        </div>
                        <div className="control-group">
                            <label>Age at Loading</label>
                            <select value={sharedMaterial.ageOfLoading}
                                onChange={e => setSharedMaterial(prev => ({ ...prev, ageOfLoading: e.target.value }))}>
                                <option value="7">7 Days (θ=2.2)</option>
                                <option value="28">28 Days (θ=1.6)</option>
                                <option value="365">1 Year (θ=1.1)</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className="panel" style={{ marginTop: '16px' }}>
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

                    <div style={{ marginTop: '12px' }}>
                        <div className="control-group">
                            <label>Label</label>
                            <input value={p.label}
                                onChange={e => updatePanel(activePanel, 'label', e.target.value)} />
                        </div>
                        <div className="control-group">
                            <label>Slab Type</label>
                            <select value={p.slabType}
                                onChange={e => updatePanel(activePanel, 'slabType', e.target.value)}>
                                {SLAB_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                        </div>

                        {/* ── Cantilever: single span only ── */}
                        {p.slabType === 'cantilever' && (
                            <div className="control-group">
                                <label>Span L (m)</label>
                                <input type="number" min="0.3" step="0.1" value={p.L}
                                    onChange={e => updatePanel(activePanel, 'L', +e.target.value)} />
                            </div>
                        )}

                        {/* ── One-way: Lx + Ly (width) + support condition ── */}
                        {p.slabType === 'one-way' && (
                            <>
                                <div className="control-group">
                                    <label>Span L<sub>x</sub> (m)</label>
                                    <input type="number" min="0.5" step="0.1" value={p.Lx}
                                        onChange={e => updatePanel(activePanel, 'Lx', +e.target.value)} />
                                </div>
                                <div className="control-group">
                                    <label>Width L<sub>y</sub> (m)</label>
                                    <input type="number" min="0.5" step="0.1" value={p.Ly}
                                        onChange={e => updatePanel(activePanel, 'Ly', +e.target.value)} />
                                </div>
                                <div className="control-group">
                                    <label>Support Condition</label>
                                    <select value={p.supportCondition}
                                        onChange={e => updatePanel(activePanel, 'supportCondition', e.target.value)}>
                                        {SUPPORT_CONDITIONS.map(sc =>
                                            <option key={sc.value} value={sc.value}>{sc.label}</option>)}
                                    </select>
                                </div>
                            </>
                        )}

                        {/* ── Two-way: Lx + Ly + boundary case ── */}
                        {p.slabType === 'two-way' && (
                            <>
                                <div className="control-group">
                                    <label>L<sub>x</sub> Short (m)</label>
                                    <input type="number" min="0.5" step="0.1" value={p.Lx}
                                        onChange={e => updatePanel(activePanel, 'Lx', +e.target.value)} />
                                </div>
                                <div className="control-group">
                                    <label>L<sub>y</sub> Long (m)</label>
                                    <input type="number" min="0.5" step="0.1" value={p.Ly}
                                        onChange={e => updatePanel(activePanel, 'Ly', +e.target.value)} />
                                </div>
                                <div className="control-group">
                                    <label>Boundary Case</label>
                                    <select value={p.boundaryCase}
                                        onChange={e => updatePanel(activePanel, 'boundaryCase', +e.target.value)}>
                                        {BOUNDARY_CASES.map(bc =>
                                            <option key={bc.case} value={bc.case}>Case {bc.case}: {bc.label}</option>)}
                                    </select>
                                </div>
                            </>
                        )}

                        {/* ── Auto: Lx + Ly + boundary case (auto-detects type) ── */}
                        {p.slabType === 'auto' && (
                            <>
                                <div className="control-group">
                                    <label>L<sub>x</sub> Short (m)</label>
                                    <input type="number" min="0.5" step="0.1" value={p.Lx}
                                        onChange={e => updatePanel(activePanel, 'Lx', +e.target.value)} />
                                </div>
                                <div className="control-group">
                                    <label>L<sub>y</sub> Long (m)</label>
                                    <input type="number" min="0.5" step="0.1" value={p.Ly}
                                        onChange={e => updatePanel(activePanel, 'Ly', +e.target.value)} />
                                </div>
                                <div className="control-group">
                                    <label>Boundary Case</label>
                                    <select value={p.boundaryCase}
                                        onChange={e => updatePanel(activePanel, 'boundaryCase', +e.target.value)}>
                                        {BOUNDARY_CASES.map(bc =>
                                            <option key={bc.case} value={bc.case}>Case {bc.case}: {bc.label}</option>)}
                                    </select>
                                </div>
                            </>
                        )}

                        {/* ── Common: depth ── */}
                        <div className="control-group">
                            <label>Depth D (mm)</label>
                            <input type="number" min="75" max="500" step="5" value={p.D}
                                onChange={e => updatePanel(activePanel, 'D', +e.target.value)} />
                        </div>
                    </div>

                    {panels.length > 1 && (
                        <button className="btn btn-danger" style={{ marginTop: '10px', width: '100%' }}
                            onClick={() => removePanel(activePanel)}>
                            Remove Panel {p.label}
                        </button>
                    )}
                </div>

                <button className="btn btn-primary" style={{ marginTop: '16px', width: '100%' }}
                    onClick={runAnalysis}>
                    ⚡ Analyze All Panels
                </button>
            </aside>

            {/* ───── MAIN CONTENT ───── */}
            <section className="content">
                {error && <div className="panel" style={{ borderColor: 'var(--negative)' }}><p style={{ color: 'var(--negative)' }}>{error}</p></div>}

                {r && (
                    <>
                        {/* ───── SUMMARY AND BUTTONS ───── */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
                            <div className={`panel status-banner ${r.overallStatus === 'SAFE' ? 'status-safe' : 'status-fail'}`} style={{ flex: 1, margin: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                                    <div>
                                        <h2 style={{ margin: '0 0 8px 0', fontSize: '1.4rem' }}>{r.label} — {r.slabType === 'two-way' ? 'Two-Way Restrained' : r.slabType === 'one-way' ? 'One-Way' : 'Cantilever'} Slab</h2>
                                        <p style={{ margin: '0 0 12px 0', opacity: 0.9 }}>{r.overallStatus === 'SAFE' ? 'All IS 456 checks passed successfully.' : 'One or more IS 456 checks failed.'}</p>
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
                                Deflection Check — IS 456 Annex C
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
                                <div className={`defl-result ${r.deflection.status_total === 'OK' ? 'defl-ok' : 'defl-fail'}`}>
                                    <span>Total: {r.deflection.a_total} mm</span>
                                    <span>Limit (L/250): {r.deflection.limit_total} mm</span>
                                    <span className={`chip ${r.deflection.status_total === 'OK' ? 'chip-safe' : 'chip-fail'}`}>
                                        {r.deflection.status_total}
                                    </span>
                                </div>
                                <div className={`defl-result ${r.deflection.status_post === 'OK' ? 'defl-ok' : 'defl-fail'}`}>
                                    <span>Post-construction: {r.deflection.a_post_construction} mm</span>
                                    <span>Limit (L/350 or 20mm): {r.deflection.limit_post} mm</span>
                                    <span className={`chip ${r.deflection.status_post === 'OK' ? 'chip-safe' : 'chip-fail'}`}>
                                        {r.deflection.status_post}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Span/Depth Ratio */}
                        <div className="panel">
                            <h3 className="panel-title">
                                <span className="panel-icon">📐</span>
                                Span/Depth Ratio — IS 456 Cl. 23.2
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
                                            <span className={`chip ${r.ldCheck.status === 'OK' ? 'chip-safe' : 'chip-fail'}`}>
                                                {r.ldCheck.status}
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* Shear Check */}
                        <div className="panel">
                            <h3 className="panel-title">
                                <span className="panel-icon">⚔️</span>
                                Shear Check — IS 456 Cl. 40
                            </h3>
                            <table className="result-table">
                                <thead>
                                    <tr>
                                        <th>Direction</th>
                                        <th>V<sub>u</sub> (kN)</th>
                                        <th>τ<sub>v</sub> (N/mm²)</th>
                                        <th>τ<sub>c</sub> (N/mm²)</th>
                                        <th>k</th>
                                        <th>k·τ<sub>c</sub></th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>Short (L<sub>x</sub>)</td>
                                        <td>{r.shear.shortDir.Vu}</td>
                                        <td>{r.shear.shortDir.tau_v}</td>
                                        <td>{r.shear.shortDir.tau_c}</td>
                                        <td>{r.shear.shortDir.k}</td>
                                        <td>{r.shear.shortDir.allowable}</td>
                                        <td>
                                            <span className={`chip ${r.shear.shortDir.status === 'OK' ? 'chip-safe' : 'chip-fail'}`}>
                                                {r.shear.shortDir.status}
                                            </span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>Long (L<sub>y</sub>)</td>
                                        <td>{r.shear.longDir.Vu}</td>
                                        <td>{r.shear.longDir.tau_v}</td>
                                        <td>{r.shear.longDir.tau_c}</td>
                                        <td>{r.shear.longDir.k}</td>
                                        <td>{r.shear.longDir.allowable}</td>
                                        <td>
                                            <span className={`chip ${r.shear.longDir.status === 'OK' ? 'chip-safe' : 'chip-fail'}`}>
                                                {r.shear.longDir.status}
                                            </span>
                                        </td>
                                    </tr>
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
                                            <tr key={i} className={i === activePanel ? 'row-active' : ''}
                                                onClick={() => setActivePanel(i)} style={{ cursor: 'pointer' }}>
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
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button className="btn-primary" onClick={handleDownloadReport}
                                                style={{ padding: '8px 18px', fontSize: '0.82rem', background: 'linear-gradient(135deg, #00e5a0 0%, #00b87a 100%)' }}>
                                                📥 Download
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
                                        srcDoc={pdfPreviewUrl}
                                        style={{ width: '100%', height: 'calc(100% - 60px)', border: 'none', borderRadius: '0 0 12px 12px', background: 'white' }}
                                        title="PDF Preview"
                                    />
                                </div>
                            </div>
                        )}
                    </>
                )}

                {!results && (
                    <div className="panel" style={{ textAlign: 'center', padding: '60px 20px' }}>
                        <h2 style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>Slab Designer</h2>
                        <p style={{ color: 'var(--text-dim)' }}>Configure panels in the sidebar and click <strong>Analyze All Panels</strong></p>
                        <p style={{ color: 'var(--text-dim)', marginTop: '8px', fontSize: '0.85rem' }}>
                            Supports two-way restrained (IS 456 Table 26), one-way, and cantilever slabs
                        </p>
                    </div>
                )}
            </section>
        </div>
    );
}