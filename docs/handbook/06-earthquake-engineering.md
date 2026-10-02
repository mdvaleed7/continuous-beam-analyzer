# Chapter 6 — Earthquake Engineering

## 6.1 Why Earthquakes Are Different

Earthquake load is not an applied force but an **inertial response**: the
ground moves, the mass resists, and F = m·a develops in the structure. It is
cyclic, reversing, and can exceed elastic capacity — so design philosophy
accepts **controlled damage with no collapse** (life safety) for the Design
Basis Earthquake (DBE).

Key consequences:

- Heavier buildings attract more force (reduce mass!).
- Stiffness attracts force; flexibility increases displacement — a trade-off.
- **Ductility is the currency** — we design for a fraction (1/R) of the
  elastic force and pay the balance in ductile deformation capacity.

## 6.2 Seismic Zoning of India (IS 1893:2016)

| Zone | Z (Zone Factor) | Intensity | Example Regions |
|---|---|---|---|
| II | 0.10 | Low | Chennai, Bengaluru, Hyderabad |
| III | 0.16 | Moderate | Mumbai, Kolkata, Chandigarh |
| IV | 0.24 | Severe | Delhi, Patna, Dehradun |
| V | 0.36 | Very severe | Bhuj, Guwahati, Srinagar, Andamans |

Z represents the **Maximum Considered Earthquake (MCE)** peak ground
acceleration; DBE = MCE/2, hence Z/2 in the base-shear formula.

## 6.3 Design Horizontal Seismic Coefficient

**Ah = (Z/2) · (I/R) · (Sa/g)**

- **Z** — zone factor (Table above).
- **I** — importance factor (Table 8): 1.0 ordinary buildings, 1.2 residential
  buildings > 200 persons, 1.5 hospitals/schools/critical facilities.
- **R** — response reduction factor (Table 9): OMRF 3.0, SMRF 5.0, ductile
  shear wall 4.0, dual (SMRF + wall) 5.0, steel EBF/SCBF 5.0/4.5.
- **Sa/g** — spectral acceleration from the design response spectrum,
  a function of natural period T and soil type (I rock, II medium, III soft).

Design base shear: **VB = Ah · W**, W = seismic weight (full DL + fraction of
LL per Table 10).

## 6.4 Natural Period (Empirical, Cl. 7.6.2)

- RC MRF (no infill): Ta = 0.075 h^0.75
- Steel MRF: Ta = 0.085 h^0.75
- Others / with infill: Ta = 0.09 h / √d  (h = height in m, d = base
  dimension in m along the considered direction)

## 6.5 Vertical Distribution and Analysis Methods

Storey force (equivalent static method, Cl. 7.6.3):
**Qi = VB · (Wi hi²) / Σ(Wj hj²)** — parabolic distribution, largest at top.

Analysis methods (Cl. 7.7):

- **Equivalent Static** — regular buildings, limited height (permitted for
  regular buildings < 15 m in Zone II per Cl. 7.7.1 context; dynamic analysis
  required for taller/irregular — see below).
- **Response Spectrum (modal)** — required for: regular buildings > 40 m in
  Zones IV–V (> 90 m in II–III), and irregular buildings > 12 m in IV–V
  (> 40 m in II–III). Enough modes for ≥ 65 % mass participation; scale
  results so dynamic base shear ≥ static VB (Cl. 7.7.3).
- **Time-History** — tall, irregular or base-isolated structures; explicit
  ground-motion records.

## 6.6 Structural Configuration — The Biggest Decision

> "The earthquake does not read your calculations; it reads your
> configuration."

### 6.6.1 Plan Irregularities (Table 5)

- **Torsional irregularity** — stiffness/mass eccentric in plan; corner
  displacement > 1.5 × average. Torsion provisions: design eccentricity
  edi = 1.5 esi + 0.05 bi (Cl. 7.8).
- **Re-entrant corners** (L, T, U, + shapes) — projection > 15 % of plan
  dimension.
- **Diaphragm discontinuity** — openings > 50 % of floor area.
- **Out-of-plane offsets** of vertical elements.
- **Non-parallel systems**.

