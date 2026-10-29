// src/features/operaciones/components/RevisionDatosModal.tsx
// ---------------------------------------------------------------------------
// ✅ V00505 — "Revisión de datos" (barra de Operaciones). SOLO LECTURA: no lee nada hasta que el
// usuario presiona Revisar; entonces recorre operaciones y facturas de clientes (con avance) y lista
// cada error del reporte del 27-oct por grupo, con un botón para abrir cada registro y un Excel.
// La regla está en services/revisionDatos.ts y las lecturas en services/revisionDatosLectura.ts.
// ✅ V00512: rango de fechas (filtra lo que se ve, sin volver a leer), Cancelar mientras lee, y la
// lista AL DÍA: lo que se corrige (abierto desde aquí o guardado en la app) se vuelve a revisar solo
// y deja de mostrarse.
// ---------------------------------------------------------------------------
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, FileSpreadsheet, RefreshCw, X } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { abrirRegistro } from '../../../shared/data/aperturas';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { descargarExcel } from '../services/excelOperaciones';
import { camposMarca } from '../services/marcarFacturadasF1';
import { GRUPOS_REVISION, filasExcelRevision, filtrarPorFechas } from '../services/revisionDatos';
import type { CodigoRevision, DestinoRevision, FilaRevision } from '../services/revisionDatos';
import {
  aplicarCambiosLocales, guardarRangoRevisionDatos, hayPendientesRevision, leerYRevisarDatos, marcarParaRevisar,
  rangoRevisionDatos, refrescarRevisionDatos, RevisionCancelada, suscribirPendientesRevision, ultimaRevisionDatos,
} from '../services/revisionDatosLectura';
import MarcarFacturadasF1 from './MarcarFacturadasF1'; // ✅ V00510
import CorregirStatusD3 from './CorregirStatusD3'; // ✅ V00517
import type { AvanceRevisionDatos, Refresco, RevisionGuardada, SenalRevision } from '../services/revisionDatosLectura';
import './RevisionDatosModal.css';

const POR_PAGINA = 100;
const miles = (n: number): string => n.toLocaleString('es-MX');
const hora = (d: Date): string => d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const soloHora = (d: Date): string => d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

const textoRefresco = (r: Refresco): string => {
  const dif = r.antes - r.despues;
  const cambio = dif > 0 ? `${miles(dif)} ${dif === 1 ? 'error menos' : 'errores menos'}` : dif < 0 ? `${miles(-dif)} ${dif === -1 ? 'error nuevo' : 'errores nuevos'}` : 'sin cambios en los errores';
  return `Al día (${soloHora(r.revisada.actualizada ?? new Date())}): se volvieron a revisar ${miles(r.registros)} ${r.registros === 1 ? 'registro que cambió' : 'registros que cambiaron'} · ${cambio}.`;
};

function Fila({ f, onAbrir }: { f: FilaRevision; onAbrir: (d: DestinoRevision) => void }) {
  return (
    <li className="rvd-fila">
      <div className="rvd-fila-datos">
        <span className="rvd-ref">{f.ref}</span>
        <span className="rvd-meta">{[f.cliente, f.fecha || 'sin fecha', f.status, f.invoice && `Invoice ${f.invoice}`].filter(Boolean).join(' · ')}</span>
        <span className="rvd-detalle">{f.detalle}</span>
      </div>
      <div className="rvd-fila-acciones">
        <button type="button" className="rvd-abrir" onClick={() => onAbrir(f.destino)} title="Abrir su ficha en su módulo">
          <ExternalLink size={13} aria-hidden="true" /> Abrir
        </button>
        {f.enlaces.map((e) => (
          <button type="button" key={`${e.destino.modulo}:${e.destino.id}`} className="rvd-enlace" onClick={() => onAbrir(e.destino)}>{e.texto}</button>
        ))}
      </div>
    </li>
  );
}

