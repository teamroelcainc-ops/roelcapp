import { useEffect, useState } from 'react';
import { Eye, EyeOff, LogOut, Menu, Moon, Pencil, Sun } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useUiConfig } from '../../hooks/useUiConfig';
import { ViewAsModal } from './ViewAsModal';
import { UpdateNotice } from './UpdateNotice';
import './Topbar.css';

interface TopbarProps {
  title: string;
  onMenu: () => void;
}

const THEME_KEY = 'se-theme';

export function Topbar({ title, onMenu }: TopbarProps) {
  const { profile, role, logout, isAdminView, viewAs, stopViewAs, can } = useAuth();
  /**
   * "View as" y el modo Edit se controlan desde Roles (además del admin, que
   * siempre los tiene). Basta con conceder la acción en CUALQUIER módulo.
   */
  // Durante "View as" se evalúa el rol SIMULADO (isAdminView es false), así
  // que la vista es total: si esa persona no tiene el botón, tú tampoco.
  /**
   * Respaldo para no depender de configurar Roles: además del permiso
   * propio, vale poder EDITAR usuarios (quien administra usuarios puede
   * simularlos) y, para el modo Edit, poder personalizar. Para quitárselo a
   * un rol, apaga esas casillas o usa la columna "View as".
   */
  const canViewAs =
    isAdminView || can('users', 'verComo') || can('users', 'editar');
  const canCustomizeMenu =
    isAdminView || can('customize', 'personalizarMenu') || can('customize', 'editar');
  const { editMode, setEditMode } = useUiConfig();
  const [viewAsOpen, setViewAsOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return (
    <>
      {viewAs ? (
        <div className="topbar-viewas">
          <Eye size={14} />
          <span>
            Viewing as <strong>{viewAs.name}</strong> ({viewAs.email})
          </span>
          <button type="button" onClick={stopViewAs}>
            <EyeOff size={13} />
            Exit
          </button>
        </div>
      ) : null}
      <header className="topbar">
        <button type="button" className="icon-btn topbar-menu" onClick={onMenu} aria-label="Open menu">
          <Menu size={20} />
        </button>
        <h1 className="topbar-title">{title}</h1>
        <div className="topbar-user">
          {/* Aviso de versión nueva: lo ven todos los usuarios, no solo admin. */}
          <UpdateNotice />
          {canCustomizeMenu ? (
            <button
              type="button"
              className={`btn topbar-edit ${editMode ? 'is-on' : 'btn-outline'}`}
              title="Rename and reorder menu and tables"
              onClick={() => setEditMode(!editMode)}
            >
              <Pencil size={14} />
              {editMode ? 'Done' : 'Edit'}
            </button>
          ) : null}
          {canViewAs && !viewAs ? (
            <button
              type="button"
              className="icon-btn"
              title="View the app as another user"
              onClick={() => setViewAsOpen(true)}
            >
              <Eye size={17} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            title={theme === 'light' ? 'Dark mode' : 'Light mode'}
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <div className="topbar-avatar">{(profile?.name ?? '?').charAt(0).toUpperCase()}</div>
          <div className="topbar-user-info">
            <strong>{profile?.name ?? ''}</strong>
            <span>{role?.name ?? ''}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            title="Sign out"
            onClick={() => void logout()}
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>
      {viewAsOpen ? <ViewAsModal onClose={() => setViewAsOpen(false)} /> : null}
    </>
  );
}
