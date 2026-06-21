'use strict';

/* ================================================================
   CONTINUOUS BEAM ANALYZER — Core Application Logic
   Variable span lengths & EI, exact rational arithmetic,
   stiffness method, rendering
   ================================================================ */

// ───────────────────── Fraction Class ─────────────────────

function gcd(a: number, b: number): number { a = Math.abs(a); b = Math.abs(b); while (b) { const t = b; b = a % t; a = t; } return a || 1; }

// PERF-001 / CALC-003: native-number fractions silently lose precision once
// |numerator| or |denominator| exceeds 2^53 (Number.MAX_SAFE_INTEGER). The wall
// engine's `custom` load case feeds decimal pressures and non-trivial EI ratios
// into the exact solver, where Gaussian elimination multiplies denominators
// without bound — they reach ~1e30, overflowing safe-integer range. Beyond that,
// gcd() returns wrong values (so fractions stop reducing and keep growing), which
// is BOTH catastrophically slow (~1.5s/analyzeWall) AND numerically corrupt.
//
// Fix: keep exact native-integer fractions while they are representable (Set A's
// small integers never trip this, so they stay bit-exact), but when a fraction
// can no longer be represented exactly, re-reduce it to the nearest fraction with
// a bounded denominator. The resulting ≤1e-9 relative rounding is vastly better
// than the previous silent gross corruption, and it keeps denominators small so
// the solver stays fast.
const FRAC_SAFE_LIMIT = 9007199254740991; // Number.MAX_SAFE_INTEGER (2^53 - 1)
const FRAC_BOUND_DENOM = 1000000000;       // 1e9 — bounded-rational denominator
function boundedRational(n: number, d: number): { n: number; d: number } {
    // Represent the value n/d (a finite double here) as p/q with q <= FRAC_BOUND_DENOM.
    const val = n / d;
    if (!Number.isFinite(val)) return { n: 0, d: 1 };
    if (Number.isInteger(val) && Math.abs(val) <= FRAC_SAFE_LIMIT) return { n: val, d: 1 };
    const q = FRAC_BOUND_DENOM;
    const p = Math.round(val * q);
    const g = gcd(Math.abs(p), q);
    return { n: p / g, d: q / g };
}

class F {
    n: number;
    d: number;
    approx: boolean;

    constructor(n: number, d?: number) {
        if (d === undefined) { d = 1; }
        if (d === 0) throw new Error('÷0');
        if (d < 0) { n = -n; d = -d; }
        const g = gcd(Math.abs(n), d);
        let rn: number = n / g;
        let rd: number = d / g;
        // CALC-006: track whether THIS fraction lost exactness to the bounded-
        // rational fallback. When it did, any surd later extracted from a
        // discriminant built on it is fictional (there is nothing exact left to
        // factor), so the symbolic path must be skipped — see computeSpanDetails.
        // This is a *precise* signal (the fallback actually fired) rather than the
        // old magnitude-only `S > 1e9` heuristic, which wrongly discarded
        // genuinely-exact symbolic results for legitimate multi-span beams with
        // simple exact decimal spans (e.g. L=[4.5,2.5,1.5], EI=[1,1,1]).
        let approx = false;
        // Guard against safe-integer overflow (see boundedRational above). When the
        // reduced fraction is no longer exactly representable, fall back to a
        // bounded-denominator rational so arithmetic stays correct and fast.
        if (Math.abs(rn) > FRAC_SAFE_LIMIT || rd > FRAC_SAFE_LIMIT) {
            const br = boundedRational(n, d);
            rn = br.n;
            rd = br.d;
            approx = true;
        }
        this.n = rn;
        this.d = rd;
        this.approx = approx;
    }
    // Propagate the "approximate" taint through arithmetic: a result is exact
    // only if both operands were exact AND no overflow fallback fired building it.
    _taint(b: any, r: F): F {
        if (this.approx || (b && b.approx)) r.approx = true;
        return r;
    }
    add(b: any): any {
        if (b && b.isLinExpr) return b.add(this);
        return this._taint(b, new F(this.n * b.d + b.n * this.d, this.d * b.d));
    }
    sub(b: any): any {
        if (b && b.isLinExpr) return this.add(b.neg());
        return this._taint(b, new F(this.n * b.d - b.n * this.d, this.d * b.d));
    }
    mul(b: any): any {
        if (b && b.isLinExpr) return b.mul(this);
        return this._taint(b, new F(this.n * b.n, this.d * b.d));
    }
    div(b: any): any {
        if (b && b.isLinExpr) throw new Error('Cannot divide by LinExpr');
        return this._taint(b, new F(this.n * b.d, this.d * b.n));
    }
    neg(): F { const r = new F(-this.n, this.d); r.approx = this.approx; return r; }
    abs(): F { const r = new F(Math.abs(this.n), this.d); r.approx = this.approx; return r; }
    isZero(): boolean { return this.n === 0; }
    isPos(): boolean { return this.n > 0; }
    isNeg(): boolean { return this.n < 0; }
    eq(b: any): boolean {
        if (b && b.isLinExpr) return b.eq(this);
        return this.n * b.d === b.n * this.d;
    }
    lt(b: F): boolean { return this.n * b.d < b.n * this.d; }
    gt(b: F): boolean { return this.n * b.d > b.n * this.d; }
    le(b: F): boolean { return this.n * b.d <= b.n * this.d; }
    ge(b: F): boolean { return this.n * b.d >= b.n * this.d; }
    fl(): number { return this.n / this.d; }
    str(asCoeff: boolean = false): string { return this.d === 1 ? `${this.n}` : `${this.n}/${this.d}`; }
    html(): string {
        if (this.n === 0) return '<span class="frac-whole">0</span>';
        if (this.d === 1) return `<span class="frac-whole">${this.n}</span>`;
        const s = this.n < 0 ? '−' : '';
        const num = Math.abs(this.n);
        return `<span class="frac"><span class="frac-bar"><span class="frac-t">${s}${num}</span><span class="frac-b">${this.d}</span></span></span>`;
    }
}
const ZERO = new F(0); const ONE = new F(1);

// ───────────────────── Linear Algebra ─────────────────────

function gaussSolve(A: any[], b: any[]): any[] {
    const n = A.length;
    const aug = A.map((row, i) => {
        // CALC-006: copy fractions WITHOUT dropping the bounded-rational taint.
        // Previously `new F(v.n, v.d)` produced a clean copy, so a fraction that
        // had already lost exactness to the overflow fallback (approx=true) became
        // "exact" again the moment it entered the solver. Any discriminant built
        // from the solved reactions then carried a fictional surd (a 1e9-denominator
        // radical) that disagreed with the numeric value in the 3rd–4th decimal.
        const rowCpy = row.map((v: any) => { const c = new F(v.n, v.d); c.approx = v.approx; return c; });
        let bi;
        if (b[i].isLinExpr) {
            bi = new LinExpr(b[i].c1, b[i].c2);
        } else {
            bi = new F(b[i].n, b[i].d);
            bi.approx = b[i].approx;
        }
        return [...rowCpy, bi];
    });
    for (let c = 0; c < n; c++) {
        let mx = c;
        for (let r = c + 1; r < n; r++) if (aug[r][c].abs().gt(aug[mx][c].abs())) mx = r;
        [aug[c], aug[mx]] = [aug[mx], aug[c]];
        if (aug[c][c].isZero()) throw new Error('Singular matrix');
        for (let r = c + 1; r < n; r++) {
            const f = aug[r][c].div(aug[c][c]);
            for (let j = c; j <= n; j++) aug[r][j] = aug[r][j].sub(f.mul(aug[c][j]));
        }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
        let s = aug[i][n];
        for (let j = i + 1; j < n; j++) s = s.sub(aug[i][j].mul(x[j]));
        x[i] = s.div(aug[i][i]);
    }
    return x;
}

