/**
 * Web Worker — tapered steel member / portal frame optimizer.
 */
/// <reference lib="webworker" />

import { optimizeSteel, type SteelInput, type SteelOptimizeParams, type SteelOptimizeResult } from '../components/steelFrameEngine';
import { createOptimizeHandler } from './workerUtils';

interface Req { type: string; input: SteelInput; params: SteelOptimizeParams; costRatio?: number; }

createOptimizeHandler<Req, SteelOptimizeResult>(
    (data, _r, onProgress) => optimizeSteel(data.input, data.params, onProgress),
    (data) => (!data.input ? 'input missing' : null),
);

export {};
