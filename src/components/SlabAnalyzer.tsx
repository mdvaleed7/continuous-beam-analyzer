"use client";

import { useState } from "react";
import NormalSlabAnalyzer from "./NormalSlabAnalyzer";
import CantileverSlabAnalyzer from "./CantileverSlabAnalyzer";
import FlatSlabAnalyzer from "./FlatSlabAnalyzer";
import WaffleSlabAnalyzer from "./WaffleSlabAnalyzer";

type SlabType = 'normal' | 'cantilever' | 'flat' | 'waffle';

export default function SlabAnalyzer() {
    const [slabType, setSlabType] = useState<SlabType>('normal');

    return (
        <div className="slab-analyzer-wrapper">
            <div className="slab-type-selector ast-style-9612ab">
                <label className="style-6322b7">Select Slab Type:</label>
                <select 
                    value={slabType} 
                    onChange={(e) => setSlabType(e.target.value as SlabType)} title="input-field" id="input-field" className="ast-style-a1b765"
                >
                    <option value="normal">Normal Slab (1-Way & 2-Way)</option>
                    <option value="cantilever">Cantilever Slab</option>
                    <option value="flat">Flat Slab (Direct Design)</option>
                    <option value="waffle">Waffle Slab (Grid)</option>
                </select>
            </div>

            {slabType === 'normal' && <NormalSlabAnalyzer />}
            {slabType === 'cantilever' && <CantileverSlabAnalyzer />}
            {slabType === 'flat' && <FlatSlabAnalyzer />}
            {slabType === 'waffle' && <WaffleSlabAnalyzer />}
        </div>
    );
}

