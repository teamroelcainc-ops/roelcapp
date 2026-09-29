import { useMemo, useState } from 'react';
import { ListPlus, Trash2 } from 'lucide-react';
import { FormField } from '../ui/FormField';
import { Modal } from '../ui/Modal';
import { displayCell } from './displayValue';
import { useCollection } from '../../hooks/useCollection';
import { ACTIVE_FLAG_BY_COLLECTION, isActiveRecord } from '../../services/activeStatus';
import type { SelectOption } from '../ui/SearchableSelect';
import type { RefMaps } from '../../hooks/useRefMaps';
import type { DetailConfig, EntityData, FieldConfig, FieldValue } from '../../types/models';
import './DraftDetailRows.css';

export type DraftRow = Record<string, FieldValue>;

interface DraftDetailRowsProps {
  detail: DetailConfig;
  rows: DraftRow[];
  refMaps: RefMaps;
  refLabels: (collection: string, id: string) => string;
  /**
   * Opciones que hoy no se pueden elegir (clave del campo -> id -> motivo):
   * el camión que otro BC ya capturó en esta ventana, el que está en taller.
   */
  blockedRefs?: Record<string, Map<string, string>>;
  onChange: (rows: DraftRow[]) => void;
}

/**
 * Subtabla de renglones capturados ANTES de que exista el registro maestro.
 * Se usa en el alta: las filas viven en memoria y el módulo las guarda en
 * cuanto crea el maestro, para no obligar a guardar y volver a entrar.
 */
