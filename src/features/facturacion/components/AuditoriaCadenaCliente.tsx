// src/features/facturacion/components/AuditoriaCadenaCliente.tsx
// ---------------------------------------------------------------------------
// ✅ V00318: AUDITORÍA DE LA CADENA Operación → Factura → Pago, por cliente.
// ✅ V00320: tres columnas con scroll propio + camino iluminado + monedas.
// ✅ V00321: EN VIVO (onSnapshot: editar cualquier pieza se refleja al
//   momento, como base relacional) · botones 👁 detalle y ✎ editar en cada
//   tarjeta (operación abre el formulario real de edición; factura y pago un
//   editor directo de sus campos seguros) · clic en la tarjeta de PROBLEMAS
//   resalta todo lo problemático en las tres columnas · la moneda que NO
//   concuerda con la del cliente se marca en ámbar.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';
import { EditorOperacionEmbebido } from '../../operaciones/components/EditorOperacionEmbebido';
import './AuditoriaCadenaCliente.css';

/* eslint-disable @typescript-eslint/no-explicit-any -- docs de Firestore sin tipo canónico (mismo criterio del módulo de Facturación). */

type MontoOp = { conv: number; total: number; dol: number; pes: number; tc: number };

interface Props {
  onCerrar: () => void;
  montoOperacion: (op: any) => MontoOp;
  totalNativo: (f: any) => number;
}

interface FilaOp {
  id: string; ref: string; fecha: string; status: string; moneda: string;
  montoHoy: number; facturaIds: string[]; invoices: string;
  montoEnFactura: number | null; dif: number | null;
  veredicto: 'ok' | 'cambio' | 'sinFacturar' | 'varias' | 'sinDesglose' | 'cancelada';
  detalle: string; raw: any; revisado: boolean;
}
interface FilaFactura {
  id: string; invoice: string; fecha: string; moneda: string;
  totalNativo: number; conversion: number; aplicadoPagos: number;
  montoPagado: number; saldo: number; pagoIds: string[]; pagos: string;
  veredicto: 'pagada' | 'saldo' | 'descuadre' | 'deMas';
  detalle: string; raw: any; revisado: boolean;
}
interface FilaPago {
  id: string; numeroPago: string; fecha: string; metodo: string; moneda: string;
  monto: number; facturaIds: string[]; invoices: string; raw: any; revisado: boolean;
}

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const normTxt = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
/** Fecha a ISO aaaa-mm-dd (acepta ISO o d/m/aaaa de las migradas). */
const fechaISO = (v: unknown): string => {
  const t = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
};

const nombreMoneda = (v: unknown): string => {
  const t = normTxt(v);
  if (!t) return '—';
  if (t === ID_USD || t === 'usd' || t === 'us$' || t === 'dls' || t.startsWith('dolar')) return 'USD';
  if (t === ID_MXN || t === 'mxn' || t === 'mn' || t.startsWith('peso')) return 'MXN';
  return String(v);
};

/** ✅ V00324: detalle LEGIBLE de la operación — los mismos datos que se ven
 *  en el módulo de operaciones (nombres, no ids), con opción de ver todos
 *  los campos crudos. */
