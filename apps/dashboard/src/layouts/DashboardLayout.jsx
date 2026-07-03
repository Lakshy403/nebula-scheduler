/**
 * @file apps/dashboard/src/layouts/DashboardLayout.jsx
 * @description Application shell with collapsible sidebar and top header.
 *
 * Visual design:
 *  Inspired by Grafana / Datadog — a dense, dark, data-first UI with:
 *  - A fixed-width collapsible sidebar (240px expanded / 64px icon-only).
 *  - A sticky top header with breadcrumbs, global status pill, and user menu.
 *  - Smooth CSS transitions on all interactive elements.
 *  - Full responsiveness: sidebar collapses to icon-only on md and hides
 *    entirely on mobile (toggled via a hamburger button in the header).
 *
 * Layout structure:
 *  <div.shell>
 *    <aside.sidebar>
 *      <SidebarHeader />    — Logo + collapse toggle
 *      <SidebarNav />       — Primary navigation links
 *      <SidebarFooter />    — Version + docs link
 *    </aside>
 *    <div.main-area>
 *      <header.top-header>
 *        <MobileMenuButton />
 *        <GlobalStatusPill />
 *        <UserMenu />
 *      </header>
 *      <main>
 *        <Outlet />         — Routed page content
 *      </main>
 *    </div>
 *  </div>
 */

import React, { useState, useCallback } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Briefcase,
  Server,
  Skull,
  Activity,
  Settings,
  ChevronLeft,
  ChevronRight,
  Bell,
  LogOut,
  User,
  Menu,
  X,
  Layers,
  ExternalLink,
  Circle,
}                                        from 'lucide-react';
import clsx                              from 'clsx';
import { useAuthStore, selectUser }      from '@/store/useAuthStore';

