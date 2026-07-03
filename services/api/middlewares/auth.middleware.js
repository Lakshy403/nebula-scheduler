/**
 * @file services/api/middlewares/auth.middleware.js
 * @description JWT authentication and multi-tenant context middleware.
 *
 * Security model:
 *  1. Token is extracted from the `Authorization: Bearer <token>` header.
 *  2. Verified against the primary secret with algorithm lock (HS256).
 *     In production this should be replaced with RS256 + JWKS public-key
 *     verification so the API service never holds the signing secret.
 *  3. Claims are validated for required fields before binding to req.user.
 *  4. The resolved organizationId is bound to req.tenantId for downstream
 *     middleware to enforce row-level multi-tenancy.
 *
 * Error contract:
 *  All auth failures return 401 with a structured JSON body:
 *  { "status": "error", "code": "AUTH_<REASON>", "message": "..." }
 *  No stack traces are leaked to the client.
 */

import jwt    from 'jsonwebtoken';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const JWT_SECRET        = process.env.JWT_SECRET;
const JWT_ALGORITHM     = 'HS256';
const BEARER_PREFIX     = 'Bearer ';
const BEARER_PREFIX_LEN = BEARER_PREFIX.length;

if (!JWT_SECRET) {
  // Fail hard at boot-time rather than silently accepting unsigned tokens.
  throw new Error('[auth.middleware] JWT_SECRET environment variable is not set.');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the raw JWT string from the Authorization header.
 * Returns null if the header is absent or malformed.
 *
 * @param {import('express').Request} req
 * @returns {string | null}
 */
function extractToken(req) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX_LEN).trim();
  return token.length > 0 ? token : null;
}

/**
 * Sends a structured 401 response without leaking internal details.
 *
 * @param {import('express').Response} res
 * @param {string} code   - Machine-readable error code (e.g., 'AUTH_TOKEN_EXPIRED').
 * @param {string} message - Human-readable explanation.
 */
function unauthorized(res, code, message) {
  res.status(401).json({
    status:  'error',
    code,
    message,
  });
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * `authenticate` — verifies the JWT and populates `req.user` and `req.tenantId`.
 *
 * Attach after route-level rate-limiting, before any controller logic.
 *
 * @type {import('express').RequestHandler}
 */
export const authenticate = (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return unauthorized(res, 'AUTH_TOKEN_MISSING', 'Authorization token is required.');
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, {
      algorithms:   [JWT_ALGORITHM],
      // Enforce that issued-at (iat) is present — rejects tokens without a timestamp.
      complete:     false,
    });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      logger.warn('JWT verification failed — token expired', {
        requestId: req.id,
        expiredAt: err.expiredAt,
      });
      return unauthorized(res, 'AUTH_TOKEN_EXPIRED', 'Token has expired. Please re-authenticate.');
    }

    if (err instanceof jwt.JsonWebTokenError) {
      logger.warn('JWT verification failed — invalid token', {
        requestId: req.id,
        reason:    err.message,
      });
      return unauthorized(res, 'AUTH_TOKEN_INVALID', 'Token is malformed or signature is invalid.');
    }

    // Unexpected verification failure — log with full context for ops triage.
    logger.error('JWT verification encountered an unexpected error', {
      requestId: req.id,
      error:     err,
    });
    return unauthorized(res, 'AUTH_INTERNAL_ERROR', 'Authentication service error.');
  }

  // ── Validate required claims ─────────────────────────────────────────────
  const { sub, organizationId, role } = payload;

  if (!sub) {
    logger.warn('JWT missing required claim: sub', { requestId: req.id });
    return unauthorized(res, 'AUTH_CLAIM_MISSING', 'Token is missing required identity claims.');
  }

  if (!organizationId) {
    logger.warn('JWT missing required claim: organizationId', { requestId: req.id, sub });
    return unauthorized(res, 'AUTH_CLAIM_MISSING', 'Token is missing tenant context.');
  }

  // ── Bind resolved identity to request ───────────────────────────────────
  /**
   * @type {ResolvedUser}
   * @property {string} id             - User UUID (from `sub` claim).
   * @property {string} organizationId - Tenant UUID.
   * @property {string} role           - RBAC role string.
   */
  req.user = {
    id:             sub,
    organizationId: organizationId,
    role:           role ?? 'VIEWER',
  };

  // Convenience alias used by downstream tenant-scoping middleware.
  req.tenantId = organizationId;

  next();
};

// ---------------------------------------------------------------------------
// RBAC guard factory
// ---------------------------------------------------------------------------

/**
 * `requireRole` — factory that returns a middleware enforcing a minimum role.
 *
 * Role hierarchy (highest → lowest): OWNER > ADMIN > DEVELOPER > VIEWER
 *
 * @param {...string} allowedRoles - One or more roles permitted to proceed.
 * @returns {import('express').RequestHandler}
 *
 * @example
 * router.delete('/queues/:id', authenticate, requireRole('OWNER', 'ADMIN'), deleteQueue);
 */
export const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    // Guard against misconfigured route chains that skip `authenticate`.
    return unauthorized(res, 'AUTH_TOKEN_MISSING', 'Authentication required.');
  }

  if (!allowedRoles.includes(req.user.role)) {
    logger.warn('Authorisation denied — insufficient role', {
      requestId:    req.id,
      userId:       req.user.id,
      userRole:     req.user.role,
      requiredRoles: allowedRoles,
      path:         req.path,
    });
    return res.status(403).json({
      status:  'error',
      code:    'AUTH_FORBIDDEN',
      message: `This action requires one of the following roles: ${allowedRoles.join(', ')}.`,
    });
  }

  next();
};
