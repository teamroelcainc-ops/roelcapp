import { useMemo, useState } from 'react';
import { parsePermissionOverrides } from '../../services/permissionOverrides';
import { Eye } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { SearchableSelect } from '../ui/SearchableSelect';
import { useCollection } from '../../hooks/useCollection';
import { useAuth } from '../../hooks/useAuth';
import { COLLECTIONS } from '../../config/collections';
import type { UserProfile } from '../../types/models';
import './ViewAsModal.css';

interface ViewAsModalProps {
  onClose: () => void;
}

/**
 * Admin tool: pick any user by name/email and see the app exactly
 * with that user's role and permissions (read-only simulation).
 */
export function ViewAsModal({ onClose }: ViewAsModalProps) {
  const { startViewAs } = useAuth();
  const users = useCollection(COLLECTIONS.users);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);

  const options = useMemo(
    () =>
      users.rows
        .map((u) => ({
          value: u.id,
          label: `${String(u.name ?? '')} · ${String(u.email ?? '')}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [users.rows],
  );

  const handleStart = async () => {
    const row = users.rows.find((u) => u.id === selectedId);
    if (!row) return;
    setBusy(true);
    const profile: UserProfile = {
      id: row.id,
      name: String(row.name ?? ''),
      email: String(row.email ?? ''),
      roleId: String(row.roleId ?? ''),
      status: String(row.status ?? ''),
      scopeEntities: Array.isArray(row.scopeEntities)
        ? (row.scopeEntities as unknown[]).filter((v): v is string => typeof v === 'string')
        : [],
      scopeStations: Array.isArray(row.scopeStations)
        ? (row.scopeStations as unknown[]).filter((v): v is string => typeof v === 'string')
        : [],
      isOffice: row.isOffice === true,
      // Sin esto, los ACCESOS EXTRA de la persona no se aplicaban al
      // simularla y su vista salía más pobre que la real.
      permissionOverrides: parsePermissionOverrides(row.permissionOverrides),
    };
    await startViewAs(profile);
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      open
      title="View as user"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleStart()}
            disabled={busy || selectedId === ''}
          >
            <Eye size={15} />
            {busy ? 'Loading…' : 'View as this user'}
          </button>
        </>
      }
    >
      <div className="viewas">
        <p className="viewas-hint">
          Pick a user to see the app with their role and permissions. This only changes what YOU
          see — it does not affect the user.
        </p>
        <SearchableSelect
          value={selectedId}
          options={options}
          placeholder="Search by name or email…"
          onChange={setSelectedId}
        />
      </div>
    </Modal>
  );
}