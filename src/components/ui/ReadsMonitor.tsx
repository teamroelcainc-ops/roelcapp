import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import {
  getReadTally,
  getStoredReadTally,
  resetStoredReadTally,
} from '../../services/firestoreService';
import './ReadsMonitor.css';

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * Panel flotante SOLO para el admin real: cuántas lecturas facturables ha
 * hecho ESTA pestaña en la sesión y qué colección las gasta. Con él se
 * identifica al responsable del consumo del plan sin adivinar: se navega
 * por el app como siempre y el desglose lo dice.
 */
export function ReadsMonitor() {
  const { effectiveRole } = useAuth();
  /**
   * Oculto de fábrica: solo se muestra si el ROL vigente tiene la acción
   * "Reads monitor" concedida en algún módulo (se activa en Roles cuando se
   * quiere vigilar el consumo). En "View as" manda el rol simulado.
   */
  const enabled = Object.values(effectiveRole?.permissions ?? {}).some(
    (perms) => perms?.monitorLecturas === true,
  );
  const [open, setOpen] = useState(false);
  const [tally, setTally] = useState(() => getReadTally());

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setTally(getReadTally()), 4000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className={`readsmon ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="readsmon-chip"
        title="Firestore reads billed by THIS tab this session (cache hits are free)"
        onClick={() => setOpen((v) => !v)}
      >
        <Activity size={14} />
        Reads: {compact(tally.total)}
      </button>
      {open ? (
        <div className="readsmon-panel">
          <p className="readsmon-help">
            Documents delivered by the server to this tab (billed). Reads served from the local
            cache are free and not listed. Leave it open while you work: the top line is the
            module to optimize.
          </p>
          {tally.entries.length === 0 ? (
            <p className="readsmon-empty">No billed reads yet in this session.</p>
          ) : (
            <ul>
              {tally.entries.slice(0, 12).map((entry) => (
                <li key={entry.source}>
                  <span>{entry.source}</span>
                  <strong>{compact(entry.reads)}</strong>
                </li>
              ))}
            </ul>
          )}
          {(() => {
            const stored = getStoredReadTally();
            return (
              <p className="readsmon-since">
                This device since {new Date(stored.since).toLocaleDateString('en-US')}:{' '}
                <strong>{compact(stored.total)}</strong> total
                {stored.entries[0]
                  ? ` · top: ${stored.entries[0].source} ${compact(stored.entries[0].reads)}`
                  : ''}
                <button
                  type="button"
                  className="readsmon-reset"
                  onClick={() => {
                    resetStoredReadTally();
                    setTally(getReadTally());
                  }}
                >
                  reset
                </button>
              </p>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
