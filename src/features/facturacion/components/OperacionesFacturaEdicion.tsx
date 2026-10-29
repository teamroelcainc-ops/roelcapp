// src/features/facturacion/components/OperacionesFacturaEdicion.tsx
// ---------------------------------------------------------------------------
// ✅ V00520 — "Operaciones de la factura" dentro de Editar factura (Clientes): cada operación con lo que
// cobra en la factura y lo que cobra hoy, y ✎ Editar (abre el formulario de la operación). Si alguna
// cambió de costo lo marca y dice cómo queda la factura al presionar Actualizar.
// ---------------------------------------------------------------------------
import CargandoDatos from '../../../shared/components/CargandoDatos';
import type { OperacionesDeFactura } from '../hooks/useOperacionesDeFactura';
import type { OpDesfasada, PlanSincronizar } from '../services/sincronizarFactura';
import './OperacionesFacturaEdicion.css';

const dinero = (n: number): string => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  datos: OperacionesDeFactura;
  moneda: string;
  /** Las que cambiaron de costo y cómo queda la factura al presionar Actualizar (null = al día o no se puede). */
  desfasadas: readonly OpDesfasada[];
  /** La factura no guardó lo que cobró cada operación (no se puede saber si cambió). */
  sinImportes: boolean;
  plan: PlanSincronizar | null;
  impedimento: string;
  onEditar: (opId: string) => void;
}

export default function OperacionesFacturaEdicion({ datos, moneda, desfasadas, sinImportes, plan, impedimento, onEditar }: Props) {
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
                  {c ? <>En la factura {dinero(c.antes)} → <b>hoy {dinero(c.ahora)} {moneda}</b></> : sinImportes ? null : <>{dinero(r.importe)} {moneda}</>}
                </span>
                <button type="button" className="ofe-editar" onClick={() => onEditar(r.opId)} title="Abrir el formulario de la operación">✎ Editar</button>
              </li>
            );
          })}
        </ul>
      )}
      {sinImportes && renglones.length > 0 && (
        <p className="ofe-nota">Esta factura no guardó lo que cobró cada operación: si cambias un costo, Actualizar no cambia el total (ponlo al día con Recalcular montos en Pagos).</p>
      )}
      {cargando && <CargandoDatos compacto texto="Leyendo las operaciones…" />}
      {error && <p className="ofe-error" role="alert">{error}</p>}
      {desfasadas.length > 0 && (
        <p className={`ofe-aviso${impedimento ? ' ofe-aviso--error' : ''}`} role="status">
          {desfasadas.length === 1 ? '1 operación cambió de costo' : `${desfasadas.length} operaciones cambiaron de costo`}.{' '}
          {impedimento || (plan && <>Al presionar <b>Actualizar</b>, la factura toma el costo de hoy: total {dinero(plan.totalAntes)} → <b>{dinero(plan.totalDespues)} {moneda}</b>.</>)}
        </p>
      )}
    </section>
  );
}
