// src/features/facturacion/components/DiferenciaEnCargos.tsx
// ---------------------------------------------------------------------------
// ✅ V00519 — En "Analizar documento" (Ficha de Factura de Clientes), cuando el total del documento no
// concuerda con la factura: propone poner la diferencia en COSTOS ADICIONALES. El usuario escribe cuánto
// va a cada operación (se precarga en la que no cuadra) y la observación; ve qué cambia (costos de cada
// operación y total de la factura) y confirma. La escritura está en services/diferenciaEnCargos.ts.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { auth } from '../../../config/firebase';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { porIds } from '../../../shared/data/consultas';
import { idReal } from '../../../shared/data/coleccionesVivas';
import { useFlags } from '../../../shared/data/flags';
import { aCentavos, r2 } from '../../../shared/dominio/numeros';
import { registrarLog } from '../../../utils/logger';
import { notificarOperacionGuardada } from '../../../utils/operacionesBus';
import { aplicarDiferenciaEnCargos, opsDeFactura, planDiferenciaEnCargos } from '../services/diferenciaEnCargos';
import type { DatosDiferenciaCargos, PlanCargos } from '../services/diferenciaEnCargos';
import type { DiferenciaDocumento, DiferenciaOp } from '../services/documentoFactura';
import { idsDeFila } from '../services/documentosFactura';
import { estaCancelada } from '../services/reglasFactura';
import './DiferenciaEnCargos.css';

type Datos = Record<string, unknown>;

interface Props {
  fila: Datos;
  folio: string;
  moneda: 'USD' | 'MXN';
  diferencia: DiferenciaDocumento;
  difOps: readonly DiferenciaOp[];
  /** Se guardó (para refrescar la Ficha y mostrar el resumen aunque el documento ya coincida). */
  onAplicado: (plan: PlanCargos) => void;
}

