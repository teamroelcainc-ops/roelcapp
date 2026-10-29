// src/features/operaciones/components/ConfirmarCorrectas.tsx
// ---------------------------------------------------------------------------
// ✅ V00518 — "Confirmar todas como correctas" (✓) de un grupo de la Revisión de datos (hoy D6). Es una
// escritura masiva: mismos tres pasos que F1 y D3 (prueba → respaldo → APLICAR). Una por una se hace
// con ✓ Está bien en cada fila. La escritura está en services/confirmarRevision.ts.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { CheckCheck, Download, FileSpreadsheet } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { auth } from '../../../config/firebase';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { confirmarTodas, filasPruebaConfirmar, respaldoConfirmar } from '../services/confirmarRevision';
import type { ResultadoConfirmar } from '../services/confirmarRevision';
import { descargarExcel } from '../services/excelOperaciones';
import { descargarJSON, TEXTO_AUTORIZACION } from '../services/marcarFacturadasF1';
import type { CodigoRevision, ConfirmacionRevision, FilaRevision } from '../services/revisionDatos';
import './ConfirmarCorrectas.css';

const miles = (n: number): string => n.toLocaleString('es-MX');

interface Props {
  codigo: CodigoRevision;
  filas: readonly FilaRevision[];
  /** Las confirmadas, para quitarlas de la revisión al momento. */
  onConfirmadas: (marcas: ReadonlyMap<string, ConfirmacionRevision>) => void;
}

