"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { analyzeBeam, toFrac } from "./beamEngine";
import { drawBeamDiagram, drawDiagramPlot } from "./beamRender";
import {
    renderReactionsHTML,
    renderSpanCardsHTML,
    renderValidationHTML,
    renderNumericResultsHTML
} from "./beamHtml";
import { parseNumber } from "../lib/inputUtils";
import { logger } from "../lib/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Tapered-beam UI helper
//
// Derives a beam depth `d` from a normalized EI value via Math.cbrt(refEI).
// This implicitly assumes the engine's tapered-beam convention:
//     EI = E · b · d³ / 12
// with E = 1 and b = 12 (both set explicitly in `spanTapers.push({ ..., b: 12, E: 1 })`
// below). With those constants, EI = 12 · d³ / 12 = d³, so d = ∛(EI).
//
// If the `b: 12` or `E: 1` constants are ever changed, this derivation MUST be
// updated to:  d = ∛(12 · EI / (E · b))
// ─────────────────────────────────────────────────────────────────────────────
const TAPER_B = 12;   // matches `b: 12` in the spanTapers.push below
const TAPER_E = 1;    // matches `E: 1`  in the spanTapers.push below
function depthFromEI(refEI: number): number {
    // d³ = 12 · EI / (E · b)  →  with E=1, b=12:  d³ = EI  →  d = ∛(EI)
    return Math.cbrt((12 * refEI) / (TAPER_E * TAPER_B));
}

