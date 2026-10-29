// src/features/operaciones/components/CorregirStatusD3.tsx
// ---------------------------------------------------------------------------
// ✅ V00517 — Corrección D3 dentro de la Revisión de datos: "Corregir status", con los mismos tres
// pasos que F1 (que no se pueden saltar): 1) Excel de prueba, 2) respaldo, 3) autorización escrita
// (APLICAR) y aplicar. La regla y la escritura están en services/corregirStatusD3.ts.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { CheckCheck, Download, FileSpreadsheet } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { auth } from '../../../config/firebase';
import { idReal, obtenerCatalogo } from '../../../shared/data/catalogos';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { aplicarStatusD3, filasPruebaD3, planCorregirStatusD3, respaldoD3, statusDelCatalogo } from '../services/corregirStatusD3';
import type { PlanD3, ResultadoD3, StatusCatalogo } from '../services/corregirStatusD3';
import { descargarExcel } from '../services/excelOperaciones';
import { descargarJSON, TEXTO_AUTORIZACION } from '../services/marcarFacturadasF1';
import type { StatusD3 } from '../services/revisionDatos';
import './CorregirStatusD3.css';

const miles = (n: number): string => n.toLocaleString('es-MX');

/** El catálogo de status FRESCO (decide qué se escribe). */
const leerCatalogo = async (): Promise<StatusCatalogo[]> =>
  statusDelCatalogo((await obtenerCatalogo('catalogo_status_servicio', { fresco: true })).map((s) => ({ id: String(s.id), _docId: idReal(s), nombre: s.nombre })));

interface Props {
  ops: readonly StatusD3[];
  /** Las corregidas con lo que se les escribió, para quitarlas de la revisión al momento. */
  onCorregidas?: (cambios: ReadonlyMap<string, Record<string, unknown>>) => void;
}

