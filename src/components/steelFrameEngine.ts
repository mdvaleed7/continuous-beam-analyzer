/**
 * steelFrameEngine.ts — analysis and design of web-tapered steel members:
 * a single column, a single beam, and a 2D pitched-roof portal frame
 * (two columns + two rafters), to IS 800:2007 or AISC 360-22.
 *
 * ANALYSIS
 *  • 2D frame finite elements; each tapered member is split into prismatic
 *    sub-elements with the section at the sub-element mid-length.
 *  • Second-order (P-Δ and P-δ) analysis with the consistent geometric
 *    stiffness, iterated to convergence; loss of stability is detected from
 *    the LDLᵀ pivots.
 *  • Elastic buckling load factor γe of the frame: smallest λ with
 *    det(K + λ·KG) = 0, found by bisection on the Sturm count (number of
 *    negative pivots of K + λ·KG).
 *
 * DESIGN BASIS (stated so it can be checked)
 *  IS 800:2007
 *   – Second-order elastic analysis, nominal stiffness; notional horizontal
 *     loads 0.5 % of the factored gravity load in gravity-only combinations
 *     (Cl. 4.3.6).
 *   – In-plane member buckling from the elastic buckling analysis of the
 *     frame: fcc(x) = γe·N(x)/A(x)  (effective length implied by the
 *     buckling analysis).
 *   – Out-of-plane buckling and LTB over the unbraced length Ly (flange
 *     braces), properties of the smallest section of the segment.
 *   – Load combinations, Table 4: 1.5(D+L), 1.2(D+L+W), 1.5(D+W), 0.9D+1.5W.
 *  AISC 360-22 (direct analysis method, Chapter C)
 *   – Second-order analysis with 0.8·τb·EI and 0.8·EA; notional loads
 *     0.002·Yi in gravity-only combinations (and in all combinations when
 *     Δ2nd/Δ1st > 1.7).
 *   – In-plane: K = 1 — elastic buckling load of the member between its
 *     ends (pinned-pinned, tapered), Fe(x) = Pe/A(x) (Design Guide 25).
 *   – ASCE 7-22 LRFD combinations 2.3.1: 1.4D, 1.2D+1.6Lr, 1.2D+1.6Lr+0.5W,
 *     1.2D+1.0W+0.5Lr, 0.9D+1.0W.
 *  Both codes: each wind case with positive and negative internal pressure;
 *  the frame and its member groups are symmetric, so wind from the left
 *  covers wind from the right. Joints are modelled at the member centre
 *  lines (no rigid knee zones). Connections, purlins, girts and bracing are
 *  not designed here.
 */
import { memberSectionAt, memberMass, type MemberSection, type SectionProps } from '../lib/steelSection';
import { checkStationIS, ltbIS, IS800, type ISStationResult } from '../lib/steelIS800';
import { checkStationAISC, ltbStressAISC, cbAISC, AISC, type AISCStationResult } from '../lib/steelAISC360';

export type SteelCode = 'IS800' | 'AISC360';

const STEEL_UNIT_WEIGHT = 78.5;   // kN/m³ (self-weight)

// ═══════════════════════════════════════════════════════════════
//  Banded symmetric LDLᵀ (no pivoting) — used for solving and for
//  the Sturm count in the buckling analysis
// ═══════════════════════════════════════════════════════════════
class BandMatrix {
    readonly a: Float64Array;
    constructor(readonly n: number, readonly hb: number) {
        this.a = new Float64Array(n * (hb + 1));
    }
    /** add to (i, j), i ≥ j within the band */
    add(i: number, j: number, v: number) {
        if (i < j) [i, j] = [j, i];
        const k = i - j;
        if (k > this.hb) throw new Error('band exceeded');
        this.a[i * (this.hb + 1) + k] += v;
    }
    get(i: number, j: number) {
        if (i < j) [i, j] = [j, i];
        const k = i - j;
        return k > this.hb ? 0 : this.a[i * (this.hb + 1) + k];
    }
}

interface LDL { L: Float64Array; D: Float64Array; neg: number; n: number; hb: number; singular: boolean }

function ldl(M: BandMatrix): LDL {
    const { n, hb } = M;
    const w = hb + 1;
    const L = new Float64Array(M.a);             // lower band, overwritten
    const D = new Float64Array(n);
    let neg = 0, singular = false;
    for (let i = 0; i < n; i++) {
        const j0 = Math.max(0, i - hb);
        for (let j = j0; j <= i; j++) {
            let sum = L[i * w + (i - j)];
            const k0 = Math.max(j0, j - hb);
            for (let k = k0; k < j; k++) sum -= L[i * w + (i - k)] * D[k] * L[j * w + (j - k)];
            if (j < i) L[i * w + (i - j)] = D[j] !== 0 ? sum / D[j] : 0;
            else {
                D[i] = sum;
                if (Math.abs(sum) < 1e-14) singular = true;
                if (sum < 0) neg++;
            }
        }
    }
    return { L, D, neg, n, hb, singular };
}

function ldlSolve(f: LDL, b: Float64Array): Float64Array {
    const { L, D, n, hb } = f;
    const w = hb + 1;
    const x = new Float64Array(b);
    for (let i = 0; i < n; i++) {
        for (let k = Math.max(0, i - hb); k < i; k++) x[i] -= L[i * w + (i - k)] * x[k];
    }
    for (let i = 0; i < n; i++) x[i] /= D[i];
    for (let i = n - 1; i >= 0; i--) {
        for (let r = i + 1; r <= Math.min(n - 1, i + hb); r++) x[i] -= L[r * w + (r - i)] * x[r];
    }
    return x;
}

// ═══════════════════════════════════════════════════════════════
//  Model definition
// ═══════════════════════════════════════════════════════════════
export interface MemberDef {
    name: string;
    group: string;               // design group (members of a group share the section)
    i: number; j: number;        // main node indices
    section: MemberSection;
    reverse: boolean;            // section profile runs from j to i
    Ly: number;                  // unbraced length out-of-plane / LTB (m)
    sway: boolean;               // IS 800: Cmz = 0.9 (sway) or from ψ (non-sway)
    breaks?: number[];           // extra FE nodes at these fractions (i → j), e.g. crane brackets
}

export interface MemberLoad { member: number; wx: number; wy: number }   // kN/m of member length, global
export interface NodalLoad { node: number; fx: number; fy: number; mz: number }   // kN, kN·m
// concentrated load on a member at fraction `at` (i → j), which must be one of its breaks
export interface MemberPointLoad { member: number; at: number; fx: number; fy: number; mz: number }

export interface LoadCaseDef { memberLoads: MemberLoad[]; nodalLoads: NodalLoad[]; pointLoads?: MemberPointLoad[] }

export interface ComboDef {
    name: string;
    factors: Record<string, number>;      // load case → factor
    kind: 'strength' | 'service';
    gravityOnly: boolean;                  // notional loads apply
}

export interface SupportDef { node: number; ux: boolean; uy: boolean; rz: boolean }

export interface DeflectionCheckDef {
    name: string;
    combos: string[];
    // value (mm) from the displacement vector u (m, rad); limit in mm
    evaluate: (u: Float64Array, fe: FEModel) => number;
    limit: number;
}

export interface StructureModel {
    code: SteelCode;
    fy: number;
    nodes: { x: number; y: number }[];
    members: MemberDef[];
    supports: SupportDef[];
    loadCases: Record<string, LoadCaseDef>;     // 'D' gets self-weight added
    combos: ComboDef[];
    notionalNodes: number[];                    // main nodes receiving notional loads
    deflections: DeflectionCheckDef[];
    nSub: number;
}

// ═══════════════════════════════════════════════════════════════
//  Finite-element mesh
// ═══════════════════════════════════════════════════════════════
interface Element {
    member: number; k: number;          // sub-element k of member
    n1: number; n2: number;             // FE nodes
    L: number; c: number; s: number;    // m, direction cosines
    sMid: number;                       // member fraction (geometric) at mid
    A: number; I: number;               // mm², mm⁴ at mid (for stiffness)
}

export interface FEModel {
    nodeXY: { x: number; y: number }[];
    mainNode: number[];                 // main node → FE node
    memberNodes: number[][];            // FE nodes along each member (i → j)
    memberFr: number[][];               // their fractions along the member
    elements: Element[];
    ndof: number;
    hb: number;
    fixed: boolean[];
}

/** Reverse Cuthill–McKee order (new index → old index). */
function rcmOrder(nNodes: number, edges: [number, number][]): number[] {
    const adj: number[][] = Array.from({ length: nNodes }, () => []);
    for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
    const deg = adj.map(a => a.length);
    const bfs = (start: number, seen: boolean[]) => {
        const order = [start];
        seen[start] = true;
        for (let h = 0; h < order.length; h++) {
            const nb = adj[order[h]].filter(v => !seen[v]).sort((p, q) => deg[p] - deg[q]);
            for (const v of nb) { if (!seen[v]) { seen[v] = true; order.push(v); } }
        }
        return order;
    };
    const done = new Array<boolean>(nNodes).fill(false);
    const out: number[] = [];
    for (let s0 = 0; s0 < nNodes; s0++) {
        if (done[s0]) continue;
        // pseudo-peripheral start: last node of a BFS from any node of the component
        const comp = bfs(s0, [...done]);
        const far = comp[comp.length - 1];
        const order = bfs(far, done);
        out.push(...order.reverse());
    }
    return out;
}

/** Node fractions of a member: nSub equal parts plus the break points. */
function memberFractions(nSub: number, breaks: number[] = []): number[] {
    const fr = Array.from({ length: nSub + 1 }, (_, k) => k / nSub);
    for (const b of breaks) if (b > 1e-6 && b < 1 - 1e-6 && !fr.some(f => Math.abs(f - b) < 1e-6)) fr.push(b);
    return fr.sort((a, b) => a - b);
}

function buildFE(model: StructureModel): FEModel {
    const nodeXY: { x: number; y: number }[] = [];
    const mainNode = new Array(model.nodes.length).fill(-1);
    const memberNodes: number[][] = [];
    const memberFr: number[][] = [];
    const elements: Element[] = [];
    const nodeOf = (m: number) => {
        if (mainNode[m] < 0) { mainNode[m] = nodeXY.length; nodeXY.push({ ...model.nodes[m] }); }
        return mainNode[m];
    };
    model.members.forEach((mem, mi) => {
        const A = model.nodes[mem.i], B = model.nodes[mem.j];
        const fr = memberFractions(model.nSub, mem.breaks);
        const list = [nodeOf(mem.i)];
        for (let k = 1; k < fr.length - 1; k++) {
            const r = fr[k];
            nodeXY.push({ x: A.x + (B.x - A.x) * r, y: A.y + (B.y - A.y) * r });
            list.push(nodeXY.length - 1);
        }
        list.push(nodeOf(mem.j));
        memberNodes.push(list);
        memberFr.push(fr);
        const Ltot = Math.hypot(B.x - A.x, B.y - A.y);
        const c = (B.x - A.x) / Ltot, s = (B.y - A.y) / Ltot;
        for (let k = 0; k < fr.length - 1; k++) {
            const sMid = 0.5 * (fr[k] + fr[k + 1]);
            const p = memberSectionAt(mem.section, mem.reverse ? 1 - sMid : sMid);
            elements.push({ member: mi, k, n1: list[k], n2: list[k + 1], L: Ltot * (fr[k + 1] - fr[k]), c, s, sMid, A: p.A, I: p.Iz });
        }
    });
    // Reverse Cuthill–McKee renumbering: narrow band for branched frames
    // (interior columns of multi-span frames)
    const perm = rcmOrder(nodeXY.length, elements.map(e => [e.n1, e.n2] as [number, number]));
    const newOf = new Array<number>(nodeXY.length);
    perm.forEach((old, nw) => { newOf[old] = nw; });
    const xy = perm.map(old => nodeXY[old]);
    nodeXY.length = 0; nodeXY.push(...xy);
    for (let m = 0; m < mainNode.length; m++) if (mainNode[m] >= 0) mainNode[m] = newOf[mainNode[m]];
    memberNodes.forEach(list => list.forEach((v, k) => { list[k] = newOf[v]; }));
    for (const e of elements) { e.n1 = newOf[e.n1]; e.n2 = newOf[e.n2]; }
    const ndof = nodeXY.length * 3;
    let hb = 0;
    for (const e of elements) hb = Math.max(hb, Math.abs(e.n1 - e.n2) * 3 + 2);
    const fixed = new Array(ndof).fill(false);
    for (const sp of model.supports) {
        const n = mainNode[sp.node];
        if (sp.ux) fixed[3 * n] = true;
        if (sp.uy) fixed[3 * n + 1] = true;
        if (sp.rz) fixed[3 * n + 2] = true;
    }
    return { nodeXY, mainNode, memberNodes, memberFr, elements, ndof, hb, fixed };
}

