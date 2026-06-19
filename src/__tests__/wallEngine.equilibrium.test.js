/**
 * GUI-004 regression: structural-equilibrium check.
 *
 * The Validation Summary's equilibrium check must come from the ACTUAL analysis
 * output (physical zone shears V_left/V_right exposed in zoneDesigns, summing
 * to the support reactions) and balance the independently integrated total
 * applied lateral load — NOT from a design-code pass/fail flag.
 *
 * Restored from deleted tests/test_gui004_equilibrium.mjs (commit 2e6ac6c)
 * and converted to jest.
 */
import { analyzeWall } from '../components/wallEngine';

function equilibrium(cfg) {
    const res = analyzeWall(cfg);
    const zd = res.zoneDesigns;
    // ΣReactions = Σ over zones of (V_left − V_right) — telescopes to the sum
    // of all support reactions for a statically-admissible solution.
    let sumReactions = 0;
    for (const z of zd) sumReactions += (Number(z.V_left) || 0) - (Number(z.V_right) || 0);
    return { sumReactions, totalLoad: Number(res.totalLateralForce) || 0 };
}

const base = {
    material: { grade: 'M30', fck: 30, steelGrade: 'Fe500', fy: 500, cover: 50, E: 27386 },
    barDias: [8, 10, 12, 16, 20, 25],
    spacings: [100, 125, 150, 175, 200, 250, 300],
};

function checkEquilibrium(name, cfg) {
    test(name, () => {
        const { sumReactions, totalLoad } = equilibrium(cfg);
        const residual = Math.abs(sumReactions - totalLoad);
        const tol = Math.max(0.1, 1e-4 * Math.abs(totalLoad));
        expect(residual).toBeLessThanOrEqual(tol);
    });
}

describe('GUI-004: structural equilibrium', () => {
    checkEquilibrium('1-zone dry, LF=1', {
        ...base,
        zones: [{ height: 4, thickness: 300 }],
        soilParams: { phi: 30, gamma_soil: 18, gamma_water: 9.81, waterTableDepth: 999, surcharge: 0, waterMode: 'dry' },
        loadFactor: 1,
    });

    checkEquilibrium('2-zone partial WT, LF=1.5', {
        ...base,
        zones: [{ height: 1.5, thickness: 300 }, { height: 1.5, thickness: 250 }],
        soilParams: { phi: 30, gamma_soil: 18, gamma_water: 9.81, waterTableDepth: 2, surcharge: 10, waterMode: 'partial' },
        loadFactor: 1.5,
    });

    checkEquilibrium('3-zone fully submerged, LF=1.5', {
        ...base,
        zones: [{ height: 1.3, thickness: 350 }, { height: 1.3, thickness: 300 }, { height: 1.4, thickness: 250 }],
        soilParams: { phi: 32, gamma_soil: 19, gamma_water: 9.81, waterTableDepth: 0, surcharge: 5, waterMode: 'submerged' },
        loadFactor: 1.5,
    });

    checkEquilibrium('4-zone partial WT + surcharge, LF=1.5', {
        ...base,
        zones: [{ height: 2, thickness: 300 }, { height: 1.5, thickness: 300 }, { height: 1.5, thickness: 250 }, { height: 1, thickness: 250 }],
        soilParams: { phi: 28, gamma_soil: 20, gamma_water: 9.81, waterTableDepth: 3, surcharge: 15, waterMode: 'partial' },
        loadFactor: 1.5,
    });
});
