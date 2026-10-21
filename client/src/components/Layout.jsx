import { Cpu, FolderKanban, FolderPlus, LayoutDashboard, LogOut, Menu, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useMeta } from '../lib/meta.jsx';
import { ErrorBoundary } from './ErrorBoundary.jsx';

export function Brand({ light }) {
  return (
    <div className={`brand${light ? ' brand-light' : ''}`}>
      <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#12395E" />
        <path d="M18 22 L10 32 L18 42" fill="none" stroke="#17C3B2" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M46 22 L54 32 L46 42" fill="none" stroke="#17C3B2" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 44 V20 M24 28 L32 20 L40 28" fill="none" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div>
        <div className="brand-name">LegacyLift</div>
        <div className="brand-tag">AI legacy modernization</div>
      </div>
    </div>
  );
}

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/projects', label: 'Projects', icon: FolderKanban, end: true },
  { to: '/projects/new', label: 'New project', icon: FolderPlus },
];

export function Layout() {
  const { user, logout } = useAuth();
  const meta = useMeta();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  return (
    <div className="shell">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-top">
          <Brand />
          <button type="button" className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} onClick={() => setOpen(false)}>
              <n.icon size={18} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="engine-card">
          <div className="engine-title">
            {meta?.ai?.enabled ? <Sparkles size={15} /> : <Cpu size={15} />}
            Generation engine
          </div>
          <div className="engine-value">{meta ? (meta.ai.enabled ? meta.ai.model : 'Rule-based translator') : '…'}</div>
          <div className="engine-hint">{meta?.ai?.enabled ? 'AST-guided Claude generation' : 'Set ANTHROPIC_API_KEY to enable AI'}</div>
        </div>
        <div className="sidebar-user">
          <div className="avatar" aria-hidden="true">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="user-text">
            <div className="user-name">{user?.name}</div>
            <div className="user-email">{user?.email}</div>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Sign out"
            title="Sign out"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {open && <div className="sidebar-scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <Brand light />
        </header>
        <main className="content">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
