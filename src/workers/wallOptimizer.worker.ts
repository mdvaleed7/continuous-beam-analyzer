/**
 * Web Worker — Wall thickness optimizer.
 * ponytail: boilerplate consolidated into workerUtils.createOptimizeHandler.
 */
/// <reference lib="webworker" />

import { optimizeWall, type WallConfig, type OptimizeResult } from '../components/wallEngine';
import { createOptimizeHandler } from './workerUtils';

interface Req { type: string; config: WallConfig; costRatio?: number; }

createOptimizeHandler<Req, OptimizeResult>(
    (data, r, onProgress) => optimizeWall(data.config, r, onProgress),
);

export {};
