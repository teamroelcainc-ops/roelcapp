// src/features/puentes/components/PanelReporteAvi.tsx
// ✅ V00464: resultado de cargar el reporte del puente AVI en "Operaciones sin asignar".
// ✅ V00466: ahora es una VENTANA (modal) con las operaciones de Operaciones sin asignar que
//   coinciden con un cruce, cada una con su check, para enviarlas al Acumulado (o solo
//   marcarlas en la tabla). Los cruces sin operación por asignar quedan plegados abajo.
//   Sin la columna Lugar: todo el reporte es del AVI.
// ✅ V00467: sirve para los tres puentes (AVI, Puente 3 y Puente Colombia); en Colombia el
//   cruce muestra sus dos cobros (puente y caseta).
// ✅ V00475: la ventana muestra TODOS los renglones del Excel (cada cruce) y, junto a cada uno, las
//   referencias (operaciones) de esa unidad ese día en cualquier estado: la que coincide (con su check
//   para enviarla al Acumulado), otras por asignar, las que ya están en el Acumulado (con su
//   referencia AVI-…/PT3-…/PTC-…), las aún sin completar… Se filtra con los chips de arriba.
import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { claveUnidadDia, ETIQUETA_REF_DEL_DIA, ETIQUETA_TAG_REPORTE, NOMBRE_REPORTE, resumenCruces, type CruceAvi, type EstadoCruce, type GrupoReporte, type OpParaCruce, type RefDelDia, type ResultadoCruce } from '../services/reporteAvi';
import './PanelReporteAvi.css';

interface Props {
  /** Puente del reporte. */
  grupo: GrupoReporte;
  nombreArchivo: string;
  filas: ResultadoCruce[];
  opsSinCruce: OpParaCruce[];
  omitidas: number;
  /** Aviso si el reporte trae días que no están en las operaciones cargadas ('' si no). */
  avisoRango: string;
  /** Operaciones cuya hora de Verde aún no llega. */
  horasPendientes: number;
  /** ✅ V00475: todas las operaciones de cada unidad y día (claveUnidadDia), en cualquier estado. */
  refsDelDia: ReadonlyMap<string, RefDelDia[]>;
  /** ✅ V00475: las operaciones del módulo aún no llegan (no se puede decir que algo no coincide). */
  cargandoOps: boolean;
  /** Abre "Enviar al Acumulado" con estas operaciones seleccionadas. */
  onEnviar: (ids: string[]) => void;
  /** Solo las deja seleccionadas en la tabla. */
  onMarcar: (ids: string[]) => void;
  onQuitar: () => void;
  onCerrar: () => void;
}

const ETIQUETA: Record<EstadoCruce, string> = {
  coincide: 'Coincide',
  sinOperacion: 'Sin operación por asignar',
  tagSinUnidad: 'Tag sin unidad',
};
const ayuda = (estado: Exclude<EstadoCruce, 'coincide'>, grupo: GrupoReporte): string => estado === 'sinOperacion'
  ? 'La unidad no tiene una operación en Operaciones sin asignar para este cruce ese día: puede que ya esté en el Acumulado, que aún no esté completada o que haya cruzado sin operación.'
  : `Ninguna unidad de Unidades Propias tiene este ${ETIQUETA_TAG_REPORTE[grupo]}.`;