// ───────────────────── Helpers ─────────────────────

/** Convert a decimal number to an exact Fraction */
function toFrac(val: number): F {
    if (val === 0) return ZERO;
    if (Number.isInteger(val)) return new F(val);
    const str = String(val);
    const dotIdx = str.indexOf('.');
    if (dotIdx === -1) return new F(Math.round(val));
    const decimals = str.length - dotIdx - 1;
    const multiplier = Math.pow(10, decimals);
    return new F(Math.round(val * multiplier), multiplier);
}

/** Build a label for a normalized span length alpha */
function alphaLabel(alpha: F): string {
    if (alpha.eq(ONE)) return 'l';
    if (alpha.d === 1) return `${alpha.n}l`;
    if (alpha.n === 1) return `l/${alpha.d}`;
    return `${alpha.n}l/${alpha.d}`;
}

/**
 * Format a surd |q|·√inside in canonical form: a√n/b
 * @param {F} absQ  - |q| as a positive Fraction (already reduced)
 * @param {number} inside - simplified radicand (perfect squares extracted)
 * @returns {{ html: string, str: string }}
 */
function formatSurd(absQ: F, inside: number): { html: string; str: string } {
    if (inside === 0 || absQ.isZero()) return { html: '0', str: '0' };
    if (inside === 1) return { html: absQ.html(), str: absQ.str() };
    const n = absQ.n; // always ≥ 0
    const d = absQ.d;
    const radStr = `√${inside}`;
    const radHtml = `&radic;${inside}`;
    if (d === 1) {
        if (n === 1) return { html: radHtml, str: radStr };
        return { html: `${n}${radHtml}`, str: `${n}${radStr}` };
    }
    // Canonical: a√n / b  (fraction bar around numerator and denominator)
    const numHtml = n === 1 ? radHtml : `${n}${radHtml}`;
    const numStr  = n === 1 ? radStr  : `${n}${radStr}`;
    return {
        html: `<span class="frac"><span class="frac-bar"><span class="frac-t">${numHtml}</span><span class="frac-b">${d}</span></span></span>`,
        str: `${numStr}/${d}`
    };
}

/**
 * Build a single equation term like " + 3/7·x²" with proper sign
 * handling, unit-coefficient omission (1·x → x), and negative sign.
 * @param {F} coeff - coefficient Fraction
 * @param {string} variable - e.g., 'x', 'x²', 'x³'
 * @returns {string} formatted term (may be empty if coeff is zero)
 */
function formatCoeffTerm(coeff: F, variable: string): string {
    if (coeff.isZero()) return '';
    const sign = coeff.isPos() ? ' + ' : ' − ';
    const abs = coeff.abs();
    if (abs.eq(ONE)) return `${sign}${variable}`;
    return `${sign}${abs.str(true)}·${variable}`;
}

// ───────────────────── Linear Expression (w₁, w₂) ─────────────────────

function lcm(a: number, b: number): number { return (a / gcd(a, b)) * b; }

/**
 * Represents a linear combination  c₁·w₁ + c₂·w₂  where c₁, c₂ are Fractions.
 * Used for the Combined UDL+UVL load case where both load magnitudes
 * remain as independent symbolic variables.
 */
class LinExpr {
    isLinExpr = true;
    c1: F;
    c2: F;

    constructor(c1: any, c2: any) {
        this.isLinExpr = true;
        this.c1 = c1 instanceof F ? c1 : new F(c1);
        this.c2 = c2 instanceof F ? c2 : new F(c2);
    }
    add(o: any): LinExpr {
        if (o instanceof LinExpr) return new LinExpr(this.c1.add(o.c1), this.c2.add(o.c2));
        return new LinExpr(this.c1.add(o), this.c2);
    }
    sub(o: any): LinExpr {
        if (o instanceof LinExpr) return new LinExpr(this.c1.sub(o.c1), this.c2.sub(o.c2));
        return new LinExpr(this.c1.sub(o), this.c2);
    }
    mul(f: any): LinExpr { return new LinExpr(this.c1.mul(f), this.c2.mul(f)); }
    div(f: any): LinExpr { return new LinExpr(this.c1.div(f), this.c2.div(f)); }
    neg(): LinExpr { return new LinExpr(this.c1.neg(), this.c2.neg()); }
    abs(): LinExpr {
        if (this.c2.isZero()) return new LinExpr(this.c1.abs(), ZERO);
        if (this.c1.isZero()) return new LinExpr(ZERO, this.c2.abs());
        return this; // can't take abs of general two-variable expression
    }
    isZero(): boolean { return this.c1.isZero() && this.c2.isZero(); }
    isPos(): boolean { return this.fl() > 0; }
    isNeg(): boolean { return this.fl() < 0; }
    fl(w1?: number, w2?: number): number { return this.c1.fl() * (w1 === undefined ? 1 : w1) + this.c2.fl() * (w2 === undefined ? 1 : w2); }
    eq(o: any): boolean {
        if (o instanceof LinExpr) return this.c1.eq(o.c1) && this.c2.eq(o.c2);
        if (o instanceof F) return this.c2.isZero() && this.c1.eq(o);
        return false;
    }

    /** Canonical text: e.g. "(5w₁ + 3w₂)/60" */
    str(asCoeff: boolean = false): string {
        if (this.c1.isZero() && this.c2.isZero()) return '0';
        if (this.c2.isZero()) return _fmtCoeffVarStr(this.c1, 'w₁');
        if (this.c1.isZero()) return _fmtCoeffVarStr(this.c2, 'w₂');
        // Both nonzero: common denominator
        const d = lcm(this.c1.d, this.c2.d);
        let a = this.c1.n * (d / this.c1.d);
        let b = this.c2.n * (d / this.c2.d);
        const g = gcd(gcd(Math.abs(a), Math.abs(b)), d);
        a /= g; b /= g;
        const dd = d / g;
        // If both negative, factor out the sign for cleaner display
        if (a < 0 && b < 0) {
            const posNum = _buildTermStr(-a, 'w₁', -b, 'w₂');
            return dd === 1 ? `−(${posNum})` : `−(${posNum})/${dd}`;
        }
        const num = _buildTermStr(a, 'w₁', b, 'w₂');
        return dd === 1 ? (asCoeff ? `(${num})` : num) : `(${num})/${dd}`;
    }

    /** Canonical HTML with fraction bars: e.g. (5w₁ + 3w₂)/60 rendered visually */
    html(): string {
        if (this.c1.isZero() && this.c2.isZero()) return '<span class="frac-whole">0</span>';
        if (this.c2.isZero()) return _fmtCoeffVarHtml(this.c1, 'w<sub>1</sub>');
        if (this.c1.isZero()) return _fmtCoeffVarHtml(this.c2, 'w<sub>2</sub>');
        const d = lcm(this.c1.d, this.c2.d);
        let a = this.c1.n * (d / this.c1.d);
        let b = this.c2.n * (d / this.c2.d);
        const g = gcd(gcd(Math.abs(a), Math.abs(b)), d);
        a /= g; b /= g;
        const dd = d / g;
        if (a < 0 && b < 0) {
            const posNum = _buildTermHtml(-a, 'w<sub>1</sub>', -b, 'w<sub>2</sub>');
            if (dd === 1) return `<span class="frac-whole">−(${posNum})</span>`;
            return `<span class="frac">−<span class="frac-bar"><span class="frac-t">${posNum}</span><span class="frac-b">${dd}</span></span></span>`;
        }
        const num = _buildTermHtml(a, 'w<sub>1</sub>', b, 'w<sub>2</sub>');
        if (dd === 1) return `<span class="frac-whole">${num}</span>`;
        return `<span class="frac"><span class="frac-bar"><span class="frac-t">${num}</span><span class="frac-b">${dd}</span></span></span>`;
    }
}