// ---------------------------------------------------------------------------
// Navigation items
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  {
    to:    '/',
    end:   true,
    icon:  LayoutDashboard,
    label: 'Overview',
    description: 'Cluster health at a glance',
  },
  {
    to:    '/jobs',
    icon:  Briefcase,
    label: 'Jobs',
    description: 'Browse and manage jobs',
  },
  {
    to:    '/workers',
    icon:  Server,
    label: 'Workers',
    description: 'Worker pod status',
  },
  {
    to:    '/dlq',
    icon:  Skull,
    label: 'Dead Letter Queue',
    description: 'Failed job graveyard',
  },
  {
    to:    '/settings',
    icon:  Settings,
    label: 'Settings',
    description: 'Queues, limits, and access',
  },
  {
    to:    '/activity',
    icon:  Activity,
    label: 'Activity Log',
    description: 'Recent system events',
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Nebula wordmark / logo mark in the sidebar header. */
function NebulaLogo({ collapsed }) {
  return (
    <div className={clsx('flex items-center gap-3 min-w-0', collapsed && 'justify-center')}>
      {/* Icon mark */}
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center flex-shrink-0 shadow-glow-brand">
        <Layers className="w-4 h-4 text-white" />
      </div>
      {/* Wordmark — hidden when collapsed */}
      {!collapsed && (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary tracking-tight truncate">
            Nebula
          </p>
          <p className="text-[10px] text-muted-subtle tracking-widest uppercase">
            Scheduler
          </p>
        </div>
      )}
    </div>
  );
}

/** A single sidebar navigation link. */
function SidebarNavItem({ item, collapsed }) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        clsx(
          'nav-link group relative',
          collapsed ? 'justify-center px-0' : 'px-3',
          isActive && 'active',
        )
      }
      title={collapsed ? item.label : undefined}
    >
      {({ isActive }) => (
        <>
          {/* Active indicator bar */}
          {isActive && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-brand-400 rounded-full" />
          )}

          <Icon
            className={clsx(
              'w-5 h-5 flex-shrink-0 transition-colors duration-150',
              isActive ? 'text-brand-400' : 'text-muted group-hover:text-text-secondary',
            )}
            aria-hidden="true"
          />

          {!collapsed && (
            <span className="truncate">{item.label}</span>
          )}

          {/* Tooltip shown when sidebar is collapsed */}
          {collapsed && (
            <span
              className={clsx(
                'absolute left-full ml-3 px-2.5 py-1.5 rounded-md text-xs font-medium',
                'bg-surface-overlay border border-surface-border text-text-primary',
                'whitespace-nowrap opacity-0 pointer-events-none',
                'group-hover:opacity-100 transition-opacity duration-150 z-50',
              )}
            >
              {item.label}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

/** User avatar with first-letter fallback. */
function UserAvatar({ user, size = 'sm' }) {
  const initials = (user?.displayName ?? 'U')
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  const sizeClasses = size === 'sm'
    ? 'w-8 h-8 text-xs'
    : 'w-10 h-10 text-sm';

  if (user?.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.displayName}
        className={clsx('rounded-full object-cover ring-2 ring-surface-border', sizeClasses)}
      />
    );
  }

  return (
    <div
      className={clsx(
        'rounded-full bg-gradient-to-br from-brand-600 to-indigo-700',
        'flex items-center justify-center font-semibold text-white flex-shrink-0',
        sizeClasses,
      )}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

/** Cluster status pill (always shows "Live" for now; Phase 7 will wire to /metrics). */
function GlobalStatusPill() {
  return (
    <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-success-muted border border-success-text/20">
      <Circle className="w-2 h-2 fill-success text-success animate-pulse-slow" />
      <span className="text-xs font-medium text-success-text">All Systems Operational</span>
    </div>
  );
}

/** Dropdown notification menu. */
function NotificationMenu() {
  const [open, setOpen] = useState(false);
  const unreadCount = 0; // Hook this up to a real store in a future phase

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn-icon btn-ghost relative focus-visible:ring-2 focus-visible:ring-brand-500"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {/* Unread indicator dot */}
        {unreadCount > 0 && (
          <span
            className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-500 ring-2 ring-surface-raised"
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Dropdown panel */}
          <div
            className={clsx(
              'absolute right-0 top-full mt-2 w-72 z-40 animate-fade-in',
              'glass rounded-xl shadow-card-lg overflow-hidden',
            )}
            role="menu"
          >
            <div className="px-4 py-3 border-b border-surface-border">
              <p className="text-sm font-semibold text-text-primary">Notifications</p>
            </div>
            <div className="p-4 text-center">
              <p className="text-sm text-muted">No new notifications.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Dropdown user menu rendered from the header. */
function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-border/50 transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand-500"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="User menu"
      >
        <UserAvatar user={user} size="sm" />
        <div className="hidden md:block text-left min-w-0">
          <p className="text-sm font-medium text-text-primary truncate max-w-[120px]">
            {user?.displayName ?? 'Loading…'}
          </p>
          <p className="text-[11px] text-muted-subtle truncate max-w-[120px]">
            {user?.role ?? ''}
          </p>
        </div>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Dropdown panel */}
          <div
            className={clsx(
              'absolute right-0 top-full mt-2 w-56 z-40 animate-fade-in',
              'glass rounded-xl shadow-card-lg overflow-hidden',
            )}
            role="menu"
          >
            {/* Profile info */}
            <div className="px-4 py-3 border-b border-surface-border">
              <p className="text-sm font-medium text-text-primary truncate">
                {user?.displayName}
              </p>
              <p className="text-xs text-muted-subtle truncate mt-0.5">
                {user?.email}
              </p>
            </div>

            {/* Menu items */}
            <div className="py-1">
              <button
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-muted hover:text-text-primary hover:bg-surface-border/50 transition-colors"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <User className="w-4 h-4" aria-hidden="true" />
                Profile
              </button>
              <a
                href="https://github.com/Lakshy403/nebula-scheduler"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted hover:text-text-primary hover:bg-surface-border/50 transition-colors"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <ExternalLink className="w-4 h-4" aria-hidden="true" />
                Repository
              </a>
            </div>

            <div className="border-t border-surface-border py-1">
              <button
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-danger-text hover:bg-danger-muted transition-colors"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onLogout();
                }}
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DashboardLayout
// ---------------------------------------------------------------------------

export default function DashboardLayout() {
  const user     = useAuthStore(selectUser);
  const logout   = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  // Sidebar collapse state — persisted to localStorage so it survives navigation.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('nebula:sidebar:collapsed') === 'true',
  );

  // Mobile drawer state
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('nebula:sidebar:collapsed', String(next));
      return next;
    });
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  // ── Sidebar widths ───────────────────────────────────────────────────────
  const sidebarWidth = collapsed ? 'w-16' : 'w-60';

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {/* ── Mobile overlay backdrop ─────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={clsx(
          // Positioning: fixed on mobile (drawer), relative on desktop
          'fixed lg:relative inset-y-0 left-0 z-30',
          // Width transitions
          'flex flex-col flex-shrink-0 h-full',
          'bg-surface-raised border-r border-surface-border',
          'transition-all duration-200 ease-in-out',
          sidebarWidth,
          // Mobile: hide by translating off-screen
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
        aria-label="Primary navigation"
      >
        {/* ── Sidebar header ────────────────────────────────────────────── */}
        <div
          className={clsx(
            'flex items-center h-14 px-4 flex-shrink-0',
            'border-b border-surface-border',
            collapsed ? 'justify-center' : 'justify-between',
          )}
        >
          <NebulaLogo collapsed={collapsed} />

          {!collapsed && (
            <button
              onClick={toggleSidebar}
              className="btn-icon btn-ghost hidden lg:flex"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ── Navigation ───────────────────────────────────────────────── */}
        <nav
          className={clsx(
            'flex-1 overflow-y-auto overflow-x-hidden py-4',
            collapsed ? 'px-2' : 'px-3',
          )}
        >
          <ul className="space-y-1" role="list">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <SidebarNavItem
                  item={item}
                  collapsed={collapsed}
                />
              </li>
            ))}
          </ul>

          {/* ── Section divider: System ─────────────────────────────────── */}

        </nav>

        {/* ── Sidebar footer ────────────────────────────────────────────── */}
        <div
          className={clsx(
            'flex-shrink-0 border-t border-surface-border py-3',
            collapsed ? 'px-2 flex flex-col items-center gap-2' : 'px-4',
          )}
        >
          {!collapsed ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-subtle">
                  v{import.meta.env.VITE_APP_VERSION ?? '0.1.0'}
                </span>
                <button
                  onClick={toggleSidebar}
                  className="btn-icon btn-ghost hidden lg:flex"
                  aria-label="Expand sidebar"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={toggleSidebar}
              className="btn-icon btn-ghost w-10 h-10 hidden lg:flex"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>

      {/* ── Main content area ────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* ── Top header ────────────────────────────────────────────────── */}
        <header
          className={clsx(
            'flex items-center justify-between h-14 px-4 flex-shrink-0',
            'bg-surface-raised border-b border-surface-border',
            'sticky top-0 z-10',
          )}
        >
          {/* Left: mobile menu toggle */}
          <div className="flex items-center gap-3">
            <button
              className="btn-icon btn-ghost lg:hidden"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen
                ? <X   className="w-5 h-5" />
                : <Menu className="w-5 h-5" />
              }
            </button>

            {/* Breadcrumb placeholder — populated by each page via context in Phase 7 */}
            <span className="hidden sm:block text-sm text-muted select-none">
              Nebula Scheduler
            </span>
          </div>

          {/* Center: global status */}
          <GlobalStatusPill />

          {/* Right: notifications + user menu */}
          <div className="flex items-center gap-2">
            <NotificationMenu />

            <div className="w-px h-6 bg-surface-border mx-1" aria-hidden="true" />

            <UserMenu user={user} onLogout={handleLogout} />
          </div>
        </header>

        {/* ── Page content ──────────────────────────────────────────────── */}
        <main
          className="flex-1 overflow-y-auto overflow-x-hidden"
          id="main-content"
          tabIndex={-1}
        >
          <div className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