### 6.6.2 Vertical Irregularities (Table 6)

- **Soft storey** — storey stiffness < that of the storey above (open ground
  storey parking is the classic killer — Bhuj 2001). Requires special
  treatment; IS 1893 Cl. 7.10 historically required ×2.5 design of the open
  storey's columns/beams, now addressed via explicit modelling of infill
  stiffness (Cl. 7.9) and lateral strength checks.
- **Weak storey** — storey lateral strength < that above.
- **Mass irregularity** — mass > 1.5 × adjacent floor.
- **Setback/geometric irregularity**.
- **In-plane discontinuity** — e.g., shear wall stopping on a transfer beam:
  avoid; floating columns are similarly penalised.

## 6.7 Ductile Detailing — IS 13920:2016 Essentials

### Beams (Cl. 6)

- b/D ≥ 0.3; b ≥ 200 mm; d ≤ L/4 preferred.
- Tension steel: min ρ = 0.24 √fck / fy; max 2.5 %.
- Positive moment capacity at joint face ≥ 50 % of negative.
- **Hoops @ ≤ d/4 and 8φ (min bar) within 2d from joint face** (confinement
  zones); first hoop within 50 mm.
- Shear designed for **capacity moments** (plastic hinge shears), not analysis
  shear.

### Columns (Cl. 7)

- Min dimension 300 mm (or 20 × largest beam bar, 300 mm for spans > 5 m
  context; IS 13920:2016 Cl. 7.1: ≥ 20 db and ≥ 300 mm).
- **Strong column–weak beam**: ΣMc ≥ 1.4 ΣMb.
- Special confining reinforcement over lo (max of larger dimension, 1/6 clear
  height, 450 mm) at each end: spacing ≤ min(6 db,min longitudinal bar, 100 mm) — hoops with
  135° hooks.
- Column shear from capacity design of beams framing in.

### Joints (Cl. 9) and Walls (Cl. 10)

- Joint shear strength checks; confinement continued through the joint.
- Wall provisions per Chapter 1.4.2 plus boundary element detailing.

## 6.8 Drift, Separation and P–Δ

- **Storey drift limit**: 0.004 × storey height under design lateral force
  (Cl. 7.11.1).
- **Building separation** to avoid pounding: R × sum of calculated
  displacements (Cl. 7.11.3 — R/2 factor when floors align).
- **P–Δ**: second-order overturning from gravity acting on displaced
  configuration; significant in flexible/tall frames.
- **Deformation compatibility** of gravity-only elements (they must survive
  the drift even if not part of the lateral system).

## 6.9 Advanced Protective Systems

- **Base isolation** — flexible bearings (lead-rubber, friction pendulum)
  lengthen the period away from dominant ground motion energy; drastically
  reduce accelerations; ideal for hospitals, bridges, heritage retrofit.
- **Dampers** — viscous, friction, metallic-yield or tuned mass dampers add
  energy dissipation, reducing displacement demand.
- **Retrofitting** — jacketing (RC/steel/FRP), adding shear walls or braces,
  infill strengthening, base isolation; assessment per IS 15988.

## 6.10 Liquefaction and Geotechnical Effects

Loose saturated sands can lose strength during shaking (**liquefaction**) —
buildings tilt/sink (Niigata 1964). Screen with SPT-based procedures (IS 1893
Annex F); mitigate by densification, stone columns, deep foundations below the
liquefiable layer, or drainage.

## 6.11 Practical Seismic Design Checklist

1. Regular, symmetric plan; continuous walls/columns to foundation.
2. No soft/open ground storey without explicit design; no floating columns.
3. Choose R honestly — SMRF detailing must actually be provided.
4. Tie foundations (plinth/tie beams); check liquefaction.
5. Model infill stiffness where it changes behaviour (short-column effect —
   partial-height infills shorten and shear-kill columns).
6. Capacity design: hierarchy — flexure yields before shear, beams before
   columns, members before joints, superstructure before foundation.
7. Detail: 135° hooks, confinement zones, laps outside hinges, joint
   reinforcement.
8. Check drift, separation, and non-structural anchorage (parapets, tanks,
   cladding, services).
