/**
 * Web Worker for the wall thickness optimizer.
 *
 * PERF-01 fix: the optimizer brute-forces up to 20,000 thickness combinations
 * synchronously on the main thread, blocking the UI for up to 30 seconds. This
 * worker moves that computation off the main thread so the UI stays responsive,
 * and reports progress periodically so the user sees a progress bar instead of
 * a frozen page.
 *
 * Message protocol (main thread → worker):
 *   { type: 'optimize', config: WallConfig }
 *
 * Message protocol (worker → main thread):
 *   { type: 'progress', done: number, total: number, feasible: number }
 *   { type: 'done',    result: OptimizeResult }
 *   { type: 'error',   error: string }
 *
 * IMPORTANT: postMessage uses the structured clone algorithm, which CANNOT
 * clone functions. The OptimizeResult contains WallAnalysisResult objects
 * whose `beamResult` field holds function closures (V(x), M(x) from the
 * beam engine's span objects). We must strip `beamResult` before posting.
 * The UI only reads thicknesses / concreteVol / steelWeight / maxUtilization
 * from the result — it never uses beamResult directly.
 *
 * Cancellation: call `worker.terminate()` — the worker stops immediately and
 * its resources are freed. No graceful shutdown needed since optimizeWall is
 * a pure computation with no side effects.
 */

/// <reference lib="webworker" />

import { optimizeWall, type WallConfig, type OptimizeResult } from '../components/wallEngine';

export interface OptimizeRequest {
    type: 'optimize';
    config: WallConfig;
}

export interface ProgressMessage {
    type: 'progress';
    done: number;
    total: number;
    feasible: number;
}

export interface DoneMessage {
    type: 'done';
    result: OptimizeResult;
}

export interface ErrorMessage {
    type: 'error';
    error: string;
}

export type WorkerOutboundMessage = ProgressMessage | DoneMessage | ErrorMessage;

// Inside a worker, `self` is the DedicatedWorkerGlobalScope.
const ctx = self as unknown as {
    postMessage(message: WorkerOutboundMessage): void;
    onmessage: ((ev: MessageEvent<OptimizeRequest>) => void) | null;
};

/**
 * Deep-strip ALL non-cloneable content from the optimization result before
 * posting. postMessage uses structured cloning which cannot clone functions.
 *
 * The OptimizeResult tree contains function closures in several places:
 *   - beamResult.spans[k].V(x), .M(x) — beam engine shear/moment functions
 *   - config._mesh.round6 — pressure mesh rounding helper
 *   - config._mesh.zoneOfDepth — pressure mesh zone lookup
 *   - Fraction objects (F class) with .add(), .mul() etc. methods
 *
 * JSON.parse(JSON.stringify()) strips all functions, undefined, and symbols,
 * leaving only plain data. The main thread only reads plain data from the
 * result (thicknesses, concreteVol, steelWeight, maxUtilization), so this
 * is safe.
 */
function sanitizeResultForPost(result: OptimizeResult): OptimizeResult {
    return JSON.parse(JSON.stringify(result));
}

ctx.onmessage = (ev: MessageEvent<OptimizeRequest>) => {
    const { type, config } = ev.data;
    if (type !== 'optimize') return;

    try {
        const result = optimizeWall(config, (done, total, feasible) => {
            ctx.postMessage({ type: 'progress', done, total, feasible });
        });
        // Strip beamResult (contains function closures) before posting.
        // postMessage uses structured cloning which cannot clone functions.
        const safeResult = sanitizeResultForPost(result);
        ctx.postMessage({ type: 'done', result: safeResult });
    } catch (err) {
        ctx.postMessage({
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
        });
    }
};

// Signal that the worker script has loaded.
export {};
