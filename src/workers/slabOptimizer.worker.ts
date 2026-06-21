/**
 * Web Worker for the slab thickness optimizer.
 *
 * Message protocol (main thread → worker):
 *   { type: 'optimize', config: SlabConfig, thicknesses: number[] }
 *
 * Message protocol (worker → main thread):
 *   { type: 'progress', done: number, total: number, feasible: number }
 *   { type: 'done',    result: SlabOptimizeResult }
 *   { type: 'error',   error: string }
 *
 */

/// <reference lib="webworker" />

import { optimizeSlab, type SlabConfig, type SlabOptimizeResult } from '../components/slabEngine';

export interface SlabOptimizeRequest {
    type: 'optimize';
    config: SlabConfig;
    thicknesses: number[];
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

const ctx = self as unknown as {
    postMessage(message: WorkerOutboundMessage): void;
    onmessage: ((ev: MessageEvent<SlabOptimizeRequest>) => void) | null;
};

function sanitizeResultForPost(result: SlabOptimizeResult): SlabOptimizeResult {
    return JSON.parse(JSON.stringify(result));
}

ctx.onmessage = (ev: MessageEvent<SlabOptimizeRequest>) => {
    const { type, config, thicknesses } = ev.data;
    if (type !== 'optimize') return;

    try {
        const result = optimizeSlab(config, thicknesses, (done, total, feasible) => {
            ctx.postMessage({ type: 'progress', done, total, feasible });
        });
        const safeResult = sanitizeResultForPost(result);
        ctx.postMessage({ type: 'done', result: safeResult });
    } catch (err) {
        ctx.postMessage({
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
        });
    }
};

export {};
