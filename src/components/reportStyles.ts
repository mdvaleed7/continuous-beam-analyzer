/** Shared print stylesheet for IS 456 report generators (slab + footing). */
export const REPORT_CSS = `<style>
    @page { size: A4; margin: 20mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #333; background: #fff; font-size: 11pt; }
    .report-header { text-align: center; border-bottom: 2px solid #222; margin-bottom: 20px; padding-bottom: 10px; }
    h1 { margin: 0; font-size: 20pt; color: #111; }
    h2 { font-size: 16pt; color: #222; border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-top: 30px; }
    h3 { font-size: 13pt; color: #444; margin-top: 20px; }
    h4 { font-size: 11pt; color: #555; margin-top: 14px; margin-bottom: 6px; }
    .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 10pt; }
    .meta-table td { border: 1px solid #ccc; padding: 6px 10px; }
    .meta-table strong { color: #555; }
    .result-table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; font-size: 10pt; text-align: center; }
    .result-table th { background: #f4f4f4; border: 1px solid #aaa; padding: 8px; font-weight: bold; }
    .result-table td { border: 1px solid #ccc; padding: 6px; }
    .calc-block { background: #fafafa; border-left: 4px solid #2196f3; padding: 10px 15px; margin: 15px 0; border-radius: 0 4px 4px 0; }
    .status-safe { color: #008a00; font-weight: bold; }
    .status-fail { color: #d00000; font-weight: bold; }
    .info-note { background: #e8f4fd; border-left: 4px solid #2196f3; padding: 8px 12px; margin: 10px 0; font-size: 9.5pt; color: #444; }
    @media print { body { font-size: 10pt; } .no-print { display: none; } }
</style>`;
