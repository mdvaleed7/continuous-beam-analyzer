/**
 * Wall optimizer regression.
 *
 * Restored from deleted tests/test_optimizer.mjs + tests/test_seq_fallback.mjs
 * (commit 2e6ac6c) and converted to jest.
 */
import { optimizeWall } from '../components/wallEngine';

const base = {
    soilParams: { phi: 30, gamma_soil: 18, gamma_water: 9.81, waterTableDepth: 2, surcharge: 10, waterMode: 'partial' },
    material: { grade: 'M30', fck: 30, steelGrade: 'Fe500', fy: 500, cover: 50, E: 27386 }, loadFactor: 1.5,
    barDias: [8, 10, 12, 16, 20, 25], spacings: [100, 125, 150, 175, 200, 250, 300],
};

describe('Wall optimizer', () => {
    test('full enumeration (2 zones, ~5 thk options = 25 combos)', () => {
        const zones2 = [{ height: 1.5, thickness: 300 }, { height: 1.5, thickness: 300 }];
        const r = optimizeWall({ ...base, zones: zones2, minThk: 200, maxThk: 400, thkStep: 50 });
        expect(r.method).toBe('full-enumeration');
        expect(r.approximate).toBe(false);
        expect(r.totalTrials).toBeGreaterThan(0);
    });

    test('sequential fallback returns a result without crashing for large search space', () => {
        // 6 zones × 46 options = ~9.3e9 combos → triggers sequential fallback
        const zones6 = Array.from({ length: 6 }, () => ({ height: 0.7, thickness: 300 }));
        const r = optimizeWall({ ...base, zones: zones6, minThk: 200, maxThk: 400, thkStep: 10 });
        expect(r.method).toBe('sequential-greedy');
        expect(r.approximate).toBe(true);
        // Should NOT throw. Optimum may be null if no feasible design exists, that's fine.
    });

    test('full enumeration result is flagged optimal', () => {
        const zones2 = [{ height: 1.5, thickness: 300 }, { height: 1.5, thickness: 300 }];
        const r = optimizeWall({ ...base, zones: zones2, minThk: 200, maxThk: 400, thkStep: 50 });
        // If at least one feasible design was found, the optimum must be present
        // and flagged as the global optimum (full enumeration evaluated every combo).
        if (r.feasibleCount > 0) {
            expect(r.optimum).not.toBeNull();
            expect(r.topDesigns.length).toBeGreaterThan(0);
            expect(r.topDesigns[0]).toBe(r.optimum);
        }
    });
});