export default function RevisionDatosModal({ onCerrar }: { onCerrar: () => void }) {
  const [revision, setRevision] = useState<RevisionGuardada | null>(() => ultimaRevisionDatos());
  const [revisando, setRevisando] = useState(false);
  const [avance, setAvance] = useState<AvanceRevisionDatos | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [grupo, setGrupo] = useState<CodigoRevision>('F4');
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [exportando, setExportando] = useState(false);
  const [rango, setRango] = useState(() => rangoRevisionDatos());
  const [actualizando, setActualizando] = useState(false);
  const [pulso, setPulso] = useState(0);
  const [f1Aplicado, setF1Aplicado] = useState(false);
  const [d3Aplicado, setD3Aplicado] = useState(false); // ✅ V00517
  const senalRef = useRef<SenalRevision | null>(null);

  const revisar = async () => {
    const senal: SenalRevision = { cancelada: false };
    senalRef.current = senal;
    setRevisando(true);
    setError('');
    setAviso('');
    setAvance(null);
    try {
      const r = await leerYRevisarDatos(setAvance, senal);
      if (senal.cancelada) return;
      setRevision(r);
      setF1Aplicado(false);
      const v = filtrarPorFechas(r.resultado, rango.desde, rango.hasta);
      setGrupo(GRUPOS_REVISION.find((g) => v.conteo[g.codigo] > 0)?.codigo ?? 'F4');
      setMostrar(POR_PAGINA);
    } catch (e) {
      if (senal.cancelada || e instanceof RevisionCancelada) return;
      console.error('No se pudo hacer la revisión de datos:', e);
      setError('No se pudieron leer las operaciones, las facturas, Empresas o el catálogo de status. Revisa la conexión e intenta de nuevo.');
    } finally {
      if (senalRef.current === senal) setRevisando(false);
    }
  };

  // ✅ V00512: Cancelar regresa al momento (lo que ya se pidió termina solo y se descarta).
  const cancelar = () => {
    if (senalRef.current) senalRef.current.cancelada = true;
    senalRef.current = null;
    setRevisando(false);
    setAvance(null);
    setAviso(revision ? 'Revisión cancelada: se queda la anterior.' : 'Revisión cancelada.');
  };

  // ✅ V00512: al abrir la ventana y cada vez que la app avisa que algo cambió, se revisa de nuevo
  //   solo lo que cambió (unas cuantas lecturas) y se recalcula.
  const refrescar = useEffectEvent(async () => {
    if (revisando || actualizando || !hayPendientesRevision()) return;
    setActualizando(true);
    let ok = false;
    try {
      const r = await refrescarRevisionDatos();
      if (r) { setRevision(r.revisada); setAviso(textoRefresco(r)); }
      ok = true;
    } catch (e) {
      console.error('No se pudieron volver a revisar los registros que cambiaron:', e);
      setAviso('No se pudieron volver a leer los registros que cambiaron. Se intenta otra vez al reabrir la ventana (o usa Revisar de nuevo).');
    } finally {
      setActualizando(false);
      // Lo que llegó mientras se actualizaba (si falló, se reintenta al reabrir: no en bucle).
      if (ok && hayPendientesRevision()) setPulso((n) => n + 1);
    }
  });
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const baja = suscribirPendientesRevision(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => setPulso((n) => n + 1), 600);
    });
    return () => { baja(); if (t) clearTimeout(t); };
  }, []);
  useEffect(() => { void refrescar(); }, [pulso, revisando]);

  const abrir = (d: DestinoRevision) => {
    marcarParaRevisar(d); // ✅ V00512: al volver, se revisa de nuevo
    onCerrar();
    abrirRegistro(d.modulo, d.id);
  };

  const cambiarRango = (campo: 'desde' | 'hasta', valor: string) => {
    const nuevo = { ...rango, [campo]: valor };
    setRango(nuevo);
    guardarRangoRevisionDatos(nuevo);
    setMostrar(POR_PAGINA);
  };
  const quitarRango = () => { const nuevo = { desde: '', hasta: '' }; setRango(nuevo); guardarRangoRevisionDatos(nuevo); setMostrar(POR_PAGINA); };

  const r = revision?.resultado ?? null;
  const vista = r ? filtrarPorFechas(r, rango.desde, rango.hasta) : null;
  const conRango = !!(rango.desde || rango.hasta);
  const rangoInvertido = !!(rango.desde && rango.hasta && rango.desde > rango.hasta);

  const exportar = async () => {
    if (!vista) return;
    setExportando(true);
    try {
      await descargarExcel({ filas: filasExcelRevision(vista), columnasMoneda: [] }, 'Revisión', `Revision_datos_${hoyLocalISO()}.xlsx`);
    } catch (e) {
      console.error('No se pudo armar el Excel de la revisión:', e);
      setError('No se pudo armar el Excel. Intenta de nuevo.');
    } finally {
      setExportando(false);
    }
  };

  // ✅ V00512: las marcadas en F1 salen de la lista al momento (sin volver a leer).
  const alMarcarF1 = (ids: readonly string[], cuando: string) => {
    if (!r) return;
    const porId = new Map(r.marcasF1.map((m) => [m.opId, m] as const));
    const cambios = new Map<string, Record<string, unknown>>();
    ids.forEach((id) => { const m = porId.get(id); if (m) cambios.set(id, camposMarca(m, cuando)); });
    const nueva = aplicarCambiosLocales(cambios);
    if (nueva) setRevision(nueva);
    setF1Aplicado(true);
  };

  // ✅ V00517: las corregidas en D3 salen de la lista al momento (ya se sabe qué se escribió).
  const alCorregirD3 = (cambios: ReadonlyMap<string, Record<string, unknown>>) => {
    const nueva = aplicarCambiosLocales(cambios);
    if (nueva) setRevision(nueva);
    setD3Aplicado(true);
  };

  const elegido = GRUPOS_REVISION.find((g) => g.codigo === grupo) ?? GRUPOS_REVISION[0];
  const filas = vista ? vista.filas.filter((f) => f.codigo === grupo) : [];
  const elegir = (codigo: CodigoRevision) => { setGrupo(codigo); setMostrar(POR_PAGINA); };

  return createPortal(
    <div className="modal-overlay rvd-fondo" role="dialog" aria-modal="true" aria-labelledby="rvd-titulo">
      <div className="rvd-ventana">
        <header className="rvd-cabecera">
          <div>
            <h2 id="rvd-titulo" className="rvd-titulo">Revisión de datos</h2>
            <p className="rvd-sub">
              Revisa todas las operaciones y las facturas de clientes y lista los errores por grupo. Solo lee: no cambia nada.
              Abre cada registro para corregirlo en su módulo: al volver, lo corregido ya no aparece.
            </p>
          </div>
          <button type="button" className="rvd-cerrar" onClick={onCerrar} disabled={revisando} aria-label="Cerrar">✕</button>
        </header>

        <div className="rvd-barra">
          {revisando ? (
            <button type="button" className="rvd-btn rvd-btn--cancelar" onClick={cancelar}>
              <X size={14} aria-hidden="true" /> Cancelar revisión
            </button>
          ) : (
            <button type="button" className="rvd-btn rvd-btn--principal" onClick={revisar}>
              <RefreshCw size={14} aria-hidden="true" /> {r ? 'Revisar de nuevo' : 'Revisar'}
            </button>
          )}
          <button type="button" className="rvd-btn" onClick={exportar} disabled={!vista || revisando || exportando}>
            <FileSpreadsheet size={14} aria-hidden="true" /> {exportando ? 'Armando el Excel…' : 'Excel'}
          </button>
          <fieldset className="rvd-rango">
            <legend className="rvd-rango-titulo">Fechas</legend>
            <label className="rvd-rango-campo">Desde
              <input type="date" className="rvd-fecha" value={rango.desde} max={rango.hasta || undefined} onChange={(e) => cambiarRango('desde', e.target.value)} />
            </label>
            <label className="rvd-rango-campo">Hasta
              <input type="date" className="rvd-fecha" value={rango.hasta} min={rango.desde || undefined} onChange={(e) => cambiarRango('hasta', e.target.value)} />
            </label>
            {conRango && <button type="button" className="rvd-btn rvd-btn--chico" onClick={quitarRango}>Todas las fechas</button>}
          </fieldset>
          {revision && !revisando && (
            <span className="rvd-resumen">
              {miles(r?.operaciones ?? 0)} operaciones y {miles(r?.facturas ?? 0)} facturas revisadas el {hora(revision.en)}
              {actualizando && <> · <CargandoDatos enLinea texto="Actualizando" /></>}
            </span>
          )}
        </div>

        <div className="rvd-cuerpo">
          {error && <p className="rvd-error" role="alert">{error}</p>}
          {aviso && !revisando && <p className="rvd-aviso" role="status">{aviso}</p>}
          {rangoInvertido && <p className="rvd-error" role="alert">La fecha Desde es posterior a Hasta: no hay nada en ese rango.</p>}
          {revisando && (
            <div className="rvd-avance">
              <CargandoDatos compacto texto={avance ? `Leyendo operaciones… ${miles(avance.leidas)} de ${miles(avance.total)}` : 'Contando operaciones…'} />
              {avance && <progress className="rvd-progreso" max={Math.max(avance.total, 1)} value={avance.leidas} />}
            </div>
          )}
          {!revisando && !r && !error && (
            <p className="rvd-vacio">Presiona Revisar. Lee todas las operaciones (tarda unos segundos y avisa cuántas lleva) y las facturas de clientes. Con fechas, se muestran solo los errores de ese rango.</p>
          )}
          {!revisando && r && vista && (
            <div className="rvd-resultado">
              <ul className="rvd-grupos" aria-label="Grupos de errores">
                {GRUPOS_REVISION.map((g) => (
                  <li key={g.codigo}>
                    <button type="button" onClick={() => elegir(g.codigo)} aria-pressed={g.codigo === grupo}
                      className={`rvd-grupo rvd-grupo--${g.prioridad.toLowerCase()}${g.codigo === grupo ? ' rvd-grupo--activo' : ''}${vista.conteo[g.codigo] === 0 ? ' rvd-grupo--cero' : ''}`}>
                      <span className="rvd-grupo-codigo">{g.codigo}</span>
                      <span className="rvd-grupo-titulo">{g.titulo}</span>
                      <span className="rvd-grupo-cuenta">{miles(vista.conteo[g.codigo])}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <section className="rvd-detalle-grupo" aria-labelledby="rvd-titulo-grupo">
                <h3 id="rvd-titulo-grupo" className="rvd-titulo-grupo">
                  {elegido.titulo} <span className={`rvd-prioridad rvd-prioridad--${elegido.prioridad.toLowerCase()}`}>{elegido.prioridad}</span>
                </h3>
                <p className="rvd-correccion">
                  {miles(filas.length)} {elegido.codigo === 'F2' || elegido.codigo === 'F2c' ? (filas.length === 1 ? 'factura' : 'facturas') : (filas.length === 1 ? 'operación' : 'operaciones')}
                  {conRango ? ' en el rango' : ''}
                  {elegido.codigo === 'D2' && r.referenciasRepetidas > 0 && !conRango ? ` (${miles(r.referenciasRepetidas)} referencias)` : ''}. {elegido.correccion}
                </p>
                {conRango && vista.sinFecha > 0 && (
                  <p className="rvd-nota">{miles(vista.sinFecha)} {vista.sinFecha === 1 ? 'error no tiene fecha' : 'errores no tienen fecha'} y no entran en el rango (con Todas las fechas se ven).</p>
                )}
                {/* ✅ V00510: corrección de F1 (prueba → respaldo → autorización → aplicar). V00512: con el rango
                    elegido; cambiar el rango vuelve a pedir la prueba. */}
                {elegido.codigo === 'F1' && (vista.marcasF1.length > 0 || f1Aplicado) && (
                  <MarcarFacturadasF1 key={`${revision?.en.getTime()}|${rango.desde}|${rango.hasta}`} marcas={vista.marcasF1} onMarcadas={alMarcarF1} />
                )}
                {/* ✅ V00517: corrección de D3 (status con otro nombre o con el nombre viejo), mismos pasos que F1 */}
                {elegido.codigo === 'D3' && (vista.statusD3.length > 0 || d3Aplicado) && (
                  <CorregirStatusD3 key={`${revision?.en.getTime()}|${rango.desde}|${rango.hasta}`} ops={vista.statusD3} onCorregidas={alCorregirD3} />
                )}
                {(elegido.codigo === 'F2' || elegido.codigo === 'F4' || elegido.codigo === 'F1') && r.sinLigar > 0 && (
                  <p className="rvd-nota">
                    {miles(r.sinLigar)} renglones de facturas no se pudieron ligar a una operación (no existe, es de prueba o su referencia está repetida).
                  </p>
                )}
                {filas.length === 0 ? (
                  <p className="rvd-vacio">Sin errores en este grupo{conRango ? ' en el rango' : ''}.</p>
                ) : (
                  <>
                    <ul className="rvd-filas">
                      {filas.slice(0, mostrar).map((f) => <Fila key={f.clave} f={f} onAbrir={abrir} />)}
                    </ul>
                    {filas.length > mostrar && (
                      <button type="button" className="rvd-btn rvd-mas" onClick={() => setMostrar((m) => m + POR_PAGINA)}>
                        Mostrar {miles(Math.min(POR_PAGINA, filas.length - mostrar))} más ({miles(filas.length - mostrar)} restantes)
                      </button>
                    )}
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
