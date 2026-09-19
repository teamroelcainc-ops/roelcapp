// src/features/facturacion/components/AuditoriaCadenaCliente.tsx
// ---------------------------------------------------------------------------
// ✅ V00318: AUDITORÍA DE LA CADENA Operación → Factura → Pago, por cliente.
// ✅ V00320: TRES COLUMNAS (Operaciones | Facturación | Pagos), cada una con
//   su propio scroll vertical. Al SELECCIONAR una operación se ilumina el
//   CAMINO que tomó: su(s) factura(s) en la columna de Facturación y los
//   pagos que las cubrieron en la columna de Pagos. Cada tarjeta muestra su
//   MONEDA (la del cliente aparece junto a su nombre).
// Los montos se comparan en la escala de CONVERSIÓN (pesos) usando LAS
// MISMAS funciones de cálculo del dashboard de Facturación (por props).
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
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
  id: string; ref: string; fecha: string; status: string; moneda: string;
  montoHoy: number; facturaIds: string[]; invoices: string;
  montoEnFactura: number | null; dif: number | null;
  veredicto: 'ok' | 'cambio' | 'sinFacturar' | 'varias' | 'sinDesglose' | 'cancelada';
  detalle: string;
}
interface FilaFactura {
  id: string; invoice: string; fecha: string; moneda: string;
  totalNativo: number; conversion: number; aplicadoPagos: number;
  montoPagado: number; saldo: number; pagoIds: string[]; pagos: string;
  veredicto: 'pagada' | 'saldo' | 'descuadre' | 'deMas';
  detalle: string;
}
interface FilaPago {
  id: string; numeroPago: string; fecha: string; metodo: string; moneda: string;
  monto: number; facturaIds: string[]; invoices: string;
}

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const normTxt = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
/** Resuelve id de catálogo o texto libre a USD / MXN (o el texto tal cual). */
const nombreMoneda = (v: unknown): string => {
  const t = normTxt(v);
  if (!t) return '—';
  if (t === ID_USD || t === 'usd' || t === 'us$' || t === 'dls' || t.startsWith('dolar')) return 'USD';
  if (t === ID_MXN || t === 'mxn' || t === 'mn' || t.startsWith('peso')) return 'MXN';
  return String(v);
};