// local stiffness (kN, m) — E in MPa, A mm², I mm⁴
function kLocal(e: Element, E: number, fA: number, fI: number): number[][] {
    const EA = E * e.A * 1e-3 * fA, EI = E * e.I * 1e-9 * fI, L = e.L;
    const a = EA / L, b = 12 * EI / L ** 3, c = 6 * EI / L ** 2, d = 4 * EI / L, f = 2 * EI / L;
    return [
        [a, 0, 0, -a, 0, 0],
        [0, b, c, 0, -b, c],
        [0, c, d, 0, -c, f],
        [-a, 0, 0, a, 0, 0],
        [0, -b, -c, 0, b, -c],
        [0, c, f, 0, -c, d],
    ];
}

// consistent geometric stiffness, N tension positive (kN)
function kgLocal(L: number, N: number): number[][] {
    const q = N / L;
    return [
        [0, 0, 0, 0, 0, 0],
        [0, q * 6 / 5, q * L / 10, 0, -q * 6 / 5, q * L / 10],
        [0, q * L / 10, q * 2 * L * L / 15, 0, -q * L / 10, -q * L * L / 30],
        [0, 0, 0, 0, 0, 0],
        [0, -q * 6 / 5, -q * L / 10, 0, q * 6 / 5, -q * L / 10],
        [0, q * L / 10, -q * L * L / 30, 0, -q * L / 10, q * 2 * L * L / 15],
    ];
}

const toGlobal = (e: Element, kl: number[][]): number[][] => {
    const { c, s } = e;
    const T = [
        [c, s, 0, 0, 0, 0], [-s, c, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0],
        [0, 0, 0, c, s, 0], [0, 0, 0, -s, c, 0], [0, 0, 0, 0, 0, 1],
    ];
    const kg: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0));
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
        let v = 0;
        for (let p = 0; p < 6; p++) {
            if (T[p][i] === 0) continue;
            for (let q = 0; q < 6; q++) if (T[q][j] !== 0) v += T[p][i] * kl[p][q] * T[q][j];
        }
        kg[i][j] = v;
    }
    return kg;
};

const dofs = (e: Element) => [3 * e.n1, 3 * e.n1 + 1, 3 * e.n1 + 2, 3 * e.n2, 3 * e.n2 + 1, 3 * e.n2 + 2];

type Stiff = { a: number; i: number }[];

// Element matrices in global axes, computed once per mesh: axial part (per
// unit EA factor), bending part (per unit EI factor) and geometric stiffness
// per unit axial force. Assembly is then a scaled sum.
interface ElementMats { KA: number[][]; KB: number[][]; G: number[][] }
const matCache = new WeakMap<FEModel, { E: number; mats: ElementMats[] }>();

function elementMats(fe: FEModel, E: number): ElementMats[] {
    const hit = matCache.get(fe);
    if (hit && hit.E === E) return hit.mats;
    const mats = fe.elements.map(e => {
        const full = kLocal(e, E, 1, 1);
        const axialOnly = kLocal(e, E, 1, 0);
        const bend = full.map((row, i) => row.map((v, j) => v - axialOnly[i][j]));
        return { KA: toGlobal(e, axialOnly), KB: toGlobal(e, bend), G: toGlobal(e, kgLocal(e.L, 1)) };
    });
    matCache.set(fe, { E, mats });
    return mats;
}

function assemble(fe: FEModel, E: number, stiff: Stiff, axial: number[] | null, lambda = 1): BandMatrix {
    const K = new BandMatrix(fe.ndof, fe.hb);
    const mats = elementMats(fe, E);
    fe.elements.forEach((e, idx) => {
        const { KA, KB, G } = mats[idx];
        const fa = stiff[idx].a, fi = stiff[idx].i, g = axial ? lambda * axial[idx] : 0;
        const d = dofs(e);
        for (let i = 0; i < 6; i++) {
            const I = d[i];
            if (fe.fixed[I]) continue;
            for (let j = 0; j <= i; j++) {
                const J = d[j];
                if (fe.fixed[J]) continue;
                K.add(I, J, fa * KA[i][j] + fi * KB[i][j] + g * G[i][j]);
            }
        }
    });
    for (let i = 0; i < fe.ndof; i++) if (fe.fixed[i]) K.add(i, i, 1);
    return K;
}

// ═══════════════════════════════════════════════════════════════
//  Loads
// ═══════════════════════════════════════════════════════════════
interface ElementLoad { wx: number; wy: number }   // global kN/m on each element

interface FactoredLoads { F: Float64Array; elemLoads: ElementLoad[]; totalGravity: number }

function combineLoads(model: StructureModel, fe: FEModel, combo: ComboDef): FactoredLoads {
    const F = new Float64Array(fe.ndof);
    const elemLoads: ElementLoad[] = fe.elements.map(() => ({ wx: 0, wy: 0 }));
    let totalGravity = 0;
    for (const [lc, factor] of Object.entries(combo.factors)) {
        const def = model.loadCases[lc];
        if (!def || !factor) continue;
        for (const ml of def.memberLoads) {
            fe.elements.forEach((e, idx) => {
                if (e.member !== ml.member) return;
                elemLoads[idx].wx += factor * ml.wx;
                elemLoads[idx].wy += factor * ml.wy;
            });
        }
        if (lc === 'D') {
            fe.elements.forEach((e, idx) => { elemLoads[idx].wy -= factor * e.A * 1e-6 * STEEL_UNIT_WEIGHT; });
        }
        const point = (n: number, fx: number, fy: number, mz: number) => {
            F[3 * n] += factor * fx;
            F[3 * n + 1] += factor * fy;
            F[3 * n + 2] += factor * mz;
            totalGravity += -factor * fy;
        };
        for (const nl of def.nodalLoads) point(fe.mainNode[nl.node], nl.fx, nl.fy, nl.mz);
        for (const pl of def.pointLoads ?? []) {
            const q = fe.memberFr[pl.member].findIndex(f => Math.abs(f - pl.at) < 1e-6);
            if (q < 0) throw new Error(`point load at ${pl.at} is not a node of member ${pl.member}`);
            point(fe.memberNodes[pl.member][q], pl.fx, pl.fy, pl.mz);
        }
    }
    fe.elements.forEach((e, idx) => {
        const { wx, wy } = elemLoads[idx];
        totalGravity += -wy * e.L;
        const f = equivalentNodal(e, wx, wy);
        const d = dofs(e);
        for (let i = 0; i < 6; i++) F[d[i]] += f[i];
    });
    for (let i = 0; i < fe.ndof; i++) if (fe.fixed[i]) F[i] = 0;
    return { F, elemLoads, totalGravity };
}

/** Consistent nodal loads (global) of a uniform load wx, wy (kN/m). */
function equivalentNodal(e: Element, wx: number, wy: number): number[] {
    const { c, s, L } = e;
    const qa = wx * c + wy * s, qt = -wx * s + wy * c;           // local
    const fl = [qa * L / 2, qt * L / 2, qt * L * L / 12, qa * L / 2, qt * L / 2, -qt * L * L / 12];
    return [
        c * fl[0] - s * fl[1], s * fl[0] + c * fl[1], fl[2],
        c * fl[3] - s * fl[4], s * fl[3] + c * fl[4], fl[5],
    ];
}

// ═══════════════════════════════════════════════════════════════
//  Solution
// ═══════════════════════════════════════════════════════════════
export interface ElementForces { N1: number; V1: number; M1: number; N2: number; V2: number; M2: number }  // kN, kN·m, tension +

interface Solution {
    u: Float64Array;
    forces: ElementForces[];
    axial: number[];             // mean axial force per element (kN, tension +)
    stable: boolean;
    iterations: number;
}

function elementForces(fe: FEModel, E: number, stiff: Stiff, u: Float64Array, loads: ElementLoad[], axial: number[] | null): { forces: ElementForces[]; axial: number[] } {
    const forces: ElementForces[] = [];
    const ax: number[] = [];
    fe.elements.forEach((e, idx) => {
        const d = dofs(e);
        const { c, s } = e;
        const ug = d.map(i => u[i]);
        const ul = [c * ug[0] + s * ug[1], -s * ug[0] + c * ug[1], ug[2], c * ug[3] + s * ug[4], -s * ug[3] + c * ug[4], ug[5]];
        const kl = kLocal(e, E, stiff[idx].a, stiff[idx].i);
        if (axial) {
            const g = kgLocal(e.L, axial[idx]);
            for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) kl[i][j] += g[i][j];
        }
        const { wx, wy } = loads[idx];
        const qa = wx * c + wy * s, qt = -wx * s + wy * c, L = e.L;
        const feq = [qa * L / 2, qt * L / 2, qt * L * L / 12, qa * L / 2, qt * L / 2, -qt * L * L / 12];
        const f = kl.map((row, i) => row.reduce((acc, v, j) => acc + v * ul[j], 0) - feq[i]);
        // internal actions: N tension +, V, M (sagging about local z with the i→j axis)
        forces.push({ N1: -f[0], V1: f[1], M1: -f[2], N2: f[3], V2: -f[4], M2: f[5] });
        ax.push(0.5 * (-f[0] + f[3]));
    });
    return { forces, axial: ax };
}

function solve(fe: FEModel, E: number, stiff: Stiff, loads: FactoredLoads, secondOrder: boolean): Solution {
    let axial: number[] | null = null;
    let u: Float64Array = new Float64Array(fe.ndof);
    let res = { forces: [] as ElementForces[], axial: [] as number[] };
    const maxIt = secondOrder ? 30 : 1;
    let it = 0;
    for (; it < maxIt; it++) {
        const K = assemble(fe, E, stiff, axial);
        const f = ldl(K);
        if (f.neg > 0 || f.singular) return { u, forces: res.forces, axial: res.axial, stable: false, iterations: it };
        u = ldlSolve(f, loads.F);
        const prev = axial;
        res = elementForces(fe, E, stiff, u, loads.elemLoads, axial);
        axial = res.axial;
        if (!secondOrder) break;
        if (prev) {
            const scale = Math.max(1, ...axial.map(Math.abs));
            const change = Math.max(...axial.map((v, i) => Math.abs(v - prev[i])));
            if (change < 1e-5 * scale) break;
        }
    }
    return { u, forces: res.forces, axial: res.axial, stable: true, iterations: it + 1 };
}

/**
 * Smallest λ > 0 with K + λ·KG(axial) singular. Inverse iteration with a
 * Rayleigh quotient gives the estimate; two Sturm counts confirm that no
 * buckling mode lies below it (0.1 %). Otherwise: Sturm-count bisection.
 */
