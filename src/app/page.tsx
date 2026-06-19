"use client";

import { useState } from "react";
import BeamAnalyzer from "../components/BeamAnalyzer";
import WallAnalyzer from "../components/WallAnalyzer";
import SlabAnalyzer from "../components/SlabAnalyzer";
import FootingAnalyzer from "../components/FootingAnalyzer";

export default function Home() {
    const [mode, setMode] = useState('beam');

    return (
        <main>
            <nav className="mode-tabs">
                <button
                    className={`mode-tab ${mode === 'beam' ? 'active' : ''}`}
                    onClick={() => setMode('beam')}
                >
                    Beam Analysis
                </button>
                <button
                    className={`mode-tab ${mode === 'wall' ? 'active' : ''}`}
                    onClick={() => setMode('wall')}
                >
                    Wall Design
                </button>
                <button
                    className={`mode-tab ${mode === 'slab' ? 'active' : ''}`}
                    onClick={() => setMode('slab')}
                >
                    Slab Design
                </button>
                <button
                    className={`mode-tab ${mode === 'footing' ? 'active' : ''}`}
                    onClick={() => setMode('footing')}
                >
                    Footing Design
                </button>
            </nav>
            {mode === 'beam' && <BeamAnalyzer />}
            {mode === 'wall' && <WallAnalyzer />}
            {mode === 'slab' && <SlabAnalyzer />}
            {mode === 'footing' && <FootingAnalyzer />}
        </main>
    );
}