// --- LinExpr display helpers ---

/** Format a single Fraction×variable for str(), e.g. "3w₁/7" or "-w₂" */
function _fmtCoeffVarStr(frac: F, varName: string): string {
    if (frac.isZero()) return '0';
    const n = Math.abs(frac.n), d = frac.d;
    const sign = frac.n < 0 ? '-' : '';
    if (d === 1) return n === 1 ? `${sign}${varName}` : `${sign}${n}${varName}`;
    const num = n === 1 ? varName : `${n}${varName}`;
    return `${sign}${num}/${d}`;
}

/** Format a single Fraction×variable for html(), e.g. fraction-bar rendering */
function _fmtCoeffVarHtml(frac: F, varHtml: string): string {
    if (frac.isZero()) return '<span class="frac-whole">0</span>';
    const n = Math.abs(frac.n), d = frac.d;
    const sign = frac.n < 0 ? '−' : '';
    if (d === 1) {
        const coeff = n === 1 ? '' : `${n}`;
        return `<span class="frac-whole">${sign}${coeff}${varHtml}</span>`;
    }
    const numHtml = n === 1 ? `${sign}${varHtml}` : `${sign}${n}${varHtml}`;
    return `<span class="frac"><span class="frac-bar"><span class="frac-t">${numHtml}</span><span class="frac-b">${d}</span></span></span>`;
}

/** Build combined numerator string like "5w₁ + 3w₂" or "−(5w₁ + 3w₂)" */
function _buildTermStr(a: number, v1: string, b: number, v2: string): string {
    const aStr = Math.abs(a) === 1 ? v1 : `${Math.abs(a)}${v1}`;
    const bStr = Math.abs(b) === 1 ? v2 : `${Math.abs(b)}${v2}`;
    if (a > 0 && b > 0) return `${aStr} + ${bStr}`;
    if (a > 0 && b < 0) return `${aStr} − ${bStr}`;
    if (a < 0 && b > 0) return `−${aStr} + ${bStr}`;
    return `−(${aStr} + ${bStr})`; // both negative
}

/** Build combined numerator HTML like "5w₁ + 3w₂" */
function _buildTermHtml(a: number, v1: string, b: number, v2: string): string {
    const aStr = Math.abs(a) === 1 ? v1 : `${Math.abs(a)}${v1}`;
    const bStr = Math.abs(b) === 1 ? v2 : `${Math.abs(b)}${v2}`;
    if (a > 0 && b > 0) return `${aStr} + ${bStr}`;
    if (a > 0 && b < 0) return `${aStr} − ${bStr}`;
    if (a < 0 && b > 0) return `−${aStr} + ${bStr}`;
    return `−(${aStr} + ${bStr})`;
}



// ───────────────────── Tapered Beam Analytical Stiffness ─────────────────────

function getTaperedBeamStiffness(d1: number, d2: number, b: number, E: number, L: number): number[][] {
    if (Math.abs(d2 - d1) < 1e-6) {
        const I = (b * Math.pow(d1, 3)) / 12;
        const EI = E * I;
        const L2 = L * L;
        const L3 = L2 * L;
        return [
            [  12*EI/L3,  6*EI/L2, -12*EI/L3,  6*EI/L2 ],
            [   6*EI/L2,   4*EI/L,  -6*EI/L2,   2*EI/L ],
            [-12*EI/L3,  -6*EI/L2,  12*EI/L3, -6*EI/L2 ],
            [   6*EI/L2,   2*EI/L,  -6*EI/L2,   4*EI/L ]
        ];
    }

    const fPP = (6 * Math.pow(L, 3) * (3*d1*d1 - 4*d1*d2 + d2*d2 + 2*d1*d1 * Math.log(d2/d1))) / 
                (E * b * d1*d1 * Math.pow(d2 - d1, 3));
    const fPM = (6 * Math.pow(L, 2)) / (E * b * d1*d1 * d2);
    const fMM = (6 * L * (d1 + d2)) / (E * b * d1*d1 * d2*d2);

    const det = fPP * fMM - fPM * fPM;
    const kvv =  fMM / det;   // vertical stiffness at free end
    const kvt = -fPM / det;   // cross-coupling (moment from vertical, vertical from moment)
    const ktt = fPP / det;    // rotational stiffness at free end

    // Build the full 4×4 stiffness matrix from the cantilever flexibility.
    //
    // The cantilever is fixed at node 0 (left), free at node 1 (right).
    // Flexibility: {v₁, θ₁} = [F] {P₁, M₁}
    // Stiffness at free end: {P₁, M₁} = [K₂ₓ₂] {Δv, Δθ}
    //   where Δv = v₁ - v₀ - θ₀·L (relative vertical displacement)
    //         Δθ = θ₁ - θ₀          (relative rotation)
    //
    // P₁ = kvv·Δv + kvt·Δθ
    // M₁ = kvt·Δv + ktt·Δθ
    // P₀ = -P₁                    (vertical equilibrium)
    // M₀ = -(M₁ + P₁·L)           (moment equilibrium about node 0)
    //
    // Expanding P₀, M₀, P₁, M₁ in terms of [v₀, θ₀, v₁, θ₁] and
    // collecting coefficients gives the full symmetric 4×4 matrix.
    // Verified against the standard uniform beam element and rigid body modes.

    return [
        [      kvv,         kvv*L + kvt,      -kvv,           -kvt          ],
        [ kvv*L + kvt,  kvv*L*L + 2*kvt*L + ktt, -(kvv*L + kvt), -(ktt + kvt*L) ],
        [     -kvv,        -(kvv*L + kvt),       kvv,            kvt          ],
        [     -kvt,        -(ktt + kvt*L),       kvt,            ktt          ]
    ];
}

/**
 * Numerically calculates the normalized Fixed-End Moments for a linearly tapered
 * beam under a distributed load (using Simpson's 1/3 Rule).
 */
