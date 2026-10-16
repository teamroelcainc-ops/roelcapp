import type { ReactNode } from 'react';
import { ExternalLink, Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { displayCell, effectiveValue } from './displayValue';
import { MODULE_BY_COLLECTION } from '../../config/modules';
import { COLLECTIONS } from '../../config/collections';
import { useAuth } from '../../hooks/useAuth';
import type { EntityData, FieldConfig } from '../../types/models';
import './RecordDetailModal.css';

interface RecordDetailModalProps {
  title: string;
  fields: FieldConfig[];
  record: EntityData;
  refLabels: (collection: string, id: string) => string;
  /** Contenido extra opcional (p. ej. desglose de permisos en Roles). */
  extra?: ReactNode;
  /** Acciones que van ARRIBA, antes de los campos (a la vista de entrada). */
  headerExtra?: ReactNode;
  /** Si se define, muestra el botón Editar. */
  onEdit?: () => void;
  /** Campo con el uid de quien capturó: el pie dice "Captured … by <nombre>". */
  capturedByKey?: string;
  onClose: () => void;
}

const STATUS_KEYS = new Set(['status', 'dlStatus', 'dotStatus', 'qcStatus']);

/** Los datos destacados son millajes: se leen mejor con separador de miles. */
function highlightText(field: FieldConfig, record: EntityData, fallback: string): string {
  const value = effectiveValue(field, record);
  if (typeof value !== 'number') return fallback;
  return value.toLocaleString('en-US');
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // Todo el app muestra MES/DÍA/AÑO, también los sellos de captura.
  return date.toLocaleString('en-US', {
    // Siempre hora de Texas, sin importar la zona del equipo.
    timeZone: 'America/Chicago',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Visor de detalle de un registro: toda la información guardada,
 * resuelta a nombres, en un modal de solo lectura. Se abre con clic
 * en la fila de cualquier tabla del app.
 */
export function RecordDetailModal({
  headerExtra,
  title,
  fields,
  record,
  refLabels,
  extra,
  onEdit,
  capturedByKey,
  onClose,
}: RecordDetailModalProps) {
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : '';
  const ownerId = capturedByKey ? record[capturedByKey] : null;
  const ownerName =
    typeof ownerId === 'string' && ownerId !== '' ? refLabels(COLLECTIONS.users, ownerId) : '';
  const navigate = useNavigate();
  const { can } = useAuth();

  /**
   * Ruta al detalle del registro referenciado (p. ej. del camión de un
   * mantenimiento). Null cuando no hay módulo para esa colección o cuando el
   * rol no puede verlo: en ese caso el dato se muestra como texto plano.
   */
  const linkFor = (field: FieldConfig): string | null => {
    if (field.type !== 'ref' || !field.refCollection) return null;
    const raw = record[field.key];
    if (typeof raw !== 'string' || raw === '') return null;
    const moduleId = MODULE_BY_COLLECTION[field.refCollection];
    if (!moduleId || !can(moduleId, 'ver')) return null;
    return `/${moduleId}?record=${encodeURIComponent(raw)}`;
  };

  const openLink = (to: string) => {
    onClose();
    navigate(to);
  };

  return (
    <Modal
      open
      title={`Detail · ${title}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {createdAt ? (
            <span className="rdetail-meta">
              Captured: {formatDateTime(createdAt)}
              {ownerName && ownerName !== '—' ? (
                <>
                  {' '}
                  by <strong>{ownerName}</strong>
                </>
              ) : null}
            </span>
          ) : null}
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Close
          </button>
          {onEdit ? (
            <button type="button" className="btn btn-primary" onClick={onEdit}>
              <Pencil size={15} />
              Edit
            </button>
          ) : null}
        </>
      }
    >
      {headerExtra ? <div className="rdetail-header-extra">{headerExtra}</div> : null}
      <div className="rdetail-grid">
        {fields.map((field) => {
          const text = displayCell(field, record, refLabels);
          const isStatus = (STATUS_KEYS.has(field.key) || field.badge === true) && text !== '—';
          const isHighlight = field.highlight !== undefined && text !== '—';
          const value = effectiveValue(field, record);
          const isAlert =
            isHighlight &&
            field.highlight === 'balance' &&
            typeof value === 'number' &&
            value <= 0;
          const to = text === '—' ? null : linkFor(field);
          return (
            <div
              key={field.key}
              className={[
                'rdetail-item',
                field.type === 'textarea' ? 'is-full' : '',
                isHighlight ? 'is-highlight' : '',
                isAlert ? 'is-alert' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="rdetail-label">{field.label}</span>
              <span className={`rdetail-value ${text === '—' ? 'is-empty' : ''}`}>
                {isStatus ? (
                  <Badge value={text} tone={field.badgeTones?.[text]} />
                ) : to ? (
                  <button
                    type="button"
                    className="rdetail-link"
                    title={`Open the detail of this ${field.label.toLowerCase()}`}
                    onClick={() => openLink(to)}
                  >
                    {text}
                    <ExternalLink size={13} />
                  </button>
                ) : isHighlight ? (
                  highlightText(field, record, text)
                ) : (
                  text
                )}
              </span>
            </div>
          );
        })}
      </div>
      {extra ? <div className="rdetail-extra">{extra}</div> : null}
    </Modal>
  );
}