export default function ConfirmarCorrectas({ codigo, filas, onConfirmadas }: Props) {
  const [abierto, setAbierto] = useState(false);
  // La lista se CONGELA al bajar la prueba: lo que se confirma es exactamente lo de la prueba.
  const [congeladas, setCongeladas] = useState<readonly FilaRevision[] | null>(null);
  const lista = congeladas ?? filas;
  const [prueba, setPrueba] = useState(false);
  const [respaldo, setRespaldo] = useState(false);
  const [texto, setTexto] = useState('');
  const [trabajando, setTrabajando] = useState('');
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<ResultadoConfirmar | null>(null);
  const [error, setError] = useState('');
  const quien = auth.currentUser?.email || '';
  const listo = prueba && respaldo && texto.trim().toUpperCase() === TEXTO_AUTORIZACION && lista.length > 0 && !trabajando && !resultado;

  const bajarPrueba = async () => {
    setTrabajando('Armando el Excel de prueba…');
    setError('');
    try {
      const fijas = [...filas];
      await descargarExcel({ filas: filasPruebaConfirmar(fijas), columnasMoneda: [] }, `Prueba ${codigo}`, `Prueba_${codigo}_confirmar_correctas_${hoyLocalISO()}.xlsx`);
      setCongeladas(fijas);
      setPrueba(true);
    } catch (e) {
      console.error(`No se pudo armar el Excel de prueba de ${codigo}:`, e);
      setError('No se pudo armar el Excel de prueba. Intenta de nuevo.');
    } finally {
      setTrabajando('');
    }
  };

  const bajarRespaldo = () => {
    descargarJSON(respaldoConfirmar(codigo, lista, new Date().toISOString(), quien), `Respaldo_${codigo}_antes_de_confirmar_${hoyLocalISO()}.json`);
    setRespaldo(true);
  };

  const aplicar = async () => {
    if (!listo) return;
    setTrabajando('Confirmando…');
    setError('');
    try {
      const r = await confirmarTodas(codigo, lista, new Date().toISOString(), quien, (hechas, total) => setAvance({ hechas, total }));
      setResultado(r);
      if (r.confirmadas.size) onConfirmadas(r.confirmadas);
    } catch (e) {
      console.error(`No se pudieron confirmar las operaciones de ${codigo}:`, e);
      setError('No se pudo terminar. Presiona Revisar de nuevo para ver cuántas quedaron.');
    } finally {
      setTrabajando('');
    }
  };

  if (!abierto && !resultado) {
    return (
      <div className="ccr-cerrado">
        <button type="button" className="ccr-btn" onClick={() => setAbierto(true)} disabled={filas.length === 0}>
          <CheckCheck size={14} aria-hidden="true" /> Confirmar todas como correctas ({miles(filas.length)})
        </button>
        <span className="ccr-ayuda">O una por una con ✓ Está bien en cada operación.</span>
      </div>
    );
  }

  const omitidasPorMotivo = Array.from((resultado?.omitidas ?? [])
    .reduce((m, o) => m.set(o.motivo, [...(m.get(o.motivo) ?? []), o.fila.ref]), new Map<string, string[]>()));

  return (
    <section className="ccr-panel" aria-labelledby="ccr-titulo">
      <h4 id="ccr-titulo" className="ccr-titulo">Confirmar todas como correctas</h4>
      <p className="ccr-texto">
        Cada operación queda marcada como revisada y correcta, y sale de esta lista. No cambia el status ni los montos.
        Si después cambia su monto, vuelve a aparecer. <b>{miles(lista.length)}</b> se confirman.
      </p>

      {resultado ? (
        <div className={`ccr-resultado${resultado.error ? ' ccr-resultado--error' : ''}`} role="status">
          <p className="ccr-resultado-titulo">
            {resultado.error ? `Se detuvo por un error: ${resultado.error}. ` : ''}
            Se confirmaron {miles(resultado.confirmadas.size)} operaciones{resultado.omitidas.length > 0 ? `; ${miles(resultado.omitidas.length)} no (abajo dice por qué)` : ''}.
          </p>
          <p className="ccr-texto">
            {resultado.error
              ? 'Lo confirmado antes del error ya quedó. Presiona Revisar de nuevo y vuelve a confirmar: las ya confirmadas no se repiten.'
              : 'Ya salieron de la lista. Quedó en la bitácora.'}
          </p>
        </div>
      ) : (
        <ol className="ccr-pasos">
          <li className={`ccr-paso${prueba ? ' ccr-paso--hecho' : ''}`}>
            <button type="button" className="ccr-btn" onClick={() => { void bajarPrueba(); }} disabled={!!trabajando}>
              <FileSpreadsheet size={14} aria-hidden="true" /> 1. Descargar la prueba (Excel)
            </button>
            <span className="ccr-ayuda">Las operaciones que se confirmarían, con su monto. Revísalo antes de seguir.</span>
          </li>
          <li className={`ccr-paso${respaldo ? ' ccr-paso--hecho' : ''}`}>
            <button type="button" className="ccr-btn" onClick={bajarRespaldo} disabled={!prueba || !!trabajando}>
              <Download size={14} aria-hidden="true" /> 2. Descargar el respaldo
            </button>
            <span className="ccr-ayuda">Para deshacerlo si hace falta. Guárdalo.</span>
          </li>
          <li className="ccr-paso">
            <label className="ccr-autorizar" htmlFor="ccr-texto">
              3. Escribe <b>{TEXTO_AUTORIZACION}</b> para autorizar
              <input id="ccr-texto" className="ccr-input" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!respaldo || !!trabajando} autoComplete="off" />
            </label>
            <button type="button" className="ccr-btn ccr-btn--aplicar" onClick={() => { void aplicar(); }} disabled={!listo}>
              <CheckCheck size={14} aria-hidden="true" /> Confirmar {miles(lista.length)} operaciones
            </button>
          </li>
        </ol>
      )}

      {trabajando && (
        <div className="ccr-avance">
          <CargandoDatos compacto texto={avance ? `${trabajando} ${miles(avance.hechas)} de ${miles(avance.total)}` : trabajando} />
          {avance && <progress className="ccr-progreso" max={Math.max(avance.total, 1)} value={avance.hechas} />}
        </div>
      )}
      {error && <p className="ccr-error" role="alert">{error}</p>}

      {omitidasPorMotivo.length > 0 && !trabajando && (
        <ul className="ccr-omitidas">
          {omitidasPorMotivo.map(([motivo, refs]) => (
            <li key={motivo}><b>{motivo}</b> ({miles(refs.length)}): {refs.slice(0, 30).join(', ')}{refs.length > 30 ? ` y ${miles(refs.length - 30)} más` : ''}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
