/**
 * Logger — thin wrapper around console that is silent in production.
 *
 * Replaces the 13 direct `console.error` calls scattered across the analyzers
 * and report generators. In development (`NODE_ENV !== 'production'`) the
 * calls pass through to `console`. In production they are no-ops, so users
 * don't see stack-trace-level detail in their browser devtools and the noise
 * that masks real issues is eliminated.
 *
 * Swap this out for a real telemetry sink (Sentry, Datadog, etc.) by editing
 * the body of `error` / `warn` below.
 */

const isProd: boolean =
    typeof process !== 'undefined' &&
    Boolean(process.env) &&
    process.env.NODE_ENV === 'production';

/** Variadic console-style args. */
type ConsoleArgs = unknown[];

export const logger = {
    error(...args: ConsoleArgs): void {
        if (!isProd) console.error(...args);
        // TODO: ship to telemetry endpoint in production
    },
    warn(...args: ConsoleArgs): void {
        if (!isProd) console.warn(...args);
    },
    info(...args: ConsoleArgs): void {
        if (!isProd) console.info(...args);
    },
    debug(...args: ConsoleArgs): void {
        if (!isProd) console.debug(...args);
    },
};