function bucklingFactor(fe: FEModel, E: number, stiff: Stiff, axial: number[]): number {
    if (!axial.some(a => a < -1e-9)) return Infinity;
    const count = (lam: number) => ldl(assemble(fe, E, stiff, axial, lam)).neg;
    const tol = 1e-3;
    const K = assemble(fe, E, stiff, null);
    const fK = ldl(K);
    if (fK.neg === 0 && !fK.singular) {
        const G = assemble(fe, E, stiff.map(() => ({ a: 0, i: 0 })), axial, 1);
        const n = fe.ndof;
        const mv = (M: BandMatrix, x: Float64Array) => {
            const y = new Float64Array(n), w = M.hb + 1;
            for (let i = 0; i < n; i++) {
                if (fe.fixed[i]) continue;
                for (let k = 0; k <= Math.min(M.hb, i); k++) {
                    const j = i - k;
                    if (fe.fixed[j]) continue;
                    const v = M.a[i * w + k];
                    y[i] += v * x[j];
                    if (k > 0) y[j] += v * x[i];
                }
            }
            return y;
        };
        const dot = (p: Float64Array, q: Float64Array) => { let t = 0; for (let i = 0; i < n; i++) t += p[i] * q[i]; return t; };
        let x: Float64Array = new Float64Array(n);
        for (let i = 0; i < n; i++) x[i] = fe.fixed[i] ? 0 : 1 + 0.37 * Math.sin(i);
        let lam = NaN;
        for (let it = 0; it < 40; it++) {
            const g = mv(G, x);
            for (let i = 0; i < n; i++) g[i] = fe.fixed[i] ? 0 : -g[i];
            const y = ldlSolve(fK, g);
            for (let i = 0; i < n; i++) if (fe.fixed[i]) y[i] = 0;
            const Ky = mv(K, y), Gy = mv(G, y);
            const den = -dot(y, Gy);
            const prev = lam;
            lam = den !== 0 ? dot(y, Ky) / den : NaN;
            const nrm = Math.sqrt(dot(y, y)) || 1;
            for (let i = 0; i < n; i++) y[i] /= nrm;
            x = y;
            if (it > 2 && Number.isFinite(lam) && Math.abs(lam - prev) < 1e-5 * Math.abs(lam)) break;
        }
        if (Number.isFinite(lam) && lam > 0 && count(lam * (1 - tol)) === 0 && count(lam * (1 + tol)) > 0) return lam;
    }
    let lo = 0, hi = 1;
    while (count(hi) === 0) { hi *= 2; if (hi > 1e6) return Infinity; }
    for (let k = 0; k < 40 && (hi - lo) > tol * hi; k++) {           // 0.1 % on the load factor
        const mid = 0.5 * (lo + hi);
        if (count(mid) > 0) hi = mid; else lo = mid;
    }
    return 0.5 * (lo + hi);
}

const nominal = (fe: FEModel): Stiff => fe.elements.map(() => ({ a: 1, i: 1 }));

/** Elastic buckling load (kN) of a tapered member pinned at both ends (K = 1). */
function memberPinnedBuckling(mem: MemberDef, L: number, E: number, nSub = 16): number {
    const model: StructureModel = {
        code: 'AISC360', fy: 0, nodes: [{ x: 0, y: 0 }, { x: L, y: 0 }],
        members: [{ ...mem, i: 0, j: 1 }],
        supports: [{ node: 0, ux: true, uy: true, rz: false }, { node: 1, ux: false, uy: true, rz: false }],
        loadCases: {}, combos: [], notionalNodes: [], deflections: [], nSub,
    };
    const fe = buildFE(model);
    return bucklingFactor(fe, E, nominal(fe), fe.elements.map(() => -1));
}

// ═══════════════════════════════════════════════════════════════
//  Design
// ═══════════════════════════════════════════════════════════════
export interface StationResult {
    s: number;                  // geometric fraction along the member (i → j)
    x: number; y: number;       // global position (m)
    D: number;                  // depth (mm)
    N: number; V: number; M: number;   // kN, kN, kN·m (governing combination)
    util: number;
    combo: string;
    governing: string;
}

export interface MemberResult {
    name: string;
    group: string;
    length: number;
    mass: number;
    stations: StationResult[];          // envelope over the strength combinations
    maxUtil: number;
    governing: { combo: string; s: number; check: string; detail: ISStationResult | AISCStationResult | null; section: SectionProps | null };
    segments: { from: number; to: number; minDepth: number; Cb?: number; CmLT?: number; chiLT?: number; FnLTB?: number }[];
    PeIn?: number;                      // AISC: pinned-pinned member buckling load (kN)
}

export interface ComboResult {
    name: string;
    kind: 'strength' | 'service';
    stable: boolean;
    gammaE: number;                     // elastic buckling load factor (first-order axial forces)
    ampRatio: number;                   // Δ2nd / Δ1st (max horizontal node displacement)
    maxUtil: number;                    // strength: largest station utilization (99 if unstable); service: 0
    notional: boolean;
    reactions: { node: number; Rx: number; Ry: number; Mz: number }[];
    members: { name: string; s: number[]; N: number[]; V: number[]; M: number[] }[];
    maxDisp: { ux: number; uy: number };
}

export interface DeflectionResult { name: string; combo: string; value: number; limit: number; ratio: number }

export interface DesignResult {
    code: SteelCode;
    ok: boolean;
    maxUtil: number;
    mass: number;                        // kg
    members: MemberResult[];
    groups: { group: string; maxUtil: number; member: string; mass: number }[];
    combos: ComboResult[];
    deflections: DeflectionResult[];
    warnings: string[];
    geometry: { nodes: { x: number; y: number }[]; members: { name: string; i: number; j: number }[] };
}

const interp = (xs: number[], ys: number[], x: number) => {
    for (let k = 0; k < xs.length - 1; k++) {
        if (x <= xs[k + 1] + 1e-12) {
            const r = (x - xs[k]) / Math.max(1e-12, xs[k + 1] - xs[k]);
            return ys[k] + (ys[k + 1] - ys[k]) * r;
        }
    }
    return ys[ys.length - 1];
};

/**
 * opts.only: run only these strength combinations, in this order (service
 * combinations first) — optimizer screening; opts.stopAbove: stop as soon as
 * a utilization or deflection ratio exceeds it (the result is then partial).
 */
