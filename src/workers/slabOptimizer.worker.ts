/**
 * Web Worker — Slab thickness optimizer.
 * ponytail: boilerplate consolidated into workerUtils.createOptimizeHandler.
 */
/// <reference lib="webworker" />

import { optimizeSlab, type SlabConfig, type SlabOptimizeResult } from '../components/slabEngine';
import { createOptimizeHandler } from './workerUtils';

interface Req { type: string; config: SlabConfig; thicknesses: number[]; costRatio?: number; }

createOptimizeHandler<Req, SlabOptimizeResult>(
    (data, r, onProgress) => optimizeSlab(data.config, data.thicknesses, r, onProgress),
    (data) => (!Array.isArray(data.thicknesses) || data.thicknesses.length === 0) ? 'thicknesses array is empty or missing.' : null,
);

export {};
