"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    runDesign, portalGeometry, craneReactions, isSymmetricPortal, isSymmetricMultiSpan,
    type SteelCode, type SteelInput, type DesignResult, type SteelOptimizeResult,
    type PortalFrameInput, type MultiSpanFrameInput, type CraneInput, type ColumnInput, type BeamInput,
} from "./steelFrameEngine";
import type { MemberSection } from "../lib/steelSection";
import type { ISStationResult } from "../lib/steelIS800";
import type { AISCStationResult } from "../lib/steelAISC360";
import { logger } from "../lib/logger";

type Mode = 'frame' | 'multispan' | 'column' | 'beam';

interface SecForm { d0: number; d1: number; bf: number; tf: number; tw: number }

const num = (v: string, fallback = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : fallback; };
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '∞');
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '∞');
const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '∞');
const parseList = (s: string) => s.split(/[,\s]+/).map(Number).filter(x => Number.isFinite(x) && x > 0);
const parseSigned = (s: string) => s.split(/[,;\s]+/).filter(Boolean).map(Number).filter(x => Number.isFinite(x));

const utilColor = (u: number) => (u > 1 ? '#ef4444' : u > 0.9 ? '#f97316' : u > 0.7 ? '#eab308' : '#10b981');

// Code-dependent defaults: wind coefficients and roof live load
// Crane defaults: IS 875-2 Cl. 6.3 Table 3 (EOT crane: vertical impact 25 %, surge 10 % of crab + lifted load);
// ASCE 7-22 §4.9.3 / §4.9.4 (powered cab/remote-operated bridge crane: impact 25 %, lateral 20 % of capacity + hoist/trolley).
// Serviceability limits are project values — IS 800 Table 6 / AISC Design Guide 7; verify.
const CRANE_DEFAULTS: Record<SteelCode, { impact: number; surge: number; lateralLimit: number; spreadLimit: number }> = {
    IS800: { impact: 0.25, surge: 0.10, lateralLimit: 400, spreadLimit: 10 },
    AISC360: { impact: 0.25, surge: 0.20, lateralLimit: 240, spreadLimit: 25 },
};

const CODE_DEFAULTS: Record<SteelCode, { live: number; cpe: PortalFrameInput['cpe']; cpi: [number, number]; windServiceFactor: number }> = {
    // IS 875-3 Tables 4/5 (h/w ≤ ½, roof ≈ 5°), Cpi ±0.2 (low permeability); IS 875-2 roof LL 0.75 kN/m² (no access, θ ≤ 10°)
    IS800: { live: 0.75, cpe: { windwardWall: 0.7, leewardWall: -0.25, windwardRoof: -0.9, leewardRoof: -0.4 }, cpi: [0.2, -0.2], windServiceFactor: 1.0 },
    // ASCE 7-22 Ch. 27 (G = 0.85 included: GCp), enclosed GCpi ±0.18; Lr reduced for large tributary area (0.58 kN/m² minimum)
    AISC360: { live: 0.58, cpe: { windwardWall: 0.68, leewardWall: -0.43, windwardRoof: -0.77, leewardRoof: -0.43 }, cpi: [0.18, -0.18], windServiceFactor: 1.0 },
};

function SecInputs({ label, value, onChange, d0Label, d1Label, extra }: {
    label: string; value: SecForm; onChange: (v: SecForm) => void; d0Label: string; d1Label: string; extra?: React.ReactNode;
}) {
    const set = (k: keyof SecForm) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: num(e.target.value, value[k]) });
    return (
        <div className="panel mt-16px">
            <h3 className="panel-title"><span className="panel-icon">⌶</span>{label}</h3>
            <div className="norm-ref-row">
                <div className="control-group"><label>{d0Label} (mm)</label><input type="number" step="25" value={value.d0} onChange={set('d0')} title={d0Label} /></div>
                <div className="control-group"><label>{d1Label} (mm)</label><input type="number" step="25" value={value.d1} onChange={set('d1')} title={d1Label} /></div>
            </div>
            <div className="norm-ref-row">
                <div className="control-group"><label>bf (mm)</label><input type="number" step="10" value={value.bf} onChange={set('bf')} title="flange width" /></div>
                <div className="control-group"><label>tf (mm)</label><input type="number" step="1" value={value.tf} onChange={set('tf')} title="flange thickness" /></div>
                <div className="control-group"><label>tw (mm)</label><input type="number" step="1" value={value.tw} onChange={set('tw')} title="web thickness" /></div>
            </div>
            {extra}
        </div>
    );
}

function Num({ label, value, onChange, step = 0.1, title }: { label: string; value: number; onChange: (v: number) => void; step?: number; title?: string }) {
    return (
        <div className="control-group">
            <label>{label}</label>
            <input type="number" step={step} value={value} title={title ?? label} onChange={e => onChange(num(e.target.value, value))} />
        </div>
    );
}

