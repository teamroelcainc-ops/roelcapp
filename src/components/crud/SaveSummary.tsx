import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { displayValue } from './displayValue';
import type { FieldConfig, FieldValue } from '../../types/models';
import './SaveSummary.css';

interface SaveSummaryProps {
  /** Campos del formulario (en el mismo orden en que se capturan). */
  fields: FieldConfig[];
  /** Valores actuales del formulario. */
  values: Record<string, FieldValue>;
  /** Resolución id -> nombre para refs. */
  refLabels: (collection: string, id: string) => string;
  /** Contenido extra opcional al pie (p. ej. permisos activos en Roles). */
  footer?: ReactNode;
}

/** Radio y circunferencia del anillo de progreso (SVG). */
const RING_RADIUS = 26;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function isEmpty(value: FieldValue | undefined): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Sumario en vivo del registro en captura: anillo de progreso, estado de los
 * campos obligatorios y la lista de lo capturado hasta el momento.
 */
export function SaveSummary({ fields, values, refLabels, footer }: SaveSummaryProps) {
  const filled = useMemo(
    () =>
      fields
        .filter((field) => !isEmpty(values[field.key]))
        .map((field) => ({
          key: field.key,
          label: field.label,
          value: displayValue(field, values[field.key] ?? null, refLabels),
          long: field.type === 'textarea',
          required: field.required === true,
        })),
    [fields, values, refLabels],
  );

  const requiredFields = fields.filter((f) => f.required);
  const requiredMissing = requiredFields.filter((f) => isEmpty(values[f.key])).length;
  const complete = requiredFields.length > 0 && requiredMissing === 0;

  const percent = Math.round((filled.length / Math.max(fields.length, 1)) * 100);
  const ringStyle = {
    '--ring-length': `${RING_LENGTH}`,
    '--ring-offset': `${RING_LENGTH * (1 - percent / 100)}`,
  } as CSSProperties;

  return (
    <aside className={`ssum ${complete ? 'is-complete' : ''}`} aria-label="Record summary">
      <div className="ssum-top">
        <div className="ssum-ring" style={ringStyle}>
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <circle className="ssum-ring-track" cx="32" cy="32" r={RING_RADIUS} />
            <circle className="ssum-ring-value" cx="32" cy="32" r={RING_RADIUS} />
          </svg>
          <span className="ssum-ring-label">
            <strong>{percent}</strong>
            <small>%</small>
          </span>
        </div>
        <div className="ssum-heading">
          <span className="ssum-eyebrow">Record summary</span>
          <strong className="ssum-count">
            {filled.length} <span>/ {fields.length} fields</span>
          </strong>
          {requiredFields.length > 0 ? (
            <span className={`ssum-chip ${complete ? 'is-ok' : 'is-missing'}`}>
              <i className="ssum-dot" />
              {complete
                ? 'Required complete'
                : requiredMissing === 1
                  ? '1 required field left'
                  : `${requiredMissing} required fields left`}
            </span>
          ) : null}
        </div>
      </div>

      {filled.length === 0 ? (
        <p className="ssum-empty">Fill the form and each value will appear here as you type.</p>
      ) : (
        <dl className="ssum-list">
          {filled.map((item) => (
            <div key={item.key} className={`ssum-item ${item.required ? 'is-required' : ''}`}>
              <dt>{item.label}</dt>
              <dd className={item.long ? 'is-long' : ''}>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {footer ? <div className="ssum-footer">{footer}</div> : null}
    </aside>
  );
}