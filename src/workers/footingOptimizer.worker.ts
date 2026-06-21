/**
 * Web Worker for the footing optimizer.
 *
 * Message protocol (main thread → worker):
 *   { type: 'optimize', config: FootingConfig, params: FootingOptimizeParams }
 *
 * Message protocol (worker → main thread):
 *   { type: 'progress', done: number, total: number, feasible: number }
 *   { type: 'done',    result: FootingOptimizeResult }
 *   { type: 'error',   error: string }
 *
 */

/// <reference lib="webworker" />

import { optimizeFooting, type FootingConfig, type FootingOptimizeParams, type FootingOptimizeResult } from '../components/footingEngine';

export interface FootingOptimizeRequest {
    type: 'optimize';
    config: FootingConfig;
    params: FootingOptimizeParams;
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

const ctx = self as unknown as {
    postMessage(message: WorkerOutboundMessage): void;
    onmessage: ((ev: MessageEvent<FootingOptimizeRequest>) => void) | null;
};

function sanitizeResultForPost(result: FootingOptimizeResult): FootingOptimizeResult {
    return JSON.parse(JSON.stringify(result));
}

ctx.onmessage = (ev: MessageEvent<FootingOptimizeRequest>) => {
    const { type, config, params } = ev.data;
    if (type !== 'optimize') return;

    try {
        const result = optimizeFooting(config, params, (done, total, feasible) => {
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
