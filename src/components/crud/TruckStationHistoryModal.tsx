import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { fetchDocumentsWhere } from '../../services/firestoreService';
import { formatTexas } from '../../services/captureWindow';
import { COLLECTIONS } from '../../config/collections';
import type { EntityData } from '../../types/models';
import './MyTrucksModal.css';

interface TruckStationHistoryModalProps {
  truckId: string;
  truckLabel: string;
  /** Nombre de un usuario por su id (quién hizo el cambio). */
  userLabel: (id: string) => string;
  onClose: () => void;
}

/** Campos del historial que cuentan como movimiento de estación. */
const STATION_FIELDS = new Set(['idStationActual']);

/**
 * Histórico de movimientos de ESTACIÓN de un camión (truck_history): cuándo
 * (hora de Texas), de qué estación a cuál y quién lo movió. Se lee al abrir,
 * solo los registros de ese camión (consulta por igualdad, pocos documentos).
 */
export function TruckStationHistoryModal({
  truckId,
  truckLabel,
  userLabel,
  onClose,
}: TruckStationHistoryModalProps) {
  const [rows, setRows] = useState<EntityData[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDocumentsWhere(COLLECTIONS.truckHistory, { field: 'idTruck', value: truckId })
      .then((list) => {
        if (cancelled) return;
        const moves = list
          .filter((row) => STATION_FIELDS.has(String(row.field ?? '')))
          .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
        setRows(moves);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'The history could not be loaded');
      });
    return () => {
      cancelled = true;
    };
  }, [truckId]);

  return (
    <Modal open title={`Station history · ${truckLabel}`} onClose={onClose} size="md">
      {error ? <p className="mytrucks-history-error">{error}</p> : null}
      {rows === null && !error ? <p className="mytrucks-history-empty">Loading…</p> : null}
      {rows !== null && rows.length === 0 ? (
        <p className="mytrucks-history-empty">
          No station changes recorded for this truck yet (changes are recorded from the moment
          they are made in the app).
        </p>
      ) : null}
      {rows !== null && rows.length > 0 ? (
        <div className="mytrucks-history-scroll">
          <table className="mytrucks-history">
            <thead>
              <tr>
                <th>When (Texas time)</th>
                <th>From</th>
                <th>To</th>
                <th>Moved by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {typeof row.createdAt === 'string' ? formatTexas(row.createdAt) : String(row.date ?? '—')}
                  </td>
                  <td>{String(row.fromLabel ?? '—')}</td>
                  <td className="mytrucks-history-to">{String(row.toLabel ?? '—')}</td>
                  <td>
                    {typeof row.idUsers === 'string' && row.idUsers !== '' ? userLabel(row.idUsers) : '—'}
                    {typeof row.note === 'string' && row.note !== '' ? (
                      <em className="mytrucks-history-note"> · {row.note}</em>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Modal>
  );
}
