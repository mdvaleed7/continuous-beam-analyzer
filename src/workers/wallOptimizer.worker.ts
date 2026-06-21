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
 *   {
 *     type:      'optimize',
 *     config:    WallConfig,
 *     costRatio?: number          // volumetric steel-to-concrete cost ratio (default 90)
 *   }
 *
 * Message protocol (worker → main thread):
 *   { type: 'progress', done: number, total: number, feasible: number }
 *   { type: 'done',     result: OptimizeResult }
 *   { type: 'error',    error: string }
 *
 * ─── ECONOMIC OBJECTIVE ────────────────────────────────────────────────────
 * The optimizer sweeps all zone-thickness combinations and selects the design
 * that minimises the combined material cost index:
 *
 *   cost_index = V_concrete  +  V_steel × r
 *
 * where V_steel = steelWeight_kg / 7850  (converted to m³)
 *       r       = costRatio  (default 90)
 *
 * Derivation of the default:
 *   r = (ρ_steel × P_steel) / P_concrete
 *     = (7850 kg/m³ × ₹57/kg) / ₹5000/m³  ≈ 89.5  →  rounded to 90
 *   Source: India rebar ₹52–58/kg, M20–M25 RMC ₹4,500–6,400/m³ (mid-2025)
 *
 * Simplified weight-based form used in the engine:
 *   cost_index = concreteVol_m3  +  steelWeight_kg × (r / 7850)
 *              = concreteVol_m3  +  steelWeight_kg × 0.01147   (at r = 90)
 *
 * This means every 87 kg of steel carries the same cost weight as 1 m³ of
 * concrete. Designs with very thin walls but heavy steel are penalised, and
 * designs with very thick walls but minimal steel are also penalised — the
 * optimizer finds the true economic minimum between the two extremes.
 *
 * WITHOUT a cost ratio, minimising only concreteVol biases the optimizer
 * toward under-thickness walls with excessive reinforcement (failure mode 1).
 * ───────────────────────────────────────────────────────────────────────────
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

import {
    optimizeWall,
    type WallConfig,
    type OptimizeResult,
} from '../components/wallEngine';

// ─── Default cost ratio ───────────────────────────────────────────────────────
/**
 * Default volumetric cost ratio r = (7850 × P_steel_per_kg) / P_concrete_per_m3.
 * At ₹57/kg steel and ₹5,000/m³ M20–M25 concrete: r ≈ 89.5 → rounded to 90.
 * Caller may override via the costRatio field in the request message.
 */
const DEFAULT_COST_RATIO = 90;

// ─── Message types ────────────────────────────────────────────────────────────

export interface OptimizeRequest {
    type: 'optimize';
    config: WallConfig;
    /**
     * Volumetric cost ratio of rebar steel to concrete (dimensionless).
     * Used to weight the combined economic objective:
     *   cost_index = concreteVol_m3 + steelWeight_kg * (costRatio / 7850)
     *
     * Indian market range (2025): 65–100. Default: 90.
     * A ratio below 1 or above 200 suggests a unit error and will be clamped.
     */
    costRatio?: number;
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

// ─── Worker context ───────────────────────────────────────────────────────────

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
 * result (thicknesses, concreteVol, steelWeight, maxUtilization, costIndex),
 * so this is safe.
 */
function sanitizeResultForPost(result: OptimizeResult): OptimizeResult {
    return JSON.parse(JSON.stringify(result));
}

// ─── Message handler ──────────────────────────────────────────────────────────

ctx.onmessage = (ev: MessageEvent<OptimizeRequest>) => {
    const { type, config, costRatio = DEFAULT_COST_RATIO } = ev.data;
    if (type !== 'optimize') return;

    // Clamp to a sane range — a ratio below 1 or above 200 suggests a unit error.
    const r = Math.max(1, Math.min(200, costRatio));

    try {
        const result = optimizeWall(
            config,
            r,                                         // economic weight passed to engine
            (done, total, feasible) => {
                ctx.postMessage({ type: 'progress', done, total, feasible });
            },
        );
        // Strip beamResult (contains function closures) before posting.
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
