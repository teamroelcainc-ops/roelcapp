import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CRUD_MODULES } from '../../config/modules';
import { useUiConfig } from '../../hooks/useUiConfig';
import './AppLayout.css';

const STATIC_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/uniform-inventory': 'Uniform inventory',
  '/catalogs': 'Catalogs',
  '/users': 'Users',
  '/roles': 'Roles',
};

const COLLAPSED_KEY = 'se-sidebar-collapsed';

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  /** Menú contraído en escritorio (se recuerda entre sesiones). */
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === 'true',
  );

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);
  const location = useLocation();
  const { moduleTitle } = useUiConfig();

  const resolveTitle = (pathname: string): string => {
    if (STATIC_TITLES[pathname]) return STATIC_TITLES[pathname];
    const module = CRUD_MODULES.find((m) => pathname === `/${m.id}`);
    return module ? moduleTitle(module.id, module.title) : 'ServiExpress';
  };

  return (
    <div className={`layout ${collapsed ? 'is-collapsed' : ''}`}>
      <Sidebar
        open={menuOpen}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        onClose={() => setMenuOpen(false)}
      />
      <div className="layout-main">
        <Topbar title={resolveTitle(location.pathname)} onMenu={() => setMenuOpen(true)} />
        <main className="layout-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}