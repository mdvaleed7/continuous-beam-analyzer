// ponytail: was 7 lines with 4 separate guarded wrappers. Production-silent
// console is one ternary — bind to console in dev, to no-ops in production.
type Logger = Pick<Console, 'error' | 'warn' | 'info' | 'debug'>;
const noop: (...a: unknown[]) => void = () => {};
const sink: Logger = process.env.NODE_ENV !== 'production' ? console : { error: noop, warn: noop, info: noop, debug: noop };
export const logger = sink;
