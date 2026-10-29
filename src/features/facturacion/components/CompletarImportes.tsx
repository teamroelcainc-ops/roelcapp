// src/features/facturacion/components/CompletarImportes.tsx
// ---------------------------------------------------------------------------
// ✅ V00524 — "Completar importes" en la pestaña Corregir: a las facturas que no guardaron lo que cobró
// cada operación les guarda su desglose con lo que cobra hoy cada una, SIN tocar el total. Es una
// escritura masiva: los tres pasos de siempre (prueba → respaldo → APLICAR). Lo que se aplica es
// exactamente lo de la prueba (se congela al bajarla). La escritura está en services/completarImportes.ts.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { CheckCheck, Download, FileSpreadsheet, ListPlus } from 'lucide-react';
import { auth } from '../../../config/firebase';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { descargarExcel } from '../../operaciones/services/excelOperaciones';
import { descargarJSON, TEXTO_AUTORIZACION } from '../../operaciones/services/marcarFacturadasF1';
import { categoriaMotivo, completarImportes, filasPruebaCompletar, idsPorLeer, leerOperacionesDe, planCompletarImportes, respaldoCompletar } from '../services/completarImportes';
import type { DocSinImportes, OmitidaCompletar, PlanCompletar, ResultadoCompletar } from '../services/completarImportes';
import './CompletarImportes.css';

const miles = (n: number): string => n.toLocaleString('es-MX');

interface Props {
  /** Las facturas (documentos) que no guardaron lo que cobró cada operación. */
  docs: readonly DocSinImportes[];
  /** Por qué no se puede ('' = se puede). */
  impedimento: string;
  /** Se completaron: para mostrarlas al día sin volver a leer. */
  onCompletadas: (escritas: ReadonlyMap<string, Record<string, unknown>>) => void;
}

/** Las que no se completan, por motivo (el detalle de cada una está en el Excel de prueba). */
const porMotivo = (omitidas: readonly OmitidaCompletar[]): [string, string[]][] =>
  Array.from(omitidas.reduce((m, o) => { const k = categoriaMotivo(o.motivo); return m.set(k, [...(m.get(k) ?? []), o.invoice]); }, new Map<string, string[]>()));

