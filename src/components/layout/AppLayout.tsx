import { Fragment, useState, type ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { APP_VERSION, APP_AUTHOR } from '../../config/version';
import { useCompany } from '../../hooks/useCompany';
import './AppLayout.css';

export type ViewKey = 'dashboard' | 'purchases' | 'sales' | 'expenses' | 'catalogs' | 'lots' | 'inventory' | 'reports' | 'checks' | 'company' | 'users' | 'roles' | 'config';

export const VIEW_TITLES: Record<ViewKey, string> = {
  dashboard: 'Dashboard',
  purchases: 'Purchase Order',
  sales: 'Sales Desk',
  expenses: 'Additional expenses',
  catalogs: 'Catalogs',
  lots: 'Lot Activity',
  inventory: 'Inventory',
  reports: 'Reports',
  checks: 'Checkbook',
  company: 'Company Info',
  users: 'System Users',
  roles: 'Roles & Permissions',
  config: 'Configurator',
};

const NAV_ITEMS: Array<{ key: ViewKey; label: string; icon: ReactNode }> = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    key: 'purchases',
    label: 'Purchase Orders',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" /><path d="M3 7l9 4 9-4M12 11v10" />
      </svg>
    ),
  },
  {
    key: 'sales',
    label: 'Sales Desk',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M20 12l-8 8-9-9V4h7l10 8z" /><circle cx="7.5" cy="7.5" r="1.4" />
      </svg>
    ),
  },
  {
    key: 'expenses',
    label: 'Expenses',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" /><path d="M9 7h6M9 11h6" />
      </svg>
    ),
  },
  {
    key: 'catalogs',
    label: 'Catalogs',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" />
      </svg>
    ),
  },
  {
    key: 'lots',
    label: 'Lot Activity',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" /><path d="M3.3 8.3L12 13l8.7-4.7" /><path d="M12 13v9" />
      </svg>
    ),
  },
  {
    key: 'inventory',
    label: 'Inventory',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="12" width="8" height="8" rx="1" /><rect x="13" y="12" width="8" height="8" rx="1" />
        <rect x="8" y="3" width="8" height="8" rx="1" /><path d="M12 5.5v1.5M7 14.5V16M17 14.5V16" />
      </svg>
    ),
  },
  {
    key: 'reports',
    label: 'Reports',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" />
      </svg>
    ),
  },
  {
    key: 'checks',
    label: 'Checkbook',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h6M6 13h4M15 13.5h3.5" />
      </svg>
    ),
  },
  {
    key: 'company',
    label: 'Company Info',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 21h18M5 21V7l7-4 7 4v14" /><path d="M9 9h1.5M13.5 9H15M9 13h1.5M13.5 13H15M9 17h1.5M13.5 17H15" />
      </svg>
    ),
  },
  {
    key: 'users',
    label: 'System Users',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5" />
        <circle cx="17" cy="9" r="2.4" /><path d="M15.5 14.6c2.4.2 4.4 1.6 5 5" />
      </svg>
    ),
  },
  {
    key: 'roles',
    label: 'Roles',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3l7 3v5c0 4.4-2.9 8.2-7 10-4.1-1.8-7-5.6-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    key: 'config',
    label: 'Configurator',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
      </svg>
    ),
  },
];

/** Sub-items del menu de Reports: navegan directo a la pestana del reporte. */
const REPORT_SUBITEMS: Array<{ id: string; label: string }> = [
  { id: 'ar', label: 'Accounts Receivable' },
  { id: 'ap', label: 'Accounts Payable' },
];

interface AppLayoutProps {
  view: ViewKey;
  /** Sub-vista activa (ej. pestana de Reports) o null. */
  subview?: string | null;
  onNavigate: (view: ViewKey, subview?: string) => void;
  children: ReactNode;
}