export const AuditoriaCadenaCliente = ({ onCerrar, montoOperacion, totalNativo }: Props) => {
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [busquedaCli, setBusquedaCli] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [clienteNombre, setClienteNombre] = useState('');
  const [monedaCliente, setMonedaCliente] = useState('');
  const [cargando, setCargando] = useState(false);
  const [opSel, setOpSel] = useState('');
  const [resultado, setResultado] = useState<{ ops: FilaOp[]; facturas: FilaFactura[]; pagos: FilaPago[]; totales: { hoy: number; facturado: number; aplicado: number }; problemas: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // ✅ V00319: el buscador ofrece SOLO clientes que PAGAN — por su tipo
        //   de empresa "Cliente (Paga)" del catálogo, con respaldo para los
        //   que aún no tienen tipo pero SÍ tienen tarifario de clientes.
        const [snapEmp, snapTipos, snapTari] = await Promise.all([
          getDocs(collection(db, 'empresas')),
          getDocs(collection(db, 'catalogo_tipo_empresa')),
          getDocs(collection(db, 'tarifario_clientes')),
        ]);
        const idsTipoPaga = new Set(
          snapTipos.docs
            .filter((d) => { const n = normTxt((d.data() as any).nombre || (d.data() as any).tipo || (d.data() as any).descripcion); return n.includes('cliente') && n.includes('paga'); })
            .map((d) => d.id)
        );
        const conTarifario = new Set(
          snapTari.docs.map((d) => String((d.data() as any).clienteId || '').trim()).filter(Boolean)
        );
        const contiene = (campo: any, id: string): boolean => {
          if (!campo) return false;
          if (Array.isArray(campo)) return campo.map((x) => String(x)).includes(id);
          return String(campo).includes(id);
        };
        const lista = snapEmp.docs.map((d) => ({ id: d.id, ...d.data() } as any));
        setEmpresas(lista.filter((e) =>
          [...idsTipoPaga].some((id) => contiene(e.tiposEmpresa, id)) || conTarifario.has(String(e.id))
        ));
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
    setOpSel('');
    try {
      const [snapOps, snapFact, snapPagos] = await Promise.all([
        getDocs(query(collection(db, 'operaciones'), where('clientePaga', '==', clienteId))),
        getDocs(query(collection(db, 'facturas_clientes'), where('clienteId', '==', clienteId))),
        getDocs(query(collection(db, 'pagos'), where('tipo', '==', 'cliente'), where('entidadId', '==', clienteId))),
      ]);
      const ops = snapOps.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      let facturas = snapFact.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      if (facturas.length === 0 && clienteNombre) {
        try {
          const snapNom = await getDocs(query(collection(db, 'facturas_clientes'), where('clienteNombre', '==', clienteNombre)));
          facturas = snapNom.docs.map((d) => ({ id: d.id, ...d.data() } as any));
        } catch { /* sin respaldo */ }
      }
      const pagos = snapPagos.docs.map((d) => ({ id: d.id, ...d.data() } as any));

      // Índices del camino: facturas por operación, y pagos por factura.
      const facturasPorOp = new Map<string, any[]>();
      facturas.forEach((f) => {
        const guardadas = Array.isArray(f.operacionesGuardadas) ? f.operacionesGuardadas : [];
        const claves = new Set<string>();
        guardadas.forEach((g: any) => { if (g?.id) claves.add(String(g.id)); if (g?.ref) claves.add(String(g.ref)); });
        (Array.isArray(f.operacionesIds) ? f.operacionesIds : []).forEach((x: any) => claves.add(String(x)));
        (Array.isArray(f.operaciones) ? f.operaciones : []).forEach((x: any) => { if (typeof x === 'string') claves.add(x); });
        claves.forEach((k) => { const arr = facturasPorOp.get(k) || []; arr.push(f); facturasPorOp.set(k, arr); });
      });
      const aplicadoPorFactura = new Map<string, { suma: number; numeros: string[]; pagoIds: string[] }>();
      pagos.forEach((p) => {
        (Array.isArray(p.facturas) ? p.facturas : []).forEach((fa: any) => {
          const fid = String(fa?.facturaId || '');
          if (!fid) return;
          const reg = aplicadoPorFactura.get(fid) || { suma: 0, numeros: [], pagoIds: [] };
          reg.suma += Number(fa?.aplicado) || 0;
          const num = String(p.numeroPago || p.id);
          if (!reg.numeros.includes(num)) reg.numeros.push(num);
          if (!reg.pagoIds.includes(String(p.id))) reg.pagoIds.push(String(p.id));
          aplicadoPorFactura.set(fid, reg);
        });
      });

      // COLUMNA 1 — operación por operación.
      const filasOps: FilaOp[] = ops
        .sort((a, b) => String(b.fechaServicio || '').localeCompare(String(a.fechaServicio || '')))
        .map((op) => {
          const status = String(op.statusNombre || op.status || '');
          const cancelada = status.toLowerCase().includes('cancel');
          const hoy = r2(montoOperacion(op).conv);
          const facs = (facturasPorOp.get(String(op.id)) || []).concat(facturasPorOp.get(String(op.ref || '')) || [])
            .filter((f, i, arr) => arr.findIndex((x) => x.id === f.id) === i);
          const base: Omit<FilaOp, 'veredicto' | 'detalle'> = {
            id: String(op.id), ref: String(op.ref || op.id), fecha: String(op.fechaServicio || ''), status,
            moneda: nombreMoneda(op.monedaConvenioCliente || op.facturadoEnCobrar),
            montoHoy: hoy, facturaIds: facs.map((f) => String(f.id)),
            invoices: facs.map((f) => String(f.invoice || f.id)).join(', '),
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

      // COLUMNA 2 — factura por factura contra sus pagos.
      const filasFacturas: FilaFactura[] = facturas
        .sort((a, b) => String(b.fecha || b.fechaFactura || '').localeCompare(String(a.fecha || a.fechaFactura || '')))
        .map((f) => {
          const totalN = r2(totalNativo(f));
          const conversion = r2(Number(f.subtotalFactura) || Number(f.total) || 0);
          const reg = aplicadoPorFactura.get(String(f.id)) || { suma: 0, numeros: [], pagoIds: [] };
          const aplicado = r2(reg.suma);
          const montoPagado = r2(Number(f.montoPagado) || 0);
          const saldo = r2(Number(f.saldoPendiente ?? (totalN - montoPagado)));
          const base: Omit<FilaFactura, 'veredicto' | 'detalle'> = {
            id: String(f.id), invoice: String(f.invoice || f.numeroInvoice || f.folio || f.id),
            fecha: String(f.fecha || f.fechaFactura || ''), moneda: nombreMoneda(f.monedaFacturacion || f.moneda || f.monedaId),
            totalNativo: totalN, conversion, aplicadoPagos: aplicado, montoPagado, saldo,
            pagoIds: reg.pagoIds, pagos: reg.numeros.join(', '),
          };
          if (Math.abs(aplicado - montoPagado) > 0.01) return { ...base, veredicto: 'descuadre', detalle: `Los pagos aplicados (${money(aplicado)}) NO cuadran con el pagado registrado (${money(montoPagado)})` };
          if (aplicado - totalN > 0.01) return { ...base, veredicto: 'deMas', detalle: `Pagada DE MÁS: aplicado ${money(aplicado)} vs total ${money(totalN)}` };
          if (saldo > 0.01) return { ...base, veredicto: 'saldo', detalle: `Saldo pendiente de ${money(saldo)}` };
          return { ...base, veredicto: 'pagada', detalle: 'Pagada y los montos cuadran' };
        });

      // COLUMNA 3 — los pagos del cliente.
      const filasPagos: FilaPago[] = pagos
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
        .map((p) => {
          const aplicaciones = Array.isArray(p.facturas) ? p.facturas : [];
          return {
            id: String(p.id), numeroPago: String(p.numeroPago || p.id), fecha: String(p.fecha || ''),
            metodo: String(p.metodoPago || ''), moneda: nombreMoneda(p.moneda),
            monto: r2(Number(p.monto) || 0),
            facturaIds: aplicaciones.map((fa: any) => String(fa?.facturaId || '')).filter(Boolean),
            invoices: aplicaciones.map((fa: any) => String(fa?.invoice || fa?.facturaId || '')).filter(Boolean).join(', '),
          };
        });

      const totales = {
        hoy: r2(filasOps.filter((x) => x.veredicto !== 'cancelada').reduce((s, x) => s + x.montoHoy, 0)),
        facturado: r2(filasFacturas.reduce((s, x) => s + x.conversion, 0)),
        aplicado: r2(filasFacturas.reduce((s, x) => s + x.aplicadoPagos, 0)),
      };
      const problemas = filasOps.filter((x) => x.veredicto === 'cambio' || x.veredicto === 'sinFacturar' || x.veredicto === 'varias' || (x.veredicto === 'cancelada' && x.invoices)).length
        + filasFacturas.filter((x) => x.veredicto === 'descuadre' || x.veredicto === 'deMas').length;
      setResultado({ ops: filasOps, facturas: filasFacturas, pagos: filasPagos, totales, problemas });
    } catch (e) {
      console.error('Auditoría de la cadena:', e);
      alert('No se pudo completar la auditoría. Revisa la consola.');
    } finally {
      setCargando(false);
    }
  };

  // ✅ V00320: el CAMINO de la operación seleccionada — facturas y pagos.
  const camino = useMemo(() => {
    if (!opSel || !resultado) return { facturas: new Set<string>(), pagos: new Set<string>() };
    const op = resultado.ops.find((x) => x.id === opSel);
    if (!op) return { facturas: new Set<string>(), pagos: new Set<string>() };
    const facturasSet = new Set(op.facturaIds);
    const pagosSet = new Set<string>();
    resultado.facturas.forEach((f) => { if (facturasSet.has(f.id)) f.pagoIds.forEach((p) => pagosSet.add(p)); });
    return { facturas: facturasSet, pagos: pagosSet };
  }, [opSel, resultado]);

  const descargarExcel = () => {
    if (!resultado) return;
    const wb = XLSX.utils.book_new();
    const hojaOps = resultado.ops.map((x) => ({
      'Referencia': x.ref, 'Fecha Servicio': x.fecha, 'Status': x.status, 'Moneda Operación': x.moneda,
      'Monto HOY (conversión)': x.montoHoy, 'Factura(s)': x.invoices,
      'Monto en Factura': x.montoEnFactura ?? '', 'Diferencia': x.dif ?? '', 'Veredicto': x.detalle,
    }));
    const hojaFact = resultado.facturas.map((x) => ({
      'Invoice': x.invoice, 'Fecha': x.fecha, 'Moneda': x.moneda, 'Total (moneda factura)': x.totalNativo,
      'Conversión (pesos)': x.conversion, 'Aplicado por Pagos': x.aplicadoPagos, 'Pagado Registrado': x.montoPagado,
      'Saldo': x.saldo, 'Pagos': x.pagos, 'Veredicto': x.detalle,
    }));
    const hojaPagos = resultado.pagos.map((x) => ({
      '# Pago': x.numeroPago, 'Fecha': x.fecha, 'Método': x.metodo, 'Moneda': x.moneda,
      'Monto': x.monto, 'Facturas': x.invoices,
    }));
    const hojaTot = [
      { 'Concepto': 'Moneda del cliente', 'Monto': monedaCliente || '—' },
      { 'Concepto': 'Total operaciones HOY (conversión, sin canceladas)', 'Monto': resultado.totales.hoy },
      { 'Concepto': 'Total facturado (conversión)', 'Monto': resultado.totales.facturado },
      { 'Concepto': 'Total aplicado por pagos', 'Monto': resultado.totales.aplicado },
      { 'Concepto': 'Problemas detectados', 'Monto': resultado.problemas },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaOps.length ? hojaOps : [{ 'Sin registros': '' }]), 'Operaciones');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaFact.length ? hojaFact : [{ 'Sin registros': '' }]), 'Facturación');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaPagos.length ? hojaPagos : [{ 'Sin registros': '' }]), 'Pagos');
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
            <p className="acc-sub">Selecciona una operación para iluminar el camino que tomó: su factura y sus pagos.</p>
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
                  <div key={c.id} className="acc-opcion" onMouseDown={() => { setClienteId(String(c.id)); setClienteNombre(String(c.nombre || '')); setMonedaCliente(nombreMoneda(c.moneda)); }}>
                    {String(c.nombre || '(sin nombre)')}
                  </div>
                ))}
              </div>
            )}
          </div>
          {clienteId && <span className="acc-moneda-cliente" title="Moneda configurada en la ficha del cliente">Moneda del cliente: <b>{monedaCliente || '—'}</b></span>}
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

            <div className="acc-columnas">
              {/* ───────── COLUMNA 1: OPERACIONES ───────── */}
              <div className="acc-col">
                <div className="acc-col-titulo">Operaciones ({resultado.ops.length})</div>
                <div className="acc-col-scroll">
                  {resultado.ops.length === 0 && <p className="acc-vacio">Sin operaciones.</p>}
                  {resultado.ops.map((x) => (
                    <div
                      key={x.id}
                      className={`acc-item ${CLASE_OP[x.veredicto]}${opSel === x.id ? ' acc-item--sel' : ''}`}
                      title="Clic para iluminar el camino de esta operación (factura y pagos)"
                      onClick={() => setOpSel((prev) => prev === x.id ? '' : x.id)}
                    >
                      <div className="acc-item-fila1">
                        <span className="acc-ref">{x.ref}</span>
                        <span className="acc-chip-moneda">{x.moneda}</span>
                        <span className="acc-monto">{money(x.montoHoy)}</span>
                      </div>
                      <div className="acc-item-fila2">{x.fecha || '—'} · {x.status || '—'}</div>
                      {x.montoEnFactura !== null && x.dif !== null && Math.abs(x.dif) > 0.01 && (
                        <div className="acc-item-fila2">En factura: <b>{money(x.montoEnFactura)}</b> · dif <b>{money(x.dif)}</b></div>
                      )}
                      <div className="acc-item-detalle">{x.detalle}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ───────── COLUMNA 2: FACTURACIÓN ───────── */}
              <div className="acc-col">
                <div className="acc-col-titulo">Facturación ({resultado.facturas.length})</div>
                <div className="acc-col-scroll">
                  {resultado.facturas.length === 0 && <p className="acc-vacio">Sin facturas.</p>}
                  {resultado.facturas.map((x) => (
                    <div key={x.id} className={`acc-item ${CLASE_FA[x.veredicto]}${camino.facturas.has(x.id) ? ' acc-item--camino' : ''}${opSel && !camino.facturas.has(x.id) ? ' acc-item--apagado' : ''}`}>
                      <div className="acc-item-fila1">
                        <span className="acc-ref">{x.invoice}</span>
                        <span className="acc-chip-moneda">{x.moneda}</span>
                        <span className="acc-monto">{money(x.totalNativo)}</span>
                      </div>
                      <div className="acc-item-fila2">{x.fecha || '—'} · conversión {money(x.conversion)}</div>
                      <div className="acc-item-fila2">Pagado {money(x.montoPagado)} · saldo <b>{money(x.saldo)}</b>{x.pagos ? ` · pagos: ${x.pagos}` : ''}</div>
                      <div className="acc-item-detalle">{x.detalle}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ───────── COLUMNA 3: PAGOS ───────── */}
              <div className="acc-col">
                <div className="acc-col-titulo">Pagos ({resultado.pagos.length})</div>
                <div className="acc-col-scroll">
                  {resultado.pagos.length === 0 && <p className="acc-vacio">Sin pagos.</p>}
                  {resultado.pagos.map((x) => (
                    <div key={x.id} className={`acc-item${camino.pagos.has(x.id) ? ' acc-item--camino' : ''}${opSel && !camino.pagos.has(x.id) ? ' acc-item--apagado' : ''}`}>
                      <div className="acc-item-fila1">
                        <span className="acc-ref">{x.numeroPago}</span>
                        <span className="acc-chip-moneda">{x.moneda}</span>
                        <span className="acc-monto">{money(x.monto)}</span>
                      </div>
                      <div className="acc-item-fila2">{x.fecha || '—'} · {x.metodo || '—'}</div>
                      <div className="acc-item-detalle">Facturas: {x.invoices || '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
