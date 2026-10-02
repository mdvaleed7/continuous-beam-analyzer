# Chapter 1 — Basic Structural Elements

## 1.1 Introduction

Every structure, however complex, is assembled from a small family of basic
elements: **beams, columns, slabs, walls, and foundations**. Each element is
defined by the way it carries load — bending, axial force, shear, or a
combination — and understanding that primary action is the key to designing it.

| Element | Primary Action | Typical Failure Modes |
|---|---|---|
| Beam | Flexure (bending) + shear | Flexural yielding, shear failure, deflection |
| Column | Axial compression (± bending) | Crushing, buckling, combined P–M failure |
| Slab | Two-way / one-way flexure | Flexural cracking, punching shear, deflection |
| Wall | In-plane shear + axial (shear walls); out-of-plane flexure (retaining/basement) | Shear sliding, flexural cracking, overturning |
| Foundation | Bearing + flexure + punching | Bearing failure, settlement, punching shear |

## 1.2 Beams

### 1.2.1 Definition and Behaviour

A **beam** is a horizontal (or inclined) member that carries transverse loads
primarily by **bending and shear**. Load applied between supports produces a
bending moment diagram (BMD) and a shear force diagram (SFD); the beam's cross
section must resist both.

### 1.2.2 Classification by Support Condition

- **Simply supported beam** — resting on two supports; maximum sagging moment
  at midspan: M = wL²/8 for UDL.
- **Cantilever beam** — fixed at one end, free at the other; maximum hogging
  moment at the fixed end: M = wL²/2 for UDL. Deflection-critical.
- **Fixed beam** — both ends restrained; end moments wL²/12, midspan wL²/24.
- **Continuous beam** — spans over three or more supports; hogging moments over
  interior supports, sagging in spans. IS 456 Table 12 gives moment
  coefficients for approximately equal spans.
- **Overhanging beam** — simply supported with one or both ends projecting
  beyond the support.

### 1.2.3 Classification by Cross-Section Role (RC)

- **Singly reinforced** — tension steel only; economical when Mu ≤ Mu,lim.
- **Doubly reinforced** — tension + compression steel; used when section depth
  is restricted and Mu > Mu,lim.
- **Flanged beams (T / L)** — slab acts as compression flange with the beam web
  (IS 456 Cl. 23.1.2 gives effective flange width).

### 1.2.4 Key IS 456 Provisions for Beams

- **Limiting moment of resistance** (Cl. 38.1, Annex G):
  - Fe 415: Mu,lim = 0.138 fck b d²  (xu,max/d = 0.48)
  - Fe 500: Mu,lim = 0.133 fck b d²  (xu,max/d = 0.46)
- **Minimum tension steel** (Cl. 26.5.1.1): Ast,min = 0.85 b d / fy
- **Maximum steel**: 4 % of gross area (tension or compression)
- **Shear design** (Cl. 40): τv = Vu/(b d) compared with τc (Table 19);
  τv must never exceed τc,max (Table 20). Provide vertical stirrups per
  Cl. 40.4: Vus = 0.87 fy Asv d / sv.
- **Deflection control** (Cl. 23.2.1): basic span/effective-depth ratios —
  cantilever 7, simply supported 20, continuous 26 — modified for tension steel
  stress and percentage, compression steel and flanged action.
- **Side face reinforcement** (Cl. 26.5.1.3): required when depth of web
  exceeds 750 mm — 0.1 % of web area, distributed on two faces.

### 1.2.5 Lintels, Plinth Beams, Grade Beams and Tie Beams

- **Lintel** — small beam over a door/window opening, carrying masonry above
  (triangular load dispersion at 45°–60° is commonly assumed).
- **Plinth beam** — beam at plinth level tying columns together, supporting
  ground-floor walls and reducing column effective length.
- **Grade beam** — beam at or below grade spanning between pile caps or
  footings, carrying wall loads to discrete foundations.
- **Tie beam** — beam provided purely to connect columns/footings (often at
  mid-height of tall ground storeys) to reduce slenderness and differential
  settlement effects.

## 1.3 Columns

### 1.3.1 Definition and Behaviour

A **column** is a vertical compression member transferring loads from beams and
slabs down to the foundation. IS 456 defines a column as a compression member
whose effective length exceeds three times its least lateral dimension (else it
is a **pedestal**).

### 1.3.2 Short vs Slender Columns (IS 456 Cl. 25.1.2)

- **Short column**: both slenderness ratios (lex/D and ley/b) ≤ 12. Strength
  governed by material capacity.
- **Slender (long) column**: slenderness > 12. Additional moments due to
  P–Δ effect must be considered (Cl. 39.7).
- Maximum unsupported length: 60 × least lateral dimension (Cl. 25.3.1).

### 1.3.3 Loading Cases

- **Axially loaded**: Pu = 0.4 fck Ac + 0.67 fy Asc (Cl. 39.3, valid when
  minimum eccentricity does not exceed 0.05D).
- **Minimum eccentricity** (Cl. 25.4): e,min = L/500 + D/30 ≥ 20 mm.
- **Uniaxial bending**: designed with P–M interaction charts (SP 16).
- **Biaxial bending** (Cl. 39.6): (Mux/Mux1)^αn + (Muy/Muy1)^αn ≤ 1.0.