export function designStructure(model: StructureModel, opts: { detail?: boolean; only?: string[]; stopAbove?: number } = {}): DesignResult {
    const { code, fy } = model;
    const E = code === 'IS800' ? IS800.E : AISC.E;
    const fe = buildFE(model);
    const warnings: string[] = [];
    const memberLen = model.members.map(m => Math.hypot(model.nodes[m.j].x - model.nodes[m.i].x, model.nodes[m.j].y - model.nodes[m.i].y));
    const secAt = (mi: number, s: number) => memberSectionAt(model.members[mi].section, model.members[mi].reverse ? 1 - s : s);

    // AISC: pinned-pinned elastic buckling of each member (K = 1)
    const peCache = new Map<string, number>();
    const PeIn = model.members.map((m, mi) => {
        if (code !== 'AISC360') return Infinity;
        const k = JSON.stringify([m.section, m.reverse ? 1 : 0, memberLen[mi].toFixed(6)]);
        const kr = JSON.stringify([m.section, m.reverse ? 0 : 1, memberLen[mi].toFixed(6)]);   // mirror has the same Pe
        const hit = peCache.get(k) ?? peCache.get(kr);
        if (hit !== undefined) return hit;
        const v = memberPinnedBuckling(m, memberLen[mi], E);
        peCache.set(k, v);
        return v;
    });

    // Unbraced segments (out-of-plane / LTB) and their critical sections
    const segDefs = model.members.map((m, mi) => {
        const n = Math.max(1, Math.ceil(memberLen[mi] / Math.max(0.1, m.Ly) - 1e-9));
        return Array.from({ length: n }, (_, k) => {
            const from = k / n, to = (k + 1) / n;
            let pMin = secAt(mi, from);
            for (let q = 1; q <= 8; q++) {
                const p = secAt(mi, from + (to - from) * q / 8);
                if (p.D < pMin.D) pMin = p;
            }
            return { from, to, pMin, Lseg: memberLen[mi] / n };
        });
    });

    // Stations: every FE node of the member; at a break point both sides of
    // the node (actions jump under a concentrated load or moment).
    // Each station reads element `el` at end 1 (start) or 2 (end).
    const stationDefs = model.members.map((m, mi) => {
        const fr = fe.memberFr[mi];
        const els = fe.elements.map((e, idx) => ({ e, idx })).filter(o => o.e.member === mi).map(o => o.idx);
        const isBreak = (f: number) => (m.breaks ?? []).some(b => Math.abs(b - f) < 1e-6);
        const out: { s: number; node: number; el: number; end: 1 | 2 }[] = [{ s: 0, node: fe.memberNodes[mi][0], el: els[0], end: 1 }];
        for (let k = 1; k < fr.length; k++) {
            out.push({ s: fr[k], node: fe.memberNodes[mi][k], el: els[k - 1], end: 2 });
            if (k < fr.length - 1 && isBreak(fr[k])) out.push({ s: fr[k], node: fe.memberNodes[mi][k], el: els[k], end: 1 });
        }
        return out;
    });
    const env: StationResult[][] = model.members.map((m, mi) => stationDefs[mi].map(({ s, node }) =>
        ({ s, x: fe.nodeXY[node].x, y: fe.nodeXY[node].y, D: secAt(mi, s).D, N: 0, V: 0, M: 0, util: 0, combo: '', governing: '' })));
    const gov = model.members.map(() => ({ util: -1, combo: '', s: 0, check: '', detail: null as ISStationResult | AISCStationResult | null, section: null as SectionProps | null }));
    // per member: segment data of each strength combination (reported for the governing one)
    const segByCombo: Record<string, MemberResult['segments']>[] = model.members.map(() => ({}));
    const combos: ComboResult[] = [];
    const deflections: DeflectionResult[] = [];

    const comboOrder = opts.only
        ? [...model.combos.filter(c => c.kind === 'service'),
            ...opts.only.map(nm => model.combos.find(c => c.name === nm && c.kind === 'strength')).filter((c): c is ComboDef => !!c)]
        : model.combos;
    for (const combo of comboOrder) {
        if (opts.stopAbove !== undefined
            && (gov.some(g => g.util > opts.stopAbove!) || deflections.some(dr => dr.ratio > opts.stopAbove!))) break;
        const strength = combo.kind === 'strength';
        let comboMax = 0;
        // AISC direct analysis (strength): 0.8·EA and 0.8·τb·EI; otherwise nominal
        let stiff: Stiff = fe.elements.map(() => (strength && code === 'AISC360' ? { a: 0.8, i: 0.8 } : { a: 1, i: 1 }));
        const loads = combineLoads(model, fe, combo);
        const notionalRatio = code === 'IS800' ? 0.005 : 0.002;
        // First-order solution without notional loads; its sway at the notional
        // nodes sets their direction (IS 800 Cl. 4.3.6 / AISC C2.2b: in the
        // direction that adds to the sway). Symmetric frame under gravity
        // (no sway): +x.
        const base = solve(fe, E, stiff, loads, false);
        const sway = model.notionalNodes.reduce((a, mn) => a + base.u[3 * fe.mainNode[mn]], 0);
        const notionalDir = sway < -1e-9 ? -1 : 1;
        const addNotional = (L: FactoredLoads) => {
            const F = new Float64Array(L.F);
            const nodes = model.notionalNodes;
            for (const mn of nodes) F[3 * fe.mainNode[mn]] += notionalDir * notionalRatio * L.totalGravity / nodes.length;
            return { ...L, F };
        };
        let useNotional = strength && combo.gravityOnly && model.notionalNodes.length > 0;
        let sol = solve(fe, E, stiff, useNotional ? addNotional(loads) : loads, strength);
        const first = useNotional ? solve(fe, E, stiff, addNotional(loads), false) : base;
        const maxUx = (u: Float64Array) => Math.max(...Array.from({ length: fe.nodeXY.length }, (_, n) => Math.abs(u[3 * n])));
        let ampRatio = maxUx(first.u) > 1e-12 ? maxUx(sol.u) / maxUx(first.u) : 1;
        if (strength && code === 'AISC360' && !useNotional && ampRatio > 1.7 && model.notionalNodes.length > 0) {
            useNotional = true;                                         // C2.2b(4)
            sol = solve(fe, E, stiff, addNotional(loads), true);
        }
        if (strength && code === 'AISC360' && sol.stable) {
            // τb (C2.3): αPr/Pns > 0.5 → τb = 4(αPr/Pns)(1 − αPr/Pns)
            let changed = false;
            stiff = fe.elements.map((e, idx) => {
                const r = Math.max(0, -sol.axial[idx]) * 1e3 / (fy * e.A);
                const tb = r > 0.5 ? 4 * r * (1 - r) : 1;
                if (tb < 1) changed = true;
                return { a: 0.8, i: 0.8 * Math.max(0.05, tb) };
            });
            if (changed) sol = solve(fe, E, stiff, useNotional ? addNotional(loads) : loads, true);
        }
        const gammaE = strength ? bucklingFactor(fe, E, nominal(fe), first.axial) : Infinity;
        if (strength && sol.stable && first.u.some(v => v !== 0)) {
            ampRatio = maxUx(first.u) > 1e-12 ? maxUx(sol.u) / maxUx(first.u) : 1;
        }

        // Member actions at stations
        const memActs = model.members.map((m, mi) => {
            const N: number[] = [], V: number[] = [], M: number[] = [];
            for (const st of stationDefs[mi]) {
                const f = sol.forces[st.el];
                if (!f) { N.push(0); V.push(0); M.push(0); continue; }
                if (st.end === 1) { N.push(f.N1); V.push(f.V1); M.push(f.M1); } else { N.push(f.N2); V.push(f.V2); M.push(f.M2); }
            }
            return { name: m.name, s: stationDefs[mi].map(st => st.s), N, V, M };
        });

        const reactions = model.supports.map(sp => {
            // reaction = Σ element end forces at the node − applied nodal load
            const n = fe.mainNode[sp.node];
            let Rx = 0, Ry = 0, Mz = 0;
            fe.elements.forEach((e, idx) => {
                const f = sol.forces[idx];
                if (!f) return;
                const { c, s } = e;
                if (e.n1 === n) {
                    const fx = -f.N1, fy = f.V1;
                    Rx += c * fx - s * fy; Ry += s * fx + c * fy; Mz += -f.M1;
                } else if (e.n2 === n) {
                    const fx = f.N2, fy = -f.V2;
                    Rx += c * fx - s * fy; Ry += s * fx + c * fy; Mz += f.M2;
                }
            });
            return { node: sp.node, Rx, Ry, Mz };
        });

        combos.push({
            name: combo.name, kind: combo.kind, stable: sol.stable, gammaE, ampRatio, maxUtil: 0, notional: useNotional, reactions,
            members: memActs,
            maxDisp: {
                ux: Math.max(...Array.from({ length: fe.nodeXY.length }, (_, n) => Math.abs(sol.u[3 * n]))) * 1000,
                uy: Math.max(...Array.from({ length: fe.nodeXY.length }, (_, n) => Math.abs(sol.u[3 * n + 1]))) * 1000,
            },
        });

        if (!strength) {
            for (const dc of model.deflections) {
                if (!dc.combos.includes(combo.name)) continue;
                const value = dc.evaluate(sol.u, fe);
                deflections.push({ name: dc.name, combo: combo.name, value, limit: dc.limit, ratio: value / dc.limit });
            }
            continue;
        }
        if (!sol.stable) {
            warnings.push(`${combo.name}: frame unstable under the factored loads (second-order analysis)`);
            model.members.forEach((m, mi) => { if (gov[mi].util < 99) { gov[mi] = { ...gov[mi], util: 99, combo: combo.name, check: 'instability' }; } });
            combos[combos.length - 1].maxUtil = 99;
            continue;
        }

        // Station design
        model.members.forEach((m, mi) => {
            const act = memActs[mi];
            const segs = segDefs[mi];
            segs.forEach((sg) => {
                const Mabs = (s: number) => Math.abs(interp(act.s, act.M, s)) * 1e6;   // N·mm
                const q = (r: number) => Mabs(sg.from + (sg.to - sg.from) * r);
                const Mmax = Math.max(...Array.from({ length: 9 }, (_, t) => q(t / 8)));
                // equivalent moment factors of the segment
                const Mi = interp(act.s, act.M, sg.from), Mj = interp(act.s, act.M, sg.to);
                const big = Math.abs(Mi) >= Math.abs(Mj) ? Mi : Mj, small = big === Mi ? Mj : Mi;
                const psi = Math.abs(big) > 1e-9 ? small / big : 1;
                const interiorPeak = Mmax > 1.001 * Math.max(Math.abs(Mi), Math.abs(Mj)) * 1e6;
                const CmLT = interiorPeak ? 1.0 : Math.max(0.4, 0.6 + 0.4 * psi);
                const Cb = cbAISC(Mmax, q(0.25), q(0.5), q(0.75));
                let chiLT = 1, lambdaLT = 0, FnLTB = fy;
                if (code === 'IS800') {
                    const l = ltbIS(sg.pMin, fy, sg.Lseg * 1000);
                    chiLT = l.chiLT; lambdaLT = l.lambdaLT;
                } else {
                    FnLTB = ltbStressAISC(sg.pMin, fy, sg.Lseg * 1000, Cb).Fn;
                }
                (segByCombo[mi][combo.name] ??= []).push(code === 'IS800'
                    ? { from: sg.from, to: sg.to, minDepth: sg.pMin.D, chiLT, CmLT }
                    : { from: sg.from, to: sg.to, minDepth: sg.pMin.D, Cb, FnLTB });
                const PeY = Math.PI ** 2 * E * sg.pMin.Iy / (sg.Lseg * 1000) ** 2;     // N
                act.s.forEach((s, k) => {
                    if (s < sg.from - 1e-9 || s > sg.to + 1e-9) return;
                    const p = secAt(mi, s);
                    const N = act.N[k] * 1e3, V = Math.abs(act.V[k]) * 1e3, M = Math.abs(act.M[k]) * 1e6;
                    let util: number, gname: string, detail: ISStationResult | AISCStationResult;
                    if (code === 'IS800') {
                        const fccZ = N < 0 && Number.isFinite(gammaE) ? gammaE * (-N) / p.A : Infinity;
                        const r = checkStationIS(p, fy, {
                            N, M, V, fccZ, fccY: PeY / p.A, chiLT, lambdaLT, CmLT,
                            Cmz: m.sway ? 0.9 : Math.max(0.4, 0.6 + 0.4 * psi),
                        });
                        util = r.max; gname = r.governing; detail = r;
                    } else {
                        const r = checkStationAISC(p, fy, { N, M, V, FeIn: PeIn[mi] * 1e3 / p.A, FeOut: PeY / p.A, FnLTB });
                        util = r.max; gname = r.governing; detail = r;
                    }
                    const st = env[mi][k];
                    if (util > comboMax) comboMax = util;
                    if (util > st.util) {
                        env[mi][k] = { ...st, N: act.N[k], V: act.V[k], M: act.M[k], util, combo: combo.name, governing: gname };
                    }
                    if (util > gov[mi].util) {
                        gov[mi] = { util, combo: combo.name, s, check: gname, detail: opts.detail === false ? null : detail, section: p };
                    }
                });
            });
        });
        combos[combos.length - 1].maxUtil = comboMax;
    }

    const members: MemberResult[] = model.members.map((m, mi) => ({
        name: m.name, group: m.group, length: memberLen[mi], mass: memberMass(m.section, memberLen[mi]),
        stations: env[mi], maxUtil: gov[mi].util,
        governing: { combo: gov[mi].combo, s: gov[mi].s, check: gov[mi].check, detail: gov[mi].detail, section: gov[mi].section },
        segments: segByCombo[mi][gov[mi].combo] ?? segDefs[mi].map(sg => ({ from: sg.from, to: sg.to, minDepth: sg.pMin.D })),
        PeIn: code === 'AISC360' ? PeIn[mi] : undefined,
    }));
    const groupNames = [...new Set(model.members.map(m => m.group))];
    const groups = groupNames.map(g => {
        const ms = members.filter(m => m.group === g);
        const worst = ms.reduce((a, b) => (b.maxUtil > a.maxUtil ? b : a));
        return { group: g, maxUtil: worst.maxUtil, member: worst.name, mass: ms.reduce((s, m) => s + m.mass, 0) };
    });
    const maxUtil = Math.max(...members.map(m => m.maxUtil), ...deflections.map(d => d.ratio));
    const mass = members.reduce((s, m) => s + m.mass, 0);
    return {
        code, ok: maxUtil <= 1 + 1e-9 && combos.every(c => c.stable), maxUtil, mass, members, groups, combos, deflections, warnings,
        geometry: { nodes: model.nodes, members: model.members.map(m => ({ name: m.name, i: m.i, j: m.j })) },
    };
}

// ═══════════════════════════════════════════════════════════════
//  Load combinations
// ═══════════════════════════════════════════════════════════════
export function strengthCombos(code: SteelCode, windCases: string[], hasLive = true): ComboDef[] {
    const c: ComboDef[] = [];
    const L: Record<string, number> = hasLive ? { L: 1 } : {};
    const scale = (f: Record<string, number>, k: number) => Object.fromEntries(Object.entries(f).map(([a, b]) => [a, b * k]));
    if (code === 'IS800') {
        // IS 800:2007 Table 4
        c.push({ name: hasLive ? '1.5(D+L)' : '1.5D', factors: { D: 1.5, ...scale(L, 1.5) }, kind: 'strength', gravityOnly: true });
        for (const w of windCases) {
            if (hasLive) c.push({ name: `1.2(D+L+${w})`, factors: { D: 1.2, L: 1.2, [w]: 1.2 }, kind: 'strength', gravityOnly: false });
            c.push({ name: `1.5(D+${w})`, factors: { D: 1.5, [w]: 1.5 }, kind: 'strength', gravityOnly: false });
            c.push({ name: `0.9D+1.5${w}`, factors: { D: 0.9, [w]: 1.5 }, kind: 'strength', gravityOnly: false });
        }
    } else {
        // ASCE 7-22 §2.3.1 (L = roof live load Lr)
        c.push({ name: '1.4D', factors: { D: 1.4 }, kind: 'strength', gravityOnly: true });
        if (hasLive) c.push({ name: '1.2D+1.6Lr', factors: { D: 1.2, L: 1.6 }, kind: 'strength', gravityOnly: true });
        for (const w of windCases) {
            if (hasLive) c.push({ name: `1.2D+1.6Lr+0.5${w}`, factors: { D: 1.2, L: 1.6, [w]: 0.5 }, kind: 'strength', gravityOnly: false });
            c.push({ name: `1.2D+1.0${w}${hasLive ? '+0.5Lr' : ''}`, factors: { D: 1.2, [w]: 1.0, ...scale(L, 0.5) }, kind: 'strength', gravityOnly: false });
            c.push({ name: `0.9D+1.0${w}`, factors: { D: 0.9, [w]: 1.0 }, kind: 'strength', gravityOnly: false });
        }
    }
    return c;
}

