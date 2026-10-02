# Chapter 4 — Mechanics and Structural Behaviour

## 4.1 Stress, Strain and Material Laws

- **Stress** σ = P/A (N/mm²); **strain** ε = δL/L (dimensionless).
- **Hooke's law**: σ = E·ε within the elastic range.
- Concrete: Ec = 5000 √fck (IS 456 Cl. 6.2.3.1); design stress block peaks at
  0.446 fck with ultimate compressive strain 0.0035 (Cl. 38.1).
- Steel: Es = 2 × 10⁵ N/mm²; design yield = 0.87 fy; strain at design yield
  (Fe 415) = 0.87×415/Es + 0.002 = 0.0038.
- **Poisson's ratio**: ~0.2 (concrete), 0.3 (steel).
- **Characteristic strength**: value below which not more than 5 % of test
  results fall (fck from 150 mm cubes at 28 days).
- **Partial safety factors** (Cl. 36.4.2): γm = 1.5 (concrete), 1.15 (steel).

## 4.2 Bending (Flexure)

### 4.2.1 Bending Theory

Simple bending: **M/I = σ/y = E/R**. Section modulus Z = I/y; elastic bending
stress σ = M/Z.

### 4.2.2 Limit State Flexure (IS 456 Annex G)

Neutral axis: xu/d = 0.87 fy Ast / (0.36 fck b d).

- **Under-reinforced** (xu < xu,max): steel yields first → **ductile**,
  desirable failure with warning (cracking, deflection).
- **Over-reinforced** (xu > xu,max): concrete crushes first → **brittle**,
  prohibited in design.
- **Balanced**: simultaneous — the boundary case (xu,max/d = 0.53, 0.48, 0.46
  for Fe 250, 415, 500).

Moment of resistance (under-reinforced):
**Mu = 0.87 fy Ast d (1 − fy Ast / (fck b d))**.

## 4.3 Shear

- Nominal shear stress τv = Vu/(bd); concrete capacity τc from IS 456 Table 19
  (function of pt = 100Ast/bd and grade); absolute ceiling τc,max (Table 20:
  2.8, 3.1, 3.5, 3.7, 4.0 N/mm² for M20–M40).
- Shear failure is **diagonal tension** — cracks at ~45°; brittle and sudden,
  hence stirrups (shear reinforcement) are detailed even when not strictly
  required (minimum stirrups Cl. 26.5.1.6: Asv/(b·sv) ≥ 0.4/(0.87 fy)).
- Critical section for beams: at distance **d** from support face
  (Cl. 22.6.2) when support reaction induces compression.

## 4.4 Torsion (IS 456 Cl. 41)

Torsion in RC design is converted into equivalent shear and moment:
Ve = Vu + 1.6 Tu/b; Me = Mu + Tu(1 + D/b)/1.7. Requires closed stirrups and
longitudinal corner bars. Common in edge beams, curved beams, and beams
supporting cantilevers.

## 4.5 Bond, Anchorage and Development Length

Development length **Ld = φ σs / (4 τbd)** (Cl. 26.2.1); τbd from Cl. 26.2.1.1
(1.2–1.9 N/mm² for M20–M40, ×1.6 for deformed bars, ×1.25 for compression).
For Fe 415 in M20: Ld ≈ 47φ. Laps, hooks and bends per Cl. 26.2.2/26.2.5.
Curtailment rules: extend 12φ or d beyond theoretical cut-off (Cl. 26.2.3).

## 4.6 Deflection and Serviceability

- Final deflection limit: **span/250** (total, after construction span/350 or
  20 mm for partitions) — Cl. 23.2.
- Control by span/effective-depth ratios (Cl. 23.2.1) with modification
  factors for tension steel stress fs = 0.58 fy (Ast,reqd/Ast,provided),
  compression steel, and flanged sections.
- Long-term deflection adds **creep and shrinkage** components (Annex C).
- **Crack width limit**: 0.3 mm general, 0.2 mm severe exposure, 0.1 mm water
  retaining (IS 3370).

## 4.7 Buckling and Stability

- **Euler load**: Pcr = π²EI/le² — slender members fail by instability below
  material strength.
- Effective length le depends on end restraint (IS 456 Table 28): fixed–fixed
  0.65L, fixed–pinned 0.8L, pinned–pinned 1.0L, fixed–free 2.0L.
- RC columns: slender if le/D > 12; additional moment method (Cl. 39.7.1):
  Ma = (Pu D/2000)(le/D)².
- Steel members: flexural, torsional and lateral-torsional buckling per
  IS 800 Section 7 & 8 (imperfection-based buckling curves a–d).

## 4.8 Determinate vs Indeterminate Structures

| Aspect | Determinate | Indeterminate |
|---|---|---|
| Equilibrium equations | Sufficient | Insufficient — need compatibility |
| Examples | Simply supported beam, cantilever, three-hinged arch | Fixed/continuous beams, frames, two-hinged arch |
| Support settlement/temperature | No stresses induced | Induces stresses |
| Redundancy | None — one failure = collapse | Redistribution possible; more robust |
| Analysis | Statics alone | Force/displacement methods, matrix/FEM |

**Degree of static indeterminacy** (plane frame): Ds = 3m + r − 3j − releases.

## 4.9 Moment Redistribution (IS 456 Cl. 37.1.1)

Up to **30 %** redistribution of elastic moments is permitted in continuous
members provided xu/d ≤ 0.6 − ΔM/100 at sections where moment is reduced —
exploits ductility, evens out peak hogging moments and relieves congestion.

## 4.10 Structural Analysis Toolbox

- **Moment distribution (Hardy Cross)** — iterative balancing of joint
  moments using stiffness and carry-over factors; ideal for hand analysis of
  continuous beams/frames.
- **Slope-deflection / stiffness method** — displacement unknowns; basis of
  matrix and FE software.
- **Substitute frame** (IS 456 Cl. 22.4.2) — analyse one floor with columns
  fixed above and below for gravity design.
- **Pattern loading** (Cl. 22.4.1): DL everywhere + LL on alternate/adjacent
  spans for maximum span/support moments.
- **Portal & cantilever methods** — approximate lateral analysis of frames.

## 4.11 Ductility, Redundancy and Robustness

- **Ductility** — capacity to deform beyond yield without losing strength;
  achieved by under-reinforced sections, confinement, strong-column
  weak-beam.
- **Redundancy** — alternative load paths; indeterminate systems survive
  local damage.
- **Robustness** — insensitivity to disproportionate collapse; ties,
  continuity and anchorage (IS 456 Cl. 26 detailing culture).
