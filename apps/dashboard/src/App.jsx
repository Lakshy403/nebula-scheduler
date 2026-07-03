/**
 * @file apps/dashboard/src/App.jsx
 * @description Application root: router, auth gate, and query client provider.
 *
 * Component tree:
 *  <QueryClientProvider>          — TanStack Query global cache
 *    <BrowserRouter>              — HTML5 history router
 *      <AuthInitializer>          — Runs initAuth() once on mount
 *        <Routes>
 *          /login                 → <LoginPage> (public)
 *          /                      → <ProtectedRoute> → <DashboardLayout>
 *            index                → <OverviewPage>
 *            /jobs                → <JobsPage>
 *            /workers             → <WorkersPage>
 *            /dlq                 → <DLQPage>
 *            /settings            → <SettingsPage>
 *          *                      → <NotFoundPage>
 *        </Routes>
 *      </AuthInitializer>
 *    </BrowserRouter>
 *  </QueryClientProvider>
 *
 * ProtectedRoute:
 *  Waits for `isReady` (auth rehydration) before making any routing decision.
 *  Renders a full-screen loading spinner during rehydration to prevent a
 *  "flash of unauthenticated content" where the login page appears briefly
 *  before the stored token is read.
 */

import React, { useEffect }       from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
}                                 from 'react-router-dom';
import {
  QueryClient,
  QueryClientProvider,
}                                 from '@tanstack/react-query';
import { ReactQueryDevtools }     from '@tanstack/react-query-devtools';

import {
  useAuthStore,
  selectIsAuthenticated,
  selectIsReady,
}                                 from '@/store/useAuthStore';
import DashboardLayout            from '@/layouts/DashboardLayout';
import BackgroundWaves            from '@/components/BackgroundWaves';

// ── Lazy-loaded pages (code-splitting per route) ───────────────────────────
const LoginPage    = React.lazy(() => import('@/pages/LoginPage'));
const OverviewPage = React.lazy(() => import('@/pages/OverviewPage'));
const JobsPage     = React.lazy(() => import('@/pages/JobsPage'));
const WorkersPage  = React.lazy(() => import('@/pages/WorkersPage'));
const DLQPage      = React.lazy(() => import('@/pages/DLQPage'));
const SettingsPage = React.lazy(() => import('@/pages/SettingsPage'));
const NotFoundPage = React.lazy(() => import('@/pages/NotFoundPage'));

// ---------------------------------------------------------------------------
// TanStack Query client
// ---------------------------------------------------------------------------

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache data for 60 s before considering it stale.
      staleTime:          60_000,
      // Keep unused query data in cache for 5 minutes.
      gcTime:             5 * 60_000,
      // Retry failed requests up to 2 times with a capped exponential delay.
      retry:              2,
      retryDelay:         (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      // Do not re-fetch on window focus in a server dashboard context —
      // dashboards stay open for hours and focus events fire very frequently.
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0, // mutations are not idempotent by default; never auto-retry
    },
  },
});

// ---------------------------------------------------------------------------
// AuthInitializer
// ---------------------------------------------------------------------------

/**
 * Runs `initAuth()` exactly once at the start of the application lifecycle.
 * This rehydrates the JWT from localStorage before any routing decision is made.
 */
function AuthInitializer({ children }) {
  const initAuth = useAuthStore((s) => s.initAuth);

  useEffect(() => {
    initAuth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally run once

  return children;
}

// ---------------------------------------------------------------------------
// LoadingScreen
// ---------------------------------------------------------------------------

/**
 * Full-screen spinner shown during auth rehydration.
 * Prevents the login page from flashing for authenticated users.
 */
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        {/* Animated nebula logo mark */}
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full bg-brand-500/20 animate-ping" />
          <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-brand-500 to-indigo-600 flex items-center justify-center shadow-glow-brand">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-white" aria-hidden="true">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        <p className="text-sm text-muted animate-pulse-slow">Initialising Nebula Scheduler…</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProtectedRoute
// ---------------------------------------------------------------------------

/**
 * Guards a set of routes behind authentication.
 *
 * States:
 *  - `isReady = false` → render <LoadingScreen> (rehydration in progress).
 *  - `isReady = true, isAuthenticated = false` → redirect to /login.
 *  - `isReady = true, isAuthenticated = true`  → render <Outlet>.
 *
 * `replace` on the Navigate prevents the protected URL from polluting the
 * browser history when the user is redirected to login.
 */
function ProtectedRoute() {
  const isReady         = useAuthStore(selectIsReady);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);

  if (!isReady) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

// ---------------------------------------------------------------------------
// PageSuspense
// ---------------------------------------------------------------------------

/**
 * Wraps lazy-loaded pages with a lightweight fallback.
 * The skeleton takes the full viewport height to avoid layout jumps.
 */
function PageSuspense({ children }) {
  return (
    <React.Suspense
      fallback={
        <div className="flex-1 p-6 animate-fade-in">
          <div className="space-y-4 max-w-4xl">
            <div className="skeleton h-8 w-56 rounded-lg" />
            <div className="skeleton h-4 w-80 rounded-md" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-28 rounded-xl" />
              ))}
            </div>
            <div className="skeleton h-64 rounded-xl mt-4" />
          </div>
        </div>
      }
    >
      {children}
    </React.Suspense>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BackgroundWaves />
      <BrowserRouter>
        <AuthInitializer>
          <Routes>
            {/* ── Public routes ──────────────────────────────────────── */}
            <Route
              path="/login"
              element={
                <PageSuspense>
                  <LoginPage />
                </PageSuspense>
              }
            />

            {/* ── Protected routes (require auth) ────────────────────── */}
            <Route element={<ProtectedRoute />}>
              <Route element={<DashboardLayout />}>
                <Route
                  index
                  element={
                    <PageSuspense>
                      <OverviewPage />
                    </PageSuspense>
                  }
                />
                <Route
                  path="jobs"
                  element={
                    <PageSuspense>
                      <JobsPage />
                    </PageSuspense>
                  }
                />
                <Route
                  path="workers"
                  element={
                    <PageSuspense>
                      <WorkersPage />
                    </PageSuspense>
                  }
                />
                <Route
                  path="dlq"
                  element={
                    <PageSuspense>
                      <DLQPage />
                    </PageSuspense>
                  }
                />
                <Route
                  path="settings"
                  element={
                    <PageSuspense>
                      <SettingsPage />
                    </PageSuspense>
                  }
                />
              </Route>
            </Route>

            {/* ── Catch-all ─────────────────────────────────────────── */}
            <Route
              path="*"
              element={
                <PageSuspense>
                  <NotFoundPage />
                </PageSuspense>
              }
            />
          </Routes>
        </AuthInitializer>
      </BrowserRouter>

      {/* TanStack Query devtools — visible only in development */}
      {import.meta.env.DEV && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
      )}
    </QueryClientProvider>
  );
}
