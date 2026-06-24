// ponytail: shared CSS for slab + footing report generators.
// Previously duplicated ~40 identical lines in each generator.

// NOTE: KaTeX CSS stays as a CDN <link> in each report — inlining via `?raw`
// breaks font loading (the CSS has relative @font-face URLs that don't resolve
// inside the blob: iframe). See wallReportGenerator.ts for the same constraint.

export const REPORT_CSS = `<style>
    @page { size: A4 portrait; margin: 15mm; }
    body {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        color: #111; font-size: 14px; line-height: 1.5;
        background: white; margin: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .report-container { max-width: 800px; margin: 0 auto; padding: 20px 30px; }
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
    .two-col > .col { flex: 1; }
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
    /* ponytail: KaTeX display math defaults to text-align: center. Two-column
       flex layouts make that look misaligned — force left alignment so math,
       status lines, and notes all line up against the column's left edge. */
    .katex-display { text-align: left !important; margin: 10px 0 !important; }
    @media print {
        .report-container { max-width: 100%; margin: 0; }
        .page-break { page-break-before: always; }
    }
</style>`;

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
