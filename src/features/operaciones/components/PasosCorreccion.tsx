// src/features/operaciones/components/PasosCorreccion.tsx
// ---------------------------------------------------------------------------
// ✅ V00538 — Los pasos de toda corrección de la Revisión de datos, iguales a los de F1, D3 y
// Corregir desglose (no se pueden saltar): 1) Excel de prueba, 2) respaldo, 3) si escribe sobre
// facturadas o facturas, las funciones de la V00496 ya publicadas, 4) escribir APLICAR y aplicar.
// La herramienta da lo que va en la prueba, el respaldo y cómo se aplica; aquí van los pasos, el
// avance y el resultado (cuántas se corrigieron y por qué no las demás).
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { CheckCheck, Download, FileSpreadsheet } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { descargarExcel } from '../services/excelOperaciones';
import { descargarJSON, TEXTO_AUTORIZACION } from '../services/marcarFacturadasF1';
import type { PruebaCorreccion, ResultadoCorreccion } from '../services/correccion';
import './PasosCorreccion.css';

const miles = (n: number): string => n.toLocaleString('es-MX');

interface PasosCorreccionProps {
  /** Nombre de la corrección (archivos y mensajes), p. ej. "Tomar lo de la factura". */
  nombre: string;
  /** Cuántos registros se van a escribir. */
  cantidad: number;
  /** Cómo se llaman: ['operación', 'operaciones'] o ['factura', 'facturas']. */
  unidad: readonly [string, string];
  /** Qué trae el Excel de prueba (una línea). */
  ayudaPrueba: string;
  /** Qué guarda el respaldo (una línea). */
  ayudaRespaldo: string;
  /** Escribe sobre operaciones facturadas o facturas: pide confirmar las funciones de la V00496. */
  pideFunciones?: boolean;
  armarPrueba: () => PruebaCorreccion;
  armarRespaldo: (cuando: string) => unknown;
  aplicar: (cuando: string, alAvanzar: (hechas: number, total: number) => void) => Promise<ResultadoCorreccion>;
  onAplicado?: (r: ResultadoCorreccion) => void;
}

const archivo = (nombre: string): string => nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_');

