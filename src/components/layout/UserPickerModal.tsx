import { useMemo, useState } from 'react';
import { Check, Search, UserRound } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useCollection } from '../../hooks/useCollection';
import { COLLECTIONS } from '../../config/collections';
import type { EntityData } from '../../types/models';
import './UserPickerModal.css';

interface UserPickerModalProps {
  /** Usuario ya elegido (se marca en la lista). */
  selectedId: string;
  onPick: (user: EntityData) => void;
  onClose: () => void;
}

/** Texto legible de un valor del documento (los catálogos llegan como id). */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Lista completa de usuarios con buscador, para elegir uno sin pelear con un
 * desplegable: se ve el nombre, el correo, su rol y sus estaciones.
 */
export function UserPickerModal({ selectedId, onPick, onClose }: UserPickerModalProps) {
  const users = useCollection(COLLECTIONS.users);
  const roles = useCollection(COLLECTIONS.roles);
  const stations = useCollection(COLLECTIONS.stations);
  const [term, setTerm] = useState('');

  const roleName = useMemo(() => {
    const map = new Map<string, string>();
    roles.rows.forEach((row) => map.set(row.id, text(row.name)));
    return map;
  }, [roles.rows]);

  const stationName = useMemo(() => {
    const map = new Map<string, string>();
    stations.rows.forEach((row) => map.set(row.id, text(row.name)));
    return map;
  }, [stations.rows]);

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return users.rows
      .map((row) => {
        const ids = Array.isArray(row.scopeStations) ? row.scopeStations : [];
        return {
          row,
          name: text(row.name),
          email: text(row.email),
          role: roleName.get(text(row.roleId)) ?? '—',
          stations: ids.map((id) => stationName.get(id) ?? id),
          office: row.isOffice === true,
        };
      })
      .filter((item) =>
        needle === ''
          ? true
          : `${item.name} ${item.email} ${item.role} ${item.stations.join(' ')}`
              .toLowerCase()
              .includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users.rows, roleName, stationName, term]);

  return (
    <Modal
      open
      title="Choose a user"
      onClose={onClose}
      size="lg"
      layer="top"
      footer={
        <button type="button" className="btn btn-outline" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <div className="upick">
        <label className="upick-search">
          <Search size={15} />
          <input
            autoFocus
            value={term}
            placeholder="Search by name, email, role or station…"
            onChange={(event) => setTerm(event.target.value)}
          />
        </label>
        <p className="upick-count">
          {rows.length} {rows.length === 1 ? 'user' : 'users'}
          {users.loading ? ' · loading…' : ''}
        </p>
        <div className="upick-list">
          {rows.map((item) => (
            <button
              key={item.row.id}
              type="button"
              className={`upick-row ${item.row.id === selectedId ? 'is-selected' : ''}`}
              onClick={() => onPick(item.row)}
            >
              <span className="upick-avatar">
                <UserRound size={16} />
              </span>
              <span className="upick-main">
                <span className="upick-name">{item.name === '' ? '(no name)' : item.name}</span>
                <span className="upick-email">{item.email}</span>
              </span>
              <span className="upick-meta">
                <span className="upick-role">{item.role}</span>
                <span className="upick-stations">
                  {item.office
                    ? 'Office · all stations'
                    : item.stations.length === 0
                      ? 'No station assigned'
                      : item.stations.join(', ')}
                </span>
              </span>
              {item.row.id === selectedId ? (
                <Check size={16} className="upick-check" />
              ) : null}
            </button>
          ))}
          {rows.length === 0 && !users.loading ? (
            <p className="upick-empty">No user matches “{term}”.</p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