// ═══════════════════════════════════════════════════════════════
//  Portal frame
// ═══════════════════════════════════════════════════════════════
export interface WindCoefficients { windwardWall: number; leewardWall: number; windwardRoof: number; leewardRoof: number }

/**
 * Overhead travelling crane on brackets of the two columns of one span.
 * Wheel loads → column reactions: two wheels per end carriage (wheel base
 * w), runway girders simply supported between frames at spacing B; the
 * maximum column reaction has one wheel over the frame:
 *   k = 1 + (B − w)/B  (w < B), else 1.
 * Vertical impact and lateral surge as fractions (IS 875-2 Cl. 6.3 Table 3;
 * ASCE 7-22 §4.9.3 / §4.9.4); longitudinal surge acts out of the frame plane
 * and is not part of this 2D analysis.
 */
export interface CraneInput {
    span: number;               // crane span index (0 = first span from the left)
    capacity: number;           // kN — rated capacity (lifted load)
    crabWeight: number;         // kN — crab / trolley and hoist
    bridgeWeight: number;       // kN — bridge girders and end carriages
    hookApproach: number;       // m — minimum distance from the rail to the hook (crab centre)
    wheelBase: number;          // m — wheel spacing on each end carriage (2 wheels per rail)
    eccentricity: number;       // m — runway girder centreline from the column centreline (toward the crane)
    bracketLevel: number;       // m — level of the bracket seat (vertical load)
    railLevel: number;          // m — top of rail (lateral surge)
    impact: number;             // vertical impact, fraction of the wheel loads
    surge: number;              // lateral surge, fraction of (capacity + crab), shared equally by the two rails
    girderWeight: number;       // kN/m — runway girder + rail (dead load)
    lateralLimit: number;       // rail-level lateral deflection limit: height / this
    spreadLimit: number;        // mm — change of the rail gauge
}

export interface CraneReactions {
    craneSpan: number;          // m — rail centres
    Pmax: number; Pmin: number; // kN per wheel, static
    k: number;                  // wheel-pair influence factor on the column reaction
    Rmax: number; Rmin: number; // kN on the column, static (no impact)
    H: number;                  // kN surge on each column
    Rg: number;                 // kN runway girder dead load on each column
}

export function craneReactions(c: CraneInput, frameSpan: number, frameSpacing: number): CraneReactions {
    const Lc = frameSpan - 2 * c.eccentricity;
    if (!(Lc > 0)) throw new Error('Crane span (frame span − 2 × eccentricity) must be positive');
    const a = Math.min(Math.max(0, c.hookApproach), Lc / 2);
    const W = c.capacity + c.crabWeight;
    const Pmax = (c.bridgeWeight / 2 + W * (Lc - a) / Lc) / 2;
    const Pmin = (c.bridgeWeight / 2 + W * a / Lc) / 2;
    const B = frameSpacing;
    const k = c.wheelBase < B ? 1 + (B - c.wheelBase) / B : 1;
    return {
        craneSpan: Lc, Pmax, Pmin, k, Rmax: Pmax * k, Rmin: Pmin * k,
        H: c.surge * W / 4 * k, Rg: c.girderWeight * B,
    };
}

export interface PortalFrameInput {
    code: SteelCode;
    fy: number;                 // MPa
    span: number;               // m, column centre lines
    eaveHeight: number;         // m — left eave
    roofSlope: number;          // degrees — left rafter
    eaveHeightR?: number;       // m — right eave (default: eaveHeight)
    roofSlopeR?: number;        // degrees — right rafter (default: roofSlope)
    baySpacing: number;         // m
    base: 'pinned' | 'fixed';
    column: MemberSection;      // profile: base (0) → eave (1)
    rafter: MemberSection;      // profile: eave (0) → apex (1)
    dead: number;               // kN/m² on the roof slope (sheeting, purlins, services, collateral)
    live: number;               // kN/m² on plan (roof live load)
    windPressure: number;       // kN/m² — IS 875-3: pd; ASCE 7-22: qh·Kd
    cpe: WindCoefficients;      // Cpe or GCp, wind from the left (windward = left wall / left rafter)
    cpeRight?: WindCoefficients; // wind from the right (windward = right wall / right rafter); default: cpe
    // 'auto': wind from the right as well whenever the frame or its loads are unsymmetric
    windDirections?: 'auto' | 'left' | 'both';
    cpi: number[];              // internal pressure coefficients (e.g. +0.2, −0.2)
    columnLy: number;           // m — flange-brace spacing on the columns
    rafterLy: number;           // m — flange-brace spacing on the rafters
    verticalLimit: number;      // span / this (rafter, live load)
    lateralLimit: number;       // height / this (eave, wind)
    windServiceFactor: number;  // wind factor for the drift check
    crane?: CraneInput | null;
    nSub?: number;
}

/** Multi-span (multi-gable) frame: n duo-pitch spans on n + 1 columns. */
export interface MultiSpanFrameInput {
    code: SteelCode;
    fy: number;
    spans: { span: number; slopeL: number; slopeR: number }[];   // m, degrees — left to right
    heights: number[];          // m — column heights, left to right (n + 1): eaves and valleys
    baySpacing: number;         // m — frame spacing
    base: 'pinned' | 'fixed';
    column: MemberSection;      // exterior columns, base (0) → top (1)
    interiorColumn: MemberSection;
    rafter: MemberSection;      // every rafter, eave/valley (0) → apex (1)
    dead: number;
    live: number;
    windPressure: number;
    wallCpe: { windward: number; leeward: number };
    roofCpe: number[];          // per roof slope counted from the windward end (the last value repeats)
    wallCpeRight?: { windward: number; leeward: number };   // wind from the right (default: as from the left)
    roofCpeRight?: number[];    //   … counted from the right-hand end
    windDirections?: 'auto' | 'left' | 'both';
    cpi: number[];
    columnLy: number;
    rafterLy: number;
    verticalLimit: number;
    lateralLimit: number;
    windServiceFactor: number;
    crane?: CraneInput | null;
    nSub?: number;
}

/** Apex position of a (possibly unsymmetric) duo-pitch span. */
export function portalGeometry(inp: Pick<PortalFrameInput, 'span' | 'eaveHeight' | 'roofSlope' | 'eaveHeightR' | 'roofSlopeR'>) {
    const S = inp.span, HL = inp.eaveHeight, HR = inp.eaveHeightR ?? inp.eaveHeight;
    const thL = inp.roofSlope * Math.PI / 180, thR = (inp.roofSlopeR ?? inp.roofSlope) * Math.PI / 180;
    if (thL < 0 || thR < 0) throw new Error('Roof slopes cannot be negative');
    const t = Math.tan(thL) + Math.tan(thR);
    if (t < 1e-9 && Math.abs(HL - HR) > 1e-9) throw new Error('Flat roof with unequal eave heights — give the rafters a slope');
    // HL + x·tanθL = HR + (S − x)·tanθR
    const xA = t < 1e-9 ? S / 2 : (HR - HL + S * Math.tan(thR)) / t;
    if (!(xA > 0.05 * S && xA < 0.95 * S)) throw new Error('Apex falls outside the span — check the eave heights and roof slopes (mono-pitch roofs are not covered)');
    return { S, HL, HR, thL, thR, xA, yA: HL + xA * Math.tan(thL) };
}

// ── internal: general multi-gable definition ──
interface WindSet { wallW: number; wallL: number; roof: number[] }   // roof: from the windward end
interface GableDef {
    code: SteelCode; fy: number;
    spans: { span: number; slopeL: number; slopeR: number }[];
    heights: number[];
    B: number; base: 'pinned' | 'fixed';
    column: MemberSection; interiorColumn: MemberSection; rafter: MemberSection;
    dead: number; live: number; windPressure: number;
    left: WindSet; right: WindSet; windDirections: 'auto' | 'left' | 'both'; cpi: number[];
    columnLy: number; rafterLy: number; verticalLimit: number; lateralLimit: number; windServiceFactor: number;
    crane: CraneInput | null;
    nSub: number;
    single: boolean;            // one span: portal naming
}

const sameArr = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
const roofAt = (list: number[], k: number) => list.length ? list[Math.min(k, list.length - 1)] : 0;

function gableGeometry(d: GableDef) {
    const n = d.spans.length;
    if (n < 1) throw new Error('At least one span is required');
    if (d.heights.length !== n + 1) throw new Error(`${n} spans need ${n + 1} column heights`);
    if (d.heights.some(h => !(h > 0))) throw new Error('Column heights must be positive');
    const colX = [0];
    d.spans.forEach(s => { if (!(s.span > 0)) throw new Error('Spans must be positive'); colX.push(colX[colX.length - 1] + s.span); });
    const apex = d.spans.map((s, k) => {
        const g = portalGeometry({ span: s.span, eaveHeight: d.heights[k], roofSlope: s.slopeL, eaveHeightR: d.heights[k + 1], roofSlopeR: s.slopeR });
        return { x: colX[k] + g.xA, y: g.yA, thL: g.thL, thR: g.thR };
    });
    return { n, colX, apex };
}

/** Is the frame, with its loads, its own mirror image? (then wind from the right adds nothing) */
function gableSymmetric(d: GableDef): boolean {
    const n = d.spans.length;
    for (let k = 0; k < n; k++) {
        const a = d.spans[k], b = d.spans[n - 1 - k];
        if (Math.abs(a.span - b.span) > 1e-9 || Math.abs(a.slopeL - b.slopeR) > 1e-9 || Math.abs(a.slopeR - b.slopeL) > 1e-9) return false;
    }
    if (!sameArr(d.heights, [...d.heights].reverse())) return false;
    if (d.crane && d.crane.span !== n - 1 - d.crane.span) return false;
    const L = d.left, R = d.right;
    const len = Math.max(2 * n, L.roof.length, R.roof.length);
    const roofSame = Array.from({ length: len }, (_, k) => Math.abs(roofAt(L.roof, k) - roofAt(R.roof, k)) < 1e-12).every(Boolean);
    return Math.abs(L.wallW - R.wallW) < 1e-12 && Math.abs(L.wallL - R.wallL) < 1e-12 && roofSame;
}