export function AppLayout({ view, subview = null, onNavigate, children }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { can, profile, firebaseUser, bypass, logout, viewAsProfile, setViewAs } = useAuth();

  const { sortNav, navLabel, navParentOf } = useAppConfig();
  const { company } = useCompany();
  const visibleItems = sortNav(NAV_ITEMS.filter((item) => can(item.key, 'view')));

  /* Submenus configurables: hijos agrupados bajo su padre visible; huerfanos van al nivel raiz. */
  const visibleKeys = new Set(visibleItems.map((i) => i.key));
  const parentOf = (key: string): string | null => {
    const parent = navParentOf(key);
    return parent && parent !== key && visibleKeys.has(parent as ViewKey) ? parent : null;
  };
  const topItems = visibleItems.filter((item) => !parentOf(item.key));
  const childrenOf = (key: string) => visibleItems.filter((item) => parentOf(item.key) === key);

  const displayName = profile
    ? `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || profile.email
    : firebaseUser?.email ?? (bypass ? 'Dev bypass' : '');
  const initials = displayName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'U';

  /** Grupos del menu expandidos (todos contraidos al recargar). */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleNavigate = (key: ViewKey, sub?: string) => {
    onNavigate(key, sub);
    setMobileOpen(false);
  };

  return (
    <>
      {viewAsProfile && (
        <div className="layout__viewas-banner">
          <span>
            Viewing as <strong>{`${viewAsProfile.firstName ?? ''} ${viewAsProfile.lastName ?? ''}`.trim() || viewAsProfile.email}</strong> — you see exactly what they see
          </span>
          <button type="button" className="layout__viewas-exit" onClick={() => setViewAs(null)}>Exit view</button>
        </div>
      )}
    <div className={`layout${collapsed ? ' layout--collapsed' : ''}`}>
      <aside className={`sidebar${mobileOpen ? ' sidebar--open' : ''}`}>
        <div className="sidebar__brand">
          {company.logo ? (
            <span className="sidebar__logo sidebar__logo--img" aria-hidden="true">
              <img className="sidebar__logo-img" src={company.logo} alt="" />
            </span>
          ) : (
            <span className="sidebar__logo" aria-hidden="true">{(company.name || 'B').charAt(0)}</span>
          )}
          <span className="sidebar__brand-text">
            <strong>{company.name || 'Berry Source'}</strong>
            <small>Operations</small>
          </span>
        </div>

        <nav className="sidebar__nav" aria-label="Main navigation">
          {topItems.map((item) => {
            const children = childrenOf(item.key);
            const hasSub = children.length > 0 || item.key === 'reports';
            const isOpen = !!openGroups[item.key];
            return (
              <Fragment key={item.key}>
                <div className={hasSub ? 'sidebar__linkrow' : undefined}>
                  <button
                    type="button"
                    className={`sidebar__link${hasSub ? ' sidebar__link--grow' : ''}${view === item.key && !subview ? ' sidebar__link--active' : ''}`}
                    onClick={() => handleNavigate(item.key)}
                    title={navLabel(item.key, item.label)}
                  >
                    <span className="sidebar__icon">{item.icon}</span>
                    <span className="sidebar__label">{navLabel(item.key, item.label)}</span>
                  </button>
                  {hasSub && (
                    <button
                      type="button"
                      className={`sidebar__chevron${isOpen ? ' sidebar__chevron--open' : ''}`}
                      onClick={() => toggleGroup(item.key)}
                      aria-label={isOpen ? 'Collapse submenu' : 'Expand submenu'}
                      aria-expanded={isOpen}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  )}
                </div>
                {hasSub && isOpen && (
                  <div className="sidebar__subnav">
                    {children.map((child) => (
                      <button
                        key={child.key}
                        type="button"
                        className={`sidebar__sublink${view === child.key ? ' sidebar__sublink--active' : ''}`}
                        onClick={() => handleNavigate(child.key)}
                        title={navLabel(child.key, child.label)}
                      >
                        <span className="sidebar__subdot" aria-hidden="true" />
                        <span className="sidebar__label">{navLabel(child.key, child.label)}</span>
                      </button>
                    ))}
                    {item.key === 'reports' &&
                      REPORT_SUBITEMS.map((sub) => (
                        <button
                          key={sub.id}
                          type="button"
                          className={`sidebar__sublink${view === 'reports' && subview === sub.id ? ' sidebar__sublink--active' : ''}`}
                          onClick={() => handleNavigate('reports', sub.id)}
                          title={sub.label}
                        >
                          <span className="sidebar__subdot" aria-hidden="true" />
                          <span className="sidebar__label">{sub.label}</span>
                        </button>
                      ))}
                  </div>
                )}
              </Fragment>
            );
          })}

          <div className="sidebar__version">
            <span className="sidebar__version-number">{APP_VERSION}</span>
            <span className="sidebar__version-author">{APP_AUTHOR}</span>
          </div>
        </nav>

        <button
          type="button"
          className="sidebar__collapse"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          <span className="sidebar__label">Collapse</span>
        </button>
      </aside>

      {mobileOpen && <div className="layout__overlay" onClick={() => setMobileOpen(false)} />}

      <div className="layout__main">
        <header className="topbar">
          <button
            type="button"
            className="btn btn--icon topbar__hamburger"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="topbar__title">{navLabel(view, VIEW_TITLES[view])}</h1>
          <div className="topbar__user">
            <span className="topbar__avatar">{initials}</span>
            <span className="topbar__user-name">{displayName}</span>
            <button
              type="button"
              className="btn btn--icon topbar__logout"
              onClick={() => void logout()}
              title="Sign out"
              aria-label="Sign out"
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
    </>
  );
}
