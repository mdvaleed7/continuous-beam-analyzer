/**
 * Footing engine smoke tests.
 */
import { analyzeFooting, analyzeFootings, FOOTING_TYPES } from '../components/footingEngine';

describe('Footing engine smoke tests', () => {
    test('analyzeFooting runs for a flat footing', () => {
        const r = analyzeFooting({
            label: 'F1',
            footingType: 'flat',
            col_a: 500, col_b: 500,
            Fy: 1000, Mx: 0, Mz: 0,
            sbc: 150, depthFill: 1.0, gammaFill: 18, gammaConcrete: 25,
            fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500', cover: 50,
            barDiaX: 16, barDiaZ: 16,
            L: 2.5, B: 2.5, D: 0.5,
            pedestalOffset: 0, pedestal_a: 0, pedestal_b: 0,
            addnWtPercent: 10, shearStrength: 0.3,
        });
        expect(r).toBeDefined();
        expect(r.footingType).toBe('flat');
        expect(r.areaProv).toBeGreaterThan(0);
        expect(r.areaReq).toBeGreaterThan(0);
        expect(r.soilPressure.p_max).toBeGreaterThan(0);
        expect(r.punchingShear.status).toMatch(/OK|FAIL/);
        expect(r.oneWayShearX.status).toMatch(/OK|FAIL/);
        expect(r.flexureX.Ast_req).toBeGreaterThan(0);
        expect(r.flexureZ.Ast_req).toBeGreaterThan(0);
        expect(r.slopeCheck).toBeNull();
        expect(r.overallStatus).toMatch(/SAFE|REVISE/);
    });

    test('analyzeFooting runs for a slope footing', () => {
        const r = analyzeFooting({
            label: 'F2',
            footingType: 'slope',
            col_a: 600, col_b: 600,
            Fy: 4300, Mx: 0, Mz: 0,
            sbc: 180, depthFill: 0, gammaFill: 18, gammaConcrete: 25,
            fck: 30, fy: 500, grade: 'M30', steelGrade: 'Fe500', cover: 50,
            barDiaX: 16, barDiaZ: 16,
            L: 5.2, B: 5.2, D: 0.5,
            pedestalOffset: 50, pedestal_a: 1500, pedestal_b: 1500,
            D1: 450,
            addnWtPercent: 10, shearStrength: 0.39,
        });
        expect(r.footingType).toBe('slope');
        expect(r.D1).toBe(450);
        expect(r.slopeCheck).not.toBeNull();
        expect(r.slopeCheck.slopeAngleDeg).toBeGreaterThan(0);
        expect(r.punchingShear.status).toMatch(/OK|FAIL/);
        expect(r.overallStatus).toMatch(/SAFE|REVISE/);
    });

    test('analyzeFooting handles eccentric loading (Mx > 0)', () => {
        const r = analyzeFooting({
            label: 'F3',
            footingType: 'flat',
            col_a: 400, col_b: 400,
            Fy: 825, Mx: 750, Mz: 0,
            sbc: 185, depthFill: 0, gammaFill: 18, gammaConcrete: 25,
            fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500', cover: 50,
            barDiaX: 20, barDiaZ: 20,
            L: 2.5, B: 13, D: 1.2,
            pedestalOffset: 0, pedestal_a: 0, pedestal_b: 0,
            addnWtPercent: 10, shearStrength: 0.291,
        });
        expect(r.soilPressure.eccentricityZ).toBeGreaterThan(0);
        expect(r.soilPressure.p_max).toBeGreaterThan(r.soilPressure.p_min);
        expect(r.soilPressure.sbcCheckFactor).toBe(1.25); // lateral loads → 25% increase
    });

    test('analyzeFootings handles multi-footing input', () => {
        const results = analyzeFootings([
            { label: 'F1', footingType: 'flat', col_a: 500, col_b: 500, Fy: 1000, Mx: 0, Mz: 0, sbc: 150, depthFill: 1.0, gammaFill: 18, gammaConcrete: 25, fck: 25, fy: 500, grade: 'M25', steelGrade: 'Fe500', cover: 50, barDiaX: 16, barDiaZ: 16, L: 2.5, B: 2.5, D: 0.5, pedestalOffset: 0, pedestal_a: 0, pedestal_b: 0, addnWtPercent: 10, shearStrength: 0.3 },
            { label: 'F2', footingType: 'slope', col_a: 600, col_b: 600, Fy: 4300, Mx: 0, Mz: 0, sbc: 180, depthFill: 0, gammaFill: 18, gammaConcrete: 25, fck: 30, fy: 500, grade: 'M30', steelGrade: 'Fe500', cover: 50, barDiaX: 16, barDiaZ: 16, L: 5.2, B: 5.2, D: 1.0, pedestalOffset: 50, pedestal_a: 1500, pedestal_b: 1500, D1: 450, addnWtPercent: 10, shearStrength: 0.39 },
        ]);
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(2);
        expect(results[0].footingType).toBe('flat');
        expect(results[1].footingType).toBe('slope');
    });

    test('FOOTING_TYPES export is correct', () => {
        expect(FOOTING_TYPES.length).toBe(2);
        expect(FOOTING_TYPES[0].value).toBe('flat');
        expect(FOOTING_TYPES[1].value).toBe('slope');
    });
});
