// Type declarations for non-standard imports used by the project.

// `?raw` imports — supported by Next.js's bundler. Returns the file content
// as a string at build time.
declare module '*?raw' {
    const content: string;
    export default content;
}

declare module '*.css?raw' {
    const content: string;
    export default content;
}

declare module '*.css';

// KaTeX is JS-only in the published package; the type bundler doesn't see it.
declare module 'katex';
