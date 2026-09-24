/**
 * Waffle slab — self-weight of solid support zones (hand-calculation checks).
 * Panel 6 × 6 m, ribs 150 × 350 @ 0.9 m, topping 75 mm:
 *   void per cell = 0.75 × 0.75 × 0.275 = 0.1546875 m³ → V_v = 0.19097 m³/m²
 *   Δw = 25·V_v = 4.774 kN/m²;  Δq per rib = 4.774 × 0.9 = 4.297 kN/m (service)
 */
import { analyzeWaffleSlab } from '../components/waffleSlabEngine';

const base = {
    Lx: 6, Ly: 6, spacing_x: 0.9, spacing_y: 0.9,
    bw: 150, D: 350, Df: 75, cover: 30, fck: 25, fy: 500,
    w_live: 3, w_finish: 1.5,
};
const Vv = 0.75 * 0.75 * 0.275 / 0.81;
const dq = 1.5 * 25 * Vv * 0.9;   // factored kN/m per rib
const a = 0.9;
const L = 6;

describe('Waffle solid support zones — extra self-weight', () => {
    test('no solid zone → no change', () => {
        const r = analyzeWaffleSlab(base);
        expect(r.solidZone).toBeNull();
        expect(r.M_rib_x).toBeCloseTo(r.M_rib_x_udl, 10);
    });

    test('zone weight: Δw = 25·V_v, area = L² − (L − 2a)², default a = rib spacing', () => {
        const r = analyzeWaffleSlab({ ...base, solid_support_zone: true });
        const z = r.solidZone!;
        expect(z.width_x).toBeCloseTo(0.9, 6);
        expect(z.w_extra).toBeCloseTo(25 * Vv, 2);
        expect(z.area).toBeCloseTo(36 - 4.2 * 4.2, 2);
        expect(z.extraWeight).toBeCloseTo(25 * Vv * (36 - 4.2 * 4.2), 0);
    });

    test('simply supported: ΔM_mid = Δq·a²/2, ΔV = Δq·a', () => {
        const r0 = analyzeWaffleSlab({ ...base, deflectionSupport: 'simply' });
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'simply', solid_support_zone: true });
        expect(r.M_rib_x - r0.M_rib_x).toBeCloseTo(dq * a * a / 2, 3);
        expect(r.V_rib_x - r0.V_rib_x).toBeCloseTo(dq * a, 3);
        expect(r.hogging).toBeNull();
    });

    test('continuous: ΔM⁻ = Δq·a²(3L − 2a)/(6L) added to the hogging', () => {
        const r0 = analyzeWaffleSlab({ ...base, deflectionSupport: 'continuous', solid_support_zone: true, solid_zone_width: 0.0001 });
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'continuous', solid_support_zone: true });
        const dM = dq * a * a * (3 * L - 2 * a) / (6 * L);
        expect(r.solidZone!.dM_hog_x).toBeCloseTo(dM, 2);
        expect(r.hogging!.x.M_hog - r0.hogging!.x.M_hog).toBeCloseTo(dM, 1);
    });

    test('one end continuous: ΔM⁻ = Δq·a²(3L − 2a)/(4L), ΔV = Δq·a + ΔM⁻/L', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'one_end', solid_support_zone: true });
        const dM = dq * a * a * (3 * L - 2 * a) / (4 * L);
        expect(r.solidZone!.dM_hog_x).toBeCloseTo(dM, 2);
        expect(r.solidZone!.dV_x).toBeCloseTo(dq * a + dM / L, 2);
    });

    test('full-width patch (a = L/2) recovers the UDL results qL²/12 and qL²/8', () => {
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'continuous', solid_support_zone: true, solid_zone_width: 10 });
        expect(r.solidZone!.width_x).toBeCloseTo(3, 6);
        expect(r.solidZone!.dM_hog_x).toBeCloseTo(dq * L * L / 12, 2);
        const p = analyzeWaffleSlab({ ...base, deflectionSupport: 'one_end', solid_support_zone: true, solid_zone_width: 10 });
        expect(p.solidZone!.dM_hog_x).toBeCloseTo(dq * L * L / 8, 2);
    });

    test('zone weight is permanent and increases the deflection', () => {
        const r0 = analyzeWaffleSlab({ ...base, deflectionSupport: 'simply' });
        const r = analyzeWaffleSlab({ ...base, deflectionSupport: 'simply', solid_support_zone: true });
        expect(r.deflection.ai_perm).toBeGreaterThan(r0.deflection.ai_perm);
        expect(r.deflection.a_total).toBeGreaterThan(r0.deflection.a_total);
    });
});