function getTaperedBeamNormalizedFEM(d1: number, d2: number, alpha: number, wL_val: number, wR_val: number): number[] {
    if (Math.abs(d2 - d1) < 1e-6) {
        const fL = -(7 * wL_val + 3 * wR_val) * alpha / 20;
        const mL = -(3 * wL_val + 2 * wR_val) * alpha * alpha / 60;
        const fR = -(3 * wL_val + 7 * wR_val) * alpha / 20;
        const mR = (2 * wL_val + 3 * wR_val) * alpha * alpha / 60;
        return [fL, mL, fR, mR];
    }

    const E = 1;
    const b = 1;
    const L = alpha;

    const N = 100;
    const dx = L / N;
    let v2_sum = 0;
    let theta2_sum = 0;

    for (let i = 0; i <= N; i++) {
        const x = i * dx;
        const B = (wR_val - wL_val) / L;
        // Cantilever moment at section x (cantilever fixed at left, free at right)
        // under trapezoidal load wL to wR:
        //   M(x) = -∫ₓᴸ w(ξ)(ξ-x) dξ = -(wL/2)(L-x)² - (B/6)(2L³ - 3L²x + x³)
        const M0 = -(wL_val / 2 * Math.pow(L - x, 2) + B / 6 * (2 * L * L * L - 3 * L * L * x + Math.pow(x, 3)));

        const d_x = d1 + (d2 - d1) * (x / L);
        const I_x = b * Math.pow(d_x, 3) / 12;
        const EI_x = E * I_x;

        // Flexibility integrals:
        //   v2 = ∫ M₀(x)·(L-x)/EI(x) dx  (deflection at free end, < 0 for downward load)
        //   θ2 = ∫ M₀(x)/EI(x) dx        (rotation at free end, < 0 for clockwise rotation)
        const d_theta = M0 / EI_x;
        const d_v = M0 * (L - x) / EI_x;

        const mult = (i === 0 || i === N) ? 1 : (i % 2 === 1 ? 4 : 2);

        theta2_sum += mult * d_theta;
        v2_sum += mult * d_v;
    }

    const theta2 = (dx / 3) * theta2_sum; // < 0 for downward load
    const v2 = (dx / 3) * v2_sum;         // < 0 for downward load

    const K = getTaperedBeamStiffness(d1, d2, b, E, L);

    // BUG FIX 1: The displacement correction to bring the free end back to zero
    // is [-v2, -theta2] (both negative because v2 and theta2 are negative for
    // downward load, so -v2 > 0 and -theta2 > 0 are the corrections needed).
    // The previous code used [−v2, theta2] which had the wrong sign on theta2.
    const d_vec = [0, 0, -v2, -theta2];

    // Restoration forces from the stiffness matrix.
    // K · d_vec gives the INTERNAL forces (positive = downward) at each node
    // from the displacement correction. The FEM convention uses NEGATIVE for
    // upward reactions, so we need -(K · d_vec) to convert.
    const restoration = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            restoration[i] += -K[i][j] * d_vec[j];
        }
    }

    // BUG FIX 2: The FEM must include the cantilever reactions (the load itself)
    // PLUS the restoration forces. The previous code only computed restoration
    // forces, which sum to zero by stiffness matrix equilibrium — so the total
    // reaction was always 0, not wL.
    //
    // Cantilever reactions (forces the fixed left support exerts on the beam)
    // for a trapezoidal load wL to wR over length L:
    //   V_left = -(wL + wR)·L/2  (upward = negative in downward-positive convention)
    //   M_left = -(2·wL + wR)·L²/6  (counterclockwise at left)
    //   V_right = 0, M_right = 0
    const V_cant = -(wL_val + wR_val) * L / 2;
    const M_cant = -(2 * wL_val + wR_val) * L * L / 6;

    const fem = [
        V_cant + restoration[0],
        M_cant + restoration[1],
        0 + restoration[2],
        0 + restoration[3],
    ];

    return fem;
}

// ───────────────────── Beam Analysis ─────────────────────