function gableFrameModel(d: GableDef): StructureModel {
    const { n, colX, apex } = gableGeometry(d);
    const H = d.heights, B = d.B;
    // chain numbering keeps the band narrow: b0, t0, then per span apex k, top k+1, base k+1
    const top = (k: number) => (k === 0 ? 1 : 3 * k);
    const bot = (k: number) => (k === 0 ? 0 : 3 * k + 1);
    const nodes: { x: number; y: number }[] = [{ x: 0, y: 0 }, { x: 0, y: H[0] }];
    for (let k = 0; k < n; k++) nodes.push({ x: apex[k].x, y: apex[k].y }, { x: colX[k + 1], y: H[k + 1] }, { x: colX[k + 1], y: 0 });
    const colName = (k: number) => (d.single ? (k === 0 ? 'Column L' : 'Column R') : `Column ${k + 1}`);
    const rafName = (k: number, side: 'L' | 'R') => (d.single ? `Rafter ${side}` : `Rafter ${k + 1}${side}`);
    const members: MemberDef[] = [];
    const colMember: number[] = [];
    const rafMember: [number, number][] = [];
    const colSec = (k: number) => (k === 0 || k === n ? d.column : d.interiorColumn);
    const colGroup = (k: number) => (k === 0 || k === n ? 'Column' : 'Interior column');
    colMember.push(members.length);
    members.push({ name: colName(0), group: colGroup(0), i: bot(0), j: top(0), section: colSec(0), reverse: false, Ly: d.columnLy, sway: true });
    for (let k = 0; k < n; k++) {
        const a = 2 + 3 * k;
        rafMember.push([members.length, members.length + 1]);
        members.push({ name: rafName(k, 'L'), group: 'Rafter', i: top(k), j: a, section: d.rafter, reverse: false, Ly: d.rafterLy, sway: true });
        members.push({ name: rafName(k, 'R'), group: 'Rafter', i: a, j: top(k + 1), section: d.rafter, reverse: true, Ly: d.rafterLy, sway: true });
        colMember.push(members.length);
        members.push({ name: colName(k + 1), group: colGroup(k + 1), i: top(k + 1), j: bot(k + 1), section: colSec(k + 1), reverse: true, Ly: d.columnLy, sway: true });
    }
    const rest = d.base === 'fixed';
    const supports: SupportDef[] = Array.from({ length: n + 1 }, (_, k) => ({ node: bot(k), ux: true, uy: true, rz: rest }));

    // Gravity: dead on slope, live on plan (× cos θ per unit rafter length)
    const D: LoadCaseDef = { memberLoads: rafMember.flat().map(m => ({ member: m, wx: 0, wy: -d.dead * B })), nodalLoads: [], pointLoads: [] };
    const L: LoadCaseDef = {
        memberLoads: rafMember.flatMap(([ml, mr], k) => [
            { member: ml, wx: 0, wy: -d.live * B * Math.cos(apex[k].thL) },
            { member: mr, wx: 0, wy: -d.live * B * Math.cos(apex[k].thR) },
        ]),
        nodalLoads: [],
    };

    // Wind: net pressure p·(Cpe − Cpi) toward a surface when positive,
    // force per unit length −p_net·n_out. Interior columns carry no wall wind.
    const slopes = rafMember.flatMap(([ml, mr], k) => [
        { member: ml, n: { x: -Math.sin(apex[k].thL), y: Math.cos(apex[k].thL) } },
        { member: mr, n: { x: Math.sin(apex[k].thR), y: Math.cos(apex[k].thR) } },
    ]);
    const windCase = (cpi: number, fromLeft: boolean): LoadCaseDef => {
        const w = fromLeft ? d.left : d.right;
        const pn = (cpe: number) => d.windPressure * B * (cpe - cpi);
        const wallL = fromLeft ? w.wallW : w.wallL, wallR = fromLeft ? w.wallL : w.wallW;
        return {
            memberLoads: [
                { member: colMember[0], wx: pn(wallL), wy: 0 },                 // outward normal −x
                ...slopes.map((sl, j) => {
                    const cpe = roofAt(w.roof, fromLeft ? j : slopes.length - 1 - j);
                    return { member: sl.member, wx: -pn(cpe) * sl.n.x, wy: -pn(cpe) * sl.n.y };
                }),
                { member: colMember[n], wx: -pn(wallR), wy: 0 },                // outward normal +x
            ],
            nodalLoads: [],
        };
    };
    const both = d.windDirections === 'both' || (d.windDirections === 'auto' && !gableSymmetric(d));
    const loadCases: Record<string, LoadCaseDef> = { D, L };
    const windNames: string[] = [];
    const windDir: Record<string, 1 | -1> = {};
    for (const fromLeft of both ? [true, false] : [true]) {
        d.cpi.forEach((cpi, k) => {
            const name = both ? `W${fromLeft ? 'L' : 'R'}${k + 1}` : `W${k + 1}`;
            loadCases[name] = windCase(cpi, fromLeft);
            windNames.push(name);
            windDir[name] = fromLeft ? 1 : -1;
        });
    }
    const hasLive = d.live > 0;
    const combos = strengthCombos(d.code, windNames, hasLive);

    // Crane
    const cr = d.crane;
    let craneNodes: { left: { member: number; at: number }; right: { member: number; at: number } } | null = null;
    let craneRx: CraneReactions | null = null;
    if (cr) {
        const c = cr.span;
        if (!(c >= 0 && c < n) || Math.floor(c) !== c) throw new Error('Crane span index out of range');
        if (!(cr.bracketLevel > 0) || cr.railLevel < cr.bracketLevel) throw new Error('Crane: 0 < bracket level ≤ rail level');
        if (cr.railLevel >= Math.min(H[c], H[c + 1])) throw new Error('Crane rail level must be below the tops of the crane-span columns');
        const rx = craneReactions(cr, d.spans[c].span, B);
        craneRx = rx;
        // fraction along a column member (i → j) of a level y
        const frAt = (k: number, y: number) => (k === 0 ? y / H[0] : 1 - y / H[k]);
        const mL = colMember[c], mR = colMember[c + 1];
        const fbL = frAt(c, cr.bracketLevel), fbR = frAt(c + 1, cr.bracketLevel);
        const frL = frAt(c, cr.railLevel), frR = frAt(c + 1, cr.railLevel);
        members[mL] = { ...members[mL], breaks: [fbL, frL] };
        members[mR] = { ...members[mR], breaks: [fbR, frR] };
        craneNodes = { left: { member: mL, at: frL }, right: { member: mR, at: frR } };
        const e = cr.eccentricity;
        // bracket of the left column is on its right (+e): M = −R·e; right column: +R·e
        const vert = (RL: number, RR: number): MemberPointLoad[] => [
            { member: mL, at: fbL, fx: 0, fy: -RL, mz: -RL * e },
            { member: mR, at: fbR, fx: 0, fy: -RR, mz: RR * e },
        ];
        const imp = 1 + cr.impact;
        D.pointLoads = vert(rx.Rg, rx.Rg);
        loadCases.CV1 = { memberLoads: [], nodalLoads: [], pointLoads: vert(rx.Rmax * imp, rx.Rmin * imp) };
        loadCases.CV2 = { memberLoads: [], nodalLoads: [], pointLoads: vert(rx.Rmin * imp, rx.Rmax * imp) };
        loadCases.CH = {
            memberLoads: [], nodalLoads: [],
            pointLoads: [{ member: mL, at: frL, fx: rx.H, fy: 0, mz: 0 }, { member: mR, at: frR, fx: rx.H, fy: 0, mz: 0 }],
        };
        combos.push(...craneCombos(d.code, windNames, windDir, hasLive));
    }

    combos.push({ name: 'SLS: L', factors: { L: 1 }, kind: 'service', gravityOnly: true });
    const slsWind = windNames.map(w => `SLS: ${d.windServiceFactor}${w}`);
    windNames.forEach((w, k) => combos.push({ name: slsWind[k], factors: { [w]: d.windServiceFactor }, kind: 'service', gravityOnly: false }));

    const deflections: DeflectionCheckDef[] = [];
    // rafters: vertical movement relative to the chord between the span's column tops
    const spanGroups = d.single ? [[0]] : d.spans.map((_, k) => [k]);
    const allSame = d.spans.every(s => Math.abs(s.span - d.spans[0].span) < 1e-9);
    const rafterCheck = (ks: number[], name: string): DeflectionCheckDef => ({
        name, combos: ['SLS: L'], limit: Math.min(...ks.map(k => d.spans[k].span)) * 1000 / d.verticalLimit,
        evaluate: (u, fe) => Math.max(...ks.map(k => {
            const tl = fe.mainNode[top(k)], tr = fe.mainNode[top(k + 1)];
            const [ml, mr] = rafMember[k];
            return Math.max(...[...fe.memberNodes[ml], ...fe.memberNodes[mr]].map(nd => {
                const r = (fe.nodeXY[nd].x - colX[k]) / d.spans[k].span;
                return Math.abs(u[3 * nd + 1] - ((1 - r) * u[3 * tl + 1] + r * u[3 * tr + 1]));
            }));
        })) * 1000,
    });
    if (d.single || allSame) deflections.push(rafterCheck(d.spans.map((_, k) => k), `Rafter vertical (span/${d.verticalLimit})`));
    else spanGroups.forEach(([k]) => deflections.push(rafterCheck([k], `Span ${k + 1} rafter vertical (span/${d.verticalLimit})`)));
    // column-top drift under wind, each against its own height
    const drift = (name: string, h: number, tops: number[]): DeflectionCheckDef => ({
        name: `${name} (H/${d.lateralLimit})`, combos: slsWind, limit: h * 1000 / d.lateralLimit,
        evaluate: (u, fe) => Math.max(...tops.map(t => Math.abs(u[3 * fe.mainNode[t]]))) * 1000,
    });
    const allTops = Array.from({ length: n + 1 }, (_, k) => k);
    if (H.every(h => Math.abs(h - H[0]) < 1e-9)) deflections.push(drift('Eave drift', H[0], allTops.map(top)));
    else if (d.single) deflections.push(drift('Left eave drift', H[0], [top(0)]), drift('Right eave drift', H[1], [top(1)]));
    else allTops.forEach(k => deflections.push(drift(`Column ${k + 1} top drift`, H[k], [top(k)])));

    if (cr && craneNodes && craneRx) {
        // crane serviceability: static crane loads (no impact) with surge either way
        const f = 1 / (1 + cr.impact);
        const sls: string[] = [];
        for (const p of [1, 2]) for (const sg of [1, -1]) {
            const name = `SLS: CV${p}${sg > 0 ? '+' : '−'}CH`;
            sls.push(name);
            combos.push({ name, factors: { [`CV${p}`]: f, CH: sg }, kind: 'service', gravityOnly: false });
        }
        const nodeAt = (fe: FEModel, q: { member: number; at: number }) =>
            fe.memberNodes[q.member][fe.memberFr[q.member].findIndex(v => Math.abs(v - q.at) < 1e-6)];
        const cn = craneNodes;
        deflections.push({
            name: `Crane rail lateral (H/${cr.lateralLimit})`, combos: sls, limit: cr.railLevel * 1000 / cr.lateralLimit,
            evaluate: (u, fe) => Math.max(Math.abs(u[3 * nodeAt(fe, cn.left)]), Math.abs(u[3 * nodeAt(fe, cn.right)])) * 1000,
        });
        deflections.push({
            name: 'Crane rail spread', combos: sls, limit: cr.spreadLimit,
            evaluate: (u, fe) => Math.abs(u[3 * nodeAt(fe, cn.right)] - u[3 * nodeAt(fe, cn.left)]) * 1000,
        });
    }
    return {
        code: d.code, fy: d.fy, nodes, members, supports, loadCases, combos,
        notionalNodes: allTops.map(top), deflections, nSub: d.nSub,
    };
}

/**
 * Crane combinations. Crane load C = CVp ± CH (p = 1: maximum reaction on
 * the left crane column, 2: on the right), including impact.
 *   IS 800:2007 Table 4 — crane and roof live load are both imposed loads;
 *     the leading one takes the full factor, the other the accompanying
 *     factor (1.05 without wind; 1.05 with 0.6W, 0.53 with 1.2W). Both
 *     orders are generated.
 *   ASCE 7-22 §2.3.1 — crane load as L (factor 1.0 in combinations 3 and 4,
 *     the 0.5 reduction does not apply to crane loads); roof live as Lr.
 * With wind, the surge acts in the direction of the wind.
 */