export default function CompletarImportes({ docs, impedimento, onCompletadas }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [plan, setPlan] = useState<PlanCompletar | null>(null);
  const [respaldo, setRespaldo] = useState(false);
  const [texto, setTexto] = useState('');
  const [trabajando, setTrabajando] = useState('');
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<ResultadoCompletar | null>(null);
  const [error, setError] = useState('');
  const quien = auth.currentUser?.email || '';
  const aCompletar = plan?.completar ?? [];
  const cuadran = aCompletar.filter((p) => p.cuadra).length;
  const listo = !!plan && respaldo && texto.trim().toUpperCase() === TEXTO_AUTORIZACION && aCompletar.length > 0 && !trabajando && !resultado;

  const bajarPrueba = async () => {
    setTrabajando('Leyendo las operaciones de las facturas…');
    setError('');
    try {
      const fijos = [...docs];
      const ops = await leerOperacionesDe(idsPorLeer(fijos), (hechas, total) => setAvance({ hechas, total }));
      const p = planCompletarImportes(fijos, ops);
      setTrabajando('Armando el Excel de prueba…');
      setAvance(null);
      await descargarExcel({ filas: filasPruebaCompletar(p), columnasMoneda: ['Moneda'] }, 'Prueba', `Prueba_completar_importes_${hoyLocalISO()}.xlsx`);
      setPlan(p); // la prueba queda CONGELADA: es lo que se aplica
      setRespaldo(false);
      setTexto('');
    } catch (e) {
      console.error('[Facturación] No se pudo armar la prueba de Completar importes:', e);
      setError('No se pudo armar la prueba. Intenta de nuevo.');
    } finally {
      setTrabajando('');
      setAvance(null);
    }
  };

  const bajarRespaldo = () => {
    if (!plan) return;
    descargarJSON(respaldoCompletar(plan.completar, new Date().toISOString(), quien), `Respaldo_antes_de_completar_importes_${hoyLocalISO()}.json`);
    setRespaldo(true);
  };

  const aplicar = async () => {
    if (!listo || !plan) return;
    setTrabajando('Completando…');
    setError('');
    try {
      const r = await completarImportes(plan.completar, new Date().toISOString(), quien, (hechas, total) => setAvance({ hechas, total }));
      setResultado(r);
      if (r.completadas.size) onCompletadas(r.completadas);
    } catch (e) {
      console.error('[Facturación] No se pudieron completar los importes:', e);
      setError('No se pudo terminar. Presiona Revisar de nuevo para ver cuántas quedaron.');
    } finally {
      setTrabajando('');
      setAvance(null);
    }
  };

  if (!abierto && !resultado) {
    return (
      <div className="cim-cerrado">
        <button type="button" className="cim-btn" onClick={() => setAbierto(true)} disabled={!!impedimento || docs.length === 0}>
          <ListPlus size={14} aria-hidden="true" /> Completar importes ({miles(docs.length)})
        </button>
        <span className="cim-ayuda">{impedimento || 'Guarda en cada factura lo que cobra hoy cada operación. El total no cambia.'}</span>
      </div>
    );
  }

  const omitidas = resultado ? resultado.omitidas : plan?.omitidas ?? [];

  return (
    <section className="cim-panel" aria-labelledby="cim-titulo">
      <h4 id="cim-titulo" className="cim-titulo">Completar importes</h4>
      <p className="cim-texto">
        A cada factura que no guardó lo que cobró cada operación se le guarda su desglose con lo que cobra <b>hoy</b> cada una.
        <b> El total no cambia</b>: si la factura no lo tenía guardado, se guarda el mismo que ya muestra. Las que cuadran salen de Corregir;
        las demás pasan a “Sus operaciones no suman el total” con la diferencia por referencia.
      </p>
      {plan && !resultado && (
        <p className="cim-resumen" role="status">
          Según la prueba: se completan <b>{miles(aCompletar.length)}</b> ({miles(cuadran)} cuadran y {miles(aCompletar.length - cuadran)} quedan con diferencia);
          {' '}<b>{miles(plan.omitidas.length)}</b> no se pueden (abajo dice por qué; quedan para revisarlas a mano).
        </p>
      )}

      {resultado ? (
        <div className={`cim-resultado${resultado.error ? ' cim-resultado--error' : ''}`} role="status">
          <p className="cim-resultado-titulo">
            {resultado.error ? `Se detuvo por un error: ${resultado.error}. ` : ''}
            Se completaron {miles(resultado.completadas.size)} facturas{resultado.omitidas.length > 0 ? `; ${miles(resultado.omitidas.length)} no (cambiaron desde la prueba)` : ''}. Ningún total cambió.
          </p>
          <p className="cim-texto">
            {resultado.error
              ? 'Lo completado antes del error ya quedó. Presiona Revisar de nuevo y vuelve a completar: las ya completadas no se repiten.'
              : 'Presiona Revisar de nuevo para ver la lista al día. Quedó en la bitácora.'}
          </p>
        </div>
      ) : (
        <ol className="cim-pasos">
          <li className={`cim-paso${plan ? ' cim-paso--hecho' : ''}`}>
            <button type="button" className="cim-btn" onClick={() => { void bajarPrueba(); }} disabled={!!trabajando}>
              <FileSpreadsheet size={14} aria-hidden="true" /> 1. Descargar la prueba (Excel)
            </button>
            <span className="cim-ayuda">Lee las operaciones de {miles(docs.length)} facturas (una vez) y dice qué se completa, cuánto suman hoy y si cuadran. Revísalo antes de seguir.</span>
          </li>
          <li className={`cim-paso${respaldo ? ' cim-paso--hecho' : ''}`}>
            <button type="button" className="cim-btn" onClick={bajarRespaldo} disabled={!plan || !!trabajando}>
              <Download size={14} aria-hidden="true" /> 2. Descargar el respaldo
            </button>
            <span className="cim-ayuda">Para deshacerlo si hace falta. Guárdalo.</span>
          </li>
          <li className="cim-paso">
            <label className="cim-autorizar" htmlFor="cim-texto">
              3. Escribe <b>{TEXTO_AUTORIZACION}</b> para autorizar
              <input id="cim-texto" className="cim-input" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!respaldo || !!trabajando} autoComplete="off" />
            </label>
            <button type="button" className="cim-btn cim-btn--aplicar" onClick={() => { void aplicar(); }} disabled={!listo}>
              <CheckCheck size={14} aria-hidden="true" /> Completar {miles(aCompletar.length)} facturas
            </button>
          </li>
        </ol>
      )}

      {trabajando && (
        <div className="cim-avance">
          <CargandoDatos compacto texto={avance ? `${trabajando} ${miles(avance.hechas)} de ${miles(avance.total)}` : trabajando} />
          {avance && <progress className="cim-progreso" max={Math.max(avance.total, 1)} value={avance.hechas} />}
        </div>
      )}
      {error && <p className="cim-error" role="alert">{error}</p>}

      {omitidas.length > 0 && !trabajando && (
        <ul className="cim-omitidas">
          {porMotivo(omitidas).map(([motivo, invoices]) => (
            <li key={motivo}><b>{motivo}</b> ({miles(invoices.length)}): {invoices.slice(0, 30).join(', ')}{invoices.length > 30 ? ` y ${miles(invoices.length - 30)} más` : ''}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
