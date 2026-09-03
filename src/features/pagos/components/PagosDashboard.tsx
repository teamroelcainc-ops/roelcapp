// src/features/pagos/components/PagosDashboard.tsx
// ---------------------------------------------------------------------------
// MÓDULO DE PAGOS (cobranza de clientes y pagos a proveedores).
//   · Un PAGO puede cubrir VARIAS facturas: se seleccionan facturas con status
//     "Facturado" y saldo pendiente, y el monto se APLICA de la más antigua a
//     la más reciente (FIFO). La última puede quedar en pago parcial.
//   · Datos del pago: fecha, método (ACH, transferencia, efectivo, ...),
//     número/referencia, monto, observaciones y comprobante PDF adjunto.
//   · Cada factura guarda su acumulado: montoPagado, saldoPendiente y
//     statusPago (PAGADA / PARCIAL), sin tocar su statusFactura.
//   · Eliminar un pago REVIERTE la aplicación en sus facturas.
// ---------------------------------------------------------------------------
import { useState, useEffect, useMemo, useRef } from 'react';
import { suscribirOperacionGuardada } from '../../../utils/operacionesBus';
import { HiloModal } from '../../hilo/HiloModal';
import { EditorOperacionEmbebido } from '../../operaciones/components/EditorOperacionEmbebido';
import { cargarCatalogo, TTL } from '../../../hooks/useCatalogoCache';
import {
  collection, query, where, getDocs, onSnapshot, writeBatch, doc, arrayUnion, arrayRemove, limit,
  orderBy, startAfter, documentId,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../../config/firebase';
import * as XLSX from 'xlsx';
import html2pdf from 'html2pdf.js';
import { useUsuarioStore } from '../../../stores/useUsuarioStore';
import { registrarLog } from '../../../utils/logger';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { Plus, FileText, Trash2, X, Search, Download, Pencil, RefreshCw } from 'lucide-react';
import { SelectBuscable } from '../../catalogos/components/SelectBuscable';
import './PagosDashboard.css';

type TipoPago = 'cliente' | 'proveedor' | 'mtto';

const METODOS_PAGO = ['Transferencia', 'ACH', 'Efectivo', 'Cheque', 'Depósito', 'Tarjeta', 'Otro'];

// ✅ V00126: TOTAL FINAL de un gasto MTTO = el mismo que muestra el formulario de
//   Gastos: total guardado, o importe + IVA − RET IVA − RET ISR. Antes Pagos
//   sumaba solo importe + IVA (ignoraba las retenciones) y el saldo salía de más.
const totalGastoMtto = (g: any): number => {
  const guardado = Number(g?.total);
  if (Number.isFinite(guardado) && guardado > 0) return guardado;
  return (Number(g?.importe) || 0) + (Number(g?.ivaMonto) || 0) - (Number(g?.retIva) || 0) - (Number(g?.retIsr) || 0);
};

interface FacturaPagable {
  id: string;
  invoice: string;
  fecha: string;          // ISO o dd/mm — se ordena normalizada
  entidadId: string;
  entidadNombre: string;
  total: number;
  montoPagado: number;
  saldo: number;
  moneda: string;
  raw?: any;              // ✅ NUEVO: doc completo (status, CCP, operaciones…)
}

interface FacturaAplicada {
  facturaId: string;
  invoice: string;
  fecha: string;
  total: number;
  saldoAnterior: number;
  aplicado: number;
  saldoNuevo: number;
}

interface PagoDoc {
  id: string;
  tipo: TipoPago;
  numeroPago: string;
  fecha: string;
  metodoPago: string;
  referencia: string;
  entidadNombre: string;
  monto: number;
  moneda: string;
  observaciones?: string;
  pdfUrl?: string;
  pdfNombre?: string;
  facturas: FacturaAplicada[];
  creadoEn?: string;
  creadoPor?: string;
}

// ✅ V00126: sin redondeo — hasta 6 decimales tal cual resultan del cálculo.
const money = (n: number, moneda = '') =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}${moneda ? ` ${moneda}` : ''}`;

// ✅ FIX DUPLICADOS FANTASMA: las facturas guardan el nombre de la entidad
//   como texto y algunas traen diferencias invisibles (espacio al final,
//   doble espacio, acentos o mayúsculas distintas). Para agrupar, comparar y
//   filtrar se usa SIEMPRE esta clave normalizada — así "HC FLEET SERVICES"
//   y "HC FLEET SERVICES " son la misma entidad.
const claveEntidad = (s: any): string =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

// Normaliza fechas dd/mm/aaaa o ISO a una clave ordenable AAAA-MM-DD.
const claveFecha = (f: string): string => {
  const s = String(f || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return s;
};

// ✅ FIX: fecha local (antes usaba UTC y por la tarde/noche proponía la fecha de mañana).
const hoyISO = () => hoyLocalISO();

export function PagosDashboard() {
  const usuario = useUsuarioStore((s) => s.usuario);

  const [tab, setTab] = useState<TipoPago>('cliente');

  // ✅ V00170: paginación (50 pagos por página) en todas las pestañas

  const [paginaPagos, setPaginaPagos] = useState(1);

  const PAGOS_POR_PAGINA = 50;
  useEffect(() => { setPaginaPagos(1); }, [tab]);
  const [pagos, setPagos] = useState<PagoDoc[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [pagoViendo, setPagoViendo] = useState<PagoDoc | null>(null);

  // ✅ NUEVO — EDICIÓN de un pago (solo metadata: fecha, número, referencia,
  //   método, observaciones y comprobante). Los MONTOS y las FACTURAS
  //   aplicadas no se editan aquí: cambiarlos rompería los saldos; para eso
  //   se elimina el pago (revierte) y se registra de nuevo.
  const [pagoEditando, setPagoEditando] = useState<PagoDoc | null>(null);
  const [editFecha, setEditFecha] = useState('');
  const [editNumero, setEditNumero] = useState('');
  const [editReferencia, setEditReferencia] = useState('');
  const [editMetodo, setEditMetodo] = useState('Transferencia');
  const [editObs, setEditObs] = useState('');
  const [editArchivoPdf, setEditArchivoPdf] = useState<File | null>(null);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  // ✅ NUEVO — DETALLE Y EDICIÓN DE FACTURA desde el modal de pago.
  //   Permite revisar la factura (con sus OPERACIONES relacionadas) y corregir
  //   # de invoice, fecha, CCP, status y total sin salir del flujo de pago.
  const [facturaViendo, setFacturaViendo] = useState<FacturaPagable | null>(null);
  // ✅ V00126: hilo Operaciones → Facturación → Pagos y edición completa de operaciones
  const [hiloPago, setHiloPago] = useState<PagoDoc | null>(null);
  const [opEditandoId, setOpEditandoId] = useState<string | null>(null);
  // ✅ V00126: moneda de la EMPRESA junto al cliente/proveedor
  const [empresasCat, setEmpresasCat] = useState<any[]>([]);
  const [monedasCat, setMonedasCat] = useState<any[]>([]);
  useEffect(() => {
    cargarCatalogo('empresas', { ttlMs: TTL.MEDIO }).then(setEmpresasCat).catch(() => {});
    cargarCatalogo('catalogo_moneda', { ttlMs: TTL.MEDIO }).then(setMonedasCat).catch(() => {});
  }, []);
  const monedaEmpresaDe = (p: { entidadNombre?: string } & Record<string, any>): string => {
    const raw: any = p;
    const id = String(raw.entidadId || raw.clienteId || raw.proveedorId || raw.empresaId || '');
    const norm = (t: any) => String(t || '').trim().toLowerCase();
    const emp = (id && empresasCat.find((e: any) => String(e.id) === id)) || empresasCat.find((e: any) => norm(e.nombre || e.empresa || e.razonSocial) === norm(p.entidadNombre));
    if (!emp) return '';
    const m = String(emp.monedaId || emp.moneda || '');
    if (!m) return '';
    const cat = monedasCat.find((x: any) => String(x.id) === m);
    return String(cat?.moneda || (m.length < 12 ? m : '') || '');
  };
  const [editandoFactura, setEditandoFactura] = useState(false);
  const [fEditInvoice, setFEditInvoice] = useState('');
  const [fEditFecha, setFEditFecha] = useState('');
  const [fEditCcp, setFEditCcp] = useState('');
  const [fEditStatus, setFEditStatus] = useState('Facturado');
  const [fEditTotal, setFEditTotal] = useState('');
  const [fEditMoneda, setFEditMoneda] = useState('');
  const [guardandoFactura, setGuardandoFactura] = useState(false);
  const [opsFactura, setOpsFactura] = useState<any[]>([]);
  const [cargandoOpsFactura, setCargandoOpsFactura] = useState(false);

  // ✅ V00126: si se guarda una operación que pertenece a la factura abierta,
  //   se vuelven a leer sus operaciones para reflejar el cambio al instante.
  useEffect(() => {
    return suscribirOperacionGuardada(({ id }) => {
      const abierta = facturaViendoRef.current;
      if (!abierta) return;
      const ids: string[] = Array.isArray(abierta.raw?.operacionesIds) ? abierta.raw.operacionesIds.map(String) : [];
      if (ids.includes(String(id))) abrirDetalleFactura(abierta);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const facturaViendoRef = useRef<FacturaPagable | null>(null);
  useEffect(() => { facturaViendoRef.current = facturaViendo; }, [facturaViendo]);

  const abrirDetalleFactura = async (fac: FacturaPagable) => {
    // ✅ MTTO: el detalle son los GASTOS que componen el invoice.
    if (String(fac.id).startsWith('MTTO__')) {
      setFacturaViendo(fac);
      setEditandoFactura(false);
      const gastos: any[] = Array.isArray((fac as any).raw?.gastos) ? (fac as any).raw.gastos : [];
      setOpsFactura(gastos.map((g: any) => ({
        id: g.id,
        ref: String(g.numeroGasto || g.folio || g.descripcion || g.concepto || g.id).substring(0, 24),
        fechaServicio: String(g.fecha || g.fechaGasto || '').slice(0, 10),
        remolque: String(g.unidadNombre || g.unidad || ''),
        convenio: String(g.descripcion || g.concepto || '—'),
        monedaConvenio: 'MXN',
        importe: totalGastoMtto(g), // ✅ V00126: TOTAL FINAL (con retenciones)
        importeDetalle: `${money(totalGastoMtto(g))} MXN`,
      })));
      setCargandoOpsFactura(false);
      return;
    }

    setFacturaViendo(fac);
    setEditandoFactura(false);
    setFEditInvoice(fac.invoice);
    setFEditFecha(String(fac.raw?.fecha || fac.fecha || '').slice(0, 10));
    setFEditCcp(String(fac.raw?.facturaCcp || fac.raw?.ccp || ''));
    setFEditStatus(String(fac.raw?.statusFactura || 'Facturado'));
    setFEditTotal(String(fac.total || ''));
    // ✅ V00126: moneda de la factura = moneda de la EMPRESA (tabla Empresas); solo respaldo la de la factura
    const monEmpresa = monedaEmpresaDe({ entidadNombre: fac.entidadNombre, entidadId: (fac as any).entidadId });
    const norm = monEmpresa.toLowerCase();
    setFEditMoneda(norm.includes('dolar') || norm.includes('dólar') || norm.includes('usd') ? 'USD' : (norm.includes('peso') || norm.includes('mxn')) ? 'MXN' : (fac.moneda || ''));

    // ✅ OPERACIONES relacionadas: se leen SIEMPRE en vivo para mostrar la
    //   MONEDA DEL CONVENIO y el importe con la regla de monedas (convenio
    //   USD facturado en pesos -> conversión). Si la operación ya no existe,
    //   se cae al resumen guardado en la factura.
    const guardadas = Array.isArray(fac.raw?.operacionesGuardadas) ? fac.raw.operacionesGuardadas : [];
    const ids: string[] = Array.isArray(fac.raw?.operacionesIds) ? fac.raw.operacionesIds.map(String) : [];
    if (ids.length === 0 && guardadas.length === 0) { setOpsFactura([]); return; }
    setCargandoOpsFactura(true);
    try {
      const encontradas: any[] = [];
      for (let i = 0; i < ids.length; i += 10) {
        const lote = ids.slice(i, i + 10);
        const snap = await getDocs(query(collection(db, 'operaciones'), where(documentId(), 'in', lote)));
        snap.docs.forEach((d) => {
          const o = { id: d.id, ...(d.data() as any) };
          const m = desgloseDeOp(o, tab);
          const esCli = tab === 'cliente';
          const convenioBase = esCli
            ? (Number(o.montoConvenioCliente) || 0)
            : (Number(o.totalAPagarProv) || 0);
          encontradas.push({
            id: d.id,
            ref: o.ref,
            fechaServicio: o.fechaServicio,
            remolque: o.remolqueNombre || o.remolquePlaca || o.numeroRemolque || '',
            // ✅ NUEVO: el CONVENIO de la operación, revisable desde Pagos.
            convenio: `${String((esCli ? (o.convenioNombre || o.convenioClienteNombre) : (o.convenioProvNombre || o.convenioProveedorNombre)) || '—')}${convenioBase > 0 ? ` · ${money(convenioBase)}` : ''}`,
            monedaConvenio: m.monedaConvenio,
            importe: m.conv > 0 ? m.conv : '',
            importeDetalle: m.dol > 0 && m.pes <= 0 ? `${money(m.dol)} USD → ${money(m.conv)} MXN` : (m.conv > 0 ? `${money(m.conv)} MXN` : '—'),
          });
        });
      }
      if (encontradas.length > 0) setOpsFactura(encontradas);
      else setOpsFactura(guardadas.map((g: any) => ({ ...g, importe: g.monto, importeDetalle: g.monto ? `${money(Number(g.monto) || 0)} MXN` : '—', monedaConvenio: '—' })));
    } catch (e) {
      console.warn('No se pudieron cargar las operaciones de la factura:', e);
      setOpsFactura(guardadas);
    }
    setCargandoOpsFactura(false);
  };

  const guardarEdicionFactura = async () => {
    if (!facturaViendo) return;
    if (!fEditInvoice.trim()) { alert('Captura el # de invoice.'); return; }
    const totalNuevo = Number(fEditTotal);
    if (isNaN(totalNuevo) || totalNuevo <= 0) { alert('El total debe ser un número mayor a cero.'); return; }
    if (totalNuevo < facturaViendo.montoPagado - 0.009) {
      alert(`El total (${money(totalNuevo)}) no puede ser MENOR a lo ya pagado (${money(facturaViendo.montoPagado)}).\n\nPara bajarlo, primero elimina el/los pagos aplicados.`);
      return;
    }
    setGuardandoFactura(true);
    try {
      const coleccion = tab === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
      const saldoNuevo = Math.max(0, totalNuevo - facturaViendo.montoPagado);
      const cambios: any = {
        invoice: fEditInvoice.trim(),
        fecha: fEditFecha,
        facturaCcp: fEditCcp.trim(),
        statusFactura: fEditStatus,
        subtotalFactura: totalNuevo,
        subtotalMonedaFactura: totalNuevo, // ✅ FIX MONEDA: la edición define el total en la moneda de la factura
        saldoPendiente: saldoNuevo,
        // ✅ Moneda rectificada: se guarda en forma canónica ('USD'/'MXN') en
        //   el campo que leen tanto Pagos como Facturación.
        monedaFacturacion: fEditMoneda,
        editadoEn: new Date().toISOString(),
        editadoPor: usuario?.nombre || usuario?.email || usuario?.id || '',
      };
      if (facturaViendo.montoPagado > 0.009) {
        cambios.statusPago = saldoNuevo <= 0.009 ? 'PAGADA' : 'PARCIAL';
      }
      const batch = writeBatch(db);
      batch.set(doc(db, coleccion, facturaViendo.id), cambios, { merge: true });
      await batch.commit();
      registrarLog('Pagos', 'Edición', `Editó la factura ${cambios.invoice} de ${facturaViendo.entidadNombre} desde Pagos.`).catch(() => {});

      // Refresco EN MEMORIA de la lista del modal (sin recargar todo).
      setFacturasPendientes((prev) => prev.map((f) => f.id === facturaViendo.id
        ? { ...f, invoice: cambios.invoice, fecha: fEditFecha, total: totalNuevo, saldo: saldoNuevo, moneda: fEditMoneda, raw: { ...(f.raw || {}), ...cambios } }
        : f));
      // Si estaba seleccionada con un monto capturado mayor al nuevo saldo, se acota.
      setPagosPorFactura((pp) => {
        if (!(facturaViendo.id in pp)) return pp;
        const cap = Number(pp[facturaViendo.id]);
        if (isNaN(cap) || cap <= saldoNuevo) return pp;
        return { ...pp, [facturaViendo.id]: saldoNuevo.toFixed(2) };
      });
      setFacturaViendo((prev) => prev ? { ...prev, invoice: cambios.invoice, fecha: fEditFecha, total: totalNuevo, saldo: saldoNuevo, moneda: fEditMoneda, raw: { ...(prev.raw || {}), ...cambios } } : prev);
      setEditandoFactura(false);
    } catch (e) {
      console.error('No se pudo guardar la edición de la factura:', e);
      alert('No se pudo guardar la edición de la factura. Intenta de nuevo.');
    } finally {
      setGuardandoFactura(false);
    }
  };

  // ✅ NUEVO — DETALLE Y RECTIFICACIÓN DE UNA OPERACIÓN desde la factura.
  //   Revisión completa en lectura + edición SEGURA de los campos que suelen
  //   descuadrar una factura: fecha de servicio, # de remolque/placa y
  //   observaciones. Status, convenios y montos se corrigen en el módulo de
  //   Operaciones (dependen de flujos y catálogos que no viven aquí).
  const [opViendo, setOpViendo] = useState<any | null>(null);
  const [cargandoOpViendo, setCargandoOpViendo] = useState(false);
  const [editandoOp, setEditandoOp] = useState(false);
  const [opEditFechaServicio, setOpEditFechaServicio] = useState('');
  const [opEditRemolqueNombre, setOpEditRemolqueNombre] = useState('');
  const [opEditRemolquePlaca, setOpEditRemolquePlaca] = useState('');
  const [opEditObs, setOpEditObs] = useState('');
  const [guardandoOp, setGuardandoOp] = useState(false);

  const abrirDetalleOperacion = async (opId: string, respaldo?: any) => {
    setCargandoOpViendo(true);
    setEditandoOp(false);
    try {
      const snap = await getDocs(query(collection(db, 'operaciones'), where(documentId(), '==', String(opId)), limit(1)));
      const data = snap.empty ? null : { id: snap.docs[0].id, ...(snap.docs[0].data() as any) };
      const op = data || (respaldo ? { id: opId, ...respaldo, __soloResumen: true } : null);
      if (!op) { alert('No se encontró la operación.'); return; }
      setOpViendo(op);
      setOpEditFechaServicio(String(op.fechaServicio || '').slice(0, 10));
      setOpEditRemolqueNombre(String(op.remolqueNombre || op.remolque || ''));
      setOpEditRemolquePlaca(String(op.remolquePlaca || ''));
      setOpEditObs(String(op.observaciones || ''));
    } catch (e) {
      console.error('No se pudo abrir la operación:', e);
      alert('No se pudo abrir la operación. Intenta de nuevo.');
    } finally {
      setCargandoOpViendo(false);
    }
  };

  const guardarEdicionOperacion = async () => {
    if (!opViendo || opViendo.__soloResumen) return;
    setGuardandoOp(true);
    try {
      const cambios = {
        fechaServicio: opEditFechaServicio,
        remolqueNombre: opEditRemolqueNombre.trim(),
        remolquePlaca: opEditRemolquePlaca.trim(),
        observaciones: opEditObs.trim(),
        editadoEn: new Date().toISOString(),
        editadoPor: usuario?.nombre || usuario?.email || usuario?.id || '',
      };
      const batch = writeBatch(db);
      batch.set(doc(db, 'operaciones', opViendo.id), cambios, { merge: true });
      await batch.commit();
      registrarLog('Pagos', 'Edición', `Rectificó la operación ${opViendo.ref || opViendo.id} desde Pagos.`).catch(() => {});
      setOpViendo((prev: any) => prev ? { ...prev, ...cambios } : prev);
      // Refresco del renglón en la tabla de operaciones de la factura abierta.
      setOpsFactura((prev) => prev.map((o: any) => String(o.id) === String(opViendo.id)
        ? { ...o, fechaServicio: cambios.fechaServicio, remolque: cambios.remolqueNombre || cambios.remolquePlaca || o.remolque }
        : o));
      setEditandoOp(false);
    } catch (e) {
      console.error('No se pudo guardar la operación:', e);
      alert('No se pudo guardar la rectificación de la operación. Intenta de nuevo.');
    } finally {
      setGuardandoOp(false);
    }
  };

  // ✅ NUEVO: abre el detalle de una factura DESDE UN CHIP de la lista de
  //   pagos (se descarga el doc actual por id para tener datos frescos).
  const [cargandoFacturaChip, setCargandoFacturaChip] = useState<string>('');
  const abrirFacturaPorId = async (facturaId: string, tipo: TipoPago) => {
    if (cargandoFacturaChip) return;
    setCargandoFacturaChip(facturaId);
    try {
      const coleccion = tipo === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
      const snap = await getDocs(query(collection(db, coleccion), where(documentId(), '==', facturaId), limit(1)));
      if (snap.empty) { alert('No se encontró la factura (pudo haber sido eliminada).'); return; }
      const fac = mapearFacturaPagable(snap.docs[0].id, snap.docs[0].data(), tipo);
      await abrirDetalleFactura(fac);
    } catch (e) {
      console.error('No se pudo abrir la factura:', e);
      alert('No se pudo abrir la factura. Intenta de nuevo.');
    } finally {
      setCargandoFacturaChip('');
    }
  };

  // ✅ NUEVO — AGREGAR FACTURAS A UN PAGO EXISTENTE (clientes y proveedores):
  //   al editar un pago se listan las facturas CON SALDO de la misma entidad
  //   que aún no están en el pago, para aplicarles monto sin re-capturarlo.
  const [editFacturasDisp, setEditFacturasDisp] = useState<FacturaPagable[]>([]);
  const [cargandoEditFacturas, setCargandoEditFacturas] = useState(false);
  const [editFacturasSel, setEditFacturasSel] = useState<string[]>([]);
  const [editPagoPorFactura, setEditPagoPorFactura] = useState<Record<string, string>>({});
  const [editBusquedaFactura, setEditBusquedaFactura] = useState('');

  // ✅ NUEVO — RECALCULAR MONTOS DE UNA FACTURA con la REGLA DE MONEDAS:
  //   lee las operaciones reales de la factura y rehace el desglose desde la
  //   moneda del CONVENIO + la moneda de FACTURACIÓN (convenio USD facturado
  //   en pesos -> conversión con TC). Corrige el snapshot guardado
  //   (operacionesGuardadas, subtotalMonedaFactura, subtotalFactura y saldo).
  const [recalculandoFactura, setRecalculandoFactura] = useState(false);

  const desgloseDeOp = (op: any, tipo: TipoPago) => {
    const esCli = tipo === 'cliente';
    const tc = Number(op.tipoCambioAprobado) || 0;
    const subtotal = esCli
      ? Number(op.montoConvenioCliente || 0) + Number(op.cargosAdicionales || 0)
      : Number(op.totalAPagarProv || 0) + Number(op.cargosAdicionalesProv || 0);
    const fact = esCli ? op.facturadoEnCobrar : op.facturadoEnUnidad;
    const monConv = String((esCli ? op.monedaConvenioCliente : op.monedaConvenioProv) || '');
    const nombreFact = String((esCli ? op.monedaCobroNombre : op.monedaUnidadNombre) || '').toUpperCase();
    const factUSD = fact === ID_USD || nombreFact.includes('USD');
    const factMXN = fact === ID_MXN || nombreFact.includes('MXN');
    const convUSD = monConv === ID_USD || (!!monConv && monConv.toUpperCase().includes('USD'));
    const convMXN = monConv === ID_MXN || (!!monConv && monConv.toUpperCase().includes('MXN'));
    // ✅ IGUAL QUE EL FORMULARIO DE OPERACIONES: si la operación no trae la
    //   moneda del convenio (registros viejos), se asume USD — el estándar de
    //   los convenios (es el mismo default que aplica FormularioOperacion).
    const cUSD = convUSD || !convMXN;
    const cMXN = convMXN;
    let dol = 0, pes = 0, conv = 0;
    if (subtotal > 0) {
      if (cUSD && factMXN) { pes = subtotal * tc; conv = subtotal * tc; }
      else if (cUSD) { dol = subtotal; conv = subtotal * tc; }
      else if (cMXN && factUSD) { dol = tc > 0 ? subtotal / tc : 0; conv = subtotal; }
      else if (cMXN) { pes = subtotal; conv = subtotal; }
      else { conv = subtotal; }
    }
    // Respaldo: si no se pudo calcular (sin subtotal, o convenio USD sin tipo
    // de cambio guardado), se usa el desglose ya guardado en la operación.
    if (conv <= 0) {
      const dolG = Number(esCli ? op.dolaresCliente : op.dolaresProv) || 0;
      const pesG = Number(esCli ? op.pesosCliente : op.pesosProv) || 0;
      const convG = Number(esCli ? op.conversionCliente : op.conversionProv) || 0;
      if (convG > 0) { dol = dolG; pes = pesG; conv = convG; }
    }
    const monedaConvenio: string = convMXN ? 'MXN' : (convUSD ? 'USD' : (monConv ? monConv : 'USD (asumida)'));
    return { subtotal, dol, pes, conv, monedaConvenio, tc };
  };

  const recalcularFactura = async () => {
    if (!facturaViendo || recalculandoFactura) return;
    const fv = facturaViendo;
    const ids: string[] = Array.isArray(fv.raw?.operacionesIds) ? fv.raw.operacionesIds.map(String) : [];
    if (ids.length === 0) { alert('Esta factura no tiene operaciones ligadas: corrige el total con "Editar factura".'); return; }
    if (!window.confirm(`Se recalcularán los montos de la factura ${fv.invoice} desde sus ${ids.length} operación(es), aplicando la regla de monedas (convenio + moneda de facturación). ¿Continuar?`)) return;
    setRecalculandoFactura(true);
    try {
      // Operaciones reales de la factura.
      const ops: any[] = [];
      for (let i = 0; i < ids.length; i += 10) {
        const lote = ids.slice(i, i + 10);
        const snap = await getDocs(query(collection(db, 'operaciones'), where(documentId(), 'in', lote)));
        snap.docs.forEach((d) => ops.push({ id: d.id, ...(d.data() as any) }));
      }
      if (ops.length === 0) { alert('No se encontraron las operaciones de la factura.'); setRecalculandoFactura(false); return; }

      const porId: Record<string, any> = {};
      ops.forEach((op) => { porId[String(op.id)] = desgloseDeOp(op, tab); });

      // operacionesGuardadas corregidas (conserva ref/remolque del snapshot).
      const guardadasPrev: any[] = Array.isArray(fv.raw?.operacionesGuardadas) ? fv.raw.operacionesGuardadas : [];
      const guardadasNuevas = (guardadasPrev.length > 0 ? guardadasPrev : ids.map((id) => ({ id }))).map((g: any) => {
        const m = porId[String(g.id)];
        return m ? { ...g, monto: m.conv, subtotalBase: m.subtotal, dol: m.dol, pes: m.pes } : g;
      });

      const sumDol = guardadasNuevas.reduce((s: number, o: any) => s + (Number(o.dol) || 0), 0);
      const sumConv = guardadasNuevas.reduce((s: number, o: any) => s + (Number(o.monto) || 0), 0);
      // ✅ V00146: la MONEDA de la factura se re-sincroniza con la EMPRESA (tabla
      //   Empresas). Si la empresa cambió de moneda, el recálculo la aplica y la
      //   guarda en la factura; solo si la empresa no tiene moneda se usa la guardada.
      const monEmp = monedaEmpresaDe({ entidadNombre: fv.entidadNombre, entidadId: (fv as any).entidadId });
      const nEmp = monEmp.toLowerCase();
      const canonEmp = nEmp.includes('dolar') || nEmp.includes('dólar') || nEmp.includes('usd') ? 'USD' : (nEmp.includes('peso') || nEmp.includes('mxn')) ? 'MXN' : '';
      const monedaCanon = canonEmp || monedaDeFactura(fv.raw || {});
      const totalNativoNuevo = monedaCanon === 'USD' ? sumDol : sumConv;
      if (totalNativoNuevo <= 0) { alert('El recálculo dio $0.00 — revisa las operaciones (montos de convenio y tipo de cambio).'); setRecalculandoFactura(false); return; }
      if (totalNativoNuevo < fv.montoPagado - 0.009) {
        alert(`El total recalculado (${money(totalNativoNuevo)}) es MENOR a lo ya pagado (${money(fv.montoPagado)}).\n\nElimina primero el/los pagos aplicados y vuelve a intentar.`);
        setRecalculandoFactura(false);
        return;
      }

      const saldoNuevo = Math.max(0, totalNativoNuevo - fv.montoPagado);
      const cambios: any = {
        operacionesGuardadas: guardadasNuevas,
        subtotalFactura: sumConv,
        subtotalMonedaFactura: totalNativoNuevo,
        saldoPendiente: saldoNuevo,
        editadoEn: new Date().toISOString(),
        editadoPor: usuario?.nombre || usuario?.email || usuario?.id || '',
      };
      if (canonEmp) cambios.moneda = canonEmp; // ✅ V00146: persiste la moneda actual de la empresa
      if (fv.montoPagado > 0.009) cambios.statusPago = saldoNuevo <= 0.009 ? 'PAGADA' : 'PARCIAL';

      const coleccion = tab === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
      const batch = writeBatch(db);
      batch.set(doc(db, coleccion, fv.id), cambios, { merge: true });
      await batch.commit();
      registrarLog('Pagos', 'Edición', `Recalculó los montos de la factura ${fv.invoice} (regla de monedas): total ${money(totalNativoNuevo)} ${monedaCanon}.`).catch(() => {});

      // Refresco en memoria.
      setFacturasPendientes((prev) => prev.map((f) => f.id === fv.id
        ? { ...f, total: totalNativoNuevo, saldo: saldoNuevo, raw: { ...(f.raw || {}), ...cambios } }
        : f));
      setPagosPorFactura((pp) => {
        if (!(fv.id in pp)) return pp;
        const cap = Number(pp[fv.id]);
        if (isNaN(cap) || cap <= saldoNuevo) return pp;
        return { ...pp, [fv.id]: saldoNuevo.toFixed(2) };
      });
      setFacturaViendo((prev) => prev ? { ...prev, total: totalNativoNuevo, saldo: saldoNuevo, raw: { ...(prev.raw || {}), ...cambios } } : prev);
      alert(`Factura ${fv.invoice} recalculada: total ${money(totalNativoNuevo)} ${monedaCanon}. ✅`);
    } catch (e) {
      console.error('No se pudo recalcular la factura:', e);
      alert('No se pudo recalcular la factura. Intenta de nuevo.');
    } finally {
      setRecalculandoFactura(false);
    }
  };

  const abrirEdicionPago = (p: PagoDoc) => {
    setPagoEditando(p);
    setEditFecha(p.fecha || '');
    setEditNumero(p.numeroPago || '');
    setEditReferencia(p.referencia || '');
    setEditMetodo(p.metodoPago || 'Transferencia');
    setEditObs(p.observaciones || '');
    setEditArchivoPdf(null);
    setEditFacturasSel([]);
    setEditPagoPorFactura({});
    setEditFacturasDisp([]);
    setEditBusquedaFactura('');
    // Carga perezosa de las facturas pendientes de la entidad (según el TIPO
    // del pago — cliente o proveedor — no la pestaña actual).
    setCargandoEditFacturas(true);
    cargarFacturasPendientes(p.tipo)
      .then((lista) => {
        const yaEnPago = new Set((p.facturas || []).map((fa) => String(fa.facturaId)));
        setEditFacturasDisp(lista.filter((fx) =>
          claveEntidad(fx.entidadNombre) === claveEntidad(p.entidadNombre) && fx.saldo > 0.009 && !yaEnPago.has(String(fx.id))
        ).sort((a, b) => claveFecha(a.fecha).localeCompare(claveFecha(b.fecha))));
      })
      .catch(() => setEditFacturasDisp([]))
      .finally(() => setCargandoEditFacturas(false));
  };

  const toggleEditFactura = (id: string) => {
    const fac = editFacturasDisp.find((fx) => fx.id === id);
    if (!fac) return;
    setEditFacturasSel((prev) => {
      const ya = prev.includes(id);
      if (ya) {
        setEditPagoPorFactura((pp) => { const c = { ...pp }; delete c[id]; return c; });
        return prev.filter((x) => x !== id);
      }
      setEditPagoPorFactura((pp) => ({ ...pp, [id]: fac.saldo.toFixed(2) }));
      return [...prev, id];
    });
  };

  const sumaAgregadaEdicion = editFacturasSel.reduce((s, id) => s + (Number(editPagoPorFactura[id]) || 0), 0);

  const guardarEdicionPago = async () => {
    if (!pagoEditando) return;
    if (!editFecha) { alert('Captura la fecha del pago.'); return; }
    if (!editNumero.trim()) { alert('Captura el número del pago.'); return; }
    setGuardandoEdicion(true);
    try {
      // Comprobante nuevo (opcional): reemplaza al anterior en el registro.
      let pdfUrl = pagoEditando.pdfUrl || '';
      let pdfNombre = pagoEditando.pdfNombre || '';
      if (editArchivoPdf) {
        const destino = storageRef(storage, `pagos/${pagoEditando.id}/${editArchivoPdf.name}`);
        await uploadBytes(destino, editArchivoPdf);
        pdfUrl = await getDownloadURL(destino);
        pdfNombre = editArchivoPdf.name;
      }
      // ✅ NUEVO — facturas agregadas en la edición: se validan y aplican.
      const agregadas = editFacturasSel
        .map((id) => ({ fac: editFacturasDisp.find((fx) => fx.id === id)!, monto: Number(editPagoPorFactura[id]) || 0 }))
        .filter((x) => x.fac && x.monto > 0);
      const invalida = agregadas.find((x) => x.monto > x.fac.saldo + 0.009);
      if (invalida) {
        alert(`El monto capturado para la factura ${invalida.fac.invoice} (${money(invalida.monto)}) supera su saldo (${money(invalida.fac.saldo)}).`);
        setGuardandoEdicion(false);
        return;
      }

      const cambios: any = {
        fecha: editFecha,
        numeroPago: editNumero.trim(),
        referencia: editReferencia.trim(),
        metodoPago: editMetodo,
        observaciones: editObs.trim(),
        pdfUrl,
        pdfNombre,
        editadoEn: new Date().toISOString(),
        editadoPor: usuario?.nombre || usuario?.email || usuario?.id || '',
      };

      const batch = writeBatch(db);
      const coleccionFact = pagoEditando.tipo === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
      if (agregadas.length > 0) {
        const nuevasAplicaciones: FacturaAplicada[] = [];
        agregadas.forEach(({ fac, monto }) => {
          const pagadoNuevo = fac.montoPagado + monto;
          const saldoNuevo = Math.max(0, fac.total - pagadoNuevo);
          if (pagoEditando.tipo !== 'mtto') // ✅ MTTO: saldo derivado, sin doc de factura
          batch.set(doc(db, coleccionFact, fac.id), {
            montoPagado: pagadoNuevo,
            saldoPendiente: saldoNuevo,
            statusPago: saldoNuevo <= 0.009 ? 'PAGADA' : 'PARCIAL',
          }, { merge: true });
          nuevasAplicaciones.push({ facturaId: fac.id, invoice: fac.invoice, fecha: fac.fecha, total: fac.total, saldoAnterior: fac.saldo, aplicado: monto, saldoNuevo });
        });
        cambios.facturas = [...(pagoEditando.facturas || []), ...nuevasAplicaciones];
        cambios.monto = (Number(pagoEditando.monto) || 0) + agregadas.reduce((s, x) => s + x.monto, 0);
      }
      batch.set(doc(db, 'pagos', pagoEditando.id), cambios, { merge: true });
      await batch.commit();
      // Refleja los saldos en la lista del modal de registro sin recargar.
      if (agregadas.length > 0) {
        setFacturasPendientes((prev) => prev.map((fx) => {
          const ag = agregadas.find((x) => x.fac.id === fx.id);
          if (!ag) return fx;
          const pagadoNuevo = fx.montoPagado + ag.monto;
          return { ...fx, montoPagado: pagadoNuevo, saldo: Math.max(0, fx.total - pagadoNuevo) };
        }));
      }
      registrarLog('Pagos', 'Edición', `Editó el pago ${cambios.numeroPago} de ${pagoEditando.entidadNombre}.`).catch(() => {});
      // El onSnapshot refresca la lista; si el detalle está abierto se actualiza al vuelo.
      setPagoViendo((prev) => prev && prev.id === pagoEditando.id ? { ...prev, ...cambios } : prev);
      setPagoEditando(null);
    } catch (e) {
      console.error('No se pudo guardar la edición del pago:', e);
      alert('No se pudo guardar la edición del pago. Intenta de nuevo.');
    } finally {
      setGuardandoEdicion(false);
    }
  };

  // ✅ NUEVO — RECARGAR: fuerza la relectura de las facturas (clientes o
  //   proveedores según la pestaña) para que aparezcan las recién creadas
  //   sin esperar a reabrir el modal. La lista de pagos ya es en vivo
  //   (onSnapshot), así que este botón cubre el lado de facturas/saldos.
  const [recargando, setRecargando] = useState(false);
  const recargarFacturas = async () => {
    if (recargando) return;
    setRecargando(true);
    try {
      const lista = await cargarFacturasPendientes(tab);
      setFacturasPendientes(lista);
    } catch (e) {
      console.error('No se pudieron recargar las facturas:', e);
      alert('No se pudieron recargar las facturas. Intenta de nuevo.');
    } finally {
      setRecargando(false);
    }
  };

  // ── Modal Registrar Pago ──
  const [modalAbierto, setModalAbierto] = useState(false);
  const [facturasPendientes, setFacturasPendientes] = useState<FacturaPagable[]>([]);
  const [cargandoFacturas, setCargandoFacturas] = useState(false);
  const [entidadSel, setEntidadSel] = useState('');       // nombre de la entidad
  const [busquedaEntidad, setBusquedaEntidad] = useState('');
  const [facturasSel, setFacturasSel] = useState<string[]>([]);
  // ✅ NUEVO (flujo tipo QuickBooks): monto a aplicar POR FACTURA, editable.
  //   Al seleccionar una factura se propone su saldo completo; el usuario
  //   puede escribir un monto MENOR (nunca mayor: se acota al saldo).
  const [pagosPorFactura, setPagosPorFactura] = useState<Record<string, string>>({});
  // ✅ NUEVO: búsqueda por # de factura dentro de Transacciones pendientes.
  const [busquedaFactura, setBusquedaFactura] = useState('');
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [metodoPago, setMetodoPago] = useState('Transferencia');
  const [referencia, setReferencia] = useState('');
  const [montoTexto, setMontoTexto] = useState('');
  const [montoEditado, setMontoEditado] = useState(false);

  // ✅ NUEVO — UNIR ENTIDADES DUPLICADAS DESDE PAGOS (por NOMBRE):
  //   para duplicados que ya no existen en Empresas (facturas importadas o
  //   nombres con variantes). Reescribe el nombre en las facturas y pagos
  //   usando los documentos YA cargados en memoria (cero lecturas extra).
  const [unirModo, setUnirModo] = useState(false);
  const [unirOrigen, setUnirOrigen] = useState<string | null>(null);
  const [uniendoEnt, setUniendoEnt] = useState(false);

  const clickEntidadUnir = async (nombre: string) => {
    if (!unirOrigen) { setUnirOrigen(nombre); return; }
    if (claveEntidad(unirOrigen) === claveEntidad(nombre)) { setUnirOrigen(null); return; }
    const origen = unirOrigen, destino = nombre;
    if (!window.confirm(`UNIR ENTIDADES\n\n"${origen}"  →  se ELIMINA\n"${destino}"  →  se CONSERVA\n\nTodas las facturas y pagos de "${origen}" pasarán a nombre de "${destino}". ¿Continuar?`)) { setUnirModo(false); setUnirOrigen(null); return; }
    setUniendoEnt(true);
    try {
      const colFact = tab === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
      const campoN = tab === 'cliente' ? 'clienteNombre' : 'proveedorNombre';
      const kOri = claveEntidad(origen);
      const factIds = facturasPendientes.filter((fx) => claveEntidad(fx.entidadNombre) === kOri).map((fx) => fx.id);
      const pagosIdsUnir = pagos.filter((p) => p.tipo === tab && claveEntidad(p.entidadNombre) === kOri).map((p) => p.id);
      let n = 0;
      for (let i = 0; i < factIds.length; i += 400) {
        const batch = writeBatch(db);
        factIds.slice(i, i + 400).forEach((id) => batch.set(doc(db, colFact, id), { [campoN]: destino }, { merge: true }));
        await batch.commit(); n += Math.min(400, factIds.length - i);
      }
      for (let i = 0; i < pagosIdsUnir.length; i += 400) {
        const batch = writeBatch(db);
        pagosIdsUnir.slice(i, i + 400).forEach((id) => batch.set(doc(db, 'pagos', id), { entidadNombre: destino }, { merge: true }));
        await batch.commit(); n += Math.min(400, pagosIdsUnir.length - i);
      }
      setFacturasPendientes((prev) => prev.map((fx) => claveEntidad(fx.entidadNombre) === kOri ? { ...fx, entidadNombre: destino } : fx));
      if (entidadSel && claveEntidad(entidadSel) === kOri) setEntidadSel(destino);
      alert(`Unión completada. ✅\n\n${n} registro(s) pasaron de "${origen}" a "${destino}".`);
    } catch (e) {
      console.error('No se pudo unir:', e);
      alert('No se pudo completar la unión. Intenta de nuevo.');
    } finally {
      setUniendoEnt(false); setUnirModo(false); setUnirOrigen(null);
    }
  };

  // ✅ NUEVO — RECARGA DENTRO DEL MODAL DE REGISTRO (sin salir):
  //   vuelve a leer las facturas y CONSERVA la selección y los montos
  //   capturados (acotándolos al saldo nuevo; las que quedaron pagadas se
  //   quitan solas). Se dispara con el botón ↻ y AUTOMÁTICAMENTE al volver
  //   a la pestaña del navegador (p. ej. después de recalcular una factura
  //   o editarla en Facturación).
  const [recargandoModal, setRecargandoModal] = useState(false);
  const ultimaRecargaModal = useRef<number>(0);

  const recargarFacturasModal = async (silencioso = false) => {
    if (recargandoModal) return;
    setRecargandoModal(true);
    try {
      const lista = await cargarFacturasPendientes(tab);
      setFacturasPendientes(lista);
      ultimaRecargaModal.current = Date.now();
      // Conserva la selección: solo facturas que siguen con saldo.
      const porId: Record<string, FacturaPagable> = {};
      lista.forEach((fx) => { porId[fx.id] = fx; });
      setFacturasSel((prev) => prev.filter((id) => porId[id] && porId[id].saldo > 0.009));
      setPagosPorFactura((prev) => {
        const nuevo: Record<string, string> = {};
        Object.entries(prev).forEach(([id, txtMonto]) => {
          const fx = porId[id];
          if (!fx || fx.saldo <= 0.009) return; // pagada o eliminada: fuera
          const cap = Number(txtMonto);
          nuevo[id] = isNaN(cap) ? txtMonto : Math.min(cap, fx.saldo).toFixed(2);
        });
        return nuevo;
      });
    } catch (e) {
      console.error('No se pudieron recargar las facturas del modal:', e);
      if (!silencioso) alert('No se pudieron recargar las facturas. Intenta de nuevo.');
    } finally {
      setRecargandoModal(false);
    }
  };

  // Recarga automática al volver el foco a la pestaña (máx. 1 vez cada 10 s).
  useEffect(() => {
    if (!modalAbierto || !entidadSel) return;
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - ultimaRecargaModal.current < 10000) return;
      recargarFacturasModal(true);
    };
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalAbierto, entidadSel, tab]);


  const [observaciones, setObservaciones] = useState('');
  const [archivoPdf, setArchivoPdf] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);

  // ── Lista de pagos del tab activo, en vivo ──
  useEffect(() => {
    const q = query(collection(db, 'pagos'), where('tipo', '==', tab));
    const unsubscribe = onSnapshot(q, (snap) => {
      const lista = snap.docs
        .map((d) => ({ ...(d.data() as Omit<PagoDoc, 'id'>), id: d.id }))
        .sort((a, b) => claveFecha(b.fecha).localeCompare(claveFecha(a.fecha)));
      setPagos(lista);
    });
    return () => unsubscribe();
  }, [tab]);

  // ✅ NUEVO — ORDEN POR COLUMNA (mismo patrón que Operaciones Activas):
  //   clic en el encabezado ordena asc, segundo clic desc.
  const [ordenPagos, setOrdenPagos] = useState<{ col: string; dir: 1 | -1 }>({ col: 'fecha', dir: -1 });
  const clickOrdenPagos = (col: string) => setOrdenPagos((prev) => prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 });
  const flechaOrden = (col: string) => ordenPagos.col === col ? (ordenPagos.dir === 1 ? ' ▲' : ' ▼') : '';
  const valorOrdenPago = (p: PagoDoc, col: string): string | number => {
    switch (col) {
      case 'fecha': return claveFecha(p.fecha || '');
      case 'numero': return String(p.numeroPago || '').toLowerCase();
      case 'entidad': return String(p.entidadNombre || '').toLowerCase();
      case 'metodo': return String(p.metodoPago || '').toLowerCase();
      case 'monto': return Number(p.monto) || 0;
      case 'facturas': return (p.facturas || []).length;
      case 'comprobante': return p.pdfUrl ? 1 : 0;
      default: return '';
    }
  };

  const pagosFiltrados = useMemo(() => {
    let lista = pagos;
    if (busqueda.trim()) {
      const b = busqueda.toLowerCase();
      lista = pagos.filter((p) =>
        p.entidadNombre?.toLowerCase().includes(b) ||
        p.numeroPago?.toLowerCase().includes(b) ||
        p.referencia?.toLowerCase().includes(b) ||
        p.metodoPago?.toLowerCase().includes(b) ||
        p.facturas?.some((f) => f.invoice?.toLowerCase().includes(b))
      );
    }
    // ✅ Orden por la columna activa.
    const { col, dir } = ordenPagos;
    return [...lista].sort((a, b2) => {
      const va = valorOrdenPago(a, col), vb = valorOrdenPago(b2, col);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'es') * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagos, busqueda, ordenPagos]);

  // ── Reportes (Excel / PDF) ──
  const [menuReportes, setMenuReportes] = useState(false);
  const [generandoReporte, setGenerandoReporte] = useState(false);

  const etiquetaTab = tab === 'cliente' ? 'Clientes' : tab === 'proveedor' ? 'Proveedores' : 'MTTO';
  const fechaHoyTexto = () => new Date().toLocaleDateString('es-MX');

  const totalesPorMoneda = (filas: { moneda: string; monto: number }[]) => {
    const acc: Record<string, number> = {};
    filas.forEach((f) => { const k = f.moneda || 'S/M'; acc[k] = (acc[k] || 0) + f.monto; });
    return Object.entries(acc);
  };

  // Reporte 1: PAGOS REALIZADOS (respeta pestaña y búsqueda actuales).
  const exportarPagosExcel = () => {
    if (pagosFiltrados.length === 0) { alert('No hay pagos que exportar.'); return; }
    const hojaPagos = pagosFiltrados.map((p) => ({
      'Fecha': p.fecha,
      '# Pago': p.numeroPago,
      [etiquetaTab === 'Clientes' ? 'Cliente' : 'Proveedor']: p.entidadNombre,
      'Método': p.metodoPago,
      'Referencia': p.referencia || '',
      'Moneda': p.moneda || '',
      'Monto Recibido': Number(p.monto) || 0,
      'Monto Aplicado': Number((p as PagoDoc & { montoAplicado?: number }).montoAplicado ?? p.monto) || 0,
      'Saldo a Favor': Number((p as PagoDoc & { saldoAFavor?: number }).saldoAFavor) || 0,
      'Facturas': (p.facturas || []).filter(f => f.aplicado > 0).map(f => f.invoice).join(', '),
      'Registró': p.creadoPor || '',
    }));
    const hojaDetalle = pagosFiltrados.flatMap((p) =>
      (p.facturas || []).filter(f => f.aplicado > 0).map((f) => ({
        'Fecha Pago': p.fecha,
        '# Pago': p.numeroPago,
        [etiquetaTab === 'Clientes' ? 'Cliente' : 'Proveedor']: p.entidadNombre,
        'Factura': f.invoice,
        'Fecha Factura': f.fecha,
        'Total Factura': Number(f.total) || 0,
        'Aplicado': Number(f.aplicado) || 0,
        'Saldo Restante': Number(f.saldoNuevo) || 0,
        'Moneda': p.moneda || '',
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaPagos), 'Pagos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaDetalle), 'Detalle por Factura');
    XLSX.writeFile(wb, `Pagos_${etiquetaTab}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setMenuReportes(false);
  };

  const generarPDFDeTabla = async (titulo: string, encabezados: string[], filas: string[][], pieTotales: [string, number][], nombreArchivo: string) => {
    const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; color: #111; padding: 8px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; border-bottom:2px solid #D84315; padding-bottom:8px; margin-bottom:12px;">
          <div>
            <div style="font-size:18px; font-weight:bold; color:#D84315;">ROELCA INC.</div>
            <div style="font-size:13px; font-weight:bold; margin-top:2px;">${esc(titulo)}</div>
          </div>
          <div style="font-size:11px; color:#555;">Generado: ${esc(fechaHoyTexto())}</div>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:10px;">
          <thead>
            <tr>${encabezados.map(h => `<th style="background:#f2f2f2; border:1px solid #ccc; padding:5px 6px; text-align:left;">${esc(h)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${filas.map(fila => `<tr>${fila.map(c => `<td style="border:1px solid #ddd; padding:4px 6px;">${esc(c)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
        <div style="margin-top:12px; text-align:right; font-size:11px;">
          ${pieTotales.map(([mon, tot]) => `<div><b>Total ${esc(mon)}:</b> ${money(tot)}</div>`).join('')}
        </div>
      </div>`;
    const cont = document.createElement('div');
    cont.innerHTML = html;
    document.body.appendChild(cont);
    try {
      await html2pdf().set({
        margin: 8,
        filename: nombreArchivo,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'letter', orientation: 'landscape' },
      }).from(cont).save();
    } finally {
      document.body.removeChild(cont);
    }
  };

  const exportarPagosPDF = async () => {
    if (pagosFiltrados.length === 0) { alert('No hay pagos que exportar.'); return; }
    setGenerandoReporte(true);
    try {
      await generarPDFDeTabla(
        `Reporte de Pagos — ${etiquetaTab}`,
        ['Fecha', '# Pago', etiquetaTab === 'Clientes' ? 'Cliente' : 'Proveedor', 'Método', 'Referencia', 'Moneda', 'Monto', 'Facturas cubiertas'],
        pagosFiltrados.map((p) => [
          p.fecha, p.numeroPago, p.entidadNombre, p.metodoPago, p.referencia || '—', p.moneda || '—',
          money(p.monto), (p.facturas || []).filter(f => f.aplicado > 0).map(f => f.invoice).join(', '),
        ]),
        totalesPorMoneda(pagosFiltrados.map(p => ({ moneda: p.moneda, monto: Number(p.monto) || 0 }))),
        `Pagos_${etiquetaTab}_${new Date().toISOString().slice(0, 10)}.pdf`
      );
    } finally {
      setGenerandoReporte(false);
      setMenuReportes(false);
    }
  };

  // Reporte 2: FACTURAS PENDIENTES (con saldo abierto) de la pestaña actual.
  const exportarPendientesExcel = async () => {
    setGenerandoReporte(true);
    try {
      const lista = (await cargarFacturasPendientes(tab))
        .filter((f) => f.saldo > 0.009) // el reporte sigue siendo SOLO de pendientes
        .sort((a, b) => a.entidadNombre.localeCompare(b.entidadNombre) || claveFecha(a.fecha).localeCompare(claveFecha(b.fecha)));
      if (lista.length === 0) { alert('No hay facturas pendientes.'); return; }
      const hoja = lista.map((f) => ({
        [etiquetaTab === 'Clientes' ? 'Cliente' : 'Proveedor']: f.entidadNombre,
        'Factura': f.invoice,
        'Fecha': f.fecha,
        'Total': f.total,
        'Pagado': f.montoPagado,
        'Saldo Pendiente': f.saldo,
        'Moneda': f.moneda || '',
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hoja), 'Facturas Pendientes');
      XLSX.writeFile(wb, `Facturas_Pendientes_${etiquetaTab}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      console.error('No se pudo generar el reporte de pendientes:', e);
      alert('No se pudo generar el reporte de facturas pendientes.');
    } finally {
      setGenerandoReporte(false);
      setMenuReportes(false);
    }
  };

  const exportarPendientesPDF = async () => {
    setGenerandoReporte(true);
    try {
      const lista = (await cargarFacturasPendientes(tab))
        .filter((f) => f.saldo > 0.009) // el reporte sigue siendo SOLO de pendientes
        .sort((a, b) => a.entidadNombre.localeCompare(b.entidadNombre) || claveFecha(a.fecha).localeCompare(claveFecha(b.fecha)));
      if (lista.length === 0) { alert('No hay facturas pendientes.'); return; }
      await generarPDFDeTabla(
        `Facturas Pendientes de Pago — ${etiquetaTab}`,
        [etiquetaTab === 'Clientes' ? 'Cliente' : 'Proveedor', 'Factura', 'Fecha', 'Total', 'Pagado', 'Saldo Pendiente', 'Moneda'],
        lista.map((f) => [f.entidadNombre, f.invoice, f.fecha, money(f.total), f.montoPagado > 0 ? money(f.montoPagado) : '—', money(f.saldo), f.moneda || '—']),
        totalesPorMoneda(lista.map(f => ({ moneda: f.moneda, monto: f.saldo }))),
        `Facturas_Pendientes_${etiquetaTab}_${new Date().toISOString().slice(0, 10)}.pdf`
      );
    } catch (e) {
      console.error('No se pudo generar el reporte de pendientes:', e);
      alert('No se pudo generar el reporte de facturas pendientes.');
    } finally {
      setGenerandoReporte(false);
      setMenuReportes(false);
    }
  };

  // ── Cargador de facturas con saldo pendiente (modal Y reportes) ──
  //
  // ✅ FIX "no aparecen todas las facturas":
  //   1. ANTES se consultaba where('statusFactura','==','Facturado'), pero las
  //      facturas antiguas NO tienen ese campo (Facturación las trata como
  //      'Facturado' por respaldo) y una igualdad de Firestore NO devuelve
  //      documentos donde el campo no existe → esas facturas nunca aparecían
  //      en Pagos. Ahora el status se filtra EN CLIENTE con la misma regla
  //      tolerante que usan los dashboards de Facturación.
  //   2. ANTES había un limit(1000) plano: si la colección supera 1000
  //      documentos se cortaba en silencio. Ahora se pagina por cursor igual
  //      que Facturación (lotes de 1000, tope 12,000).
  const PAG_FACT_PAGOS = 1000;
  const LIMITE_FACT_PAGOS = 12000; // mismo criterio que Facturación
  const ID_USD = '7dca62b3';
  const ID_MXN = 'f95d8894';

  // ✅ FIX MONEDA INCONSISTENTE: las facturas guardan la moneda de formas
  //   distintas según la época/módulo — a veces el ID del catálogo, a veces
  //   'USD'/'MXN', a veces el nombre 'Dólares'/'Dolares'/'Pesos'. Antes cada
  //   representación se mostraba tal cual (la misma factura salía "USD" en
  //   Facturación y "Dolares"/"Pesos" en Pagos) y hasta bloqueaba pagos por
  //   "monedas distintas" cuando en realidad eran la misma. Este normalizador
  //   convierte CUALQUIER representación a 'USD' o 'MXN'.
  const monedaCanonica = (val: any): string => {
    const s = String(val ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    if (!s || s === 'n/a') return '';
    if (s === ID_USD.toLowerCase() || s === 'usd' || s === 'us$' || s === 'dls' || s.startsWith('dolar')) return 'USD';
    if (s === ID_MXN.toLowerCase() || s === 'mxn' || s === 'mn' || s.startsWith('peso')) return 'MXN';
    return '';
  };

  // Resuelve la moneda canónica de un doc de factura probando TODOS los
  // campos donde puede vivir; si ninguno se reconoce, devuelve el primer
  // texto no vacío tal cual (para no ocultar monedas raras).
  const monedaDeFactura = (raw: any): string => {
    // ✅ V00148: la MONEDA de la EMPRESA (tabla Empresas) manda SIEMPRE — la
    //   moneda y sus cálculos siguen a la empresa en todas partes; los campos
    //   guardados en la factura son solo respaldo para empresas sin moneda.
    const canonEmp = monedaCanonica(monedaEmpresaDe({
      entidadId: raw?.clienteId || raw?.proveedorId || raw?.entidadId || '',
      entidadNombre: raw?.clienteNombre || raw?.proveedorNombre || raw?.entidadNombre || '',
    }));
    if (canonEmp) return canonEmp;
    const candidatos = [raw?.monedaFacturacion, raw?.monedaProveedor, raw?.moneda, raw?.monedaId];
    for (const c of candidatos) {
      const canon = monedaCanonica(c);
      if (canon) return canon;
    }
    for (const c of candidatos) {
      const s = String(c ?? '').trim();
      if (s) return s;
    }
    return '';
  };

  // Mismo criterio que Facturación: sin campo/vacío => 'Facturado'. Solo se
  // excluyen las canceladas y las marcadas explícitamente como 'No Facturado'.
  const esFacturaCobrable = (raw: any): boolean => {
    const s = String(raw?.statusFactura || 'Facturado')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    if (!s) return true;
    if (s.includes('cancel')) return false;
    if (s.startsWith('no ')) return false; // "No Facturado"
    return true;
  };


  // ✅ FIX MONEDA — TOTAL NATIVO DE LA FACTURA: el total a cobrar/pagar en la
  //   MONEDA de la factura (USD -> dólares, MXN -> pesos), NO la conversión.
  //   1) subtotalMonedaFactura (facturas nuevas lo guardan directo);
  //   2) suma de subtotalBase de operacionesGuardadas (monto en la moneda de
  //      facturación de cada operación — cubre las facturas existentes);
  //   3) respaldo: subtotalFactura (conversión) para facturas sin detalle.
  const totalNativoFactura = (fac: any): number => {
    const norm = (v: any): string => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const monTxt = norm(fac?.monedaFacturacion || fac?.monedaProveedor || fac?.moneda || fac?.monedaId);
    const esUSD = monTxt === '7dca62b3' || monTxt === 'usd' || monTxt === 'us$' || monTxt === 'dls' || monTxt.startsWith('dolar');
    const esMXN = monTxt === 'f95d8894' || monTxt === 'mxn' || monTxt === 'mn' || monTxt.startsWith('peso');
    const directo = Number(fac?.subtotalMonedaFactura);
    if (!isNaN(directo) && directo > 0) return directo;
    const ops = Array.isArray(fac?.operacionesGuardadas) ? fac.operacionesGuardadas : [];
    const suma = (campo: string) => ops.reduce((s: number, o: any) => s + (Number(o?.[campo]) || 0), 0);
    if (ops.length > 0) {
      if (esUSD) {
        // Factura en DÓLARES: el monto por operación en dólares; si la factura
        // es vieja y no lo trae, subtotalBase (subtotal en la escala USD).
        const dol = suma('dol');
        if (dol > 0) return dol;
        const base = suma('subtotalBase');
        if (base > 0) return base;
      } else if (esMXN) {
        // Factura en PESOS: la CONVERSIÓN es el total en pesos (cubre convenios
        // en dólares: dólares × TC, y convenios en pesos: pesos directos).
        const conv = suma('monto');
        if (conv > 0) return conv;
        const pes = suma('pes');
        if (pes > 0) return pes;
        const base = suma('subtotalBase');
        if (base > 0) return base;
      } else {
        const base = suma('subtotalBase');
        if (base > 0) return base;
      }
    }
    return Number(fac?.subtotalFactura) || Number(fac?.total) || Number(fac?.montoFactura) || 0;
  };

  // ✅ NUEVO: mapeo de un doc de factura a FacturaPagable (reutilizado por la
  //   carga masiva y por la apertura individual desde los chips de pagos).
  const mapearFacturaPagable = (id: string, raw: any, tipo: TipoPago): FacturaPagable => {
    // ✅ FIX MONEDA: total a pagar en la MONEDA de la factura (no la conversión).
    const total = totalNativoFactura(raw);
    const pagado = Number(raw.montoPagado) || 0;
    return {
      id,
      invoice: String(raw.invoice || raw.folio || id),
      fecha: String(raw.fecha || raw.fechaFactura || ''),
      entidadId: String((tipo === 'cliente' ? raw.clienteId : raw.proveedorId) || ''),
      entidadNombre: String((tipo === 'cliente' ? (raw.clienteNombre || raw.cliente) : (raw.proveedorNombre || raw.proveedor)) || 'Sin nombre'),
      total,
      montoPagado: pagado,
      saldo: Math.max(0, total - pagado),
      moneda: monedaDeFactura(raw), // ✅ canónica: 'USD' / 'MXN'
      raw,
    };
  };

  const cargarFacturasPendientes = async (tipo: TipoPago): Promise<FacturaPagable[]> => {
    // ✅ MTTO: los "pendientes" son los GRUPOS POR INVOICE de gastos_mtto,
    //   agrupados por PROVEEDOR. El saldo se DERIVA de los pagos tipo mtto
    //   (no se tocan los documentos de gastos).
    if (tipo === 'mtto') {
      const snapG = await getDocs(query(collection(db, 'gastos_mtto'), orderBy('createdAt', 'desc'), limit(3000)));
      const grupos = new Map<string, any>();
      snapG.docs.forEach((d) => {
        const g: any = { id: d.id, ...(d.data() as any) };
        const inv = String(g.invoice || '').trim();
        if (!inv) return; // sin invoice no es pagable por grupo
        const clave = inv.toLowerCase();
        const prev = grupos.get(clave) || { invoice: inv, total: 0, fecha: '', entidad: '', gastos: [] as any[] };
        prev.total += totalGastoMtto(g); // ✅ V00126: usa el TOTAL FINAL (con retenciones)
        const fg = String(g.fecha || g.fechaGasto || '').slice(0, 10);
        if (fg > prev.fecha) prev.fecha = fg;
        if (!prev.entidad) prev.entidad = String(g.proveedorNombre || g.proveedor || '').trim() || 'VARIOS';
        prev.gastos.push(g);
        grupos.set(clave, prev);
      });
      // Pagado por invoice: derivado de los pagos tipo mtto ya registrados.
      const pagadoPor: Record<string, number> = {};
      pagos.filter((p) => p.tipo === 'mtto').forEach((p) => {
        (Array.isArray(p.facturas) ? p.facturas : []).forEach((fa: any) => {
          pagadoPor[String(fa.facturaId)] = (pagadoPor[String(fa.facturaId)] || 0) + (Number(fa.aplicado) || 0);
        });
      });
      return Array.from(grupos.entries()).map(([clave, gr]) => {
        const id = `MTTO__${clave}`;
        const pagado = pagadoPor[id] || 0;
        return {
          id,
          invoice: gr.invoice,
          fecha: gr.fecha,
          total: gr.total,
          montoPagado: pagado,
          saldo: Math.max(0, gr.total - pagado),
          moneda: 'MXN',
          entidadNombre: gr.entidad,
          raw: { gastos: gr.gastos, operacionesIds: [] },
        } as FacturaPagable;
      });
    }

    const coleccion = tipo === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';

    // Descarga paginada por cursor (misma técnica que Facturación).
    const docs: { id: string; raw: any }[] = [];
    let cursor: any = null;
    for (let i = 0; i < Math.ceil(LIMITE_FACT_PAGOS / PAG_FACT_PAGOS); i++) {
      const cons: any[] = [orderBy(documentId()), limit(PAG_FACT_PAGOS)];
      if (cursor) cons.splice(1, 0, startAfter(cursor));
      const snap = await getDocs(query(collection(db, coleccion), ...cons));
      if (snap.empty) break;
      snap.docs.forEach((d) => docs.push({ id: d.id, raw: d.data() }));
      cursor = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < PAG_FACT_PAGOS) break;
    }

    return docs
      .filter(({ raw }) => esFacturaCobrable(raw))
      .map(({ id, raw }) => mapearFacturaPagable(id, raw, tipo))
      // ✅ CAMBIO: ya NO se excluyen las facturas pagadas — el usuario pidió ver
      //   TODAS las facturas del cliente/proveedor (las pagadas se muestran
      //   bloqueadas en el modal). Solo se descartan documentos sin monto
      //   (docs secundarios de facturas agrupadas que traen subtotal 0).
      .filter((f) => f.total > 0);
  };

  // ── Cargar facturas con saldo pendiente al abrir el modal ──
  const abrirModal = async () => {
    setModalAbierto(true);
    setCargandoFacturas(true);
    setEntidadSel('');
    setBusquedaEntidad('');
    setFacturasSel([]);
    setPagosPorFactura({});
    setBusquedaFactura('');
    setFechaPago(hoyISO());
    setMetodoPago('Transferencia');
    setReferencia('');
    setMontoTexto('');
    setMontoEditado(false);
    setObservaciones('');
    setArchivoPdf(null);
    try {
      const lista = await cargarFacturasPendientes(tab);
      setFacturasPendientes(lista);
    } catch (e) {
      console.error('No se pudieron cargar las facturas pendientes:', e);
      alert('No se pudieron cargar las facturas pendientes.');
    } finally {
      setCargandoFacturas(false);
    }
  };

  // Entidades (clientes/proveedores) con facturas.
  // ✅ CAMBIO: se listan TODAS las facturas de la entidad (pagadas incluidas);
  //   `conSaldo` indica cuántas siguen abiertas.
  const entidades = useMemo(() => {
    const mapa = new Map<string, { nombre: string; cuantas: number; conSaldo: number; saldo: number }>();
    facturasPendientes.forEach((f) => {
      // ✅ CAMBIO: solo cuentan (y aparecen) las facturas con saldo abierto.
      if (f.saldo <= 0.009) return;
      // ✅ FIX: se agrupa por la clave NORMALIZADA del nombre (evita el
      //   proveedor "duplicado" por un espacio o mayúscula distinta).
      const clave = claveEntidad(f.entidadNombre);
      const prev = mapa.get(clave) || { nombre: String(f.entidadNombre || '').trim().replace(/\s+/g, ' '), cuantas: 0, conSaldo: 0, saldo: 0 };
      prev.cuantas += 1;
      prev.conSaldo += 1;
      prev.saldo += f.saldo;
      mapa.set(clave, prev);
    });
    return Array.from(mapa.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [facturasPendientes]);

  const entidadesFiltradas = useMemo(() => {
    if (!busquedaEntidad.trim()) return entidades;
    const b = busquedaEntidad.toLowerCase();
    return entidades.filter((e) => e.nombre.toLowerCase().includes(b));
  }, [entidades, busquedaEntidad]);

  // Facturas de la entidad elegida, de la MÁS ANTIGUA a la más reciente.
  const facturasDeEntidad = useMemo(() =>
    facturasPendientes
      // ✅ CAMBIO: en el registro de pago SOLO se muestran facturas con saldo
      //   abierto (las pagadas ya no aparecen en la lista).
      .filter((f) => claveEntidad(f.entidadNombre) === claveEntidad(entidadSel) && f.saldo > 0.009)
      .sort((a, b) => claveFecha(a.fecha).localeCompare(claveFecha(b.fecha))),
  [facturasPendientes, entidadSel]);

  // ✅ Solo afecta lo que se MUESTRA en la tabla; las facturas ya
  //   seleccionadas siguen contando en los totales aunque el filtro las oculte.
  const facturasVisibles = useMemo(() => {
    if (!busquedaFactura.trim()) return facturasDeEntidad;
    const b = busquedaFactura.toLowerCase();
    return facturasDeEntidad.filter((f) => f.invoice.toLowerCase().includes(b));
  }, [facturasDeEntidad, busquedaFactura]);

  const seleccionadasOrdenadas = useMemo(() =>
    facturasDeEntidad.filter((f) => facturasSel.includes(f.id)),
  [facturasDeEntidad, facturasSel]);

  const monedasSel = useMemo(() =>
    Array.from(new Set(seleccionadasOrdenadas.map((f) => f.moneda).filter(Boolean))),
  [seleccionadasOrdenadas]);

  // ✅ Monto aplicado de UNA factura (acotado a su saldo). Declarada ANTES de
  //   los memos que la usan: al ser const, invocarla desde un useMemo antes de
  //   su inicialización (TDZ) tronaba el render al marcar la primera factura.
  const aplicadoDeFactura = (f: FacturaPagable): number => {
    const num = Number(pagosPorFactura[f.id]);
    if (isNaN(num) || num < 0) return 0;
    return Math.min(num, f.saldo);
  };

  // ✅ Total APLICADO = suma de los montos capturados por factura.
  const totalAplicado = useMemo(() =>
    seleccionadasOrdenadas.reduce((s, f) => s + aplicadoDeFactura(f), 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [seleccionadasOrdenadas, pagosPorFactura]);

  // Si el usuario no ha capturado el monto recibido a mano, se propone el
  // total aplicado (el flujo simple sigue siendo de un solo paso).
  useEffect(() => {
    if (!montoEditado) setMontoTexto(totalAplicado > 0 ? totalAplicado.toFixed(2) : '');
  }, [totalAplicado, montoEditado]);

  const monto = Number(montoTexto) || 0;
  // ✅ Diferencia en vivo: recibido − aplicado.
  //   > 0 → saldo A FAVOR del cliente/proveedor · = 0 → cuadrado · < 0 → EN CONTRA.
  const diferencia = monto - totalAplicado;

  const aplicacion = useMemo<FacturaAplicada[]>(() =>
    seleccionadasOrdenadas.map((f) => {
      const aplicado = aplicadoDeFactura(f);
      return {
        facturaId: f.id,
        invoice: f.invoice,
        fecha: f.fecha,
        total: f.total,
        saldoAnterior: f.saldo,
        aplicado,
        saldoNuevo: Math.max(0, f.saldo - aplicado),
      };
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [seleccionadasOrdenadas, pagosPorFactura]);

  const toggleFactura = (id: string) => {
    const factura = facturasDeEntidad.find((f) => f.id === id);
    // ✅ Las facturas PAGADAS se muestran pero no se pueden seleccionar.
    if (factura && factura.saldo <= 0.009) return;
    const ya = facturasSel.includes(id);
    // ⚠️ Dos setState INDEPENDIENTES (nunca uno dentro del updater del otro:
    //   React 19 lo considera efecto impuro y desmonta el árbol).
    setFacturasSel(ya ? facturasSel.filter((x) => x !== id) : [...facturasSel, id]);
    setPagosPorFactura((pp) => {
      const nuevo = { ...pp };
      if (ya) delete nuevo[id];
      else nuevo[id] = (factura?.saldo || 0).toFixed(2); // por defecto: el total (su saldo)
      return nuevo;
    });
  };

  const toggleTodas = () => {
    // Opera sobre las VISIBLES (respeta el filtro de búsqueda), conservando
    // las selecciones que el filtro tenga ocultas.
    // ✅ Solo entran las que tienen saldo abierto (las pagadas se ignoran).
    const idsVisibles = facturasVisibles.filter((f) => f.saldo > 0.009).map((f) => f.id);
    const todas = idsVisibles.length > 0 && idsVisibles.every((id) => facturasSel.includes(id));
    if (todas) {
      setFacturasSel(facturasSel.filter((id) => !idsVisibles.includes(id)));
      setPagosPorFactura((pp) => {
        const nuevo = { ...pp };
        idsVisibles.forEach((id) => delete nuevo[id]);
        return nuevo;
      });
    } else {
      setFacturasSel(Array.from(new Set([...facturasSel, ...idsVisibles])));
      setPagosPorFactura((pp) => ({
        ...pp,
        ...Object.fromEntries(facturasVisibles.filter((f) => f.saldo > 0.009).map((f) => [f.id, pp[f.id] ?? f.saldo.toFixed(2)])),
      }));
    }
  };

  // ✅ Editar el monto de UNA factura: nunca mayor que su saldo (se acota).
  const cambiarPagoFactura = (id: string, texto: string) => {
    const factura = facturasDeEntidad.find((f) => f.id === id);
    const tope = factura?.saldo || 0;
    let valor = texto;
    const num = Number(texto);
    if (!isNaN(num) && num > tope) valor = tope.toFixed(2);
    setPagosPorFactura((pp) => ({ ...pp, [id]: valor }));
  };

  const limpiarPago = () => {
    setFacturasSel([]);
    setPagosPorFactura({});
    setMontoTexto('');
    setMontoEditado(false);
  };


  // ── Guardar el pago ──
  const guardarPago = async () => {
    if (!usuario) return;
    if (seleccionadasOrdenadas.length === 0) { alert('Selecciona al menos una factura.'); return; }
    if (totalAplicado <= 0) { alert('Captura el monto a aplicar en al menos una factura.'); return; }
    if (monto <= 0) { alert('Captura el monto recibido del pago.'); return; }
    if (diferencia < -0.009) {
      alert(`Estás aplicando ${money(totalAplicado)} pero el monto recibido es ${money(monto)} (EN CONTRA por ${money(-diferencia)}).\n\nNo se puede aplicar más dinero del recibido: baja el monto de alguna factura o sube el monto recibido.`);
      return;
    }
    if (monedasSel.length > 1) {
      alert(`Las facturas seleccionadas tienen monedas distintas (${monedasSel.join(', ')}). Un pago solo puede cubrir facturas de la misma moneda.`);
      return;
    }
    if (!fechaPago) { alert('Captura la fecha del pago.'); return; }

    setGuardando(true);
    try {
      const pagoRef = doc(collection(db, 'pagos'));

      // Comprobante PDF (opcional): se sube ANTES del batch.
      let pdfUrl = '';
      let pdfNombre = '';
      if (archivoPdf) {
        const destino = storageRef(storage, `pagos/${pagoRef.id}/${archivoPdf.name}`);
        await uploadBytes(destino, archivoPdf);
        pdfUrl = await getDownloadURL(destino);
        pdfNombre = archivoPdf.name;
      }

      const d = new Date();
      const numeroPago = referencia.trim() || `PAGO-${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

      const batch = writeBatch(db);
      batch.set(pagoRef, {
        tipo: tab,
        numeroPago,
        fecha: fechaPago,
        metodoPago,
        referencia: referencia.trim(),
        entidadId: seleccionadasOrdenadas[0]?.entidadId || '',
        entidadNombre: entidadSel,
        monto,
        montoAplicado: totalAplicado,
        saldoAFavor: Math.max(0, diferencia),
        moneda: monedasSel[0] || '',
        observaciones: observaciones.trim(),
        pdfUrl,
        pdfNombre,
        facturas: aplicacion,
        creadoEn: new Date().toISOString(),
        creadoPor: usuario.nombre || usuario.email || usuario.id,
      });

      const coleccion = tab === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
      aplicacion.forEach((a) => {
        if (a.aplicado <= 0) return;
        if (tab === 'mtto') return; // ✅ MTTO: el saldo es derivado; no hay doc de factura
        const fact = seleccionadasOrdenadas.find((f) => f.id === a.facturaId);
        const pagadoNuevo = (fact?.montoPagado || 0) + a.aplicado;
        batch.set(doc(db, coleccion, a.facturaId), {
          montoPagado: pagadoNuevo,
          saldoPendiente: a.saldoNuevo,
          statusPago: a.saldoNuevo <= 0.009 ? 'PAGADA' : 'PARCIAL',
          pagosIds: arrayUnion(pagoRef.id),
        }, { merge: true });
      });

      await batch.commit();
      registrarLog('Pagos', 'Creación', `Registró el pago ${numeroPago} (${money(monto, monedasSel[0])}) de ${entidadSel} cubriendo ${aplicacion.filter(a => a.aplicado > 0).length} factura(s).`).catch(() => {});
      setModalAbierto(false);
    } catch (e) {
      console.error('No se pudo guardar el pago:', e);
      alert('No se pudo guardar el pago. Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  // ── Eliminar pago: revierte la aplicación en sus facturas ──
  const eliminarPago = async (p: PagoDoc) => {
    if (!window.confirm(`¿Eliminar el pago ${p.numeroPago} de ${p.entidadNombre} por ${money(p.monto, p.moneda)}?\n\nSe REVERTIRÁ lo aplicado en sus ${p.facturas?.length || 0} factura(s).`)) return;
    try {
      // Leer el estado ACTUAL de cada factura para revertir sobre lo vigente.
      const coleccion = p.tipo === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
      const batch = writeBatch(db);
      for (const a of (p.facturas || [])) {
        if (a.aplicado <= 0) continue;
        const snap = await getDocs(query(collection(db, coleccion), where('__name__', '==', a.facturaId), limit(1)));
        if (snap.empty) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doc de factura sin tipo canónico.
        const raw = snap.docs[0].data() as any;
        const total = Number(raw.subtotalFactura) || Number(raw.total) || Number(raw.montoFactura) || 0;
        const pagadoNuevo = Math.max(0, (Number(raw.montoPagado) || 0) - a.aplicado);
        const saldoNuevo = Math.max(0, total - pagadoNuevo);
        batch.set(doc(db, coleccion, a.facturaId), {
          montoPagado: pagadoNuevo,
          saldoPendiente: saldoNuevo,
          statusPago: pagadoNuevo <= 0.009 ? '' : (saldoNuevo <= 0.009 ? 'PAGADA' : 'PARCIAL'),
          pagosIds: arrayRemove(p.id),
        }, { merge: true });
      }
      batch.delete(doc(db, 'pagos', p.id));
      await batch.commit();
      registrarLog('Pagos', 'Eliminación', `Eliminó el pago ${p.numeroPago} de ${p.entidadNombre} (${money(p.monto, p.moneda)}) y revirtió su aplicación.`).catch(() => {});
      setPagoViendo(null);
    } catch (e) {
      console.error('No se pudo eliminar el pago:', e);
      alert('No se pudo eliminar el pago. Intenta de nuevo.');
    }
  };

  // ────────────────────────────── RENDER ──────────────────────────────
  return (
    <div className="pg-contenedor">
      {hiloPago && (
        <HiloModal tipo={hiloPago.tipo === 'proveedor' ? 'proveedor' : 'cliente'} pago={{ id: hiloPago.id, numeroPago: hiloPago.numeroPago, monto: hiloPago.monto, moneda: hiloPago.moneda, facturas: hiloPago.facturas || [] }} onClose={() => setHiloPago(null)} onEditarOperacion={(id) => setOpEditandoId(id)} />
      )}
      {opEditandoId && (
        <EditorOperacionEmbebido operacionId={opEditandoId} onClose={() => setOpEditandoId(null)} />
      )}
      <div className="pg-encabezado">
        <h1 className="pg-titulo">Pagos</h1>
        <div className="pg-encabezado-acciones">
          <div className="pg-reportes">
            <button className="pg-btn-reportes" onClick={() => setMenuReportes((v) => !v)} disabled={generandoReporte}>
              <Download size={15} /> {generandoReporte ? 'Generando…' : 'Reportes'}
            </button>
            {menuReportes && (
              <>
                <div className="pg-reportes-fondo" onClick={() => setMenuReportes(false)} />
                <div className="pg-reportes-menu">
                  <span className="pg-reportes-titulo">Pagos realizados ({etiquetaTab.toLowerCase()})</span>
                  <button onClick={exportarPagosExcel}>Excel (.xlsx)</button>
                  <button onClick={exportarPagosPDF}>PDF</button>
                  <span className="pg-reportes-titulo">Facturas pendientes</span>
                  <button onClick={exportarPendientesExcel}>Excel (.xlsx)</button>
                  <button onClick={exportarPendientesPDF}>PDF</button>
                </div>
              </>
            )}
          </div>
          <button className="pg-btn-secundario" onClick={recargarFacturas} disabled={recargando} title="Actualizar facturas y saldos">
            <RefreshCw size={14} className={recargando ? 'pg-girando' : undefined} /> {recargando ? 'Actualizando…' : 'Recargar'}
          </button>
          <button className="pg-btn-nuevo" onClick={abrirModal}>
            <Plus size={16} /> Registrar Pago
          </button>
        </div>
      </div>

      <div className="pg-tabs">
        <button className={`pg-tab${tab === 'cliente' ? ' activa' : ''}`} onClick={() => setTab('cliente')}>Pagos de Clientes</button>
        <button className={`pg-tab${tab === 'proveedor' ? ' activa' : ''}`} onClick={() => setTab('proveedor')}>Pagos a Proveedores</button>
        <button className={`pg-tab${tab === 'mtto' ? ' activa' : ''}`} onClick={() => setTab('mtto')}>Pagos de Mantenimiento y Refacción</button>
      </div>

      <div className="pg-buscador">
        <Search size={15} />
        <input
          type="text"
          placeholder="Buscar por cliente/proveedor, número, referencia o factura..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {/* ✅ Resumen del listado (conteo y total por moneda) */}
      {pagosFiltrados.length > 0 && (
        <div className="pg-resumen">
          <span className="pg-resumen-item"><strong>{pagosFiltrados.length}</strong> pago(s)</span>
          {Object.entries(pagosFiltrados.reduce((acc: Record<string, number>, p) => {
            const k = p.moneda || 'S/M';
            acc[k] = (acc[k] || 0) + (Number(p.monto) || 0);
            return acc;
          }, {})).map(([mon, tot]) => (
            <span className="pg-resumen-item" key={mon}>Total <strong>{money(tot, mon === 'S/M' ? '' : mon)}</strong></span>
          ))}
        </div>
      )}

      <div className="pg-tabla-marco">
        <table className="pg-tabla">
          <thead>
            <tr>
              <th>ACCIONES</th>
              <th style={{ cursor: 'pointer' }} onClick={() => clickOrdenPagos('fecha')}>FECHA{flechaOrden('fecha')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => clickOrdenPagos('numero')}># PAGO{flechaOrden('numero')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => clickOrdenPagos('entidad')}>{tab === 'cliente' ? 'CLIENTE' : tab === 'proveedor' ? 'PROVEEDOR' : 'PROVEEDOR MTTO'}{flechaOrden('entidad')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => clickOrdenPagos('metodo')}>MÉTODO{flechaOrden('metodo')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => clickOrdenPagos('monto')}>MONTO{flechaOrden('monto')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => clickOrdenPagos('facturas')}>FACTURAS{flechaOrden('facturas')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => clickOrdenPagos('comprobante')}>COMPROBANTE{flechaOrden('comprobante')}</th>
            </tr>
          </thead>
          <tbody>
            {pagosFiltrados.length === 0 ? (
              <tr><td colSpan={8} className="pg-vacio">{busqueda ? 'Sin resultados.' : 'Aún no hay pagos registrados.'}</td></tr>
            ) : pagosFiltrados.slice((paginaPagos - 1) * PAGOS_POR_PAGINA, paginaPagos * PAGOS_POR_PAGINA).map((p) => (
              <tr key={p.id} className="pg-fila" onClick={() => setPagoViendo(p)} title="Ver detalle del pago">
                <td onClick={(e) => e.stopPropagation()}>
                  {/* ✅ V00126: acciones en una sola fila (editar · eliminar · hilo) */}
                  <div className="pg-acciones">
                    <button className="pg-btn-borrar pg-btn-editar" onClick={() => abrirEdicionPago(p)} title="Editar pago">
                      <Pencil size={14} />
                    </button>
                    <button className="pg-btn-borrar" onClick={() => eliminarPago(p)} title="Eliminar pago (revierte su aplicación)">
                      <Trash2 size={14} />
                    </button>
                    <button className="pg-btn-borrar pg-btn-hilo" onClick={() => setHiloPago(p)} title="Verificar el hilo Operaciones → Facturación → Pago">🔗</button>
                  </div>
                </td>
                <td className="pg-fecha">{p.fecha}</td>
                <td className="pg-numero">{p.numeroPago}</td>
                <td className="pg-entidad">{p.entidadNombre}{monedaEmpresaDe(p) && <span className="pg-moneda-empresa" title="Moneda registrada en la tabla Empresas">{monedaEmpresaDe(p)}</span>}</td>
                <td>{p.metodoPago}</td>
                <td className="pg-monto">{money(p.monto, p.moneda)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="pg-chips">
                    {/* ✅ NUEVO: clic en el chip abre la factura para revisarla/editarla */}
                    {(p.facturas || []).filter(f => f.aplicado > 0).map((f) => (
                      <button className="pg-chip" key={f.facturaId}
                        type="button"
                        title={`Aplicado ${money(f.aplicado)} · Saldo ${money(f.saldoNuevo)} — clic para revisar/editar la factura`}
                        onClick={() => abrirFacturaPorId(f.facturaId, p.tipo)}
                        style={{ cursor: 'pointer', border: '1px solid rgba(88,166,255,0.35)', background: 'transparent', opacity: cargandoFacturaChip === f.facturaId ? 0.5 : 1 }}>
                        {cargandoFacturaChip === f.facturaId ? 'Abriendo…' : `${f.invoice}${f.saldoNuevo > 0.009 ? ' (parcial)' : ''}`}
                      </button>
                    ))}
                  </div>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {p.pdfUrl
                    ? <a className="pg-pdf" href={p.pdfUrl} target="_blank" rel="noopener noreferrer"><FileText size={14} /> Ver</a>
                    : <span className="pg-sin-pdf">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
          {/* ✅ V00170: paginación de pagos */}
          {pagosFiltrados.length > PAGOS_POR_PAGINA && (
            <div className="pd-paginacion">
              <span className="pd-pag-info">Mostrando {(paginaPagos - 1) * PAGOS_POR_PAGINA + 1}–{Math.min(paginaPagos * PAGOS_POR_PAGINA, pagosFiltrados.length)} de {pagosFiltrados.length} pago(s)</span>
              <button type="button" className="btn btn-outline" disabled={paginaPagos <= 1} onClick={() => setPaginaPagos((x) => x - 1)}>← Anterior</button>
              <span className="pd-pag-num">{paginaPagos} / {Math.ceil(pagosFiltrados.length / PAGOS_POR_PAGINA)}</span>
              <button type="button" className="btn btn-outline" disabled={paginaPagos >= Math.ceil(pagosFiltrados.length / PAGOS_POR_PAGINA)} onClick={() => setPaginaPagos((x) => x + 1)}>Siguiente →</button>
            </div>
          )}
      </div>

      {/* ══════════ FICHA DEL PAGO ══════════ */}
      {pagoViendo && (
        <div className="pg-overlay" onClick={() => setPagoViendo(null)}>
          <div className="pg-modal pg-ficha" onClick={(e) => e.stopPropagation()}>
            <div className="pg-modal-encabezado">
              <h3>Pago {pagoViendo.numeroPago}</h3>
              <button className="pg-cerrar" onClick={() => setPagoViendo(null)}><X size={16} /></button>
            </div>
            <div className="pg-modal-cuerpo">
              <div className="pg-ficha-grid">
                <div><span className="pg-etq">Fecha</span><span>{pagoViendo.fecha}</span></div>
                <div><span className="pg-etq">{pagoViendo.tipo === 'cliente' ? 'Cliente' : 'Proveedor'}</span><span>{pagoViendo.entidadNombre}</span></div>
                <div><span className="pg-etq">Método</span><span>{pagoViendo.metodoPago}</span></div>
                <div><span className="pg-etq">Referencia</span><span>{pagoViendo.referencia || '—'}</span></div>
                <div><span className="pg-etq">Monto</span><span className="pg-monto">{money(pagoViendo.monto, pagoViendo.moneda)}</span></div>
                <div><span className="pg-etq">Registró</span><span>{pagoViendo.creadoPor || '—'}</span></div>
              </div>
              {pagoViendo.observaciones && <p className="pg-obs">{pagoViendo.observaciones}</p>}
              {pagoViendo.pdfUrl && (
                <a className="pg-pdf" href={pagoViendo.pdfUrl} target="_blank" rel="noopener noreferrer">
                  <FileText size={14} /> {pagoViendo.pdfNombre || 'Ver comprobante'}
                </a>
              )}
              <table className="pg-tabla pg-tabla-aplicacion">
                <thead>
                  <tr><th>FACTURA</th><th>FECHA</th><th>TOTAL</th><th>APLICADO</th><th>SALDO RESULTANTE</th></tr>
                </thead>
                <tbody>
                  {(pagoViendo.facturas || []).map((f) => (
                    <tr key={f.facturaId}>
                      <td className="pg-numero">
                        {/* ✅ NUEVO: abre la factura para revisarla/editarla */}
                        <button type="button" onClick={() => abrirFacturaPorId(f.facturaId, pagoViendo.tipo)}
                          title="Revisar / editar esta factura"
                          style={{ background: 'transparent', border: 'none', color: '#58a6ff', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}>
                          {f.invoice}
                        </button>
                      </td>
                      <td>{f.fecha}</td>
                      <td>{money(f.total)}</td>
                      <td className="pg-monto">{money(f.aplicado)}</td>
                      <td className={f.saldoNuevo > 0.009 ? 'pg-parcial' : 'pg-pagada'}>
                        {f.saldoNuevo > 0.009 ? money(f.saldoNuevo) : 'PAGADA'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pg-modal-pie">
              <button className="pg-btn-secundario" style={{ marginRight: 'auto', color: '#58a6ff', borderColor: 'rgba(88,166,255,0.4)' }}
                onClick={() => abrirEdicionPago(pagoViendo)}>
                <Pencil size={13} style={{ marginRight: '6px', verticalAlign: '-2px' }} />Editar
              </button>
              <button className="pg-btn-secundario" onClick={() => setPagoViendo(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ ✅ NUEVO — MODAL DETALLE/RECTIFICACIÓN DE OPERACIÓN ══════════ */}
      {opViendo && (() => {
        const ov = opViendo;
        const et: React.CSSProperties = { display: 'block', color: '#8b949e', fontSize: '0.72rem', marginBottom: '3px', fontWeight: 600, textTransform: 'uppercase' };
        const va: React.CSSProperties = { color: '#c9d1d9', fontWeight: 600 };
        const inp: React.CSSProperties = { width: '100%', padding: '9px 10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' };
        // Pares label/valor de revisión: solo se muestran los que traen dato.
        const pares = ([
          ['Referencia', ov.ref],
          ['Status', ov.statusNombre || ov.status],
          ['Tipo de operación', ov.tipoOperacionNombre || ov.tipoOperacion],
          ['Cliente', ov.clientePagaNombre || ov.clienteNombre || ov.cliente],
          ['Proveedor', ov.provServiciosNombre || ov.proveedorNombre || ov.proveedor],
          ['Operador', ov.operadorNombre || ov.operador],
          ['Unidad', ov.unidadNombre || ov.unidad],
          ['Origen', ov.origenNombre || ov.origen],
          ['Destino', ov.destinoNombre || ov.destino],
          ['Fecha de cita', ov.fechaCita],
        ] as [string, any][]).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
        return (
          <div className="pg-overlay" style={{ zIndex: 2200 }} onClick={() => !guardandoOp && setOpViendo(null)}>
            <div className="pg-modal" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pg-modal-encabezado">
                <h3>Operación {ov.ref || ov.id}</h3>
                <button className="pg-cerrar" onClick={() => setOpViendo(null)} disabled={guardandoOp}><X size={16} /></button>
              </div>
              <div className="pg-modal-cuerpo" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {ov.__soloResumen && (
                  <div style={{ fontSize: '0.8rem', color: '#d29922', border: '1px dashed #d29922', borderRadius: '8px', padding: '10px' }}>
                    Esta operación ya no existe en la colección de operaciones: se muestra el resumen guardado en la factura (solo lectura).
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                  {pares.map(([l, v]) => (
                    <div key={l}><label style={et}>{l}</label><span style={va}>{String(v)}</span></div>
                  ))}
                </div>

                {!editandoOp ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', borderTop: '1px solid #30363d', paddingTop: '12px' }}>
                    <div><label style={et}>Fecha de servicio</label><span style={va}>{ov.fechaServicio || '-'}</span></div>
                    <div><label style={et}># Remolque</label><span style={va}>{ov.remolqueNombre || ov.remolque || '-'}</span></div>
                    <div><label style={et}>Placa remolque</label><span style={va}>{ov.remolquePlaca || '-'}</span></div>
                    <div style={{ gridColumn: '1 / -1' }}><label style={et}>Observaciones</label><span style={{ color: '#c9d1d9' }}>{ov.observaciones || '-'}</span></div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', borderTop: '1px solid #30363d', paddingTop: '12px' }}>
                    <div><label style={et}>Fecha de servicio</label><input style={inp} type="date" value={opEditFechaServicio} onChange={(e) => setOpEditFechaServicio(e.target.value)} /></div>
                    <div><label style={et}># Remolque</label><input style={inp} type="text" value={opEditRemolqueNombre} onChange={(e) => setOpEditRemolqueNombre(e.target.value)} /></div>
                    <div><label style={et}>Placa remolque</label><input style={inp} type="text" value={opEditRemolquePlaca} onChange={(e) => setOpEditRemolquePlaca(e.target.value)} /></div>
                    <div style={{ gridColumn: '1 / -1' }}><label style={et}>Observaciones</label><textarea className="pg-memo" rows={2} value={opEditObs} onChange={(e) => setOpEditObs(e.target.value)} /></div>
                    <div style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: '#8b949e' }}>
                      Status, convenios y montos se corrigen en el módulo de Operaciones (dependen de flujos y catálogos).
                    </div>
                  </div>
                )}
              </div>
              <div className="pg-modal-pie">
                {!editandoOp ? (
                  <>
                    {!ov.__soloResumen && (
                      <button className="pg-btn-secundario" style={{ marginRight: 'auto', color: '#58a6ff', borderColor: 'rgba(88,166,255,0.4)' }} onClick={() => setEditandoOp(true)}>
                        <Pencil size={13} style={{ marginRight: '6px', verticalAlign: '-2px' }} />Rectificar
                      </button>
                    )}
                    <button className="pg-btn-secundario" onClick={() => setOpViendo(null)}>Cerrar</button>
                  </>
                ) : (
                  <>
                    <button className="pg-btn-secundario" onClick={() => setEditandoOp(false)} disabled={guardandoOp}>Cancelar</button>
                    <button className="pg-btn-nuevo" onClick={guardarEdicionOperacion} disabled={guardandoOp}>
                      {guardandoOp ? 'Guardando…' : 'Guardar Operación'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════ ✅ NUEVO — MODAL DETALLE/EDICIÓN DE FACTURA ══════════ */}
      {facturaViendo && (() => {
        const fv = facturaViendo;
        const etiquetaCampo: React.CSSProperties = { display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase' };
        const inputF: React.CSSProperties = { width: '100%', padding: '9px 10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' };
        const valorF: React.CSSProperties = { color: '#c9d1d9', fontWeight: 600 };
        return (
          <div className="pg-overlay" style={{ zIndex: 2100 }} onClick={() => !guardandoFactura && setFacturaViendo(null)}>
            <div className="pg-modal" style={{ maxWidth: '760px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pg-modal-encabezado">
                <h3>Factura # {fv.invoice} · {fv.entidadNombre}</h3>
                <button className="pg-cerrar" onClick={() => setFacturaViendo(null)} disabled={guardandoFactura}><X size={16} /></button>
              </div>
              <div className="pg-modal-cuerpo" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                {!editandoFactura ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
                    <div><label style={etiquetaCampo}># Invoice</label><span style={valorF}>{fv.invoice}</span></div>
                    <div><label style={etiquetaCampo}>Fecha</label><span style={valorF}>{fv.fecha || '-'}</span></div>
                    <div><label style={etiquetaCampo}>Status</label><span style={{ ...valorF, color: String(fv.raw?.statusFactura || 'Facturado').toLowerCase().includes('cancel') ? '#f85149' : '#3fb950' }}>{fv.raw?.statusFactura || 'Facturado'}</span></div>
                    <div><label style={etiquetaCampo}>Factura CCP</label><span style={valorF}>{fv.raw?.facturaCcp || fv.raw?.ccp || '-'}</span></div>
                    <div><label style={etiquetaCampo}>Moneda</label><span style={valorF} title="Moneda actual de la empresa (tabla Empresas); si difiere de la guardada, usa Recalcular montos para actualizarla en la factura">{(() => { const m = monedaEmpresaDe({ entidadNombre: fv.entidadNombre, entidadId: (fv as any).entidadId }); const n = m.toLowerCase(); const canon = n.includes('dolar') || n.includes('dólar') || n.includes('usd') ? 'USD' : (n.includes('peso') || n.includes('mxn')) ? 'MXN' : ''; return canon ? <>{canon}{canon !== String(fv.moneda || '') && <small style={{ color: '#f59e0b' }}> (antes {fv.moneda || '—'})</small>}</> : (fv.moneda || '-'); })()}</span></div>
                    <div><label style={etiquetaCampo}>Total</label><span style={valorF}>{money(fv.total)}</span></div>
                    <div><label style={etiquetaCampo}>Pagado</label><span style={{ ...valorF, color: '#3fb950' }}>{money(fv.montoPagado)}</span></div>
                    <div><label style={etiquetaCampo}>Saldo abierto</label><span style={{ ...valorF, color: fv.saldo > 0.009 ? '#d29922' : '#3fb950' }}>{fv.saldo > 0.009 ? money(fv.saldo) : 'PAGADA'}</span></div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                    <div><label style={etiquetaCampo}># Invoice</label><input style={inputF} type="text" value={fEditInvoice} onChange={(e) => setFEditInvoice(e.target.value)} /></div>
                    <div><label style={etiquetaCampo}>Fecha</label><input style={inputF} type="date" value={fEditFecha} onChange={(e) => setFEditFecha(e.target.value)} /></div>
                    <div>
                      <label style={etiquetaCampo}>Status</label>
                      <SelectBuscable
                        opciones={['Facturado', 'Cancelado', 'No Facturado'].map((s) => ({ value: s, label: s }))}
                        value={fEditStatus}
                        onChange={setFEditStatus}
                        placeholder="Buscar status..."
                      />
                    </div>
                    <div><label style={etiquetaCampo}>Factura CCP</label><input style={inputF} type="text" value={fEditCcp} onChange={(e) => setFEditCcp(e.target.value)} /></div>
                    <div>
                      <label style={etiquetaCampo}>Moneda</label>
                      {/* ✅ V00126: la moneda de la factura viene de la tabla Empresas y NO se puede editar */}
                      <input style={{ ...inputF, opacity: 0.75, cursor: 'not-allowed' }} type="text" readOnly value={fEditMoneda || fv.moneda || '—'} title="Se toma de la moneda registrada en Empresas para este cliente/proveedor; no se puede modificar aquí" />
                    </div>
                    <div>
                      <label style={etiquetaCampo}>Total ({fEditMoneda || fv.moneda || 'sin moneda'})</label>
                      <input style={inputF} type="number" min="0" step="0.01" value={fEditTotal} onChange={(e) => setFEditTotal(e.target.value)} />
                      {fv.montoPagado > 0.009 && (
                        <span style={{ display: 'block', marginTop: '4px', fontSize: '0.72rem', color: '#d29922' }}>
                          Ya tiene {money(fv.montoPagado)} pagados: el total no puede ser menor a eso. El saldo se recalcula solo.
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* OPERACIONES RELACIONADAS A LA FACTURA */}
                <div>
                  <label style={etiquetaCampo}>Operaciones de la factura ({opsFactura.length})</label>
                  {cargandoOpsFactura ? (
                    <p className="pg-vacio">Cargando operaciones…</p>
                  ) : opsFactura.length === 0 ? (
                    <p className="pg-vacio">Esta factura no tiene operaciones ligadas.</p>
                  ) : (
                    <div style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto' }}>
                      <table className="pg-tabla">
                        <thead>
                          <tr><th>REFERENCIA</th><th>FECHA SERVICIO</th><th># REMOLQUE</th><th>CONVENIO</th><th>MONEDA CONVENIO</th><th>IMPORTE (CONVERSIÓN)</th></tr>
                        </thead>
                        <tbody>
                          {opsFactura.map((o: any, idx: number) => (
                            <tr key={o.id || idx}>
                              <td className="pg-numero">
                                {/* ✅ NUEVO: revisar/rectificar la operación */}
                                <button type="button" title="Revisar / rectificar esta operación"
                                  onClick={() => abrirDetalleOperacion(o.id, o)} disabled={cargandoOpViendo}
                                  style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: '6px', color: '#58a6ff', cursor: 'pointer', padding: '3px 7px', marginRight: '8px', verticalAlign: 'middle' }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                </button>
                                {o.ref || o.id || '-'}
                                {/* ✅ V00126: editar la operación completa en el formulario de Operaciones */}
                                {o.id && !String(o.id).startsWith('g_') && <button type="button" className="pg-btn-op-completa" title="Editar la operación completa (formulario de Operaciones)" onClick={() => setOpEditandoId(String(o.id))}>✎</button>}
                              </td>
                              <td>{o.fechaServicio || o.fecha || '-'}</td>
                              <td>{o.remolque || '-'}</td>
                              <td>{o.convenio || '—'}</td>
                              <td>{o.monedaConvenio || '—'}</td>
                              <td className="pg-monto">{o.importeDetalle || (o.importe !== '' && o.importe !== undefined && o.importe !== null ? money(Number(o.importe) || 0) : '—')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="pg-modal-pie">
                {!editandoFactura ? (
                  <>
                    {tab !== 'mtto' && (<>
                    <button className="pg-btn-secundario" style={{ marginRight: 'auto', color: '#58a6ff', borderColor: 'rgba(88,166,255,0.4)' }} onClick={() => setEditandoFactura(true)}>
                      <Pencil size={13} style={{ marginRight: '6px', verticalAlign: '-2px' }} />Editar factura
                    </button>
                    {/* ✅ NUEVO: rehace los montos desde las operaciones con la regla de monedas */}
                    <button className="pg-btn-secundario" style={{ color: '#d29922', borderColor: 'rgba(210,153,34,0.4)' }}
                      onClick={recalcularFactura} disabled={recalculandoFactura}
                      title="Rehace los montos desde las operaciones (convenio USD facturado en pesos -> conversión con TC)">
                      {recalculandoFactura ? 'Recalculando…' : 'Recalcular montos'}
                    </button>
                    </>)}
                    <button className="pg-btn-secundario" onClick={() => setFacturaViendo(null)}>Cerrar</button>
                  </>
                ) : (
                  <>
                    <button className="pg-btn-secundario" onClick={() => setEditandoFactura(false)} disabled={guardandoFactura}>Cancelar</button>
                    <button className="pg-btn-nuevo" onClick={guardarEdicionFactura} disabled={guardandoFactura}>
                      {guardandoFactura ? 'Guardando…' : 'Guardar Factura'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════ ✅ NUEVO — MODAL EDITAR PAGO ══════════ */}
      {pagoEditando && (
        <div className="pg-overlay" style={{ zIndex: 2100 }} onClick={() => !guardandoEdicion && setPagoEditando(null)}>
          <div className="pg-modal" style={{ maxWidth: '900px', width: 'min(900px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
            <div className="pg-modal-encabezado">
              <h3>Editar Pago · {pagoEditando.entidadNombre}</h3>
              <button className="pg-cerrar" onClick={() => setPagoEditando(null)} disabled={guardandoEdicion}><X size={16} /></button>
            </div>
            <div className="pg-modal-cuerpo" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '0.8rem', color: '#8b949e', border: '1px dashed #30363d', borderRadius: '8px', padding: '10px' }}>
                Monto: <b style={{ color: '#c9d1d9' }}>{money(pagoEditando.monto, pagoEditando.moneda)}</b> · {(pagoEditando.facturas || []).filter(f => f.aplicado > 0).length} factura(s) aplicadas.
                Los montos y las facturas NO se editan aquí: si el pago se aplicó mal, elimínalo (revierte los saldos) y regístralo de nuevo.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="pg-campo">
                  <label>Fecha del pago</label>
                  <input type="date" value={editFecha} onChange={(e) => setEditFecha(e.target.value)} />
                </div>
                <div className="pg-campo">
                  <label>Método de pago</label>
                  <SelectBuscable
                    opciones={METODOS_PAGO.map((m) => ({ value: m, label: m }))}
                    value={editMetodo}
                    onChange={setEditMetodo}
                    placeholder="Buscar método..."
                  />
                </div>
                <div className="pg-campo">
                  <label># de pago</label>
                  <input type="text" value={editNumero} onChange={(e) => setEditNumero(e.target.value)} placeholder="Número o folio del pago" />
                </div>
                <div className="pg-campo">
                  <label>Referencia</label>
                  <input type="text" value={editReferencia} onChange={(e) => setEditReferencia(e.target.value)} placeholder="Referencia bancaria (opcional)" />
                </div>
              </div>
              <div className="pg-campo">
                <label>Memo / Observaciones</label>
                <textarea className="pg-memo" rows={3} value={editObs} onChange={(e) => setEditObs(e.target.value)} placeholder="Nota del pago..." />
              </div>
              <div className="pg-campo">
                <label>Comprobante {pagoEditando.pdfNombre ? `(actual: ${pagoEditando.pdfNombre})` : '(sin comprobante)'} — subir uno lo reemplaza</label>
                <input type="file" accept="application/pdf,image/*" onChange={(e) => setEditArchivoPdf(e.target.files?.[0] || null)} />
              </div>

              {/* ✅ NUEVO — AGREGAR FACTURAS A ESTE PAGO */}
              <div className="pg-campo">
                <label>Agregar facturas a este pago (con saldo abierto de {pagoEditando.entidadNombre})</label>
                {cargandoEditFacturas ? (
                  <p className="pg-vacio">Buscando facturas con saldo…</p>
                ) : editFacturasDisp.length === 0 ? (
                  <p className="pg-vacio">No hay más facturas con saldo abierto de esta entidad.</p>
                ) : (() => {
                  // ✅ NUEVO: buscador de facturas pendientes dentro de la edición.
                  const q = editBusquedaFactura.trim().toLowerCase();
                  const visiblesEdit = q
                    ? editFacturasDisp.filter((fx) =>
                        fx.invoice.toLowerCase().includes(q) ||
                        String(fx.fecha || '').toLowerCase().includes(q) ||
                        editFacturasSel.includes(fx.id))
                    : editFacturasDisp;
                  return (
                  <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <div style={{ position: 'relative', flex: 1, maxWidth: '320px' }}>
                      <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} />
                      <input
                        type="text"
                        value={editBusquedaFactura}
                        onChange={(e) => setEditBusquedaFactura(e.target.value)}
                        placeholder="Buscar # de factura o fecha..."
                        style={{ width: '100%', padding: '8px 10px 8px 30px', backgroundColor: '#010409', border: '1px solid #30363d', borderRadius: '8px', color: '#c9d1d9', fontSize: '0.85rem', boxSizing: 'border-box' }}
                      />
                      {editBusquedaFactura && (
                        <button type="button" onClick={() => setEditBusquedaFactura('')}
                          style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', padding: 0 }}>
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    <span style={{ color: '#8b949e', fontSize: '0.78rem' }}>{visiblesEdit.length} de {editFacturasDisp.length}</span>
                  </div>
                  <div style={{ border: '1px solid #30363d', borderRadius: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                    <table className="pg-tabla">
                      <thead>
                        <tr><th style={{ width: '34px' }}></th><th>FACTURA</th><th>SALDO</th><th>MONEDA</th><th>APLICAR</th></tr>
                      </thead>
                      <tbody>
                        {visiblesEdit.length === 0 ? (
                          <tr><td colSpan={5} style={{ textAlign: 'center', color: '#8b949e', padding: '14px' }}>Sin resultados para esa búsqueda.</td></tr>
                        ) : visiblesEdit.map((fx) => (
                          <tr key={fx.id} className="pg-fila" onClick={() => toggleEditFactura(fx.id)}>
                            <td onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={editFacturasSel.includes(fx.id)} onChange={() => toggleEditFactura(fx.id)} />
                            </td>
                            <td><span className="pg-numero">{fx.invoice}</span>{fx.fecha ? <span className="pg-desc-fecha"> ({fx.fecha})</span> : null}</td>
                            <td className="pg-monto">{money(fx.saldo)}</td>
                            <td>{fx.moneda || '—'}</td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <input
                                type="number" min="0" step="0.01" max={fx.saldo}
                                className="pg-input-pago"
                                disabled={!editFacturasSel.includes(fx.id)}
                                value={editFacturasSel.includes(fx.id) ? (editPagoPorFactura[fx.id] ?? '') : ''}
                                onChange={(e) => setEditPagoPorFactura((pp) => ({ ...pp, [fx.id]: e.target.value }))}
                                placeholder={editFacturasSel.includes(fx.id) ? '0.00' : '—'}
                                title={`Máximo: ${money(fx.saldo)}`}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                  );
                })()}
                {sumaAgregadaEdicion > 0 && (
                  <span style={{ display: 'block', marginTop: '6px', fontSize: '0.8rem', color: '#3fb950', fontWeight: 600 }}>
                    Se agregarán {money(sumaAgregadaEdicion)} al pago (nuevo total: {money((Number(pagoEditando.monto) || 0) + sumaAgregadaEdicion, pagoEditando.moneda)}).
                  </span>
                )}
              </div>
            </div>
            <div className="pg-modal-pie">
              <button className="pg-btn-secundario" onClick={() => setPagoEditando(null)} disabled={guardandoEdicion}>Cancelar</button>
              <button className="pg-btn-nuevo" onClick={guardarEdicionPago} disabled={guardandoEdicion}>
                {guardandoEdicion ? 'Guardando…' : 'Guardar Cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MODAL REGISTRAR PAGO ══════════ */}
      {modalAbierto && (
        <div className="pg-overlay">
          <div className="pg-modal pg-modal-registro">
            <div className="pg-modal-encabezado">
              <h3>Registrar Pago · {tab === 'cliente' ? 'Cliente' : tab === 'proveedor' ? 'Proveedor' : 'Invoice MTTO'}</h3>
              <button className="pg-cerrar" onClick={() => setModalAbierto(false)}><X size={16} /></button>
            </div>

            <div className="pg-modal-cuerpo">
              {cargandoFacturas ? (
                <p className="pg-vacio">Cargando facturas…</p>
              ) : !entidadSel ? (
                <>
                  {/* PASO 1: elegir cliente/proveedor con facturas pendientes */}
                  <label className="pg-etq">1. Elige {tab === 'cliente' ? 'el cliente' : tab === 'proveedor' ? 'el proveedor' : 'el proveedor del gasto MTTO'} (solo aparecen los que tienen facturas con saldo)
                    <button type="button" className="pg-btn-secundario" style={{ marginLeft: '10px', padding: '4px 10px', color: unirModo ? '#d29922' : undefined, borderColor: unirModo ? 'rgba(210,153,34,0.5)' : undefined }}
                      disabled={uniendoEnt}
                      onClick={() => { setUnirModo((v) => !v); setUnirOrigen(null); }}>
                      {uniendoEnt ? 'Uniendo…' : unirModo ? (unirOrigen ? `Se elimina: "${unirOrigen}" — elige el que SE CONSERVA` : 'Elige el duplicado que SE ELIMINA (o cancela)') : 'Unir duplicados'}
                    </button>
                  </label>
                  <div className="pg-buscador">
                    <Search size={15} />
                    <input
                      type="text"
                      placeholder="Buscar por nombre..."
                      value={busquedaEntidad}
                      onChange={(e) => setBusquedaEntidad(e.target.value)}
                      autoFocus
                    />
                  </div>
                  {entidadesFiltradas.length === 0 ? (
                    <p className="pg-vacio">No hay facturas{busquedaEntidad ? ' para esa búsqueda' : ''}.</p>
                  ) : (
                    <ul className="pg-lista-entidades">
                      {entidadesFiltradas.map((e) => (
                        <li key={e.nombre}>
                          <button onClick={() => { if (unirModo) { clickEntidadUnir(e.nombre); return; } setEntidadSel(e.nombre); setFacturasSel([]); }}
                          style={unirModo && unirOrigen && claveEntidad(unirOrigen) === claveEntidad(e.nombre) ? { borderColor: '#f85149' } : undefined}>
                            <span className="pg-entidad">{e.nombre}</span>
                            <span className="pg-entidad-info">{e.cuantas} factura(s) con saldo · {money(e.saldo)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>
                  {/* ═══ ENCABEZADO estilo QuickBooks: entidad + monto grande ═══ */}
                  <div className="pg-qb-encabezado">
                    <div className="pg-qb-entidad">
                      <span className="pg-etq">{tab === 'cliente' ? 'Cliente' : tab === 'proveedor' ? 'Proveedor' : 'Invoice MTTO'}</span>
                      <div className="pg-paso2-encabezado">
                        <span className="pg-entidad">{entidadSel}</span>
                        <button className="pg-btn-liga" onClick={() => { setEntidadSel(''); limpiarPago(); }}>Cambiar</button>
                      </div>
                    </div>
                    <div className="pg-qb-recibido">
                      <span className="pg-qb-recibido-etq">MONTO RECIBIDO</span>
                      <span className="pg-qb-recibido-monto">{money(monto, monedasSel[0])}</span>
                      <span className="pg-qb-saldo">
                        Saldo del {tab === 'cliente' ? 'cliente' : 'proveedor'}: {money(facturasDeEntidad.reduce((s, f) => s + f.saldo, 0))}
                      </span>
                    </div>
                  </div>

                  {/* ═══ Registrar pago + Monto (dos cajas, como QuickBooks) ═══ */}
                  <div className="pg-qb-registro">
                    <div className="pg-qb-caja">
                      <span className="pg-etq">Registrar pago</span>
                      <div className="pg-qb-campos">
                        <div className="pg-campo">
                          <label>Fecha del pago</label>
                          <input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
                        </div>
                        <div className="pg-campo">
                          <label>Método de pago</label>
                          <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)}>
                            {METODOS_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div className="pg-campo">
                          <label>Referencia / # de pago</label>
                          <input type="text" placeholder="Cheque, folio, rastreo..." value={referencia} onChange={(e) => setReferencia(e.target.value)} />
                        </div>
                      </div>
                    </div>
                    <div className="pg-qb-caja pg-qb-caja-monto">
                      <span className="pg-etq">Monto</span>
                      <div className="pg-campo">
                        <label>Monto recibido {monedasSel[0] ? `(${monedasSel[0]})` : ''}</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="pg-input-recibido"
                          value={montoTexto}
                          onChange={(e) => { setMontoTexto(e.target.value); setMontoEditado(true); }}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>

                  {/* ═══ Transacciones pendientes ═══ */}
                  <div className="pg-trans-encabezado">
                    <label className="pg-etq">Transacciones pendientes</label>
                    {/* ✅ NUEVO: recarga sin salir (conserva selección y montos) */}
                    <button type="button" className="pg-btn-secundario" style={{ padding: '6px 12px' }}
                      onClick={() => recargarFacturasModal(false)} disabled={recargandoModal}
                      title="Actualizar facturas y saldos sin perder lo seleccionado">
                      <RefreshCw size={13} className={recargandoModal ? 'pg-girando' : undefined} /> {recargandoModal ? 'Actualizando…' : 'Recargar'}
                    </button>
                    <div className="pg-buscador pg-buscador-factura">
                      <Search size={14} />
                      <input
                        type="text"
                        placeholder="Buscar # de factura..."
                        value={busquedaFactura}
                        onChange={(e) => setBusquedaFactura(e.target.value)}
                      />
                      {busquedaFactura && (
                        <button type="button" className="pg-btn-liga" onClick={() => setBusquedaFactura('')}>✕</button>
                      )}
                    </div>
                    {busquedaFactura && (
                      <span className="pg-trans-conteo">{facturasVisibles.length} de {facturasDeEntidad.length}</span>
                    )}
                  </div>
                  <div className="pg-tabla-marco pg-tabla-facturas">
                    <table className="pg-tabla">
                      <thead>
                        <tr>
                          <th className="pg-col-check">
                            <input type="checkbox" checked={facturasVisibles.some(f => f.saldo > 0.009) && facturasVisibles.filter(f => f.saldo > 0.009).every(f => facturasSel.includes(f.id))} onChange={toggleTodas} title="Seleccionar todas las visibles con saldo" />
                          </th>
                          <th>DESCRIPCIÓN</th><th>FECHA</th><th>MONTO ORIGINAL</th><th>SALDO ABIERTO</th><th>MONEDA</th><th className="pg-col-pago-th">PAGO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {facturasVisibles.length === 0 ? (
                          <tr><td colSpan={7} className="pg-vacio">Sin facturas para "{busquedaFactura}".</td></tr>
                        ) : facturasVisibles.map((f) => {
                          const pagada = f.saldo <= 0.009; // ✅ visible pero bloqueada
                          return (
                          <tr key={f.id} className="pg-fila" onClick={() => toggleFactura(f.id)} style={pagada ? { opacity: 0.55, cursor: 'default' } : undefined}>
                            <td className="pg-col-check" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={facturasSel.includes(f.id)} disabled={pagada} onChange={() => toggleFactura(f.id)} title={pagada ? 'Factura pagada' : undefined} />
                            </td>
                            <td>
                              {/* ✅ NUEVO: revisar/editar la factura y sus operaciones */}
                              <button type="button" title="Ver / editar factura y sus operaciones"
                                onClick={(e) => { e.stopPropagation(); abrirDetalleFactura(f); }}
                                style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: '6px', color: '#58a6ff', cursor: 'pointer', padding: '3px 7px', marginRight: '8px', verticalAlign: 'middle' }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                              </button>
                              <span className="pg-numero">Factura # {f.invoice}</span>{f.fecha ? <span className="pg-desc-fecha"> ({f.fecha})</span> : null}
                            </td>
                            <td>{f.fecha}</td>
                            <td>{money(f.total)}</td>
                            <td className={pagada ? 'pg-pagada' : 'pg-monto'}>{pagada ? 'PAGADA' : money(f.saldo)}</td>
                            <td>{f.moneda || '—'}</td>
                            <td className="pg-col-pago" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                max={f.saldo}
                                className="pg-input-pago"
                                disabled={pagada || !facturasSel.includes(f.id)}
                                value={facturasSel.includes(f.id) ? (pagosPorFactura[f.id] ?? '') : ''}
                                onChange={(e) => cambiarPagoFactura(f.id, e.target.value)}
                                placeholder={facturasSel.includes(f.id) ? '0.00' : '—'}
                                title={pagada ? 'Factura pagada' : `Máximo: ${money(f.saldo)}`}
                              />
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {monedasSel.length > 1 && (
                    <div className="pg-alerta">Las facturas seleccionadas mezclan monedas ({monedasSel.join(', ')}). Un pago solo puede cubrir facturas de la misma moneda.</div>
                  )}

                  {/* ═══ Pie estilo QuickBooks: memo/adjunto ⟷ totales ═══ */}
                  <div className="pg-qb-pie">
                    <div className="pg-qb-pie-izq">
                      <div className="pg-campo">
                        <label>Memo / Observaciones</label>
                        <textarea className="pg-memo" rows={3} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Nota del pago..." />
                      </div>
                      <div className="pg-campo">
                        <label>Comprobante (PDF o imagen, opcional)</label>
                        <input type="file" accept="application/pdf,image/*" onChange={(e) => setArchivoPdf(e.target.files?.[0] || null)} />
                      </div>
                    </div>
                    <div className="pg-qb-pie-der">
                      <div className="pg-total-fila">
                        <span>Monto a aplicar</span>
                        <span className="pg-monto">{money(totalAplicado, monedasSel[0])}</span>
                      </div>
                      <div className={`pg-total-fila${diferencia > 0.009 ? ' pg-total-favor' : ''}`}>
                        <span>Monto a favor</span>
                        <span>{money(Math.max(0, diferencia), monedasSel[0])}</span>
                      </div>
                      {diferencia < -0.009 && (
                        <div className="pg-total-fila pg-total-contra">
                          <span>EN CONTRA (aplicaste más de lo recibido)</span>
                          <span>-{money(-diferencia, monedasSel[0])}</span>
                        </div>
                      )}
                      <button type="button" className="pg-btn-limpiar" onClick={limpiarPago}>Limpiar pago</button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="pg-modal-pie">
              <button className="pg-btn-secundario" onClick={() => setModalAbierto(false)} disabled={guardando}>Cancelar</button>
              {entidadSel && (
                <button className="pg-btn-primario" onClick={guardarPago} disabled={guardando || seleccionadasOrdenadas.length === 0}>
                  {guardando ? 'Guardando…' : 'Guardar Pago'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PagosDashboard;
