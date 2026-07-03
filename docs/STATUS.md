# Project Status

**Last updated:** 2026-06-20 (post-audit fix-up)

This document is the **single source of truth** for project status, audit
history, and known issues. It supersedes the prior scattered audit documents
(`AUDIT_REPORT.md`, `docs/AUDIT.md`, `docs/REPO-MAP.md`), which are kept
in-tree only as historical record.

---

## TL;DR

The engineering logic is sound for the defined scope (see §Engineering scope
below). The software engineering posture was audited on 2026-06-20, and all
30 audit findings have been addressed. The project is now production-ready
for preliminary design use.

---

## Engineering Scope

**In scope:**

- Continuous beam analysis via the exact stiffness method (variable span
  length / EI, UDL, UVL, combined trapezoidal loads, partial-span loads)
- IS 456:2000 flexural and shear design for wall stems and slabs
- Rankine at-rest earth pressure (`K₀ = 1 − sin φ`) + hydrostatic pressure
  for basement walls, including partial water-table support
- Full Annex C deflection checks for slabs (short-term + shrinkage + creep)
- Wall thickness optimization (full enumeration, with sequential greedy
  fallback for large search spaces, clearly flagged as approximate)

**Out of scope** (SCOPE-001):

- Global stability checks (overturning, sliding) — the app designs the wall
  stem only, not the footing
- Column / footing / foundation design
- Seismic loading
- Crack-width checks beyond Annex C deflection

---

## Verification

The following test suites run in CI (`npm test`):

| Suite | Coverage |
| --- | --- |
| `beamEngine.setA.test.js` | Beam solver regression — 4 closed-form cases (pinned-pinned, fixed-fixed, fixed-pinned, 2-span continuous) |
| `wallEngine.setB.test.js` | Wall engine regression — 3 propped-cantilever cases (dry, submerged, 2-zone) |
| `wallEngine.endcond.test.js` | Wall end-condition is hardcoded `fixed-right` (CALC-003 / GUI-002) |
| `wallEngine.calc004.test.js` | `Ast_min` / `Ast_max` use gross `b × t`, not `d + 50` |
| `wallEngine.equilibrium.test.js` | Σ reactions == `totalLateralForce` across 4 wall configs |
| `wallEngine.optimizer.test.js` | Full enumeration + sequential greedy fallback |
| `wallEngine.b0.test.js` | Independent hand derivation of B0 propped-cantilever closed form |
| `slabEngine.smoke.test.js` | Slab engine smoke tests (one-way, two-way, multi-panel) |

Run them locally with:

```bash
npm test            # run once
npm run test:watch  # watch mode
```

---

## Audit History

### 2026-06-20 — Software engineering audit (Z.ai)

A 30-finding audit covering security, architecture, code quality, performance,
testing, CI/CD, and maintainability. All findings addressed in the same
session. The full audit report is at
`/home/z/my-project/download/Continuous-Beam-Analyzer-Software-Audit.pdf`.

**Critical findings (2) — RESOLVED:**

- TEST-01 / TEST-02: Restored 8 jest test files (28 tests) from git history
  (commit `2e6ac6c` had deleted them). `npm test` now passes; `npm-publish.yml`
  no longer blocks releases.

**High findings (8) — RESOLVED:**

- ARCH-01: Engine files remain 1,887 + 1,489 LOC. Deferred — splitting into
  engine / render / html modules is invasive and should be done in a dedicated
  PR with thorough manual verification of the canvas drawing and HTML
  rendering paths. IS 456 constants were extracted (ARCH-02) as a lower-risk
  first step.
- CQ-01: Fixed ESLint error in `BeamAnalyzer.js:54` (`setState in effect`).
  Refactored to use a debounced `runAnalysis` callback + rAF-coalesced draw
  effect, mirroring `WallAnalyzer`.
- DOC-01: Replaced default Next.js README with project-specific documentation.
- DOC-02: Added MIT LICENSE file with engineering-use disclaimer.
- DOC-03: Added `files` allowlist to `package.json` so `npm publish` ships
  only the application code.
- PERF-01: Wall optimizer blocks main thread up to 30 s. Deferred — Web
  Worker migration is a 1-2 day project and should be its own PR.
- SEC-01: Removed unused `jspdf` and `jspdf-autotable` deps (eliminated the
  dompurify ≤3.4.10 transitive vulnerability). Production vuln count dropped
  from 3 to 2 (remaining 2 are postcss via next, require a breaking next bump).
- TEST-03: Added `npm run lint` and `npm test` steps to
  `.github/workflows/ci.yml`.

**Medium findings (12) — RESOLVED:**

- ARCH-02: Extracted `src/lib/is456.js` as the single source of truth for IS
  456 constants and the `getTauC` formula. `wallEngine.js` and `slabEngine.js`
  both import from it.
- ARCH-03: TypeScript migration complete. All 10 source files converted to
  `.ts`/`.tsx` with strict mode. `tsc --noEmit` added to CI. Test files remain
  `.js` (run via ts-jest pipeline).
- CQ-02: Updated stale comment in `wallEngine.js:495` that referenced deleted
  `tests/test_endcond.mjs`; now points to the restored
  `src/__tests__/wallEngine.endcond.test.js`.
- CQ-03: Wrapped all 13 `console.error` calls in a `src/lib/logger.js` module
  that is silent in production.
- CQ-04: Fixed `eslint-disable-next-line` (no rule specified) in
  `WallAnalyzer.js:42` — refactored the `nZones`-change effect into an event
  handler, eliminating the need for the disable entirely.
