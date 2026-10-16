import { useMemo, useState } from 'react';
import { parsePermissionOverrides } from '../../services/permissionOverrides';
import { Eye, Search, UserRound } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { UserPickerModal } from './UserPickerModal';
import { useCollection } from '../../hooks/useCollection';
import { useAuth } from '../../hooks/useAuth';
import { COLLECTIONS } from '../../config/collections';
import type { EntityData, UserProfile } from '../../types/models';
import './ViewAsModal.css';

interface ViewAsModalProps {
  onClose: () => void;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Herramienta del admin: elegir a cualquier usuario y ver el app EXACTAMENTE
 * como él — su rol, sus permisos, su alcance y sus accesos extra. Lo único
 * que no cambia es la autoría: lo que se guarde queda a nombre del admin.
 */
export function ViewAsModal({ onClose }: ViewAsModalProps) {
  const { startViewAs, profile } = useAuth();
  const roles = useCollection(COLLECTIONS.roles);
  const stations = useCollection(COLLECTIONS.stations);
  const [picked, setPicked] = useState<EntityData | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const roleName = useMemo(() => {
    const map = new Map<string, string>();
    roles.rows.forEach((row) => map.set(row.id, text(row.name)));
    return map;
  }, [roles.rows]);

  const stationLabels = useMemo(() => {
    if (!picked) return [];
    const map = new Map<string, string>();
    stations.rows.forEach((row) => map.set(row.id, text(row.name)));
    const ids = Array.isArray(picked.scopeStations) ? picked.scopeStations : [];
    return ids.map((id) => map.get(id) ?? id);
  }, [picked, stations.rows]);

  const handleStart = async () => {
    if (!picked) return;
    setBusy(true);
    const simulated: UserProfile = {
      id: picked.id,
      name: text(picked.name),
      email: text(picked.email),
      roleId: text(picked.roleId),
      status: text(picked.status),
      scopeEntities: Array.isArray(picked.scopeEntities) ? picked.scopeEntities : [],
      scopeStations: Array.isArray(picked.scopeStations) ? picked.scopeStations : [],
      isOffice: picked.isOffice === true,
      // Sin esto, los ACCESOS EXTRA de la persona no se aplicaban al
      // simularla y su vista salía más pobre que la real.
      permissionOverrides: parsePermissionOverrides(picked.permissionOverrides),
    };
    await startViewAs(simulated);
    setBusy(false);
    onClose();
  };

  return (
    <>
      <Modal
        open
        title="View as user"
        onClose={onClose}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleStart()}
              disabled={busy || picked === null}
            >
              <Eye size={15} />
              {busy ? 'Loading…' : 'View as this user'}
            </button>
          </>
        }
      >
        <div className="viewas">
          <p className="viewas-hint">
            You will see the app <strong>exactly as this user sees it</strong> — their role, their
            permissions, their stations and their extra access, as if you had logged in with their
            email. Nothing changes for them.
          </p>

          <button type="button" className="viewas-picker" onClick={() => setPickerOpen(true)}>
            {picked ? (
              <>
                <span className="viewas-avatar">
                  <UserRound size={20} />
                </span>
                <span className="viewas-who">
                  <span className="viewas-name">
                    {text(picked.name) === '' ? '(no name)' : text(picked.name)}
                  </span>
                  <span className="viewas-email">{text(picked.email)}</span>
                </span>
                <span className="viewas-change">Change</span>
              </>
            ) : (
              <>
                <span className="viewas-avatar">
                  <Search size={18} />
                </span>
                <span className="viewas-who">
                  <span className="viewas-name">Choose a user…</span>
                  <span className="viewas-email">Opens the full list, with a search box</span>
                </span>
              </>
            )}
          </button>

          {picked ? (
            <dl className="viewas-facts">
              <div>
                <dt>Role</dt>
                <dd>{roleName.get(text(picked.roleId)) ?? '—'}</dd>
              </div>
              <div>
                <dt>Stations</dt>
                <dd>
                  {picked.isOffice === true
                    ? 'Office · all stations'
                    : stationLabels.length === 0
                      ? 'No station assigned'
                      : stationLabels.join(', ')}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{text(picked.status) === '' ? '—' : text(picked.status)}</dd>
              </div>
            </dl>
          ) : null}

          <p className="viewas-note">
            Anything you save while viewing as them is recorded under{' '}
            <strong>your</strong> name ({text(profile?.name) || 'your account'}), not theirs.
          </p>
        </div>
      </Modal>

      {pickerOpen ? (
        <UserPickerModal
          selectedId={picked?.id ?? ''}
          onPick={(user) => {
            setPicked(user);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </>
  );
}
