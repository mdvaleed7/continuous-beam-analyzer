# Continuous Beam Analyzer

A Next.js single-page application providing three independent structural-engineering
tools, all running entirely client-side:

1. **Continuous Beam Analyzer** — exact-symbolic stiffness-method solver for
   multi-span beams with variable span length / EI, UDL, global / per-span UVL,
   and combined trapezoidal loads.
2. **Basement Wall Designer** — vertical wall strip modeled as a continuous
   beam, using Rankine at-rest earth pressure (`K₀ = 1 − sin φ`) plus
   hydrostatic pressure, then designed per **IS 456:2000**. Includes
   zone-by-zone thickness optimization.
3. **Slab Designer** — IS 456 slab design for two-way restrained, one-way, and
   cantilever slabs, with multi-panel support and full Annex C deflection
   checks (short-term + shrinkage + creep).

All computation is performed in the browser. PDF reports are generated
in-browser via KaTeX-rendered HTML and the native print pipeline — no server
required.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19.2.4 |
| Language | TypeScript (strict mode) |
| Math rendering | KaTeX 0.17 |
| Math engine | Custom `Fraction` class with bounded-rational fallback, symbolic surd factorization, exact Gaussian elimination |
| Testing | Jest 30 + Testing Library + ts-jest |
| Linting | ESLint 9 + `eslint-config-next` |
| Type checking | `tsc --noEmit` (strict mode, enforced in CI) |
| Deployment | Vercel (or any static host) |

---

## Getting Started

```bash
npm install        # install dependencies
npm run dev        # start dev server on http://localhost:3000
```

### Production build

```bash
npm run build
npm start
```

### PM2 deployment

```bash
pm2 start ecosystem.config.cjs
```

The `ecosystem.config.cjs` file uses `cwd: __dirname`, so it works from any
clone location.

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx             # Root layout, fonts, metadata
│   └── page.tsx               # Tab switcher (Beam / Wall / Slab)
├── components/
│   ├── BeamAnalyzer.tsx       # React shell for beam mode
│   ├── WallAnalyzer.tsx       # React shell for wall mode (uses optimizer worker)
│   ├── SlabAnalyzer.tsx       # React shell for slab mode
│   ├── beamEngine.ts          # Fraction + LinExpr + Gaussian solver + stiffness method (math core)
│   ├── beamRender.ts          # Canvas drawing: beam diagram, SFD, BMD
│   ├── beamHtml.ts            # HTML rendering: reactions, span cards, validation, numeric results
│   ├── wallEngine.ts          # IS 456 wall design + pressure mesh + optimizer (math core)
│   ├── wallRender.ts          # Canvas drawing: wall diagram, pressure profile, SFD/BMD
│   ├── wallHtml.ts            # HTML tables: design summary, optimization results
│   ├── slabEngine.ts          # IS 456 Table 26 coefficients + flexural design + Annex C deflection
│   ├── wallReportGenerator.ts # Wall PDF report (KaTeX HTML + iframe print)
│   └── slabReportGenerator.ts # Slab PDF report
├── workers/
│   └── wallOptimizer.worker.ts # Web Worker for wall thickness optimization (PERF-01)
├── lib/
│   ├── is456.ts               # Shared IS 456 constants and formulas (single source of truth)
│   ├── inputUtils.ts          # parseNumber + parseIntBounded
│   ├── logger.ts              # Production-silent console wrapper
│   └── sanitize.ts            # DOMPurify wrapper for innerHTML / dangerouslySetInnerHTML
└── __tests__/
    ├── beamEngine.setA.test.js     # Beam solver regression (4 closed-form cases)
    ├── wallEngine.setB.test.js     # Wall engine regression (3 propped-cantilever cases)
    ├── wallEngine.endcond.test.js # Wall end-condition is no-op (CALC-003 / GUI-002)
    ├── wallEngine.calc004.test.js # Ast_min/Ast_max use gross b×t, not d+50
    ├── wallEngine.equilibrium.test.js # Σ reactions == totalLateralForce
    ├── wallEngine.optimizer.test.js  # Full enumeration + sequential fallback
    ├── wallEngine.b0.test.js     # B0 independent hand derivation
    └── slabEngine.smoke.test.js  # Slab engine smoke tests
```

---

## Engineering Scope

**In scope:**

- Continuous beam analysis via the exact stiffness method
- IS 456:2000 flexural and shear design for wall stems and slabs
- Rankine at-rest earth pressure + hydrostatic pressure for basement walls
- Full Annex C deflection checks for slabs
- Wall thickness optimization (full enumeration or sequential greedy fallback)

**Out of scope** (per `docs/STATUS.md` → SCOPE-001):

- Global stability checks (overturning, sliding) — the app designs the wall
  stem only, not the footing
- Column / footing / foundation design
- Seismic loading
- Crack-width checks beyond Annex C deflection

---

## Testing

```bash
npm test            # run all tests once
npm run test:watch  # watch mode
```

The test suite covers:

- **Set A — beam solver regression**: pinned-pinned, fixed-fixed, fixed-pinned,
  and 2-span continuous UDL, validated against closed-form coefficients
  (`wL²/8`, `wL²/12`, `5wL/8`, etc.).
- **Set B — wall engine regression**: single-zone dry, single-zone submerged,
  and 2-zone walls validated against closed-form propped-cantilever solutions.
- **End-condition regression**: confirms `analyzeWall` ignores
  `config.endCond` (the wall's boundary condition is a physical property, not
  a user choice — see the long comment in `wallEngine.js`).
- **CALC-004**: `Ast_min` / `Ast_max` use the gross `b × t`, not `d + 50`.
- **GUI-004 equilibrium**: Σ reactions == totalLateralForce across multiple
  wall configurations.
- **Optimizer**: full enumeration + sequential greedy fallback both complete
  without crashing.
- **B0 hand derivation**: independent re-derivation of the propped-cantilever
  closed form, compared against engine output.

---

## Type Checking

```bash
npm run typecheck    # tsc --noEmit (strict mode)
```

CI runs typecheck as a required step on every push and PR.

## Linting

```bash
npm run lint
```

CI runs lint + typecheck + test + build on every push to `main` and every PR.
All four must pass before merge.

---

## Deployment

### Vercel (recommended)

Import the repo at [vercel.com/new](https://vercel.com/new). No configuration
needed — Vercel auto-detects Next.js.

Set `NEXT_PUBLIC_APP_URL` in your Vercel project env vars to the deployment
URL (used for OpenGraph metadata).

### Other platforms

Any platform that can run `npm run build && npm start` will work. For PM2:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## Documentation

- `docs/STATUS.md` — single source of truth for project status, audit history,
  and known issues (replaces the prior scattered audit documents)
- `docs/REPO-MAP-VERIFIED.md` — verified repository map
- `CHANGELOG.md` — change history

---

## License

MIT — see [LICENSE](./LICENSE). The license includes an engineering-use
disclaimer: outputs are for preliminary design only and must be independently
verified by a qualified licensed engineer.

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Ensure `npm run lint && npm run typecheck && npm test && npm run build` all pass locally
4. Open a PR against `main`

CI will run lint + typecheck + test + build on your PR. All four must pass before merge.
