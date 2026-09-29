import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useCollection } from '../../hooks/useCollection';
import { COLLECTIONS } from '../../config/collections';
import {
  saveModuleNotifyConfig,
  subscribeModuleNotifyConfig,
  type ModuleNotifyConfig,
} from '../../services/emailNotifications';
import './EmailRecipientsModal.css';

interface EmailRecipientsModalProps {
  moduleId: string;
  moduleTitle: string;
  byUid: string | null;
  onClose: () => void;
}

/**
 * "Email on save" (solo admin): elige QUÉ usuarios reciben un correo cuando
 * se guarda un formulario de este módulo. Sin usuarios marcados, guardar no
 * envía nada — el aviso nunca es automático a ciegas. Los destinatarios los
 * aplica el servidor leyendo esta misma configuración.
 */
export function EmailRecipientsModal({
  moduleId,
  moduleTitle,
  byUid,
  onClose,
}: EmailRecipientsModalProps) {
  const { rows: users } = useCollection(COLLECTIONS.users);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [onCreate, setOnCreate] = useState(true);
  const [onEdit, setOnEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    return subscribeModuleNotifyConfig(moduleId, (config: ModuleNotifyConfig | null) => {
      if (config) {
        setSelected(new Set(config.userIds));
        setOnCreate(config.onCreate);
        setOnEdit(config.onEdit);
      }
      setLoaded(true);
    });
  }, [moduleId]);

  const sorted = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...users]
      .map((user) => ({
        id: user.id,
        name: typeof user.name === 'string' && user.name !== '' ? user.name : '(sin nombre)',
        email: typeof user.email === 'string' ? user.email : '',
      }))
      .filter(
        (user) =>
          needle === '' ||
          user.name.toLowerCase().includes(needle) ||
          user.email.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveModuleNotifyConfig(
        moduleId,
        { userIds: [...selected], onCreate, onEdit },
        byUid,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? `No se pudo guardar: ${err.message}` : 'Save error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Email on save · ${moduleTitle}`}
      onClose={onClose}
      size="sm"
      layer="top"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={busy || !loaded}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="mailrec">
        {error ? <p className="mailrec-error">{error}</p> : null}
        <p className="mailrec-hint">
          The selected users get an email when a form of this module is saved. With nobody
          selected, saving sends <strong>nothing</strong>.
        </p>
        <label className="mailrec-toggle">
          <input type="checkbox" checked={onCreate} onChange={() => setOnCreate((v) => !v)} />
          Send when a record is <strong>created</strong>
        </label>
        <label className="mailrec-toggle">
          <input type="checkbox" checked={onEdit} onChange={() => setOnEdit((v) => !v)} />
          Also when a record is <strong>edited</strong>
        </label>
        <input
          className="mailrec-search"
          type="text"
          placeholder="Search user…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul className="mailrec-list">
          {sorted.map((user) => (
            <li key={user.id}>
              <label className={user.email === '' ? 'is-disabled' : ''}>
                <input
                  type="checkbox"
                  checked={selected.has(user.id)}
                  disabled={user.email === ''}
                  onChange={() => toggle(user.id)}
                />
                <span className="mailrec-name">{user.name}</span>
                <span className="mailrec-email">{user.email === '' ? 'no email' : user.email}</span>
              </label>
            </li>
          ))}
          {sorted.length === 0 ? <li className="mailrec-empty">No users found</li> : null}
        </ul>
        <p className="mailrec-count">
          {selected.size} recipient{selected.size === 1 ? '' : 's'} selected
        </p>
      </div>
    </Modal>
  );
}
