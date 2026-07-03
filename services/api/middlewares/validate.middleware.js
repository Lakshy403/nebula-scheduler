/**
 * @file services/api/middlewares/validate.middleware.js
 * @description Generic Zod request validation middleware factory.
 *
 * Design:
 *  - `validate(schema, source?)` is a factory that returns an Express middleware.
 *  - It validates `req[source]` (default: `req.body`) against the provided Zod schema.
 *  - On success: replaces `req[source]` with the schema's **parsed output** — this is
 *    critical because Zod's `.parse()` applies transforms, coercions, and defaults in
 *    addition to validation. Downstream code always receives clean, typed data.
 *  - On failure: maps Zod's flat issue array into a structured 422 response with
 *    per-field error details. No raw Zod internals are leaked to the client.
 *
 * Supported sources:
 *  - 'body'   — req.body  (POST / PUT / PATCH payloads)
 *  - 'query'  — req.query (GET filter/pagination parameters)
 *  - 'params' — req.params (URL path parameters such as :id)
 *
 * Usage:
 *  import { validate } from '../middlewares/validate.middleware.js';
 *  import { createJobSchema } from '../validators/job.schema.js';
 *
 *  router.post('/', validate(createJobSchema), JobController.create);
 *  router.get('/',  validate(listJobsSchema, 'query'), JobController.list);
 */

import { ZodError } from 'zod';
import logger       from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

/**
 * Converts a ZodError's flat issue array into an object keyed by field path.
 *
 * Input (Zod issues):
 *  [
 *    { path: ['payload', 'type'], message: 'Required' },
 *    { path: ['priority'],        message: 'Number must be between 1 and 10' },
 *  ]
 *
 * Output:
 *  {
 *    "payload.type": "Required",
 *    "priority":     "Number must be between 1 and 10"
 *  }
 *
 * @param {import('zod').ZodError} zodError
 * @returns {Record<string, string>}
 */
function formatZodErrors(zodError) {
  return zodError.issues.reduce((acc, issue) => {
    // Join nested path segments with dots for readable field references.
    const key    = issue.path.join('.') || '_root';
    // Take only the first error per field to avoid redundant messages.
    acc[key] = acc[key] ?? issue.message;
    return acc;
  }, {});
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Returns an Express middleware that validates `req[source]` against `schema`.
 *
 * @param {import('zod').ZodTypeAny} schema  - Zod schema to validate against.
 * @param {'body' | 'query' | 'params'}  [source='body'] - Request property to validate.
 * @returns {import('express').RequestHandler}
 */
export function validate(schema, source = 'body') {
  if (!schema || typeof schema.safeParse !== 'function') {
    throw new TypeError('[validate] First argument must be a Zod schema.');
  }
  if (!['body', 'query', 'params'].includes(source)) {
    throw new TypeError(`[validate] Invalid source '${source}'. Must be body | query | params.`);
  }

  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (result.success) {
      // Overwrite the raw request property with Zod's parsed output.
      // Use Object.defineProperty to bypass Express's getter-only properties (like req.query).
      Object.defineProperty(req, source, {
        value: result.data,
        writable: true,
        enumerable: true,
        configurable: true
      });
      return next();
    }

    // Validation failure — build a structured 422 response.
    const fieldErrors = formatZodErrors(result.error);

    logger.warn('Request validation failed.', {
      requestId:   req.id,
      method:      req.method,
      path:        req.path,
      source,
      fieldErrors,
    });

    return res.status(422).json({
      status:  'error',
      code:    'VALIDATION_ERROR',
      message: 'Request validation failed. Check the `errors` field for details.',
      errors:  fieldErrors,
    });
  };
}
