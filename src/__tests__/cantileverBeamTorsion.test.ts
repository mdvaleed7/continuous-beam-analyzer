/**
 * Cantilever slab on a supporting beam that twists (hand-calculation checks).
 * Beam 300 × 600, torsionally restrained at columns Lt = 6 m.
 *   b/h = 0.5 → β = (1/3)(1 − 0.315 + 0.052·0.03125) = 0.22888
 *   C = 0.5·β·300³·600 = 1.8539e9 mm⁴,  G = 0.42·Ec (BS 8110-2 Cl. 2.4.3)
 */
import { analyzeCantileverSlab } from '../components/cantileverSlabEngine';

const base = {
    L: 1.5, D: 180, cover: 20, fck: 25, fy: 500, w_live: 3, w_finish: 1.5,
    bar_main: 12, spacing_main: 150, bar_dist: 8, spacing_dist: 200,
};
const beam = { beam_b: 300, beam_D: 600, beam_span: 6 };
const beta = (1 / 3) * (1 - 0.63 * 0.5 + 0.052 * Math.pow(0.5, 5));
const C = 0.5 * beta * 300 ** 3 * 600;

describe('Cantilever — supporting beam torsion', () => {
    test('beam only: θ = t·Lt²/(8·G·C), t = M per mm', () => {
        const r = analyzeCantileverSlab({ ...base, supportFixity: 'beam', ...beam });
        const sr = r.supportRotation!;
        const Ec = r.deflectionRoot.Ec;
        const t = r.M_service * 1e3;                    // N·mm/mm
        const theta = t * 6000 ** 2 / (8 * 0.42 * Ec * C);
        expect(sr.beam!.beta).toBeCloseTo(beta, 4);
        expect(sr.beam!.C / 1e9).toBeCloseTo(C / 1e9, 4);
        expect(sr.theta_i_mrad).toBeCloseTo(theta * 1000, 2);
        expect(sr.a_i).toBeCloseTo(theta * r.deflectionRoot.L, 1);
        expect(r.deflection.ai).toBeCloseTo(r.deflectionRoot.ai + sr.a_i, 1);
    });

    test('beam only: equilibrium torque at each column T = t·Lt/2', () => {
        const r = analyzeCantileverSlab({ ...base, supportFixity: 'beam', ...beam });
        const bm = r.supportRotation!.beam!;
        expect(bm.T_end).toBeCloseTo(r.M_service * 6 / 2, 2);
        expect(bm.Tu_end).toBeCloseTo(r.Mu * 6 / 2, 2);
        // τ = T/(α b² h), α = 1/(3 + 1.8·0.5)
        expect(bm.tau_t).toBeCloseTo(bm.T_end * 1e6 * (3 + 0.9) / (300 * 300 * 600), 2);
    });

    test('stiffness factor 0.5 doubles the beam rotation', () => {
        const r1 = analyzeCantileverSlab({ ...base, supportFixity: 'beam', ...beam });
        const r2 = analyzeCantileverSlab({ ...base, supportFixity: 'beam', ...beam, beam_torsionStiffnessFactor: 0.5 });
        expect(r2.supportRotation!.theta_i_mrad / r1.supportRotation!.theta_i_mrad).toBeCloseTo(2, 2);
    });

    test('beam + back-span in parallel: θ = (t/k_b)[1 − 1/cosh(λLt/2)], below either alone', () => {
        const back = { backSpan_L: 4, backSpan_farEnd: 'pinned' as const };
        const rb = analyzeCantileverSlab({ ...base, supportFixity: 'backspan', ...back });
        const rt = analyzeCantileverSlab({ ...base, supportFixity: 'beam', ...beam });
        const r = analyzeCantileverSlab({ ...base, supportFixity: 'beam_backspan', ...beam, ...back });
        const Ec = r.deflectionRoot.Ec;
        const t = r.M_service * 1e3;
        const kb = (Ec * r.deflectionRoot.Ieff / 1000) / ((1 / 3) * 4000);
        const GJ = 0.42 * Ec * C;
        const lam = Math.sqrt(kb / GJ);
        const theta = (t / kb) * (1 - 1 / Math.cosh(lam * 3000));
        expect(r.supportRotation!.theta_i_mrad).toBeCloseTo(theta * 1000, 2);
        expect(r.supportRotation!.theta_i_mrad).toBeLessThan(rb.supportRotation!.theta_i_mrad);
        expect(r.supportRotation!.theta_i_mrad).toBeLessThan(rt.supportRotation!.theta_i_mrad);
        // compatibility torque T = t·tanh(λLt/2)/λ < t·Lt/2
        expect(r.supportRotation!.beam!.T_end).toBeCloseTo(t * Math.tanh(lam * 3000) / lam / 1e6, 2);
        expect(r.supportRotation!.beam!.T_end).toBeLessThan(rt.supportRotation!.beam!.T_end);
    });

    test('beam mode without beam data falls back to a fixed root', () => {
        const r = analyzeCantileverSlab({ ...base, supportFixity: 'beam' });
        expect(r.supportRotation).toBeNull();
    });
});
