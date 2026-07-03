/**
 * Web Worker — Footing optimizer.
 * ponytail: boilerplate consolidated into workerUtils.createOptimizeHandler.
 */
/// <reference lib="webworker" />

import { optimizeFooting, type FootingConfig, type FootingOptimizeParams } from '../components/footingEngine';
import { createOptimizeHandler } from './workerUtils';

interface Req { type: string; config: FootingConfig; params: FootingOptimizeParams; costRatio?: number; }

createOptimizeHandler<Req, ReturnType<typeof optimizeFooting>>(
    (data, r, onProgress) => optimizeFooting(data.config, data.params, r, onProgress),
);

export {};
