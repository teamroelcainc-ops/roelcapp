import { PlusCircle } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { displayCell } from './displayValue';
import type { DetailConfig, EntityData } from '../../types/models';
import './DetailSummary.css';

interface DetailSummaryProps {
  detail: DetailConfig;
  /** Renglones que pertenecen al registro abierto. */
  rows: EntityData[];
  refLabels: (collection: string, id: string) => string;
  /** Abre la subtabla para agregar o editar renglones. */
  onManage?: () => void;
  manageLabel?: string;
}

/**
 * Resumen de los renglones de detalle de un registro (p. ej. los uniformes
 * asignados a un driver), con acceso directo para cargarlos.
 */
export function DetailSummary({
  detail,
  rows,
  refLabels,
  onManage,
  manageLabel = 'Add / manage',
}: DetailSummaryProps) {
  const columns = detail.fields.filter((f) => f.table !== false).slice(0, 4);

  return (
    <section className="dsum">
      <header className="dsum-head">
        <strong>{detail.title}</strong>
        <span className="dsum-count">{rows.length}</span>
        {onManage ? (
          <button type="button" className="btn btn-outline dsum-manage" onClick={onManage}>
            <PlusCircle size={16} />
            {manageLabel}
          </button>
        ) : null}
      </header>

      {rows.length === 0 ? (
        <p className="dsum-empty">Nothing loaded yet for this record.</p>
      ) : (
        <ul className="dsum-list">
          {rows.map((row) => (
            <li key={row.id}>
              {columns.map((field) => {
                const text = displayCell(field, row, refLabels);
                return (
                  <span key={field.key} className="dsum-cell">
                    <em>{field.label}</em>
                    {field.badge === true && text !== '—' ? <Badge value={text} /> : <b>{text}</b>}
                  </span>
                );
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}