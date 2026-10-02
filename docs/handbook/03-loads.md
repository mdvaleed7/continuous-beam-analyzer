# Chapter 3 — Loads on Structures

## 3.1 Introduction

Correct load estimation is half of structural design. In India the governing
document is **IS 875 (Parts 1–5)** for gravity, wind and other loads and
**IS 1893 (Part 1)** for earthquake loads, combined per **IS 456 Table 18**
(limit state combinations).

## 3.2 Dead Load (DL) — IS 875 Part 1

Permanent, self-weight based loads: structure, finishes, fixed partitions,
services.

Typical unit weights:

| Material | Unit Weight (kN/m³) |
|---|---|
| Reinforced concrete | 25 |
| Plain concrete | 24 |
| Brick masonry | 19–20 |
| AAC block masonry | 6–8 |
| Structural steel | 78.5 |
| Soil (compacted) | 17–20 |
| Water | 9.81 |
| Floor finish (screed + tiles) | ~1.0–1.5 kN/m² |

Dead load is well defined — hence its lower partial safety factor when it
resists overturning (0.9) and 1.5 when it acts adversely.

## 3.3 Live (Imposed) Load (LL) — IS 875 Part 2

Loads from occupancy and use — movable and variable.

| Occupancy | UDL (kN/m²) |
|---|---|
| Residential rooms | 2.0 |
| Office floors | 2.5–4.0 |
| Classrooms | 3.0 |
| Shops / retail | 4.0 |
| Assembly (fixed seats) | 4.0 |
| Assembly (no fixed seats) / stages | 5.0 |
| Storage / warehouses | 5.0–10.0 (per height of storage) |
| Corridors, staircases (public) | 3.0–5.0 |
| Parking (cars) | 2.5–5.0 |
| Roof (accessible) | 1.5 |
| Roof (non-accessible) | 0.75 |

**Live load reduction**: for columns/foundations supporting multiple floors,
IS 875 Part 2 permits a reduction (10 % per floor, up to 50 %) — not applicable
where storage loads govern. For seismic weight, only a fraction of LL is
included (IS 1893 Table 10): 25 % for LL ≤ 3 kN/m², 50 % for LL > 3 kN/m²; roof
LL is ignored.

## 3.4 Wind Load (WL) — IS 875 Part 3

Design wind speed: **Vz = Vb · k1 · k2 · k3 · k4**

- Vb — basic wind speed (33–55 m/s across six wind zones of India)
- k1 — probability (risk) factor
- k2 — terrain roughness & height factor
- k3 — topography factor
- k4 — importance factor for cyclonic regions

Design wind pressure: **pz = 0.6 Vz²** (N/m², Vz in m/s).

Force on element: F = (Cpe − Cpi) A pz — external and internal pressure
coefficients depend on building geometry and openings (permeability). For
slender/tall structures, **dynamic (gust factor) analysis** is required when
height > 120 m or h/b > 5, and vortex shedding may need checking for chimneys.

## 3.5 Earthquake Load (EL) — IS 1893 Part 1 (see Chapter 6)

Horizontal inertial load from ground shaking:
**Ah = (Z/2)·(I/R)·(Sa/g)**, base shear VB = Ah·W. Detailed in Chapter 6.

## 3.6 Other Loads

- **Snow load** (IS 875 Part 4) — Himalayan regions; roof shape coefficients.
- **Temperature effects** — expansion joints typically at 30–45 m spacing in
  RC buildings (IS 456 Cl. 27 recommends structures exceeding 45 m be
  analysed or jointed).
- **Shrinkage and creep** — time-dependent strains; creep coefficient θ = 2.2
  / 1.6 / 1.1 at age of loading 7 / 28 / 365 days (IS 456 Cl. 6.2.5).
- **Earth pressure** — active (Ka), at-rest (K0), passive (Kp); surcharge from
  adjacent traffic/structures.
- **Hydrostatic pressure and buoyancy/uplift** — basements below water table;
  check flotation with empty structure and 0.9 DL.
- **Impact and dynamic loads** — crane loads with impact factors (IS 875
  Part 2), machinery vibration.
- **Erection/construction loads** — often govern precast and steel elements.
- **Accidental loads** — blast, vehicle impact; robustness/tie provisions.

## 3.7 Load Combinations — Limit State (IS 456 Table 18)

| Combination | Factors |
|---|---|
| Gravity | 1.5 (DL + LL) |
| Gravity + Wind/EQ | 1.2 (DL + LL ± WL/EL) |
| Wind/EQ, low gravity | 1.5 (DL ± WL/EL) |
| Stability/overturning | 0.9 DL ± 1.5 WL/EL |

Serviceability: 1.0 DL + 1.0 LL (+ 0.8/1.0 combinations for deflection and
crack width).

For earthquake, IS 1893 Cl. 6.3 adds directional combinations
(±ELx ± 0.3 ELy etc. or 100 %+30 % rule; SRSS/CQC for modal combination).

## 3.8 Load Path and Tributary Areas

- **One-way slab** sends load to the two supporting beams: w·Lx/2 each.
- **Two-way slab** distributes by **yield-line (45°) tributary areas**:
  triangular load to short beams, trapezoidal to long beams.
- Beam reactions accumulate into columns via tributary area = ½ span each side
  in both directions.
- Always trace: slab → secondary beam → primary beam → column → foundation.

## 3.9 Practical Load Estimation Example (Typical RC Office Floor)

| Item | Load (kN/m²) |
|---|---|
| 150 mm slab self-weight (0.15 × 25) | 3.75 |
| Floor finish | 1.50 |
| Partitions (equivalent UDL) | 1.00 |
| Services/ceiling | 0.50 |
| **Total DL** | **6.75** |
| Live load (office) | 3.00 |
| **Factored design load 1.5(DL+LL)** | **14.6** |
