/**
 * Slab engine smoke tests.
 *
 * Covers all three slab types (two-way, one-way, cantilever) plus the
 * auto-detect path. Each test verifies that the engine returns the expected
 * result shape and that type-specific fields are present.
 */
import { analyzeSlab, analyzeSlabs } from '../components/slabEngine';

describe('Slab engine smoke tests', () => {
    test('analyzeSlab runs for a one-way slab (Ly/Lx > 2 → auto-detected)', () => {
        const r = analyzeSlab({
            label: 'S1', Lx: 3.0, Ly: 7.0, D: 150, cover: 20,
            fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500',
            LL: 3, SDL: 1.5, loadFactor: 1.5,
            boundaryCase: 1, slabType: 'auto', ageOfLoading: '28',
        });
        expect(r).toBeDefined();
        expect(r.slabType).toBe('one-way');
        expect(r.wFactored).toBeGreaterThan(0);
        expect(r.Mx_pos).toBeGreaterThan(0);
        expect(typeof r.flex_x_bot.Ast_req).toBe('number');
        expect(r.bars_x_bot.label).toMatch(/\d+mm @ \d+ c\/c/);
        expect(r.supportCondition).toBeDefined();
    });

    test('analyzeSlab runs for a two-way restrained slab (Case 1, interior)', () => {
        const r = analyzeSlab({
            label: 'S2', Lx: 4.0, Ly: 5.0, D: 150, cover: 20,
            fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500',
            LL: 3, SDL: 1.5, loadFactor: 1.5,
            boundaryCase: 1, slabType: 'auto', ageOfLoading: '28',
        });
        expect(r.slabType).toBe('two-way');
        expect(r.Mx_pos).toBeGreaterThan(0);
        expect(r.My_pos).toBeGreaterThan(0);
        expect(r.ax_pos).toBeGreaterThan(0);
        expect(r.ay_pos).toBeGreaterThan(0);
    });

    test('analyzeSlab runs for an explicit one-way slab with supportCondition', () => {
        const r = analyzeSlab({
            label: 'S3', Lx: 4.0, Ly: 8.0, D: 150, cover: 20,
            fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500',
            LL: 3, SDL: 1.5, loadFactor: 1.5,
            slabType: 'one-way',
            supportCondition: 'continuous',
            ageOfLoading: '28',
        });
        expect(r.slabType).toBe('one-way');
        expect(r.supportCondition).toBe('continuous');
        // Continuous: M+ = wL²/12, M- = wL²/10
        expect(r.ax_pos).toBeCloseTo(1 / 12, 4);
        expect(r.ax_neg).toBeCloseTo(1 / 10, 4);
        expect(r.Mx_pos).toBeGreaterThan(0);
        expect(r.Mx_neg).toBeGreaterThan(0);
        // Y-direction moments should be zero for one-way
        expect(r.My_pos).toBe(0);
        expect(r.My_neg).toBe(0);
    });

    test('analyzeSlab runs for a cantilever slab with single L field', () => {
        const r = analyzeSlab({
            label: 'S4', L: 1.5, Lx: 0, Ly: 0, D: 150, cover: 20,
            fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500',
            LL: 3, SDL: 1.5, loadFactor: 1.5,
            slabType: 'cantilever',
            ageOfLoading: '28',
        });
        expect(r.slabType).toBe('cantilever');
        expect(r.supportCondition).toBe('cantilever');
        // Cantilever: M = wL²/2, only hogging (negative) moment
        expect(r.Mx_neg).toBeGreaterThan(0);
        expect(r.Mx_pos).toBe(0);
        expect(r.My_pos).toBe(0);
        expect(r.My_neg).toBe(0);
        expect(r.ax_neg).toBe(0.5);
        // Lx should reflect the single L input
        expect(r.Lx).toBe(1.5);
    });

    test('analyzeSlab handles one-way simply supported (M = wL²/8)', () => {
        const r = analyzeSlab({
            label: 'S5', Lx: 4.0, Ly: 8.0, D: 150, cover: 20,
            fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500',
            LL: 3, SDL: 1.5, loadFactor: 1.5,
            slabType: 'one-way',
            supportCondition: 'simply',
            ageOfLoading: '28',
        });
        expect(r.slabType).toBe('one-way');
        expect(r.supportCondition).toBe('simply');
        expect(r.ax_pos).toBeCloseTo(1 / 8, 4);
        // Simply supported: no negative moment
        expect(r.Mx_neg).toBe(0);
    });

    test('analyzeSlabs handles multi-panel input with mixed types', () => {
        const results = analyzeSlabs([
            { label: 'S1', Lx: 3.0, Ly: 7.0, D: 150, cover: 20, fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500', LL: 3, SDL: 1.5, loadFactor: 1.5, boundaryCase: 1, slabType: 'auto', ageOfLoading: '28' },
            { label: 'S2', Lx: 4.0, Ly: 5.0, D: 150, cover: 20, fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500', LL: 3, SDL: 1.5, loadFactor: 1.5, boundaryCase: 1, slabType: 'auto', ageOfLoading: '28' },
            { label: 'S3', L: 1.5, Lx: 0, Ly: 0, D: 150, cover: 20, fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500', LL: 3, SDL: 1.5, loadFactor: 1.5, slabType: 'cantilever', ageOfLoading: '28' },
        ]);
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(3);
        expect(results[0].slabType).toBe('one-way');
        expect(results[1].slabType).toBe('two-way');
        expect(results[2].slabType).toBe('cantilever');
    });
});
