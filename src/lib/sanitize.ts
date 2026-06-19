/**
 * HTML sanitization for safe injection into the DOM.
 *
 * The analyzer engines build HTML strings from numeric analysis results and
 * bar labels like "12mm @ 100 c/c". These strings are currently XSS-safe
 * because all interpolated values are numbers or hardcoded labels, but the
 * codebase has no explicit sanitization layer — any future feature that
 * allows user-supplied strings (project names, notes, etc.) into the rendered
 * HTML would create an XSS sink.
 *
 * This module wraps DOMPurify when available, and falls back to an
 * allow-list-based escape for the small set of tags the engines actually
 * produce (tables, spans, subscripts, supscripts, KaTeX output).
 */

// Minimal type shim for the dynamic dompurify import. The real types come
// from `@types/dompurify` if installed; this is the fallback shape we use.
interface PurifyLike {
    sanitize(html: string, config?: Record<string, unknown>): string;
}

let _purify: PurifyLike | null = null;
let _purifyLoadAttempted = false;

async function loadPurify(): Promise<PurifyLike | null> {
    if (_purify) return _purify;
    if (_purifyLoadAttempted) return null;
    _purifyLoadAttempted = true;
    try {
        // Dynamic import so the dependency is only loaded when sanitization
        // is actually invoked.
        const mod = await import('dompurify');
        const purify = (mod as { default?: PurifyLike }).default ?? (mod as unknown as PurifyLike);
        _purify = purify;
        return purify;
    } catch {
        return null;
    }
}

// Minimal allow-list fallback: keep only tags/attrs the engines actually emit.
const ALLOWED_TAGS = new Set([
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div', 'p', 'br', 'strong', 'b', 'em', 'i',
    'sub', 'sup', 'code', 'pre',
    'ul', 'ol', 'li',
    'hr',
    'math', 'mrow', 'mi', 'mn', 'mo', 'msup', 'msub', 'mfrac', 'mtext', 'mspace', 'annotation', 'semantics', 'mstyle',
]);

const ALLOWED_ATTRS = new Set([
    'class', 'style', 'colspan', 'rowspan', 'title',
    'data-testid',
]);

function escapeHtml(s: string): string {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function stripTagsFallback(html: string): string {
    // Very conservative: escape everything, then un-escape only the allowed tags.
    // This is NOT a full sanitizer — it does not handle attribute-value escaping
    // edge cases — but it does neutralize <script> and on* attributes. Use
    // DOMPurify in production (install via `npm i dompurify`).
    let out = '';
    let i = 0;
    while (i < html.length) {
        const lt = html.indexOf('<', i);
        if (lt === -1) { out += escapeHtml(html.slice(i)); break; }
        out += escapeHtml(html.slice(i, lt));
        const gt = html.indexOf('>', lt);
        if (gt === -1) { out += escapeHtml(html.slice(lt)); break; }
        const tagContent = html.slice(lt + 1, gt);
        const isClosing = tagContent.startsWith('/');
        const nameMatch = tagContent.match(/^\/?\s*([a-zA-Z0-9]+)/);
        const tagName = nameMatch ? nameMatch[1].toLowerCase() : '';
        if (ALLOWED_TAGS.has(tagName)) {
            const attrPart = isClosing ? '' : tagContent.slice(nameMatch![0].length);
            const cleanedAttrs = attrPart
                .replace(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g, (_m, k: string, v: string) =>
                    ALLOWED_ATTRS.has(k.toLowerCase()) ? ` ${k}="${v}"` : '')
                .replace(/([a-zA-Z-]+)\s*=\s*'([^']*)'/g, (_m, k: string, v: string) =>
                    ALLOWED_ATTRS.has(k.toLowerCase()) ? ` ${k}="${v}"` : '')
                .replace(/\s+on[a-zA-Z-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                .trim();
            out += isClosing ? `</${tagName}>` : `<${tagName}${cleanedAttrs ? ' ' + cleanedAttrs : ''}>`;
        }
        i = gt + 1;
    }
    return out;
}

/**
 * Sanitize an HTML string for safe injection via innerHTML /
 * dangerouslySetInnerHTML. Async because DOMPurify is loaded dynamically.
 *
 * @param html - the HTML string to sanitize
 * @returns the sanitized HTML string
 */
export async function sanitizeHtml(html: string): Promise<string> {
    if (typeof html !== 'string') return '';
    const purify = await loadPurify();
    if (purify) {
        return purify.sanitize(html, {
            ALLOWED_TAGS: [...ALLOWED_TAGS, 'a', 'img'],
            ALLOWED_ATTR: [...ALLOWED_ATTRS, 'href', 'src', 'alt', 'target', 'rel'],
        });
    }
    return stripTagsFallback(html);
}

/**
 * Synchronous best-effort sanitizer. Use ONLY when you cannot await (e.g.
 * inside a React render). Prefer `sanitizeHtml` whenever possible.
 *
 * @param html - the HTML string to sanitize
 * @returns the sanitized HTML string
 */
export function sanitizeHtmlSync(html: string): string {
    if (typeof html !== 'string') return '';
    return stripTagsFallback(html);
}