const fechaCorta = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/ de /g, ' ');
};
const dinero = (n: number): string => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Cobros del cruce en texto ("$90.00 a las 08:51 + $129.60 a las 08:55"). */
const textoCobros = (c: CruceAvi): string => c.cobros.map((x) => `${dinero(x.monto)} a las ${x.hora}`).join(' + ');
const claveCruce = (c: CruceAvi): string => `${c.fecha} ${c.hora}|${c.tag}|${c.monto}`;
type Filtro = 'todos' | 'conReferencias' | EstadoCruce;
const horaVerde = (o: OpParaCruce | null): string => {
  const m = String(o?.horas[0] ?? '').match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

export default function PanelReporteAvi({ grupo, nombreArchivo, filas, opsSinCruce, omitidas, avisoRango, horasPendientes, refsDelDia, cargandoOps, onEnviar, onMarcar, onQuitar, onCerrar }: Props) {
  // Se guardan las DESMARCADAS: si la coincidencia cambia al llegar las horas de Verde, lo nuevo entra marcado.
  const [desmarcadas, setDesmarcadas] = useState<ReadonlySet<string>>(new Set());
  // ✅ V00475: null = automático (los renglones con referencias si hay; si no, todos) hasta que se elige un chip.
  const [filtroElegido, setFiltro] = useState<Filtro | null>(null);
  const r = resumenCruces(filas);
  const coinciden = filas.filter((f): f is ResultadoCruce & { op: OpParaCruce } => f.estado === 'coincide' && !!f.op);
  // ✅ V00475: los renglones del Excel en su orden (fecha y hora), filtrados por el chip elegido.
  const ordenadas = [...filas].sort((a, b) => `${a.cruce.fecha} ${a.cruce.hora}`.localeCompare(`${b.cruce.fecha} ${b.cruce.hora}`));
  const refsDe = (f: ResultadoCruce): RefDelDia[] => (f.unidad ? refsDelDia.get(claveUnidadDia(f.unidad.id, f.cruce.fecha)) ?? [] : []);
  const conReferencias = ordenadas.filter((f) => refsDe(f).length > 0);
  const filtro: Filtro = filtroElegido ?? (conReferencias.length > 0 ? 'conReferencias' : 'todos');
  const visibles = filtro === 'todos' ? ordenadas : filtro === 'conReferencias' ? conReferencias : ordenadas.filter((f) => f.estado === filtro);
  const marcadas = coinciden.map((f) => f.op.id).filter((id) => !desmarcadas.has(id));
  const todas = coinciden.length > 0 && marcadas.length === coinciden.length;
  const dias = Array.from(new Set(filas.map((f) => f.cruce.fecha))).sort();
  const rango = dias.length === 0 ? '' : dias.length === 1 ? fechaCorta(dias[0]) : `${fechaCorta(dias[0])} al ${fechaCorta(dias[dias.length - 1])}`;

  // Esc cierra la ventana (el reporte sigue cargado).
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);

  const alternar = (id: string) => setDesmarcadas((prev) => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });
  const alternarTodas = () => setDesmarcadas(todas ? new Set(coinciden.map((f) => f.op.id)) : new Set());

  const exportar = () => {
    const datos = ordenadas.map((f) => ({
      Fecha: f.cruce.fecha, Hora: f.cruce.hora, 'Tag #': f.cruce.tagOriginal, Unidad: f.unidad?.nombre ?? '',
      Monto: f.cruce.monto, ...(f.cruce.cobros.length > 1 ? { Cobros: textoCobros(f.cruce) } : {}),
      Operación: f.op?.ref ?? '', 'Hora Verde': horaVerde(f.op),
      'Referencias de la unidad ese día': refsDe(f).map((x) => `${x.ref} (${ETIQUETA_REF_DEL_DIA[x.estado]}${x.referencia ? ` ${x.referencia}` : ''})`).join(', '), // ✅ V00475
      Resultado: ETIQUETA[f.estado], Avisos: f.avisos.join(' · '),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos), `Cruces ${NOMBRE_REPORTE[grupo]}`);
    XLSX.writeFile(wb, `Cruces_${NOMBRE_REPORTE[grupo].replace(/\s+/g, '_')}_${dias[0] ?? 'reporte'}.xlsx`);
  };

  return (
    <div className="modal-overlay pra-fondo">
      <section className="pra" role="dialog" aria-modal="true" aria-labelledby="pra-titulo">
        <header className="pra-enc">
          <div>
            <h2 className="pra-titulo" id="pra-titulo">Reporte {NOMBRE_REPORTE[grupo]} · {rango}</h2>
            <p className="pra-sub">{nombreArchivo} · {r.total} {r.total === 1 ? 'cruce' : 'cruces'} · {dinero(r.monto)}{omitidas > 0 ? ` · ${omitidas} renglón(es) sin tag o sin fecha no se tomaron` : ''}</p>
          </div>
          <button type="button" className="pra-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </header>

        {/* ✅ V00475: los chips filtran la tabla (todos los renglones del Excel, o solo los de un resultado) */}
        <div className="pra-resumen" role="group" aria-label="Mostrar">
          <button type="button" className={`pra-chip pra-chip--todos pra-filtro${filtro === 'todos' ? ' pra-filtro--activo' : ''}`} aria-pressed={filtro === 'todos'} onClick={() => setFiltro('todos')}>
            Todos los renglones ({r.total})
          </button>
          <button type="button" className={`pra-chip pra-chip--todos pra-filtro${filtro === 'conReferencias' ? ' pra-filtro--activo' : ''}`} aria-pressed={filtro === 'conReferencias'} onClick={() => setFiltro('conReferencias')}>
            Con referencias de la unidad ese día ({conReferencias.length})
          </button>
          <button type="button" className={`pra-chip pra-chip--coincide pra-filtro${filtro === 'coincide' ? ' pra-filtro--activo' : ''}`} aria-pressed={filtro === 'coincide'} onClick={() => setFiltro('coincide')}>
            {r.coincide} {r.coincide === 1 ? 'coincide' : 'coinciden'}
          </button>
          {r.sinOperacion > 0 && (
            <button type="button" className={`pra-chip pra-chip--falta pra-filtro${filtro === 'sinOperacion' ? ' pra-filtro--activo' : ''}`} aria-pressed={filtro === 'sinOperacion'} onClick={() => setFiltro('sinOperacion')}>
              {r.sinOperacion} sin operación por asignar
            </button>
          )}
          {r.tagSinUnidad > 0 && (
            <button type="button" className={`pra-chip pra-chip--falta pra-filtro${filtro === 'tagSinUnidad' ? ' pra-filtro--activo' : ''}`} aria-pressed={filtro === 'tagSinUnidad'} onClick={() => setFiltro('tagSinUnidad')}>
              {r.tagSinUnidad} tag sin unidad
            </button>
          )}
        </div>
        <p className="pra-nota">Cada renglón del Excel con las <b>referencias de esa unidad ese día</b>. Con check, la que coincide y está en <b>Operaciones sin asignar</b> (completada y fuera del Acumulado): esa se envía al Acumulado.</p>
        {avisoRango && <p className="pra-aviso" role="status">{avisoRango}</p>}
        {cargandoOps && <CargandoDatos compacto texto="Cargando las operaciones para buscar las referencias…" />}
        {!cargandoOps && horasPendientes > 0 && <CargandoDatos compacto texto={`Buscando la hora del Verde de ${horasPendientes} ${horasPendientes === 1 ? 'operación' : 'operaciones'}…`} />}

        <div className="pra-marco">
          {visibles.length === 0 ? (
            <p className="pra-vacio">No hay renglones con ese resultado.</p>
          ) : (
            <table className="pra-tabla">
              <thead>
                <tr>
                  <th className="pra-col-chk">{coinciden.length > 0 && <input type="checkbox" checked={todas} onChange={alternarTodas} aria-label="Marcar todas las que coinciden" />}</th>
                  <th>Cruce</th><th>Tag #</th><th>Unidad</th><th className="pra-num">Cobró el {NOMBRE_REPORTE[grupo]}</th><th>Referencias de la unidad ese día</th><th>Revisar</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((f) => {
                  const op = f.estado === 'coincide' ? f.op : null;
                  const marcada = !!op && !desmarcadas.has(op.id);
                  const refs = refsDe(f);
                  return (
                    <tr key={claveCruce(f.cruce)} className={`${op ? 'pra-fila--clic' : ''}${marcada ? ' pra-fila--sel' : ''}`} onClick={op ? () => alternar(op.id) : undefined}>
                      <td className="pra-col-chk">{op && <input type="checkbox" checked={marcada} onChange={() => alternar(op.id)} onClick={(e) => e.stopPropagation()} aria-label={`Marcar ${op.ref}`} />}</td>
                      <td>{fechaCorta(f.cruce.fecha)} <span className="pra-tenue">{f.cruce.cobros.map((x) => x.hora).join(' + ')}</span></td>
                      <td className="pra-mono">{f.cruce.tagOriginal}</td>
                      <td>{f.unidad?.nombre ?? <span className="pra-chip pra-chip--falta" title={ayuda('tagSinUnidad', grupo)}>Tag sin unidad</span>}</td>
                      <td className="pra-num" title={f.cruce.cobros.length > 1 ? textoCobros(f.cruce) : undefined}>
                        {dinero(f.cruce.monto)}
                        {f.cruce.cobros.length > 1 && <span className="pra-cobros">{f.cruce.cobros.map((x) => dinero(x.monto)).join(' + ')}</span>}
                      </td>
                      <td className="pra-refs">
                        {!f.unidad ? <span className="pra-tenue">—</span> : cargandoOps ? <span className="pra-tenue">Cargando…</span> : refs.length === 0 ? (
                          <span className="pra-tenue" title={ayuda('sinOperacion', grupo)}>Sin operaciones de esta unidad ese día</span>
                        ) : (
                          <ul className="pra-lista-refs">
                            {refs.map((x) => {
                              const esLaQueCoincide = op?.id === x.id;
                              return (
                                <li key={x.id} className={`pra-ref-dia pra-ref-dia--${esLaQueCoincide ? 'coincide' : x.estado}`}>
                                  <b className="pra-ref">{x.ref}</b>
                                  <span className="pra-ref-estado">
                                    {esLaQueCoincide ? `Coincide${horaVerde(op) ? ` · Verde ${horaVerde(op)}` : ''}` : ETIQUETA_REF_DEL_DIA[x.estado]}
                                    {x.referencia ? ` · ${x.referencia}` : ''}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </td>
                      <td className="pra-revisar">{f.avisos.length ? f.avisos.map((a) => <span key={a} className="pra-aviso-fila">{a}</span>) : <span className="pra-tenue">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {opsSinCruce.length > 0 && (
          <details className="pra-sobran">
            <summary>{opsSinCruce.length} {opsSinCruce.length === 1 ? 'operación sin asignar' : 'operaciones sin asignar'} de estas unidades y días no {opsSinCruce.length === 1 ? 'aparece' : 'aparecen'} en el reporte</summary>
            <ul>{opsSinCruce.map((o) => <li key={o.id}>{o.ref} · {fechaCorta(o.fecha)}{horaVerde(o) ? ` · Verde ${horaVerde(o)}` : ''}</li>)}</ul>
          </details>
        )}

        <footer className="pra-pie">
          <div className="pra-pie-izq">
            <button type="button" className="pra-btn" onClick={exportar}>Exportar resultado</button>
            <button type="button" className="pra-btn pra-btn--quitar" onClick={onQuitar}>Quitar reporte</button>
          </div>
          <div className="pra-pie-der">
            <button type="button" className="pra-btn" disabled={marcadas.length === 0} onClick={() => onMarcar(marcadas)}>Solo marcar en la tabla</button>
            <button type="button" className="pra-btn pra-btn--principal" disabled={marcadas.length === 0} onClick={() => onEnviar(marcadas)}>Enviar al Acumulado ({marcadas.length})</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