### 1.3.4 Reinforcement Rules (Cl. 26.5.3)

- Longitudinal steel: 0.8 % to 6 % of gross area (4 % practical max for lap
  congestion); minimum 4 bars in rectangular, 6 in circular columns; minimum
  bar diameter 12 mm.
- Lateral ties: diameter ≥ ¼ of largest longitudinal bar and ≥ 6 mm; pitch ≤
  least of (least lateral dimension, 16 × smallest longitudinal bar diameter,
  300 mm).
- Helical reinforcement (Cl. 39.4) permits 5 % higher load if the helix
  satisfies Cl. 26.5.3.2(d).

### 1.3.5 Special Column Types

- **Pedestal** — height ≤ 3 × least lateral dimension; nominal reinforcement
  0.15 % of cross-sectional area.
- **Composite column** — structural steel section encased in or filled with
  concrete.
- **Stub column** — a short column, often between floor and a deep beam or in
  grillage testing contexts.
- **Floating column** — a column that terminates on a beam (transfer beam)
  instead of continuing to the foundation. **Strongly discouraged in seismic
  zones** — it interrupts the load path and creates a soft/weak storey hazard
  (IS 1893 lists it as a plan/vertical irregularity concern).

## 1.4 Walls

### 1.4.1 Load-Bearing vs Non-Load-Bearing

- **Load-bearing wall** — carries vertical loads from floors/roof (masonry
  buildings per IS 1905, or RC walls per IS 456 Cl. 32).
- **Partition wall** — non-structural; only its self-weight matters (applied
  as line load or as equivalent uniform load per IS 875 Part 2).

### 1.4.2 Shear Wall

A vertical RC element resisting **lateral (wind/earthquake) forces in its own
plane** through cantilever bending and shear. Behaves as a deep vertical
cantilever fixed at the foundation.

- Governing code: IS 13920:2016 Cl. 10 (ductile detailing).
- Minimum thickness 150 mm (200 mm for buildings with coupled shear walls).
- Distributed reinforcement ≥ 0.25 % in each direction, each face if
  t > 200 mm or τv > 0.25√fck.
- **Boundary elements** required where extreme fibre compressive stress
  exceeds 0.2 fck.
- Best placed symmetrically in plan to minimise torsion; ideally continuous
  from foundation to roof.

### 1.4.3 Retaining Wall

Retains earth (or other material) with a level difference on its two faces.

- **Gravity wall** — stability by self-weight alone (masonry/plain concrete);
  economical up to ~3 m.
- **Cantilever wall** — RC stem + base slab (heel and toe); economical 3–7 m.
  Stability checks: overturning FoS ≥ 1.4, sliding FoS ≥ 1.4 (IS 456
  Cl. 20), bearing pressure ≤ SBC with resultant preferably within middle
  third (e ≤ B/6).
- **Counterfort wall** — cantilever wall stiffened by triangular counterforts
  on the earth side; economical above ~7 m.
- **Buttress wall** — like counterfort but with stiffeners on the exposed face.
- Earth pressure by **Rankine** or **Coulomb** theory:
  Ka = (1 − sin φ)/(1 + sin φ) for active pressure on a vertical smooth wall
  with level backfill.
- **Drainage (weep holes, granular backfill)** is essential — water pressure
  can easily double the lateral thrust.

### 1.4.4 Basement Wall

An RC wall retaining earth while propped at top (ground-floor slab) and bottom
(raft/base slab). It spans vertically as a **propped or two-span member**
rather than a free cantilever, so moments are much smaller than a retaining
wall of the same height. Designed for at-rest pressure (K0 = 1 − sin φ) since
wall movement is restrained, plus surcharge and water pressure with
waterproofing considerations.

## 1.5 Foundations (Overview)

Foundations transfer structural loads safely to the ground without shear
failure of soil or excessive settlement. Chapter 7 covers them in depth;
in summary:

- **Shallow foundations** (D/B ≤ 1–2): isolated footings, combined footings,
  strip footings, strap footings, rafts.
- **Deep foundations**: piles (end-bearing/friction), pile caps, wells/caissons.

## 1.6 Load Path — The Golden Rule

Loads must travel by a **complete, continuous and direct path**:

**Slab → Beam → Column → Foundation → Soil**

Every design should be checked by walking the load down this chain. Breaks in
the path (floating columns, discontinued shear walls, offset columns) create
force concentrations and are the most common cause of failure in earthquakes.

## 1.7 Quick Reference — Element Design Checks

| Element | Strength Checks | Serviceability Checks |
|---|---|---|
| Beam | Flexure (Mu ≤ MuR), shear, torsion, development length | Deflection (L/d), crack width, spacing rules |
| Column | P–M interaction, biaxial check, slenderness | Minimum eccentricity, tie detailing |
| Slab | Flexure, one/two-way shear | Deflection (modified L/d), crack control |
| Shear wall | In-plane flexure + shear, boundary elements | Drift limits, detailing per IS 13920 |
| Retaining wall | Overturning, sliding, bearing, stem/heel/toe flexure & shear | Crack width (water face), drainage |
| Footing | Bearing pressure, one-way & punching shear, flexure | Settlement (total & differential) |
