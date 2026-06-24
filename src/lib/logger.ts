const dev = process.env.NODE_ENV !== 'production';
export const logger = {
  error: (...a: unknown[]) => dev && console.error(...a),
  warn:  (...a: unknown[]) => dev && console.warn(...a),
  info:  (...a: unknown[]) => dev && console.info(...a),
  debug: (...a: unknown[]) => dev && console.debug(...a),
};