export default function CorregirStatusD3({ ops, onCorregidas }: Props) {
  const [catalogo, setCatalogo] = useState<StatusCatalogo[] | null>(null);
  const [errorCatalogo, setErrorCatalogo] = useState('');
  // El plan se CONGELA al bajar la prueba: lo que se aplica es exactamente lo de la prueba y el respaldo.
  const [congelado, setCongelado] = useState<PlanD3 | null>(null);
  const [prueba, setPrueba] = useState(false);
  const [respaldo, setRespaldo] = useState(false);
  const [texto, setTexto] = useState('');
  const [trabajando, setTrabajando] = useState('');
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<ResultadoD3 | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let vigente = true;
    leerCatalogo()
      .then((c) => { if (vigente) setCatalogo(c); })
      .catch((e: unknown) => {
        console.error('[D3] No se pudo leer el catálogo de status:', e);
        if (vigente) setErrorCatalogo('No se pudo leer el catálogo de status. Cierra y vuelve a abrir la revisión.');
      });
    return () => { vigente = false; };
  }, []);

  const plan = congelado ?? (catalogo ? planCorregirStatusD3(ops, catalogo) : null);
  const autorizado = texto.trim().toUpperCase() === TEXTO_AUTORIZACION;
  const listo = !!plan && prueba && respaldo && autorizado && plan.corregir.length > 0 && !trabajando && !resultado;

  const bajarPrueba = async () => {
    setTrabajando('Armando el Excel de prueba…');
    setError('');
    try {
      const nuevo = planCorregirStatusD3(ops, await leerCatalogo());
      await descargarExcel({ filas: filasPruebaD3(nuevo), columnasMoneda: [] }, 'Prueba D3', `Prueba_D3_corregir_status_${hoyLocalISO()}.xlsx`);
      setCongelado(nuevo);
      setPrueba(true);
    } catch (e) {
      console.error('No se pudo armar el Excel de prueba de D3:', e);
      setError('No se pudo armar el Excel de prueba. Intenta de nuevo.');
    } finally {
      setTrabajando('');
    }
  };

  const bajarRespaldo = () => {
    if (!plan) return;
    descargarJSON(respaldoD3(plan, new Date().toISOString(), auth.currentUser?.email || ''), `Respaldo_D3_antes_de_corregir_status_${hoyLocalISO()}.json`);
    setRespaldo(true);
  };

  const aplicar = async () => {
    if (!listo || !plan) return;
    setTrabajando('Corrigiendo el status…');
    setError('');
    try {
      const r = await aplicarStatusD3(plan, new Date().toISOString(), (hechas, total) => setAvance({ hechas, total }));
      setResultado(r);
      if (r.cambios.size) onCorregidas?.(r.cambios);
    } catch (e) {
      console.error('No se pudo corregir el status de D3:', e);
      setError('No se pudo terminar. Presiona Revisar de nuevo para ver cuántas quedaron.');
    } finally {
      setTrabajando('');
    }
  };

  if (errorCatalogo) return <section className="csd3-panel"><p className="csd3-error" role="alert">{errorCatalogo}</p></section>;
  if (!plan) return <section className="csd3-panel"><CargandoDatos compacto texto="Buscando su status en el catálogo…" /></section>;

  const omitidas = resultado ? [...plan.omitidas, ...resultado.omitidas] : plan.omitidas;
  const omitidasPorMotivo = Array.from(omitidas
    .reduce((m, o) => m.set(o.motivo, [...(m.get(o.motivo) ?? []), o.op.ref]), new Map<string, string[]>()));
  // Lo que se va a escribir, agrupado: "3. Documentado" → "3. Documentado (Asignado)" (5).
  const resumen = Array.from(plan.corregir
    .reduce((m, c) => { const k = `${c.desde}\u0000${c.destino.nombre}`; return m.set(k, (m.get(k) ?? 0) + 1); }, new Map<string, number>()))
    .map(([k, n]) => { const [desde, hacia] = k.split('\u0000'); return { desde, hacia, n }; });

  return (
    <section className="csd3-panel" aria-labelledby="csd3-titulo">
      <h4 id="csd3-titulo" className="csd3-titulo">Corregir status</h4>
      <p className="csd3-texto">
        A cada operación se le pone el status del catálogo que le corresponde (el id y su nombre), igual que los botones de status de Operaciones.
        No cambia nada más. <b>{miles(plan.corregir.length)}</b> se corrigen
        {plan.omitidas.length > 0 ? <>; <b>{miles(plan.omitidas.length)}</b> no (abajo dice por qué)</> : ''}.
      </p>
      {resumen.length > 0 && !resultado && (
        <ul className="csd3-omitidas">
          {resumen.map((x) => <li key={`${x.desde}→${x.hacia}`}>"{x.desde}" → <b>{x.hacia}</b> ({miles(x.n)})</li>)}
        </ul>
      )}

      {resultado ? (
        <div className={`csd3-resultado${resultado.error ? ' csd3-resultado--error' : ''}`} role="status">
          <p className="csd3-resultado-titulo">
            {resultado.error ? `Se detuvo por un error: ${resultado.error}. ` : ''}
            Se corrigió el status de {miles(resultado.corregidas)} operaciones{omitidas.length > 0 ? `; ${miles(omitidas.length)} no (abajo dice por qué)` : ''}.
          </p>
          <p className="csd3-texto">
            {resultado.error
              ? 'Lo corregido antes del error ya quedó (cada tanda es todo o nada). Presiona Revisar de nuevo y vuelve a aplicar: las ya corregidas no se repiten.'
              : 'Ya salieron de la lista de D3: quedan solo las que no se corrigieron. Quedó en la bitácora.'}
          </p>
        </div>
      ) : (
        <ol className="csd3-pasos">
          <li className={`csd3-paso${prueba ? ' csd3-paso--hecho' : ''}`}>
            <button type="button" className="csd3-btn" onClick={() => { void bajarPrueba(); }} disabled={!!trabajando}>
              <FileSpreadsheet size={14} aria-hidden="true" /> 1. Descargar la prueba (Excel)
            </button>
            <span className="csd3-ayuda">Qué status se le pondría a cada operación y cómo se encontró. Revísalo antes de seguir.</span>
          </li>
          <li className={`csd3-paso${respaldo ? ' csd3-paso--hecho' : ''}`}>
            <button type="button" className="csd3-btn" onClick={bajarRespaldo} disabled={!prueba || !!trabajando}>
              <Download size={14} aria-hidden="true" /> 2. Descargar el respaldo
            </button>
            <span className="csd3-ayuda">Archivo con el status que tiene cada operación hoy, para deshacerlo si hace falta. Guárdalo.</span>
          </li>
          <li className="csd3-paso">
            <label className="csd3-autorizar" htmlFor="csd3-texto">
              3. Escribe <b>{TEXTO_AUTORIZACION}</b> para autorizar
              <input id="csd3-texto" className="csd3-input" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!respaldo || !!trabajando} autoComplete="off" />
            </label>
            <button type="button" className="csd3-btn csd3-btn--aplicar" onClick={() => { void aplicar(); }} disabled={!listo}>
              <CheckCheck size={14} aria-hidden="true" /> Corregir {miles(plan.corregir.length)} operaciones
            </button>
          </li>
        </ol>
      )}

      {trabajando && (
        <div className="csd3-avance">
          <CargandoDatos compacto texto={avance ? `${trabajando} ${miles(avance.hechas)} de ${miles(avance.total)}` : trabajando} />
          {avance && <progress className="csd3-progreso" max={Math.max(avance.total, 1)} value={avance.hechas} />}
        </div>
      )}
      {error && <p className="csd3-error" role="alert">{error}</p>}

      {omitidasPorMotivo.length > 0 && !trabajando && (
        <ul className="csd3-omitidas">
          {omitidasPorMotivo.map(([motivo, refs]) => (
            <li key={motivo}><b>{motivo}</b> ({miles(refs.length)}): {refs.slice(0, 30).join(', ')}{refs.length > 30 ? ` y ${miles(refs.length - 30)} más` : ''}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
