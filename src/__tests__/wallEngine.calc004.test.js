/**
 * CALC-004 regression: Ast_min / Ast_max base (gross b×t, NOT effective depth d),
 * bar labels, and per-face effective depth using the actually selected bar
 * diameter.
 *
 * Restored from deleted tests/test_calc004.mjs (commit 2e6ac6c) and converted
 * to jest.
 */
import { analyzeWall } from '../components/wallEngine';

const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

describe('CALC-004: Ast_min / Ast_max + bar selection', () => {
    // Single 300 mm zone, dry, modest load so design (not min) may or may not govern;
    // we read back the design object's Ast_min / Ast_max which are pure geometry.
    const cfg = {
        zones: [{ height: 3.0, thickness: 300 }],
        soilParams: { phi: 30, gamma_soil: 18, gamma_water: 9.81, waterTableDepth: 999, surcharge: 10, waterMode: 'dry' },
        material: { grade: 'M30', fck: 30, steelGrade: 'Fe415', fy: 415, cover: 40, E: 27386 },
        loadFactor: 1.5,
        barDias: [8, 10, 12, 16, 20, 25],
        spacings: [100, 125, 150, 175, 200, 250, 300],
    };
    const r = analyzeWall(cfg);
    const zd = r.zoneDesigns[0];

    test('Ast_min = 0.12% × b × t / 2 (per face, Fe415, t=300)', () => {
        const expAstMinFace = Math.ceil(0.0012 * 1000 * 300 / 2);
        expect(zd.flex_hogging.Ast_min).toBe(expAstMinFace);
        expect(zd.flex_sagging.Ast_min).toBe(expAstMinFace);
    });

    test('Ast_max = 4% × b × t (gross, NOT d+50)', () => {
        const expAstMax = Math.floor(0.04 * 1000 * 300);
        expect(zd.flex_hogging.Ast_max).toBe(expAstMax);
        expect(zd.flex_sagging.Ast_max).toBe(expAstMax);
        // Old buggy value would use d+50:
        const buggyMax = Math.floor(0.04 * 1000 * (zd.d_hogging + 50));
        expect(zd.flex_hogging.Ast_max).not.toBe(buggyMax);
    });

    test('selectBars returns a label (no "undefined")', () => {
        expect(typeof zd.mainBars_hogging.label).toBe('string');
        expect(/mm @ \d+ c\/c/.test(zd.mainBars_hogging.label)).toBe(true);
        expect(typeof zd.mainBars_sagging.label).toBe('string');
        expect(/mm @ \d+ c\/c/.test(zd.mainBars_sagging.label)).toBe(true);
    });

    test('effective depth d uses real selected bar dia, not hardcoded 12 mm', () => {
        const expDhog = 300 - 40 - zd.mainBars_hogging.dia / 2;
        expect(approx(zd.d_hogging, expDhog)).toBe(true);
    });
});
