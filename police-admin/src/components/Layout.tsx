import { Link, useLocation } from 'react-router-dom';
import { IconDashboard, IconLive, IconMonitor, IconNotices, IconPlus, IconReports, IconSettings } from './Icons';
import { PoliceSlogan } from './PoliceSlogan';
import { getOfficerProfile } from '../services/api';
import { useAuth } from '../store/AuthContext';

interface LayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  pageClass?: string;
}

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: IconDashboard },
  { to: '/monitoring', label: 'Live monitoring', icon: IconMonitor },
  { to: '/reports', label: 'Citizen reports', icon: IconReports },
  { to: '/notices', label: 'All notices', icon: IconNotices },
  { to: '/notices/new', label: 'Create notice', icon: IconPlus },
  { to: '/live', label: 'Notice feed', icon: IconLive },
  { to: '/settings', label: 'Data retention', icon: IconSettings },
] as const;

function isSidebarNavActive(to: string, pathname: string): boolean {
  if (to === '/notices/new') return pathname === '/notices/new';
  if (to === '/notices') {
    return pathname === '/notices' || (
      pathname.startsWith('/notices/') && pathname !== '/notices/new'
    );
  }
  if (to === '/dashboard') return pathname === '/dashboard';
  return pathname === to;
}

export function Layout({ title, subtitle, children, actions, pageClass }: LayoutProps) {
  const location = useLocation();
  const { logout } = useAuth();
  const officer = getOfficerProfile();
  const initials = officer?.name
    ? officer.name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase()
    : 'CO';

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-stripe" />
        <div className="sidebar-brand">
          <div className="brand-mark">
            <img
              src="/police-badge.jpeg"
              alt="Royal Eswatini Police Service"
              className="brand-badge-img"
            />
          </div>
          <div>
            <p className="brand-org">Royal Eswatini Police Service</p>
            <h1>Communications</h1>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              aria-current={isSidebarNavActive(to, location.pathname) ? 'page' : undefined}
              className={isSidebarNavActive(to, location.pathname) ? 'nav-link active' : 'nav-link'}
            >
              <span className="nav-icon"><Icon /></span>
              {label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{initials}</div>
            <div className="user-card-text">
              <p className="user-name">{officer?.name ?? 'Comms Officer'}</p>
              <p className="user-role">{officer?.rank ?? 'Communications Dept.'}</p>
            </div>
          </div>
          <button type="button" className="logout-btn" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>

      <div className="main-content dashboard-badge-bg">
        <header className="topbar">
          <div className="topbar-titles">
            <PoliceSlogan />
            <h2 className="page-title">{title}</h2>
            {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="btn-group topbar-actions">{actions}</div> : null}
        </header>
        <main className={pageClass ? `page-body ${pageClass}` : 'page-body'}>{children}</main>
      </div>
    </div>
  );
}
