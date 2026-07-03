/**
 * Validation tests for footingEngine.ts (IS 456:2000 isolated footing design).
 *
 * These tests capture the engineering corrections made during the 2026-07
 * audit:
 *   1. Structural design (flexure + shear) must use FACTORED loads (γf = 1.5),
 *      not the service bearing pressure (IS 456 Cl. 34.2.4.1 / 36.4.1).
 *   2. Punching (two-way) shear permissible stress must use Cl. 31.6.3.1
 *      (ks·0.25·√fck), not the Table 19 one-way flexural τc.
 *   3. SBC (soil bearing) check must remain on SERVICE loads.
 */
import { analyzeFooting, type FootingConfig } from '../components/footingEngine';
import { getPunchingTauC } from '../lib/is456';

function baseConfig(overrides: Partial<FootingConfig> = {}): FootingConfig {
    return {
        label: 'F1',
        footingType: 'flat',
        col_a: 400,
        col_b: 400,
        loadCases: [{ label: 'LC1: DL+LL', Fy: 1000, Mx: 0, Mz: 0, sbc: 200 }],
        Fy: 1000, Mx: 0, Mz: 0, sbc: 200,
        depthFill: 1.0,
        gammaFill: 18,
        gammaConcrete: 25,
        fck: 25,
        fy: 500,
        grade: 'M25',
        steelGrade: 'Fe500',
        cover: 50,
        barDiaX: 16,
        barDiaZ: 16,
        L: 2.5,
        B: 2.5,
        D: 0.5,
        pedestalOffset: 0,
        pedestal_a: 400,
        pedestal_b: 400,
        loadFactor: 1.5,
        ...overrides,
    };
}

describe('footing — factored vs service loads (IS 456 Cl. 34.2.4.1)', () => {
    test('flexural design moment uses net FACTORED soil pressure, not service', () => {
        const r = analyzeFooting(baseConfig());

        // Net factored pressure = 1.5 × column load / area = 1.5 × 1000 / 6.25 = 240 kN/m²
        const expectedPuNet = 1.5 * 1000 / (2.5 * 2.5);
        expect(r.soilPressure.p_max_net_factored).toBeCloseTo(expectedPuNet, 1);

        // Cantilever projection X: (L - col_a)/2 = (2.5 - 0.4)/2 = 1.05 m
        const cant = (2.5 - 0.4) / 2;
        const Mu_expected = expectedPuNet * cant * cant / 2; // kN·m/m
        expect(r.flexureX.Mu).toBeCloseTo(Mu_expected, 0);
    });

    test('factored design moment is ~1.5x the (incorrect) service moment', () => {
        const r = analyzeFooting(baseConfig());
        const cant = (2.5 - 0.4) / 2;
        // Service column pressure would give Mu_service = (1000/6.25) * cant²/2
        const pService = 1000 / 6.25;
        const Mu_service = pService * cant * cant / 2;
        // Corrected (factored) moment must be 1.5× the service moment.
        expect(r.flexureX.Mu / Mu_service).toBeCloseTo(1.5, 2);
    });

    test('SBC check uses SERVICE gross pressure (incl. self-weight + fill)', () => {
        const r = analyzeFooting(baseConfig());
        // Service gross pressure includes self weight + fill, so p_avg > column-only pressure
        const colOnly = 1000 / 6.25; // 160
        expect(r.soilPressure.p_avg).toBeGreaterThan(colOnly);
        // And SBC check compares service p_max to the (200) SBC
        expect(r.soilPressure.p_max).toBeLessThanOrEqual(200);
        expect(r.soilPressure.sbcCheck).toBe(true);
    });
});

describe('footing — punching shear permissible stress (IS 456 Cl. 31.6.3.1)', () => {
    test('square column: τc,punching = 0.25√fck (ks = 1.0)', () => {
        const r = analyzeFooting(baseConfig({ fck: 25 }));
        const expected = 0.25 * Math.sqrt(25); // 1.25
        expect(r.tau_c_punching).toBeCloseTo(expected, 2);
        // The punching check must use this value, not the ~0.29 Table 19 one-way τc
        expect(r.punchingShear.tau_c).toBeCloseTo(expected, 2);
        expect(r.tau_c_punching).toBeGreaterThan(r.tau_c_inbuilt);
    });

    test('rectangular column reduces ks per βc', () => {
        // βc = 300/900 = 0.333 → ks = 0.5 + 0.333 = 0.833
        const tau = getPunchingTauC(25, 300, 900);
        const ks = 0.5 + 300 / 900;
        expect(tau).toBeCloseTo(ks * 0.25 * Math.sqrt(25), 3);
    });

    test('ks is capped at 1.0', () => {
        // βc = 1 (square) → 0.5+1 = 1.5 but capped to 1.0
        expect(getPunchingTauC(30, 500, 500)).toBeCloseTo(1.0 * 0.25 * Math.sqrt(30), 3);
    });
});

describe('footing — regression: eccentricity mapping (Mx→Z, Mz→X)', () => {
    test('Mx produces eccentricity along Z, Mz along X', () => {
        const r = analyzeFooting(baseConfig({
            loadCases: [{ label: 'LC', Fy: 1000, Mx: 100, Mz: 50, sbc: 200 }],
        }));
        expect(r.soilPressure.eccentricityZ).toBeGreaterThan(0); // from Mx
        expect(r.soilPressure.eccentricityX).toBeGreaterThan(0); // from Mz
        // Mx (100) > Mz (50) so eZ > eX
        expect(r.soilPressure.eccentricityZ).toBeGreaterThan(r.soilPressure.eccentricityX);
    });
});