const PasosCorreccion = ({ nombre, cantidad, unidad, ayudaPrueba, ayudaRespaldo, pideFunciones = false, armarPrueba, armarRespaldo, aplicar, onAplicado }: PasosCorreccionProps) => {
  const [prueba, setPrueba] = useState(false);
  const [respaldo, setRespaldo] = useState(false);
  const [funciones, setFunciones] = useState(!pideFunciones);
  const [texto, setTexto] = useState('');
  const [trabajando, setTrabajando] = useState('');
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<ResultadoCorreccion | null>(null);
  const [error, setError] = useState('');

  const estaAutorizado = texto.trim().toUpperCase() === TEXTO_AUTORIZACION;
  const puedeAplicar = prueba && respaldo && funciones && estaAutorizado && cantidad > 0 && !trabajando && !resultado;
  const [singular, plural] = unidad;

  const bajarPrueba = async () => {
    setTrabajando('Armando el Excel de prueba…');
    setError('');
    try {
      const { filas, columnasMoneda } = armarPrueba();
      await descargarExcel({ filas, columnasMoneda }, 'Prueba', `Prueba_${archivo(nombre)}_${hoyLocalISO()}.xlsx`);
      setPrueba(true);
    } catch (e) {
      console.error(`No se pudo armar el Excel de prueba de ${nombre}:`, e);
      setError('No se pudo armar el Excel de prueba. Intenta de nuevo.');
    } finally {
      setTrabajando('');
    }
  };

  const bajarRespaldo = () => {
    descargarJSON(armarRespaldo(new Date().toISOString()), `Respaldo_antes_de_${archivo(nombre)}_${hoyLocalISO()}.json`);
    setRespaldo(true);
  };

  const ejecutar = async () => {
    if (!puedeAplicar) return;
    setTrabajando(`${nombre}…`);
    setError('');
    try {
      const r = await aplicar(new Date().toISOString(), (hechas, total) => setAvance({ hechas, total }));
      setResultado(r);
      onAplicado?.(r);
    } catch (e) {
      console.error(`No se pudo aplicar ${nombre}:`, e);
      setError('No se pudo terminar. Presiona Revisar de nuevo para ver cuántas quedaron.');
    } finally {
      setTrabajando('');
    }
  };

  if (resultado) {
    return (
      <div className={`pco-resultado${resultado.error ? ' pco-resultado--error' : ''}`} role="status">
        <p className="pco-resultado-titulo">
          {resultado.error ? `Se detuvo por un error: ${resultado.error}. ` : ''}
          {nombre}: {miles(resultado.hechas)} {resultado.hechas === 1 ? singular : plural} corregid{resultado.hechas === 1 ? 'a' : 'as'}
          {resultado.omitidas.length > 0 ? `; ${miles(resultado.omitidas.length)} no (abajo dice por qué)` : ''}.
        </p>
        <p className="pco-texto">
          {resultado.error
            ? 'Lo corregido antes del error ya quedó (cada tanda es todo o nada). Presiona Revisar de nuevo y vuelve a aplicar: lo ya corregido no se repite.'
            : 'Quedó en la bitácora. Las pantallas abiertas ya lo muestran.'}
        </p>
        {resultado.omitidas.length > 0 && (
          <ul className="pco-omitidas">
            {resultado.omitidas.slice(0, 100).map((o) => <li key={o.id}><b>{o.ref}</b>: {o.motivo}</li>)}
          </ul>
        )}
      </div>
    );
  }

  return (
    <>
      <ol className="pco-pasos">
        <li className={`pco-paso${prueba ? ' pco-paso--hecho' : ''}`}>
          <button type="button" className="pco-btn" onClick={() => { void bajarPrueba(); }} disabled={!!trabajando}>
            <FileSpreadsheet size={14} aria-hidden="true" /> 1. Descargar la prueba (Excel)
          </button>
          <span className="pco-ayuda">{ayudaPrueba}</span>
        </li>
        <li className={`pco-paso${respaldo ? ' pco-paso--hecho' : ''}`}>
          <button type="button" className="pco-btn" onClick={bajarRespaldo} disabled={!prueba || !!trabajando || cantidad === 0}>
            <Download size={14} aria-hidden="true" /> 2. Descargar el respaldo
          </button>
          <span className="pco-ayuda">{ayudaRespaldo}</span>
        </li>
        {pideFunciones && (
          <li className={`pco-paso${funciones ? ' pco-paso--hecho' : ''}`}>
            <label className="pco-check">
              <input type="checkbox" checked={funciones} onChange={(e) => setFunciones(e.target.checked)} disabled={!respaldo || !!trabajando} />
              3. Las funciones del servidor ya están publicadas con la V00496 o una más nueva
            </label>
            <span className="pco-ayuda">Con las de antes, cada operación facturada que se corrige volvería a calcular su factura emitida.</span>
          </li>
        )}
        <li className="pco-paso">
          <label className="pco-autorizar">
            {pideFunciones ? 4 : 3}. Escribe <b>{TEXTO_AUTORIZACION}</b> para autorizar
            <input className="pco-input" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!respaldo || !funciones || !!trabajando} autoComplete="off" />
          </label>
          <button type="button" className="pco-btn pco-btn--aplicar" onClick={() => { void ejecutar(); }} disabled={!puedeAplicar}>
            <CheckCheck size={14} aria-hidden="true" /> Corregir {miles(cantidad)} {cantidad === 1 ? singular : plural}
          </button>
        </li>
      </ol>
      {trabajando && (
        <div className="pco-avance">
          <CargandoDatos compacto texto={avance ? `${trabajando} ${miles(avance.hechas)} de ${miles(avance.total)}. No cierres esta ventana.` : trabajando} />
          {avance && <progress className="pco-progreso" max={Math.max(avance.total, 1)} value={avance.hechas} />}
        </div>
      )}
      {error && <p className="pco-error" role="alert">{error}</p>}
    </>
  );
};

export default PasosCorreccion;
