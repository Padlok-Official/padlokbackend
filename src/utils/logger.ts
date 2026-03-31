import pino from 'pino';

/**
 * Structured logger using pino.
 *
 * Production: JSON output (pipe through `pino-pretty` locally for readability)
 *   node dist/server.js | npx pino-pretty
 *
 * Log levels: trace < debug < info < warn < error < fatal
 */
const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { service: 'padlok-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.pin', '*.token'],
    censor: '[REDACTED]',
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

export default logger;
