# Chapter 2 — Slab and Floor Systems

## 2.1 Introduction

Slabs are planar elements carrying loads perpendicular to their plane, spanning
to beams, walls or directly to columns. The choice of slab system controls
floor thickness, formwork cost, services routing and construction speed — it is
usually the single biggest structural decision in a building project.

## 2.2 One-Way vs Two-Way Slabs

The behaviour is decided by the **aspect ratio** of the panel:

| Criterion | One-Way Slab | Two-Way Slab |
|---|---|---|
| Ly/Lx | > 2 | ≤ 2 |
| Load transfer | Mainly along short span | Both directions |
| Main steel | One direction (distribution steel other way) | Both directions |
| Typical L/d (SS) | 20 (as beam basic value, slabs usually deeper ratios ~25–30 with modification factor) | 32–40 (Cl. 24.1) |
| Support | Two opposite parallel supports (or Ly/Lx > 2 on four) | Four edges (Ly/Lx ≤ 2) |

- **One-way slab** bends in single curvature; design a 1 m strip as a beam.
  Distribution steel (min 0.12 % of gross area for HYSD, Cl. 26.5.2.1) is
  provided transverse to the span for shrinkage/temperature.
- **Two-way slab** bends in double curvature. Moments by IS 456 Annex D
  (Table 26 coefficients for various edge conditions):
  Mx = αx w Lx², My = αy w Lx². Corners must be provided with **torsion
  reinforcement** where the slab is discontinuous (Cl. D-1.8).

## 2.3 Cantilever Slab

Projects from a support (chajja, balcony). Governed by:

- Hogging moment at support: M = wL²/2 (UDL) — **top steel is the main steel**.
- Basic span/depth = 7 (Cl. 23.2.1) — deflection almost always governs.
- Anchorage of top bars back into the supporting member is critical; most
  balcony failures are due to top steel pushed down during casting or
  inadequate development length.

## 2.4 Flat Slab System (IS 456 Cl. 31)

A slab supported **directly on columns without beams**.

### 2.4.1 Components

- **Flat plate** — uniform slab, no drops or capitals; simplest formwork;
  spans ~4.5–6 m.
- **Flat slab with drop panels** — local thickening over columns (drop length
  ≥ L/3 each way, projection below slab ≥ ¼ slab thickness); increases
  punching capacity and hogging moment capacity; spans ~6–9 m.
- **Column head/capital** — flared column top increasing the critical shear
  perimeter.

### 2.4.2 Analysis — Direct Design Method (Cl. 31.4)

Total panel moment M0 = W Ln / 8, distributed to **column strips** and
**middle strips**:

| Moment | Column Strip | Middle Strip |
|---|---|---|
| Interior negative | 75 % | 25 % |
| Positive | 60 % | 40 % |
| Exterior negative | 100 % | 0 % |

Longitudinal distribution (interior span): 65 % negative, 35 % positive.

### 2.4.3 Punching (Two-Way) Shear — Cl. 31.6

The critical section is at **d/2 from the column face**. Design shear stress:
τv = Vu / (b0 d) must not exceed ks τc where τc = 0.25 √fck and
ks = 0.5 + βc ≤ 1.0 (βc = short/long side ratio of column). If exceeded:
provide drop panel, shear reinforcement (stirrups/stud rails), larger column,
or thicker slab. **Punching failure is brittle — treat it conservatively.**

### 2.4.4 Merits and Limitations

Advantages: flat soffit (flexible partitions, easy services), reduced storey
height, fast formwork. Limitations: punching shear, larger deflections, poor
performance as a lateral system — **in Zones III–V flat slabs must be combined
with shear walls**, and slab–column frames are not counted as the lateral
system (IS 1893 Cl. 7.1, note on frames not detailed for ductility).

## 2.5 Waffle (Grid/Coffered) Slab

Two-way ribbed slab formed with recessed pans, leaving a grid of ribs with a
thin structural topping.

- Efficient for **large column-free spans (9–15 m)**; concrete removed from
  the tension zone where it does little work.
- Analysed as a grid/orthotropic plate, or as a two-way slab with equivalent
  stiffness; solid heads are kept around columns for punching shear.
- IS 456 Cl. 30 (ribbed, hollow block and voided slabs): rib width ≥ 65 mm,
  rib spacing ≤ 1.5 m clear, rib depth ≤ 4 × width, topping typically ≥ 50 mm.
- Minimum reinforcement is computed on an **equivalent thickness** basis for
  voided construction.

## 2.6 Ribbed / One-Way Joist Slab

Closely spaced small ribs in one direction plus topping — one-way version of
the waffle slab; economical for medium spans with light loads.

## 2.7 Hollow-Core and Precast Slabs

- **Hollow-core slab** — precast prestressed planks with longitudinal voids;
  spans 6–15 m; fast erection; needs structural screed for diaphragm action.
- **Precast solid planks / double tees** — for industrial buildings and
  parking structures.

## 2.8 Composite Deck Slab

Profiled steel deck acting as permanent shuttering and (with embossments) as
tension reinforcement, topped with concrete. Standard in steel-frame
buildings; design per IS 11384 / Eurocode 4 practice.

## 2.9 Post-Tensioned (PT) Slab

Slab with high-strength strands stressed after casting.

- Enables **long spans (8–14 m) with thin sections (L/40–L/45)**.
- Balanced-load concept: tendon drape produces upward equivalent load
  offsetting gravity load, controlling deflection and cracking.
- Common in commercial floors, transfer plates and mat foundations.

## 2.10 Other Systems

- **Filler slab** — cheap filler material (Mangalore tiles, clay pots) placed
  in the tension zone of a two-way slab, reducing concrete and dead load.
- **Bubble deck / voided biaxial slab** — plastic spheres remove core
  concrete, giving two-way behaviour at reduced weight.
- **Hordi / hollow block slab** — ribbed slab with hollow clay/concrete block
  infill.

## 2.11 Slab Design Essentials (IS 456)

- **Cover**: 20 mm nominal for mild exposure (Cl. 26.4 / Table 16).
- **Minimum steel**: 0.12 % of gross area (HYSD/Fe 415+), 0.15 % (mild steel).
- **Maximum bar spacing**: main steel ≤ 3d or 300 mm; distribution steel ≤ 5d
  or 450 mm (Cl. 26.3.3).
- **Shear**: slabs are normally sized so that τv ≤ k·τc (k = depth factor,
  Cl. 40.2.1.1) — **shear reinforcement in slabs < 200 mm thick is not
  permitted to be relied upon**.
- **Deflection**: modified span/depth method (Cl. 23.2); two-way slab may use
  shorter span and Cl. 24.1 ratios.

## 2.12 Choosing a Floor System — Practical Guide

| Span (m) | Economical Options |
|---|---|
| up to 4.5 | One-way/two-way solid slab on beams |
| 4.5 – 6 | Two-way slab on beams; flat plate |
| 6 – 9 | Flat slab with drops; ribbed slab; PT flat plate |
| 9 – 12 | Waffle slab; PT slab; hollow-core precast |
| 12 – 15+ | PT waffle/band beams; long-span precast; steel–composite |

Also weigh: floor-to-floor height limits, services integration, seismic zone
(flat slab restrictions), speed (precast/PT), and formwork reuse.
