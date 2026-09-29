import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { FormField } from './FormField';
import { useRefMaps } from '../../hooks/useRefMaps';
import { ACTIVE_FLAG_BY_COLLECTION, isActiveRecord } from '../../services/activeStatus';
import { updateDocument } from '../../services/firestoreService';
import type { EntityData, FieldConfig, FieldValue } from '../../types/models';
import type { SelectOption } from './SearchableSelect';

interface QuickEditRefModalProps {
  /** Colección del catálogo del registro a editar (team). */
  collection: string;
  /** Título del catálogo, para el encabezado. */
  title: string;
  /** Campos del catálogo (name, email, phone…). */
  fields: FieldConfig[];
  /** Registro tal como está guardado. */
  record: EntityData;
  onSaved: () => void;
  onClose: () => void;
}

/**
 * Edición rápida del registro referenciado (el lápiz junto al selector):
 * corrige el nombre de la persona de Team —o sus datos— sin salir del
 * formulario del driver. Al guardar, el nombre nuevo se refleja solo en
 * todos los selectores y tablas (se resuelve en vivo desde el catálogo).
 */
export function QuickEditRefModal({
  collection,
  title,
  fields,
  record,
  onSaved,
  onClose,
}: QuickEditRefModalProps) {
  const formFields = useMemo(
    () =>
      fields.filter(
        (field) =>
          field.form !== false && field.readOnly !== true && field.compute === undefined,
      ),
    [fields],
  );
  const refMaps = useRefMaps(formFields);

  const [values, setValues] = useState<Record<string, FieldValue>>(() => {
    const base: Record<string, FieldValue> = {};
    formFields.forEach((field) => {
      const raw = record[field.key];
      base[field.key] = Array.isArray(raw) ? raw.join(', ') : (raw ?? (field.type === 'bool' ? false : null));
    });
    return base;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const refOptionsByField = useMemo(() => {
    const map: Record<string, SelectOption[]> = {};
    formFields.forEach((field) => {
      if (field.type !== 'ref' || !field.refCollection) return;
      const data = refMaps[field.refCollection];
      const flag = ACTIVE_FLAG_BY_COLLECTION[field.refCollection];
      const activeIds =
        data && flag !== undefined
          ? new Set(data.rows.filter((r) => isActiveRecord(r, flag)).map((r) => r.id))
          : null;
      map[field.key] = data
        ? [...data.labels.entries()]
            .filter(([value]) => activeIds === null || activeIds.has(value))
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label))
        : [];
    });
    return map;
  }, [formFields, refMaps]);

  const missing = formFields.filter(
    (field) =>
      field.required === true &&
      (values[field.key] === null || values[field.key] === '' || values[field.key] === undefined),
  );

  const handleSave = async () => {
    setTouched(true);
    if (missing.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, FieldValue> = {};
      formFields.forEach((field) => {
        payload[field.key] = values[field.key] ?? null;
      });
      await updateDocument(collection, record.id, payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The record could not be saved');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Edit ${title}`}
      onClose={onClose}
      size="sm"
      footer={
        <>
          {error ? <span className="crudform-error">{error}</span> : null}
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="crudform-grid">
        {formFields.map((field) => (
          <FormField
            key={field.key}
            field={field}
            value={values[field.key] ?? null}
            invalid={touched && missing.some((m) => m.key === field.key)}
            refOptions={refOptionsByField[field.key] ?? []}
            onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
          />
        ))}
      </div>
    </Modal>
  );
}
