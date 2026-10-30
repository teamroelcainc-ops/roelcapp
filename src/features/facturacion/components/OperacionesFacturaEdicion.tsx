// src/features/facturacion/components/OperacionesFacturaEdicion.tsx
// ---------------------------------------------------------------------------
// ✅ V00520 — "Operaciones de la factura" dentro de Editar factura (Clientes): cada operación con lo que
// cobra en la factura y lo que cobra hoy, y ✎ Editar (abre el formulario de la operación). Si alguna
// cambió de costo lo marca y dice cómo queda la factura al presionar Actualizar.
// ---------------------------------------------------------------------------
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { importeEn } from '../services/cotejoCfdi';
import type { OperacionesDeFactura } from '../hooks/useOperacionesDeFactura';
import type { OpDesfasada, PlanSincronizar } from '../services/sincronizarFactura';
import './OperacionesFacturaEdicion.css';

/** ✅ V00525: Actualizar guarda lo que cobra hoy cada operación (suma vs. total, que no cambia), o por qué no puede. */
export type CompletarEdicion = { suma: number; total: number; cuadra: boolean } | { motivo: string };

const dinero = (n: number): string => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  datos: OperacionesDeFactura;
  moneda: string;
  /** Las que cambiaron de costo y cómo queda la factura al presionar Actualizar (null = al día o no se puede). */
  desfasadas: readonly OpDesfasada[];
  /** La factura no guardó lo que cobró cada operación (no se puede saber si cambió). */
  sinImportes: boolean;
  /** ✅ V00525: la moneda para mostrar lo que cobra HOY cada operación (cuando la factura no lo guardó). */
  monedaHoy: 'USD' | 'MXN' | null;
  /** ✅ V00525: qué hace Actualizar con una factura sin importes (null = nada / todavía leyendo). */
  completar: CompletarEdicion | null;
  plan: PlanSincronizar | null;
  impedimento: string;
  onEditar: (opId: string) => void;
}

export default function OperacionesFacturaEdicion({ datos, moneda, desfasadas, sinImportes, monedaHoy, completar, plan, impedimento, onEditar }: Props) {
  const { renglones, actuales, cargando, error } = datos;
  const cambio = new Map(desfasadas.map((d) => [d.opId, d] as const));
  return (
    <section className="ofe-panel" aria-labelledby="ofe-titulo">
      <h3 id="ofe-titulo" className="ofe-titulo">Operaciones de la factura ({renglones.length})</h3>
      {renglones.length === 0 ? <p className="ofe-nota">Esta factura no tiene sus operaciones ligadas (solo sus referencias).</p> : (
        <ul className="ofe-lista">
          {renglones.map((r) => {
            const c = cambio.get(r.opId);
            const op = actuales.get(r.opId);
            return (
              <li key={r.opId} className={`ofe-op${c ? ' ofe-op--cambio' : ''}`}>
                <span className="ofe-ref">{r.ref}</span>
                <span className="ofe-convenio">{String(op?.convenioNombre ?? '')}</span>
                <span className="ofe-monto">
                  {c ? <>En la factura {dinero(c.antes)} → <b>hoy {dinero(c.ahora)} {moneda}</b></> : sinImportes
                    ? (op && monedaHoy ? <>Sin importe en la factura · <b>hoy {dinero(importeEn(monedaHoy, op))} {moneda}</b></> : null)
                    : <>{dinero(r.importe)} {moneda}</>}
                </span>
                <button type="button" className="ofe-editar" onClick={() => onEditar(r.opId)} title="Abrir el formulario de la operación">✎ Editar</button>
              </li>
            );
          })}
        </ul>
      )}
      {sinImportes && renglones.length > 0 && completar && ('motivo' in completar ? (
        <p className="ofe-aviso ofe-aviso--error" role="status">Esta factura no guardó lo que cobró cada operación y no se puede guardar desde aquí: {completar.motivo}.</p>
      ) : (
        <p className="ofe-aviso" role="status">
          Esta factura no guardó lo que cobró cada operación. Al presionar <b>Actualizar</b> se guarda lo que cobra hoy cada una: suman <b>{dinero(completar.suma)} {moneda}</b>; el total ({dinero(completar.total)} {moneda}) <b>no cambia</b>.
          {!completar.cuadra && ' No cuadra con el total: después la verás en Corregir con la diferencia.'}
        </p>
      ))}
      {cargando && <CargandoDatos compacto texto="Leyendo las operaciones…" />}
      {error && <p className="ofe-error" role="alert">{error}</p>}
      {desfasadas.length > 0 && (
        <p className={`ofe-aviso${impedimento ? ' ofe-aviso--error' : ''}`} role="status">
          {desfasadas.length === 1 ? '1 operación tiene otro total hoy' : `${desfasadas.length} operaciones tienen otro total hoy`}.{' '}
          {impedimento || (plan && (plan.modo === 'diferencia'
            ? <>Al presionar <b>Actualizar</b>, la factura toma el total de hoy de cada operación: total {dinero(plan.totalAntes)} → <b>{dinero(plan.totalDespues)} {moneda}</b>.</>
            : plan.modo === 'yaIncluido'
              // ✅ V00527: el total ya incluía lo de hoy (p. ej. cargos capturados después de facturar): no se suma dos veces
              ? <>Al presionar <b>Actualizar</b> se guarda el total de hoy de cada operación. El total de la factura (<b>{dinero(plan.totalAntes)} {moneda}</b>) no cambia: ya lo incluía.</>
              : <>Al presionar <b>Actualizar</b> se guarda el total de hoy de cada operación. El total de la factura ({dinero(plan.totalAntes)} {moneda}) <b>no cambia</b>: no cuadraba con sus operaciones y seguirá en Corregir con la diferencia.</>))}
        </p>
      )}
    </section>
  );
}