export function DraftDetailRows({
  detail,
  rows,
  refMaps,
  refLabels,
  blockedRefs,
  onChange,
}: DraftDetailRowsProps) {
  const fields = useMemo(
    () =>
      detail.fields.filter(
        (field) => field.form !== false && field.compute === undefined && !field.fixedOnCreate,
      ),
    [detail.fields],
  );

  const blank = useMemo(() => {
    const values: DraftRow = {};
    fields.forEach((field) => {
      values[field.key] =
        field.defaultValue !== undefined
          ? field.defaultValue
          : field.type === 'number' || field.type === 'currency'
            ? null
            : '';
    });
    return values;
  }, [fields]);

  const [draft, setDraft] = useState<DraftRow>(blank);
  const [error, setError] = useState<string | null>(null);

  // Existencia: entradas menos lo ya entregado, menos lo que va en esta captura.
  const control = detail.stockControl;
  const entries = useCollection(control?.entriesCollection ?? '');
  const exits = useCollection(control ? detail.collection : '');

  /**
   * Existencia por combinación de los campos que identifican el artículo
   * (prenda + talla): entradas menos lo ya entregado. Con esto solo se
   * ofrecen prendas y tallas que realmente hay en el almacén.
   */
  const stockByKey = useMemo(() => {
    if (!control) return null;
    const map = new Map<string, number>();
    const keyOf = (row: DraftRow) => control.matchKeys.map((k) => String(row[k] ?? '')).join('|');
    const add = (rows: EntityData[], sign: number) =>
      (rows as DraftRow[]).forEach((row) => {
        const value = row[control.quantityKey];
        const qty = typeof value === 'number' ? value : Number(value) || 0;
        map.set(keyOf(row), (map.get(keyOf(row)) ?? 0) + sign * qty);
      });
    add(entries.rows, 1);
    add(exits.rows, -1);
    // Lo que ya va en esta captura también reserva existencia.
    rows.forEach((row) => {
      const value = row[control.quantityKey];
      const qty = typeof value === 'number' ? value : Number(value) || 0;
      map.set(keyOf(row), (map.get(keyOf(row)) ?? 0) - qty);
    });
    return map;
  }, [control, entries.rows, exits.rows, rows]);

  /** Ids (del primer campo clave) que tienen existencia en alguna talla. */
  const itemsWithStock = useMemo(() => {
    if (!control || !stockByKey) return null;
    const set = new Set<string>();
    stockByKey.forEach((qty, key) => {
      if (qty > 0) set.add(key.split('|')[0]);
    });
    return set;
  }, [control, stockByKey]);

  /** Existencia de la combinación que se está capturando ahora mismo. */
  const available = useMemo(() => {
    if (!control || !stockByKey) return null;
    const ready = control.matchKeys.every((key) => {
      const value = draft[key];
      return typeof value === 'string' && value !== '';
    });
    if (!ready) return null;
    return stockByKey.get(control.matchKeys.map((k) => String(draft[k] ?? '')).join('|')) ?? 0;
  }, [control, stockByKey, draft]);

  const refOptions = (field: FieldConfig): SelectOption[] => {
    if (field.type !== 'ref' || !field.refCollection) return [];
    const data = refMaps[field.refCollection];
    if (!data) return [];
    // Sin inactivos en el desplegable (el ya elegido en la fila se conserva).
    const activeFlag = ACTIVE_FLAG_BY_COLLECTION[field.refCollection];
    const activeIds =
      activeFlag === undefined
        ? null
        : new Set(data.rows.filter((r) => isActiveRecord(r, activeFlag)).map((r) => r.id));
    let options = [...data.labels.entries()]
      .filter(
        ([value]) => activeIds === null || activeIds.has(value) || value === draft[field.key],
      )
      .map(([value, label]) => ({ value, label }));

    // Bloqueadas por la ventana de captura (ya capturado, en taller…): fuera.
    const blocked = blockedRefs?.[field.key];
    if (blocked && blocked.size > 0) {
      const chosen = draft[field.key];
      options = options.filter((option) => !blocked.has(option.value) || option.value === chosen);
    }
    // Ya está en un renglón de esta misma captura: no se repite.
    const unique = detail.uniqueRowKey;
    if (unique && unique.key === field.key) {
      const used = new Set(rows.map((row) => String(row[unique.key] ?? '')));
      options = options.filter((option) => !used.has(option.value));
    }

    // Prenda: solo las que tienen existencia en alguna talla.
    if (control && itemsWithStock && field.key === control.matchKeys[0]) {
      options = options.filter((option) => itemsWithStock.has(option.value));
    }

    // Talla: del tipo que usa la prenda elegida y con existencia disponible.
    const filter = field.refFilterFromRefField;
    if (filter) {
      const sourceField = detail.fields.find((f) => f.key === filter.field);
      const sourceId = draft[filter.field];
      if (sourceField?.refCollection && typeof sourceId === 'string' && sourceId !== '') {
        const source = refMaps[sourceField.refCollection]?.rows.find((r) => r.id === sourceId);
        const expected = source?.[filter.sourceField];
        if (expected !== undefined && expected !== '') {
          const allowed = new Set(
            data.rows.filter((r) => r[filter.targetField] === expected).map((r) => r.id),
          );
          options = options.filter((option) => allowed.has(option.value));
        }
        if (control && stockByKey && field.key === control.matchKeys[1]) {
          options = options.filter(
            (option) => (stockByKey.get(`${sourceId}|${option.value}`) ?? 0) > 0,
          );
        }
      }
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  };

  /** ¿El formulario de captura tiene algo escrito? */
  const draftHasData = fields.some((field) => {
    const value = draft[field.key];
    return value !== '' && value !== null && value !== undefined && value !== false;
  });

  /** Agrega el renglón capturado. Devuelve false si algo lo impide. */
  const handleAdd = (): boolean => {
    const missing = fields.filter(
      (field) => field.required && (draft[field.key] === '' || draft[field.key] === null),
    );
    if (missing.length > 0) {
      setError(`Fill in ${missing.map((f) => f.label).join(', ')} before saving the line.`);
      return false;
    }
    const unique = detail.uniqueRowKey;
    if (unique) {
      const chosen = draft[unique.key];
      const uniqueField = detail.fields.find((f) => f.key === unique.key);
      const name =
        typeof chosen === 'string' && uniqueField?.refCollection
          ? refLabels(uniqueField.refCollection, chosen)
          : String(chosen ?? '');
      if (rows.some((row) => row[unique.key] === chosen && chosen !== '' && chosen !== null)) {
        setError(`The ${unique.label} "${name}" is already in this ${detail.title.toLowerCase()}. Each ${unique.label} goes only once.`);
        return false;
      }
      const reason = typeof chosen === 'string' ? blockedRefs?.[unique.key]?.get(chosen) : undefined;
      if (reason) {
        setError(`The ${unique.label} "${name}" can't be added: ${reason}.`);
        return false;
      }
    }
    if (control && available !== null) {
      const value = draft[control.quantityKey];
      const requested = typeof value === 'number' ? value : Number(value) || 0;
      if (requested > available) {
        setError(
          available <= 0
            ? 'There is no stock of this uniform and size. Register it first in Uniform inventory, with the “Add stock” button.'
            : `Not enough stock: only ${available} available. Lower the quantity, or register more in Uniform inventory.`,
        );
        return false;
      }
    }
    setError(null);
    onChange([...rows, draft]);
    setDraft(blank);
    return true;
  };

  const [open, setOpen] = useState(false);

  /** Resumen de un renglón, para la lista y para la barra del formulario. */
  const rowText = (row: DraftRow) =>
    fields
      .map((field) => displayCell(field, { id: '', ...row }, refLabels))
      .filter((text) => text !== '—')
      .join(' · ');

  return (
    <>
      {/* Barra compacta dentro del formulario: no estorba ni obliga a hacer
          scroll; la captura vive en su propia ventana. */}
      <section className="draftrows-bar">
        <div className="draftrows-bar-text">
          <strong>{detail.title}</strong>
          <span>
            {rows.length === 0
              ? 'No lines yet'
              : `${rows.length} line(s): ${rows.map(rowText).join(' | ')}`}
          </span>
        </div>
        <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>
          <ListPlus size={16} />
          {rows.length === 0 ? 'Add truck' : 'Add another truck'}
        </button>
      </section>

      <Modal
        open={open}
        layer="top"
        size="md"
        title={detail.title}
        onClose={() => setOpen(false)}
        footer={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              // "Done" hace las dos cosas: guarda lo capturado y cierra. Si
              // hay algo escrito y algo lo impide (falta un campo, camión
              // repetido o bloqueado), la ventana NO se cierra y el motivo
              // queda a la vista.
              if (draftHasData && !handleAdd()) return;
              setError(null);
              setOpen(false);
            }}
          >
            Done
          </button>
        }
      >
        <div className="draftrows">
          <p className="draftrows-help">
            Fill in this truck and press <strong>Done</strong>: the line is saved and the window
            closes. To add another truck, open it again with{' '}
            <strong>Add another truck</strong>.
          </p>
          <div className="draftrows-form">
            {fields.map((field) => (
              <FormField
                key={field.key}
                field={field}
                value={draft[field.key] ?? null}
                invalid={false}
                refOptions={refOptions(field)}
                onChange={(key, value) =>
                  setDraft((prev) => {
                    const next = { ...prev, [key]: value };
                    // Al cambiar la prenda, la talla elegida puede dejar de aplicar.
                    detail.fields.forEach((f) => {
                      if (f.refFilterFromRefField?.field === key) next[f.key] = '';
                    });
                    return next;
                  })
                }
              />
            ))}
            {control ? (
              <div className="draftrows-avail">
                <span className="draftrows-avail-label">In stock</span>
                <span
                  className={`draftrows-avail-value ${
                    available !== null && available <= 0 ? 'is-empty' : ''
                  }`}
                  title="Kept by the system from Uniform inventory"
                >
                  {available === null ? '—' : available}
                </span>
              </div>
            ) : null}
          </div>

          {error ? <p className="draftrows-error">{error}</p> : null}

          {rows.length > 0 ? (
            <ul className="draftrows-list">
              {rows.map((row, index) => (
                <li key={index}>
                  <span>{rowText(row)}</span>
                  <button
                    type="button"
                    className="draftrows-remove"
                    aria-label="Remove line"
                    onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
