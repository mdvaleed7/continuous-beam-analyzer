/**
 * steelSection.ts — welded doubly-symmetric I-section with a web depth that
 * varies along the member (tapered members of pre-engineered frames).
 *
 * Units: mm, N. Axes: z-z = major (in-plane bending), y-y = minor — the IS 800
 * convention; AISC calls them x-x / y-y.
 */

export const STEEL_DENSITY = 7850;          // kg/m³

export interface ISection {
    D: number;      // overall depth (mm)
    bf: number;     // flange width (mm), both flanges equal
    tf: number;     // flange thickness (mm)
    tw: number;     // web thickness (mm)
}

export interface SectionProps extends ISection {
    hw: number;     // clear web depth D − 2tf (mm)
    h0: number;     // distance between flange centroids D − tf (mm)
    A: number;      // mm²
    Af: number;     // area of one flange (mm²)
    Aw: number;     // D·tw — shear area (mm²)
    Iz: number;     // major-axis second moment (mm⁴)
    Iy: number;     // minor-axis second moment (mm⁴)
    Zez: number;    // major-axis elastic modulus (mm³)
    Zpz: number;    // major-axis plastic modulus (mm³)
    rz: number;     // mm
    ry: number;     // mm
    J: number;      // St Venant torsion constant Σ b t³/3 (mm⁴)
    Iw: number;     // warping constant Iy·h0²/4 (mm⁶)
}

export function sectionProps(s: ISection): SectionProps {
    const { D, bf, tf, tw } = s;
    const hw = D - 2 * tf;
    const h0 = D - tf;
    const Af = bf * tf;
    const A = 2 * Af + hw * tw;
    const Iz = (bf * D ** 3 - (bf - tw) * hw ** 3) / 12;
    const Iy = 2 * tf * bf ** 3 / 12 + hw * tw ** 3 / 12;
    const Zez = 2 * Iz / D;
    const Zpz = Af * h0 + tw * hw * hw / 4;
    const J = (2 * bf * tf ** 3 + hw * tw ** 3) / 3;
    const Iw = Iy * h0 * h0 / 4;
    return {
        D, bf, tf, tw, hw, h0, A, Af, Aw: D * tw, Iz, Iy, Zez, Zpz,
        rz: Math.sqrt(Iz / A), ry: Math.sqrt(Iy / A), J, Iw,
    };
}

/**
 * Depth profile of a tapered member: overall depth D (mm) at member
 * fractions `at` (0 … 1, ascending), linear in between.
 */
export interface TaperProfile {
    at: number[];
    D: number[];
    // optimizer depth variable of each point: 0 = first depth, 1 = second
    // (default: first point 0, all others 1)
    vars?: (0 | 1)[];
}

export function depthAt(p: TaperProfile, s: number): number {
    const x = Math.min(1, Math.max(0, s));
    for (let k = 0; k < p.at.length - 1; k++) {
        if (x <= p.at[k + 1] + 1e-12) {
            const span = p.at[k + 1] - p.at[k];
            const r = span > 0 ? (x - p.at[k]) / span : 0;
            return p.D[k] + (p.D[k + 1] - p.D[k]) * r;
        }
    }
    return p.D[p.D.length - 1];
}

/** Section of a tapered member at fraction s along it. */
export interface MemberSection {
    bf: number;
    tf: number;
    tw: number;
    profile: TaperProfile;
}

export function memberSectionAt(m: MemberSection, s: number): SectionProps {
    return sectionProps({ D: depthAt(m.profile, s), bf: m.bf, tf: m.tf, tw: m.tw });
}

/** Steel mass of a member of length L (m), integrated along the taper (kg). */
export function memberMass(m: MemberSection, L: number, n = 40): number {
    let V = 0;
    for (let k = 0; k < n; k++) V += memberSectionAt(m, (k + 0.5) / n).A * 1e-6 * L / n;
    return V * STEEL_DENSITY;
}
