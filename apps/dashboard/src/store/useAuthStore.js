/**
 * @file apps/dashboard/src/store/useAuthStore.js
 * @description Global authentication state via Zustand.
 *
 * State shape:
 *  {
 *    token:   string | null  — raw JWT string
 *    user:    UserProfile | null
 *    isReady: boolean        — true once the stored token has been rehydrated
 *  }
 *
 * Persistence strategy:
 *  The JWT is persisted to localStorage under the key `nebula:auth:token`.
 *  On app load, `initAuth()` reads it back, decodes the payload, and
 *  populates `user` without making a network request — so the app shell
 *  renders immediately without a loading flash while user data is fetched.
 *  If the token is expired, `initAuth()` calls `logout()` silently.
 *
 * Security notes:
 *  - localStorage is appropriate for SPAs where HttpOnly cookies cannot be
 *    used (e.g., cross-origin API). For deployments where the API origin
 *    matches the frontend, migrate to HttpOnly cookies in a future phase.
 *  - The token is never logged or included in analytics events.
 *
 * Usage:
 *  const { user, token, login, logout, isReady } = useAuthStore();
 */

import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_STORAGE_KEY = 'nebula:auth:token';

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

/**
 * Decodes the payload of a JWT without verifying the signature.
 * Signature verification happens server-side; the client only reads claims
 * for UI purposes (display name, role, org).
 *
 * @param {string} token
 * @returns {object | null}
 */
function decodeJwtPayload(token) {
  try {
    const [, payloadB64] = token.split('.');
    const json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Returns true if the token's `exp` claim is in the past.
 * @param {object} payload - Decoded JWT payload.
 * @returns {boolean}
 */
function isTokenExpired(payload) {
  if (!payload?.exp) return true;
  // exp is in seconds; Date.now() is in milliseconds.
  return Date.now() / 1000 > payload.exp;
}

/**
 * Maps the decoded JWT payload to our internal UserProfile shape.
 *
 * @param {object}  payload
 * @param {string}  payload.sub
 * @param {string}  payload.email
 * @param {string}  [payload.name]
 * @param {string}  payload.organizationId
 * @param {string}  payload.role
 * @param {string}  [payload.avatarUrl]
 * @returns {UserProfile}
 */
function payloadToProfile(payload) {
  return {
    id:             payload.sub,
    email:          payload.email          ?? '',
    displayName:    payload.name           ?? payload.email ?? 'Unknown User',
    organizationId: payload.organizationId ?? '',
    role:           payload.role           ?? 'VIEWER',
    avatarUrl:      payload.avatarUrl      ?? null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * @typedef {object} UserProfile
 * @property {string}       id
 * @property {string}       email
 * @property {string}       displayName
 * @property {string}       organizationId
 * @property {'OWNER'|'ADMIN'|'DEVELOPER'|'VIEWER'} role
 * @property {string|null}  avatarUrl
 */

/**
 * @typedef {object} AuthState
 * @property {string|null}      token
 * @property {UserProfile|null} user
 * @property {boolean}          isReady   - Rehydration from localStorage is complete.
 * @property {boolean}          isAuthenticated
 * @property {function}         login
 * @property {function}         logout
 * @property {function}         initAuth
 */

export const useAuthStore = create((set, get) => ({
  // ── State ────────────────────────────────────────────────────────────────
  token:           null,
  user:            null,
  isReady:         false,  // false until initAuth() has run
  isAuthenticated: false,

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Called by the login page after a successful API authentication response.
   * Persists the token and populates the user profile from its claims.
   *
   * @param {string} token - Raw JWT string from the API response.
   */
  login(token) {
    const payload = decodeJwtPayload(token);

    if (!payload || isTokenExpired(payload)) {
      console.warn('[useAuthStore] login() received an invalid or expired token.');
      return;
    }

    localStorage.setItem(TOKEN_STORAGE_KEY, token);

    set({
      token,
      user:            payloadToProfile(payload),
      isAuthenticated: true,
    });
  },

  /**
   * Clears all auth state and removes the token from localStorage.
   * Call on explicit logout or on receiving a 401 response from the API.
   */
  logout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    set({ token: null, user: null, isAuthenticated: false });
  },

  /**
   * Reads the persisted token from localStorage and rehydrates state.
   * Must be called once at application startup (in main.jsx or App.jsx).
   * Sets `isReady = true` when complete so ProtectedRoute can make a
   * routing decision without flashing an unauthenticated screen.
   */
  initAuth() {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);

    if (!stored) {
      set({ isReady: true, isAuthenticated: false });
      return;
    }

    const payload = decodeJwtPayload(stored);

    if (!payload || isTokenExpired(payload)) {
      // Token is present but invalid or expired — clear it silently.
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      set({ isReady: true, isAuthenticated: false });
      return;
    }

    set({
      token:           stored,
      user:            payloadToProfile(payload),
      isAuthenticated: true,
      isReady:         true,
    });
  },
}));

// ---------------------------------------------------------------------------
// Selectors (memoised — prevents unnecessary re-renders)
// ---------------------------------------------------------------------------

/** Returns only the fields needed for UI display — prevents over-subscription. */
export const selectUser            = (s) => s.user;
export const selectToken           = (s) => s.token;
export const selectIsAuthenticated = (s) => s.isAuthenticated;
export const selectIsReady         = (s) => s.isReady;
export const selectRole            = (s) => s.user?.role ?? 'VIEWER';