function craneCombos(code: SteelCode, windNames: string[], windDir: Record<string, 1 | -1>, hasLive: boolean): ComboDef[] {
    const out: ComboDef[] = [];
    const C = (p: number, sg: number, f: number) => ({ [`CV${p}`]: f, CH: sg * f });
    const cName = (p: number, sg: number) => `(CV${p}${sg > 0 ? '+' : '−'}CH)`;
    const add = (name: string, factors: Record<string, number>) => out.push({ name, factors, kind: 'strength', gravityOnly: false });
    for (const p of [1, 2]) {
        for (const sg of [1, -1]) {
            if (code === 'IS800') {
                add(`1.5D+1.5${cName(p, sg)}${hasLive ? '+1.05L' : ''}`, { D: 1.5, ...C(p, sg, 1.5), ...(hasLive ? { L: 1.05 } : {}) });
                if (hasLive) add(`1.5D+1.5L+1.05${cName(p, sg)}`, { D: 1.5, L: 1.5, ...C(p, sg, 1.05) });
            } else {
                add(`1.2D+1.6${cName(p, sg)}${hasLive ? '+0.5Lr' : ''}`, { D: 1.2, ...C(p, sg, 1.6), ...(hasLive ? { L: 0.5 } : {}) });
                if (hasLive) add(`1.2D+1.6Lr+1.0${cName(p, sg)}`, { D: 1.2, L: 1.6, ...C(p, sg, 1.0) });
            }
        }
        for (const w of windNames) {
            const sg = windDir[w];
            if (code === 'IS800') {
                add(`1.2D+1.2${cName(p, sg)}${hasLive ? '+1.05L' : ''}+0.6${w}`, { D: 1.2, ...C(p, sg, 1.2), ...(hasLive ? { L: 1.05 } : {}), [w]: 0.6 });
                add(`1.2D+1.2${cName(p, sg)}${hasLive ? '+0.53L' : ''}+1.2${w}`, { D: 1.2, ...C(p, sg, 1.2), ...(hasLive ? { L: 0.53 } : {}), [w]: 1.2 });
                if (hasLive) {
                    add(`1.2D+1.2L+1.05${cName(p, sg)}+0.6${w}`, { D: 1.2, L: 1.2, ...C(p, sg, 1.05), [w]: 0.6 });
                    add(`1.2D+1.2L+0.53${cName(p, sg)}+1.2${w}`, { D: 1.2, L: 1.2, ...C(p, sg, 0.53), [w]: 1.2 });
                }
            } else {
                add(`1.2D+1.0${w}+1.0${cName(p, sg)}${hasLive ? '+0.5Lr' : ''}`, { D: 1.2, [w]: 1.0, ...C(p, sg, 1.0), ...(hasLive ? { L: 0.5 } : {}) });
            }
        }
    }
    return out;
}

function portalToGable(inp: PortalFrameInput): GableDef {
    const c = inp.cpe, r = inp.cpeRight ?? inp.cpe;
    return {
        code: inp.code, fy: inp.fy,
        spans: [{ span: inp.span, slopeL: inp.roofSlope, slopeR: inp.roofSlopeR ?? inp.roofSlope }],
        heights: [inp.eaveHeight, inp.eaveHeightR ?? inp.eaveHeight],
        B: inp.baySpacing, base: inp.base, column: inp.column, interiorColumn: inp.column, rafter: inp.rafter,
        dead: inp.dead, live: inp.live, windPressure: inp.windPressure,
        left: { wallW: c.windwardWall, wallL: c.leewardWall, roof: [c.windwardRoof, c.leewardRoof] },
        right: { wallW: r.windwardWall, wallL: r.leewardWall, roof: [r.windwardRoof, r.leewardRoof] },
        windDirections: inp.windDirections ?? 'auto', cpi: inp.cpi,
        columnLy: inp.columnLy, rafterLy: inp.rafterLy, verticalLimit: inp.verticalLimit, lateralLimit: inp.lateralLimit,
        windServiceFactor: inp.windServiceFactor, crane: inp.crane ?? null, nSub: inp.nSub ?? 10, single: true,
    };
}

function multiToGable(inp: MultiSpanFrameInput): GableDef {
    const wr = inp.wallCpeRight ?? inp.wallCpe;
    return {
        code: inp.code, fy: inp.fy, spans: inp.spans, heights: inp.heights,
        B: inp.baySpacing, base: inp.base, column: inp.column, interiorColumn: inp.interiorColumn, rafter: inp.rafter,
        dead: inp.dead, live: inp.live, windPressure: inp.windPressure,
        left: { wallW: inp.wallCpe.windward, wallL: inp.wallCpe.leeward, roof: inp.roofCpe },
        right: { wallW: wr.windward, wallL: wr.leeward, roof: inp.roofCpeRight ?? inp.roofCpe },
        windDirections: inp.windDirections ?? 'auto', cpi: inp.cpi,
        columnLy: inp.columnLy, rafterLy: inp.rafterLy, verticalLimit: inp.verticalLimit, lateralLimit: inp.lateralLimit,
        windServiceFactor: inp.windServiceFactor, crane: inp.crane ?? null, nSub: inp.nSub ?? 8, single: inp.spans.length === 1,
    };
}

export function isSymmetricPortal(inp: PortalFrameInput): boolean { return gableSymmetric(portalToGable(inp)); }
export function isSymmetricMultiSpan(inp: MultiSpanFrameInput): boolean { return gableSymmetric(multiToGable(inp)); }
export function portalFrameModel(inp: PortalFrameInput): StructureModel { return gableFrameModel(portalToGable(inp)); }
export function multiSpanFrameModel(inp: MultiSpanFrameInput): StructureModel { return gableFrameModel(multiToGable(inp)); }

// ═══════════════════════════════════════════════════════════════
//  Single column
// ═══════════════════════════════════════════════════════════════
export interface ColumnInput {
    code: SteelCode;
    fy: number;
    height: number;                     // m
    base: 'pinned' | 'fixed';
    top: 'free' | 'braced';             // braced = held laterally at the top (no sway)
    member: MemberSection;              // profile base (0) → top (1)
    P: { D: number; L: number; W: number };      // kN at the top, compression positive
    Mtop: { D: number; L: number; W: number };   // kN·m at the top
    wWind: number;                      // kN/m lateral along the height (wind)
    Ly: number;                         // m — out-of-plane / LTB unbraced length
    lateralLimit: number;               // H / this under wind
    windServiceFactor: number;
    nSub?: number;
}

export function columnModel(inp: ColumnInput): StructureModel {
    const H = inp.height;
    const nodes = [{ x: 0, y: 0 }, { x: 0, y: H }];
    const members: MemberDef[] = [{ name: 'Column', group: 'Column', i: 0, j: 1, section: inp.member, reverse: false, Ly: inp.Ly, sway: inp.top === 'free' }];
    const supports: SupportDef[] = [{ node: 0, ux: true, uy: true, rz: inp.base === 'fixed' }];
    if (inp.top === 'braced') supports.push({ node: 1, ux: true, uy: false, rz: false });
    if (inp.base === 'pinned' && inp.top === 'free') throw new Error('A column pinned at the base must be braced at the top');
    const lc = (P: number, M: number, w = 0): LoadCaseDef => ({
        memberLoads: w ? [{ member: 0, wx: w, wy: 0 }] : [],
        nodalLoads: [{ node: 1, fx: 0, fy: -P, mz: M }],
    });
    const loadCases = { D: lc(inp.P.D, inp.Mtop.D), L: lc(inp.P.L, inp.Mtop.L), W1: lc(inp.P.W, inp.Mtop.W, inp.wWind) };
    const hasWind = inp.P.W !== 0 || inp.Mtop.W !== 0 || inp.wWind !== 0;
    const combos = strengthCombos(inp.code, hasWind ? ['W1'] : [], inp.P.L !== 0 || inp.Mtop.L !== 0);
    const deflections: DeflectionCheckDef[] = [];
    if (hasWind) {
        combos.push({ name: `SLS: ${inp.windServiceFactor}W1`, factors: { W1: inp.windServiceFactor }, kind: 'service', gravityOnly: false });
        deflections.push({
            name: `Top drift (H/${inp.lateralLimit})`, combos: [`SLS: ${inp.windServiceFactor}W1`], limit: H * 1000 / inp.lateralLimit,
            evaluate: (u, fe) => Math.max(...fe.memberNodes[0].map(n => Math.abs(u[3 * n]))) * 1000,
        });
    }
    return {
        code: inp.code, fy: inp.fy, nodes, members, supports, loadCases, combos,
        notionalNodes: inp.top === 'free' ? [1] : [], deflections, nSub: inp.nSub ?? 12,
    };
}

// ═══════════════════════════════════════════════════════════════
//  Single beam
// ═══════════════════════════════════════════════════════════════
export interface BeamInput {
    code: SteelCode;
    fy: number;
    span: number;                       // m
    supports: 'pinned-pinned' | 'fixed-fixed' | 'fixed-pinned' | 'cantilever';
    member: MemberSection;              // profile left (0) → right (1)
    w: { D: number; L: number; W: number };      // kN/m, downward positive (wind uplift negative)
    P: { D: number; L: number; a: number };      // point load (kN) at a (m) from the left
    Ly: number;                         // m — compression flange unbraced length
    verticalLimit: number;              // span / this under live load
    nSub?: number;
}

export function beamModel(inp: BeamInput): StructureModel {
    const Ls = inp.span;
    const withPoint = (inp.P.D !== 0 || inp.P.L !== 0) && inp.P.a > 0 && inp.P.a < Ls;
    const nodes = withPoint ? [{ x: 0, y: 0 }, { x: inp.P.a, y: 0 }, { x: Ls, y: 0 }] : [{ x: 0, y: 0 }, { x: Ls, y: 0 }];
    const last = nodes.length - 1;
    const members: MemberDef[] = withPoint
        ? [
            { name: 'Beam (left)', group: 'Beam', i: 0, j: 1, section: splitSection(inp.member, 0, inp.P.a / Ls), reverse: false, Ly: inp.Ly, sway: false },
            { name: 'Beam (right)', group: 'Beam', i: 1, j: 2, section: splitSection(inp.member, inp.P.a / Ls, 1), reverse: false, Ly: inp.Ly, sway: false },
        ]
        : [{ name: 'Beam', group: 'Beam', i: 0, j: 1, section: inp.member, reverse: false, Ly: inp.Ly, sway: false }];
    const sup = inp.supports;
    const supports: SupportDef[] = [];
    if (sup === 'cantilever') supports.push({ node: 0, ux: true, uy: true, rz: true });
    else {
        supports.push({ node: 0, ux: true, uy: true, rz: sup !== 'pinned-pinned' });
        supports.push({ node: last, ux: false, uy: true, rz: sup === 'fixed-fixed' });
    }
    const ml = (w: number) => members.map((_, k) => ({ member: k, wx: 0, wy: -w }));
    const pl = (P: number): NodalLoad[] => (withPoint && P ? [{ node: 1, fx: 0, fy: -P, mz: 0 }] : []);
    const loadCases: Record<string, LoadCaseDef> = {
        D: { memberLoads: ml(inp.w.D), nodalLoads: pl(inp.P.D) },
        L: { memberLoads: ml(inp.w.L), nodalLoads: pl(inp.P.L) },
        W1: { memberLoads: ml(inp.w.W), nodalLoads: [] },
    };
    const hasWind = inp.w.W !== 0;
    const hasLive = inp.w.L !== 0 || inp.P.L !== 0;
    const combos = strengthCombos(inp.code, hasWind ? ['W1'] : [], hasLive);
    const deflections: DeflectionCheckDef[] = [];
    if (hasLive) {
        combos.push({ name: 'SLS: L', factors: { L: 1 }, kind: 'service', gravityOnly: true });
        const limitLen = sup === 'cantilever' ? 2 * Ls : Ls;
        deflections.push({
            name: `Vertical (${sup === 'cantilever' ? '2×' : ''}span/${inp.verticalLimit})`, combos: ['SLS: L'],
            limit: limitLen * 1000 / inp.verticalLimit,
            evaluate: (u, fe) => Math.max(...fe.memberNodes.flat().map(n => Math.abs(u[3 * n + 1]))) * 1000,
        });
    }
    return { code: inp.code, fy: inp.fy, nodes, members, supports, loadCases, combos, notionalNodes: [], deflections, nSub: inp.nSub ?? 12 };
}

function depthOver(m: MemberSection, s: number): number {
    const p = m.profile;
    for (let k = 0; k < p.at.length - 1; k++) {
        if (s <= p.at[k + 1] + 1e-12) {
            const r = (s - p.at[k]) / Math.max(1e-12, p.at[k + 1] - p.at[k]);
            return p.D[k] + (p.D[k + 1] - p.D[k]) * r;
        }
    }
    return p.D[p.D.length - 1];
}

