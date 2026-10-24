// src/features/facturacion/components/PagosDeFactura.tsx
// ✅ V00483 — en la ficha de una factura con pagos: la lista de sus pagos (a la derecha). Cada pago
// abre su detalle en Pagos (si el usuario no tiene acceso a Pagos, la lista se ve pero no se abre).
import { ChevronRight, Wallet } from 'lucide-react';
import { sumarMontos } from '../../../shared/dominio/numeros';
import type { PagoDeFactura } from '../services/pagosDeFactura';
import Importe from './Importe';
import './PagosDeFactura.css';

interface Props {
  pagos: readonly PagoDeFactura[];
  /** Moneda y total de la factura (lo aplicado va en su moneda). */
  moneda: unknown;
  total: number;
  /** Sin él (usuario sin acceso a Pagos) los pagos se listan sin abrirse. */
  onAbrir?: (pago: PagoDeFactura) => void;
}

export default function PagosDeFactura({ pagos, moneda, total, onAbrir }: Props) {
  const pagado = sumarMontos(pagos.map((p) => p.aplicado));
  const diferencia = Math.round((total - pagado) * 100) / 100;
  return (
    <aside className="pfa-panel" aria-label="Pagos de esta factura">
      <h3 className="pfa-titulo"><Wallet size={16} aria-hidden="true" /> Pagos de esta factura ({pagos.length})</h3>
      <dl className="pfa-resumen">
        <div><dt>Total</dt><dd><Importe monto={total} moneda={moneda} /></dd></div>
        <div><dt>Pagado</dt><dd><Importe monto={pagado} moneda={moneda} /></dd></div>
        {diferencia >= 0
          ? <div><dt>Saldo</dt><dd className={diferencia > 0.009 ? 'pfa-saldo' : 'pfa-liquidada'}>{diferencia > 0.009 ? <Importe monto={diferencia} moneda={moneda} /> : 'Liquidada'}</dd></div>
          : <div><dt>Pagado de más</dt><dd className="pfa-saldo"><Importe monto={-diferencia} moneda={moneda} /></dd></div>}
      </dl>
      <ul className="pfa-lista">
        {pagos.map((p) => {
          const contenido = (
            <>
              <span className="pfa-pago__linea">
                <span className="pfa-pago__numero">{p.numeroPago}</span>
                <span className="pfa-pago__fecha">{p.fecha || '—'}</span>
              </span>
              <span className="pfa-pago__linea">
                <span className="pfa-pago__metodo">{[p.metodoPago, p.referencia].filter(Boolean).join(' · ') || 'Sin referencia'}</span>
                <Importe monto={p.aplicado} moneda={moneda} className="pfa-pago__aplicado" />
              </span>
              {Math.abs(p.monto - p.aplicado) > 0.009 && (
                <span className="pfa-pago__total">Pago total: <Importe monto={p.monto} moneda={p.moneda || moneda} /></span>
              )}
            </>
          );
          return (
            <li key={p.id}>
              {onAbrir ? (
                <button type="button" className="pfa-pago" onClick={() => onAbrir(p)} title="Ver el detalle de este pago en Pagos">
                  {contenido}
                  <ChevronRight size={16} className="pfa-pago__ir" aria-hidden="true" />
                </button>
              ) : <div className="pfa-pago pfa-pago--fijo">{contenido}</div>}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
