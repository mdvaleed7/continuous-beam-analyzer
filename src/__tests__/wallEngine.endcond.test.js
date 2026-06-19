/**
 * End-condition regression.
 *
 * Restored from deleted tests/test_endcond.mjs (commit 2e6ac6c) and converted
 * to jest. The wallEngine.js comment block at line ~488-497 references this
 * test by name; keeping it ensures the comment's claim stays verifiable.
 */
import { analyzeBeam, toFrac } from '../components/beamEngine';
import { analyzeWall } from '../components/wallEngine';

describe('End-condition behavior (CALC-003 / GUI-002)', () => {
    test('(A) Beam mode: endCond must change reactions/moments', () => {
        const baseCfg = (endCond) => ({
            nSpans: 2, loadCase: 'udl', endCond,
            spanLengths: [1, 1].map(toFrac), spanEIs: [1, 1].map(toFrac),
            spanTapers: [null, null], refSpanL: 0, refSpanEI: 0,
            L_ref_phys: 1, EI_ref_phys: 1, w1Val: 10, w2Val: 0, wVal: 10, lastSpanLoadStop: 0,
        });
        const rp = analyzeBeam(baseCfg('pinned'));
        const rf = analyzeBeam(baseCfg('fixed'));
        const rff = analyzeBeam(baseCfg('fixed-fixed'));
        const m0p = rp.spans[0].MLeft_frac.fl();
        const m0f = rf.spans[0].MLeft_frac.fl();
        const m0ff = rff.spans[0].MLeft_frac.fl();
        expect(Math.abs(m0p) < 1e-9).toBe(true);                  // pinned: free rotation
        expect(Math.abs(m0f) > 1e-6).toBe(true);                  // fixed: fixity engaged
        expect(Math.abs(m0f - m0ff) > 1e-9 || Math.abs(m0p - m0f) > 1e-9).toBe(true); // changes result
    });

    test('(B) Wall mode: config.endCond must be ignored (hardcoded fixed-right)', () => {
        const wallCfg = (endCond) => ({
            zones: [{ height: 1.5, thickness: 300 }, { height: 1.5, thickness: 250 }],
            soilParams: { phi: 30, gamma_soil: 18, gamma_water: 9.81, waterTableDepth: 2.0, groundLevelDepth: 0.0, surcharge: 10, waterMode: 'partial' },
            material: { grade: 'M30', fck: 30, steelGrade: 'Fe500', fy: 500, cover: 50, E: 27386 }, loadFactor: 1.5, isTapered: false,
            barDias: [8, 10, 12, 16, 20, 25], spacings: [100, 125, 150, 175, 200, 250, 300],
            endCond,
        });
        const wPinned = analyzeWall(wallCfg('pinned'));
        const wFixed = analyzeWall(wallCfg('fixed-fixed'));
        // Deterministic full-result signature (stable key ordering).
        const stable = (o) => JSON.stringify(o, (k, v) => {
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                return Object.keys(v).sort().reduce((a, kk) => { a[kk] = v[kk]; return a; }, {});
            }
            return v;
        });
        const stripCfg = (w) => { const { config, ...rest } = w; return rest; };
        const sigP = stable(stripCfg(wPinned));
        const sigF = stable(stripCfg(wFixed));
        expect(sigP).toBe(sigF); // byte-identical regardless of config.endCond
    });
});
