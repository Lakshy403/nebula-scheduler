/**
 * @file apps/dashboard/src/lib/api.js
 * @description Pre-configured Axios instance for all API communication.
 *
 * Features:
 *  - Base URL from VITE_API_BASE_URL env var (falls back to relative path for
 *    the Vite dev proxy configured in vite.config.js).
 *  - Request interceptor: injects `Authorization: Bearer <token>` from
 *    the Zustand store on every outgoing request.
 *  - Response interceptor: on 401, calls `logout()` and redirects to /login
 *    so expired tokens are handled globally without per-component checks.
 *  - Structured error normalisation: all API errors expose a consistent
 *    `{ message, code, errors }` shape regardless of the HTTP status.
 */

import axios           from 'axios';
import { useAuthStore } from '@/store/useAuthStore';

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

export const api = axios.create({
  baseURL:         import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  timeout:         15_000,
  headers: {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  },
});

// ---------------------------------------------------------------------------
// Request interceptor — attach JWT
// ---------------------------------------------------------------------------

api.interceptors.request.use(
  (config) => {
    // Read directly from Zustand store (not a hook — safe outside React tree).
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ---------------------------------------------------------------------------
// Response interceptor — handle 401 globally
// ---------------------------------------------------------------------------

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      // Hard redirect: clears React state tree cleanly.
      window.location.replace('/login');
    }
    // Normalise the error shape so callers always get { message, code, errors }
    const apiError      = error.response?.data;
    const normalisedErr = new Error(
      apiError?.message ?? error.message ?? 'An unexpected error occurred.',
    );
    normalisedErr.code   = apiError?.code   ?? 'NETWORK_ERROR';
    normalisedErr.errors = apiError?.errors ?? {};
    normalisedErr.status = error.response?.status;
    return Promise.reject(normalisedErr);
  },
);
