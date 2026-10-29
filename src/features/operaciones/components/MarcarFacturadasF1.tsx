// src/features/operaciones/components/MarcarFacturadasF1.tsx
// ---------------------------------------------------------------------------
// ✅ V00510 — Corrección F1 dentro de la Revisión de datos: "Marcar facturadas" en tres pasos que no
// se pueden saltar: 1) Excel de prueba, 2) respaldo, 3) autorización escrita (APLICAR) y aplicar.
// La regla y la escritura están en services/marcarFacturadasF1.ts.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { CheckCheck, Download, FileSpreadsheet } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { auth } from '../../../config/firebase';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { descargarExcel } from '../services/excelOperaciones';
import { aplicarMarcasF1, descargarJSON, filasPruebaF1, planMarcarF1, respaldoF1, TEXTO_AUTORIZACION } from '../services/marcarFacturadasF1';
import type { PlanF1, ResultadoF1 } from '../services/marcarFacturadasF1';
import type { MarcaF1 } from '../services/revisionDatos';
import './MarcarFacturadasF1.css';

const miles = (n: number): string => n.toLocaleString('es-MX');

interface Props {
  marcas: readonly MarcaF1[];
  /** ✅ V00512: las que se marcaron, para quitarlas de la revisión al momento. */
  onMarcadas?: (ids: readonly string[], cuando: string) => void;
}