const dinero = (n: number): string => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const conSigno = (n: number): string => `${n > 0 ? '+' : ''}${dinero(n)}`;
const numero = (s: string): number => { const n = Number(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const hoyCorto = (): string => new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Precarga: la diferencia de cada operación que no cuadra (si suman la diferencia); con una sola operación, toda. */
const precarga = (ops: readonly { opId: string; ref: string }[], difOps: readonly DiferenciaOp[], total: number): Record<string, string> => {
  const porRef = new Map(ops.map((o) => [o.ref.toUpperCase(), o.opId] as const));
  const unaPorUna = difOps.filter((d) => d.refs.length === 1 && porRef.has(d.refs[0].toUpperCase()));
  if (unaPorUna.length && aCentavos(unaPorUna.reduce((s, d) => s + d.monto, 0)) === aCentavos(total)) {
    return Object.fromEntries(unaPorUna.map((d) => [porRef.get(d.refs[0].toUpperCase()) as string, dinero(d.monto).replace(/,/g, '')]));
  }
  return ops.length === 1 ? { [ops[0].opId]: String(total) } : {};
};

/** Lo que quedó guardado (se muestra aunque el documento ya coincida con la factura). */
export function ResumenDiferenciaAplicada({ plan, moneda }: { plan: PlanCargos; moneda: string }) {
  return (
    <div className="dec-panel dec-panel--hecho" role="status">
      <p className="dec-titulo">Listo: la diferencia quedó en costos adicionales.</p>
      <ul className="dec-lista">
        {plan.ops.map((o) => <li key={o.id}>{o.ref}: costos adicionales {dinero(o.cargosAntes)} → {dinero(o.cargosDespues)}; cobra {dinero(o.cobroAntes)} → {dinero(o.cobroDespues)} {moneda}. Con su observación.</li>)}
      </ul>
      <p className="dec-texto">Total de la factura: {dinero(plan.totalAntes)} → <b>{dinero(plan.totalDespues)} {moneda}</b>. Quedó en la bitácora.</p>
    </div>
  );
}

export default function DiferenciaEnCargos({ fila, folio, moneda, diferencia, difOps, onAplicado }: Props) {
  const flags = useFlags();
  const ops = opsDeFactura(fila, moneda);
  const ids = idsDeFila(fila);
  const [abierto, setAbierto] = useState(false);
  const [montos, setMontos] = useState<Record<string, string>>(() => precarga(ops, difOps, diferencia.monto));
  const [nota, setNota] = useState(() => `Diferencia con la factura ${folio} (${hoyCorto()}): el documento dice ${dinero(diferencia.documento)} ${moneda} y la app ${dinero(diferencia.app)} ${moneda}.`);
  const [vista, setVista] = useState<PlanCargos | null>(null);
  const [trabajando, setTrabajando] = useState('');
  const [error, setError] = useState('');

  // Por qué no se puede (se dice en lugar del botón).
  const impedimento = flags.dineroPorServidor
    ? 'Con el dinero en el servidor encendido (dineroPorServidor), la diferencia todavía no se puede poner desde aquí: corrige los costos en la operación y usa Recalcular montos en Pagos.'
    : ids.length !== 1 ? 'Esta factura está en varios registros con el mismo folio: corrige los costos en cada operación.'
      : estaCancelada(String(fila.statusFactura ?? '')) ? 'La factura está cancelada.'
        : ops.length === 0 ? 'La factura no tiene sus operaciones ligadas (solo sus referencias): corrige los costos en cada operación.' : '';

  const repartido = r2(ops.reduce((s, o) => s + numero(montos[o.opId] ?? ''), 0));
  const cuadra = aCentavos(repartido) === aCentavos(diferencia.monto);

  const datos = (): DatosDiferenciaCargos => ({
    folio, moneda, nota, ahoraISO: new Date().toISOString(), usuario: auth.currentUser?.email || '',
    asignaciones: ops.map((o) => ({ opId: o.opId, ref: o.ref, monto: r2(numero(montos[o.opId] ?? '')) })).filter((a) => a.monto !== 0),
  });

  const revisar = async () => {
    setTrabajando('Revisando las operaciones…');
    setError('');
    setVista(null);
    try {
      const d = datos();
      const leidas = await porIds('operaciones', d.asignaciones.map((a) => a.opId));
      setVista(planDiferenciaEnCargos(d, { id: ids[0], datos: fila }, leidas.map((o) => ({ id: idReal(o), datos: o }))));
    } catch (e) {
      console.error('[Facturación] No se pudo preparar la diferencia en costos adicionales:', e);
      setError(e instanceof Error ? e.message : 'No se pudieron leer las operaciones. Intenta de nuevo.');
    } finally {
      setTrabajando('');
    }
  };

  const aplicar = async () => {
    setTrabajando('Guardando…');
    setError('');
    try {
      const plan = await aplicarDiferenciaEnCargos(ids[0], datos());
      plan.ops.forEach((o) => notificarOperacionGuardada(o.id, o.datos, 'facturacion-diferencia'));
      void registrarLog('Facturación Clientes', 'Edición',
        `Factura ${folio}: diferencia con el documento puesta en costos adicionales — ${plan.ops.map((o) => `${o.ref} ${conSigno(r2(o.cobroDespues - o.cobroAntes))} ${moneda}`).join(', ')}; total ${dinero(plan.totalAntes)} → ${dinero(plan.totalDespues)} ${moneda}.`);
      setVista(null);
      onAplicado(plan);
    } catch (e) {
      console.error('[Facturación] No se pudo poner la diferencia en costos adicionales:', e);
      setError(e instanceof Error ? e.message : 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      setTrabajando('');
    }
  };

  return (
    <div className="dec-panel">
      <p className="dec-titulo">
        Diferencia de {conSigno(diferencia.monto)} {moneda} con el {diferencia.base === 'total' ? 'total' : 'subtotal'} del documento.
      </p>
      {impedimento ? <p className="dec-texto">{impedimento}</p> : !abierto ? (
        <button type="button" className="dec-btn" onClick={() => setAbierto(true)}>Poner la diferencia en costos adicionales</button>
      ) : (
        <>
          <p className="dec-texto">Escribe cuánto va a cada operación (en {moneda}; con signo menos si hay que bajarlo). La suma debe dar {conSigno(diferencia.monto)}.</p>
          <ul className="dec-ops">
            {ops.map((o) => (
              <li key={o.opId} className="dec-op">
                <label className="dec-op-ref" htmlFor={`dec-${o.opId}`}>{o.ref}</label>
                <span className="dec-op-cobro">cobra {dinero(o.importe)} {moneda}</span>
                <input id={`dec-${o.opId}`} className="dec-input" inputMode="decimal" value={montos[o.opId] ?? ''} placeholder="0.00"
                  onChange={(e) => { setMontos((m) => ({ ...m, [o.opId]: e.target.value })); setVista(null); }} disabled={!!trabajando} />
              </li>
            ))}
          </ul>
          <p className={`dec-suma${cuadra ? ' dec-suma--ok' : ''}`}>Repartido: {conSigno(repartido)} de {conSigno(diferencia.monto)} {moneda}</p>
          <label className="dec-etiqueta" htmlFor="dec-nota">Observación de costos adicionales (se agrega en cada operación)</label>
          <textarea id="dec-nota" className="dec-nota" rows={2} value={nota} onChange={(e) => { setNota(e.target.value); setVista(null); }} disabled={!!trabajando} />

          {vista ? (
            <div className="dec-vista">
              <p className="dec-texto"><b>Se va a guardar:</b></p>
              <ul className="dec-lista">
                {vista.ops.map((o) => <li key={o.id}>{o.ref}: costos adicionales {dinero(o.cargosAntes)} → {dinero(o.cargosDespues)} (en la moneda de su convenio); cobra {dinero(o.cobroAntes)} → {dinero(o.cobroDespues)} {moneda}.</li>)}
              </ul>
              <p className="dec-texto">Total de la factura: {dinero(vista.totalAntes)} → <b>{dinero(vista.totalDespues)} {moneda}</b>.</p>
              <div className="dec-acciones">
                <button type="button" className="dec-btn dec-btn--aplicar" onClick={() => { void aplicar(); }} disabled={!!trabajando}>Confirmar y guardar</button>
                <button type="button" className="dec-btn" onClick={() => setVista(null)} disabled={!!trabajando}>Cambiar</button>
              </div>
            </div>
          ) : (
            <div className="dec-acciones">
              <button type="button" className="dec-btn dec-btn--aplicar" onClick={() => { void revisar(); }} disabled={!cuadra || !nota.trim() || !!trabajando}>Revisar los cambios</button>
              <button type="button" className="dec-btn" onClick={() => setAbierto(false)} disabled={!!trabajando}>Cancelar</button>
            </div>
          )}
        </>
      )}
      {trabajando && <CargandoDatos compacto texto={trabajando} />}
      {error && <p className="dec-error" role="alert">{error}</p>}
    </div>
  );
}
