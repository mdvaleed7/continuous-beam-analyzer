# Chapter 7 — Foundations

## 7.1 Function and Requirements

A foundation must transfer loads to the ground with:

1. **Adequate bearing safety** — no shear failure of soil (FoS ≈ 2.5–3 on
   ultimate bearing capacity).
2. **Tolerable settlement** — total and differential (IS 1904: e.g., 75 mm
   total for isolated footings on clay, 50 mm on sand; differential limits
   ~1/300 angular distortion for frames).
3. **Stability** — against overturning, sliding, uplift/flotation.
4. **Durability** — sulphate attack, water table effects, minimum depth below
   scour/frost/desiccation (Rankine minimum depth: Dmin = (SBC/γ)·Ka² as a
   guide only).

**Site investigation** (boreholes, SPT, lab tests per IS 1892) precedes all
foundation choices; SBC from IS 6403 (bearing capacity) + settlement checks.

## 7.2 Shallow Foundations

Depth/width ratio roughly ≤ 1–2; load spread near the surface.

### 7.2.1 Isolated (Pad) Footing — IS 456 Cl. 34

For a single column; square/rectangular, uniform thickness or sloped/stepped.

Design steps:

1. Area = Service load (+10 % self-weight allowance) / SBC.
2. Net factored upward pressure from factored loads for RC design.
3. **Bending**: critical section at **column face**; design bottom mesh both
   ways.
4. **One-way shear**: critical at **d** from column face; τv ≤ k·τc.
5. **Punching (two-way) shear**: critical at **d/2** around column;
   τv ≤ ks·(0.25 √fck) per Cl. 31.6.3.1.
6. **Development length** of column dowels and footing bars.
7. Minimum edge thickness 150 mm (Cl. 34.1.2); cover 50 mm against soil.

### 7.2.2 Combined Footing

One footing under two (or more) columns — used when columns are close, or a
column sits at a boundary. Shape proportioned so the **centroid of the footing
coincides with the resultant of column loads** → uniform pressure. Behaves as
a beam spanning between columns (longitudinal flexure + transverse strips).
Rectangular or trapezoidal (when end column load is larger/boundary-limited).

### 7.2.3 Strap (Cantilever) Footing

Boundary column footing connected by a stiff **strap beam** to an interior
footing; the strap transfers the eccentric moment so each pad sees near-uniform
pressure. Strap is designed as a beam (doesn't bear on soil).

### 7.2.4 Strip (Wall) Footing

Continuous footing under a wall or a closely spaced row of columns; designed
per metre as a transverse cantilever.

### 7.2.5 Raft (Mat) Foundation

One large slab under the entire structure. Used when:

- Isolated footings would occupy > ~50 % of plan area;
- Soil is weak/erratic (bridging local soft spots);
- Basements need a water-tight base resisting uplift.

Types: flat plate raft, thickened rafts under columns, beam-and-slab raft,
cellular raft, piled raft. Analysis: rigid method (linear pressure) for stiff
rafts, or **beam/plate on elastic foundation** (modulus of subgrade reaction
ks, e.g., Winkler springs) for flexible rafts. Punching around columns and
uplift (flotation FoS ≥ 1.2 with 0.9 DL) must be checked.

## 7.3 Deep Foundations — Piles (IS 2911)

Used when surface soils are weak/compressible, loads are heavy, uplift or
lateral capacity is needed, or scour/liquefaction dictates depth.

### 7.3.1 By Load Transfer

- **End-bearing pile** — tip resting on rock/dense stratum; Q ≈ Qb.
- **Friction pile** — capacity from shaft skin friction in cohesive/granular
  layers; Q ≈ Qs.
- Most real piles combine both: **Qu = Qb + Qs**; allowable = Qu / 2.5.

### 7.3.2 By Material and Installation

- **Driven precast RC / steel piles** — displacement piles; densify sand;
  vibration/noise issues.
- **Bored cast-in-situ piles** — replacement piles; common in Indian urban
  practice (400–1200 mm dia); minimal vibration.
- **Driven cast-in-situ**, **under-reamed piles** (bulbs, for expansive
  soils — IS 2911 Part 3), **micropiles**, **precast prestressed spun piles**.

### 7.3.3 Structural and Group Design

- Minimum longitudinal steel 0.4 % (bored piles, IS 2911); lateral ties per
  code; check as column with soil restraint (fixity depth).
- **Group efficiency**: closely spaced friction piles overlap stress zones —
  spacing typically 2.5–3.0 × diameter; block-failure check for groups in
  clay.
- **Negative skin friction (downdrag)** where fill/soft clay consolidates —
  adds load, subtracts capacity.
- **Lateral capacity** by Broms/subgrade methods; seismic passive checks;
  pile integrity + static/dynamic load testing (IS 2911 Part 4).

### 7.3.4 Pile Cap

Rigid RC block distributing column load to piles. Design by beam theory or
**strut-and-tie**; punching around column and above individual piles; minimum
overhang 100–150 mm beyond outer pile faces; piles embedded 50–75 mm plus bar
projection anchored.

## 7.4 Wells and Caissons

Large hollow shafts sunk by self-weight/grabbing — the classic bridge
foundation in Indian rivers (IS 3955 context); resist scour and large lateral
loads.

## 7.5 Foundations in Special Conditions

- **Expansive (black cotton) soils** — swell/shrink; use under-reamed piles,
  or founding below the active zone; plinth protection and flexible services.
- **Filled ground** — avoid shallow footings on uncompacted fill; ground
  improvement (dynamic compaction, stone columns, preloading) or piles.
- **High water table** — dewatering during construction; buoyancy design;
  waterproofing; sulphate-resistant concrete where aggressive.
- **Liquefiable sites** — see Chapter 6.10; found below the liquefiable
  layer or improve the ground.
- **Adjacent structures** — new excavations undermine old footings; shoring,
  underpinning, and influence-line checks required.

## 7.6 Settlement — The Serviceability Side

- **Immediate (elastic)** — sands; occurs during construction.
- **Consolidation** — clays; time-dependent pore-pressure dissipation
  (Terzaghi 1-D theory).
- **Secondary (creep)** — organic clays.
- Differential settlement is the structural killer — it induces distortion,
  cracking of walls (diagonal cracks stepping through masonry are its
  signature) and moment redistribution. Mitigate with stiffer foundations
  (raft), uniform bearing pressure, joints, or deep foundations.

## 7.7 Foundation Selection Flowchart (Practical)

1. Good soil near surface, light–moderate loads → **isolated footings**.
2. Columns close/boundary constraints → **combined/strap footings**.
3. Footings would cover > half the plan, or basement/water table → **raft**.
4. Weak soil to depth, heavy loads, uplift/lateral demands, liquefaction →
   **piles** (bored cast-in-situ typical in cities).
5. Rivers/scour/very large bridges → **well foundations/caissons**.