export default function MarcarFacturadasF1({ marcas, onMarcadas }: Props) {
  // ✅ V00512: la revisión se actualiza sola; el plan se CONGELA al bajar la prueba, para que lo que
  //   se aplica sea exactamente lo de la prueba y el respaldo (al aplicar se relee cada una).
  const [congelado, setCongelado] = useState<PlanF1 | null>(null);
  const plan = congelado ?? planMarcarF1(marcas);
  const [prueba, setPrueba] = useState(false);
  const [respaldo, setRespaldo] = useState(false);
  const [texto, setTexto] = useState('');
  const [trabajando, setTrabajando] = useState('');
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<ResultadoF1 | null>(null);
  const [error, setError] = useState('');
  const autorizado = texto.trim().toUpperCase() === TEXTO_AUTORIZACION;
  const listo = prueba && respaldo && autorizado && plan.marcar.length > 0 && !trabajando && !resultado;

  const bajarPrueba = async () => {
    setTrabajando('Armando el Excel de prueba…');
    setError('');
    try {
      await descargarExcel({ filas: filasPruebaF1(plan), columnasMoneda: [] }, 'Prueba F1', `Prueba_F1_marcar_facturadas_${hoyLocalISO()}.xlsx`);
      setCongelado(plan);
      setPrueba(true);
    } catch (e) {
      console.error('No se pudo armar el Excel de prueba de F1:', e);
      setError('No se pudo armar el Excel de prueba. Intenta de nuevo.');
    } finally {
      setTrabajando('');
    }
  };

  const bajarRespaldo = () => {
    descargarJSON(respaldoF1(plan, new Date().toISOString(), auth.currentUser?.email || ''), `Respaldo_F1_antes_de_marcar_${hoyLocalISO()}.json`);
    setRespaldo(true);
  };

  const aplicar = async () => {
    if (!listo) return;
    setTrabajando('Marcando operaciones…');
    setError('');
    try {
      const cuando = new Date().toISOString();
      const r = await aplicarMarcasF1(plan, cuando, (hechas, total) => setAvance({ hechas, total }));
      setResultado(r);
      if (r.marcadasIds.length) onMarcadas?.(r.marcadasIds, cuando);
    } catch (e) {
      console.error('No se pudieron marcar las operaciones de F1:', e);
      setError('No se pudo terminar. Presiona Revisar de nuevo para ver cuántas quedaron.');
    } finally {
      setTrabajando('');
    }
  };

  // Las que el plan deja fuera y, después de aplicar, también las que cambiaron mientras tanto.
  const omitidas = resultado ? [...plan.omitidas, ...resultado.omitidas] : plan.omitidas;
  const omitidasPorMotivo = Array.from(omitidas
    .reduce((m, o) => m.set(o.motivo, [...(m.get(o.motivo) ?? []), o.marca.ref]), new Map<string, string[]>()));

  return (
    <section className="mf1-panel" aria-labelledby="mf1-titulo">
      <h4 id="mf1-titulo" className="mf1-titulo">Marcar como facturadas</h4>
      <p className="mf1-texto">
        A cada operación se le pone el Invoice y la marca de facturada de la factura que la lista, lo mismo que hace Facturación al facturar.
        No cambia montos, facturas ni pagos. <b>{miles(plan.marcar.length)}</b> se marcan
        {plan.omitidas.length > 0 ? <>; <b>{miles(plan.omitidas.length)}</b> no (abajo dice por qué)</> : ''}.
      </p>

      {resultado ? (
        <div className={`mf1-resultado${resultado.error ? ' mf1-resultado--error' : ''}`} role="status">
          <p className="mf1-resultado-titulo">
            {resultado.error ? `Se detuvo por un error: ${resultado.error}. ` : ''}
            Se marcaron {miles(resultado.marcadas)} operaciones{omitidas.length > 0 ? `; ${miles(omitidas.length)} no (abajo dice por qué)` : ''}.
          </p>
          <p className="mf1-texto">
            {resultado.error
              ? 'Lo marcado antes del error ya quedó (cada tanda es todo o nada). Presiona Revisar de nuevo y vuelve a aplicar: las ya marcadas no se repiten.'
              : 'Ya salieron de la lista de F1: quedan solo las que no se marcaron. Quedó en la bitácora.'}
          </p>
        </div>
      ) : (
        <ol className="mf1-pasos">
          <li className={`mf1-paso${prueba ? ' mf1-paso--hecho' : ''}`}>
            <button type="button" className="mf1-btn" onClick={() => { void bajarPrueba(); }} disabled={!!trabajando}>
              <FileSpreadsheet size={14} aria-hidden="true" /> 1. Descargar la prueba (Excel)
            </button>
            <span className="mf1-ayuda">Qué se le escribiría a cada operación. Revísalo antes de seguir.</span>
          </li>
          <li className={`mf1-paso${respaldo ? ' mf1-paso--hecho' : ''}`}>
            <button type="button" className="mf1-btn" onClick={bajarRespaldo} disabled={!prueba || !!trabajando}>
              <Download size={14} aria-hidden="true" /> 2. Descargar el respaldo
            </button>
            <span className="mf1-ayuda">Archivo con lo que tiene cada operación hoy, para deshacerlo si hace falta. Guárdalo.</span>
          </li>
          <li className="mf1-paso">
            <label className="mf1-autorizar" htmlFor="mf1-texto">
              3. Escribe <b>{TEXTO_AUTORIZACION}</b> para autorizar
              <input id="mf1-texto" className="mf1-input" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!respaldo || !!trabajando} autoComplete="off" />
            </label>
            <button type="button" className="mf1-btn mf1-btn--aplicar" onClick={() => { void aplicar(); }} disabled={!listo}>
              <CheckCheck size={14} aria-hidden="true" /> Marcar {miles(plan.marcar.length)} operaciones
            </button>
          </li>
        </ol>
      )}

      {trabajando && (
        <div className="mf1-avance">
          <CargandoDatos compacto texto={avance ? `${trabajando} ${miles(avance.hechas)} de ${miles(avance.total)}` : trabajando} />
          {avance && <progress className="mf1-progreso" max={Math.max(avance.total, 1)} value={avance.hechas} />}
        </div>
      )}
      {error && <p className="mf1-error" role="alert">{error}</p>}

      {omitidasPorMotivo.length > 0 && !trabajando && (
        <ul className="mf1-omitidas">
          {omitidasPorMotivo.map(([motivo, refs]) => (
            <li key={motivo}><b>{motivo}</b> ({miles(refs.length)}): {refs.slice(0, 30).join(', ')}{refs.length > 30 ? ` y ${miles(refs.length - 30)} más` : ''}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
