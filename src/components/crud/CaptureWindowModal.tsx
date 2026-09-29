import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SearchableSelect } from '../ui/SearchableSelect';
import {
  windowName,
  describeWindow,
  windowSignature,
  APP_TIME_ZONE,
  DAY_NAMES,
  describeSchedule,
  formatDuration,
  formatTexas,
  resolveOccurrence,
  closesInLaterWeek,
  type CaptureWindow,
} from '../../services/captureWindow';
import './CaptureWindow.css';

interface CaptureWindowModalProps {
  label: string;
  window: CaptureWindow | null;
  onSave: (window: Omit<CaptureWindow, 'updatedBy' | 'history'>) => Promise<void>;
  onClear: () => Promise<void>;
  onClose: () => void;
}

const DAY_OPTIONS = DAY_NAMES.map((name, index) => ({ value: String(index), label: name }));

/**
 * Configuración de la ventana de captura semanal. Se elige el día de la
 * semana y la hora (de Texas) en que abre y en que cierra, y se repite cada
 * semana: p. ej. lunes 8:00 AM -> domingo 11:59 PM. El reloj muestra la hora
 * de Texas en este momento para que quien configura no convierta nada.
 */
/** "Tue 09/22/2026" en hora de Texas. */
function formatTexasDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}

export function CaptureWindowModal({ label, window, onSave, onClear, onClose }: CaptureWindowModalProps) {
  // Por omisión, el horario del ejemplo del cliente: lunes 08:00 -> domingo 23:59.
  const [startDay, setStartDay] = useState(String(window?.startDay ?? 1));
  const [startTime, setStartTime] = useState(window?.startTime ?? '08:00');
  const [endDay, setEndDay] = useState(String(window?.endDay ?? 0));
  const [endTime, setEndTime] = useState(window?.endTime ?? '23:59');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, []);

  /**
   * La ventana cierra SIEMPRE la primera vez que llega el día/hora de cierre
   * después de abrir: miércoles 00:00 -> martes 23:59 es una semana exacta.
   * Ya no existe la opción "de la semana siguiente" (hacía ventanas de 13
   * días que se encimaban).
   */
  const draft: Omit<CaptureWindow, 'updatedBy'> = useMemo(
    () => ({
      startDay: Number(startDay),
      startTime,
      endDay: Number(endDay),
      endTime,
      endNextWeek: false,
    }),
    [startDay, startTime, endDay, endTime],
  );
  const closesNextCalendarWeek = closesInLaterWeek({ ...draft, updatedBy: null });

  /** Cómo quedaría la ventana con lo capturado, medida en este instante. */
  /**
   * Semana VIGENTE del horario guardado, con fechas reales: se recalcula
   * sola cada semana ("Tue 09/22/2026 → Tue 09/29/2026") y es la marca que
   * queda en los registros capturados dentro de ese rango.
   */
  const currentWeek = useMemo(
    () => (window ? resolveOccurrence(window, now) : null),
    [window, now],
  );

  const preview = useMemo(
    () => resolveOccurrence({ ...draft, updatedBy: null }, now),
    [draft, now],
  );

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The window could not be saved');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    setError(null);
    try {
      await onClear();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The window could not be removed');
    } finally {
      setBusy(false);
      setConfirmClear(false);
    }
  };

  return (
    <Modal
      open
      title={label}
      onClose={onClose}
      size="md"
      footer={
        <>
          {error ? <span className="crudform-error">{error}</span> : null}
          {window ? (
            <button
              type="button"
              className="btn btn-danger cwin-modal-clear"
              onClick={() => setConfirmClear(true)}
              disabled={busy}
            >
              Remove window
            </button>
          ) : null}
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={busy || preview.status === 'unset'}
          >
            {busy ? 'Saving…' : window ? 'Update window' : 'Open window'}
          </button>
        </>
      }
    >
      {!window ? (
        <p className="cwmodal-empty">
          There are no saved schedules yet. Set the days and times below and press
          <strong> Save window</strong> to create the first one; from then on it stays in this
          list to reuse it.
        </p>
      ) : null}
      {currentWeek?.occurrence ? (
        <p className="cwmodal-week">
          <strong>Current week:</strong> {formatTexasDate(currentWeek.occurrence.startAt)} →{' '}
          {formatTexasDate(currentWeek.occurrence.endAt)}
          <em>
            {' '}
            · this range is saved on every record captured in it; next week it moves forward on
            its own.
          </em>
        </p>
      ) : null}
      {window ? (
        <div className="cwmodal-history">
          <span className="cwmodal-history-title">Saved schedules</span>
          <table className="cwmodal-history-table">
            <thead>
              <tr>
                <th>Schedule (from - to - start - end)</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {/* El que está EN USO encabeza la lista. */}
              <tr className="is-current">
                <td>
                  <strong>{windowName(window)}</strong>
                  <em> · {describeWindow(window)}</em>
                  {currentWeek?.occurrence ? (
                    <div className="cwmodal-week-dates">
                      This week: {formatTexasDate(currentWeek.occurrence.startAt)} →{' '}
                      {formatTexasDate(currentWeek.occurrence.endAt)}
                    </div>
                  ) : null}
                </td>
                <td>In use</td>
                <td />
              </tr>
              {(window.history ?? []).map((entry) => (
                <tr key={`${windowSignature(entry)}-${entry.usedUntil}`}>
                  <td>
                    <strong>{windowName(entry)}</strong>
                    <em> · {describeWindow(entry)}</em>
                  </td>
                  <td>{formatTexasDate(entry.usedUntil)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-outline cwmodal-pick"
                      title="Load this schedule into the form"
                      onClick={() => {
                        // Se carga en el formulario: el admin revisa y
                        // confirma con "Update window".
                        setStartDay(String(entry.startDay));
                        setStartTime(entry.startTime);
                        setEndDay(String(entry.endDay));
                        setEndTime(entry.endTime);
                      }}
                    >
                      Use this one
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <small>
            Pick a saved schedule with “Use this one”, or set a different one below and press
            “Update window”. Each record keeps the schedule it was saved under, so changing
            this never mixes them; the one in use cannot be saved twice.
          </small>
        </div>
      ) : null}
      <div className="cwin-modal">
        <p className="cwin-modal-help">
          Pick the day of the week and the time the window opens and closes;{' '}
          <strong>it repeats every week</strong>. Between those two moments everyone can add
          records; outside of them only the roles with "Add outside window" can. Times are{' '}
          <strong>Texas time (Central)</strong> for all users, whatever their own time zone.
        </p>
        <div className="cwin-modal-now">
          <span>Texas time now</span>
          <strong>{formatTexas(new Date(now).toISOString(), true)}</strong>
          <small>{APP_TIME_ZONE}</small>
        </div>
        <div className="cwin-modal-grid">
          <div className="cwin-modal-field">
            <span>Opens on (every week)</span>
            <SearchableSelect value={startDay} options={DAY_OPTIONS} onChange={setStartDay} />
          </div>
          <label className="cwin-modal-field">
            <span>At (Texas time)</span>
            <input
              className="field-input"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </label>
          <div className="cwin-modal-field">
            <span>Closes on</span>
            <SearchableSelect value={endDay} options={DAY_OPTIONS} onChange={setEndDay} />
            <small className="cwin-modal-hint">
              Closes on the FIRST {DAY_NAMES[Number(endDay)]} after it opens
              {closesNextCalendarWeek ? ' (the next one on the calendar)' : ''} — a window never
              lasts more than one week.
            </small>
          </div>
          <label className="cwin-modal-field">
            <span>At (Texas time)</span>
            <input
              className="field-input"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </label>
        </div>
        <p className={`cwin-modal-preview ${preview.status === 'unset' ? 'is-invalid' : ''}`}>
          {preview.status === 'unset' || !preview.occurrence ? (
            'Choose the opening and closing time.'
          ) : (
            <>
              The window will repeat {describeSchedule({ ...draft, updatedBy: null })}.{' '}
              <strong>
                Each window lasts{' '}
                {formatDuration(
                  new Date(preview.occurrence.endAt).getTime() -
                    new Date(preview.occurrence.startAt).getTime(),
                  false,
                )}
              </strong>
              : for example {formatTexas(preview.occurrence.startAt)} →{' '}
              {formatTexas(preview.occurrence.endAt)}.{' '}
              {preview.status === 'open'
                ? `Right now it would be OPEN, closing in ${formatDuration(new Date(preview.occurrence.endAt).getTime() - now, false)}.`
                : `Right now it would be CLOSED, opening in ${formatDuration(new Date(preview.occurrence.startAt).getTime() - now, false)}.`}
            </>
          )}
        </p>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Remove window"
        message="Without a window, only the roles with the 'Add outside window' permission (and administrators) will be able to add records. Remove it?"
        busy={busy}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => void handleClear()}
      />
    </Modal>
  );
}
