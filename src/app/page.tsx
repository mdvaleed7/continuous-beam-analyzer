"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import BeamAnalyzer from "../components/BeamAnalyzer";
import WallAnalyzer from "../components/WallAnalyzer";
import SlabAnalyzer from "../components/SlabAnalyzer";
import FootingAnalyzer from "../components/FootingAnalyzer";
import { ToastProvider } from "../components/ToastProvider";

// ─── Dark mode via useSyncExternalStore ───────────────────────────────
// The inline script in layout.tsx sets `data-theme` on <html> BEFORE React
// hydrates, so reading it from the DOM avoids hydration mismatches and the
// setState-in-effect anti-pattern. The toggle writes to the DOM attribute +
// localStorage; a MutationObserver notifies React to re-render.
const themeStore = {
    subscribe(cb: () => void): () => void {
        if (typeof window === 'undefined') return () => {};
        const obs = new MutationObserver(cb);
        obs.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });
        return () => obs.disconnect();
    },
    getSnapshot(): boolean {
        if (typeof window === 'undefined') return false;
        return document.documentElement.getAttribute('data-theme') === 'dark';
    },
    getServerSnapshot(): boolean {
        return false; // SSR: always light
    },
};

export default function Home() {
    const [mode, setMode] = useState('slab');
    const darkMode = useSyncExternalStore(
        themeStore.subscribe,
        themeStore.getSnapshot,
        themeStore.getServerSnapshot,
    );
    const [showScrollTop, setShowScrollTop] = useState(false);

    // Toggle theme by writing to the DOM attribute + localStorage. The
    // MutationObserver in themeStore.subscribe triggers a re-render.
    const toggleDarkMode = useCallback(() => {
        const next = document.documentElement.getAttribute('data-theme') !== 'dark';
        document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
        try { localStorage.setItem('cba-theme', next ? 'dark' : 'light'); } catch { /* noop */ }
    }, []);

    useEffect(() => {
        const handleScroll = () => setShowScrollTop(window.scrollY > 400);
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Global keyboard shortcuts (1-4 = modes, D = dark toggle).
    // Ignored when the user is typing in a form field or using modifiers.
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
            if (t.isContentEditable) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            switch (e.key) {
                case '1': setMode('beam'); break;
                case '2': setMode('wall'); break;
                case '3': setMode('slab'); break;
                case '4': setMode('footing'); break;
                case 'd': case 'D': toggleDarkMode(); break;
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [toggleDarkMode]);

    return (
        <ToastProvider>
        <div className="app-shell">
            <nav className="mode-tabs">
                <button
                    className={`mode-tab ${mode === 'beam' ? 'active' : ''}`}
                    onClick={() => setMode('beam')}
                    title="Beam Analysis (press 1)"
                >
                    <span className="mode-tab-icon">📐</span>
                    <span>Beam Analysis</span>
                </button>
                <button
                    className={`mode-tab ${mode === 'wall' ? 'active' : ''}`}
                    onClick={() => setMode('wall')}
                    title="Wall Design (press 2)"
                >
                    <span className="mode-tab-icon">🧱</span>
                    <span>Wall Design</span>
                </button>
                <button
                    className={`mode-tab ${mode === 'slab' ? 'active' : ''}`}
                    onClick={() => setMode('slab')}
                    title="Slab Design (press 3)"
                >
                    <span className="mode-tab-icon">🏗️</span>
                    <span>Slab Design</span>
                </button>
                <button
                    className={`mode-tab ${mode === 'footing' ? 'active' : ''}`}
                    onClick={() => setMode('footing')}
                    title="Footing Design (press 4)"
                >
                    <span className="mode-tab-icon">🔲</span>
                    <span>Footing Design</span>
                </button>
                <button
                    className="mode-tab dark-toggle"
                    onClick={toggleDarkMode}
                    title={darkMode ? 'Switch to Light Mode (press D)' : 'Switch to Dark Mode (press D)'}
                >
                    <span className="mode-tab-icon">{darkMode ? '☀️' : '🌙'}</span>
                </button>
            </nav>
            <div className="app-content">
                {mode === 'beam' && <BeamAnalyzer />}
                {mode === 'wall' && <WallAnalyzer />}
                {mode === 'slab' && <SlabAnalyzer />}
                {mode === 'footing' && <FootingAnalyzer />}
            </div>
            {showScrollTop && (
                <button className="scroll-top-btn" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title="Scroll to top">
                    ↑
                </button>
            )}
            <footer className="app-footer">
                <div className="footer-inner">
                    <span className="footer-brand">Continuous Beam Analyzer</span>
                    <span className="footer-sep">·</span>
                    <span>IS 456:2000 Structural Design Tool</span>
                    <span className="footer-sep">·</span>
                    <span>For preliminary design only — verify independently</span>
                    <span className="footer-sep">·</span>
                    <span className="kbd-hint">Keys: 1-4 modes, D theme</span>
                </div>
            </footer>
        </div>
        </ToastProvider>
    );
}
