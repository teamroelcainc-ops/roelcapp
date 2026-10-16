import { useMemo } from 'react';
import { Eraser, X } from 'lucide-react';
import { SearchableSelect, type SelectOption } from '../ui/SearchableSelect';
import type { RefMaps } from '../../hooks/useRefMaps';
import type { FieldConfig } from '../../types/models';
import './FilterPanel.css';

/** Filtro activo de una columna (según el tipo del campo se usan unas u otras claves). */
export interface ColumnFilter {
  /** text/textarea: contiene. */
  text?: string;
  /** enum/ref: igual a. */
  equals?: string;
  /** bool: SI = verdadero, NO = falso/vacío. */
  boolValue?: 'SI' | 'NO';
  /** date/number: rango desde. */
  from?: string;
  /** date/number: rango hasta. */
  to?: string;
}

export type FiltersState = Record<string, ColumnFilter>;

interface FilterPanelProps {
  open: boolean;
  fields: FieldConfig[];
  filters: FiltersState;
  refMaps: RefMaps;
  onChange: (key: string, filter: ColumnFilter | null) => void;
  onClearAll: () => void;
  onClose: () => void;
}

function isEmptyFilter(filter: ColumnFilter): boolean {
  return (
    (filter.text ?? '') === '' &&
    (filter.equals ?? '') === '' &&
    filter.boolValue === undefined &&
    (filter.from ?? '') === '' &&
    (filter.to ?? '') === ''
  );
}

/**
 * Panel lateral derecho con un filtro por columna del módulo.
 * El filtrado es en vivo: cada cambio se aplica de inmediato a la tabla.
 */
export function FilterPanel({
  open,
  fields,
  filters,
  refMaps,
  onChange,
  onClearAll,
  onClose,
}: FilterPanelProps) {
  const refOptionsByField = useMemo(() => {
    const map: Record<string, SelectOption[]> = {};
    fields.forEach((field) => {
      if (field.type !== 'ref' || !field.refCollection) return;
      const refData = refMaps[field.refCollection];
      if (!refData) {
        map[field.key] = [];
        return;
      }
      let rows = refData.rows;
      if (field.refFilter) {
        rows = rows.filter((r) => r[field.refFilter!.field] === field.refFilter!.value);
      }
      map[field.key] = rows
        .map((r) => ({ value: r.id, label: refData.labels.get(r.id) ?? r.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
    });
    return map;
  }, [fields, refMaps]);

  const update = (key: string, partial: ColumnFilter) => {
    const next: ColumnFilter = { ...(filters[key] ?? {}), ...partial };
    onChange(key, isEmptyFilter(next) ? null : next);
  };

  const activeCount = Object.keys(filters).length;

  const renderControl = (field: FieldConfig) => {
    const filter = filters[field.key] ?? {};
    switch (field.type) {
      case 'enum':
        return (
          <SearchableSelect
            value={filter.equals ?? ''}
            options={(field.enumValues ?? []).map((v) => ({ value: v, label: v }))}
            placeholder="All"
            onChange={(v) => update(field.key, { equals: v })}
          />
        );
      case 'ref':
        return (
          <SearchableSelect
            value={filter.equals ?? ''}
            options={refOptionsByField[field.key] ?? []}
            placeholder="All"
            onChange={(v) => update(field.key, { equals: v })}
          />
        );
      case 'bool':
        return (
          <SearchableSelect
            value={filter.boolValue ?? ''}
            options={[
              { value: 'SI', label: 'Yes' },
              { value: 'NO', label: 'No' },
            ]}
            placeholder="All"
            onChange={(v) =>
              update(field.key, { boolValue: v === 'SI' || v === 'NO' ? v : undefined })
            }
          />
        );
      case 'date':
        return (
          <div className="fpanel-range">
            <input
              type="date"
              value={filter.from ?? ''}
              onChange={(e) => update(field.key, { from: e.target.value })}
            />
            <span>to</span>
            <input
              type="date"
              value={filter.to ?? ''}
              onChange={(e) => update(field.key, { to: e.target.value })}
            />
          </div>
        );
      case 'number':
      case 'currency':
        return (
          <div className="fpanel-range">
            <input
              type="number"
              placeholder="Min"
              value={filter.from ?? ''}
              onChange={(e) => update(field.key, { from: e.target.value })}
            />
            <span>to</span>
            <input
              type="number"
              placeholder="Max"
              value={filter.to ?? ''}
              onChange={(e) => update(field.key, { to: e.target.value })}
            />
          </div>
        );
      default:
        return (
          <input
            className="fpanel-text"
            placeholder="Contains…"
            value={filter.text ?? ''}
            onChange={(e) => update(field.key, { text: e.target.value })}
          />
        );
    }
  };

  return (
    <>
      {open ? <div className="fpanel-backdrop" onClick={onClose} /> : null}
      <aside className={`fpanel ${open ? 'is-open' : ''}`} aria-label="Column filters">
        <div className="fpanel-header">
          <strong>Filters</strong>
          {activeCount > 0 ? <span className="fpanel-count">{activeCount}</span> : null}
          <button
            type="button"
            className="icon-btn"
            title="Clear all filters"
            onClick={onClearAll}
            disabled={activeCount === 0}
          >
            <Eraser size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close filters">
            <X size={17} />
          </button>
        </div>
        <div className="fpanel-body">
          {fields.map((field) => (
            <div key={field.key} className="fpanel-field">
              <label>{field.label}</label>
              {renderControl(field)}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
