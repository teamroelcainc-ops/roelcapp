import { useMemo, useState } from 'react';
import { byNewest } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { createDocument, deleteDocument, updateDocument } from '../../services/firestore';
import type { BaseDoc } from '../../types/models';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Toolbar } from '../../components/ui/Toolbar';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { DataPortButtons } from '../../components/ui/DataPortButtons';
import type { EntitySchema } from '../../config/entitySchemas';
import { CATALOG_DEFS, type CatalogDef } from './catalogConfig';
import './CatalogsView.css';

type CatalogDoc = BaseDoc & Record<string, unknown>;

export function CatalogsView() {
  const { can } = useAuth();
  const [def, setDef] = useState<CatalogDef>(CATALOG_DEFS[0]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CatalogDoc | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const { data, loading } = useCollection<CatalogDoc>(def.collection);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const sorted = [...data].sort(byNewest);
    if (!term) return sorted;
    return sorted.filter((row) =>
      [def.nameField, ...def.extraFields.map((f) => f.key)].some((key) =>
        String(row[key] ?? '').toLowerCase().includes(term),
      ),
    );
  }, [data, search, def]);

  /** El catalogo activo se traduce a un esquema para el template y la importacion. */
  const schema = useMemo<EntitySchema>(
    () => ({
      collection: def.collection,
      label: def.label,
      idField: def.idField,
      fields: [
        { key: def.nameField, type: 'text', width: 30 },
        ...def.extraFields.map((field) => ({ key: field.key, type: 'text' as const, width: 26 })),
      ],
    }),
    [def],
  );

  const openCreate = () => {
    setEditing(null);
    setDraft({});
    setFormOpen(true);
  };

  const openEdit = (row: CatalogDoc) => {
    setEditing(row);
    const values: Record<string, string> = { [def.nameField]: String(row[def.nameField] ?? '') };
    for (const field of def.extraFields) values[field.key] = String(row[field.key] ?? '');
    setDraft(values);
    setFormOpen(true);
  };

  /**
   * Guardado local-first: el modal cierra de inmediato y la escritura corre en
   * segundo plano. La tabla se actualiza al instante via onSnapshot; si Firestore
   * rechaza la escritura se avisa con un alert.
   */
  const handleSave = () => {
    if (!draft[def.nameField]?.trim()) return;
    const missingFields = def.extraFields
      .filter((f) => f.required && !(draft[f.key] ?? '').trim())
      .map((f) => f.label);
    if (missingFields.length > 0) {
      alert(`Required fields missing: ${missingFields.join(', ')}`);
      return;
    }
    const payload: Record<string, string> = { [def.nameField]: draft[def.nameField].trim() };
    for (const field of def.extraFields) payload[field.key] = (draft[field.key] ?? '').trim();
    const target = editing;
    setFormOpen(false);
    const persist = target
      ? updateDocument(def.collection, target.id, payload)
      : createDocument<CatalogDoc>(def.collection, payload as Omit<CatalogDoc, 'id'>);
    persist.catch((error: unknown) =>
      alert(`Failed to save: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  const handleDelete = () => {
    if (!editing) return;
    if (!window.confirm(`Delete "${String(editing[def.nameField] ?? '')}"?`)) return;
    const target = editing;
    setFormOpen(false);
    deleteDocument(def.collection, target.id).catch((error: unknown) =>
      alert(`Failed to delete: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  const columns: Array<Column<CatalogDoc>> = [
    { key: def.nameField, header: def.nameLabel, render: (row) => String(row[def.nameField] ?? '') },
    ...def.extraFields.map<Column<CatalogDoc>>((field) => ({
      key: field.key,
      header: field.label,
      render: (row) => String(row[field.key] ?? '') || '—',
    })),
  ];

  /** Borrado directo desde la tabla (en segundo plano). */
  const handleDeleteRow = (row: CatalogDoc) => {
    if (!window.confirm(`Delete "${String(row[def.nameField] ?? '')}"?`)) return;
    deleteDocument(def.collection, row.id).catch((error: unknown) =>
      alert(`Failed to delete: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  return (
    <div className="catalogs">
      <nav className="catalogs__menu" aria-label="Catalogs">
        {CATALOG_DEFS.map((item) => (
          <button
            key={item.collection}
            type="button"
            className={`catalogs__menu-item${item.collection === def.collection ? ' catalogs__menu-item--active' : ''}`}
            onClick={() => {
              setDef(item);
              setSearch('');
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <section className="catalogs__panel">
        <Toolbar
          title={def.label}
          subtitle={`${rows.length} records · ${def.collection}`}
          searchValue={search}
          onSearchChange={setSearch}
        >
          {can('catalogs', 'documents') && (def.maxRecords === undefined || rows.length < def.maxRecords) && (
            <DataPortButtons schemas={[schema]} fileName={def.collection.toLowerCase()} />
          )}
          {can('catalogs', 'add') && (def.maxRecords === undefined || rows.length < def.maxRecords) && (
            <button type="button" className="btn btn--primary" onClick={openCreate}>+ Add</button>
          )}
          {def.maxRecords !== undefined && rows.length >= def.maxRecords && (
            <span className="catalogs__limit">Single-record catalog: edit the existing entry</span>
          )}
        </Toolbar>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          onRowClick={openEdit}
          onEdit={can('catalogs', 'edit') ? openEdit : undefined}
          onDelete={can('catalogs', 'delete') ? handleDeleteRow : undefined}
        />
      </section>

      <Modal
        title={editing ? `Edit ${def.label.toLowerCase()}` : `New ${def.label.toLowerCase()}`}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            {editing && can('catalogs', 'delete') && (
              <button type="button" className="btn btn--danger" onClick={handleDelete}>Delete</button>
            )}
            <button type="button" className="btn btn--secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            {(editing ? can('catalogs', 'edit') : can('catalogs', 'add')) && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={!draft[def.nameField]?.trim()}
                onClick={handleSave}
              >
                Save
              </button>
            )}
          </>
        }
      >
        <FormGrid>
          <FormField label={def.nameLabel} span2>
            <input
              className="input"
              value={draft[def.nameField] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [def.nameField]: e.target.value }))}
            />
          </FormField>
          {def.extraFields.map((field) => (
            <FormField key={field.key} label={field.label}>
              <input
                className="input"
                value={draft[field.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
              />
            </FormField>
          ))}
        </FormGrid>
      </Modal>
    </div>
  );
}
