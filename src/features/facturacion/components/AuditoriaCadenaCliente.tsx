// src/features/facturacion/components/AuditoriaCadenaCliente.tsx
// ---------------------------------------------------------------------------
// ✅ V00318: AUDITORÍA DE LA CADENA Operación → Factura → Pago, por cliente.
// Verifica que el proceso del negocio esté correcto de punta a punta:
//   1) Cada operación (no cancelada) del cliente está facturada, en UNA
//      factura, y el monto guardado en la factura coincide con el monto
//      VIGENTE de la operación (si la operación se editó DESPUÉS de
//      facturarse, aquí se detecta la diferencia).
//   2) Cada factura cuadra con sus pagos: la suma de lo APLICADO por los
//      pagos coincide con el montoPagado registrado y el saldo pendiente.
// Los montos se comparan en la escala de CONVERSIÓN (pesos), que es la
// escala homogénea del sistema, usando LAS MISMAS funciones de cálculo del
// dashboard de Facturación (llegan por props para no duplicar lógica).
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';
import './AuditoriaCadenaCliente.css';

/* eslint-disable @typescript-eslint/no-explicit-any -- docs de Firestore sin tipo canónico (mismo criterio del módulo de Facturación). */

type MontoOp = { conv: number; total: number; dol: number; pes: number; tc: number };

interface Props {
  onCerrar: () => void;
  /** obtenerMontoOperacion del dashboard: monto VIGENTE de la operación. */
  montoOperacion: (op: any) => MontoOp;
  /** totalNativoFactura del dashboard: total de la factura en su moneda. */
  totalNativo: (f: any) => number;
}

