// src/features/estadisticas/components/ResumenMontosFacturados.tsx
// ✅ V00493 — De dónde salen los montos del área Facturación de Estadísticas:
//   · lo facturado en el rango (las mismas cifras que las tarjetas del Historial de Facturación);
//   · aparte, lo que NO se suma: operaciones del periodo aún sin factura ("por facturar") y
//     facturadas cuyo Por Pagar aún no tiene factura del proveedor; facturas canceladas o sin moneda.
import type { ResumenFacturado } from '../services/montosFacturados';
import './ResumenMontosFacturados.css';

type Datos = Record<string, unknown>;

interface Props {
  resumen: ResumenFacturado;
  porFacturar: { ops: Datos[]; dol: number; pes: number };
  sinFacturaProveedor: { ops: Datos[]; costo: number };
  error: string | null;
  onVerOps: (titulo: string, ops: Datos[]) => void;
}

const dinero = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cuenta = (n: number) => n.toLocaleString('en-US');
const montos = (pes: number, dol: number): string => [pes > 0 ? `${dinero(pes)} MXN` : '', dol > 0 ? `${dinero(dol)} USD` : ''].filter(Boolean).join(' · ') || '$0.00';

export default function ResumenMontosFacturados({ resumen, porFacturar, sinFacturaProveedor, error, onVerOps }: Props) {
  const tituloPorFacturar = 'Por facturar — servicio en el rango, sin factura de cliente';
  const tituloSinProv = 'Facturadas sin factura del proveedor (Por Pagar)';
  return (
    <section className="rmf-franja" aria-label="De dónde salen los montos">
      <dl className="rmf-total">
        <dt>Total facturado</dt>
        <dd>{dinero(resumen.totalMXN)} MXN · {dinero(resumen.totalUSD)} USD</dd>
        <dd className="rmf-ayuda">Igual que las tarjetas de Facturación → Historial con este rango de fechas.</dd>
      </dl>
      {porFacturar.ops.length > 0 && (
        <button type="button" className="rmf-aparte" onClick={() => onVerOps(tituloPorFacturar, porFacturar.ops)} title="Ver estas operaciones">
          <span className="rmf-aparte-titulo">Por facturar: {cuenta(porFacturar.ops.length)} operaciones</span>
          <span className="rmf-aparte-monto">{montos(porFacturar.pes, porFacturar.dol)}</span>
          <span className="rmf-ayuda">Servicio en el rango sin factura de cliente. No se suma.</span>
        </button>
      )}
      {sinFacturaProveedor.ops.length > 0 && (
        <button type="button" className="rmf-aparte" onClick={() => onVerOps(tituloSinProv, sinFacturaProveedor.ops)} title="Ver estas operaciones">
          <span className="rmf-aparte-titulo">Sin factura del proveedor: {cuenta(sinFacturaProveedor.ops.length)}</span>
          <span className="rmf-aparte-monto">{dinero(sinFacturaProveedor.costo)} MXN por pagar</span>
          <span className="rmf-ayuda">Ya facturadas al cliente; su costo no entra en la utilidad hasta que llegue la factura.</span>
        </button>
      )}
      {(resumen.canceladas > 0 || resumen.sinMoneda.facturas > 0) && (
        <ul className="rmf-notas">
          {resumen.canceladas > 0 && <li>{cuenta(resumen.canceladas)} facturas canceladas del rango no se suman.</li>}
          {resumen.sinMoneda.facturas > 0 && <li>{cuenta(resumen.sinMoneda.facturas)} facturas sin moneda reconocible ({dinero(resumen.sinMoneda.total)}) no se suman.</li>}
        </ul>
      )}
      {error && <p className="rmf-error" role="alert">{error}</p>}
    </section>
  );
}
