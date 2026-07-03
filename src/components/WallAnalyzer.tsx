"use client";

import React, { useState } from "react";
import BasementWallAnalyzer from "./BasementWallAnalyzer";
import RetainingWallAnalyzer from "./RetainingWallAnalyzer";

type WallType = 'basement' | 'retaining';

export default function WallAnalyzer() {
    const [wallType, setWallType] = useState<WallType>('basement');

    return (
        <div className="wall-module-container">
            {/* ─── WALL TYPE SELECTOR ─── */}
            <div className="wall-type-selector ast-style-9612ab" style={{ margin: '20px 20px 0 20px' }}>
                <label className="style-6322b7">Select Wall Type:</label>
                <select
                    value={wallType}
                    onChange={(e) => setWallType(e.target.value as WallType)}
                    title="wall-type"
                    id="wall-type-field"
                    className="ast-style-a1b765"
                >
                    <option value="basement">Basement Wall (Zone-based, propped)</option>
                    <option value="retaining">Retaining Wall (Cantilever, determinate)</option>
                </select>
            </div>

            {/* Use display block/none to preserve the component state and canvas mounts when switching */}
            <div style={{ display: wallType === 'basement' ? 'block' : 'none' }}>
                <BasementWallAnalyzer />
            </div>
            <div style={{ display: wallType === 'retaining' ? 'block' : 'none' }}>
                <RetainingWallAnalyzer />
            </div>
        </div>
    );
}
