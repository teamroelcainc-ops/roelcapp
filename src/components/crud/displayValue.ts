import type { EntityData, FieldConfig, FieldValue } from '../../types/models';
import { texasDateOf } from '../../services/captureWindow';

/** Colapsa un posible arreglo (asignaciones) a un valor escalar mostrable. */
export function scalar(value: FieldValue | string[] | undefined): FieldValue {
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(', ') : value;
}

/** Valor efectivo de un campo: el calculado en vivo, o el guardado. */
export function effectiveValue(field: FieldConfig, row: EntityData): FieldValue {
  if (field.compute) return field.compute(row);
  return scalar(row[field.key]);
}

/**
 * '2026-08-27' -> '08/27/2026'. El cliente pidió MES/DÍA/AÑO en toda la app;
 * el dato guardado sigue siendo ISO (ordena y compara bien), solo cambia lo
 * que se muestra. Un valor que no sea fecha ISO se deja tal cual.
 */
export function formatUsDate(iso: string): string {
  // Un sello con hora ("2026-09-30T04:30:00Z") se lee en HORA DE TEXAS: en
  // UTC ya sería el día siguiente y la fecha mostrada saldría corrida.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) {
    const texas = texasDateOf(iso);
    if (texas !== '') iso = texas;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : iso;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('es-MX', { style: 'currency', currency: 'USD' });
}

/** Convierte el valor crudo en texto visible (resuelve refs, montos, booleanos). */
export function displayValue(
  field: FieldConfig,
  value: FieldValue,
  refLabels: (collection: string, id: string) => string,
): string {
  if (value === null || value === '' || value === undefined) return '—';
  switch (field.type) {
    case 'ref':
      if (!field.refCollection) return String(value);
      // Con refLabelFrom la etiqueta la resuelve quien llama (conoce las filas
      // del catálogo); aquí se pide con un sufijo para no romper la firma.
      return refLabels(
        field.refLabelFrom ? `${field.refCollection}#${field.refLabelFrom}` : field.refCollection,
        String(value),
      );
    case 'bool':
      return value === true ? 'Yes' : 'No';
    case 'currency':
      return typeof value === 'number' ? formatCurrency(value) : String(value);
    case 'date':
      return typeof value === 'string' ? formatUsDate(value) : String(value);
    default:
      return String(value);
  }
}

/**
 * Texto final de una celda: valor calculado o guardado y, si queda vacío,
 * el del campo de respaldo (dato heredado de una migración).
 */
export function displayCell(
  field: FieldConfig,
  row: EntityData,
  refLabels: (collection: string, id: string) => string,
): string {
  const text = displayValue(field, effectiveValue(field, row), refLabels);
  if (text !== '' && text !== '—') return text;
  if (!field.fallbackField) return text;
  const fallback = scalar(row[field.fallbackField]);
  if (fallback === null || fallback === '') return text;
  // El valor heredado puede ser el ID del registro referenciado (migración):
  // se intenta resolver a nombre y, si no existe, se muestra tal cual.
  if (field.type === 'ref' && field.refCollection && typeof fallback === 'string') {
    const resolved = refLabels(field.refCollection, fallback);
    if (resolved !== '' && resolved !== '—') return resolved;
  }
  return String(fallback);
}