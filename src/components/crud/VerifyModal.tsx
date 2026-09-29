import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import {
  VERIFICATION_LABEL,
  fetchVerifications,
  type VerificationEntry,
  type VerificationResult,
} from '../../services/verifications';
import './VerifyModal.css';

interface VerifyModalProps {
  recordId: string;
  recordLabel: string;
  moduleTitle: string;
  onSubmit: (result: VerificationResult, note: string) => Promise<void>;
  onClose: () => void;
}

const OPTIONS: VerificationResult[] = ['ok', 'issues', 'wrong'];

function stamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Verificación de un registro: cada persona con permiso deja la suya, con
 * resultado (todo bien / algo mal / todo mal) y nota OBLIGATORIA cuando no
 * está todo bien. Debajo, el historial completo de quién verificó y qué dijo.
 */
export function VerifyModal({
  recordId,
  recordLabel,
  moduleTitle,
  onSubmit,
  onClose,
}: VerifyModalProps) {
  const [result, setResult] = useState<VerificationResult>('ok');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<VerificationEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchVerifications(recordId)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  const handleSubmit = async () => {
    if (result !== 'ok' && note.trim() === '') {
      setError('Write a note explaining what is wrong — it is required unless everything is correct.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(result, note.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? `It could not be saved: ${err.message}` : 'Save error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Verify · ${moduleTitle}`}
      onClose={onClose}
      size="sm"
      layer="top"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSubmit()}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save verification'}
          </button>
        </>
      }
    >
      <div className="verify">
        <p className="verify-record">{recordLabel}</p>
        {error ? <p className="verify-error">{error}</p> : null}
        <div className="verify-options">
          {OPTIONS.map((option) => (
            <label key={option} className={result === option ? 'is-active' : ''}>
              <input
                type="radio"
                name="verify-result"
                checked={result === option}
                onChange={() => setResult(option)}
              />
              {VERIFICATION_LABEL[option]}
            </label>
          ))}
        </div>
        <label className="verify-note">
          <span>
            Note {result === 'ok' ? '(optional)' : <strong>(required)</strong>}
          </span>
          <textarea
            className="field-input"
            rows={3}
            value={note}
            maxLength={600}
            placeholder={
              result === 'ok'
                ? 'Anything worth leaving on record…'
                : 'What is wrong? Be specific so it can be fixed.'
            }
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="verify-history">
          <span className="verify-history-title">Verification history</span>
          {history === null ? (
            <p className="verify-empty">Loading…</p>
          ) : history.length === 0 ? (
            <p className="verify-empty">No verifications yet.</p>
          ) : (
            <ul>
              {history.map((entry) => (
                <li key={entry.id} className={`is-${entry.result}`}>
                  <div>
                    <strong>{VERIFICATION_LABEL[entry.result]}</strong>
                    <span> · {entry.byName}</span>
                    <em> · {stamp(entry.createdAt)} CT</em>
                  </div>
                  {entry.note !== '' ? <p>{entry.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