function analyzeBeam(cfg: any): any {
    const { nSpans, loadCase, endCond } = cfg;
    // Per-span properties (default to all ones if not provided)
    const spanLengths = cfg.spanLengths || Array.from({ length: nSpans }, () => ONE);
    const spanEIs = cfg.spanEIs || Array.from({ length: nSpans }, () => ONE);
    const refSpanL = cfg.refSpanL !== undefined ? cfg.refSpanL : 0;
    const refSpanEI = cfg.refSpanEI !== undefined ? cfg.refSpanEI : 0;

    // Compute normalization ratios
    const L_ref = spanLengths[refSpanL];
    const EI_ref = spanEIs[refSpanEI];
    const alphas: any[] = spanLengths.map((l: any) => l.div(L_ref));   // α_i = L_i / L_ref
    const betas: any[] = spanEIs.map((ei: any) => ei.div(EI_ref));     // β_i = EI_i / EI_ref

    // Cumulative alphas for position tracking
    const cumAlphas: any[] = [ZERO];
    for (let i = 0; i < nSpans; i++) cumAlphas.push(cumAlphas[i].add(alphas[i]));
    const totalAlpha = cumAlphas[nSpans];

    // Compute totalLoadedAlpha to properly scale global UVLs to the actual loaded length (soil surface)
    let totalLoadedAlpha: any = totalAlpha;
    if (cfg.lastSpanLoadStop && cfg.lastSpanLoadStop > 1e-6) {
        const L_phys = alphas[nSpans - 1].fl() * (cfg.L_ref_phys || 1);
        const a_phys = Math.min(cfg.lastSpanLoadStop, L_phys);
        const a_alpha = a_phys / (cfg.L_ref_phys || 1);
        totalLoadedAlpha = cumAlphas[nSpans - 1].add(toFrac(a_alpha));
    }

    const nNodes = nSpans + 1;
    const nDof = 2 * nNodes;
    const w = ONE;

    // --- Build global stiffness & equivalent nodal loads ---
    const K: any[][] = Array.from({ length: nDof }, () => Array.from({ length: nDof }, () => ZERO));
    const Feq: any[] = Array.from({ length: nDof }, () => ZERO);

    const spanLoads: any[] = []; // {wL, wR} per span (Fraction)

    for (let sp = 0; sp < nSpans; sp++) {
        const alpha = alphas[sp];
        const beta = betas[sp];
        const alpha2 = alpha.mul(alpha);
        const alpha3 = alpha2.mul(alpha);

        // Per-span stiffness matrix: k_i
        let kE: any[][];
        if (cfg.spanTapers && cfg.spanTapers[sp]) {
            const taper = cfg.spanTapers[sp];
            const K_phys = getTaperedBeamStiffness(taper.d1, taper.d2, taper.b, taper.E, taper.L);
            const L_ref = cfg.L_ref_phys || 1;
            const EI_ref = cfg.EI_ref_phys || 1;
            
            kE = [
                [ 
                  toFrac(K_phys[0][0] * Math.pow(L_ref, 3) / EI_ref), 
                  toFrac(K_phys[0][1] * Math.pow(L_ref, 2) / EI_ref), 
                  toFrac(K_phys[0][2] * Math.pow(L_ref, 3) / EI_ref), 
                  toFrac(K_phys[0][3] * Math.pow(L_ref, 2) / EI_ref) 
                ],
                [ 
                  toFrac(K_phys[1][0] * Math.pow(L_ref, 2) / EI_ref), 
                  toFrac(K_phys[1][1] * L_ref / EI_ref), 
                  toFrac(K_phys[1][2] * Math.pow(L_ref, 2) / EI_ref), 
                  toFrac(K_phys[1][3] * L_ref / EI_ref) 
                ],
                [ 
                  toFrac(K_phys[2][0] * Math.pow(L_ref, 3) / EI_ref), 
                  toFrac(K_phys[2][1] * Math.pow(L_ref, 2) / EI_ref), 
                  toFrac(K_phys[2][2] * Math.pow(L_ref, 3) / EI_ref), 
                  toFrac(K_phys[2][3] * Math.pow(L_ref, 2) / EI_ref) 
                ],
                [ 
                  toFrac(K_phys[3][0] * Math.pow(L_ref, 2) / EI_ref), 
                  toFrac(K_phys[3][1] * L_ref / EI_ref), 
                  toFrac(K_phys[3][2] * Math.pow(L_ref, 2) / EI_ref), 
                  toFrac(K_phys[3][3] * L_ref / EI_ref) 
                ]
            ];
        } else {
            const ba3 = beta.div(alpha3);
            const ba2 = beta.div(alpha2);
            const ba1 = beta.div(alpha);

            kE = [
                [new F(12).mul(ba3),  new F(6).mul(ba2),  new F(-12).mul(ba3), new F(6).mul(ba2)],
                [new F(6).mul(ba2),   new F(4).mul(ba1),  new F(-6).mul(ba2),  new F(2).mul(ba1)],
                [new F(-12).mul(ba3), new F(-6).mul(ba2), new F(12).mul(ba3),  new F(-6).mul(ba2)],
                [new F(6).mul(ba2),   new F(2).mul(ba1),  new F(-6).mul(ba2),  new F(4).mul(ba1)]
            ];
        }


        const dofs = [2 * sp, 2 * sp + 1, 2 * sp + 2, 2 * sp + 3];
        // Assemble stiffness
        for (let a = 0; a < 4; a++)
            for (let b = 0; b < 4; b++)
                K[dofs[a]][dofs[b]] = K[dofs[a]][dofs[b]].add(kE[a][b]);

        // Compute load intensities for this span
        let wL: any, wR: any;
        if (loadCase === 'udl') {
            wL = w; wR = w;
        } else if (loadCase === 'udl+uvl') {
            const alphaL = cumAlphas[sp].div(totalLoadedAlpha);
            const alphaR = cumAlphas[sp + 1].div(totalLoadedAlpha);
            let wl_expr = new LinExpr(ONE.sub(alphaL), alphaL);
            let wr_expr = new LinExpr(ONE.sub(alphaR), alphaR);
            
            // User requested w1 to be substituted in terms of w2 using the ratio w1/w2.
            if (cfg.w2Val !== undefined && cfg.w2Val !== 0 && cfg.w1Val !== undefined) {
                const k = toFrac(cfg.w1Val / cfg.w2Val);
                wl_expr = new LinExpr(ZERO, wl_expr.c1.mul(k).add(wl_expr.c2));
                wr_expr = new LinExpr(ZERO, wr_expr.c1.mul(k).add(wr_expr.c2));
            }
            wL = wl_expr;
            wR = wr_expr;
        } else if (loadCase === 'uvl-global') {
            wL = ONE.sub(cumAlphas[sp].div(totalLoadedAlpha));
            wR = ONE.sub(cumAlphas[sp + 1].div(totalLoadedAlpha));
        } else if (loadCase === 'custom') {
            wL = cfg.customLoads[sp].wL;
            wR = cfg.customLoads[sp].wR;
        } else {
            wL = w; wR = ZERO;
        }
        spanLoads.push({ wL, wR });

        // Fixed-end equivalent nodal loads with span length α_i
        let fem: any[];
        if (cfg.spanTapers && cfg.spanTapers[sp]) {
            const taper = cfg.spanTapers[sp];
            const num_fem = getTaperedBeamNormalizedFEM(taper.d1, taper.d2, alpha.fl(), wL.fl(cfg.w1Val, cfg.w2Val), wR.fl(cfg.w1Val, cfg.w2Val));
            fem = num_fem.map(v => toFrac(v));
        } else {
            if (sp === nSpans - 1 && cfg.lastSpanLoadStop > 1e-6) {
                // Partial load from x=0 to x=a
                const L_phys = alpha.fl() * (cfg.L_ref_phys || 1);
                const a_phys = Math.min(cfg.lastSpanLoadStop, L_phys);
                const a_n = toFrac(a_phys / (cfg.L_ref_phys || 1));
                
                const L = alpha;
                const a2 = a_n.mul(a_n);
                const a3 = a2.mul(a_n);
                const a4 = a3.mul(a_n);
                const a5 = a4.mul(a_n);
                const L2 = alpha2;
                const L3 = alpha3;

                // M_AB coefficients
                const mab_cL = a2.div(new F(2)).sub(a3.div(L)).add(new F(3).mul(a4).div(new F(4).mul(L2))).sub(a5.div(new F(5).mul(L3)));
                const mab_cR = a3.div(new F(3).mul(L)).sub(a4.div(new F(2).mul(L2))).add(a5.div(new F(5).mul(L3)));
                const M_AB = mab_cL.mul(wL).add(mab_cR.mul(wR));

                // M_BA coefficients
                const mba_cL = mab_cR; // identical coefficient
                const mba_cR = a4.div(new F(4).mul(L2)).sub(a5.div(new F(5).mul(L3)));
                const M_BA = mba_cL.mul(wL).add(mba_cR.mul(wR));

                // M_W,B coefficients (moment of load about right end)
                const mwb_cL = L.mul(a_n).sub(a2).add(a3.div(new F(3).mul(L)));
                const mwb_cR = a2.div(new F(2)).sub(a3.div(new F(3).mul(L)));
                const M_WB = mwb_cL.mul(wL).add(mwb_cR.mul(wR));

                // Total load W coefficients
                const w_cL = a_n.sub(a2.div(new F(2).mul(L)));
                const w_cR = a2.div(new F(2).mul(L));
                const W_tot = w_cL.mul(wL).add(w_cR.mul(wR));

                // Upward vertical reactions at ends of the fixed-fixed element
                const V_A = M_WB.add(M_AB).sub(M_BA).div(L);
                const V_B = W_tot.sub(V_A);

                fem = [
                    V_A.mul(new F(-1)),
                    M_AB.mul(new F(-1)),
                    V_B.mul(new F(-1)),
                    M_BA
                ];
            } else {
                // Full span
                fem = [
                    new F(-7).mul(wL).add(new F(-3).mul(wR)).mul(alpha).div(new F(20)),      // F left
                    new F(-3).mul(wL).add(new F(-2).mul(wR)).mul(alpha2).div(new F(60)),     // M left
                    new F(-3).mul(wL).add(new F(-7).mul(wR)).mul(alpha).div(new F(20)),      // F right
                    new F(2).mul(wL).add(new F(3).mul(wR)).mul(alpha2).div(new F(60))        // M right
                ];
            }
        }
        for (let a = 0; a < 4; a++) Feq[dofs[a]] = Feq[dofs[a]].add(fem[a]);
    }

    // --- Identify unknowns ---
    // supportMask[i] === true  => node i has a transverse support (vertical DOF restrained)
    // supportMask[i] === false => node i is a *continuous* interior point (vertical DOF free).
    //                             Used for load-discontinuity nodes such as the water table on a
    //                             vertical wall strip, where the lateral pressure has a slope kink
    //                             but there is NO physical prop. This keeps the beam continuous
    //                             across the kink instead of (incorrectly) inserting a support.
    // Default: every node is a support (preserves the original continuous-beam-over-supports model).
    const supportMask: boolean[] = cfg.supportMask || Array.from({ length: nNodes }, () => true);
    const unknownDofs: number[] = [];
    for (let i = 0; i < nNodes; i++) {
        // Vertical DOF is unknown only when the node is NOT a transverse support.
        if (!supportMask[i]) unknownDofs.push(2 * i);
        // Rotation DOF handling (identical to the original logic):
        const isEnd = (i === 0 || i === nNodes - 1);
        if (!isEnd) {
            unknownDofs.push(2 * i + 1);              // interior rotations always free
        } else if (endCond === 'fixed-fixed') {
            /* both ends rotation-fixed -> not unknown */
        } else if (endCond === 'fixed') {
            if (i !== 0) unknownDofs.push(2 * i + 1); // node 0 fixed; far end free
        } else if (endCond === 'fixed-right') {
            if (i !== nNodes - 1) unknownDofs.push(2 * i + 1); // last node fixed; first end free
        } else {
            unknownDofs.push(2 * i + 1);              // pinned ends: rotation free
        }
    }
    const nU = unknownDofs.length;

    // --- Extract reduced system and solve ---
    let dFree: any[];
    if (nU > 0) {
        const Kuu: any[][] = Array.from({ length: nU }, (_, a: number) =>
            Array.from({ length: nU }, (_, b: number) => K[unknownDofs[a]][unknownDofs[b]]));
        const Fu: any[] = unknownDofs.map((i: number) => Feq[i]);
        dFree = gaussSolve(Kuu, Fu);
    } else {
        dFree = [];
    }

    // Full displacement
    const d: any[] = Array.from({ length: nDof }, () => ZERO);
    for (let i = 0; i < nU; i++) d[unknownDofs[i]] = dFree[i];

    // --- Compute reactions: R = K*d - F_eq ---
    const reactions: any[] = [];
    const labels: string[] = [];
    for (let i = 0; i < nNodes; i++) {
        const lbl = String.fromCharCode(65 + i);
        labels.push(lbl);
        const vIdx = 2 * i, tIdx = 2 * i + 1;
        let Rv = ZERO, Rt = ZERO;
        for (let j = 0; j < nDof; j++) {
            Rv = Rv.add(K[vIdx][j].mul(d[j]));
            Rt = Rt.add(K[tIdx][j].mul(d[j]));
        }
        Rv = Rv.sub(Feq[vIdx]);
        Rt = Rt.sub(Feq[tIdx]);
        reactions.push({ label: lbl, Rv, Rt, theta: d[tIdx] });
    }

    // --- Per-span analysis ---
    const spans: any[] = [];
    let VLeft: any = reactions[0].Rv;
    let MLeft: any = (endCond === 'fixed' || endCond === 'fixed-fixed') ? reactions[0].Rt.neg() : ZERO;
    // 'fixed-right': left end is pinned (MLeft=0), right end fixity is resolved by stiffness method

    for (let sp = 0; sp < nSpans; sp++) {
        const { wL: wl, wR: wr } = spanLoads[sp];
        const alpha = alphas[sp];
        const spanInfo = computeSpanDetails(VLeft, MLeft, wl, wr, alpha, sp, nSpans, reactions, labels, cumAlphas, cfg.w1Val, cfg.w2Val, cfg.L_ref_phys || 1, cfg.lastSpanLoadStop || 0);
        spans.push(spanInfo);

        // VLeft for next span: accumulate reactions and loads exactly
        if (loadCase === 'udl' && alphas.every((a: any) => a.eq(ONE))) {
            // Fast exact path for equal-span UDL
            const VR_exact = spanInfo.VLeft_frac.sub(wl.mul(alpha));
            VLeft = VR_exact.add(reactions[sp + 1].Rv);
        } else {
            // General path: sum all reactions and loads to the left
            let accR: any = ZERO, accLoad: any = ZERO;
            for (let i = 0; i <= sp + 1; i++) accR = accR.add(reactions[i].Rv);
            for (let i = 0; i <= sp; i++) {
                const { wL: swl, wR: swr } = spanLoads[i];
                accLoad = accLoad.add(swl.add(swr).mul(alphas[i]).div(new F(2)));
            }
            VLeft = accR.sub(accLoad);
        }
        MLeft = spanInfo.MRight_frac;
    }

    // --- Total load for equilibrium check ---
    let totalLoad: any = ZERO;
    let totalMoment: any = ZERO;
    for (let sp = 0; sp < nSpans; sp++) {
        const { wL, wR } = spanLoads[sp];
        const alpha = alphas[sp];
        const x0 = cumAlphas[sp];
        if (sp === nSpans - 1 && cfg.lastSpanLoadStop > 1e-6) {
            const L_phys = alpha.fl() * (cfg.L_ref_phys || 1);
            const a_phys = Math.min(cfg.lastSpanLoadStop, L_phys);
            const a_n = toFrac(a_phys / (cfg.L_ref_phys || 1));
            // Trapezoidal load over portion [0, a_n]
            const wR_a = wL.sub(wL.sub(wR).mul(a_n.div(alpha)));
            const spanLoad = wL.add(wR_a).mul(a_n).div(new F(2));
            totalLoad = totalLoad.add(spanLoad);
            
            const m_cR = a_n.mul(a_n).mul(a_n).div(new F(3).mul(alpha));
            const m_cL = a_n.mul(a_n).div(new F(2)).sub(m_cR);
            const spanM_local = wL.mul(m_cL).add(wR.mul(m_cR));
            const spanM_global = spanLoad.mul(x0).add(spanM_local);
            totalMoment = totalMoment.add(spanM_global);
        } else {
            const spanLoad = wL.add(wR).mul(alpha).div(new F(2));
            totalLoad = totalLoad.add(spanLoad);
            
            const spanM_local = wL.add(new F(2).mul(wR)).mul(alpha).mul(alpha).div(new F(6));
            const spanM_global = spanLoad.mul(x0).add(spanM_local);
            totalMoment = totalMoment.add(spanM_global);
        }
    }
    let totalReaction: any = ZERO;
    for (const r of reactions) totalReaction = totalReaction.add(r.Rv);

    return {
        reactions, spans, labels, spanLoads,
        totalLoad, totalReaction, totalMoment,
        nSpans, loadCase, endCond,
        alphas, betas, cumAlphas, totalAlpha,
        refSpanL, refSpanEI,
        spanLengths, spanEIs,
        spanTapers: cfg.spanTapers,
        lastSpanLoadStop: cfg.lastSpanLoadStop,
        w1Val: cfg.w1Val, w2Val: cfg.w2Val,
        // Flag: if any span is tapered, the HTML renderers should show
        // decimal values (3 dp) instead of exact fractions, because the
        // tapered FEM is computed numerically and the fractions are
        // approximations of decimals — displaying them as fractions is
        // misleading.
        isTapered: cfg.spanTapers ? cfg.spanTapers.some((t: any) => t !== null) : false,
    };
}

