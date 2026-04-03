import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

let hasPinoPretty = false;
if (isDev) {
  try {
    require.resolve("pino-pretty");
    hasPinoPretty = true;
  } catch {
    // pino-pretty not installed — fall back to JSON logs
  }
}

/**
 * Structured logger using pino.
 *
 * Development: pretty-printed, colorized output via pino-pretty (if installed).
 * Production:  JSON output for log aggregation.
 *
 * Install pino-pretty for readable dev logs:
 *   npm install pino-pretty -x-save-dev
 *
 * Log levels: trace < debug < info < warn < error < fatal
 */
const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  base: { service: "padlok-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.pin",
      "*.token",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  ...(isDev &&
    hasPinoPretty && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname,service",
          messageFormat: "{msg}",
          errorLikeObjectKeys: ["err", "error"],
          errorProps: "message,stack",
        },
      },
    }),
});

export default logger;
