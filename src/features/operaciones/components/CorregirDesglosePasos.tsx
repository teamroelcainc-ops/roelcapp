// src/features/operaciones/components/CorregirDesglosePasos.tsx
// ---------------------------------------------------------------------------
// ✅ V00532 — Los pasos de "Corregir desglose", los mismos de F1 y D3 (no se pueden saltar):
// 1) Excel de prueba, 2) respaldo, 3) las funciones V00496 ya publicadas + autorización escrita
// (APLICAR) y aplicar. Lo que se aplica es exactamente la lista de la revisión (se congela al abrir);
// cada operación se relee al escribir y, si cambió desde entonces, se salta y se dice por qué.
// Los estilos están en CorregirDesgloseModal.css (prefijo cdg-), que importa la ventana.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { CheckCheck, Download, FileSpreadsheet } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { auth } from '../../../config/firebase';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { filasPruebaDesglose, respaldoDesglose } from '../services/corregirDesglose';
import type { RevisionDesglose } from '../services/corregirDesglose';
import { aplicarDesglose } from '../services/corregirDesgloseDatos';
import type { ResultadoDesglose } from '../services/corregirDesgloseDatos';
import { descargarExcel } from '../services/excelOperaciones';
import { descargarJSON, TEXTO_AUTORIZACION } from '../services/marcarFacturadasF1';

const miles = (n: number): string => n.toLocaleString('es-MX');
const COLUMNAS_MONEDA = ['Total antes', 'Total después', 'Dólares antes', 'Dólares después', 'Pesos antes', 'Pesos después', 'Conversión MXN (no cambia)'];

interface Props {
  revisiones: readonly RevisionDesglose[];
  /** Avisa a la ventana que se está escribiendo (no se puede cerrar). */
  onTrabajando: (si: boolean) => void;
}

