"use client";

import React, { useState, useCallback, useEffect } from "react";
import { analyzeRetainingWall, optimizeRetainingWall, type RetainingWallInput, type RetainingWallResult } from "./retainingWallEngine";
import { drawRetainingWallDiagram } from "./retainingWallRender";
import { generateRetainingWallReport } from "./retainingWallReportGenerator";
import CodeRef from "./CodeRef";
import { exportToJSON, timestampForFilename, copyToClipboard, fmt } from "../lib/exportResults";
import { useToast } from './ToastProvider';

const DEFAULT_INPUT: RetainingWallInput = {
    H: 5000,
    H_soil: 5000,
    D_stem_base: 400,
    D_stem_top: 200,
    D_base: 400,
    B: 3000,
    B_toe: 750,
    phi: 30,
    gamma_soil: 18,
    gamma_concrete: 25,
    q_surcharge: 10,
    mu: 0.5,
    sbc: 150,
    waterTableDepth: 0,
    fck: 25,
    fy: 500,
    grade: 'M25',
    steelGrade: 'Fe500',
    cover: 50,
    loadFactor: 1.5,
};

export default function RetainingWallAnalyzer() {
    const { toast } = useToast();
    const [input, setInput] = useState<RetainingWallInput>({ ...DEFAULT_INPUT });
    const [pdfPreview, setPdfPreview] = useState<string | null>(null);
    const result: RetainingWallResult = analyzeRetainingWall(input);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        const num = parseFloat(value);
        setInput(prev => ({ ...prev, [name]: Number.isNaN(num) ? 0 : num }));
    }, []);

    const handleGradeChange = (grade: string) => {
        const fckMap: Record<string, number> = { M20: 20, M25: 25, M30: 30, M35: 35, M40: 40 };
        setInput(prev => ({ ...prev, grade, fck: fckMap[grade] || 25 }));
    };

    const handleSteelChange = (steelGrade: string) => {
        const fyMap: Record<string, number> = { Fe250: 250, Fe415: 415, Fe500: 500, Fe550: 550 };
        setInput(prev => ({ ...prev, steelGrade, fy: fyMap[steelGrade] || 500 }));
    };

    const [optBounds, setOptBounds] = useState({ minB: 1500, maxB: 5000, stepB: 100, minThk: 250, maxThk: 600, stepThk: 50 });

    const handleOptimize = () => {
        const res = optimizeRetainingWall(input, optBounds);
        if (res.bestResult) {
            setInput(res.bestResult);
            toast(`Optimized! Tested ${res.total} combinations.`, { type: 'success' });
        } else {
            toast('No feasible design found in the specified bounds.', { type: 'error' });
        }
    };

    useEffect(() => {
        const canvas = document.getElementById('retaining-wall-canvas') as HTMLCanvasElement;
        if (canvas) {
            drawRetainingWallDiagram(canvas, result);
        }
    }, [result]);

    const r = result;
    const safe = r.overallStatus === 'SAFE';

    return (
        <div className="container">
            <header className="header">
                <h1>Cantilever Retaining Wall Designer</h1>
                <p className="subtitle">Statically determinate — IS 456:2000 + Rankine earth pressure</p>
            </header>

            <div className="layout">
                {/* ─── SIDEBAR: Inputs ─── */}
                <aside className="sidebar">
                    <section className="panel">
                        <h2 className="panel-title"><span className="panel-icon">⚙️</span>Geometry</h2>
                        <div className="control-group">
                            <label htmlFor="H">Total Height H (mm)</label>
                            <input title="H" type="number" name="H" value={input.H} onChange={handleInputChange} id="H" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="H_soil">Retained Soil Height (mm)</label>
                            <input title="H_soil" type="number" name="H_soil" value={input.H_soil ?? input.H} onChange={handleInputChange} id="H_soil" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="D_stem_base">Stem Thickness at Base (mm)</label>
                            <input title="D_stem_base" type="number" name="D_stem_base" value={input.D_stem_base} onChange={handleInputChange} id="D_stem_base" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="D_stem_top">Stem Thickness at Top (mm)</label>
                            <input title="D_stem_top" type="number" name="D_stem_top" value={input.D_stem_top} onChange={handleInputChange} id="D_stem_top" />
                            <span className="input-validation-warn" style={{ display: input.D_stem_top >= input.D_stem_base ? 'block' : 'none' }}>⚠ Top thickness must be &lt; base thickness for a taper</span>
                        </div>
                        <div className="control-group">
                            <label htmlFor="D_base">Base Slab Thickness D_base (mm)</label>
                            <input title="D_base" type="number" name="D_base" value={input.D_base} onChange={handleInputChange} id="D_base" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="B">Total Base Width B (mm)</label>
                            <input title="B" type="number" name="B" value={input.B} onChange={handleInputChange} id="B" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="B_toe">Toe Projection B_toe (mm)</label>
                            <input title="B_toe" type="number" name="B_toe" value={input.B_toe} onChange={handleInputChange} id="B_toe" />
                        </div>
                        <div className="control-group">
                            <label>Heel Projection (derived)</label>
                            <input title="B_heel" type="number" value={r.B_heel} disabled />
                        </div>
                    </section>

                    <section className="panel">
                        <h2 className="panel-title"><span className="panel-icon">🌍</span>Soil &amp; Material</h2>
                        <div className="control-group">
                            <label htmlFor="phi">φ — Internal Friction (°)</label>
                            <input title="phi" type="number" name="phi" value={input.phi} onChange={handleInputChange} id="phi" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="gamma_soil">γ Soil (kN/m³)</label>
                            <input title="gamma_soil" type="number" step="0.5" name="gamma_soil" value={input.gamma_soil} onChange={handleInputChange} id="gamma_soil" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="gamma_concrete">γ Concrete (kN/m³)</label>
                            <input title="gamma_concrete" type="number" step="0.5" name="gamma_concrete" value={input.gamma_concrete} onChange={handleInputChange} id="gamma_concrete" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="q_surcharge">Surcharge q (kN/m²)</label>
                            <input title="q_surcharge" type="number" name="q_surcharge" value={input.q_surcharge} onChange={handleInputChange} id="q_surcharge" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="mu">μ — Base Friction Coeff.</label>
                            <input title="mu" type="number" step="0.05" name="mu" value={input.mu} onChange={handleInputChange} id="mu" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="sbc">SBC (kN/m²)</label>
                            <input title="sbc" type="number" name="sbc" value={input.sbc} onChange={handleInputChange} id="sbc" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="waterTableDepth">Water Table Depth from top (mm, 0=dry)</label>
                            <input title="waterTableDepth" type="number" name="waterTableDepth" value={input.waterTableDepth} onChange={handleInputChange} id="waterTableDepth" />
                        </div>
                        <div className="control-group">
                            <label>Concrete Grade</label>
                            <select title="grade" value={input.grade} onChange={e => handleGradeChange(e.target.value)}>
                                {['M20', 'M25', 'M30', 'M35', 'M40'].map(g => <option key={g} value={g}>{g} (fck={g.replace('M', '')})</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Steel Grade</label>
                            <select title="steelGrade" value={input.steelGrade} onChange={e => handleSteelChange(e.target.value)}>
                                {['Fe250', 'Fe415', 'Fe500', 'Fe550'].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="cover">Clear Cover (mm)</label>
                            <input title="cover" type="number" name="cover" value={input.cover} onChange={handleInputChange} id="cover" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="loadFactor">Load Factor (IS 456 Cl. 36.4)</label>
                            <input title="loadFactor" type="number" step="0.1" name="loadFactor" value={input.loadFactor} onChange={handleInputChange} id="loadFactor" />
                        </div>
                        <div className="info-note-inline">
                            τ<sub>c</sub> computed inbuilt from IS 456 Table 19 (getTauC for grade {input.grade}).
                        </div>
                    </section>

                    <section className="panel">
                        <h2 className="panel-title"><span className="panel-icon">⚡</span>Optimization</h2>
                        <div className="control-group">
                            <label>Min / Max Base Width B (mm)</label>
                            <div className="flex-row-gap-8">
                                <input type="number" value={optBounds.minB} onChange={e => setOptBounds(p => ({...p, minB: +e.target.value}))} />
                                <input type="number" value={optBounds.maxB} onChange={e => setOptBounds(p => ({...p, maxB: +e.target.value}))} />
                            </div>
                        </div>
                        <div className="control-group">
                            <label>Min / Max Thickness (mm)</label>
                            <div className="flex-row-gap-8">
                                <input type="number" value={optBounds.minThk} onChange={e => setOptBounds(p => ({...p, minThk: +e.target.value}))} />
                                <input type="number" value={optBounds.maxThk} onChange={e => setOptBounds(p => ({...p, maxThk: +e.target.value}))} />
                            </div>
                        </div>
                        <button className="btn-primary" style={{width: '100%', marginTop: 8}} onClick={handleOptimize}>Auto-Optimize Dimensions</button>
                    </section>
                </aside>

                {/* ─── MAIN CONTENT: Results ─── */}
                <main className="content">
                    {/* WALL DIAGRAM */}
                    <div id="sec-retaining-wall-diagram">
                        <canvas id="retaining-wall-canvas"></canvas>
                    </div>

                    {/* STATUS BANNER */}
                    <div className="panel status-banner-container">
                        <div className={`panel status-banner ${safe ? 'status-safe' : 'status-fail'}`}>
                            <div className="status-banner-content">
                                <div>
                                    <h2 className="status-title">Cantilever Retaining Wall — H = {fmt(input.H / 1000, 2)} m</h2>
                                    <p className="status-subtitle">{safe ? 'All stability + RC checks passed.' : 'One or more checks failed — see below.'}</p>
                                    <div className="status-chips">
                                        <span className={`chip ${safe ? 'chip-safe' : 'chip-fail'}`}>{r.overallStatus}</span>
                                        <span className="chip chip-info">K<sub>a</sub> = {fmt(r.Ka, 3)}</span>
                                        <span className="chip chip-info">ΣV = {fmt(r.SigmaV, 1)} kN/m</span>
                                        <span className="chip chip-info">ΣH = {fmt(r.Pa + r.Pq + r.Pa_water, 1)} kN/m</span>
                                        <span className="chip chip-info">p<sub>max</sub> = {fmt(r.p_max, 0)} kN/m²</span>
                                    </div>
                                </div>
                                <div className="flex-row-gap-8-wrap">
                                    <button className="btn-primary btn-preview" onClick={async () => {
                                        const canvas = document.getElementById('retaining-wall-canvas') as HTMLCanvasElement;
                                        const url = await generateRetainingWallReport(input, result, canvas, true);
                                        setPdfPreview((url as string) ?? null);
                                    }} title="Preview full calculation report">
                                        <span className="btn-icon">📄</span> Preview PDF Report
                                    </button>
                                    <button className="btn-primary btn-preview" onClick={() => exportToJSON({ input, result }, `retaining_wall_${timestampForFilename()}`, 'Cantilever Retaining Wall (IS 456)')} title="Export results to JSON file">
                                        <span className="btn-icon">📋</span> Export JSON
                                    </button>
                                    <button className="btn-primary btn-preview" onClick={async () => {
                                        const s = `CANTILEVER RETAINING WALL SUMMARY (IS 456:2000)\n${'='.repeat(50)}\nH=${fmt(input.H/1000,2)}m | B=${fmt(input.B/1000,2)}m | D_stem=${input.D_stem_base}/${input.D_stem_top}mm | D_base=${input.D_base}mm\nφ=${input.phi}° | γ_soil=${input.gamma_soil} | q=${input.q_surcharge} | SBC=${input.sbc} | μ=${input.mu}\n\nKa=${fmt(r.Ka,3)} | Pa=${fmt(r.Pa,1)} kN | Pq=${fmt(r.Pq,1)} kN | Pw=${fmt(r.Pa_water,1)} kN\nΣV=${fmt(r.SigmaV,1)} kN/m | ΣH=${fmt(r.Pa+r.Pq+r.Pa_water,1)} kN/m\n\nOverturning FoS: ${fmt(r.fos_overturning,2)} (≥1.4) ${r.overturning_ok?'OK':'FAIL'}\nSliding FoS: ${fmt(r.fos_sliding,2)} (≥1.4) ${r.sliding_ok?'OK':'FAIL'}\nBearing: p_max=${fmt(r.p_max,0)} vs SBC=${r.sbc} ${r.bearing_ok?'OK':'FAIL'}\nStem: Mu=${fmt(r.stem_Mu,1)} kN·m | Ast=${fmt(r.stem_Ast,0)} mm²/m | τv=${fmt(r.stem_tau_v,3)} vs τc=${fmt(r.stem_tau_c,3)} ${r.stem_shear_ok?'OK':'FAIL'}\nHeel: Mu=${fmt(r.heel_Mu,1)} | Ast=${fmt(r.heel_Ast,0)} | τv=${fmt(r.heel_tau_v,3)} vs τc=${fmt(r.heel_tau_c,3)} ${r.heel_shear_ok?'OK':'FAIL'}\nToe:  Mu=${fmt(r.toe_Mu,1)} | Ast=${fmt(r.toe_Ast,0)} | τv=${fmt(r.toe_tau_v,3)} vs τc=${fmt(r.toe_tau_c,3)} ${r.toe_shear_ok?'OK':'FAIL'}\nOverall: ${r.overallStatus}\n${'='.repeat(50)}`;
                                        const ok = await copyToClipboard(s);
                                        toast(ok ? '✅ Summary copied to clipboard' : '❌ Copy failed', { type: ok ? 'success' : 'error' });
                                    }} title="Copy key results to clipboard">
                                        <span className="btn-icon">📄</span> Copy Summary
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {pdfPreview && (
                        <div className="panel pdf-preview-panel">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <h3 className="panel-title" style={{ margin: 0 }}><span className="panel-icon">📄</span> PDF Report Preview</h3>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="btn-primary" onClick={async () => {
                                        const canvas = document.getElementById('retaining-wall-canvas') as HTMLCanvasElement;
                                        await generateRetainingWallReport(input, result, canvas, false);
                                    }}>Download PDF</button>
                                    <button className="btn-secondary" onClick={() => setPdfPreview(null)}>Close</button>
                                </div>
                            </div>
                            <iframe src={pdfPreview} width="100%" height="600px" style={{ border: 'none', borderRadius: '4px', backgroundColor: '#fff' }} />
                        </div>
                    )}

                    {/* STABILITY CHECKS */}
                    <div className="panel">
                        <h3 className="panel-title"><span className="panel-icon">⚖️</span>Stability Checks</h3>
                        <table className="result-table">
                            <thead>
                                <tr>
                                    <th>Check</th>
                                    <th>Computed FoS</th>
                                    <th>Required</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>Overturning (about toe) — <CodeRef clause="20.1">Cl. 20.1</CodeRef></td>
                                    <td>{fmt(r.fos_overturning, 2)}</td>
                                    <td>≥ 1.4</td>
                                    <td><span className={`chip ${r.overturning_ok ? 'chip-safe' : 'chip-fail'}`}>{r.overturning_ok ? 'OK' : 'FAIL'}</span></td>
                                </tr>
                                <tr>
                                    <td>Sliding (along base)</td>
                                    <td>{fmt(r.fos_sliding, 2)}</td>
                                    <td>≥ 1.4</td>
                                    <td><span className={`chip ${r.sliding_ok ? 'chip-safe' : 'chip-fail'}`}>{r.sliding_ok ? 'OK' : 'FAIL'}</span></td>
                                </tr>
                                <tr>
                                    <td>Bearing Pressure (p<sub>max</sub>)</td>
                                    <td>{fmt(r.p_max, 0)} kN/m²</td>
                                    <td>≤ {r.sbc} kN/m²</td>
                                    <td><span className={`chip ${r.bearing_ok ? 'chip-safe' : 'chip-fail'}`}>{r.bearing_ok ? 'OK' : 'FAIL'}</span></td>
                                </tr>
                            </tbody>
                        </table>
                        <div className="ld-note">
                            Resisting moment M<sub>R</sub> = {fmt(r.M_resisting, 1)} kN·m/m · Overturning moment M<sub>O</sub> = {fmt(r.M_overturning, 1)} kN·m/m · Eccentricity e = {fmt(r.eccentricity * 1000, 0)} mm (B/6 = {fmt(r.B / 6, 0)} mm)
                        </div>
                    </div>

                    {/* FORCE BREAKDOWN */}
                    <div className="panel">
                        <h3 className="panel-title"><span className="panel-icon">📊</span>Force Breakdown (per metre run)</h3>
                        <table className="result-table compact">
                            <thead>
                                <tr>
                                    <th>Force</th>
                                    <th>Value (kN/m)</th>
                                    <th>Lever arm (m)</th>
                                    <th>Moment about toe (kN·m/m)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr><td>Active earth pressure P<sub>a</sub> (soil)</td><td>{fmt(r.Pa, 1)}</td><td>{fmt(r.Pa_arm, 3)}</td><td>{fmt(r.Pa * r.Pa_arm, 1)}</td></tr>
                                {r.Pq > 0 && <tr><td>Surcharge P<sub>q</sub></td><td>{fmt(r.Pq, 1)}</td><td>{fmt(r.Pq_arm, 3)}</td><td>{fmt(r.Pq * r.Pq_arm, 1)}</td></tr>}
                                {r.Pa_water > 0 && <tr><td>Water pressure P<sub>w</sub></td><td>{fmt(r.Pa_water, 1)}</td><td>{fmt(r.Pa_water_arm, 3)}</td><td>{fmt(r.Pa_water * r.Pa_water_arm, 1)}</td></tr>}
                                <tr className="row-subtotal"><td colSpan={3} style={{ textAlign: 'right' }}>Σ Overturning (horizontal)</td><td>{fmt(r.M_overturning, 1)}</td></tr>
                                <tr><td>Self-weight of stem W<sub>stem</sub></td><td>{fmt(r.W_stem, 1)}</td><td>{fmt(r.B_toe / 1000 + r.D_stem_base / 2000, 3)}</td><td>{fmt(r.W_stem * (r.B_toe / 1000 + r.D_stem_base / 2000), 1)}</td></tr>
                                <tr><td>Self-weight of base W<sub>base</sub></td><td>{fmt(r.W_base, 1)}</td><td>{fmt(r.B / 2000, 3)}</td><td>{fmt(r.W_base * r.B / 2000, 1)}</td></tr>
                                <tr><td>Soil on heel W<sub>soil</sub></td><td>{fmt(r.W_soil, 1)}</td><td>{fmt(r.B_toe / 1000 + r.D_stem_base / 1000 + r.B_heel / 2000, 3)}</td><td>{fmt(r.W_soil * (r.B_toe / 1000 + r.D_stem_base / 1000 + r.B_heel / 2000), 1)}</td></tr>
                                {r.W_surcharge > 0 && <tr><td>Surcharge on heel W<sub>q</sub></td><td>{fmt(r.W_surcharge, 1)}</td><td>{fmt(r.B_toe / 1000 + r.D_stem_base / 1000 + r.B_heel / 2000, 3)}</td><td>{fmt(r.W_surcharge * (r.B_toe / 1000 + r.D_stem_base / 1000 + r.B_heel / 2000), 1)}</td></tr>}
                                <tr className="row-subtotal"><td colSpan={3} style={{ textAlign: 'right' }}>Σ Resisting (vertical)</td><td>{fmt(r.M_resisting, 1)}</td></tr>
                            </tbody>
                        </table>
                    </div>

                    {/* STEM DESIGN */}
                    <div className="panel">
                        <h3 className="panel-title"><span className="panel-icon">📏</span>Stem Design — <CodeRef clause="38.1">Cl. 38.1</CodeRef> flexure, <CodeRef clause="40.2">Cl. 40</CodeRef> shear</h3>
                        <table className="result-table compact">
                            <tbody>
                                <tr><td>Service moment at stem base (per m)</td><td>{fmt(r.stem_M_service, 1)} kN·m/m</td></tr>
                                <tr><td>Factored moment M<sub>u</sub></td><td><strong>{fmt(r.stem_Mu, 1)} kN·m/m</strong></td></tr>
                                <tr><td>Effective depth d</td><td>{fmt(r.stem_d, 0)} mm</td></tr>
                                <tr><td>A<sub>st</sub> required (per m)</td><td>{fmt(r.stem_Ast, 0)} mm²/m</td></tr>
                                <tr><td>p<sub>t</sub></td><td>{fmt(r.stem_pt, 3)} %</td></tr>
                                <tr><td>τ<sub>v</sub> = V<sub>u</sub>/(b·d)</td><td>{fmt(r.stem_tau_v, 3)} N/mm²</td></tr>
                                <tr><td>τ<sub>c</sub> (Table 19)</td><td>{fmt(r.stem_tau_c, 3)} N/mm²</td></tr>
                                <tr><td>Shear status</td><td><span className={`chip ${r.stem_shear_ok ? 'chip-safe' : 'chip-fail'}`}>{r.stem_shear_ok ? 'OK' : 'FAIL'}</span></td></tr>
                            </tbody>
                        </table>
                    </div>

                    {/* HEEL DESIGN */}
                    <div className="panel">
                        <h3 className="panel-title"><span className="panel-icon">📐</span>Heel Design (tension at top)</h3>
                        <table className="result-table compact">
                            <tbody>
                                <tr><td>Net downward force on heel</td><td>{fmt(r.heel_M_service * 2 / (r.B_heel / 1000), 1)} kN/m</td></tr>
                                <tr><td>Service moment at stem face</td><td>{fmt(r.heel_M_service, 1)} kN·m/m</td></tr>
                                <tr><td>Factored moment M<sub>u</sub></td><td><strong>{fmt(r.heel_Mu, 1)} kN·m/m</strong></td></tr>
                                <tr><td>Effective depth d</td><td>{fmt(r.heel_d, 0)} mm</td></tr>
                                <tr><td>A<sub>st</sub> required (per m)</td><td>{fmt(r.heel_Ast, 0)} mm²/m</td></tr>
                                <tr><td>p<sub>t</sub></td><td>{fmt(r.heel_pt, 3)} %</td></tr>
                                <tr><td>τ<sub>v</sub></td><td>{fmt(r.heel_tau_v, 3)} N/mm²</td></tr>
                                <tr><td>τ<sub>c</sub> (Table 19)</td><td>{fmt(r.heel_tau_c, 3)} N/mm²</td></tr>
                                <tr><td>Shear status</td><td><span className={`chip ${r.heel_shear_ok ? 'chip-safe' : 'chip-fail'}`}>{r.heel_shear_ok ? 'OK' : 'FAIL'}</span></td></tr>
                            </tbody>
                        </table>
                    </div>

                    {/* TOE DESIGN */}
                    <div className="panel">
                        <h3 className="panel-title"><span className="panel-icon">📐</span>Toe Design (tension at bottom)</h3>
                        <table className="result-table compact">
                            <tbody>
                                <tr><td>Net upward force on toe</td><td>{fmt(r.toe_M_service * 2 / (r.B_toe / 1000), 1)} kN/m</td></tr>
                                <tr><td>Service moment at stem face</td><td>{fmt(r.toe_M_service, 1)} kN·m/m</td></tr>
                                <tr><td>Factored moment M<sub>u</sub></td><td><strong>{fmt(r.toe_Mu, 1)} kN·m/m</strong></td></tr>
                                <tr><td>Effective depth d</td><td>{fmt(r.toe_d, 0)} mm</td></tr>
                                <tr><td>A<sub>st</sub> required (per m)</td><td>{fmt(r.toe_Ast, 0)} mm²/m</td></tr>
                                <tr><td>p<sub>t</sub></td><td>{fmt(r.toe_pt, 3)} %</td></tr>
                                <tr><td>τ<sub>v</sub></td><td>{fmt(r.toe_tau_v, 3)} N/mm²</td></tr>
                                <tr><td>τ<sub>c</sub> (Table 19)</td><td>{fmt(r.toe_tau_c, 3)} N/mm²</td></tr>
                                <tr><td>Shear status</td><td><span className={`chip ${r.toe_shear_ok ? 'chip-safe' : 'chip-fail'}`}>{r.toe_shear_ok ? 'OK' : 'FAIL'}</span></td></tr>
                            </tbody>
                        </table>
                    </div>

                    {r.messages.length > 0 && (
                        <div className="panel">
                            <h3 className="panel-title"><span className="panel-icon">⚠️</span>Issues</h3>
                            <ul className="error-list">
                                {r.messages.map((m, i) => <li key={i}>{m}</li>)}
                            </ul>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
