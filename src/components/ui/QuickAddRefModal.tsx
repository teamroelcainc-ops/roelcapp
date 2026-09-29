import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { FormField } from './FormField';
import { useRefMaps } from '../../hooks/useRefMaps';
import { ACTIVE_FLAG_BY_COLLECTION, isActiveRecord } from '../../services/activeStatus';
import { catalogModules } from '../../config/modules';
import { createDocument } from '../../services/firestoreService';
import type { FieldConfig, FieldValue } from '../../types/models';
import type { SelectOption } from './SearchableSelect';

interface QuickAddRefModalProps {
  /** Colección del catálogo donde se dará de alta el registro. */
  collection: string;
  /** Título del catálogo, para el encabezado del diálogo. */
  title: string;
  /** Campos del catálogo (normalmente solo Name). */
  fields: FieldConfig[];
  /** Texto ya escrito en el buscador, para no volver a teclearlo. */
  initialName?: string;
  /** Uid del usuario actual, para sellar quién dio de alta el registro. */
  currentUid?: string | null;
  /** Campo donde se guarda el capturista (autoUserField del módulo destino). */
  autoUserField?: string;
  /** Devuelve el id recién creado para seleccionarlo en el campo de origen. */
  onCreated: (id: string) => void;
  onClose: () => void;
}

/**
 * Alta rápida de un registro de catálogo desde cualquier formulario: evita
 * salir a Catálogos, crearlo y volver a empezar la captura.
 */
export function QuickAddRefModal({
  collection,
  title,
  fields,
  initialName = '',
  currentUid,
  autoUserField,
  onCreated,
  onClose,
}: QuickAddRefModalProps) {
  /**
   * Solo se piden los campos indispensables: los obligatorios y el nombre. Un
   * alta rápida que pidiera las 20 columnas de Drivers no sería rápida; el
   * resto se completa después desde su propio módulo.
   */
  const formFields = useMemo(
    () =>
      fields.filter(
        (field) =>
          field.form !== false &&
          field.readOnly !== true &&
          field.compute === undefined &&
          (field.required === true || field.key === 'name'),
      ),
    [fields],
  );

  /**
   * Referencia marcada para capturarse en línea: en vez de pedir que se elija
   * un registro ya existente, se piden los datos de ese catálogo y se crean
   * los dos registros de una vez (Team + Driver).
   */
  const inline = useMemo(() => {
    const field = formFields.find((f) => f.quickAddInline && f.refCollection);
    if (!field) return null;
    const catalog = catalogModules.find((m) => m.collection === field.refCollection);
    if (!catalog) return null;
    return {
      field,
      catalog,
      fields: catalog.fields.filter((f) => f.form !== false && f.compute === undefined),
    };
  }, [formFields]);

  /** Lo que realmente se dibuja: la referencia en línea sustituida por sus campos. */
  const renderedFields = useMemo(() => {
    if (!inline) return formFields;
    return formFields.flatMap((f) => (f.key === inline.field.key ? inline.fields : [f]));
  }, [formFields, inline]);

  // El alta puede tener sus propias referencias (un driver apunta a Team).
  const refMaps = useRefMaps(formFields);
  const refOptions = (field: FieldConfig): SelectOption[] => {
    if (field.type !== 'ref' || !field.refCollection) return [];
    const data = refMaps[field.refCollection];
    if (!data) return [];
    const flag = field.refCollection ? ACTIVE_FLAG_BY_COLLECTION[field.refCollection] : undefined;
    const activeIds =
      flag === undefined
        ? null
        : new Set(data.rows.filter((r) => isActiveRecord(r, flag)).map((r) => r.id));
    return [...data.labels.entries()]
      .filter(([value]) => activeIds === null || activeIds.has(value))
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };

  const [values, setValues] = useState<Record<string, FieldValue>>(() => {
    const initial: Record<string, FieldValue> = {};
    renderedFields.forEach((field) => {
      initial[field.key] =
        field.key === 'name' && initialName !== ''
          ? initialName
          : field.type === 'number' || field.type === 'currency'
            ? null
            : '';
    });
    return initial;
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = renderedFields
    .filter((field) => field.required && (values[field.key] ?? '') === '')
    .map((field) => field.key);

  const handleSave = async () => {
    setTouched(true);
    if (missing.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, FieldValue> = { ...values };

      if (inline) {
        // 1) Se crea el registro del catálogo (la persona en Team) con sus
        //    propios campos, que se sacan del payload del registro principal.
        const catalogValues: Record<string, FieldValue> = {};
        inline.fields.forEach((field) => {
          catalogValues[field.key] = values[field.key] ?? '';
          delete payload[field.key];
        });
        const catalogId = await createDocument(inline.catalog.collection, catalogValues);
        // 2) El registro principal (el conductor) apunta al recién creado.
        payload[inline.field.key] = catalogId;
        if (inline.field.copyLabelTo) {
          payload[inline.field.copyLabelTo] = catalogValues.name ?? '';
        }
      }

      // El nombre resuelto se copia igual que en el alta normal, para que el
      // resto del sistema siga mostrando texto y no ids.
      formFields.forEach((field) => {
        if (inline && field.key === inline.field.key) return;
        if (!field.copyLabelTo || !field.refCollection) return;
        const chosen = values[field.key];
        if (typeof chosen !== 'string' || chosen === '') return;
        payload[field.copyLabelTo] = refMaps[field.refCollection]?.labels.get(chosen) ?? chosen;
      });
      if (autoUserField && currentUid) payload[autoUserField] = currentUid;
      const id = await createDocument(collection, payload);
      onCreated(id);
    } catch {
      setError('The record could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      layer="top"
      title={`New · ${title}`}
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
            onClick={() => void handleSave()}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="crudform-grid">
        {renderedFields.map((field) => (
          <FormField
            key={field.key}
            field={field}
            value={values[field.key] ?? null}
            invalid={touched && missing.includes(field.key)}
            refOptions={refOptions(field)}
            onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
          />
        ))}
      </div>
      {error ? <p className="crud-error">{error}</p> : null}
    </Modal>
  );
}
