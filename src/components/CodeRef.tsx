"use client";

import React, { useState, useRef, useEffect } from 'react';

// IS 456:2000 clause reference database
const CLAUSE_DB: Record<string, { title: string; text: string }> = {
    '23.2': {
        title: 'Computation of Deflection — Span/Depth Ratio',
        text: 'The deflection of a member can be controlled by limiting the span/effective depth ratio. Basic values: cantilever=7, simply supported=20, continuous=26. Modified by a factor depending on service stress and reinforcement percentage.',
    },
    '23.2.1': {
        title: 'Basic Values of Span/Depth Ratios',
        text: 'Basic span/effective depth ratios for different support conditions: cantilever=7, simply supported=20, continuous=26. These are for spans up to 10m.',
    },
    '26.3.3': {
        title: 'Maximum Spacing of Reinforcement',
        text: 'Maximum spacing of bars in slabs: 3d or 300mm, whichever is less, for main bars. For distribution steel: 5d or 450mm.',
    },
    '26.5.1.1': {
        title: 'Maximum Reinforcement',
        text: 'Maximum percentage of reinforcement in flexural members shall not exceed 4% of the cross-sectional area.',
    },
    '26.5.2.1': {
        title: 'Minimum Reinforcement',
        text: 'Minimum reinforcement in slabs: 0.15% of cross-sectional area for Fe250, 0.12% for Fe415/Fe500.',
    },
    '31.2': {
        title: 'Flat Slab — General',
        text: 'Flat slab design may be done by Direct Design Method or Equivalent Frame Method, subject to limitations on span ratios and load distribution.',
    },
    '31.2.1': {
        title: 'Minimum Thickness of Flat Slab',
        text: 'The thickness of a flat slab shall not be less than 125 mm. For panels with drops, thickness outside the drop shall not be less than 100mm.',
    },
    '31.3.3': {
        title: 'Total Static Moment M₀',
        text: 'Total static moment M₀ = w·L₂·Lₙ²/8, where Lₙ is the clear span and w is the factored load per unit area.',
    },
    '31.3.4': {
        title: 'Distribution of Total Static Moment',
        text: 'Interior panels: negative moment = 0.65M₀, positive moment = 0.35M₀. Exterior panels vary with edge condition.',
    },
    '31.4.1': {
        title: 'Drop Panel Depth',
        text: 'Drop panels shall project below the slab at least one-quarter of the slab thickness beyond the drop. Horizontal extent of drop from column face shall be at least one-sixth of the span.',
    },
    '31.6': {
        title: 'Punching Shear in Flat Slabs',
        text: 'Critical section for punching shear is at d/2 from the face of the column. Shear stress τv = V/(u₀·d). Allowable stress τc = 0.25√fck·ks, where ks depends on column aspect ratio.',
    },
    '31.6.3': {
        title: 'Punching Shear Strength',
        text: 'The permissible shear stress for punching: τc = 0.25√fck × ks, where ks = 0.5 + βc ≤ 1.0, and βc = ratio of shorter to longer side of column.',
    },
    '38.1': {
        title: 'Flexural Design — Limit State',
        text: 'Design moment of resistance: Mu = 0.36·fck·xu·(d - 0.42·xu) for rectangular sections. The depth of neutral axis xu is limited to xu,max = 0.46d for Fe500.',
    },
    '40.1.1': {
        title: 'Critical Section for Shear',
        text: 'The critical section for shear is taken at a distance d (effective depth) from the face of the support. This accounts for the vertical compression from the support that enhances shear capacity near the support.',
    },
    '40.2': {
        title: 'Design Shear Strength of Concrete',
        text: 'The design shear strength τc depends on the percentage of tensile reinforcement pt and the concrete grade. Table 19 of IS 456 gives τc values for various pt percentages.',
    },
    '34.1.2': {
        title: 'Footings — Bending Moments',
        text: 'The bending moment at any section of a footing shall be determined by passing a vertical plane through the footing, and computing the moment of all forces on one side of the plane. For square/rectangular footings, the critical section is at the face of the column/pedestal.',
    },
    '34.2.3': {
        title: 'Footings — Two-Way (Punching) Shear',
        text: 'The critical section for two-way shear (punching) in footings is at a distance d/2 from the periphery of the column/pedestal, where d is the effective depth. The permissible shear stress is τc = 0.25√fck (with ks factor for column aspect ratio).',
    },
    '34.2.4': {
        title: 'Footings — One-Way Shear',
        text: 'The critical section for one-way (beam) shear in footings is at a distance d from the face of the column/pedestal. The shear stress τv = V/(b·d) shall not exceed the design shear strength τc from Table 19.',
    },
    '34.3': {
        title: 'Footings — Bond and Development Length',
        text: 'The development length of reinforcement bars in footings shall comply with Cl. 26.2.1. The critical section for checking bond is at the face of the column where the moment is maximum.',
    },
    '30.5': {
        title: 'Ribbed Floors — Geometry Limits',
        text: 'For ribbed/waffle floors: rib width bw ≥ 65 mm, rib spacing ≤ 1500 mm c/c, depth of rib Dr ≤ 4·bw. The topping thickness shall be ≥ max(50 mm, clear spacing of ribs / 12).',
    },
    '20.1': {
        title: 'Stability of Retaining Walls',
        text: 'Retaining walls shall be checked for stability against overturning (about the toe), sliding (along the base), and foundation bearing pressure. Minimum factors of safety: 1.4 for overturning and sliding (commonly 1.5 in practice).',
    },
    '36.4': {
        title: 'Load Factors for Limit State Design',
        text: 'For ultimate limit state, the factored load = 1.5 × (DL + LL) for normal combinations. Earth pressure loads are treated as dead load (1.5 factor) per IS 456 Cl. 36.4.',
    },
    'Annex C': {
        title: 'Deflection Calculation — Rigorous Method',
        text: 'Annex C provides the rigorous method for calculating deflection considering cracking, tension stiffening, shrinkage, and creep. This method governs over the simplified span/depth ratio check of Cl. 23.2.',
    },
    'Annex G': {
        title: 'Effective Depth for Deflection',
        text: 'Annex G provides guidance on calculating effective depth considering bar disposition and cover for deflection checks.',
    },
};

interface CodeRefProps {
    clause: string;  // e.g., "40.1.1" or "23.2"
    children?: React.ReactNode;  // custom display text; defaults to "Cl. {clause}"
}

export default function CodeRef({ clause, children }: CodeRefProps) {
    const [show, setShow] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const ref = useRef<HTMLSpanElement>(null);
    const tooltipRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (show && tooltipRef.current) {
            tooltipRef.current.style.top = `${pos.top}px`;
            tooltipRef.current.style.left = `${pos.left}px`;
        }
    }, [show, pos]);

    const info = CLAUSE_DB[clause];
    if (!info) {
        // No tooltip data — just render the text
        return <span className="code-ref code-ref-unknown">{children || `Cl. ${clause}`}</span>;
    }

    const handleMouseEnter = () => {
        if (ref.current) {
            const rect = ref.current.getBoundingClientRect();
            setPos({
                top: rect.bottom + 8,
                left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)),
            });
        }
        setShow(true);
    };
    
    return (
        <span
            ref={ref}
            className="code-ref"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={() => setShow(false)}
        >
            {children || `Cl. ${clause}`}
            {show && (
                <span className="code-ref-tooltip" ref={tooltipRef}>
                    <span className="code-ref-tooltip-title">{info.title}</span>
                    <span className="code-ref-tooltip-text">{info.text}</span>
                    <span className="code-ref-tooltip-std">IS 456:2000</span>
                </span>
            )}
        </span>
    );
}