const DetalleOperacion = ({ op, onCerrar }: { op: any; onCerrar: () => void }) => {
  const [verTodo, setVerTodo] = useState(false);
  const fila = (etiqueta: string, valor: unknown) => {
    const v = String(valor ?? '').trim();
    if (!v || v === '—') return null;
    return (<tr><td className="acc-detalle-campo">{etiqueta}</td><td className="acc-detalle-valor">{v}</td></tr>);
  };
  const monto = (n: unknown) => { const x = Number(n); return Number.isFinite(x) && x !== 0 ? `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''; };
  return (
    <div className="modal-overlay acc-overlay-2" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="form-card acc-detalle-modal">
        <div className="acc-encabezado">
          <h3 className="acc-titulo">👁 Operación {String(op.ref || op.id)}</h3>
          <div className="acc-acciones">
            <button type="button" className={`acc-mini${verTodo ? ' acc-mini--revisado' : ''}`} title="Alternar entre el detalle legible y TODOS los campos" onClick={() => setVerTodo((v) => !v)}>{verTodo ? 'Ver resumen' : 'Ver todos los campos'}</button>
            <button type="button" className="roelca-window-btn danger" title="Cerrar" onClick={onCerrar}>✕</button>
          </div>
        </div>
        {verTodo ? (
          <div className="acc-detalle-scroll">
            <table className="acc-detalle-tabla"><tbody>
              {Object.entries(op || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
                <tr key={k}><td className="acc-detalle-campo">{k}</td><td className="acc-detalle-valor">{v === null || v === undefined || v === '' ? '—' : (typeof v === 'object' ? JSON.stringify(v).slice(0, 400) : String(v))}</td></tr>
              ))}
            </tbody></table>
          </div>
        ) : (
          <div className="acc-detalle-scroll">
            <table className="acc-detalle-tabla"><tbody>
              {fila('Referencia', op.ref)}
              {fila('Fecha de servicio', op.fechaServicio)}
              {fila('Status', op.statusNombre)}
              {fila('Tipo de operación', op.tipoOperacionNombre)}
              {fila('Cliente (Paga)', op.clienteNombre)}
              {fila('Cliente (Mercancía)', op.clienteMercanciaNombre)}
              {fila('Convenio', op.convenioNombre)}
              {fila('Cargada / Vacía', op.carga)}
              {fila('Impo / Expo', op.trafico)}
              {fila('Aduana', op.aduanaNombre)}
              {fila('Origen', op.origenNombre)}
              {fila('Destino', op.destinoNombre)}
              {fila('# Remolque', op.numeroRemolqueNombre || op.numeroRemolque)}
              {fila('Operador', op.operadorNombre)}
              {fila('Ref. Cliente', op.refCliente)}
              {fila('Monto Cliente (convenio)', monto(op.montoConvenioCliente))}
              {fila('Conversión Cliente (pesos)', monto(op.conversionCliente))}
              {fila('Cargos adicionales', monto(op.cargosAdicionales))}
              {fila('Proveedor', op.proveedorNombre)}
              {fila('Convenio Proveedor', op.convenioProveedorNombre)}
              {fila('Total a pagar Proveedor', monto(op.totalAPagarProv))}
              {fila('Conversión Proveedor (pesos)', monto(op.conversionProv))}
              {fila('Tipo de cambio', op.tipoCambio)}
              {fila('Observaciones ejecutivo', op.observacionesEjecutivo)}
              {fila('Creado por', op.creadoPor)}
            </tbody></table>
          </div>
        )}
      </div>
    </div>
  );
};

/** Detalle legible de cualquier documento (pares campo → valor). */
const DetalleDoc = ({ titulo, docu, onCerrar }: { titulo: string; docu: any; onCerrar: () => void }) => {
  const valor = (v: any): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (Array.isArray(v)) return v.length === 0 ? '—' : `${v.length} elemento(s): ${JSON.stringify(v).slice(0, 400)}`;
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 400);
    return String(v);
  };
  const entradas = Object.entries(docu || {}).filter(([k]) => k !== 'raw').sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="modal-overlay acc-overlay-2" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="form-card acc-detalle-modal">
        <div className="acc-encabezado">
          <h3 className="acc-titulo">👁 {titulo}</h3>
          <button type="button" className="roelca-window-btn danger" title="Cerrar" onClick={onCerrar}>✕</button>
        </div>
        <div className="acc-detalle-scroll">
          <table className="acc-detalle-tabla">
            <tbody>
              {entradas.map(([k, v]) => (
                <tr key={k}><td className="acc-detalle-campo">{k}</td><td className="acc-detalle-valor">{valor(v)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const AuditoriaCadenaCliente = ({ onCerrar, montoOperacion, totalNativo }: Props) => {
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [busquedaCli, setBusquedaCli] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [clienteNombre, setClienteNombre] = useState('');
  const [monedaCliente, setMonedaCliente] = useState('');
  // ✅ V00324: rango de fechas — aplica a la FECHA DE SERVICIO de las operaciones.
  const [rangoIni, setRangoIni] = useState('');
  const [rangoFin, setRangoFin] = useState('');
  const [aud, setAud] = useState<{ id: string; nombre: string } | null>(null);
  // ✅ V00323: selección TRIDIRECCIONAL — operación, factura o pago.
  const [sel, setSel] = useState<{ tipo: 'op' | 'fact' | 'pago'; id: string } | null>(null);
  const [modoProblemas, setModoProblemas] = useState(false);
  // Estado en vivo (onSnapshot) del cliente auditado.
  const [opsRaw, setOpsRaw] = useState<any[] | null>(null);
  const [factRawId, setFactRawId] = useState<any[]>([]);
  const [factRawNom, setFactRawNom] = useState<any[]>([]);
  const [pagosRaw, setPagosRaw] = useState<any[] | null>(null);
  // Detalle y editores.
  const [detalle, setDetalle] = useState<{ titulo: string; docu: any } | null>(null);
  const [detalleOp, setDetalleOp] = useState<any | null>(null); // ✅ V00324: detalle legible de operación
  const [opEditandoId, setOpEditandoId] = useState('');
  const [factEdit, setFactEdit] = useState<any | null>(null);
  const [pagoEdit, setPagoEdit] = useState<any | null>(null);
  const [guardandoEdit, setGuardandoEdit] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // ✅ V00319: SOLO clientes que PAGAN (tipo del catálogo + respaldo por tarifario).
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
        const conTarifario = new Set(snapTari.docs.map((d) => String((d.data() as any).clienteId || '').trim()).filter(Boolean));
        const contiene = (campo: any, id: string): boolean => {
          if (!campo) return false;
          if (Array.isArray(campo)) return campo.map((x) => String(x)).includes(id);
          return String(campo).includes(id);
        };
        const lista = snapEmp.docs.map((d) => ({ id: d.id, ...d.data() } as any));
        setEmpresas(lista.filter((e) => [...idsTipoPaga].some((id) => contiene(e.tiposEmpresa, id)) || conTarifario.has(String(e.id))));
      } catch (e) { console.error('Auditoría: empresas', e); }
    })();
  }, []);

  // ✅ V00321: BASE RELACIONAL EN VIVO — mientras hay un cliente auditado, sus
  //   operaciones, facturas y pagos se escuchan con onSnapshot: editar
  //   CUALQUIER pieza (aquí o en su módulo) se refleja al momento.
  useEffect(() => {
    if (!aud) return;
    setOpsRaw(null); setPagosRaw(null); setFactRawId([]); setFactRawNom([]);
    const mapear = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    const subs = [
      onSnapshot(query(collection(db, 'operaciones'), where('clientePaga', '==', aud.id)), (s) => setOpsRaw(mapear(s)), (e) => console.error('Auditoría ops:', e)),
      onSnapshot(query(collection(db, 'facturas_clientes'), where('clienteId', '==', aud.id)), (s) => setFactRawId(mapear(s)), (e) => console.error('Auditoría facturas:', e)),
      onSnapshot(query(collection(db, 'pagos'), where('tipo', '==', 'cliente'), where('entidadId', '==', aud.id)), (s) => setPagosRaw(mapear(s)), (e) => console.error('Auditoría pagos:', e)),
    ];
    if (aud.nombre) {
      subs.push(onSnapshot(query(collection(db, 'facturas_clientes'), where('clienteNombre', '==', aud.nombre)), (s) => setFactRawNom(mapear(s)), () => { /* respaldo opcional */ }));
    }
    return () => subs.forEach((u) => u());
  }, [aud]);

  const facturasRaw = useMemo(() => {
    const m = new Map<string, any>();
    [...factRawId, ...factRawNom].forEach((f) => m.set(String(f.id), f));
    return Array.from(m.values());
  }, [factRawId, factRawNom]);

  const cargando = !!aud && (opsRaw === null || pagosRaw === null);

  // ✅ V00321: el cálculo vive en un useMemo — cada snapshot lo recalcula.
  const resultado = useMemo(() => {
    if (!aud || opsRaw === null || pagosRaw === null) return null;
    // ✅ V00324: el rango de fechas filtra LAS OPERACIONES (por fecha de
    //   servicio); facturas y pagos del cliente se muestran completos.
    const ops = opsRaw.filter((op) => {
      if (!rangoIni && !rangoFin) return true;
      const iso = fechaISO(op.fechaServicio);
      if (!iso) return true; // sin fecha legible no se excluye
      if (rangoIni && iso < rangoIni) return false;
      if (rangoFin && iso > rangoFin) return false;
      return true;
    });
    const facturas = facturasRaw; const pagos = pagosRaw;

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
          montoEnFactura: null, dif: null, raw: op, revisado: !!op.auditRevisado,
        };
        if (cancelada) return { ...base, veredicto: 'cancelada' as const, detalle: facs.length > 0 ? '⚠ Cancelada pero aparece en factura' : 'Cancelada (no requiere factura)' };
        if (facs.length === 0) return { ...base, veredicto: 'sinFacturar' as const, detalle: 'Sin facturar' };
        if (facs.length > 1) return { ...base, veredicto: 'varias' as const, detalle: `En ${facs.length} facturas (revisar posible doble cobro)` };
        const g = (Array.isArray(facs[0].operacionesGuardadas) ? facs[0].operacionesGuardadas : [])
          .find((x: any) => String(x?.id) === String(op.id) || String(x?.ref) === String(op.ref || ''));
        const enFactura = g ? r2(Number(g.monto) || 0) : null;
        if (enFactura === null || enFactura === 0) return { ...base, veredicto: 'sinDesglose' as const, detalle: 'Factura sin desglose por operación (solo se compara el total de la factura)' };
        const dif = r2(hoy - enFactura);
        if (Math.abs(dif) > 0.01) return { ...base, montoEnFactura: enFactura, dif, veredicto: 'cambio' as const, detalle: `La operación cambió DESPUÉS de facturarse: hoy ${money(hoy)} vs facturado ${money(enFactura)} (dif ${money(dif)})` };
        return { ...base, montoEnFactura: enFactura, dif: 0, veredicto: 'ok' as const, detalle: 'Facturada y el monto coincide' };
      });

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
          pagoIds: reg.pagoIds, pagos: reg.numeros.join(', '), raw: f, revisado: !!f.auditRevisado,
        };
        if (Math.abs(aplicado - montoPagado) > 0.01) return { ...base, veredicto: 'descuadre' as const, detalle: `Los pagos aplicados (${money(aplicado)}) NO cuadran con el pagado registrado (${money(montoPagado)})` };
        if (aplicado - totalN > 0.01) return { ...base, veredicto: 'deMas' as const, detalle: `Pagada DE MÁS: aplicado ${money(aplicado)} vs total ${money(totalN)}` };
        if (saldo > 0.01) return { ...base, veredicto: 'saldo' as const, detalle: `Saldo pendiente de ${money(saldo)}` };
        return { ...base, veredicto: 'pagada' as const, detalle: 'Pagada y los montos cuadran' };
      });

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
          raw: p, revisado: !!p.auditRevisado,
        };
      });

    const totales = {
      hoy: r2(filasOps.filter((x) => x.veredicto !== 'cancelada').reduce((s, x) => s + x.montoHoy, 0)),
      facturado: r2(filasFacturas.reduce((s, x) => s + x.conversion, 0)),
      aplicado: r2(filasFacturas.reduce((s, x) => s + x.aplicadoPagos, 0)),
    };
    const esOpProblema = (x: FilaOp) => x.veredicto === 'cambio' || x.veredicto === 'sinFacturar' || x.veredicto === 'varias' || (x.veredicto === 'cancelada' && !!x.invoices);
    const esFactProblema = (x: FilaFactura) => x.veredicto === 'descuadre' || x.veredicto === 'deMas';
    const facturasProblema = new Set(filasFacturas.filter(esFactProblema).map((x) => x.id));
    const pagosProblema = new Set<string>();
    filasFacturas.forEach((f) => { if (facturasProblema.has(f.id)) f.pagoIds.forEach((p) => pagosProblema.add(p)); });
    const opsProblema = new Set(filasOps.filter(esOpProblema).map((x) => x.id));
    // Las facturas de las operaciones con problema también son parte del problema.
    filasOps.forEach((o) => { if (opsProblema.has(o.id)) o.facturaIds.forEach((fid) => facturasProblema.add(fid)); });
    const problemas = opsProblema.size + filasFacturas.filter(esFactProblema).length;
    // ✅ V00323: ORDEN — con errores o fallas AL INICIO, revisados AL FINAL.
    const peso = (revisado: boolean, esProblema: boolean) => (revisado ? 2 : (esProblema ? 0 : 1));
    filasOps.sort((a, b) => peso(a.revisado, opsProblema.has(a.id)) - peso(b.revisado, opsProblema.has(b.id)) || String(b.fecha).localeCompare(String(a.fecha)));
    filasFacturas.sort((a, b) => peso(a.revisado, facturasProblema.has(a.id)) - peso(b.revisado, facturasProblema.has(b.id)) || String(b.fecha).localeCompare(String(a.fecha)));
    filasPagos.sort((a, b) => peso(a.revisado, pagosProblema.has(a.id)) - peso(b.revisado, pagosProblema.has(b.id)) || String(b.fecha).localeCompare(String(a.fecha)));
    return { ops: filasOps, facturas: filasFacturas, pagos: filasPagos, totales, problemas, opsProblema, facturasProblema, pagosProblema };
  }, [aud, opsRaw, facturasRaw, pagosRaw, rangoIni, rangoFin, montoOperacion, totalNativo]);

  const clientesFiltrados = busquedaCli.trim()
    ? empresas.filter((e) => String(e.nombre || '').toLowerCase().includes(busquedaCli.trim().toLowerCase())).slice(0, 8)
    : [];

  const auditar = () => {
    if (!clienteId) { alert('Elige primero el cliente.'); return; }
    setSel(null); setModoProblemas(false);
    setAud({ id: clienteId, nombre: clienteNombre });
  };

  // ✅ V00323: el CAMINO desde CUALQUIER pieza — operación, factura o pago.
  const camino = useMemo(() => {
    const vacio = { ops: new Set<string>(), facturas: new Set<string>(), pagos: new Set<string>() };
    if (!sel || !resultado) return vacio;
    const opsSet = new Set<string>(); const factSet = new Set<string>(); const pagosSet = new Set<string>();
    if (sel.tipo === 'op') {
      const op = resultado.ops.find((x) => x.id === sel.id);
      if (!op) return vacio;
      opsSet.add(op.id);
      op.facturaIds.forEach((f) => factSet.add(f));
    } else if (sel.tipo === 'fact') {
      factSet.add(sel.id);
    } else {
      const pg = resultado.pagos.find((x) => x.id === sel.id);
      if (!pg) return vacio;
      pagosSet.add(pg.id);
      pg.facturaIds.forEach((f) => factSet.add(f));
    }
    // Las facturas del camino arrastran sus operaciones y sus pagos.
    resultado.ops.forEach((o) => { if (o.facturaIds.some((f) => factSet.has(f))) opsSet.add(o.id); });
    resultado.facturas.forEach((f) => { if (factSet.has(f.id)) f.pagoIds.forEach((p) => pagosSet.add(p)); });
    return { ops: opsSet, facturas: factSet, pagos: pagosSet };
  }, [sel, resultado]);

  // ✅ V00321: moneda que NO concuerda con la del cliente → chip en ámbar.
  const monedaDifiere = (m: string): boolean =>
    (monedaCliente === 'USD' || monedaCliente === 'MXN') && (m === 'USD' || m === 'MXN') && m !== monedaCliente;

  // ✅ V00323: marcar REVISADO (campo auditRevisado en el propio documento —
  //   compartido entre usuarios y en vivo). Los revisados se van al final.
  const marcarRevisado = async (tipo: 'op' | 'fact' | 'pago', id: string, actual: boolean) => {
    const coleccion = tipo === 'op' ? 'operaciones' : tipo === 'fact' ? 'facturas_clientes' : 'pagos';
    try { await updateDoc(doc(db, coleccion, id), { auditRevisado: !actual }); }
    catch (e) { console.error('Marcar revisado:', e); alert('No se pudo marcar como revisado.'); }
  };

  // ── Editores directos (campos seguros; lo profundo se edita en su módulo) ──
  const guardarFactura = async () => {
    if (!factEdit || guardandoEdit) return;
    const total = Number(factEdit._nuevoTotal);
    if (!Number.isFinite(total) || total < 0) { alert('Captura un total válido.'); return; }
    const pagado = Number(factEdit.montoPagado) || 0;
    if (total < pagado - 0.009) { alert(`El total (${money(total)}) no puede ser MENOR a lo ya pagado (${money(pagado)}).\n\nPara bajarlo, primero elimina el/los pagos aplicados en el módulo de Pagos.`); return; }
    setGuardandoEdit(true);
    try {
      await updateDoc(doc(db, 'facturas_clientes', String(factEdit.id)), {
        invoice: String(factEdit._nuevoInvoice || '').trim() || String(factEdit.invoice || ''),
        fecha: String(factEdit._nuevaFecha || factEdit.fecha || ''),
        subtotalFactura: r2(total),
        saldoPendiente: r2(Math.max(0, total - pagado)),
      });
      setFactEdit(null); // el onSnapshot refresca solo
    } catch (e) { console.error('Editar factura:', e); alert('No se pudo guardar la factura.'); }
    finally { setGuardandoEdit(false); }
  };
  const guardarPago = async () => {
    if (!pagoEdit || guardandoEdit) return;
    setGuardandoEdit(true);
    try {
      await updateDoc(doc(db, 'pagos', String(pagoEdit.id)), {
        fecha: String(pagoEdit._nuevaFecha || pagoEdit.fecha || ''),
        metodoPago: String(pagoEdit._nuevoMetodo ?? pagoEdit.metodoPago ?? ''),
        referencia: String(pagoEdit._nuevaRef ?? pagoEdit.referencia ?? ''),
        observaciones: String(pagoEdit._nuevasObs ?? pagoEdit.observaciones ?? ''),
      });
      setPagoEdit(null);
    } catch (e) { console.error('Editar pago:', e); alert('No se pudo guardar el pago.'); }
    finally { setGuardandoEdit(false); }
  };

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
  const claseResaltado = (enCamino: boolean, esProblema: boolean, revisado: boolean): string => {
    let c = revisado ? ' acc-item--revisado' : '';
    if (modoProblemas) c += esProblema ? ' acc-item--problema' : ' acc-item--apagado';
    else if (sel && enCamino) c += ' acc-item--camino';
    return c;
  };
  const BotonRevisado = ({ tipo, id, revisado }: { tipo: 'op' | 'fact' | 'pago'; id: string; revisado: boolean }) => (
    <button type="button" className={`acc-mini${revisado ? ' acc-mini--revisado' : ''}`} title={revisado ? 'Revisado — clic para quitar la marca' : 'Marcar como REVISADO (se va al final de la columna)'} onClick={() => marcarRevisado(tipo, id, revisado)}>✓</button>
  );
  const ChipMoneda = ({ m }: { m: string }) => (
    <span className={`acc-chip-moneda${monedaDifiere(m) ? ' acc-chip-moneda--difiere' : ''}`} title={monedaDifiere(m) ? `⚠ No concuerda con la moneda del cliente (${monedaCliente})` : ''}>
      {monedaDifiere(m) ? '⚠ ' : ''}{m}
    </span>
  );

  return (
    <div className={`modal-overlay acc-overlay${opEditandoId ? ' acc-overlay--detras' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>{/* ✅ V00324: el formulario de operación (portal, z 100) queda AL FRENTE */}
      <div className="form-card acc-modal">
        <div className="acc-encabezado">
          <div>
            <h3 className="acc-titulo">🔍 Auditoría de la cadena — Operación → Factura → Pago</h3>
            <p className="acc-sub">Clic en una operación, factura o pago muestra SOLO su camino (clic de nuevo para volver) · la tarjeta de problemas resalta lo problemático · ✓ revisado se va al final · 👁 detalle · ✎ editar (en vivo).</p>
          </div>
          <button type="button" className="roelca-window-btn danger" title="Cerrar" onClick={onCerrar}>✕</button>
        </div>

        <div className="acc-buscador">
          <div className="acc-lookup">
            <input
              type="text" className="form-control" placeholder="Escribe para buscar el cliente..."
              value={clienteId ? clienteNombre : busquedaCli}
              onChange={(e) => { setBusquedaCli(e.target.value); setClienteId(''); setAud(null); }}
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
          {/* ✅ V00324: rango de fechas (fecha de servicio de las operaciones) */}
          <span className="acc-rango" title="El rango aplica a la FECHA DE SERVICIO de las operaciones; facturas y pagos del cliente se muestran completos">
            Servicio de <input type="date" className="form-control acc-rango-input" value={rangoIni} onChange={(e) => setRangoIni(e.target.value)} />
            a <input type="date" className="form-control acc-rango-input" value={rangoFin} onChange={(e) => setRangoFin(e.target.value)} />
            {(rangoIni || rangoFin) && <button type="button" className="acc-mini" title="Quitar el rango" onClick={() => { setRangoIni(''); setRangoFin(''); }}>✕</button>}
          </span>
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
              <button
                type="button"
                className={`acc-tarjeta acc-tarjeta--btn ${resultado.problemas === 0 ? 'acc-tarjeta--ok' : 'acc-tarjeta--mal'}${modoProblemas ? ' acc-tarjeta--activa' : ''}`}
                title="Clic para resaltar en las tres columnas las operaciones, facturas y pagos con problemas"
                onClick={() => { setModoProblemas((v) => !v); setSel(null); }}
                disabled={resultado.problemas === 0}
              >
                <span className="acc-tarjeta-num">{resultado.problemas === 0 ? '✅ 0' : `⚠ ${resultado.problemas}`}</span>
                <span className="acc-tarjeta-lbl">problema(s) — clic para resaltarlos</span>
              </button>
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
                  {resultado.ops.map((x) => {
                    if (sel && !camino.ops.has(x.id)) return null; {/* ✅ V00323: fuera del camino → oculto */}
                    return (
                    <div
                      key={x.id}
                      className={`acc-item acc-item--clic ${CLASE_OP[x.veredicto]}${sel?.tipo === 'op' && sel.id === x.id ? ' acc-item--sel' : ''}${claseResaltado(camino.ops.has(x.id), resultado.opsProblema.has(x.id), x.revisado)}`}
                      title="Clic para ver SOLO el camino de esta operación (factura y pagos); clic de nuevo para volver"
                      onClick={() => { setModoProblemas(false); setSel((prev) => prev?.tipo === 'op' && prev.id === x.id ? null : { tipo: 'op', id: x.id }); }}
                    >
                      <div className="acc-item-fila1">
                        <span className="acc-ref">{x.ref}</span>
                        <ChipMoneda m={x.moneda} />
                        <span className="acc-monto">{money(x.montoHoy)}</span>
                        <span className="acc-acciones" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="acc-mini" title="Ver el detalle de la operación (como en el módulo de operaciones)" onClick={() => setDetalleOp(x.raw)}>👁</button>
                          <button type="button" className="acc-mini" title="Editar la operación (formulario completo)" onClick={() => setOpEditandoId(x.id)}>✎</button>
                          <BotonRevisado tipo="op" id={x.id} revisado={x.revisado} />
                        </span>
                      </div>
                      <div className="acc-item-fila2">{x.fecha || '—'} · {x.status || '—'}</div>
                      {x.montoEnFactura !== null && x.dif !== null && Math.abs(x.dif) > 0.01 && (
                        <div className="acc-item-fila2">En factura: <b>{money(x.montoEnFactura)}</b> · dif <b>{money(x.dif)}</b></div>
                      )}
                      <div className="acc-item-detalle">{x.detalle}</div>
                    </div>
                    );
                  })}
                </div>
              </div>

              {/* ───────── COLUMNA 2: FACTURACIÓN ───────── */}
              <div className="acc-col">
                <div className="acc-col-titulo">Facturación ({resultado.facturas.length})</div>
                <div className="acc-col-scroll">
                  {resultado.facturas.length === 0 && <p className="acc-vacio">Sin facturas.</p>}
                  {resultado.facturas.map((x) => {
                    if (sel && !camino.facturas.has(x.id)) return null; {/* ✅ V00323 */}
                    return (
                    <div
                      key={x.id}
                      className={`acc-item acc-item--clic ${CLASE_FA[x.veredicto]}${sel?.tipo === 'fact' && sel.id === x.id ? ' acc-item--sel' : ''}${claseResaltado(camino.facturas.has(x.id), resultado.facturasProblema.has(x.id), x.revisado)}`}
                      title="Clic para ver SOLO el camino de esta factura (operaciones y pagos); clic de nuevo para volver"
                      onClick={() => { setModoProblemas(false); setSel((prev) => prev?.tipo === 'fact' && prev.id === x.id ? null : { tipo: 'fact', id: x.id }); }}
                    >
                      <div className="acc-item-fila1">
                        <span className="acc-ref">{x.invoice}</span>
                        <ChipMoneda m={x.moneda} />
                        <span className="acc-monto">{money(x.totalNativo)}</span>
                        <span className="acc-acciones" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="acc-mini" title="Ver el detalle completo de la factura" onClick={() => setDetalle({ titulo: `Factura ${x.invoice}`, docu: x.raw })}>👁</button>
                          <button type="button" className="acc-mini" title="Editar la factura (invoice, fecha y total; lo demás en Facturación)" onClick={() => setFactEdit({ ...x.raw, id: x.id, invoice: x.invoice, _nuevoInvoice: x.invoice, _nuevaFecha: x.fecha, _nuevoTotal: String(x.conversion) })}>✎</button>
                          <BotonRevisado tipo="fact" id={x.id} revisado={x.revisado} />
                        </span>
                      </div>
                      <div className="acc-item-fila2">{x.fecha || '—'} · conversión {money(x.conversion)}</div>
                      <div className="acc-item-fila2">Pagado {money(x.montoPagado)} · saldo <b>{money(x.saldo)}</b>{x.pagos ? ` · pagos: ${x.pagos}` : ''}</div>
                      <div className="acc-item-detalle">{x.detalle}</div>
                    </div>
                    );
                  })}
                </div>
              </div>

              {/* ───────── COLUMNA 3: PAGOS ───────── */}
              <div className="acc-col">
                <div className="acc-col-titulo">Pagos ({resultado.pagos.length})</div>
                <div className="acc-col-scroll">
                  {resultado.pagos.length === 0 && <p className="acc-vacio">Sin pagos.</p>}
                  {resultado.pagos.map((x) => {
                    if (sel && !camino.pagos.has(x.id)) return null; {/* ✅ V00323 */}
                    return (
                    <div
                      key={x.id}
                      className={`acc-item acc-item--clic${sel?.tipo === 'pago' && sel.id === x.id ? ' acc-item--sel' : ''}${claseResaltado(camino.pagos.has(x.id), resultado.pagosProblema.has(x.id), x.revisado)}`}
                      title="Clic para ver SOLO el camino de este pago (facturas y operaciones); clic de nuevo para volver"
                      onClick={() => { setModoProblemas(false); setSel((prev) => prev?.tipo === 'pago' && prev.id === x.id ? null : { tipo: 'pago', id: x.id }); }}
                    >
                      <div className="acc-item-fila1">
                        <span className="acc-ref">{x.numeroPago}</span>
                        <ChipMoneda m={x.moneda} />
                        <span className="acc-monto">{money(x.monto)}</span>
                        <span className="acc-acciones" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="acc-mini" title="Ver el detalle completo del pago" onClick={() => setDetalle({ titulo: `Pago ${x.numeroPago}`, docu: x.raw })}>👁</button>
                          <button type="button" className="acc-mini" title="Editar el pago (fecha, método, referencia y observaciones; el monto y las facturas se editan en Pagos)" onClick={() => setPagoEdit({ ...x.raw, id: x.id, _nuevaFecha: x.fecha, _nuevoMetodo: x.metodo, _nuevaRef: String(x.raw?.referencia || ''), _nuevasObs: String(x.raw?.observaciones || '') })}>✎</button>
                          <BotonRevisado tipo="pago" id={x.id} revisado={x.revisado} />
                        </span>
                      </div>
                      <div className="acc-item-fila2">{x.fecha || '—'} · {x.metodo || '—'}</div>
                      <div className="acc-item-detalle">Facturas: {x.invoices || '—'}</div>
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Detalle genérico ── */}
        {detalle && <DetalleDoc titulo={detalle.titulo} docu={detalle.docu} onCerrar={() => setDetalle(null)} />}
        {detalleOp && <DetalleOperacion op={detalleOp} onCerrar={() => setDetalleOp(null)} />}{/* ✅ V00324 */}

        {/* ── Formulario REAL de edición de la operación (los cambios llegan solos por onSnapshot) ── */}
        {opEditandoId && <EditorOperacionEmbebido operacionId={opEditandoId} onClose={() => setOpEditandoId('')} />}

        {/* ── Editor directo de la factura ── */}
        {factEdit && (
          <div className="modal-overlay acc-overlay-2" onMouseDown={(e) => { if (e.target === e.currentTarget) setFactEdit(null); }}>
            <div className="form-card acc-edit-modal">
              <div className="acc-encabezado">
                <h3 className="acc-titulo">✎ Editar factura {String(factEdit.invoice || '')}</h3>
                <button type="button" className="roelca-window-btn danger" title="Cerrar" onClick={() => setFactEdit(null)}>✕</button>
              </div>
              <label className="acc-edit-label">Invoice
                <input type="text" className="form-control" value={factEdit._nuevoInvoice} onChange={(e) => setFactEdit((p: any) => ({ ...p, _nuevoInvoice: e.target.value }))} />
              </label>
              <label className="acc-edit-label">Fecha
                <input type="date" className="form-control" value={factEdit._nuevaFecha} onChange={(e) => setFactEdit((p: any) => ({ ...p, _nuevaFecha: e.target.value }))} />
              </label>
              <label className="acc-edit-label">Total (conversión, pesos)
                <input type="number" step="0.01" className="form-control" value={factEdit._nuevoTotal} onChange={(e) => setFactEdit((p: any) => ({ ...p, _nuevoTotal: e.target.value }))} />
              </label>
              <p className="acc-edit-nota">Ya pagado: <b>{money(Number(factEdit.montoPagado) || 0)}</b> — el saldo se recalcula solo. Las operaciones amparadas y el desglose se editan en Facturación.</p>
              <div className="acc-edit-acciones">
                <button type="button" className="btn btn-outline" onClick={() => setFactEdit(null)} disabled={guardandoEdit}>Cancelar</button>
                <button type="button" className="btn btn-primary" onClick={guardarFactura} disabled={guardandoEdit}>{guardandoEdit ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Editor directo del pago ── */}
        {pagoEdit && (
          <div className="modal-overlay acc-overlay-2" onMouseDown={(e) => { if (e.target === e.currentTarget) setPagoEdit(null); }}>
            <div className="form-card acc-edit-modal">
              <div className="acc-encabezado">
                <h3 className="acc-titulo">✎ Editar pago {String(pagoEdit.numeroPago || pagoEdit.id)}</h3>
                <button type="button" className="roelca-window-btn danger" title="Cerrar" onClick={() => setPagoEdit(null)}>✕</button>
              </div>
              <label className="acc-edit-label">Fecha
                <input type="date" className="form-control" value={pagoEdit._nuevaFecha} onChange={(e) => setPagoEdit((p: any) => ({ ...p, _nuevaFecha: e.target.value }))} />
              </label>
              <label className="acc-edit-label">Método de pago
                <input type="text" className="form-control" value={pagoEdit._nuevoMetodo} onChange={(e) => setPagoEdit((p: any) => ({ ...p, _nuevoMetodo: e.target.value }))} />
              </label>
              <label className="acc-edit-label">Referencia
                <input type="text" className="form-control" value={pagoEdit._nuevaRef} onChange={(e) => setPagoEdit((p: any) => ({ ...p, _nuevaRef: e.target.value }))} />
              </label>
              <label className="acc-edit-label">Observaciones
                <textarea className="form-control" rows={3} value={pagoEdit._nuevasObs} onChange={(e) => setPagoEdit((p: any) => ({ ...p, _nuevasObs: e.target.value }))} />
              </label>
              <p className="acc-edit-nota">El monto y las facturas aplicadas se editan en el módulo de Pagos (redistribuyen saldos).</p>
              <div className="acc-edit-acciones">
                <button type="button" className="btn btn-outline" onClick={() => setPagoEdit(null)} disabled={guardandoEdit}>Cancelar</button>
                <button type="button" className="btn btn-primary" onClick={guardarPago} disabled={guardandoEdit}>{guardandoEdit ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
