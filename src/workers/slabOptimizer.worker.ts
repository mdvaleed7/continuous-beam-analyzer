/**
 * Web Worker for the slab thickness optimizer.
 *
 * Message protocol (main thread → worker):
 *   {
 *     type:        'optimize',
 *     config:      SlabConfig,
 *     thicknesses: number[],      // candidate gross depths to sweep (mm)
 *     costRatio?:  number         // volumetric steel-to-concrete cost ratio (default 90)
 *   }
 *
 * Message protocol (worker → main thread):
 *   { type: 'progress', done: number, total: number, feasible: number }
 *   { type: 'done',     result: SlabOptimizeResult }
 *   { type: 'error',    error: string }
 *
 * ─── ECONOMIC OBJECTIVE ────────────────────────────────────────────────────
 * For each slab thickness D in the candidate list the engine runs the full
 * IS 456 design (flexure, deflection, shear) and, if feasible, computes:
 *
 *   cost_index = V_concrete  +  V_steel × r
 *              = (D/1000) × Lx × Ly          +  (Ast_total_mm2 × length / 1e6) × r
 *
 * where r = costRatio (default 90), consistent with:
 *   r = (ρ_steel × P_steel_per_kg) / P_concrete_per_m3
 *     = (7850 × 57) / 5000  ≈ 89.5  (India, mid-2025)
 *
 * Simplified weight-based form used in practice:
 *   cost_index = concreteVol_m3  +  steelWeight_kg × (r / 7850)
 *              = concreteVol_m3  +  steelWeight_kg × 0.01147   (at r = 90)
 *
 * The thicknesses array should span the feasible range with enough resolution
 * to capture the cost minimum. A reasonable default for two-way slabs is:
 *   [100, 110, 120, 130, 140, 150, 160, 175, 200, 225, 250] mm
 *
 * Finer steps near the expected optimum improve resolution at negligible cost
 * since each evaluation is cheap (no Worker inside the Worker).
 * ───────────────────────────────────────────────────────────────────────────
 */

/// <reference lib="webworker" />

import {
    optimizeSlab,
    type SlabConfig,
    type SlabOptimizeResult,
} from '../components/slabEngine';
import { DEFAULT_COST_RATIO, sanitize } from './workerUtils';

// ─── Message types ────────────────────────────────────────────────────────────

export interface SlabOptimizeRequest {
    type: 'optimize';
    config: SlabConfig;
    /**
     * Candidate slab gross depths to evaluate, in millimetres.
     * The optimizer selects the feasible depth with the lowest cost_index.
     * Example: [100, 110, 120, 130, 140, 150, 175, 200]
     */
    thicknesses: number[];
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
    result: SlabOptimizeResult;
}

export interface ErrorMessage {
    type: 'error';
    error: string;
}

export type WorkerOutboundMessage = ProgressMessage | DoneMessage | ErrorMessage;

// ─── Worker context ───────────────────────────────────────────────────────────

const ctx = self as unknown as {
    postMessage(message: WorkerOutboundMessage): void;
    onmessage: ((ev: MessageEvent<SlabOptimizeRequest>) => void) | null;
};



// ─── Message handler ──────────────────────────────────────────────────────────

ctx.onmessage = (ev: MessageEvent<SlabOptimizeRequest>) => {
    const { type, config, thicknesses, costRatio = DEFAULT_COST_RATIO } = ev.data;
    if (type !== 'optimize') return;

    if (!Array.isArray(thicknesses) || thicknesses.length === 0) {
        ctx.postMessage({ type: 'error', error: 'thicknesses array is empty or missing.' });
        return;
    }

    // Clamp to a sane range — a ratio below 1 or above 200 suggests a unit error.
    const r = Math.max(1, Math.min(200, costRatio));

    try {
        const result = optimizeSlab(
            config,
            thicknesses,
            r,                                        // economic weight passed to engine
            (done, total, feasible) => {
                ctx.postMessage({ type: 'progress', done, total, feasible });
            },
        );
        ctx.postMessage({ type: 'done', result: sanitize(result) });
    } catch (err) {
        ctx.postMessage({
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
        });
    }
};

export {};
