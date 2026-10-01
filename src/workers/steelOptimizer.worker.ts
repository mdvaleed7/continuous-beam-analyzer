/**
 * Web Worker — tapered steel member / portal frame optimizer, and the roof
 * scheme comparison (tapered rafters vs CHS / SHS / double-angle trusses).
 */
/// <reference lib="webworker" />

import {
    optimizeSteel, compareRoofSchemes,
    type SteelInput, type SteelOptimizeParams, type SteelOptimizeResult, type RoofSchemeResult, type TrussRoof,
} from '../components/steelFrameEngine';
import type { TrussFamily } from '../lib/steelTruss';
import { createOptimizeHandler } from './workerUtils';

interface Req {
    type: string; input: SteelInput; params: SteelOptimizeParams; costRatio?: number;
    compare?: { truss: TrussRoof; families: TrussFamily[] };
}

createOptimizeHandler<Req, SteelOptimizeResult | RoofSchemeResult[]>(
    (data, _r, onProgress) => (data.compare
        ? compareRoofSchemes(data.input, data.params, data.compare.truss, data.compare.families, onProgress)
        : optimizeSteel(data.input, data.params, onProgress)),
    (data) => (!data.input ? 'input missing' : null),
);

export {};
