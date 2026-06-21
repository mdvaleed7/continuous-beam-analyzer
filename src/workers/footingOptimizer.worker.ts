/**
 * Web Worker for the footing optimizer.
 *
 * Message protocol (main thread → worker):
 *   {
 *     type:      'optimize',
 *     config:    FootingConfig,
 *     params:    FootingOptimizeParams,
 *     costRatio?: number          // volumetric steel-to-concrete cost ratio (default 90)
 *   }
 *
 * Message protocol (worker → main thread):
 *   { type: 'progress', done: number, total: number, feasible: number }
 *   { type: 'done',     result: FootingOptimizeResult }
 *   { type: 'error',    error: string }
 *
 * ─── ECONOMIC OBJECTIVE ────────────────────────────────────────────────────
 * The optimizer minimises a combined cost index across all feasible
 * (L × B × D × barDia) combinations:
 *
 *   cost_index = V_concrete  +  V_steel × r
 *
 * where V_steel = steelWeight_kg / 7850  (m³)
 *       r       = costRatio  (default 90)
 *
 * Derivation of the default:
 *   r = (ρ_steel × P_steel) / P_concrete
 *     = (7850 kg/m³ × ₹57/kg) / ₹5000/m³  ≈ 89.5
 *
 * Indian market range (2025): r ≈ 65–100; midpoint 90 is used as default.
 * The caller can override this by passing costRatio in the message.
 *
 * Simplified form used in the engine:
 *   cost_index = concreteVol_m3  +  steelWeight_kg × (r / 7850)
 *              = concreteVol_m3  +  steelWeight_kg × 0.01147   (at r = 90)
 *
 * This means every 87 kg of steel carries the same cost weight as 1 m³ of
 * concrete, so the optimizer trades thickness against reinforcement correctly.
 * ───────────────────────────────────────────────────────────────────────────
 */

/// <reference lib="webworker" />

import {
    optimizeFooting,
    type FootingConfig,
    type FootingOptimizeParams,
    type FootingOptimizeResult,
} from '../components/footingEngine';

// ─── Default cost ratio ───────────────────────────────────────────────────────
/**
 * Default volumetric cost ratio r = (7850 × P_steel_per_kg) / P_concrete_per_m3.
 * At ₹57/kg steel and ₹5,000/m³ M20–M25 concrete: r ≈ 89.5.
 * Round to 90 for a clean default. Caller may override via the costRatio field.
 */
const DEFAULT_COST_RATIO = 90;

// ─── Message types ────────────────────────────────────────────────────────────

export interface FootingOptimizeRequest {
    type: 'optimize';
    config: FootingConfig;
    params: FootingOptimizeParams;
    /**
     * Volumetric cost ratio of rebar steel to concrete (dimensionless).
     * Used to weight the combined economic objective:
     *   cost_index = concreteVol_m3 + steelWeight_kg * (costRatio / 7850)
     * Defaults to 90 if omitted.
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
    result: FootingOptimizeResult;
}

export interface ErrorMessage {
    type: 'error';
    error: string;
}

export type WorkerOutboundMessage = ProgressMessage | DoneMessage | ErrorMessage;

// ─── Worker context ───────────────────────────────────────────────────────────

const ctx = self as unknown as {
    postMessage(message: WorkerOutboundMessage): void;
    onmessage: ((ev: MessageEvent<FootingOptimizeRequest>) => void) | null;
};

/**
 * Deep-strip all non-cloneable values (function closures, Fraction objects)
 * from the result before posting via structured-clone.
 */
function sanitizeResultForPost(result: FootingOptimizeResult): FootingOptimizeResult {
    return JSON.parse(JSON.stringify(result));
}

// ─── Message handler ──────────────────────────────────────────────────────────

ctx.onmessage = (ev: MessageEvent<FootingOptimizeRequest>) => {
    const { type, config, params, costRatio = DEFAULT_COST_RATIO } = ev.data;
    if (type !== 'optimize') return;

    // Clamp to a sane range — a ratio below 1 or above 200 suggests a unit error.
    const r = Math.max(1, Math.min(200, costRatio));

    try {
        const result = optimizeFooting(
            config,
            params,
            r,                                        // economic weight passed to engine
            (done, total, feasible) => {
                ctx.postMessage({ type: 'progress', done, total, feasible });
            },
        );
        ctx.postMessage({ type: 'done', result: sanitizeResultForPost(result) });
    } catch (err) {
        ctx.postMessage({
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
        });
    }
};

export {};
