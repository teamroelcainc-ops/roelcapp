// src/features/puentes/components/PanelReporteAvi.tsx
// ✅ V00464: resultado de cargar el reporte del puente AVI en "Operaciones sin asignar".
// ✅ V00466: ahora es una VENTANA (modal) con las operaciones de Operaciones sin asignar que
//   coinciden con un cruce, cada una con su check, para enviarlas al Acumulado (o solo
//   marcarlas en la tabla). Los cruces sin operación por asignar quedan plegados abajo.
//   Sin la columna Lugar: todo el reporte es del AVI.
// ✅ V00467: sirve para los tres puentes (AVI, Puente 3 y Puente Colombia); en Colombia el
//   cruce muestra sus dos cobros (puente y caseta).
import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { ETIQUETA_TAG_REPORTE, NOMBRE_REPORTE, resumenCruces, type CruceAvi, type EstadoCruce, type GrupoReporte, type OpParaCruce, type ResultadoCruce } from '../services/reporteAvi';
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
const horaVerde = (o: OpParaCruce | null): string => {
  const m = String(o?.horas[0] ?? '').match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

export default function PanelReporteAvi({ grupo, nombreArchivo, filas, opsSinCruce, omitidas, avisoRango, horasPendientes, onEnviar, onMarcar, onQuitar, onCerrar }: Props) {
  // Se guardan las DESMARCADAS: si la coincidencia cambia al llegar las horas de Verde, lo nuevo entra marcado.
  const [desmarcadas, setDesmarcadas] = useState<ReadonlySet<string>>(new Set());
  const r = resumenCruces(filas);
  const coinciden = filas.filter((f): f is ResultadoCruce & { op: OpParaCruce } => f.estado === 'coincide' && !!f.op);
  const sinOperacion = filas.filter((f) => f.estado !== 'coincide');
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
    const datos = filas.map((f) => ({
      Fecha: f.cruce.fecha, Hora: f.cruce.hora, 'Tag #': f.cruce.tagOriginal, Unidad: f.unidad?.nombre ?? '',
      Monto: f.cruce.monto, ...(f.cruce.cobros.length > 1 ? { Cobros: textoCobros(f.cruce) } : {}),
      Operación: f.op?.ref ?? '', 'Hora Verde': horaVerde(f.op),
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

        <ul className="pra-resumen">
          <li className="pra-chip pra-chip--coincide">{r.coincide} {r.coincide === 1 ? 'operación coincide' : 'operaciones coinciden'}</li>
          {r.sinOperacion > 0 && <li className="pra-chip pra-chip--falta">{r.sinOperacion} sin operación por asignar</li>}
          {r.tagSinUnidad > 0 && <li className="pra-chip pra-chip--falta">{r.tagSinUnidad} tag sin unidad</li>}
        </ul>
        <p className="pra-nota">Se buscan solo las operaciones de <b>Operaciones sin asignar</b> (completadas y que aún no están en el Acumulado).</p>
        {avisoRango && <p className="pra-aviso" role="status">{avisoRango}</p>}
        {horasPendientes > 0 && <CargandoDatos compacto texto={`Buscando la hora del Verde de ${horasPendientes} ${horasPendientes === 1 ? 'operación' : 'operaciones'}…`} />}

        <div className="pra-marco">
          {coinciden.length === 0 ? (
            <p className="pra-vacio">Ningún cruce del reporte coincide con una operación de Operaciones sin asignar.</p>
          ) : (
            <table className="pra-tabla pra-tabla--clic">
              <thead>
                <tr>
                  <th className="pra-col-chk"><input type="checkbox" checked={todas} onChange={alternarTodas} aria-label="Marcar todas" /></th>
                  <th>Operación</th><th>Unidad</th><th>Cruce</th><th>Verde</th><th className="pra-num">Cobró el {NOMBRE_REPORTE[grupo]}</th><th>Revisar</th>
                </tr>
              </thead>
              <tbody>
                {coinciden.map((f) => {
                  const marcada = !desmarcadas.has(f.op.id);
                  return (
                    <tr key={f.op.id} className={marcada ? 'pra-fila--sel' : ''} onClick={() => alternar(f.op.id)}>
                      <td className="pra-col-chk"><input type="checkbox" checked={marcada} onChange={() => alternar(f.op.id)} onClick={(e) => e.stopPropagation()} aria-label={`Marcar ${f.op.ref}`} /></td>
                      <td><b className="pra-ref">{f.op.ref}</b> <span className="pra-tenue">{fechaCorta(f.op.fecha)}</span></td>
                      <td>{f.unidad?.nombre ?? '—'} <span className="pra-tenue pra-mono">{f.cruce.tagOriginal}</span></td>
                      <td>{fechaCorta(f.cruce.fecha)} <span className="pra-tenue">{f.cruce.cobros.map((x) => x.hora).join(' + ')}</span></td>
                      <td>{horaVerde(f.op) || <span className="pra-tenue">—</span>}</td>
                      <td className="pra-num" title={f.cruce.cobros.length > 1 ? textoCobros(f.cruce) : undefined}>
                        {dinero(f.cruce.monto)}
                        {f.cruce.cobros.length > 1 && <span className="pra-cobros">{f.cruce.cobros.map((x) => dinero(x.monto)).join(' + ')}</span>}
                      </td>
                      <td className="pra-revisar">{f.avisos.length ? f.avisos.map((a) => <span key={a} className="pra-aviso-fila">{a}</span>) : <span className="pra-tenue">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {sinOperacion.length > 0 && (
          <details className="pra-sobran">
            <summary>{sinOperacion.length === 1 ? 'Ver el cruce que no coincide' : `Ver los ${sinOperacion.length} cruces que no coinciden`}</summary>
            <div className="pra-marco pra-marco--bajo">
              <table className="pra-tabla">
                <thead><tr><th>Cruce</th><th>Tag #</th><th>Unidad</th><th className="pra-num">Monto</th><th>Motivo</th></tr></thead>
                <tbody>
                  {sinOperacion.map((f) => (
                    <tr key={claveCruce(f.cruce)}>
                      <td>{fechaCorta(f.cruce.fecha)} <span className="pra-tenue">{f.cruce.cobros.map((x) => x.hora).join(' + ')}</span></td>
                      <td className="pra-mono">{f.cruce.tagOriginal}</td>
                      <td>{f.unidad?.nombre ?? '—'}</td>
                      <td className="pra-num" title={f.cruce.cobros.length > 1 ? textoCobros(f.cruce) : undefined}>{dinero(f.cruce.monto)}</td>
                      <td>
                        <span className="pra-chip pra-chip--falta" title={f.estado === 'coincide' ? undefined : ayuda(f.estado, grupo)}>{ETIQUETA[f.estado]}</span>
                        {f.avisos.map((a) => <span key={a} className="pra-aviso-fila">{a}</span>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
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