export default function BeamAnalyzer() {
    // 1. State definitions
    const [nSpans, setNSpans] = useState(2);
    const [endCond, setEndCond] = useState("pinned");
    const [loadCase, setLoadCase] = useState("udl+uvl");
    const [wVal, setWVal] = useState(10);
    const [w1Val, setW1Val] = useState(10);
    const [w2Val, setW2Val] = useState(5);

    const [spanLengths, setSpanLengths] = useState([1, 1, 1, 1, 1, 1]);
    const [spanEIs, setSpanEIs] = useState([1, 1, 1, 1, 1, 1]);
    const [spanIsTapered, setSpanIsTapered] = useState([false, false, false, false, false, false]);
    const [spanTaperRatios, setSpanTaperRatios] = useState([2, 2, 2, 2, 2, 2]);
    const [lastSpanLoadStop, setLastSpanLoadStop] = useState(0);

    const [refSpanL, setRefSpanL] = useState(0);
    const [refSpanEI, setRefSpanEI] = useState(0);

    const [error, setError] = useState<string | null>(null);
    const [resultData, setResultData] = useState<any>(null);

    // Canvas refs
    const beamCanvasRef = useRef(null);
    const sfdCanvasRef = useRef(null);
    const bmdCanvasRef = useRef(null);

    // PERF-002: debounce + PERF-003: rAF coalescing, mirroring WallAnalyzer.
    const initialized = useRef(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastDrawnResult = useRef<any>(null);
    const rafRef = useRef<number | null>(null);

    // 2. Analysis runner — pure: builds cfg, runs engine, returns {result, html, error}.
    //    Does NOT touch state directly so the effect can debounce + coalesce cleanly.
    const runAnalysis = useCallback(() => {
        try {
            // Fix H5: Enforce strict bounds
            const safeNSpans = Math.max(1, Math.min(6, parseInt(String(nSpans)) || 2));
            const safeRefSpanL = Math.min(safeNSpans - 1, Math.max(0, parseInt(String(refSpanL)) || 0));
            const safeRefSpanEI = Math.min(safeNSpans - 1, Math.max(0, parseInt(String(refSpanEI)) || 0));

            // Validate all inputs before engine
            if (safeNSpans < 1 || safeNSpans > 6) throw new Error("Invalid number of spans.");

            const fracLengths = [];
            const fracEIs = [];
            for (let i = 0; i < safeNSpans; i++) {
                const l = Math.max(0.001, parseFloat(String(spanLengths[i])) || 1);
                const ei = Math.max(0.001, parseFloat(String(spanEIs[i])) || 1);
                fracLengths.push(toFrac(l));
                fracEIs.push(toFrac(ei));
            }

            const spanTapers = [];
            for (let i = 0; i < safeNSpans; i++) {
                if (spanIsTapered[i]) {
                    const refEI = parseFloat(String(spanEIs[safeRefSpanEI])) || 1;
                    const L = parseFloat(String(spanLengths[i])) || 1;
                    const r = parseFloat(String(spanTaperRatios[i])) || 1;

                    let d1, d2;
                    // Always normalize w.r.t. d₂: d₂ has EI = refEI (the reference),
                    // d₁ = d₂ × ratio. This means:
                    //   ratio = 2 → d₁ = 2·d₂ (left deeper, stiffer)
                    //   ratio = 0.5 → d₁ = 0.5·d₂ (right deeper, stiffer)
                    d2 = depthFromEI(refEI);
                    d1 = d2 * r;

                    spanTapers.push({ d1, d2, b: TAPER_B, E: TAPER_E, L });
                } else {
                    spanTapers.push(null);
                }
            }

            const cfg = {
                nSpans: safeNSpans,
                loadCase,
                endCond,
                spanLengths: fracLengths,
                spanEIs: fracEIs,
                spanTapers,
                refSpanL: safeRefSpanL,
                refSpanEI: safeRefSpanEI,
                L_ref_phys: parseFloat(String(spanLengths[safeRefSpanL])) || 1,
                EI_ref_phys: parseFloat(String(spanEIs[safeRefSpanEI])) || 1,
                w1Val: Math.max(0, w1Val),
                w2Val: Math.max(0, w2Val),
                lastSpanLoadStop: parseNumber(lastSpanLoadStop, 0, 0)
            };

            // Mathematical Engine call
            const result = analyzeBeam(cfg);

            const LVal = fracLengths[safeRefSpanL].fl();
            const safeW = Math.max(0, wVal);
            const safeW1 = Math.max(0, w1Val);
            const safeW2 = Math.max(0, w2Val);

            // Generate HTML views using pure string return functions (Fix H3)
            const { reactionsHtml, eqHtml } = renderReactionsHTML(result, safeW, LVal);
            const spansHtml = renderSpanCardsHTML(result, safeW, LVal);
            const validHtml = renderValidationHTML(result);
            const numericHtml = renderNumericResultsHTML(result, safeW, safeW1, safeW2);

            return {
                result,
                LVal,
                reactionsHtml,
                eqHtml,
                spansHtml,
                validHtml,
                numericHtml,
                wVal: safeW,
                error: null,
            };
        } catch (e: any) {
            logger.error("Analysis Error:", e);
            return { error: e.message, result: null };
        }
    }, [nSpans, loadCase, endCond, wVal, w1Val, w2Val, spanLengths, spanEIs, spanIsTapered, spanTaperRatios, lastSpanLoadStop, refSpanL, refSpanEI]);

    // PERF-002: debounced analysis on input changes. First run is immediate so
    // the user sees output on mount; subsequent changes wait 150 ms.
    useEffect(() => {
        if (!initialized.current) {
            initialized.current = true;
            const out = runAnalysis();
            setError(out.error);
            setResultData(out.error ? null : out);
            return;
        }
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            const out = runAnalysis();
            setError(out.error);
            setResultData(out.error ? null : out);
        }, 150);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [runAnalysis]);

    // PERF-003: draw to canvases ONLY when the analysis result reference changes.
    // Coalesce multiple draws into a single requestAnimationFrame.
    useEffect(() => {
        if (!resultData || resultData.error) return;
        if (lastDrawnResult.current === resultData) return;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);

        const draw = () => {
            try {
                const { result, LVal, wVal: safeW } = resultData;
                if (beamCanvasRef.current) drawBeamDiagram(beamCanvasRef.current, result, safeW, LVal);
                if (sfdCanvasRef.current) drawDiagramPlot(sfdCanvasRef.current, result, 'sfd');
                if (bmdCanvasRef.current) drawDiagramPlot(bmdCanvasRef.current, result, 'bmd');
                lastDrawnResult.current = resultData;
            } catch (drawError) {
                logger.error("Visualization Error:", drawError);
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
    }, [resultData]);

    // Handle array updates safely
    const handleSpanChange = (index: number, field: string, value: any): void => {
        if (field === 'taperChecked') {
            const arr = [...spanIsTapered];
            arr[index] = value;
            setSpanIsTapered(arr);
        } else if (field === 'taperRatio') {
            const arr = [...spanTaperRatios];
            arr[index] = parseNumber(value, 0.001, 1);
            setSpanTaperRatios(arr);
        } else {
            const parsed = parseNumber(value, 0.001, 1);
            if (field === 'l') {
                const arr = [...spanLengths];
                arr[index] = parsed;
                setSpanLengths(arr);
            } else {
                const arr = [...spanEIs];
                arr[index] = parsed;
                setSpanEIs(arr);
            }
        }
    };

    // Derived description
    const getDescription = () => {
        if (!resultData) return "Error computing load description.";
        const allEqual = spanLengths.slice(0, nSpans).every(l => Math.abs(l - spanLengths[0]) < 1e-5) &&
                         spanEIs.slice(0, nSpans).every(ei => Math.abs(ei - spanEIs[0]) < 1e-5);
        if (loadCase === 'udl') {
            return allEqual
                ? `Uniform Distributed Load (w = ${wVal}) on all ${nSpans} span(s). Equal spans.`
                : `UDL (w = ${wVal}) on all ${nSpans} span(s). Variable span properties.`;
        } else if (loadCase === 'uvl-global') {
            return `Globally linear UVL: w = ${wVal} at support A, decreasing to 0 at the last support.`;
        } else if (loadCase === 'udl+uvl') {
            return `Combined Trapezoidal Load: w₁ at support A linearly interpolating to w₂ at the last support. Plotted using actual w₁ and w₂ values.`;
        } else {
            return `Independent UVL on each span: w = ${wVal} at left end → 0 at right end of each span.`;
        }
    };

    return (
        <div className="container">
            <header className="header">
                <h1>Continuous Beam Analyzer</h1>
                <p className="subtitle">Exact Symbolic Formulations & Actual Physical Values</p>
            </header>

            <div className="layout">
                <aside className="sidebar">
                    <section className="panel">
                        <h2 className="panel-title"><span className="panel-icon">&#9881;</span>Configuration</h2>

                        <div className="control-group">
                            <label htmlFor="num-spans">Number of Spans</label>
                            <select id="num-spans" value={nSpans} onChange={(e) => {
                                const val = parseInt(e.target.value);
                                setNSpans(val);
                                if (refSpanL >= val) setRefSpanL(0);
                                if (refSpanEI >= val) setRefSpanEI(0);
                            }}>
                                {[1, 2, 3, 4, 5, 6].map(i => <option key={i} value={i}>{i} Span{i>1?'s':''}</option>)}
                            </select>
                        </div>

                        <div className="control-group">
                            <label htmlFor="end-condition">End Conditions</label>
                            <select id="end-condition" value={endCond} onChange={(e) => setEndCond(e.target.value)}>
                                <option value="pinned">Pinned - Pinned</option>
                                <option value="fixed">Fixed Left - Pinned</option>
                                <option value="fixed-fixed">Fixed Left - Fixed Right</option>
                            </select>
                        </div>

                        <div className="control-group">
                            <label htmlFor="load-case">Load Case (Pattern)</label>
                            <select id="load-case" value={loadCase} onChange={(e) => setLoadCase(e.target.value)}>
                                <option value="udl">Uniform Distributed Load (UDL)</option>
                                <option value="udl+uvl">UDL + UVL (Combined Trap)</option>
                                <option value="uvl-global">UVL (Global Linear Decrease)</option>
                                <option value="uvl-span">UVL (Per-Span Linear Decrease)</option>
                            </select>
                        </div>

                        {loadCase !== 'udl+uvl' && (
                            <div className="control-group">
                                <label htmlFor="val-w">Load Intensity (w)</label>
                                <input type="number" id="val-w" value={wVal} step="0.5" min="0" onChange={(e) => setWVal(parseNumber(e.target.value, 0, 0))} />
                            </div>
                        )}

                        {loadCase === 'udl+uvl' && (
                            <>
                                <div className="control-group">
                                    <label htmlFor="val-w1">Load Intensity (w₁ at left)</label>
                                    <input type="number" id="val-w1" value={w1Val} step="0.5" min="0" onChange={(e) => setW1Val(parseNumber(e.target.value, 0, 0))} />
                                </div>
                                <div className="control-group">
                                    <label htmlFor="val-w2">Load Intensity (w₂ at right)</label>
                                    <input type="number" id="val-w2" value={w2Val} step="0.5" min="0" onChange={(e) => setW2Val(parseNumber(e.target.value, 0, 0))} />
                                </div>
                            </>
                        )}

                        <div className="control-group">
                            <label htmlFor="last-span-stop">Last Span Load Stop Dist (a)</label>
                            <div className="input-hint-text">0 means full span loaded</div>
                            <input type="number" id="last-span-stop" value={lastSpanLoadStop} step="0.1" min="0" onChange={(e) => setLastSpanLoadStop(parseNumber(e.target.value, 0, 0))} />
                        </div>

                        <div className="span-props-section">
                            <div className="span-props-title">Span Properties</div>
                            <div className="span-props-table">
                                {Array.from({ length: nSpans }).map((_, i) => (
                                    <div key={i} className={`taper-span-row ${i < nSpans - 1 ? 'border-bottom' : ''}`}>
                                        <div className="taper-span-header">
                                            <span className="span-prop-cell span-prop-label taper-span-label">
                                                {i + 1} ({String.fromCharCode(65 + i)}→{String.fromCharCode(66 + i)})
                                            </span>
                                            <div className="taper-input-group">
                                                <span className="taper-input-label l-label">L:</span>
                                                <input type="number" aria-label={`Span ${i + 1} Length`} className="span-prop-input" value={spanLengths[i]} min="0.001" step="0.1" onChange={(e) => handleSpanChange(i, 'l', e.target.value)} />
                                            </div>
                                            <div className="taper-input-group">
                                                <span className="taper-input-label ei-label">EI:</span>
                                                {spanIsTapered[i] ? (
                                                    <div className="taper-auto-box">
                                                        Auto (Tapered)
                                                    </div>
                                                ) : (
                                                    <input type="number" aria-label={`Span ${i + 1} EI`} className="span-prop-input" value={spanEIs[i]} min="0.001" step="0.1" onChange={(e) => handleSpanChange(i, 'ei', e.target.value)} />
                                                )}
                                            </div>
                                        </div>
                                        <div className="taper-options-group">
                                            <label className="taper-checkbox-label">
                                                <input type="checkbox" aria-label={`Span ${i + 1} Tapered`} checked={spanIsTapered[i]} onChange={(e) => handleSpanChange(i, 'taperChecked', e.target.checked)} className="taper-checkbox" />
                                                Tapered (Linear)
                                            </label>
                                            {spanIsTapered[i] && (
                                                <div className="taper-ratio-group">
                                                    <span className="taper-ratio-label">Depth Ratio <span className="taper-ratio-symbol">d₁/d₂</span>:</span>
                                                    <input type="number" aria-label={`Span ${i + 1} Taper Ratio`} className="span-prop-input taper-ratio-input" value={spanTaperRatios[i]} min="0.01" step="0.1" onChange={(e) => handleSpanChange(i, 'taperRatio', e.target.value)} />
                                                    <span className="taper-ratio-hint">
                                                        {spanTaperRatios[i] >= 1 ? `d₁ > d₂ (left deeper)` : `d₁ < d₂ (right deeper)`}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="norm-ref-row">
                                <div className="control-group">
                                    <label>Reference Span (L)</label>
                                    <select aria-label="Reference Span L" value={refSpanL} onChange={(e) => setRefSpanL(parseInt(e.target.value))}>
                                        {Array.from({ length: nSpans }).map((_, i) => <option key={`l${i}`} value={i}>Span {i + 1}</option>)}
                                    </select>
                                </div>
                                <div className="control-group">
                                    <label>Reference Span (EI)</label>
                                    <select aria-label="Reference Span EI" value={refSpanEI} onChange={(e) => setRefSpanEI(parseInt(e.target.value))}>
                                        {Array.from({ length: nSpans }).map((_, i) => <option key={`ei${i}`} value={i}>Span {i + 1}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </section>
                </aside>

                <main className="content">
                    <div className="desc-box">
                        {error ? <span className="error-text">Error: {error}</span> : getDescription()}
                    </div>

                    <section className={`panel ${resultData && !error ? '' : 'hidden'}`}>
                        <h2 className="panel-title"><span className="panel-icon">&#128208;</span>Beam Schematic</h2>
                        <div className="canvas-wrapper schematic-wrapper">
                            <canvas ref={beamCanvasRef}></canvas>
                        </div>
                    </section>

                    <section className={`panel ${resultData && !error ? '' : 'hidden'}`}>
                        <h2 className="panel-title"><span className="panel-icon">&#9878;</span>Support Reactions</h2>
                        {resultData && <div dangerouslySetInnerHTML={{ __html: resultData.reactionsHtml }} />}
                        {resultData && <div dangerouslySetInnerHTML={{ __html: resultData.eqHtml }} />}
                    </section>

                    <section className={`panel ${resultData && !error ? '' : 'hidden'}`}>
                        <h2 className="panel-title"><span className="panel-icon">&#128203;</span>Span Analysis (Exact Expressions)</h2>
                        {resultData && <div className="span-cards-grid" dangerouslySetInnerHTML={{ __html: resultData.spansHtml }} />}
                    </section>

                    <section className={`panel ${resultData && !error ? '' : 'hidden'}`}>
                        <h2 className="panel-title"><span className="panel-icon">&#128200;</span>Shear Force Diagram (SFD)</h2>
                        <div className="canvas-wrapper">
                            <canvas ref={sfdCanvasRef}></canvas>
                        </div>
                    </section>

                    <section className={`panel ${resultData && !error ? '' : 'hidden'}`}>
                        <h2 className="panel-title"><span className="panel-icon">&#128201;</span>Bending Moment Diagram (BMD)</h2>
                        <div className="canvas-wrapper">
                            <canvas ref={bmdCanvasRef}></canvas>
                        </div>
                    </section>

                    <section className={`panel ${resultData && !error ? '' : 'hidden'}`}>
                        <h2 className="panel-title"><span className="panel-icon">&#128202;</span>Actual Numeric Results</h2>
                        {resultData && <div className="table-wrap" dangerouslySetInnerHTML={{ __html: resultData.numericHtml }} />}
                    </section>

                    <section className={`panel ${resultData && !error ? '' : 'hidden'}`}>
                        <h2 className="panel-title"><span className="panel-icon">&#10003;</span>Validation Summary</h2>
                        {resultData && <div dangerouslySetInnerHTML={{ __html: resultData.validHtml }} />}
                    </section>
                </main>
            </div>
        </div>
    );
}
