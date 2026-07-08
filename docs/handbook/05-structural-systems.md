# Chapter 5 — Structural Systems

## 5.1 Introduction

A **structural system** is the assembly of elements that together carry gravity
and lateral loads to the ground. The gravity system (slabs, beams, columns,
walls) and the lateral system (frames, shear walls, braces, cores) may share
members or be separate. System selection depends on height, span, seismic zone,
architecture and economics.

## 5.2 Load-Bearing Masonry System

Walls carry both gravity and lateral loads (IS 1905 / SP 20).

- Economical up to ~3–4 storeys; wall thickness grows with height.
- Openings weaken walls; layout must be regular and walls continuous to the
  foundation.
- In seismic zones, needs horizontal bands — **plinth band, lintel band, roof
  band** — and vertical bars at corners/jambs per **IS 4326**; this
  "confined-masonry-like" detailing dramatically improves earthquake
  performance.
- Slow construction, heavy, poor tension capacity — largely superseded by RC
  frames for anything above low-rise.

## 5.3 RC Moment-Resisting Frame (MRF)

Beams and columns rigidly connected; resist lateral load through **flexure of
members and joints**.

- **OMRF (Ordinary MRF)** — detailed per IS 456 only; R = 3.0. **Not permitted
  in Zones III, IV and V** (IS 1893:2016 Table 9).
- **SMRF (Special MRF)** — ductile detailing per **IS 13920**; R = 5.0.
  Mandatory for RC frames in Zones III–V.
- Behaviour: frames deform in **shear mode** (storey drift largest near the
  base); flexible → drift often governs in taller frames (economical roughly
  up to 10–20 storeys alone).
- Key design culture: **strong column–weak beam** (ΣMc ≥ 1.4 ΣMb, IS 13920
  Cl. 7.2), joint shear checks, capacity-based shear design of beams and
  columns.

## 5.4 Braced Frame (Steel)

Diagonal members convert lateral load into **axial forces** — very stiff and
material-efficient.

- **Concentric braced frames (CBF)**: X, V, inverted-V (chevron), diagonal —
  braces meet at member ends; stiff but braces buckle in compression.
- **Eccentric braced frames (EBF)**: braces offset to create a ductile
  shear/flexural "link" beam — combines stiffness with ductility.
- Bracing interferes with openings; usually placed in cores, end bays or
  expressed architecturally.

## 5.5 Shear Wall System

RC walls act as vertical cantilevers (Chapter 1.4.2).

- Deform in **bending mode** (drift largest at top).
- Very stiff at lower storeys — excellent for controlling drift and protecting
  non-structural elements.
- **Bearing wall system** (walls carry gravity too): R = 4.0 (ductile walls).
  Walls + SMRF as a **dual system**: R = 5.0.
- Placement rules: symmetric in plan (avoid torsion), continuous to
  foundation (never terminate on columns), preferably at the perimeter or
  around service cores.

## 5.6 Dual System (Wall–Frame Interaction)

Shear walls + moment frames working together (IS 1893 requires the frame alone
to resist ≥ 25 % of the design base shear).

- Wall restrains frame at the bottom (bending mode), frame restrains wall at
  the top (shear mode) — the interaction flattens the drift profile, making
  this the standard system for **10–40 storey RC towers**.
- R = 5.0 with SMRF + ductile walls (IS 1893 Table 9).

## 5.7 Core and Outrigger System

Central RC core (lifts/stairs) provides the primary lateral stiffness;
**outrigger trusses/walls** at one or more levels engage perimeter columns,
converting overturning into axial push–pull in the columns.

- Extends economical height of core systems to ~40–70+ storeys.
- Outrigger levels double as plant/refuge floors.
- Belt trusses distribute forces among perimeter columns.

## 5.8 Tube Systems

The building perimeter works as a hollow cantilever tube.

- **Framed tube** — closely spaced perimeter columns + deep spandrels
  (e.g., original WTC). Watch **shear lag** (corner columns overloaded
  relative to mid-face).
- **Tube-in-tube** — perimeter tube + core tube share lateral load.
- **Bundled tube** — several tubes tied together (Willis/Sears Tower) —
  reduces shear lag, allows setbacks.
- **Braced tube / diagrid** — perimeter diagonals carry both gravity and
  lateral loads (e.g., 30 St Mary Axe); highly efficient, distinctive
  architecture.

## 5.9 Trusses, Arches, Cables and Shells

- **Truss** — triangulated members in pure axial force (assumed pinned);
  spans 10–100+ m for roofs/bridges; types: Pratt, Howe, Warren, Fink,
  North-light.
- **Arch** — carries load in compression by its curved geometry; needs
  abutments for horizontal thrust; three-hinged (determinate), two-hinged,
  fixed.
- **Cable/suspension & cable-stayed** — pure tension primary members; longest
  spans; stiffening deck/girder controls aerodynamics.
- **Shells and folded plates** — carry load by membrane action; very thin for
  large column-free areas (domes, hypars, cooling towers).
- **Space frame/grid** — three-dimensional truss for large flat roofs
  (airports, exhibition halls).

## 5.10 Precast and Prestressed Systems

- **Precast frame** — factory-made columns, beams, hollow-core slabs, walls;
  quality + speed; connections are the critical design/seismic issue.
- **Prestressed concrete** — pre-tensioned (factory) or post-tensioned
  (site); makes concrete work in "artificial compression", enabling long
  spans and crack control (IS 1343).

## 5.11 Steel–Concrete Composite Buildings

Steel frame + composite deck slabs + (often) RC core: combines speed of steel
with stiffness/damping of concrete. Composite columns and shear connectors
(studs) tie the materials together (IS 11384; IS 800 Section 11 context).

## 5.12 Transfer Structures

Where the column grid changes (podium + tower), **transfer beams/plates/
trusses** collect upper loads and redistribute them. They are heavily loaded,
deflection-sensitive and, in seismic zones, create vertical irregularity —
IS 1893 treats designs with discontinued lateral elements harshly; avoid
transferring shear walls if at all possible.

## 5.13 Diaphragms and Collectors

Floor slabs act as horizontal **diaphragms** distributing lateral forces to
vertical systems in proportion to stiffness (rigid diaphragm) or tributary
area (flexible). Openings (staircases, atria) interrupt diaphragms — chord and
**collector (drag) reinforcement** must drag forces into walls/frames. Large
cut-outs > 50 % of area make the diaphragm flexible per IS 1893 Cl. 7.6.4.

## 5.14 Selecting a System — Height Guide (Indicative)

| Storeys | Typical Economic Systems |
|---|---|
| 1–4 | Load-bearing masonry (low seismic), RC frame |
| 5–12 | RC SMRF; frame + shear walls |
| 12–30 | Dual system (walls/core + frame), flat slab + walls |
| 30–50 | Core + outrigger, tube systems |
| 50+ | Bundled tube, diagrid, mega-frame, composite core + outrigger |

Selection also weighs: seismic zone and R value, wind climate, floor-plate
flexibility, foundation conditions, speed and local construction capability.
