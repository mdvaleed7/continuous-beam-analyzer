/// <reference lib="webworker" />

export const DEFAULT_COST_RATIO = 90;
export const sanitize = <T>(r: T): T => JSON.parse(JSON.stringify(r));

// ─── Shared worker message types ──────────────────────────────────────────────

export interface ProgressMessage {
    type: 'progress';
    done: number;
    total: number;
    feasible: number;
}

export interface DoneMessage<R = unknown> {
    type: 'done';
    result: R;
}

export interface ErrorMessage {
    type: 'error';
    error: string;
}

export type WorkerOutbound<R = unknown> = ProgressMessage | DoneMessage<R> | ErrorMessage;

// ─── Generic optimizer handler factory ────────────────────────────────────────
// ponytail: all 3 workers had identical try/catch/clamp/progress/sanitize boilerplate.
// This factory collapses ~100 lines per worker into a single call.

export function createOptimizeHandler<Req extends { type: string; costRatio?: number }, Res>(
    runOptimize: (data: Req, costRatio: number, onProgress: (done: number, total: number, feasible: number) => void) => Res,
    validate?: (data: Req) => string | null,
): void {
    const ctx = self as unknown as {
        postMessage(msg: WorkerOutbound<Res>): void;
        onmessage: ((ev: MessageEvent<Req>) => void) | null;
    };

    ctx.onmessage = (ev: MessageEvent<Req>) => {
        const data = ev.data;
        if (data.type !== 'optimize') return;

        if (validate) {
            const err = validate(data);
            if (err) { ctx.postMessage({ type: 'error', error: err }); return; }
        }

        const r = Math.max(1, Math.min(200, data.costRatio ?? DEFAULT_COST_RATIO));

        try {
            const result = runOptimize(data, r, (done, total, feasible) => {
                ctx.postMessage({ type: 'progress', done, total, feasible });
            });
            ctx.postMessage({ type: 'done', result: sanitize(result) });
        } catch (err) {
            ctx.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
        }
    };
}
