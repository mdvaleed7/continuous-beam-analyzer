/**
 * Export analysis results to a downloadable JSON file.
 *
 * @param data - The results object to export (input + computed results).
 * @param filename - The filename WITHOUT extension; a .json suffix is added.
 * @param label - Optional human-readable label written into the metadata block.
 */
export function exportToJSON(data: unknown, filename: string, label?: string): void {
    const payload = {
        metadata: {
            label: label || 'Analysis Results',
            exportedAt: new Date().toISOString(),
            standard: 'IS 456:2000',
            tool: 'Continuous Beam Analyzer',
        },
        results: data,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a short delay to ensure the download has started.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Build a compact YYYYMMDD_HHMM timestamp for use in exported filenames.
 */
export function timestampForFilename(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * Copy a text summary of key results to the clipboard.
 * Falls back to a temporary textarea if the async Clipboard API is unavailable.
 *
 * @param summary - Pre-formatted text to copy.
 * @returns true if copy succeeded, false otherwise.
 */
export async function copyToClipboard(summary: string): Promise<boolean> {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(summary);
            return true;
        }
    } catch {
        // fall through to legacy approach
    }
    try {
        const ta = document.createElement('textarea');
        ta.value = summary;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

/**
 * Format a number to a fixed number of decimals, returning '—' for NaN/null.
 */
export function fmt(v: number | null | undefined, decimals = 2): string {
    if (v == null || Number.isNaN(v)) return '—';
    return v.toFixed(decimals);
}
