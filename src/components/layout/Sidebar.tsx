import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronsLeft,
  ChevronsRight,
  Building2,
  Check,
  ClipboardCheck,
  FileCheck2,
  ClipboardList,
  FolderCog,
  KeySquare,
  LayoutDashboard,
  Pencil,
  Route,
  ScanLine,
  ShieldCheck,
  Shirt,
  Truck,
  UserCog,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useUiConfig } from '../../hooks/useUiConfig';
import { CRUD_MODULES } from '../../config/modules';
import { BrandLogo } from '../ui/BrandLogo';
import { useCompanyProfile } from '../../hooks/useCompanyProfile';
import { APP_VERSION } from '../../config/version';
import './Sidebar.css';

const ICONS: Record<string, LucideIcon> = {
  FileCheck2,
  AlertTriangle,
  Truck,
  Users,
  ScanLine,
  Route,
  Wrench,
  ClipboardCheck,
  KeySquare,
  ClipboardList,
  Building2,
};

interface SidebarProps {
  open: boolean;
  /** Menú contraído en escritorio: solo iconos. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onClose: () => void;
}

export function Sidebar({ open, collapsed = false, onToggleCollapse, onClose }: SidebarProps) {
  const company = useCompanyProfile();
  const { can, isAdminView } = useAuth();
  const { editMode, moduleTitle, sortModules, saveModuleOverride, saveMenuOrder } = useUiConfig();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const orderedModules = useMemo(() => sortModules(CRUD_MODULES), [sortModules]);
  const visibleModules = orderedModules.filter((m) => can(m.id, 'ver'));
  const editing = editMode && isAdminView;

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `sidebar-link ${isActive ? 'is-active' : ''}`;

  const moveModule = (moduleId: string, delta: number) => {
    const ids = orderedModules.map((m) => m.id);
    const index = ids.indexOf(moduleId);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void saveMenuOrder(ids);
  };

  const startRename = (moduleId: string, currentTitle: string) => {
    setRenaming(moduleId);
    setRenameValue(currentTitle);
  };

  const confirmRename = () => {
    if (renaming && renameValue.trim() !== '') {
      void saveModuleOverride(renaming, { title: renameValue.trim() });
    }
    setRenaming(null);
  };

  return (
    <>
      {open ? <div className="sidebar-backdrop" onClick={onClose} /> : null}
      <aside className={`sidebar ${open ? 'is-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="sidebar-brand">
          <BrandLogo size={34} />
          <div>
            <strong>{company.name}</strong>
            <span>{company.tagline}</span>
          </div>
          <button type="button" className="icon-btn sidebar-close" onClick={onClose} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav" onClick={editing ? undefined : onClose}>
          {can('dashboard', 'ver') ? (
            <NavLink to="/" end className={linkClass} title="Dashboard">
              <LayoutDashboard size={17} />
              <span className="sidebar-link-text">Dashboard</span>
            </NavLink>
          ) : null}

          {visibleModules.map((module) => {
            const Icon = ICONS[module.icon] ?? Truck;
            const title = moduleTitle(module.id, module.title);
            if (editing && renaming === module.id) {
              return (
                <div key={module.id} className="sidebar-link sidebar-edit-row">
                  <Icon size={17} />
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
                    autoFocus
                  />
                  <button type="button" className="sidebar-mini-btn" onClick={confirmRename} aria-label="Save name">
                    <Check size={13} />
                  </button>
                </div>
              );
            }
            return (
              <div key={module.id} className={editing ? 'sidebar-edit-wrap' : undefined}>
                <NavLink to={`/${module.id}`} className={linkClass} title={title}>
                  <Icon size={17} />
                  <span className="sidebar-link-text">{title}</span>
                  {editing ? (
                    <span className="sidebar-edit-actions" onClick={(e) => e.preventDefault()}>
                      <button
                        type="button"
                        className="sidebar-mini-btn"
                        onClick={() => startRename(module.id, title)}
                        aria-label="Rename"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        className="sidebar-mini-btn"
                        onClick={() => moveModule(module.id, -1)}
                        aria-label="Move up"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        className="sidebar-mini-btn"
                        onClick={() => moveModule(module.id, 1)}
                        aria-label="Move down"
                      >
                        <ArrowDown size={12} />
                      </button>
                    </span>
                  ) : null}
                </NavLink>
              </div>
            );
          })}

          {can('uniformInventory', 'ver') ? (
            <NavLink to="/uniform-inventory" className={linkClass} title="Uniform inventory">
              <Shirt size={17} />
              <span className="sidebar-link-text">Uniform inventory</span>
            </NavLink>
          ) : null}

          {can('catalogs', 'ver') ? (
            <NavLink to="/catalogs" className={linkClass} title="Catalogs">
              <FolderCog size={17} />
              <span className="sidebar-link-text">Catalogs</span>
            </NavLink>
          ) : null}

          <div className="sidebar-section">Administration</div>

          {can('users', 'ver') ? (
            <NavLink to="/users" className={linkClass} title="Users">
              <UserCog size={17} />
              <span className="sidebar-link-text">Users</span>
            </NavLink>
          ) : null}
          {can('roles', 'ver') ? (
            <NavLink to="/roles" className={linkClass} title="Roles">
              <ShieldCheck size={17} />
              <span className="sidebar-link-text">Roles</span>
            </NavLink>
          ) : null}
          {can('company', 'ver') ? (
            <NavLink to="/company" className={linkClass} title="Company (logo and name)">
              <Building2 size={17} />
              <span className="sidebar-link-text">Company</span>
            </NavLink>
          ) : null}
        </nav>

        {/* Firma y versión: siempre al final del menú, también plegado. */}
        <div className="sidebar-about">
          <span className="sidebar-version">{APP_VERSION}</span>
          <span className="sidebar-author sidebar-link-text">Created by Jesús Molero</span>
        </div>

        {onToggleCollapse ? (
          <footer className="sidebar-foot">
            <button
              type="button"
              className="sidebar-collapse"
              onClick={onToggleCollapse}
              title={collapsed ? 'Expand menu' : 'Collapse menu'}
              aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            >
              {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
              <span className="sidebar-link-text">Collapse menu</span>
            </button>
          </footer>
        ) : null}
      </aside>
    </>
  );
}