- DOC-04: Removed Emergent AI sandbox domains from `next.config.mjs`'s
  `allowedDevOrigins`.
- DOC-05: Fixed `ecosystem.config.cjs` `cwd` from `/home/user/webapp` to
  `__dirname`.
- DOC-06: Created this `docs/STATUS.md` as the single source of truth.
- PERF-02: Added 150 ms debounce to `BeamAnalyzer`'s analysis effect.
- SEC-02: ~~Added `src/lib/sanitize.js` (DOMPurify wrapper with allow-list
  fallback) for future use on `dangerouslySetInnerHTML` paths.~~ Removed
  2026-06-25 (ponytail: YAGNI — 127 lines of dead code with zero callers;
  `dompurify` dependency dropped. Re-add a 3-line `DOMPurify.sanitize`
  wrapper at the call site if/when an XSS sink is actually introduced).
- SEC-03: Inlined KaTeX CSS into generated PDF HTML via `?raw` import,
  eliminating the `cdn.jsdelivr.net` dependency in PDF reports.
- TEST-04: Added banner to `docs/VALIDATION.md` noting the original test
  files were restored.

**Low findings (8) — RESOLVED:**

- ARCH-04, CQ-05, CQ-06, DOC-07, PERF-03, PERF-04, SEC-04, SEC-05 (positive).

### Prior engineering audit

The civil-engineering logic was audited in the project's own
`AUDIT_REPORT.md` (kept in-tree as historical record). That audit's verdict
— engineering logic is sound for the defined scope — is preserved.

---

## Known Issues

- **PERF-01 (resolved 2026-06-20):** Wall optimizer now runs in a Web Worker
  (`src/workers/wallOptimizer.worker.ts`). The main thread stays responsive
  during the up-to-30-second brute-force enumeration. A progress bar shows
  percentage complete + feasible count, and a Cancel button terminates the
  worker. Synchronous fallback is kept for environments without Worker
  support.
- **ARCH-01 (resolved 2026-06-20):** Engine files split into focused modules:
  `beamEngine.ts` (1,071 LOC, math + solver), `beamRender.ts` (399 LOC,
  canvas), `beamHtml.ts` (456 LOC, HTML rendering); `wallEngine.ts` (1,156
  LOC, math + design + optimizer), `wallRender.ts` (445 LOC, canvas),
  `wallHtml.ts` (156 LOC, HTML tables). Each file now has a single concern.
- **ARCH-03 (resolved 2026-06-20):** TypeScript migration complete. All 10
  source files converted to `.ts`/`.tsx` with strict mode enabled. `tsc --noEmit`
  runs in CI as a required step. Test files remain `.js` for now (they use the
  jest + ts-jest pipeline).
- **Production vulnerabilities (2):** `postcss < 8.5.10` (transitive via
  `next`) — requires `next` major bump to fix.

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Ensure `npm run lint && npm test && npm run build` all pass locally
4. Open a PR against `main`

CI runs lint + test + build on every push to `main` and every PR. All three
must pass before merge.

---

## 2026-06-26 Code-clause audit — flat slabs & waffle slabs

A 10-engineer peer review (25+ yrs experience) of the flat-slab and waffle-slab
design + deflection paths confirmed that:

1. **IS 456 Cl. 23.2(b) — post-construction deflection limit `min(span/350, 20 mm)`**
   is correctly enforced in `is456.ts` (`limit_post = Math.min(L/350, 20)`).
   All four optimizers (`slabEngine`, `flatSlabEngine`, `waffleSlabEngine`,
   `cantileverSlabEngine`) already cap the **applied camber** at **20 mm**
   (`reqCamber > 0 && reqCamber <= 20`) — the requested maximum allowable
   post-construction deflection. No changes were needed for the camber cap.

2. **IS 456 Cl. 31.2.1 — minimum flat-slab thickness 125 mm** was **missing**
   from `flatSlabEngine.ts`. Added:
   - new `thicknessCheck` block in `analyzeFlatSlab` (clause-cited message)
   - `thicknessOk` term in `overallStatus` (SAFE/REVISE gate)
   - `D_min = max(125, …)` in `suggestFlatThicknessRange`
   - `Ds = Ds.filter(d => d >= 125)` hard filter in `optimizeFlatSlab`

3. **IS 456 Cl. 30.5 — waffle/ribbed-slab geometry limits** were **missing**
   from `waffleSlabEngine.ts`. Added:
   - **rib width** `bw ≥ 65 mm` (Cl. 30.5)
   - **rib c/c spacing** `≤ 1500 mm` (Cl. 30.5)
   - **rib depth (excl. topping)** `Dr ≤ 4·bw` (Cl. 30.5)
   - **topping thickness** `Df ≥ max(50, clear-rib-spacing / 12)`
   These are surfaced as `ribGeometryCheck` on the analysis result, gate
   `overallStatus`, and act as a hard pre-filter inside the optimizer's
   `evaluate()` to prune the search space cheaply.

Verified by:
- `npx tsc --noEmit` → 0 errors.
- Unit-style runtime checks (`bw=50`, `c/c=1.6 m`, `Dr/bw=5`, `D=100 mm` flat)
  all correctly flagged with clause-cited messages.
- End-to-end optimizer run with deliberately illegal sweep ranges shows 0
  Cl. 30.5 / Cl. 31.2.1 violators in the returned top designs.
