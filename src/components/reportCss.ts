// ponytail: shared CSS for slab + footing report generators.
// Previously duplicated ~40 identical lines in each generator.

// NOTE: KaTeX CSS stays as a CDN <link> in each report — inlining via `?raw`
// breaks font loading (the CSS has relative @font-face URLs that don't resolve
// inside the blob: iframe). See wallReportGenerator.ts for the same constraint.

export const REPORT_CSS = `<style>
    @page { size: A4 portrait; margin: 5mm; }
    body {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        color: #111; font-size: 14px; line-height: 1.5;
        background: white; margin: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .report-container { max-width: 800px; margin: 0 auto; padding: 5px; }
    .report-header { text-align: center; margin-bottom: 20px; }
    .report-header h1 { color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 5px; font-size: 28px; }
    .report-header p { color: #475569; margin: 0; font-size: 13px; }
    h2 { color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 20px; font-size: 18px; }
    h3 { color: #334155; font-size: 16px; margin: 12px 0 6px 0; }
    h4 { color: #475569; font-size: 15px; margin: 8px 0 4px 0; }
    .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 13px; }
    .meta-table td { padding: 6px 8px; border: 1px solid #e2e8f0; }
    .meta-table td strong { color: #475569; }
    .result-table { width: 100%; border-collapse: collapse; margin: 8px 0 15px 0; font-size: 13px; }
    .result-table th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 6px 8px; font-weight: bold; text-align: center; font-size: 12px; }
    .result-table td { border: 1px solid #e2e8f0; padding: 4px 6px; text-align: center; }
    .two-col { display: flex; gap: 12px; }
    .two-col > .col { flex: 1; min-width: 0; overflow: hidden; }
    .two-col > .col-left { border-right: 1px dashed #e2e8f0; padding-right: 12px; }
    .calc-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
    .calc-row .label { color: #475569; }
    .calc-row .value { font-weight: 600; color: #111; }
    .calc-block { background: #f8fafc; border-left: 3px solid #0ea5e9; padding: 10px 12px; margin: 8px 0; border-radius: 0 4px 4px 0; font-size: 13px; }
    .provided-box { margin-top: 8px; padding: 8px 10px; background: #f8fafc; border-left: 3px solid #0ea5e9; font-size: 13px; }
    .status-safe { color: #10b981; font-weight: bold; }
    .status-fail { color: #ef4444; font-weight: bold; }
    .section-box { border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; margin-bottom: 20px; page-break-inside: avoid; }
    .section-header { background: #f1f5f9; padding: 8px 12px; margin: 0; color: #0f172a; font-size: 15px; font-weight: bold; border-bottom: 1px solid #e2e8f0; }
    .section-body { padding: 12px 14px; }
    .info-note { background: #eff6ff; border-left: 3px solid #3b82f6; padding: 8px 10px; margin: 8px 0; font-size: 12px; color: #444; }
    /* KaTeX: flush-left alignment so formulas start at the same edge as headings.
       NO horizontal/vertical scrollbars — wide formulas are auto-scaled down to
       fit their column by the fitFormulas() script (see FIT_FORMULAS_SCRIPT).   */
    .katex-display {
        text-align: left !important;
        margin: 10px 0 !important;
        padding-left: 0 !important;
        overflow: hidden !important;   /* never show a scrollbar */
    }
    .katex-display > .katex {
        padding-left: 0 !important;
        margin-left: 0 !important;
        text-align: left !important;
        /* shrink-to-fit transform is anchored at the left edge */
        transform-origin: left center !important;
        display: inline-block;
    }
    .katex-display .katex-html { padding-left: 0 !important; margin-left: 0 !important; }
    /* KaTeX fleqn mode adds a 2em left indent — kill it so formulas sit flush
       against the same left edge as the heading directly above them. */
    .katex-display.fleqn > .katex { padding-left: 0 !important; }
    /* A formula that immediately follows a heading should sit directly below it,
       with no extra gap — the calc starts flush under the heading text. */
    h2 + .katex-display, h3 + .katex-display, h4 + .katex-display { margin-top: 2px !important; }
    h2, h3, h4 { margin-bottom: 4px; }

    /* Flex children must allow shrinking below content width */
    [style*="display: flex"] > [style*="flex: 1"] {
        min-width: 0 !important;
    }

    @media print {
        .report-container { max-width: 100%; margin: 0; }
        .page-break { page-break-before: always; }
    }
</style>`;

// ─────────────────────────────────────────────────────────────────────────────
//  AUTO-FIT FORMULAS
//  Wide KaTeX display formulas used to overflow their column and show an ugly
//  horizontal scrollbar (bad in a printed PDF). Instead of scrolling, we measure
//  each rendered formula and, if it is wider than its container, apply a left-
//  anchored CSS `scale()` so the whole formula shrinks just enough to fit.
//  The script is injected into the report <body> and runs after KaTeX + fonts
//  have loaded (and again before printing) so measurements are accurate.
// ─────────────────────────────────────────────────────────────────────────────
export const FIT_FORMULAS_SCRIPT = `<script>
(function () {
    function fitFormulas() {
        var blocks = document.querySelectorAll('.katex-display');
        for (var i = 0; i < blocks.length; i++) {
            var block = blocks[i];
            var inner = block.querySelector('.katex');
            if (!inner) continue;
            // reset any previous scaling before re-measuring
            inner.style.transform = 'none';
            inner.style.display = 'inline-block';
            var available = block.clientWidth;
            var needed = inner.scrollWidth;
            if (needed > available && available > 0) {
                var scale = available / needed;
                // clamp so formulas never shrink to an unreadable size
                if (scale < 0.45) scale = 0.45;
                inner.style.transform = 'scale(' + scale + ')';
            }
        }
    }
    function run() {
        fitFormulas();
        // re-fit once more after web fonts settle (KaTeX metrics change slightly)
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () { setTimeout(fitFormulas, 50); });
        }
        setTimeout(fitFormulas, 300);
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        run();
    } else {
        document.addEventListener('DOMContentLoaded', run);
    }
    window.addEventListener('load', function () { setTimeout(fitFormulas, 100); });
    // make sure the print snapshot is also fitted
    window.addEventListener('beforeprint', fitFormulas);
})();
</script>`;

// Shared helper: calc-row builder
export function calcRow(label: string, value: string | number, unit: string = ''): string {
    return `<div class="calc-row"><span class="label">${label}</span><span class="value">${value}${unit ? ' ' + unit : ''}</span></div>`;
}

// Shared helper: 4-column input table
export function inputTable(rows: [string, string, string, string][]): string {
    return `<table class="meta-table">${rows.map(([k1, v1, k2, v2]) =>
        `<tr><td style="width:25%;"><strong>${k1}</strong></td><td style="width:25%;">${v1}</td><td style="width:25%;"><strong>${k2}</strong></td><td style="width:25%;">${v2}</td></tr>`
    ).join('')}</table>`;
}