export default function CorregirDesglosePasos({ revisiones, onTrabajando }: Props) {
  const [prueba, setPrueba] = useState(false);
  const [respaldo, setRespaldo] = useState(false);
  const [funciones, setFunciones] = useState(false);
  const [texto, setTexto] = useState('');
  const [trabajando, setTrabajando] = useState('');
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<ResultadoDesglose | null>(null);
  const [error, setError] = useState('');

  const autorizado = texto.trim().toUpperCase() === TEXTO_AUTORIZACION;
  const listo = prueba && respaldo && funciones && autorizado && revisiones.length > 0 && !trabajando && !resultado;

  const bajarPrueba = async () => {
    setTrabajando('Armando el Excel de prueba…');
    setError('');
    try {
      await descargarExcel({ filas: filasPruebaDesglose(revisiones), columnasMoneda: COLUMNAS_MONEDA }, 'Prueba desglose', `Prueba_corregir_desglose_${hoyLocalISO()}.xlsx`);
      setPrueba(true);
    } catch (e) {
      console.error('No se pudo armar el Excel de prueba de Corregir desglose:', e);
      setError('No se pudo armar el Excel de prueba. Intenta de nuevo.');
    } finally {
      setTrabajando('');
    }
  };

  const bajarRespaldo = () => {
    descargarJSON(respaldoDesglose(revisiones, new Date().toISOString(), auth.currentUser?.email || ''), `Respaldo_antes_de_corregir_desglose_${hoyLocalISO()}.json`);
    setRespaldo(true);
  };

  const aplicar = async () => {
    if (!listo) return;
    setTrabajando('Corrigiendo el desglose…');
    onTrabajando(true);
    setError('');
    try {
      setResultado(await aplicarDesglose(revisiones, new Date().toISOString(), (hechas, total) => setAvance({ hechas, total })));
    } catch (e) {
      console.error('No se pudo corregir el desglose:', e);
      setError('No se pudo terminar. Cierra y vuelve a abrir Corregir desglose para ver cuántas quedaron.');
    } finally {
      setTrabajando('');
      onTrabajando(false);
    }
  };

  if (resultado) {
    return (
      <div className={`cdg-resultado${resultado.error ? ' cdg-resultado--error' : ''}`} role="status">
        <p className="cdg-resultado-titulo">
          {resultado.error ? `Se detuvo por un error: ${resultado.error}. ` : ''}
          Se corrigió el desglose de {miles(resultado.corregidas)} operaciones{resultado.omitidas.length > 0 ? `; ${miles(resultado.omitidas.length)} no (abajo dice por qué)` : ''}.
        </p>
        <p className="cdg-texto">
          {resultado.error
            ? 'Lo corregido antes del error ya quedó (cada tanda de 100 es todo o nada). Cierra y vuelve a abrir para corregir las que faltan: las ya corregidas no se repiten.'
            : 'Quedó en la bitácora. Las listas que ya estaban abiertas lo muestran al presionar Actualizar o Buscar.'}
        </p>
        {resultado.omitidas.length > 0 && (
          <ul className="cdg-omitidas">
            {resultado.omitidas.slice(0, 100).map((o) => <li key={o.id}><b>{o.ref}</b>: {o.motivo}</li>)}
          </ul>
        )}
      </div>
    );
  }

  return (
    <>
      <ol className="cdg-pasos">
        <li className={`cdg-paso${prueba ? ' cdg-paso--hecho' : ''}`}>
          <button type="button" className="cdg-btn" onClick={() => { void bajarPrueba(); }} disabled={!!trabajando || revisiones.length === 0}>
            <FileSpreadsheet size={14} aria-hidden="true" /> 1. Descargar la prueba (Excel)
          </button>
          <span className="cdg-ayuda">Cada operación con su Total, Dólares y Pesos de antes y de después. Revísalo antes de seguir.</span>
        </li>
        <li className={`cdg-paso${respaldo ? ' cdg-paso--hecho' : ''}`}>
          <button type="button" className="cdg-btn" onClick={bajarRespaldo} disabled={!prueba || !!trabajando}>
            <Download size={14} aria-hidden="true" /> 2. Descargar el respaldo
          </button>
          <span className="cdg-ayuda">Archivo con los montos que tiene cada operación hoy, para deshacerlo si hace falta. Guárdalo.</span>
        </li>
        <li className={`cdg-paso${funciones ? ' cdg-paso--hecho' : ''}`}>
          <label className="cdg-check">
            <input type="checkbox" checked={funciones} onChange={(e) => setFunciones(e.target.checked)} disabled={!respaldo || !!trabajando} />
            3. Las funciones del servidor ya están publicadas con la V00496 o una más nueva
          </label>
          <span className="cdg-ayuda">Con las de antes, cada operación facturada que se corrige volvería a calcular su factura emitida.</span>
        </li>
        <li className="cdg-paso">
          <label className="cdg-autorizar" htmlFor="cdg-texto">
            4. Escribe <b>{TEXTO_AUTORIZACION}</b> para autorizar
            <input id="cdg-texto" className="cdg-input" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!funciones || !!trabajando} autoComplete="off" />
          </label>
          <button type="button" className="cdg-btn cdg-btn--aplicar" onClick={() => { void aplicar(); }} disabled={!listo}>
            <CheckCheck size={14} aria-hidden="true" /> Corregir {miles(revisiones.length)} operaci{revisiones.length === 1 ? 'ón' : 'ones'}
          </button>
        </li>
      </ol>
      {trabajando && (
        <div className="cdg-avance">
          <CargandoDatos compacto texto={avance ? `${trabajando} ${miles(avance.hechas)} de ${miles(avance.total)}. No cierres esta pestaña.` : trabajando} />
          {avance && <progress className="cdg-progreso" max={Math.max(avance.total, 1)} value={avance.hechas} />}
        </div>
      )}
      {error && <p className="cdg-error" role="alert">{error}</p>}
    </>
  );
}