function computeSpanDetails(VLeft_frac: any, MLeft_frac: any, wL_frac: any, wR_frac: any, alpha: any, spanIdx: number, nSpans: number, reactions: any, labels: string[], cumAlphas: any, w1Val: number, w2Val: number, L_ref_phys: number, lastSpanLoadStop: number): any {
    const VL = VLeft_frac.fl(w1Val, w2Val);
    const ML = MLeft_frac.fl(w1Val, w2Val);
    const wL = wL_frac.fl(w1Val, w2Val);
    const wR = wR_frac.fl(w1Val, w2Val);
    const L = alpha.fl(); // span length in normalized units

    const dw = wL - wR;
    const isPartialLoad = spanIdx === nSpans - 1 && lastSpanLoadStop > 1e-6;
    const loadStopDistA = isPartialLoad ? Math.min(lastSpanLoadStop, L * L_ref_phys) / L_ref_phys : L;
    let a = loadStopDistA;

    function V(x: number): number { 
        if (x <= a) return VL - wL * x + dw * x * x / (2 * L); 
        else {
            const Va = VL - wL * a + dw * a * a / (2 * L);
            return Va;
        }
    }
    
    function M(x: number): number { 
        if (x <= a) return ML + VL * x - wL * x * x / 2 + dw * x * x * x / (6 * L); 
        else {
            const Va = VL - wL * a + dw * a * a / (2 * L);
            const Ma = ML + VL * a - wL * a * a / 2 + dw * a * a * a / (6 * L);
            return Ma + Va * (x - a);
        }
    }

    // Find zero-shear location
    let zeroShearX: number | null = null, maxM: number | null = null, maxMx: number | null = null;
    const isUDL = Math.abs(dw) < 1e-15;

    if (isUDL) {
        // Linear shear: V = VL - wL*x → x0 = VL/wL
        if (Math.abs(wL) > 1e-15) {
            const x0 = VL / wL;
            if (x0 >= -1e-12 && x0 <= a + 1e-12) {
                zeroShearX = Math.max(0, Math.min(a, x0));
                maxM = M(zeroShearX);
                maxMx = zeroShearX;
            }
        }
    } else {
        // Quadratic: dw/(2L)*x² - wL*x + VL = 0
        const a_quad = dw / (2 * L), b_quad = -wL, c_quad = VL;
        const disc = b_quad * b_quad - 4 * a_quad * c_quad;
        if (disc >= 0) {
            const sqrtD = Math.sqrt(disc);
            const x1 = (-b_quad - sqrtD) / (2 * a_quad);
            const x2 = (-b_quad + sqrtD) / (2 * a_quad);
            const candidates = [];
            if (x1 >= -1e-10 && x1 <= a + 1e-10) candidates.push(Math.max(0, Math.min(a, x1)));
            if (x2 >= -1e-10 && x2 <= a + 1e-10) candidates.push(Math.max(0, Math.min(a, x2)));
            if (candidates.length > 0) {
                zeroShearX = candidates[0];
                maxMx = zeroShearX;
                maxM = M(zeroShearX);
            }
        }
    }

    // For UDL, compute exact zero-shear and max moment using fractions
    let zeroShearExact: any = null, maxMExact: any = null;
    let exactDistFromA_HTML: string | null = null;
    let exactDistFromA_Text: string | null = null;

    if (isPartialLoad) {
        // Skip exact symbolic Mmax for partial loads to keep math simple
        exactDistFromA_HTML = `<em>Numeric: ${(cumAlphas[spanIdx].fl() + maxMx).toFixed(3)} l</em>`;
        exactDistFromA_Text = `Numeric: ${(cumAlphas[spanIdx].fl() + maxMx).toFixed(3)} l`;
    } else if (wL_frac.isLinExpr) {
        if (zeroShearX !== null) {
            const x0Frac: F = toFrac(Math.round(zeroShearX * 1e8) / 1e8);
            zeroShearExact = x0Frac;
            
            // M(x0) = ML + VL*x0 - wL*x0²/2 + dw*x0³/(6*alpha)
            const term1 = MLeft_frac;
            const term2 = VLeft_frac.mul(x0Frac);
            const x0Sq = x0Frac.mul(x0Frac);
            const term3 = wL_frac.mul(x0Sq).div(new F(2));
            const x0Cub = x0Sq.mul(x0Frac);
            const dw_frac = wL_frac.sub(wR_frac);
            const term4 = dw_frac.mul(x0Cub).div(new F(6).mul(alpha));
            
            maxMExact = term1.add(term2).sub(term3).add(term4);
            
            const distFromA = cumAlphas[spanIdx].add(x0Frac);
            exactDistFromA_HTML = `${distFromA.html()} l`;
            exactDistFromA_Text = `${distFromA.str()} l`;
        } else {
            exactDistFromA_HTML = '<em>Depends on w<sub>1</sub>/w<sub>2</sub> ratio</em>';
            exactDistFromA_Text = 'Depends on w₁/w₂ ratio';
            maxMExact = {
                html: () => '<em>Depends on w<sub>1</sub>/w<sub>2</sub> ratio</em>',
                str: () => 'Depends on w₁/w₂ ratio',
                fl: () => maxM,
                isText: true
            };
        }
    } else if (isUDL && !wL_frac.isZero()) {
        const x0_frac = VLeft_frac.div(wL_frac);
        if (x0_frac.ge(ZERO) && x0_frac.le(alpha)) {
            zeroShearExact = x0_frac;
            // M(x0) = ML + VL*x0 - wL*x0²/2
            maxMExact = MLeft_frac.add(VLeft_frac.mul(x0_frac)).sub(wL_frac.mul(x0_frac).mul(x0_frac).div(new F(2)));
            const distFromA = cumAlphas[spanIdx].add(x0_frac);
            exactDistFromA_HTML = `${distFromA.html()} l`;
            exactDistFromA_Text = `${distFromA.str()} l`;
        }
    } else if (!isUDL && zeroShearX !== null) {
        // Quadratic: a x² + b x + c = 0 with a = dw/(2α), b = -wL, c = VL
        const a_frac = wL_frac.sub(wR_frac).div(new F(2).mul(alpha));
        const b_frac = wL_frac.neg();
        const c_frac = VLeft_frac;

        const b2 = b_frac.mul(b_frac);
        const four_ac = new F(4).mul(a_frac).mul(c_frac);
        const D = b2.sub(four_ac);

        // PERF-005 / CALC-006: perfect-square extraction below is O(√S). For
        // Set A's small exact integer discriminants S is tiny and this is
        // instant. Two distinct things can make S large, and they need DIFFERENT
        // treatment:
        //
        //  (1) FICTIONAL exactness — the wall `custom` load case feeds decimal
        //      pressures/EI through the bounded-rational fallback (FRAC_BOUND_DENOM
        //      ~1e9). The discriminant is then itself an approximation: there is
        //      nothing exact left to factor, and S is a ~1e15 near-prime that would
        //      drive the loop to ~√S ≈ 3e7 iterations (~0.4s) per span. Here we
        //      MUST skip the surd path — and we detect it precisely via D.approx
        //      (the fallback actually fired) rather than the old magnitude-only
        //      `S > 1e9` heuristic.
        //
        //  (2) GENUINE exactness with a large-but-finite S — e.g. a legitimate
        //      multi-span Beam-mode user typing simple exact decimals
        //      (L=[4.5,2.5,1.5], EI=[1,1,1]) yields an exact discriminant with
        //      S ~5e10. The old cap wrongly discarded these even though the surd
        //      IS exact. Here we keep the exact surd, but bound the factorization
        //      COST: a tight loop bails after FACTOR_ITER_CAP divisor trials and,
        //      if it could not finish, falls back to the (always-correct) numeric
        //      Mmax/x0 path. This preserves exactness whenever it is cheap and
        //      stays bounded otherwise — without ever producing a wrong value.
        const FACTOR_ITER_CAP = 5_000_000; // ~50 ms worst case per span
        const factorExact = D.n >= 0 && !D.approx;
        let factored: { coeff: number; inside: number } | null = null;
        if (factorExact) {
            const S = D.n * D.d;
            let coeff = 1;
            let inside = Math.abs(Math.round(S));
            let ok = true;
            let i = 2;
            for (; i * i <= inside; i++) {
                if (i - 1 > FACTOR_ITER_CAP) { ok = false; break; }
                while (inside % (i * i) === 0) {
                    coeff *= i;
                    inside /= (i * i);
                }
            }
            if (ok) factored = { coeff, inside };
        }
        if (factored) {
            let { coeff, inside } = factored;

            const Fq = new F(coeff, D.d);
            const two_a = a_frac.mul(new F(2));
            const p = b_frac.neg().div(two_a);
            const q = Fq.div(two_a);

            const sq = Math.sqrt(inside);
            const root1 = p.fl() + Math.abs(q.fl()) * sq;
            const root2 = p.fl() - Math.abs(q.fl()) * sq;

            const usePlus = Math.abs(root1 - zeroShearX) < Math.abs(root2 - zeroShearX);

            const cumA = cumAlphas[spanIdx];
            const P = cumA.add(p);
            const Q_mag = q.abs();

            let html = P.html();
            let text = P.str();
            let html_local = p.html();
            let text_local = p.str();
            if (inside === 0) {
                // just P and p
            } else if (inside === 1) {
                const exact_dist = usePlus ? P.add(Q_mag) : P.sub(Q_mag);
                html = exact_dist.html();
                text = exact_dist.str();
                const exact_local = usePlus ? p.add(Q_mag) : p.sub(Q_mag);
                html_local = exact_local.html();
                text_local = exact_local.str();
            } else {
                const surd = formatSurd(Q_mag, inside);
                const signHtml = usePlus ? ' + ' : ' − ';
                const signText = usePlus ? ' + ' : ' - ';
                if (P.isZero()) {
                    html = usePlus ? surd.html : `−${surd.html}`;
                    text = usePlus ? surd.str : `-${surd.str}`;
                } else {
                    html = `<span style="white-space:nowrap;">(${html}${signHtml}${surd.html})</span>`;
                    text = `(${text}${signText}${surd.str})`;
                }
                if (p.isZero()) {
                    html_local = usePlus ? surd.html : `−${surd.html}`;
                    text_local = usePlus ? surd.str : `-${surd.str}`;
                } else {
                    html_local = `<span style="white-space:nowrap;">(${html_local}${signHtml}${surd.html})</span>`;
                    text_local = `(${text_local}${signText}${surd.str})`;
                }
            }

            zeroShearExact = {
                html: () => html_local,
                str: () => text_local,
                fl: () => p.fl() + (usePlus ? Q_mag.fl() : -Q_mag.fl()) * Math.sqrt(inside)
            };
            exactDistFromA_HTML = `${html} l`;
            exactDistFromA_Text = `${text} l`;

            // Calculate exact maximum moment M(x) = ML + VL*x - wL/2*x² + dw/(6α)*x³
            const real_q = usePlus ? q.abs() : q.abs().neg();
            const addS = (x: { a: any; b: any }, y: { a: any; b: any }): { a: any; b: any } => ({ a: x.a.add(y.a), b: x.b.add(y.b) });
            const mulS = (x: { a: any; b: any }, y: { a: any; b: any }): { a: any; b: any } => ({
                a: x.a.mul(y.a).add(x.b.mul(y.b).mul(new F(inside))),
                b: x.a.mul(y.b).add(x.b.mul(y.a))
            });
            const scaleS = (x: { a: any; b: any }, f: any): { a: any; b: any } => ({ a: x.a.mul(f), b: x.b.mul(f) });

            const X = { a: p, b: real_q };
            const X2 = mulS(X, X);
            const X3 = mulS(X2, X);

            const term0 = { a: MLeft_frac, b: ZERO };
            const term1 = scaleS(X, VLeft_frac);
            const term2 = scaleS(X2, wL_frac.div(new F(2)).neg());
            const term3 = scaleS(X3, wL_frac.sub(wR_frac).div(new F(6).mul(alpha)));

            const M_obj = addS(addS(term0, term1), addS(term2, term3));
            const ma = M_obj.a, mb = M_obj.b;

            // CALC-006: The moment-VALUE surd polynomial is far less robust than the
            // root LOCATION surd. M(x*) is a cubic in x* = p + q√inside, so its
            // coefficients (ma, mb) are products of high-degree fractions whose
            // numerators/denominators routinely exceed FRAC_SAFE_LIMIT — when they do,
            // the bounded-rational fallback fires and `ma`/`mb` pick up `approx=true`,
            // making the displayed surd FICTIONAL. Even when they stay exact, the
            // float reconstruction `ma.fl() + mb.fl()·√inside` suffers catastrophic
            // cancellation (the two operands are ~10× the result and opposite sign),
            // so its `.fl()` disagrees with the (correct) numeric M(x*) in the 3rd–4th
            // decimal. The verified-exact root LOCATION is unaffected, so the numeric
            // `maxM = M(zeroShearX)` is the accurate moment value and we keep symbolic
            // and numeric in sync by:
            //   • exposing the accurate numeric value through `.fl()` (== maxM), and
            //   • only rendering the exact surd STRING when it is provably reliable
            //     (no overflow taint AND no destructive cancellation); otherwise we
            //     honestly fall back to the numeric value rather than print a wrong
            //     "exact" radical.
            const momentTainted = ma.approx || mb.approx;
            const surdMagnitude = Math.abs(ma.fl()) + Math.abs(mb.fl() * Math.sqrt(inside));
            const cancellation = surdMagnitude > 0 &&
                Math.abs(maxM!) / surdMagnitude < 1e-6; // result lost >~6 sig digits
            const surdReliable = !momentTainted && !cancellation;
            const numericMomentStr = toFrac(Math.round(maxM! * 1e8) / 1e8);

            maxMExact = {
                exact: surdReliable,
                str: () => {
                    if (!surdReliable) return numericMomentStr.str();
                    if (inside === 0 || mb.isZero()) return ma.str();
                    if (inside === 1) return ma.add(mb).str();
                    const surd = formatSurd(mb.abs(), inside);
                    const sign = mb.n < 0 ? ' - ' : ' + ';
                    if (ma.isZero()) {
                        return mb.n < 0 ? `-${surd.str}` : surd.str;
                    }
                    return `(${ma.str()}${sign}${surd.str})`;
                },
                html: () => {
                    if (!surdReliable) return numericMomentStr.html();
                    if (inside === 0 || mb.isZero()) return ma.html();
                    if (inside === 1) return ma.add(mb).html();
                    const surd = formatSurd(mb.abs(), inside);
                    const signHtml = mb.n < 0 ? ' − ' : ' + ';
                    if (ma.isZero()) {
                        return mb.n < 0 ? `−${surd.html}` : surd.html;
                    }
                    return `<span style="white-space:nowrap;">(${ma.html()}${signHtml}${surd.html})</span>`;
                },
                // Always the accurate numeric value; the surd reconstruction is only
                // used for the display string above when it is reliable.
                fl: () => maxM
            };
        }
    }

    // Shear and moment at endpoints
    const VR = V(L);
    const MR = M(L);

    // Compute V/M sample points for plotting
    const nPts = 60;
    const vPts: { x: number; v: number }[] = [], mPts: { x: number; m: number }[] = [];
    for (let i = 0; i <= nPts; i++) {
        const x = (i / nPts) * L;
        vPts.push({ x, v: V(x) });
        mPts.push({ x, m: M(x) });
    }

    // Exact right-end values using fractions
    let MRight_frac: any, VRight_frac: any;
    if (isPartialLoad) {
        const L_phys = alpha.fl() * (L_ref_phys || 1);
        const a_phys = Math.min(lastSpanLoadStop, L_phys);
        const a_n = toFrac(a_phys / (L_ref_phys || 1));
        const a2 = a_n.mul(a_n);
        const a3 = a2.mul(a_n);
        
        const w_cL = a_n.sub(a2.div(new F(2).mul(alpha)));
        const w_cR = a2.div(new F(2).mul(alpha));
        const W_tot = w_cL.mul(wL_frac).add(w_cR.mul(wR_frac));
        
        const mwb_cL = alpha.mul(a_n).sub(a2).add(a3.div(new F(3).mul(alpha)));
        const mwb_cR = a2.div(new F(2)).sub(a3.div(new F(3).mul(alpha)));
        const M_WB = mwb_cL.mul(wL_frac).add(mwb_cR.mul(wR_frac));

        VRight_frac = VLeft_frac.sub(W_tot);
        MRight_frac = MLeft_frac.add(VLeft_frac.mul(alpha)).sub(M_WB);
    } else {
        const alpha2 = alpha.mul(alpha);
        VRight_frac = VLeft_frac.sub(wL_frac.add(wR_frac).mul(alpha).div(new F(2)));
        MRight_frac = MLeft_frac
            .add(VLeft_frac.mul(alpha))
            .sub(wL_frac.mul(alpha2).div(new F(2)))
            .add(wL_frac.sub(wR_frac).mul(alpha2).div(new F(6)));
    }

    return {
        spanIdx, leftLabel: labels[spanIdx], rightLabel: labels[spanIdx + 1],
        VLeft_frac, MLeft_frac, wL_frac, wR_frac, MRight_frac, VRight_frac,
        VLeft: VL, MLeft: ML, VRight: VR, MRight: MR,
        alpha,
        zeroShearX, maxM, maxMx,
        zeroShearExact, maxMExact, exactDistFromA_HTML, exactDistFromA_Text,
        vPts, mPts, V, M,
        distFromEnd: spanIdx,
        isPartialLoad: isPartialLoad,
        loadStopDistA: a
    };
}


// ───────────────────── Exports ─────────────────────
// Canvas drawing and HTML rendering were split into beamRender.ts and
// beamHtml.ts (ARCH-01). This file exports only the mathematical core.
export { analyzeBeam, F, toFrac, ZERO, ONE, computeSpanDetails, alphaLabel, formatSurd, formatCoeffTerm, getTaperedBeamStiffness };