interface FilaOp {
  ref: string; fecha: string; status: string; montoHoy: number;
  invoices: string; montoEnFactura: number | null; dif: number | null;
  veredicto: 'ok' | 'cambio' | 'sinFacturar' | 'varias' | 'sinDesglose' | 'cancelada';
  detalle: string;
}
interface FilaFactura {
  invoice: string; fecha: string; totalNativo: number; moneda: string;
  conversion: number; aplicadoPagos: number; montoPagado: number; saldo: number;
  pagos: string; veredicto: 'pagada' | 'saldo' | 'descuadre' | 'deMas';
  detalle: string;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const AuditoriaCadenaCliente = ({ onCerrar, montoOperacion, totalNativo }: Props) => {
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [busquedaCli, setBusquedaCli] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [clienteNombre, setClienteNombre] = useState('');
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<{ ops: FilaOp[]; facturas: FilaFactura[]; totales: { hoy: number; facturado: number; aplicado: number }; problemas: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'empresas'));
        setEmpresas(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error('Auditoría: empresas', e); }
    })();
  }, []);

  const clientesFiltrados = busquedaCli.trim()
    ? empresas.filter((e) => String(e.nombre || '').toLowerCase().includes(busquedaCli.trim().toLowerCase())).slice(0, 8)
    : [];

  const auditar = async () => {
    if (!clienteId) { alert('Elige primero el cliente.'); return; }
    setCargando(true);
    setResultado(null);
    try {
      // 1) Descarga dirigida: SOLO lo del cliente (operaciones como clientePaga,
      //    facturas por clienteId y pagos de cliente por entidadId).
      const [snapOps, snapFact, snapPagos] = await Promise.all([
        getDocs(query(collection(db, 'operaciones'), where('clientePaga', '==', clienteId))),
        getDocs(query(collection(db, 'facturas_clientes'), where('clienteId', '==', clienteId))),
        getDocs(query(collection(db, 'pagos'), where('tipo', '==', 'cliente'), where('entidadId', '==', clienteId))),
      ]);
      const ops = snapOps.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      let facturas = snapFact.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      // Respaldo para facturas viejas sin clienteId: por nombre exacto.
      if (facturas.length === 0 && clienteNombre) {
        try {
          const snapNom = await getDocs(query(collection(db, 'facturas_clientes'), where('clienteNombre', '==', clienteNombre)));
          facturas = snapNom.docs.map((d) => ({ id: d.id, ...d.data() } as any));
        } catch { /* sin respaldo */ }
      }
      const pagos = snapPagos.docs.map((d) => ({ id: d.id, ...d.data() } as any));

      // 2) Índices: factura(s) de cada operación, y aplicaciones de pago por factura.
      const facturasPorOp = new Map<string, any[]>();
      facturas.forEach((f) => {
        const guardadas = Array.isArray(f.operacionesGuardadas) ? f.operacionesGuardadas : [];
        const claves = new Set<string>();
        guardadas.forEach((g: any) => { if (g?.id) claves.add(String(g.id)); if (g?.ref) claves.add(String(g.ref)); });
        (Array.isArray(f.operacionesIds) ? f.operacionesIds : []).forEach((x: any) => claves.add(String(x)));
        (Array.isArray(f.operaciones) ? f.operaciones : []).forEach((x: any) => { if (typeof x === 'string') claves.add(x); });
        claves.forEach((k) => { const arr = facturasPorOp.get(k) || []; arr.push(f); facturasPorOp.set(k, arr); });
      });
      const aplicadoPorFactura = new Map<string, { suma: number; numeros: string[] }>();
      pagos.forEach((p) => {
        (Array.isArray(p.facturas) ? p.facturas : []).forEach((fa: any) => {
          const fid = String(fa?.facturaId || '');
          if (!fid) return;
          const reg = aplicadoPorFactura.get(fid) || { suma: 0, numeros: [] };
          reg.suma += Number(fa?.aplicado) || 0;
          const num = String(p.numeroPago || p.id);
          if (!reg.numeros.includes(num)) reg.numeros.push(num);
          aplicadoPorFactura.set(fid, reg);
        });
      });

      // 3) CRUCE A — operación por operación.
      const filasOps: FilaOp[] = ops
        .sort((a, b) => String(b.fechaServicio || '').localeCompare(String(a.fechaServicio || '')))
        .map((op) => {
          const status = String(op.statusNombre || op.status || '');
          const cancelada = status.toLowerCase().includes('cancel');
          const hoy = r2(montoOperacion(op).conv);
          const facs = (facturasPorOp.get(String(op.id)) || []).concat(facturasPorOp.get(String(op.ref || '')) || [])
            .filter((f, i, arr) => arr.findIndex((x) => x.id === f.id) === i);
          const base: Omit<FilaOp, 'veredicto' | 'detalle'> = {
            ref: String(op.ref || op.id), fecha: String(op.fechaServicio || ''), status,
            montoHoy: hoy, invoices: facs.map((f) => String(f.invoice || f.id)).join(', '),
            montoEnFactura: null, dif: null,
          };
          if (cancelada) return { ...base, veredicto: 'cancelada', detalle: facs.length > 0 ? '⚠ Cancelada pero aparece en factura' : 'Cancelada (no requiere factura)' };
          if (facs.length === 0) return { ...base, veredicto: 'sinFacturar', detalle: 'Sin facturar' };
          if (facs.length > 1) return { ...base, veredicto: 'varias', detalle: `En ${facs.length} facturas (revisar posible doble cobro)` };
          const g = (Array.isArray(facs[0].operacionesGuardadas) ? facs[0].operacionesGuardadas : [])
            .find((x: any) => String(x?.id) === String(op.id) || String(x?.ref) === String(op.ref || ''));
          const enFactura = g ? r2(Number(g.monto) || 0) : null;
          if (enFactura === null || enFactura === 0) return { ...base, veredicto: 'sinDesglose', detalle: 'Factura sin desglose por operación (solo se compara el total de la factura)' };
          const dif = r2(hoy - enFactura);
          if (Math.abs(dif) > 0.01) return { ...base, montoEnFactura: enFactura, dif, veredicto: 'cambio', detalle: `La operación cambió DESPUÉS de facturarse: hoy ${money(hoy)} vs facturado ${money(enFactura)} (dif ${money(dif)})` };
          return { ...base, montoEnFactura: enFactura, dif: 0, veredicto: 'ok', detalle: 'Facturada y el monto coincide' };
        });

      // 4) CRUCE B — factura por factura contra sus pagos.
      const filasFacturas: FilaFactura[] = facturas
        .sort((a, b) => String(b.fecha || b.fechaFactura || '').localeCompare(String(a.fecha || a.fechaFactura || '')))
        .map((f) => {
          const totalN = r2(totalNativo(f));
          const conversion = r2(Number(f.subtotalFactura) || Number(f.total) || 0);
          const reg = aplicadoPorFactura.get(String(f.id)) || { suma: 0, numeros: [] };
          const aplicado = r2(reg.suma);
          const montoPagado = r2(Number(f.montoPagado) || 0);
          const saldo = r2(Number(f.saldoPendiente ?? (totalN - montoPagado)));
          const base: Omit<FilaFactura, 'veredicto' | 'detalle'> = {
            invoice: String(f.invoice || f.numeroInvoice || f.folio || f.id), fecha: String(f.fecha || f.fechaFactura || ''),
            totalNativo: totalN, moneda: String(f.monedaFacturacion || f.moneda || ''), conversion,
            aplicadoPagos: aplicado, montoPagado, saldo, pagos: reg.numeros.join(', '),
          };
          if (Math.abs(aplicado - montoPagado) > 0.01) return { ...base, veredicto: 'descuadre', detalle: `Los pagos aplicados (${money(aplicado)}) NO cuadran con el pagado registrado (${money(montoPagado)})` };
          if (aplicado - totalN > 0.01) return { ...base, veredicto: 'deMas', detalle: `Pagada DE MÁS: aplicado ${money(aplicado)} vs total ${money(totalN)}` };
          if (saldo > 0.01) return { ...base, veredicto: 'saldo', detalle: `Saldo pendiente de ${money(saldo)}` };
          return { ...base, veredicto: 'pagada', detalle: 'Pagada y los montos cuadran' };
        });

      // 5) Totales del cliente en la escala de conversión (pesos).
      const totales = {
        hoy: r2(filasOps.filter((x) => x.veredicto !== 'cancelada').reduce((s, x) => s + x.montoHoy, 0)),
        facturado: r2(filasFacturas.reduce((s, x) => s + x.conversion, 0)),
        aplicado: r2(filasFacturas.reduce((s, x) => s + x.aplicadoPagos, 0)),
      };
      const problemas = filasOps.filter((x) => x.veredicto === 'cambio' || x.veredicto === 'sinFacturar' || x.veredicto === 'varias' || (x.veredicto === 'cancelada' && x.invoices)).length
        + filasFacturas.filter((x) => x.veredicto === 'descuadre' || x.veredicto === 'deMas').length;
      setResultado({ ops: filasOps, facturas: filasFacturas, totales, problemas });
    } catch (e) {
      console.error('Auditoría de la cadena:', e);
      alert('No se pudo completar la auditoría. Revisa la consola.');
    } finally {
      setCargando(false);
    }
  };

  const descargarExcel = () => {
    if (!resultado) return;
    const wb = XLSX.utils.book_new();
    const hojaOps = resultado.ops.map((x) => ({
      'Referencia': x.ref, 'Fecha Servicio': x.fecha, 'Status': x.status,
      'Monto HOY (conversión)': x.montoHoy, 'Factura(s)': x.invoices,
      'Monto en Factura': x.montoEnFactura ?? '', 'Diferencia': x.dif ?? '', 'Veredicto': x.detalle,
    }));
    const hojaFact = resultado.facturas.map((x) => ({
      'Invoice': x.invoice, 'Fecha': x.fecha, 'Total (moneda factura)': x.totalNativo, 'Moneda': x.moneda,
      'Conversión (pesos)': x.conversion, 'Aplicado por Pagos': x.aplicadoPagos, 'Pagado Registrado': x.montoPagado,
      'Saldo': x.saldo, 'Pagos': x.pagos, 'Veredicto': x.detalle,
    }));
    const hojaTot = [
      { 'Concepto': 'Total operaciones HOY (conversión, sin canceladas)', 'Monto': resultado.totales.hoy },
      { 'Concepto': 'Total facturado (conversión)', 'Monto': resultado.totales.facturado },
      { 'Concepto': 'Total aplicado por pagos', 'Monto': resultado.totales.aplicado },
      { 'Concepto': 'Problemas detectados', 'Monto': resultado.problemas },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaOps.length ? hojaOps : [{ 'Sin registros': '' }]), 'Operaciones');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaFact.length ? hojaFact : [{ 'Sin registros': '' }]), 'Facturas y Pagos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaTot), 'Totales');
    const nombre = String(clienteNombre || 'cliente').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
    XLSX.writeFile(wb, `Auditoría ${nombre}.xlsx`);
  };

  const CLASE_OP: Record<FilaOp['veredicto'], string> = { ok: 'acc-ok', cambio: 'acc-mal', sinFacturar: 'acc-alerta', varias: 'acc-mal', sinDesglose: 'acc-info', cancelada: 'acc-info' };
  const CLASE_FA: Record<FilaFactura['veredicto'], string> = { pagada: 'acc-ok', saldo: 'acc-alerta', descuadre: 'acc-mal', deMas: 'acc-mal' };

  return (
    <div className="modal-overlay acc-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="form-card acc-modal">
        <div className="acc-encabezado">
          <div>
            <h3 className="acc-titulo">🔍 Auditoría de la cadena — Operación → Factura → Pago</h3>
            <p className="acc-sub">Verifica que cada operación esté facturada con el monto vigente y que cada factura cuadre con sus pagos.</p>
          </div>
          <button type="button" className="roelca-window-btn danger" title="Cerrar" onClick={onCerrar}>✕</button>
        </div>

        <div className="acc-buscador">
          <div className="acc-lookup">
            <input
              type="text" className="form-control" placeholder="Escribe para buscar el cliente..."
              value={clienteId ? clienteNombre : busquedaCli}
              onChange={(e) => { setBusquedaCli(e.target.value); setClienteId(''); setResultado(null); }}
            />
            {!clienteId && clientesFiltrados.length > 0 && (
              <div className="acc-lista">
                {clientesFiltrados.map((c) => (
                  <div key={c.id} className="acc-opcion" onMouseDown={() => { setClienteId(String(c.id)); setClienteNombre(String(c.nombre || '')); }}>
                    {String(c.nombre || '(sin nombre)')}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="btn btn-primary acc-btn-auditar" disabled={!clienteId || cargando} onClick={auditar}>
            {cargando ? 'Auditando…' : 'Auditar'}
          </button>
          {resultado && (
            <button type="button" className="btn btn-outline acc-btn-excel" onClick={descargarExcel}>⬇ Excel del reporte</button>
          )}
        </div>

        {resultado && (
          <div className="acc-cuerpo">
            <div className="acc-tarjetas">
              <div className={`acc-tarjeta ${resultado.problemas === 0 ? 'acc-tarjeta--ok' : 'acc-tarjeta--mal'}`}>
                <span className="acc-tarjeta-num">{resultado.problemas === 0 ? '✅ 0' : `⚠ ${resultado.problemas}`}</span>
                <span className="acc-tarjeta-lbl">problema(s) detectado(s)</span>
              </div>
              <div className="acc-tarjeta"><span className="acc-tarjeta-num">{money(resultado.totales.hoy)}</span><span className="acc-tarjeta-lbl">operaciones HOY (conversión)</span></div>
              <div className="acc-tarjeta"><span className="acc-tarjeta-num">{money(resultado.totales.facturado)}</span><span className="acc-tarjeta-lbl">facturado (conversión)</span></div>
              <div className="acc-tarjeta"><span className="acc-tarjeta-num">{money(resultado.totales.aplicado)}</span><span className="acc-tarjeta-lbl">aplicado por pagos</span></div>
            </div>

            <h4 className="acc-seccion">Operaciones ({resultado.ops.length})</h4>
            <div className="acc-marco">
              <table className="acc-tabla">
                <thead><tr><th>REF</th><th>FECHA</th><th>STATUS</th><th>MONTO HOY</th><th>FACTURA(S)</th><th>EN FACTURA</th><th>DIF</th><th>VEREDICTO</th></tr></thead>
                <tbody>
                  {resultado.ops.map((x, i) => (
                    <tr key={`op_${i}`} className={CLASE_OP[x.veredicto]}>
                      <td className="acc-ref">{x.ref}</td><td>{x.fecha}</td><td>{x.status || '—'}</td>
                      <td className="acc-monto">{money(x.montoHoy)}</td><td>{x.invoices || '—'}</td>
                      <td className="acc-monto">{x.montoEnFactura === null ? '—' : money(x.montoEnFactura)}</td>
                      <td className="acc-monto">{x.dif === null ? '—' : money(x.dif)}</td>
                      <td className="acc-detalle">{x.detalle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 className="acc-seccion">Facturas y sus pagos ({resultado.facturas.length})</h4>
            <div className="acc-marco">
              <table className="acc-tabla">
                <thead><tr><th>INVOICE</th><th>FECHA</th><th>TOTAL</th><th>MONEDA</th><th>CONVERSIÓN</th><th>APLICADO</th><th>PAGADO REG.</th><th>SALDO</th><th>PAGOS</th><th>VEREDICTO</th></tr></thead>
                <tbody>
                  {resultado.facturas.map((x, i) => (
                    <tr key={`fa_${i}`} className={CLASE_FA[x.veredicto]}>
                      <td className="acc-ref">{x.invoice}</td><td>{x.fecha}</td>
                      <td className="acc-monto">{money(x.totalNativo)}</td><td>{x.moneda || '—'}</td>
                      <td className="acc-monto">{money(x.conversion)}</td><td className="acc-monto">{money(x.aplicadoPagos)}</td>
                      <td className="acc-monto">{money(x.montoPagado)}</td><td className="acc-monto">{money(x.saldo)}</td>
                      <td>{x.pagos || '—'}</td><td className="acc-detalle">{x.detalle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
