/**
 * @file services/api/utils/logger.js
 * @description Structured JSON logger using Winston.
 *
 * Transports:
 *  - Console: Pretty-printed in development; strict JSON in production
 *             (compatible with Cloud Logging / DataDog / ELK ingestion).
 *  - File (combined): All levels ≥ INFO written to logs/combined.log.
 *  - File (error):    Only ERROR+ written to logs/error.log.
 *
 * Log record shape (production):
 *  {
 *    "timestamp": "2026-07-02T07:48:06.123Z",
 *    "level":     "info",
 *    "service":   "nebula-api",
 *    "requestId": "550e8400-e29b-41d4-a716-446655440000",  // via child logger
 *    "message":   "HTTP request received",
 *    "method":    "POST",
 *    "path":      "/api/v1/jobs",
 *    "durationMs": 14
 *  }
 */

import winston               from 'winston';
import 'winston-daily-rotate-file';
import path                  from 'node:path';
import { fileURLToPath }     from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LOG_DIR     = path.resolve(__dirname, '../../../logs');
const SERVICE     = process.env.SERVICE_NAME ?? 'nebula-api';
const NODE_ENV    = process.env.NODE_ENV     ?? 'development';
const LOG_LEVEL   = process.env.LOG_LEVEL    ?? (NODE_ENV === 'production' ? 'info' : 'debug');

// ---------------------------------------------------------------------------
// Custom formats
// ---------------------------------------------------------------------------

/**
 * Merges the service name and a fixed set of base fields into every record.
 * Fields added here appear in every log entry without requiring call-site boilerplate.
 */
const baseFields = winston.format((info) => {
  info.service  = SERVICE;
  info.env      = NODE_ENV;
  info.pid      = process.pid;
  return info;
});

/**
 * Serialises Error objects so that `.stack`, `.code`, and `.cause` are included
 * in the JSON output rather than being silently dropped by JSON.stringify.
 */
const serializeErrors = winston.format((info) => {
  if (info.error instanceof Error) {
    info.error = {
      name:    info.error.name,
      message: info.error.message,
      stack:   info.error.stack,
      code:    info.error.code,
      ...(info.error.cause ? { cause: String(info.error.cause) } : {}),
    };
  }
  return info;
});

// Production: pure JSON — no ANSI codes, no pretty-printing.
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  baseFields(),
  serializeErrors(),
  winston.format.json(),
);

// Development: colourised, single-line output for readability in terminals.
const prettyFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  baseFields(),
  serializeErrors(),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, requestId, durationMs, ...rest }) => {
    const reqId = requestId ? ` [${requestId}]` : '';
    const ms    = durationMs !== undefined ? ` +${durationMs}ms` : '';
    const meta  = Object.keys(rest).length
      ? `\n  ${JSON.stringify(rest, null, 2).replace(/\n/g, '\n  ')}`
      : '';
    return `${timestamp} ${level}${reqId}${ms}: ${message}${meta}`;
  }),
);

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

/** Rotating file — all levels ≥ INFO. */
const combinedFileTransport = new winston.transports.DailyRotateFile({
  dirname:         LOG_DIR,
  filename:        'combined-%DATE%.log',
  datePattern:     'YYYY-MM-DD',
  maxFiles:        '14d',      // retain 14 days of combined logs
  maxSize:         '100m',     // rotate at 100 MB regardless of date
  zippedArchive:   true,
  format:          jsonFormat,
  level:           'info',
});

/** Rotating file — ERROR+ only for fast incident triage. */
const errorFileTransport = new winston.transports.DailyRotateFile({
  dirname:         LOG_DIR,
  filename:        'error-%DATE%.log',
  datePattern:     'YYYY-MM-DD',
  maxFiles:        '30d',
  maxSize:         '50m',
  zippedArchive:   true,
  format:          jsonFormat,
  level:           'error',
});

const consoleTransport = new winston.transports.Console({
  format: NODE_ENV === 'production' ? jsonFormat : prettyFormat,
});

// ---------------------------------------------------------------------------
// Logger instance
// ---------------------------------------------------------------------------
const logger = winston.createLogger({
  level:             LOG_LEVEL,
  exitOnError:       false,   // prevent uncaught transport errors from killing the process
  transports:        [
    consoleTransport,
    combinedFileTransport,
    errorFileTransport,
  ],

  // Capture unhandled rejections and uncaught exceptions through the logger
  // so that they appear as structured JSON rather than raw stack traces.
  exceptionHandlers: [
    new winston.transports.DailyRotateFile({
      dirname:       LOG_DIR,
      filename:      'exceptions-%DATE%.log',
      datePattern:   'YYYY-MM-DD',
      maxFiles:      '30d',
      zippedArchive: true,
      format:        jsonFormat,
    }),
    new winston.transports.Console({ format: jsonFormat }),
  ],
  rejectionHandlers: [
    new winston.transports.DailyRotateFile({
      dirname:       LOG_DIR,
      filename:      'rejections-%DATE%.log',
      datePattern:   'YYYY-MM-DD',
      maxFiles:      '30d',
      zippedArchive: true,
      format:        jsonFormat,
    }),
    new winston.transports.Console({ format: jsonFormat }),
  ],
});

// ---------------------------------------------------------------------------
// Child logger factory
// ---------------------------------------------------------------------------
/**
 * Creates a scoped child logger pre-bound with a `requestId` field.
 * Use in Express request handlers so every log line carries the trace context.
 *
 * @param {string} requestId - UUID (e.g., from the `X-Request-ID` header).
 * @returns {winston.Logger}
 *
 * @example
 * const reqLogger = logger.child({ requestId: req.id });
 * reqLogger.info('Processing job enqueue', { jobName: body.name });
 */
// winston's native child() is already available

export default logger;