export default function SteelAnalyzer() {
    const [mode, setMode] = useState<Mode>('frame');
    const [code, setCode] = useState<SteelCode>('IS800');
    const [fy, setFy] = useState(345);

    // ── Portal frame ──
    const [span, setSpan] = useState(24);
    const [eave, setEave] = useState(7);
    const [slope, setSlope] = useState(5.71);
    const [eaveR, setEaveR] = useState(7);
    const [slopeR, setSlopeR] = useState(5.71);
    const [windDirs, setWindDirs] = useState<'auto' | 'left' | 'both'>('auto');
    const [cpeRSame, setCpeRSame] = useState(true);
    const [bay, setBay] = useState(7.5);
    const [base, setBase] = useState<'pinned' | 'fixed'>('pinned');
    const [col, setCol] = useState<SecForm>({ d0: 300, d1: 700, bf: 200, tf: 10, tw: 6 });
    const [raf, setRaf] = useState<SecForm>({ d0: 700, d1: 400, bf: 200, tf: 10, tw: 6 });
    const [taper, setTaper] = useState(0.35);
    const [dead, setDead] = useState(0.15);
    const [live, setLive] = useState(CODE_DEFAULTS.IS800.live);
    const [windP, setWindP] = useState(1.0);
    const [cpe, setCpe] = useState(CODE_DEFAULTS.IS800.cpe);
    const [cpeR, setCpeR] = useState(CODE_DEFAULTS.IS800.cpe);
    const [cpi, setCpi] = useState<[number, number]>(CODE_DEFAULTS.IS800.cpi);
    const [colLy, setColLy] = useState(1.5);
    const [rafLy, setRafLy] = useState(1.5);
    const [vLim, setVLim] = useState(180);
    const [hLim, setHLim] = useState(150);
    const [wsf, setWsf] = useState(1.0);

    // ── Multi-span frame ──
    const [msSpans, setMsSpans] = useState([{ span: 20, slopeL: 5.71, slopeR: 5.71 }, { span: 20, slopeL: 5.71, slopeR: 5.71 }]);
    const [msHeights, setMsHeights] = useState([8, 8, 8]);
    const [icol, setICol] = useState<SecForm>({ d0: 350, d1: 350, bf: 200, tf: 10, tw: 6 });
    const [roofList, setRoofList] = useState('-0.9, -0.4');
    const [roofListR, setRoofListR] = useState('-0.9, -0.4');
    const setSpanCount = (nn: number) => {
        const n = Math.min(6, Math.max(1, Math.round(nn)));
        setMsSpans(prev => Array.from({ length: n }, (_, k) => prev[k] ?? prev[prev.length - 1]));
        setMsHeights(prev => Array.from({ length: n + 1 }, (_, k) => prev[k] ?? prev[prev.length - 1]));
    };

    // ── Crane (portal and multi-span frames) ──
    const [craneOn, setCraneOn] = useState(false);
    const [crane, setCrane] = useState<CraneInput>({
        span: 0, capacity: 100, crabWeight: 30, bridgeWeight: 120, hookApproach: 1.0, wheelBase: 3.5, eccentricity: 0.5,
        bracketLevel: 5.5, railLevel: 6.1, girderWeight: 1.5, ...CRANE_DEFAULTS.IS800,
    });
    const setCr = (k: keyof CraneInput) => (v: number) => setCrane(c => ({ ...c, [k]: v }));

    // ── Column ──
    const [cH, setCH] = useState(6);
    const [cBase, setCBase] = useState<'pinned' | 'fixed'>('fixed');
    const [cTop, setCTop] = useState<'free' | 'braced'>('free');
    const [cSec, setCSec] = useState<SecForm>({ d0: 500, d1: 300, bf: 200, tf: 12, tw: 6 });
    const [cP, setCP] = useState({ D: 80, L: 60, W: 0 });
    const [cM, setCM] = useState({ D: 0, L: 0, W: 0 });
    const [cW, setCW] = useState(4);
    const [cLy, setCLy] = useState(2);

    // ── Beam ──
    const [bSpan, setBSpan] = useState(10);
    const [bSup, setBSup] = useState<BeamInput['supports']>('pinned-pinned');
    const [bShape, setBShape] = useState<'linear' | 'haunched'>('linear');
    const [bHaunch, setBHaunch] = useState(0.2);
    const [bSec, setBSec] = useState<SecForm>({ d0: 500, d1: 500, bf: 200, tf: 12, tw: 6 });
    const [bw, setBw] = useState({ D: 8, L: 10, W: 0 });
    const [bP, setBP] = useState({ D: 0, L: 0, a: 5 });
    const [bLy, setBLy] = useState(2);
    const [bVLim, setBVLim] = useState(300);

    // ── Optimizer ──
    const [dMin, setDMin] = useState(250);
    const [dMax, setDMax] = useState(900);
    const [dStep, setDStep] = useState(50);
    const [bfList, setBfList] = useState('150, 180, 200, 220, 250, 300');
    const [tfList, setTfList] = useState('6, 8, 10, 12, 14, 16, 20');
    const [twList, setTwList] = useState('4, 5, 6, 8, 10');
    const [optRunning, setOptRunning] = useState(false);
    const [optProgress, setOptProgress] = useState<{ done: number; total: number; feasible: number } | null>(null);
    const [optResult, setOptResult] = useState<SteelOptimizeResult | null>(null);
    const [optError, setOptError] = useState<string | null>(null);
    const workerRef = useRef<Worker | null>(null);

    const [comboSel, setComboSel] = useState(0);

    const changeCode = useCallback((c: SteelCode) => {
        setCode(c);
        const d = CODE_DEFAULTS[c];
        setLive(d.live); setCpe(d.cpe); setCpeR(d.cpe); setCrane(cr => ({ ...cr, ...CRANE_DEFAULTS[c] })); setCpi(d.cpi); setWsf(d.windServiceFactor);
    }, []);

    const toCol = (f: SecForm): MemberSection => ({ bf: f.bf, tf: f.tf, tw: f.tw, profile: { at: [0, 1], D: [f.d0, f.d1] } });
    const toRaf = (f: SecForm, t: number): MemberSection => ({ bf: f.bf, tf: f.tf, tw: f.tw, profile: { at: [0, t, 1], D: [f.d0, f.d1, f.d1] } });
    const toBeam = (f: SecForm, shape: 'linear' | 'haunched', h: number): MemberSection => shape === 'linear'
        ? { bf: f.bf, tf: f.tf, tw: f.tw, profile: { at: [0, 1], D: [f.d0, f.d1] } }
        : { bf: f.bf, tf: f.tf, tw: f.tw, profile: { at: [0, h, 1 - h, 1], D: [f.d0, f.d1, f.d1, f.d0], vars: [0, 1, 1, 0] } };
    const fromSec = (s: MemberSection): SecForm => ({ d0: s.profile.D[0], d1: s.profile.D[1] ?? s.profile.D[0], bf: s.bf, tf: s.tf, tw: s.tw });

    const frameGeo = useMemo(() => {
        try { return portalGeometry({ span, eaveHeight: eave, roofSlope: slope, eaveHeightR: eaveR, roofSlopeR: slopeR }); } catch { return null; }
    }, [span, eave, slope, eaveR, slopeR]);
    const isFrame = mode === 'frame' || mode === 'multispan';
    const craneIn = useMemo((): CraneInput | null => (craneOn ? { ...crane, span: mode === 'frame' ? 0 : Math.min(crane.span, msSpans.length - 1) } : null),
        [craneOn, crane, mode, msSpans.length]);

    const input: SteelInput = useMemo(() => {
        if (mode === 'multispan') {
            const cr = craneOn ? { ...crane, span: Math.min(crane.span, msSpans.length - 1) } : null;
            const mi: MultiSpanFrameInput = {
                code, fy, spans: msSpans, heights: msHeights, baySpacing: bay, base,
                column: toCol(col), interiorColumn: toCol(icol), rafter: toRaf(raf, taper),
                dead, live, windPressure: windP,
                wallCpe: { windward: cpe.windwardWall, leeward: cpe.leewardWall },
                roofCpe: parseSigned(roofList),
                wallCpeRight: cpeRSame ? undefined : { windward: cpeR.windwardWall, leeward: cpeR.leewardWall },
                roofCpeRight: cpeRSame ? undefined : parseSigned(roofListR),
                windDirections: windDirs, cpi: [...cpi],
                columnLy: colLy, rafterLy: rafLy, verticalLimit: vLim, lateralLimit: hLim, windServiceFactor: wsf, crane: cr,
            };
            return { mode: 'multispan', input: mi };
        }
        if (mode === 'frame') {
            const fi: PortalFrameInput = {
                code, fy, span, eaveHeight: eave, roofSlope: slope, eaveHeightR: eaveR, roofSlopeR: slopeR, baySpacing: bay, base,
                column: toCol(col), rafter: toRaf(raf, taper),
                dead, live, windPressure: windP, cpe, cpeRight: cpeRSame ? undefined : cpeR, windDirections: windDirs, cpi: [...cpi],
                columnLy: colLy, rafterLy: rafLy, verticalLimit: vLim, lateralLimit: hLim, windServiceFactor: wsf,
                crane: craneOn ? { ...crane, span: 0 } : null,
            };
            return { mode: 'frame', input: fi };
        }
        if (mode === 'column') {
            const ci: ColumnInput = {
                code, fy, height: cH, base: cBase, top: cTop, member: toCol(cSec), P: cP, Mtop: cM, wWind: cW,
                Ly: cLy, lateralLimit: hLim, windServiceFactor: wsf,
            };
            return { mode: 'column', input: ci };
        }
        const bi: BeamInput = {
            code, fy, span: bSpan, supports: bSup, member: toBeam(bSec, bShape, bHaunch), w: bw, P: bP, Ly: bLy, verticalLimit: bVLim,
        };
        return { mode: 'beam', input: bi };
    }, [mode, code, fy, span, eave, slope, eaveR, slopeR, bay, base, col, raf, taper, dead, live, windP, cpe, cpeR, cpeRSame, windDirs, cpi, colLy, rafLy, vLim, hLim, wsf,
        msSpans, msHeights, icol, roofList, roofListR, craneOn, crane,
        cH, cBase, cTop, cSec, cP, cM, cW, cLy, bSpan, bSup, bShape, bHaunch, bSec, bw, bP, bLy, bVLim]);

    const frameSym = useMemo(() => {
        try {
            if (input.mode === 'frame') return isSymmetricPortal(input.input);
            if (input.mode === 'multispan') return isSymmetricMultiSpan(input.input);
        } catch { /* invalid geometry: reported by the design */ }
        return false;
    }, [input]);
    const windBoth = windDirs === 'both' || (windDirs === 'auto' && !frameSym);
    const craneRx = useMemo(() => {
        if (!craneIn) return null;
        const sp = mode === 'frame' ? span : msSpans[craneIn.span]?.span ?? 0;
        try { return craneReactions(craneIn, sp, bay); } catch { return null; }
    }, [craneIn, mode, span, msSpans, bay]);

    const { result, error } = useMemo((): { result: DesignResult | null; error: string | null } => {
        try {
            return { result: runDesign(input), error: null };
        } catch (e) {
            logger.error('Steel design error:', e);
            return { result: null, error: e instanceof Error ? e.message : String(e) };
        }
    }, [input]);

    // ── Worker ──
    useEffect(() => () => { workerRef.current?.terminate(); }, []);
    const applyBest = useCallback((best: SteelInput) => {
        if (best.mode === 'frame') { setCol(fromSec(best.input.column)); setRaf(fromSec(best.input.rafter)); }
        else if (best.mode === 'multispan') { setCol(fromSec(best.input.column)); setRaf(fromSec(best.input.rafter)); setICol(fromSec(best.input.interiorColumn)); }
        else if (best.mode === 'column') setCSec(fromSec(best.input.member));
        else setBSec(fromSec(best.input.member));
    }, []);
    const runOptimizer = useCallback(() => {
        setOptError(null); setOptResult(null);
        const params = { depthMin: dMin, depthMax: dMax, depthStep: Math.max(5, dStep), bfList: parseList(bfList), tfList: parseList(tfList), twList: parseList(twList) };
        if (!params.bfList.length || !params.tfList.length || !params.twList.length) { setOptError('Plate lists must not be empty'); return; }
        workerRef.current?.terminate();
        const w = new Worker(new URL('../workers/steelOptimizer.worker.ts', import.meta.url));
        workerRef.current = w;
        setOptRunning(true);
        setOptProgress({ done: 0, total: 1, feasible: 0 });
        w.onmessage = (e: MessageEvent) => {
            const msg = e.data;
            if (msg.type === 'progress') setOptProgress({ done: msg.done, total: msg.total, feasible: msg.feasible });
            else if (msg.type === 'done') {
                setOptRunning(false); setOptProgress(null);
                const r = msg.result as SteelOptimizeResult;
                setOptResult(r);
                if (r.best) applyBest(r.best);
                else setOptError('No feasible design within the lists — widen the depth range or plate lists.');
                w.terminate(); workerRef.current = null;
            } else if (msg.type === 'error') {
                setOptRunning(false); setOptProgress(null); setOptError(msg.error);
                w.terminate(); workerRef.current = null;
            }
        };
        w.onerror = (ev) => { setOptRunning(false); setOptError(ev.message || 'optimizer worker failed'); };
        w.postMessage({ type: 'optimize', input, params });
    }, [input, dMin, dMax, dStep, bfList, tfList, twList, applyBest]);
    const cancelOptimizer = useCallback(() => {
        workerRef.current?.terminate(); workerRef.current = null;
        setOptRunning(false); setOptProgress(null);
    }, []);

    const strengthCombos = result?.combos.filter(c => c.kind === 'strength') ?? [];
    const selCombo = strengthCombos[Math.min(comboSel, Math.max(0, strengthCombos.length - 1))];

    return (
        <div className="layout">
            <aside className="sidebar">
                <div className="panel">
                    <h3 className="panel-title"><span className="panel-icon">🏗</span>Steel Member Design</h3>
                    <div className="control-group">
                        <label>Member / structure</label>
                        <select value={mode} onChange={e => setMode(e.target.value as Mode)} title="mode">
                            <option value="frame">Portal frame (pitched roof)</option>
                            <option value="multispan">Multi-span frame (multi-gable)</option>
                            <option value="column">Column (tapered)</option>
                            <option value="beam">Beam (tapered)</option>
                        </select>
                    </div>
                    <div className="control-group">
                        <label>Design code</label>
                        <select value={code} onChange={e => changeCode(e.target.value as SteelCode)} title="code">
                            <option value="IS800">IS 800:2007 (LSM) + IS 875</option>
                            <option value="AISC360">AISC 360-22 (LRFD) + ASCE 7-22</option>
                        </select>
                    </div>
                    <Num label="Yield strength fy (MPa)" value={fy} onChange={setFy} step={5} />
                </div>

                {isFrame && (
                    <>
                        <div className="panel mt-16px">
                            <h3 className="panel-title"><span className="panel-icon">📐</span>Geometry</h3>
                            {mode === 'multispan' ? (<>
                                <div className="norm-ref-row">
                                    <Num label="Number of spans" value={msSpans.length} onChange={setSpanCount} step={1} />
                                    <Num label="Frame spacing (m)" value={bay} onChange={setBay} step={0.5} />
                                </div>
                                <table className="data-table" style={{ fontSize: '0.8rem' }}>
                                    <thead><tr><th>Span</th><th>Width (m)</th><th>Left slope (°)</th><th>Right slope (°)</th></tr></thead>
                                    <tbody>
                                        {msSpans.map((sp, k) => (
                                            <tr key={k}>
                                                <td>{k + 1}</td>
                                                {(['span', 'slopeL', 'slopeR'] as const).map(fld => (
                                                    <td key={fld}><input type="number" step={fld === 'span' ? 0.5 : 0.5} value={sp[fld]} title={`span ${k + 1} ${fld}`} style={{ width: 70 }}
                                                        onChange={e => setMsSpans(p => p.map((q, j) => (j === k ? { ...q, [fld]: num(e.target.value, q[fld]) } : q)))} /></td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="control-group">
                                    <label>Column heights, left to right (m) — eaves and valleys</label>
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                        {msHeights.map((h, k) => (
                                            <input key={k} type="number" step={0.25} value={h} title={`column ${k + 1} height`} style={{ width: 64 }}
                                                onChange={e => setMsHeights(p => p.map((q, j) => (j === k ? num(e.target.value, q) : q)))} />
                                        ))}
                                    </div>
                                </div>
                                <div className="info-note-inline">
                                    Overall width {msSpans.reduce((a, q) => a + q.span, 0).toFixed(2)} m · {frameSym ? 'symmetric frame' : 'unsymmetric frame or loading'}
                                </div>
                            </>) : (<>
                            <div className="norm-ref-row">
                                <Num label="Span (m)" value={span} onChange={setSpan} step={0.5} />
                                <Num label="Bay spacing (m)" value={bay} onChange={setBay} step={0.5} />
                            </div>
                            <div className="norm-ref-row">
                                <Num label="Left eave height (m)" value={eave} onChange={setEave} step={0.25} />
                                <Num label="Right eave height (m)" value={eaveR} onChange={setEaveR} step={0.25} />
                            </div>
                            <div className="norm-ref-row">
                                <Num label="Left roof slope (°)" value={slope} onChange={setSlope} step={0.5} />
                                <Num label="Right roof slope (°)" value={slopeR} onChange={setSlopeR} step={0.5} />
                            </div>
                            {frameGeo && (
                                <div className="info-note-inline">
                                    Apex {frameGeo.xA.toFixed(2)} m from the left column, {frameGeo.yA.toFixed(2)} m high
                                    {frameSym ? ' · symmetric frame' : ' · unsymmetric frame or loading'}
                                </div>
                            )}
                            </>)}
                            <div className="control-group">
                                <label>Column bases</label>
                                <select value={base} onChange={e => setBase(e.target.value as 'pinned' | 'fixed')} title="base">
                                    <option value="pinned">Pinned</option>
                                    <option value="fixed">Fixed</option>
                                </select>
                            </div>
                        </div>
                        <SecInputs label={mode === 'multispan' ? 'Exterior columns (tapered)' : 'Column (tapered)'} value={col} onChange={setCol} d0Label="Depth at base" d1Label="Depth at eave" />
                        {mode === 'multispan' && msSpans.length > 1 && (
                            <SecInputs label="Interior columns" value={icol} onChange={setICol} d0Label="Depth at base" d1Label="Depth at top" />
                        )}
                        <SecInputs label="Rafter (tapered haunch)" value={raf} onChange={setRaf} d0Label="Depth at eave" d1Label="Depth after taper"
                            extra={<Num label="Taper length (fraction of rafter)" value={taper} onChange={v => setTaper(Math.min(0.95, Math.max(0.05, v)))} step={0.05} />} />
                        <div className="panel mt-16px">
                            <h3 className="panel-title"><span className="panel-icon">⬇</span>Loads (unfactored)</h3>
                            <div className="norm-ref-row">
                                <Num label="Dead on slope (kN/m²)" value={dead} onChange={setDead} step={0.05} title="sheeting + purlins + services + collateral; member self-weight is added automatically" />
                                <Num label={code === 'IS800' ? 'Roof live (kN/m², plan)' : 'Roof live Lr (kN/m², plan)'} value={live} onChange={setLive} step={0.05} />
                            </div>
                            <Num label={code === 'IS800' ? 'Design wind pressure pd (kN/m²)' : 'Wind pressure q·Kd (kN/m²)'} value={windP} onChange={setWindP} step={0.05} />
                            <div className="control-group">
                                <label>Wind directions</label>
                                <select value={windDirs} onChange={e => setWindDirs(e.target.value as 'auto' | 'left' | 'both')} title="wind directions">
                                    <option value="auto">Auto — from the right as well when the frame is unsymmetric</option>
                                    <option value="left">From the left only</option>
                                    <option value="both">From the left and from the right</option>
                                </select>
                            </div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: 6 }}>{windBoth ? 'Wind from the left (windward = left wall and left rafter)' : 'External coefficients'}</div>
                            <div className="norm-ref-row">
                                <Num label="Windward wall" value={cpe.windwardWall} onChange={v => setCpe({ ...cpe, windwardWall: v })} step={0.05} title={code === 'IS800' ? 'Cpe' : 'GCp'} />
                                <Num label="Leeward wall" value={cpe.leewardWall} onChange={v => setCpe({ ...cpe, leewardWall: v })} step={0.05} />
                            </div>
                            {mode === 'multispan' ? (
                                <div className="control-group">
                                    <label>Roof coefficients per slope from the windward end (last value repeats)</label>
                                    <input type="text" value={roofList} onChange={e => setRoofList(e.target.value)} title="roof coefficients" />
                                </div>
                            ) : (
                            <div className="norm-ref-row">
                                <Num label="Windward roof" value={cpe.windwardRoof} onChange={v => setCpe({ ...cpe, windwardRoof: v })} step={0.05} />
                                <Num label="Leeward roof" value={cpe.leewardRoof} onChange={v => setCpe({ ...cpe, leewardRoof: v })} step={0.05} />
                            </div>
                            )}
                            {(windBoth || windDirs !== 'left') && (
                                <>
                                    <div style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: 6 }}>Wind from the right (windward = right wall and right rafter)</div>
                                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.85rem' }}>
                                        <input type="checkbox" checked={cpeRSame} onChange={e => { setCpeRSame(e.target.checked); if (!e.target.checked) setCpeR(cpe); }} />
                                        Same coefficients as wind from the left
                                    </label>
                                    {!cpeRSame && mode === 'multispan' && (
                                        <>
                                            <div className="norm-ref-row">
                                                <Num label="Windward wall (right)" value={cpeR.windwardWall} onChange={v => setCpeR({ ...cpeR, windwardWall: v })} step={0.05} />
                                                <Num label="Leeward wall (left)" value={cpeR.leewardWall} onChange={v => setCpeR({ ...cpeR, leewardWall: v })} step={0.05} />
                                            </div>
                                            <div className="control-group">
                                                <label>Roof coefficients per slope from the right-hand end</label>
                                                <input type="text" value={roofListR} onChange={e => setRoofListR(e.target.value)} title="roof coefficients, wind from the right" />
                                            </div>
                                        </>
                                    )}
                                    {!cpeRSame && mode === 'frame' && (
                                        <>
                                            <div className="norm-ref-row">
                                                <Num label="Windward wall (right)" value={cpeR.windwardWall} onChange={v => setCpeR({ ...cpeR, windwardWall: v })} step={0.05} />
                                                <Num label="Leeward wall (left)" value={cpeR.leewardWall} onChange={v => setCpeR({ ...cpeR, leewardWall: v })} step={0.05} />
                                            </div>
                                            <div className="norm-ref-row">
                                                <Num label="Windward roof (right)" value={cpeR.windwardRoof} onChange={v => setCpeR({ ...cpeR, windwardRoof: v })} step={0.05} />
                                                <Num label="Leeward roof (left)" value={cpeR.leewardRoof} onChange={v => setCpeR({ ...cpeR, leewardRoof: v })} step={0.05} />
                                            </div>
                                        </>
                                    )}
                                    {!windBoth && <div className="info-note-inline">Frame and coefficients are symmetric: wind from the right is the mirror image of wind from the left and is not run separately.</div>}
                                </>
                            )}
                            <div className="norm-ref-row">
                                <Num label={code === 'IS800' ? 'Cpi case 1' : 'GCpi case 1'} value={cpi[0]} onChange={v => setCpi([v, cpi[1]])} step={0.05} />
                                <Num label={code === 'IS800' ? 'Cpi case 2' : 'GCpi case 2'} value={cpi[1]} onChange={v => setCpi([cpi[0], v])} step={0.05} />
                            </div>
                            <WindHelper code={code} onUse={setWindP} />
                            <div className="info-note-inline">
                                Coefficient defaults: {code === 'IS800'
                                    ? `IS 875-3 Tables 4/5 for h/w ≤ ½ and a roof of about 5°; roof live load IS 875-2 (no access, θ ≤ 10°).${mode === 'multispan' ? ' Multi-span roofs: take the per-slope values from the IS 875-3 multi-span roof table.' : ''}`
                                    : `ASCE 7-22 Ch. 27 with G = 0.85 (GCp), enclosed building GCpi ±0.18; Lr after tributary-area reduction.${mode === 'multispan' ? ' Multi-span roofs: enter the per-slope values for the building.' : ''}`} Verify for your building.
                            </div>
                        </div>
                        <div className="panel mt-16px">
                            <h3 className="panel-title"><span className="panel-icon">🏗</span>Crane</h3>
                            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.85rem' }}>
                                <input type="checkbox" checked={craneOn} onChange={e => setCraneOn(e.target.checked)} />
                                Overhead travelling crane on column brackets
                            </label>
                            {craneOn && (<>
                                {mode === 'multispan' && (
                                    <div className="control-group">
                                        <label>Crane span</label>
                                        <select value={Math.min(crane.span, msSpans.length - 1)} onChange={e => setCrane(c => ({ ...c, span: Number(e.target.value) }))} title="crane span">
                                            {msSpans.map((_, k) => <option key={k} value={k}>Span {k + 1}</option>)}
                                        </select>
                                    </div>
                                )}
                                <div className="norm-ref-row">
                                    <Num label="Capacity (kN)" value={crane.capacity} onChange={setCr('capacity')} step={10} />
                                    <Num label="Crab + hoist (kN)" value={crane.crabWeight} onChange={setCr('crabWeight')} step={5} />
                                </div>
                                <div className="norm-ref-row">
                                    <Num label="Bridge weight (kN)" value={crane.bridgeWeight} onChange={setCr('bridgeWeight')} step={10} />
                                    <Num label="Min. hook approach (m)" value={crane.hookApproach} onChange={setCr('hookApproach')} step={0.1} />
                                </div>
                                <div className="norm-ref-row">
                                    <Num label="Wheel base (m)" value={crane.wheelBase} onChange={setCr('wheelBase')} step={0.1} title="spacing of the two wheels of an end carriage" />
                                    <Num label="Rail eccentricity (m)" value={crane.eccentricity} onChange={setCr('eccentricity')} step={0.05} title="runway girder centreline from the column centreline" />
                                </div>
                                <div className="norm-ref-row">
                                    <Num label="Bracket level (m)" value={crane.bracketLevel} onChange={setCr('bracketLevel')} step={0.1} />
                                    <Num label="Rail level (m)" value={crane.railLevel} onChange={setCr('railLevel')} step={0.1} />
                                </div>
                                <div className="norm-ref-row">
                                    <Num label="Vertical impact (fraction)" value={crane.impact} onChange={setCr('impact')} step={0.05} />
                                    <Num label="Lateral surge (fraction)" value={crane.surge} onChange={setCr('surge')} step={0.01} title="of (capacity + crab/hoist), shared by the two rails" />
                                </div>
                                <Num label="Runway girder + rail (kN/m)" value={crane.girderWeight} onChange={setCr('girderWeight')} step={0.1} />
                                <div className="norm-ref-row">
                                    <Num label="Rail-level sway: height /" value={crane.lateralLimit} onChange={setCr('lateralLimit')} step={10} />
                                    <Num label="Rail spread limit (mm)" value={crane.spreadLimit} onChange={setCr('spreadLimit')} step={1} />
                                </div>
                                {craneRx && (
                                    <div className="info-note-inline">
                                        Crane span {craneRx.craneSpan.toFixed(2)} m · wheel loads {craneRx.Pmax.toFixed(1)} / {craneRx.Pmin.toFixed(1)} kN ·
                                        influence k = {craneRx.k.toFixed(3)} → column reactions R<sub>max</sub> {craneRx.Rmax.toFixed(1)} kN, R<sub>min</sub> {craneRx.Rmin.toFixed(1)} kN
                                        (×{(1 + crane.impact).toFixed(2)} impact), surge {craneRx.H.toFixed(2)} kN per column, girder dead {craneRx.Rg.toFixed(1)} kN.
                                    </div>
                                )}
                                <div className="info-note-inline">
                                    {code === 'IS800'
                                        ? 'Defaults: IS 875-2 Cl. 6.3 (EOT crane — impact 25 %, surge 10 % of crab + lifted load). Crane and roof live load combined as leading/accompanying imposed loads per IS 800 Table 4.'
                                        : 'Defaults: ASCE 7-22 §4.9.3 (powered bridge crane, cab or remote operated — impact 25 %) and §4.9.4 (lateral 20 % of capacity + hoist and trolley). Crane load combined as L (§2.3.1).'}
                                    {' '}Longitudinal surge acts out of the frame plane and is resisted by the runway bracing (not in this analysis). Limits: IS 800 Table 6 / AISC Design Guide 7 — verify for the project.
                                </div>
                            </>)}
                        </div>
                        <div className="panel mt-16px">
                            <h3 className="panel-title"><span className="panel-icon">🔗</span>Bracing &amp; serviceability</h3>
                            <div className="norm-ref-row">
                                <Num label="Column flange-brace spacing (m)" value={colLy} onChange={setColLy} step={0.25} />
                                <Num label="Rafter flange-brace spacing (m)" value={rafLy} onChange={setRafLy} step={0.25} />
                            </div>
                            <div className="norm-ref-row">
                                <Num label="Rafter deflection: span /" value={vLim} onChange={setVLim} step={10} />
                                <Num label="Eave drift: height /" value={hLim} onChange={setHLim} step={10} />
                            </div>
                            <Num label="Wind factor for drift" value={wsf} onChange={setWsf} step={0.05} />
                        </div>
                    </>
                )}

                {mode === 'column' && (
                    <>
                        <div className="panel mt-16px">
                            <h3 className="panel-title"><span className="panel-icon">📐</span>Column</h3>
                            <Num label="Height (m)" value={cH} onChange={setCH} step={0.25} />
                            <div className="norm-ref-row">
                                <div className="control-group">
                                    <label>Base</label>
                                    <select value={cBase} onChange={e => setCBase(e.target.value as 'pinned' | 'fixed')} title="base"><option value="fixed">Fixed</option><option value="pinned">Pinned</option></select>
                                </div>
                                <div className="control-group">
                                    <label>Top</label>
                                    <select value={cTop} onChange={e => setCTop(e.target.value as 'free' | 'braced')} title="top"><option value="free">Free (sway)</option><option value="braced">Held laterally</option></select>
                                </div>
                            </div>
                            <Num label="Out-of-plane / LTB unbraced length (m)" value={cLy} onChange={setCLy} step={0.25} />
                        </div>
                        <SecInputs label="Section" value={cSec} onChange={setCSec} d0Label="Depth at base" d1Label="Depth at top" />
                        <div className="panel mt-16px">
                            <h3 className="panel-title"><span className="panel-icon">⬇</span>Loads at top (unfactored)</h3>
                            <div className="norm-ref-row">
                                <Num label="P dead (kN)" value={cP.D} onChange={v => setCP({ ...cP, D: v })} step={5} />
                                <Num label="P live (kN)" value={cP.L} onChange={v => setCP({ ...cP, L: v })} step={5} />
                                <Num label="P wind (kN)" value={cP.W} onChange={v => setCP({ ...cP, W: v })} step={5} />
                            </div>
                            <div className="norm-ref-row">
                                <Num label="M dead (kN·m)" value={cM.D} onChange={v => setCM({ ...cM, D: v })} step={5} />
                                <Num label="M live (kN·m)" value={cM.L} onChange={v => setCM({ ...cM, L: v })} step={5} />
                                <Num label="M wind (kN·m)" value={cM.W} onChange={v => setCM({ ...cM, W: v })} step={5} />
                            </div>
                            <Num label="Wind on column (kN/m)" value={cW} onChange={setCW} step={0.5} />
                            <Num label="Drift limit: height /" value={hLim} onChange={setHLim} step={10} />
                        </div>
                    </>
                )}

                {mode === 'beam' && (
                    <>
                        <div className="panel mt-16px">
                            <h3 className="panel-title"><span className="panel-icon">📐</span>Beam</h3>
                            <Num label="Span (m)" value={bSpan} onChange={setBSpan} step={0.5} />
                            <div className="control-group">
                                <label>Supports</label>
                                <select value={bSup} onChange={e => setBSup(e.target.value as BeamInput['supports'])} title="supports">
                                    <option value="pinned-pinned">Pinned – pinned</option>
                                    <option value="fixed-pinned">Fixed – pinned</option>
                                    <option value="fixed-fixed">Fixed – fixed</option>
                                    <option value="cantilever">Cantilever (fixed at left)</option>
                                </select>
                            </div>
                            <div className="norm-ref-row">
                                <div className="control-group">
                                    <label>Taper</label>
                                    <select value={bShape} onChange={e => setBShape(e.target.value as 'linear' | 'haunched')} title="taper shape">
                                        <option value="linear">Linear left → right</option>
                                        <option value="haunched">Haunched at both ends</option>
                                    </select>
                                </div>
                                {bShape === 'haunched' && <Num label="Haunch length (fraction)" value={bHaunch} onChange={v => setBHaunch(Math.min(0.45, Math.max(0.05, v)))} step={0.05} />}
                            </div>
                            <Num label="Compression-flange unbraced length (m)" value={bLy} onChange={setBLy} step={0.25} />
                        </div>
                        <SecInputs label="Section" value={bSec} onChange={setBSec}
                            d0Label={bShape === 'linear' ? 'Depth at left' : 'Depth at supports'} d1Label={bShape === 'linear' ? 'Depth at right' : 'Depth at mid-span'} />
                        <div className="panel mt-16px">
                            <h3 className="panel-title"><span className="panel-icon">⬇</span>Loads (unfactored)</h3>
                            <div className="norm-ref-row">
                                <Num label="w dead (kN/m)" value={bw.D} onChange={v => setBw({ ...bw, D: v })} step={0.5} />
                                <Num label="w live (kN/m)" value={bw.L} onChange={v => setBw({ ...bw, L: v })} step={0.5} />
                                <Num label="w wind (kN/m, uplift −)" value={bw.W} onChange={v => setBw({ ...bw, W: v })} step={0.5} />
                            </div>
                            <div className="norm-ref-row">
                                <Num label="P dead (kN)" value={bP.D} onChange={v => setBP({ ...bP, D: v })} step={5} />
                                <Num label="P live (kN)" value={bP.L} onChange={v => setBP({ ...bP, L: v })} step={5} />
                                <Num label="at x (m)" value={bP.a} onChange={v => setBP({ ...bP, a: v })} step={0.25} />
                            </div>
                            <Num label="Deflection limit: span /" value={bVLim} onChange={setBVLim} step={10} />
                        </div>
                    </>
                )}

                <div className="panel mt-16px">
                    <h3 className="panel-title"><span className="panel-icon">⚙</span>Optimize (minimum steel)</h3>
                    <div className="norm-ref-row">
                        <Num label="Depth min (mm)" value={dMin} onChange={setDMin} step={25} />
                        <Num label="max" value={dMax} onChange={setDMax} step={25} />
                        <Num label="step" value={dStep} onChange={setDStep} step={25} />
                    </div>
                    <div className="control-group"><label>Flange widths bf (mm)</label><input value={bfList} onChange={e => setBfList(e.target.value)} title="bf list" /></div>
                    <div className="control-group"><label>Flange thicknesses tf (mm)</label><input value={tfList} onChange={e => setTfList(e.target.value)} title="tf list" /></div>
                    <div className="control-group"><label>Web thicknesses tw (mm)</label><input value={twList} onChange={e => setTwList(e.target.value)} title="tw list" /></div>
                    <button className="btn btn-primary w-full mt-16px" onClick={runOptimizer} disabled={optRunning}>
                        {optRunning ? 'Optimizing…' : '⚙ Run optimization'}
                    </button>
                    {optRunning && <button className="btn btn-secondary w-full mt-16px" onClick={cancelOptimizer}>✕ Cancel</button>}
                    {optProgress && (
                        <div className="info-note-inline">{optProgress.done} / {optProgress.total} designs evaluated · {optProgress.feasible} feasible</div>
                    )}
                    {optError && <div className="info-note-inline" style={{ color: 'var(--negative)' }}>{optError}</div>}
                    {optResult?.result && optResult.best && (
                        <div className="info-note-inline">
                            Best found: <strong>{optResult.result.mass.toFixed(0)} kg</strong> (max utilization {f3(optResult.result.maxUtil)}),
                            {' '}{optResult.evaluations} designs evaluated — applied to the inputs. Local search: the lightest design found, not a proven global minimum.
                        </div>
                    )}
                </div>
            </aside>

            <section className="content">
                {error && <div className="panel"><p style={{ color: 'var(--negative)' }}>{error}</p></div>}
                {result && (
                    <>
                        <div className={`panel status-banner ${result.ok ? 'status-safe' : 'status-fail'}`}>
                            <h2 style={{ margin: 0 }}>
                                {mode === 'frame' ? 'Portal frame' : mode === 'multispan' ? `Multi-span frame (${msSpans.length} spans)` : mode === 'column' ? 'Column' : 'Beam'}{craneOn && isFrame ? ' with crane' : ''} — {result.ok ? 'ADEQUATE' : 'REVISE'}
                            </h2>
                            <p style={{ margin: '6px 0 0' }}>
                                Max utilization <strong>{f3(result.maxUtil)}</strong> · steel {result.mass.toFixed(0)} kg
                                {isFrame ? ` (${(result.mass / ((mode === 'frame' ? span : msSpans.reduce((a, q) => a + q.span, 0)) * bay)).toFixed(1)} kg/m² of plan per frame)` : ''} ·
                                {' '}{code === 'IS800' ? 'IS 800:2007 LSM' : 'AISC 360-22 LRFD'}
                            </p>
                            {result.warnings.map((w, i) => <p key={i} style={{ color: 'var(--negative)', margin: '4px 0 0' }}>{w}</p>)}
                        </div>

                        <div className="panel mt-16px">
                            <h3 className="panel-title"><span className="panel-icon">🖼</span>Members (colour = utilization) and bending moment</h3>
                            <div className="control-group" style={{ maxWidth: 360 }}>
                                <label>Bending moment for combination</label>
                                <select value={comboSel} onChange={e => setComboSel(parseInt(e.target.value, 10))} title="combination">
                                    {strengthCombos.map((c, i) => <option key={c.name} value={i}>{c.name}</option>)}
                                </select>
                            </div>
                            <FrameDiagram result={result} combo={selCombo} />
                        </div>

                        <div className="panel mt-16px">
                            <h3 className="panel-title"><span className="panel-icon">📋</span>Member checks (envelope of strength combinations)</h3>
                            <div className="table-wrap">
                                <table className="data-table">
                                    <thead><tr>
                                        <th>Member</th><th>Depth (mm)</th><th>bf × tf / tw</th><th>Mass (kg)</th>
                                        <th>Max util.</th><th>Combination</th><th>At (m)</th><th>Governing check</th>
                                    </tr></thead>
                                    <tbody>
                                        {result.members.map(m => {
                                            const Ds = m.stations.map(s => s.D);
                                            const sec = m.governing.section;
                                            return (
                                                <tr key={m.name}>
                                                    <td><strong>{m.name}</strong></td>
                                                    <td>{Math.min(...Ds).toFixed(0)} – {Math.max(...Ds).toFixed(0)}</td>
                                                    <td>{sec ? `${sec.bf} × ${sec.tf} / ${sec.tw}` : '—'}</td>
                                                    <td>{m.mass.toFixed(0)}</td>
                                                    <td style={{ color: utilColor(m.maxUtil), fontWeight: 700 }}>{f3(m.maxUtil)}</td>
                                                    <td>{m.governing.combo}</td>
                                                    <td>{(m.governing.s * m.length).toFixed(2)}</td>
                                                    <td style={{ fontSize: '0.85em' }}>{m.governing.check}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {result.members.filter((m, i, arr) => arr.findIndex(x => x.group === m.group && x.maxUtil >= m.maxUtil) === i || arr.filter(x => x.group === m.group).length === 1)
                                .filter((m, i, arr) => arr.findIndex(x => x.group === m.group) === i)
                                .map(m => <GoverningDetail key={m.name} m={m} code={code} />)}
                        </div>

                        {result.deflections.length > 0 && (
                            <div className="panel mt-16px">
                                <h3 className="panel-title"><span className="panel-icon">↕</span>Serviceability (first-order, nominal stiffness)</h3>
                                <table className="data-table">
                                    <thead><tr><th>Check</th><th>Combination</th><th>Value (mm)</th><th>Limit (mm)</th><th>Ratio</th></tr></thead>
                                    <tbody>
                                        {result.deflections.map((d, i) => (
                                            <tr key={i}><td>{d.name}</td><td>{d.combo}</td><td>{f1(d.value)}</td><td>{f1(d.limit)}</td>
                                                <td style={{ color: utilColor(d.ratio), fontWeight: 700 }}>{f3(d.ratio)}</td></tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        <div className="panel mt-16px">
                            <h3 className="panel-title"><span className="panel-icon">🧮</span>Load combinations — second-order analysis</h3>
                            <div className="table-wrap">
                                <table className="data-table">
                                    <thead><tr><th>Combination</th><th>γe (elastic buckling)</th><th>Δ2nd/Δ1st</th><th>Notional loads</th><th>Reactions Rx / Ry / M (kN, kN·m)</th></tr></thead>
                                    <tbody>
                                        {strengthCombos.map(c => (
                                            <tr key={c.name}>
                                                <td>{c.name}{c.stable ? '' : ' — UNSTABLE'}</td>
                                                <td>{f2(c.gammaE)}</td>
                                                <td>{f3(c.ampRatio)}</td>
                                                <td>{c.notional ? 'yes' : '—'}</td>
                                                <td style={{ fontSize: '0.85em' }}>{c.reactions.map(r => `${f1(-r.Rx)} / ${f1(-r.Ry)}${Math.abs(r.Mz) > 1e-6 ? ` / ${f1(-r.Mz)}` : ''}`).join('  ·  ')}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className="config-note" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                Reactions are the forces the supports exert on the structure (+x right, +y up).
                                γe &lt; 10 means second-order effects are significant; the design already uses the second-order forces.
                            </p>
                        </div>

                        <div className="panel mt-16px">
                            <h3 className="panel-title"><span className="panel-icon">ℹ</span>Design basis and limitations</h3>
                            <ul style={{ fontSize: '0.85rem', lineHeight: 1.5, margin: 0, paddingLeft: 18 }}>
                                {code === 'IS800' ? (<>
                                    <li>IS 800:2007 LSM, γm0 = 1.10. Combinations (Table 4): 1.5(D+L), 1.2(D+L+W), 1.5(D+W), 0.9D+1.5W, each wind case with both internal pressures. Wind from the left (W1, W2); for unsymmetric frames also from the right (WL1, WL2, WR1, WR2).</li>
                                    <li>Second-order elastic analysis (P-Δ, P-δ); notional horizontal loads 0.5 % of the factored gravity load in gravity combinations (Cl. 4.3.6), acting in the direction of the first-order sway.</li>
                                    <li>In-plane buckling from the frame elastic buckling analysis: fcc = γe·N/A at each section (curve b). Out-of-plane over the flange-brace spacing, smallest section of the segment (curve c).</li>
                                    <li>LTB Cl. 8.2.2 with Mcr of Cl. 8.2.2.1 and c1 = 1 (conservative), αLT = 0.49; interaction Cl. 9.3.2.2 with Cmz = 0.9 for sway frames.</li>
                                    <li>Slender webs (d/tw above the semi-compact limit): moment carried by the flanges only; webs limited to d/tw ≤ 200ε without stiffeners. Shear with web buckling Cl. 8.4.2.2(a).</li>
                                </>) : (<>
                                    <li>AISC 360-22 LRFD, direct analysis method: second-order analysis with 0.8EA and 0.8τbEI, notional loads 0.002ΣY in gravity combinations (and in all when Δ2nd/Δ1st &gt; 1.7), in the direction of the first-order sway; in-plane K = 1.</li>
                                    <li>ASCE 7-22 §2.3.1 combinations: 1.4D, 1.2D+1.6Lr, 1.2D+1.6Lr+0.5W, 1.2D+1.0W+0.5Lr, 0.9D+1.0W, each wind case with both GCpi; wind from the right as well for unsymmetric frames (WL/WR).</li>
                                    <li>Web-tapered members checked section by section (AISC Design Guide 25 stress approach): Fe = Pe/A(x); LTB stress from the smallest section of each unbraced segment with Cb (F1-1).</li>
                                    <li>Flexure F2–F5 by web / flange class; compression E3 with E7 effective widths; shear G2.1 without stiffeners; interaction H1-1; h/tw ≤ 260 (F13.2).</li>
                                </>)}
                                {isFrame && craneOn && (
                                    <li>Crane: wheel loads from the crab at the minimum hook approach; column reactions for runway girders simply supported between frames (one wheel over the frame). Load cases CV1 / CV2 (maximum reaction on the left / right crane column, with impact) and CH (surge at rail level, ± in combinations; with wind it acts in the wind direction). Bracket loads applied at the bracket level with the rail eccentricity moment; runway girder weight in D.</li>
                                )}
                                {isFrame && craneOn && (
                                    <li>{code === 'IS800'
                                        ? 'Crane combinations (IS 800 Table 4, crane and roof live as imposed loads, each taken as leading in turn): 1.5D + 1.5C + 1.05L, 1.5D + 1.5L + 1.05C, 1.2D + 1.2C + 1.05L + 0.6W, 1.2D + 1.2C + 0.53L + 1.2W and the same with L leading.'
                                        : 'Crane combinations (ASCE 7-22 §2.3.1, crane as L with factor 1.0 in combinations 3 and 4): 1.2D + 1.6C + 0.5Lr, 1.2D + 1.6Lr + 1.0C, 1.2D + 1.0W + 1.0C + 0.5Lr.'}
                                        {' '}Crane serviceability under static crane loads with surge: rail-level sway and change of rail gauge.</li>
                                )}
                                {mode === 'multispan' && (
                                    <li>Multi-span frame: exterior columns, interior columns and rafters designed as three groups; wind on the two end walls and on every roof slope; interior columns carry no wall wind. In-plane buckling from the elastic buckling analysis of the whole frame.</li>
                                )}
                                <li>Members modelled on their centre lines; self-weight added (78.5 kN/m³). Connections (knee, apex, base plates, crane brackets), runway girders, purlins, girts and bracing are not designed here.</li>
                                <li>Verify coefficients, load values and deflection limits against the governing code editions and the project specification.</li>
                            </ul>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}

function GoverningDetail({ m, code }: { m: DesignResult['members'][number]; code: SteelCode }) {
    const d = m.governing.detail;
    const sec = m.governing.section;
    if (!d || !sec) return null;
    const kN = (v: number) => (Number.isFinite(v) ? (v / 1e3).toFixed(1) : '∞');
    const kNm = (v: number) => (Number.isFinite(v) ? (v / 1e6).toFixed(1) : '∞');
    const st = m.stations.reduce((a, b) => (b.util > a.util ? b : a));
    return (
        <div className="info-note-inline" style={{ marginTop: 10 }}>
            <strong>{m.group} — governing section</strong> ({m.governing.combo}, {(m.governing.s * m.length).toFixed(2)} m from the {m.name.includes('R') ? 'apex/eave' : 'start'},
            D = {sec.D.toFixed(0)} mm): N = {f1(st.N)} kN, V = {f1(st.V)} kN, M = {f1(st.M)} kN·m.{' '}
            {code === 'IS800' ? (() => {
                const r = d as ISStationResult;
                return <>Class: flange {r.cls.flange}, web {r.cls.web} (d/tw = {r.cls.dt.toFixed(0)}).
                    {' '}Pdz = {kN(r.Pdz)} kN (λz = {f2(r.lambdaZ)}), Pdy = {kN(r.Pdy)} kN (λy = {f2(r.lambdaY)}),
                    {' '}Md = {kNm(r.Md)} kN·m, Md,LT = {kNm(r.MdLT)} kN·m, Vd = {kN(r.Vd)} kN.
                    {' '}Ratios: section {f3(r.util.section)}, out-of-plane {f3(r.util.bucklingY)}, in-plane {f3(r.util.bucklingZ)}, shear {f3(r.util.shear)}.
                    {r.notes.length ? ` ${r.notes.join('; ')}.` : ''}</>;
            })() : (() => {
                const r = d as AISCStationResult;
                return <>Flange {r.cls.flange}, web {r.cls.web} (h/tw = {r.cls.lw.toFixed(0)}), flexure {r.flexCase}.
                    {' '}φPn = {kN(r.Pc)} kN, φMn = {kNm(r.Mc)} kN·m, φVn = {kN(r.Vc)} kN.
                    {' '}H1-1 = {f3(r.util.interaction)}, shear {f3(r.util.shear)}.
                    {m.PeIn ? ` Pe (K = 1) = ${m.PeIn.toFixed(0)} kN.` : ''}
                    {r.notes.length ? ` ${r.notes.join('; ')}.` : ''}</>;
            })()}
        </div>
    );
}

function FrameDiagram({ result, combo }: { result: DesignResult; combo?: DesignResult['combos'][number] }) {
    const W = 760, Hh = 420, pad = 40;
    const pts = result.members.flatMap(m => m.stations.map(s => ({ x: s.x, y: s.y })));
    const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
    const ext = Math.max(maxX - minX, maxY - minY, 1);
    const sc = Math.min((W - 2 * pad) / Math.max(maxX - minX, ext * 0.3), (Hh - 2 * pad) / Math.max(maxY - minY, ext * 0.3));
    const X = (x: number) => pad + (x - minX) * sc + (W - 2 * pad - (maxX - minX) * sc) / 2;
    const Y = (y: number) => Hh - pad - (y - minY) * sc - (Hh - 2 * pad - (maxY - minY) * sc) / 2;
    const depthScale = 2.5 / 1000;      // depth drawn 2.5× for visibility (mm → m)
    const Mmax = combo ? Math.max(1e-9, ...combo.members.flatMap(m => m.M.map(Math.abs))) : 1;
    const mScale = 0.18 * ext / Mmax;

    return (
        <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: '100%', height: 'auto', background: 'var(--surface, transparent)' }} role="img" aria-label="structure diagram">
            {result.members.map(m => {
                const st = m.stations;
                const a = st[0], b = st[st.length - 1];
                const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
                const polys = st.slice(0, -1).map((s, k) => {
                    const t = st[k + 1];
                    const h1 = s.D * depthScale / 2, h2 = t.D * depthScale / 2;
                    const P = [
                        [s.x + nx * h1, s.y + ny * h1], [t.x + nx * h2, t.y + ny * h2],
                        [t.x - nx * h2, t.y - ny * h2], [s.x - nx * h1, s.y - ny * h1],
                    ].map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');
                    return <polygon key={k} points={P} fill={utilColor(Math.max(s.util, t.util))} fillOpacity={0.75} stroke="#334155" strokeWidth={0.4} />;
                });
                const cm = combo?.members.find(x => x.name === m.name);
                const bmd = cm ? cm.s.map((s, k) => {
                    const x = a.x + (b.x - a.x) * s, y = a.y + (b.y - a.y) * s;
                    const o = cm.M[k] * mScale;
                    return `${X(x + nx * o).toFixed(1)},${Y(y + ny * o).toFixed(1)}`;
                }) : [];
                const Mpk = cm ? cm.M.reduce((p, v, k) => (Math.abs(v) > Math.abs(cm.M[p]) ? k : p), 0) : -1;
                return (
                    <g key={m.name}>
                        {polys}
                        {bmd.length > 0 && <polyline points={`${X(a.x)},${Y(a.y)} ${bmd.join(' ')} ${X(b.x)},${Y(b.y)}`} fill="none" stroke="#6366f1" strokeWidth={1.4} />}
                        {cm && Mpk >= 0 && Math.abs(cm.M[Mpk]) > 1e-6 && (
                            <text x={X(a.x + (b.x - a.x) * cm.s[Mpk] + nx * cm.M[Mpk] * mScale)} y={Y(a.y + (b.y - a.y) * cm.s[Mpk] + ny * cm.M[Mpk] * mScale) - 4}
                                fontSize={11} fill="#4f46e5" textAnchor="middle">{Math.abs(cm.M[Mpk]).toFixed(0)}</text>
                        )}
                    </g>
                );
            })}
            <g fontSize={11} fill="currentColor">
                <text x={pad} y={16}>Utilization: <tspan fill="#10b981">≤ 0.7</tspan> · <tspan fill="#eab308">≤ 0.9</tspan> · <tspan fill="#f97316">≤ 1.0</tspan> · <tspan fill="#ef4444">&gt; 1.0</tspan> · depth drawn ×2.5 · BMD in kN·m</text>
            </g>
        </svg>
    );
}

function WindHelper({ code, onUse }: { code: SteelCode; onUse: (v: number) => void }) {
    const [is, setIs] = useState({ Vb: 44, k1: 1.0, k2: 0.98, k3: 1.0, k4: 1.0, Kd: 0.9, Ka: 0.8, Kc: 0.9 });
    const [as, setAs] = useState({ V: 51, Kz: 0.85, Kzt: 1.0, Ke: 1.0, Kd: 0.85 });
    if (code === 'IS800') {
        const Vz = is.Vb * is.k1 * is.k2 * is.k3 * is.k4;
        const pz = 0.6 * Vz * Vz / 1000;
        const pd = Math.max(is.Kd * is.Ka * is.Kc, 0.7) * pz;
        return (
            <details className="mt-12px">
                <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>IS 875-3 wind pressure helper</summary>
                <div className="norm-ref-row">
                    {(['Vb', 'k1', 'k2', 'k3', 'k4'] as const).map(k => <Num key={k} label={k === 'Vb' ? 'Vb (m/s)' : k} value={is[k]} onChange={v => setIs({ ...is, [k]: v })} step={k === 'Vb' ? 1 : 0.01} />)}
                </div>
                <div className="norm-ref-row">
                    {(['Kd', 'Ka', 'Kc'] as const).map(k => <Num key={k} label={k} value={is[k]} onChange={v => setIs({ ...is, [k]: v })} step={0.05} />)}
                </div>
                <div className="info-note-inline">
                    Vz = Vb·k1·k2·k3·k4 = {Vz.toFixed(1)} m/s; pz = 0.6Vz² = {pz.toFixed(3)} kN/m²; pd = Kd·Ka·Kc·pz ≥ 0.7pz = <strong>{pd.toFixed(3)} kN/m²</strong>
                    {' '}<button className="btn btn-secondary" onClick={() => onUse(Math.round(pd * 1000) / 1000)}>Use</button>
                </div>
            </details>
        );
    }
    const q = 0.613 * as.Kz * as.Kzt * as.Ke * as.V * as.V / 1000;
    return (
        <details className="mt-12px">
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>ASCE 7-22 velocity pressure helper</summary>
            <div className="norm-ref-row">
                {(['V', 'Kz', 'Kzt', 'Ke', 'Kd'] as const).map(k => <Num key={k} label={k === 'V' ? 'V (m/s)' : k} value={as[k]} onChange={v => setAs({ ...as, [k]: v })} step={k === 'V' ? 1 : 0.01} />)}
            </div>
            <div className="info-note-inline">
                qh = 0.613·Kz·Kzt·Ke·V² = {q.toFixed(3)} kN/m²; qh·Kd = <strong>{(q * as.Kd).toFixed(3)} kN/m²</strong>
                {' '}<button className="btn btn-secondary" onClick={() => onUse(Math.round(q * as.Kd * 1000) / 1000)}>Use</button>
            </div>
        </details>
    );
}