/** Part [a, b] (fractions) of a tapered member as a member of its own. */
function splitSection(m: MemberSection, a: number, b: number): MemberSection {
    const at = [0], D = [depthOver(m, a)];
    m.profile.at.forEach((f, k) => {
        if (f > a + 1e-9 && f < b - 1e-9) { at.push((f - a) / (b - a)); D.push(m.profile.D[k]); }
    });
    at.push(1); D.push(depthOver(m, b));
    return { ...m, profile: { at, D } };
}

// ═══════════════════════════════════════════════════════════════
//  Optimizer — minimum steel weight subject to every strength,
//  stability and serviceability check, discrete plate sizes
// ═══════════════════════════════════════════════════════════════
export interface SteelOptimizeParams {
    depthMin: number; depthMax: number; depthStep: number;   // mm
    bfList: number[]; tfList: number[]; twList: number[];    // mm
    maxPasses?: number;
}

export type SteelMode = 'frame' | 'multispan' | 'column' | 'beam';
export type SteelInput =
    | { mode: 'frame'; input: PortalFrameInput }
    | { mode: 'multispan'; input: MultiSpanFrameInput }
    | { mode: 'column'; input: ColumnInput }
    | { mode: 'beam'; input: BeamInput };

export function buildModel(si: SteelInput): StructureModel {
    switch (si.mode) {
        case 'frame': return portalFrameModel(si.input);
        case 'multispan': return multiSpanFrameModel(si.input);
        case 'column': return columnModel(si.input);
        default: return beamModel(si.input);
    }
}

/** Build the model and run the design. */
export function runDesign(si: SteelInput, opts: { detail?: boolean; only?: string[]; stopAbove?: number } = {}): DesignResult {
    return designStructure(buildModel(si), opts);
}

type Grp = 'a' | 'b' | 'c';
type VarKey = { group: Grp; field: 'D0' | 'D1' | 'bf' | 'tf' | 'tw' };

// optimizer groups: a = column (exterior) / member, b = rafter, c = interior column
const groupField = (mode: SteelMode, g: Grp): 'column' | 'rafter' | 'interiorColumn' | 'member' =>
    mode === 'frame' || mode === 'multispan' ? (g === 'a' ? 'column' : g === 'b' ? 'rafter' : 'interiorColumn') : 'member';
const getSecOf = (x: SteelInput, g: Grp): MemberSection => (x.input as unknown as Record<string, MemberSection>)[groupField(x.mode, g)];
const withSecOf = (x: SteelInput, g: Grp, sec: MemberSection): SteelInput =>
    ({ mode: x.mode, input: { ...x.input, [groupField(x.mode, g)]: sec } }) as SteelInput;

export interface SteelOptimizeResult {
    best: SteelInput | null;
    result: DesignResult | null;
    evaluations: number;
    feasibleFound: number;
    history: { mass: number; maxUtil: number }[];
    approximate: true;
}

/**
 * Discrete local search over plate sizes and taper depths — minimum steel
 * mass subject to every strength, stability and serviceability check.
 *   • two starts: the user's design (snapped to the lists) and the heaviest
 *     combination; the lighter feasible result is kept;
 *   • coordinate sweeps (each variable over its whole list, others fixed),
 *     then exchange moves (one variable a step down, another a step up —
 *     e.g. deeper web with thinner flanges, which single-variable sweeps
 *     cannot reach when deflection governs); repeat until no move helps.
 * Heuristic: the best design found, not a proven global minimum.
 * Practical rules: tf ≥ tw; bf ≤ 30·tf; rafters deepest at the eave; columns
 * of pinned-base frames deepest at the top.
 */
export function optimizeSteel(si: SteelInput, p: SteelOptimizeParams, onProgress?: (done: number, total: number, feasible: number) => void): SteelOptimizeResult {
    const depths: number[] = [];
    for (let d = p.depthMin; d <= p.depthMax + 1e-9; d += p.depthStep) depths.push(Math.round(d));
    const sorted = (a: number[]) => [...new Set(a)].sort((x, y) => x - y);
    const lists: Record<VarKey['field'], number[]> = { D0: depths, D1: depths, bf: sorted(p.bfList), tf: sorted(p.tfList), tw: sorted(p.twList) };

    // Variables per group: depths D0 / D1, bf, tf, tw
    const groupsOf: Grp[] = si.mode === 'frame' ? ['a', 'b']
        : si.mode === 'multispan' ? (si.input.spans.length > 1 ? ['a', 'b', 'c'] : ['a', 'b'])
            : ['a'];
    const keys: VarKey[] = [];
    for (const g of groupsOf) for (const f of ['D0', 'D1', 'bf', 'tf', 'tw'] as const) {
        if (f === 'D1' && getSecOf(si, g).profile.D.length < 2) continue;
        keys.push({ group: g, field: f });
    }
    const getSec = getSecOf, withSec = withSecOf;
    // D0 = depth at the first profile point; D1 = at the second and beyond
    const varOf = (sec: MemberSection, q: number) => sec.profile.vars?.[q] ?? (q === 0 ? 0 : 1);
    const getVar = (x: SteelInput, k: VarKey): number => {
        const sec = getSec(x, k.group);
        if (k.field === 'D0' || k.field === 'D1') {
            const want = k.field === 'D0' ? 0 : 1;
            const q = sec.profile.D.findIndex((_, i) => varOf(sec, i) === want);
            return q >= 0 ? sec.profile.D[q] : NaN;
        }
        return sec[k.field];
    };
    const setVar = (x: SteelInput, k: VarKey, v: number): SteelInput => {
        const sec = getSec(x, k.group);
        if (k.field === 'D0' || k.field === 'D1') {
            const want = k.field === 'D0' ? 0 : 1;
            const D = sec.profile.D.map((d, i) => (varOf(sec, i) === want ? v : d));
            return withSec(x, k.group, { ...sec, profile: { ...sec.profile, D } });
        }
        return withSec(x, k.group, { ...sec, [k.field]: v });
    };
    const practical = (x: SteelInput) => groupsOf.every(g => {
        const sc = getSec(x, g);
        if (sc.tf < sc.tw || sc.bf > 30 * sc.tf) return false;
        if (x.mode === 'frame' || x.mode === 'multispan') {
            const D = sc.profile.D;
            if (g === 'b' && D.length > 1 && D[0] < D[1]) return false;                  // rafter haunch at the eave
            if (g !== 'b' && x.input.base === 'pinned' && D.length > 1 && D[1] < D[0]) return false;   // pinned-base column deepest at the top
        }
        return true;
    });
    const key = (x: SteelInput) => keys.map(k => getVar(x, k)).join('|');

    let evaluations = 0, feasibleFound = 0;
    const history: { mass: number; maxUtil: number }[] = [];
    const memo = new Map<string, DesignResult>();
    const budget = 2500;
    const evaluate = (x: SteelInput): DesignResult => {
        const kx = key(x);
        const hit = memo.get(kx);
        if (hit) return hit;
        evaluations++;
        const r = runDesign(x, { detail: false });
        if (r.ok) feasibleFound++;
        memo.set(kx, r);
        if (onProgress && evaluations % 10 === 0) onProgress(evaluations, budget, feasibleFound);
        return r;
    };
    // Active-set screening when there are many strength combinations (crane,
    // two wind directions): a trial is first checked for the combinations
    // that have governed so far; only a trial passing that screen and lighter
    // than the current design gets the full check. A combination found
    // governing in a full check joins the active set.
    const nStrength = buildModel(si).combos.filter(c => c.kind === 'strength').length;
    const useScreen = nStrength > 10;
    const score = new Map<string, number>();       // latest full-check utilization per combination
    const active = new Set<string>();
    let activeVer = 0;
    const screenMemo = new Map<string, DesignResult>();
    const learn = (r: DesignResult) => {
        const str = r.combos.filter(c => c.kind === 'strength');
        str.forEach(c => score.set(c.name, c.maxUtil));
        const before = active.size;
        [...str].sort((p, q) => q.maxUtil - p.maxUtil).slice(0, 3).forEach(c => active.add(c.name));
        str.forEach(c => { if (c.maxUtil > 1) active.add(c.name); });
        if (active.size !== before) activeVer++;
    };
    const screen = (x: SteelInput): DesignResult => {
        if (!useScreen) return evaluate(x);
        const kx = key(x);
        const full = memo.get(kx);
        if (full) return full;
        const ks = `${kx}#${activeVer}`;
        const hit = screenMemo.get(ks);
        if (hit) return hit;
        evaluations += active.size / Math.max(1, nStrength);   // cost in full-check units
        const only = [...active].sort((p, q) => (score.get(q) ?? 0) - (score.get(p) ?? 0));
        const r = runDesign(x, { detail: false, only, stopAbove: 1 + 1e-9 });
        screenMemo.set(ks, r);
        return r;
    };
    const snapUp = (list: number[], v: number) => list.find(q => q >= v - 1e-9) ?? list[list.length - 1];

    const descend = (start: SteelInput): { x: SteelInput; r: DesignResult } | null => {
        let cur = start;
        let curRes = evaluate(cur);
        if (useScreen) learn(curRes);
        if (!curRes.ok || !practical(cur)) return null;
        history.push({ mass: curRes.mass, maxUtil: curRes.maxUtil });
        const tryMove = (trial: SteelInput) => {
            if (!practical(trial) || evaluations >= budget) return false;
            const rs = screen(trial);
            if (!rs.ok || rs.mass >= curRes.mass - 1e-6) return false;
            const r = evaluate(trial);
            if (useScreen) learn(r);
            if (r.ok) {
                cur = trial; curRes = r;
                history.push({ mass: r.mass, maxUtil: r.maxUtil });
                return true;
            }
            return false;
        };
        for (let round = 0; round < 20 && evaluations < budget; round++) {
            // coordinate sweeps
            let improved = true;
            while (improved && evaluations < budget) {
                improved = false;
                for (const k of keys) for (const v of lists[k.field]) {
                    if (v >= getVar(cur, k)) break;
                    if (tryMove(setVar(cur, k, v))) improved = true;
                }
            }
            // exchange moves: one variable a step down, another a step up
            let exchanged = false;
            outer: for (const k1 of keys) {
                const l1 = lists[k1.field], i1 = l1.indexOf(getVar(cur, k1));
                if (i1 <= 0) continue;
                for (const k2 of keys) {
                    if (k1 === k2) continue;
                    const l2 = lists[k2.field], i2 = l2.indexOf(getVar(cur, k2));
                    if (i2 < 0 || i2 >= l2.length - 1) continue;
                    if (tryMove(setVar(setVar(cur, k1, l1[i1 - 1]), k2, l2[i2 + 1]))) { exchanged = true; break outer; }
                }
            }
            if (!exchanged) break;
        }
        return { x: cur, r: curRes };
    };

    let userStart = si;
    for (const k of keys) userStart = setVar(userStart, k, snapUp(lists[k.field], getVar(si, k)));
    let heavy = si;
    for (const k of keys) heavy = setVar(heavy, k, lists[k.field][lists[k.field].length - 1]);
    const runs = [descend(userStart), descend(heavy)].filter((v): v is { x: SteelInput; r: DesignResult } => v !== null);
    onProgress?.(budget, budget, feasibleFound);
    if (!runs.length) return { best: null, result: evaluate(heavy), evaluations, feasibleFound, history, approximate: true };
    const best = runs.reduce((a, b) => (b.r.mass < a.r.mass ? b : a));
    return { best: best.x, result: runDesign(best.x), evaluations, feasibleFound, history, approximate: true };
}
