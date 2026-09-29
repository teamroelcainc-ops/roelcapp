import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronsUpDown,
  History,
  Pencil,
  PlusCircle,
  Power,
  Trash2,
} from 'lucide-react';
import './DataTable.css';

export interface TableColumn {
  key: string;
  label: string;
  render: (row: Record<string, unknown> & { id: string }) => ReactNode;
}

export type SortDirection = 'asc' | 'desc';

interface DataTableProps<T extends { id: string }> {
  columns: TableColumn[];
  rows: T[];
  emptyMessage?: string;
  canEdit: boolean;
  canDelete: boolean;
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
  detailLabel?: string;
  onDetail?: (row: T) => void;
  /** Si se define, el botón de detalle solo aparece en las filas que cumplan. */
  canDetail?: (row: T) => boolean;
  /** Columna por la que se ordena (null = orden original). */
  sortKey?: string | null;
  sortDir?: SortDirection | null;
  /** Si se define, los encabezados son clicables para ordenar. */
  onSort?: (key: string) => void;
  /** Si se define, la fila completa es clicable (ver detalle del registro). */
  onRowClick?: (row: T) => void;
  /** Acción extra por fila (historial / registros relacionados). */
  historyLabel?: string;
  onHistory?: (row: T) => void;
  /** Botón activar/desactivar: presente solo en módulos con esa marca. */
  onToggleActive?: (row: T) => void;
  /** ¿La fila está activa? (pinta el botón y atenúa las inactivas). */
  isRowActive?: (row: T) => boolean;
  /** Check de verificación (solo admin): marcar el registro como correcto. */
  onVerify?: (row: T) => void;
  /** ¿El registro ya fue verificado? (pinta el check en verde). */
  isRowVerified?: (row: T) => boolean;
  /** Etiqueta de aviso para la fila (p. ej. "DUPLICATE"); null = sin aviso. */
  rowFlag?: (row: T) => { label: string; title: string } | null;
  /**
   * Selección múltiple. Si se define, aparece una casilla por fila y otra en
   * el encabezado para marcar o desmarcar todo lo que se está viendo.
   */
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
}

/** Tabla genérica con acciones. Todas las tablas del app pasan por aquí. */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  emptyMessage = 'No records yet',
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  detailLabel,
  onDetail,
  canDetail,
  sortKey = null,
  sortDir = null,
  onSort,
  onRowClick,
  historyLabel,
  onHistory,
  onToggleActive,
  isRowActive,
  rowFlag,
  onVerify,
  isRowVerified,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: DataTableProps<T>) {
  const showActions =
    (canEdit && onEdit) || (canDelete && onDelete) || onDetail || onHistory || onToggleActive || onVerify;
  const showSelect = selectedIds !== undefined && onToggleSelect !== undefined;
  const allSelected =
    showSelect && rows.length > 0 && rows.every((row) => selectedIds.has(row.id));
  /** Columnas fijas que se suman a las de datos (selección y acciones). */
  const extraCols = (showSelect ? 1 : 0) + (showActions ? 1 : 0);

  const sortIcon = (key: string) => {
    if (sortKey !== key || !sortDir) return <ChevronsUpDown size={13} className="dtable-sort-idle" />;
    return sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />;
  };

  return (
    <div className="dtable-wrap">
      <table className="dtable">
        <thead>
          <tr>
            {showSelect ? (
              <th className="dtable-select-col">
                <input
                  type="checkbox"
                  checked={allSelected}
                  aria-label="Select all rows shown"
                  title="Select all rows shown"
                  onChange={() => onToggleSelectAll?.()}
                />
              </th>
            ) : null}
            {showActions ? <th className="dtable-actions-col">Actions</th> : null}
            {columns.map((col) =>
              onSort ? (
                <th
                  key={col.key}
                  className={`dtable-sortable ${sortKey === col.key && sortDir ? 'is-sorted' : ''}`}
                  onClick={() => onSort(col.key)}
                  title={`Sort by ${col.label}`}
                >
                  <span className="dtable-th-inner">
                    {col.label}
                    {sortIcon(col.key)}
                  </span>
                </th>
              ) : (
                <th key={col.key}>{col.label}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="dtable-empty" colSpan={columns.length + extraCols}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                className={[
                  onRowClick ? 'dtable-row-click' : '',
                  showSelect && selectedIds.has(row.id) ? 'is-selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ') + (isRowActive && !isRowActive(row) ? ' is-inactive' : '')}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {showSelect ? (
                  <td className="dtable-select" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      aria-label="Select row"
                      onChange={() => onToggleSelect(row.id)}
                    />
                  </td>
                ) : null}
                {showActions ? (
                  <td className="dtable-actions" onClick={(e) => e.stopPropagation()}>
                    {onDetail && (!canDetail || canDetail(row)) ? (
                      <button
                        type="button"
                        className="icon-btn"
                        title={detailLabel ?? 'Detail'}
                        onClick={() => onDetail(row)}
                      >
                        <PlusCircle size={18} strokeWidth={2.2} />
                      </button>
                    ) : null}
                    {rowFlag?.(row) ? (
                      <span className="dtable-flag" title={rowFlag(row)!.title}>
                        {rowFlag(row)!.label}
                      </span>
                    ) : null}
                    {onHistory ? (
                      <button
                        type="button"
                        className="icon-btn"
                        title={historyLabel ?? 'History'}
                        onClick={() => onHistory(row)}
                      >
                        <History size={16} />
                      </button>
                    ) : null}
                    {onVerify ? (
                      <button
                        type="button"
                        className={`icon-btn ${isRowVerified?.(row) ? 'dtable-verified' : ''}`}
                        title={
                          isRowVerified?.(row)
                            ? 'Verified as correct — click to remove the check'
                            : 'Mark as verified (information is correct)'
                        }
                        onClick={() => onVerify(row)}
                      >
                        <CheckCircle2 size={16} />
                      </button>
                    ) : null}
                    {onToggleActive ? (
                      <button
                        type="button"
                        className="icon-btn"
                        title={
                          isRowActive && !isRowActive(row)
                            ? 'Mark as ACTIVE (it will show again in the lists)'
                            : 'Mark as INACTIVE (it disappears from every dropdown)'
                        }
                        onClick={() => onToggleActive(row)}
                      >
                        <Power
                          size={16}
                          className={isRowActive && !isRowActive(row) ? 'dtable-power-off' : undefined}
                        />
                      </button>
                    ) : null}
                    {canEdit && onEdit ? (
                      <button
                        type="button"
                        className="icon-btn"
                        title="Edit"
                        onClick={() => onEdit(row)}
                      >
                        <Pencil size={16} />
                      </button>
                    ) : null}
                    {canDelete && onDelete ? (
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Delete"
                        onClick={() => onDelete(row)}
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                  </td>
                ) : null}
                {columns.map((col) => (
                  <td key={col.key}>{col.render(row)}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}