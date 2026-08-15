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
import { useState, useEffect, useMemo } from 'react';
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
import { Plus, FileText, Trash2, X, Search, Download, Pencil } from 'lucide-react';
import { SelectBuscable } from '../../catalogos/components/SelectBuscable';
import './PagosDashboard.css';

type TipoPago = 'cliente' | 'proveedor';

const METODOS_PAGO = ['Transferencia', 'ACH', 'Efectivo', 'Cheque', 'Depósito', 'Tarjeta', 'Otro'];

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

const money = (n: number, moneda = '') =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${moneda ? ` ${moneda}` : ''}`;

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

  const abrirEdicionPago = (p: PagoDoc) => {
    setPagoEditando(p);
    setEditFecha(p.fecha || '');
    setEditNumero(p.numeroPago || '');
    setEditReferencia(p.referencia || '');
    setEditMetodo(p.metodoPago || 'Transferencia');
    setEditObs(p.observaciones || '');
    setEditArchivoPdf(null);
  };

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
      const cambios = {
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
      batch.set(doc(db, 'pagos', pagoEditando.id), cambios, { merge: true });
      await batch.commit();
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

  const pagosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return pagos;
    const b = busqueda.toLowerCase();
    return pagos.filter((p) =>
      p.entidadNombre?.toLowerCase().includes(b) ||
      p.numeroPago?.toLowerCase().includes(b) ||
      p.referencia?.toLowerCase().includes(b) ||
      p.metodoPago?.toLowerCase().includes(b) ||
      p.facturas?.some((f) => f.invoice?.toLowerCase().includes(b))
    );
  }, [pagos, busqueda]);

  // ── Reportes (Excel / PDF) ──
  const [menuReportes, setMenuReportes] = useState(false);
  const [generandoReporte, setGenerandoReporte] = useState(false);

  const etiquetaTab = tab === 'cliente' ? 'Clientes' : 'Proveedores';
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

  const cargarFacturasPendientes = async (tipo: TipoPago): Promise<FacturaPagable[]> => {
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
      .map(({ id, raw }) => {
        const total = Number(raw.subtotalFactura) || Number(raw.total) || Number(raw.montoFactura) || 0;
        const pagado = Number(raw.montoPagado) || 0;
        // ✅ FIX moneda: proveedores guarda `monedaProveedor` (no
        //   `monedaFacturacion`); además se deriva de monedaId como respaldo.
        const monedaPorId = raw.monedaId === ID_USD ? 'USD' : raw.monedaId === ID_MXN ? 'MXN' : '';
        return {
          id,
          invoice: String(raw.invoice || raw.folio || id),
          fecha: String(raw.fecha || raw.fechaFactura || ''),
          entidadId: String((tipo === 'cliente' ? raw.clienteId : raw.proveedorId) || ''),
          entidadNombre: String((tipo === 'cliente' ? (raw.clienteNombre || raw.cliente) : (raw.proveedorNombre || raw.proveedor)) || 'Sin nombre'),
          total,
          montoPagado: pagado,
          saldo: Math.max(0, total - pagado),
          moneda: String(raw.monedaFacturacion || raw.monedaProveedor || raw.moneda || monedaPorId || ''),
        };
      })
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
      const prev = mapa.get(f.entidadNombre) || { nombre: f.entidadNombre, cuantas: 0, conSaldo: 0, saldo: 0 };
      prev.cuantas += 1;
      if (f.saldo > 0.009) prev.conSaldo += 1;
      prev.saldo += f.saldo;
      mapa.set(f.entidadNombre, prev);
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
      .filter((f) => f.entidadNombre === entidadSel)
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
          <button className="pg-btn-nuevo" onClick={abrirModal}>
            <Plus size={16} /> Registrar Pago
          </button>
        </div>
      </div>

      <div className="pg-tabs">
        <button className={`pg-tab${tab === 'cliente' ? ' activa' : ''}`} onClick={() => setTab('cliente')}>Pagos de Clientes</button>
        <button className={`pg-tab${tab === 'proveedor' ? ' activa' : ''}`} onClick={() => setTab('proveedor')}>Pagos a Proveedores</button>
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
              <th>FECHA</th>
              <th># PAGO</th>
              <th>{tab === 'cliente' ? 'CLIENTE' : 'PROVEEDOR'}</th>
              <th>MÉTODO</th>
              <th>MONTO</th>
              <th>FACTURAS</th>
              <th>COMPROBANTE</th>
            </tr>
          </thead>
          <tbody>
            {pagosFiltrados.length === 0 ? (
              <tr><td colSpan={8} className="pg-vacio">{busqueda ? 'Sin resultados.' : 'Aún no hay pagos registrados.'}</td></tr>
            ) : pagosFiltrados.map((p) => (
              <tr key={p.id} className="pg-fila" onClick={() => setPagoViendo(p)} title="Ver detalle del pago">
                <td onClick={(e) => e.stopPropagation()}>
                  {/* ✅ NUEVO: editar pago (fecha, número, referencia, método, obs., comprobante) */}
                  <button className="pg-btn-borrar" style={{ color: '#58a6ff', borderColor: 'rgba(88,166,255,0.4)', marginRight: '6px' }}
                    onClick={() => abrirEdicionPago(p)} title="Editar pago">
                    <Pencil size={14} />
                  </button>
                  <button className="pg-btn-borrar" onClick={() => eliminarPago(p)} title="Eliminar pago (revierte su aplicación)">
                    <Trash2 size={14} />
                  </button>
                </td>
                <td className="pg-fecha">{p.fecha}</td>
                <td className="pg-numero">{p.numeroPago}</td>
                <td className="pg-entidad">{p.entidadNombre}</td>
                <td>{p.metodoPago}</td>
                <td className="pg-monto">{money(p.monto, p.moneda)}</td>
                <td>
                  <div className="pg-chips">
                    {(p.facturas || []).filter(f => f.aplicado > 0).map((f) => (
                      <span className="pg-chip" key={f.facturaId} title={`Aplicado ${money(f.aplicado)} · Saldo ${money(f.saldoNuevo)}`}>
                        {f.invoice}{f.saldoNuevo > 0.009 ? ' (parcial)' : ''}
                      </span>
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
                      <td className="pg-numero">{f.invoice}</td>
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

      {/* ══════════ ✅ NUEVO — MODAL EDITAR PAGO ══════════ */}
      {pagoEditando && (
        <div className="pg-overlay" onClick={() => !guardandoEdicion && setPagoEditando(null)}>
          <div className="pg-modal" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
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
              <h3>Registrar Pago · {tab === 'cliente' ? 'Cliente' : 'Proveedor'}</h3>
              <button className="pg-cerrar" onClick={() => setModalAbierto(false)}><X size={16} /></button>
            </div>

            <div className="pg-modal-cuerpo">
              {cargandoFacturas ? (
                <p className="pg-vacio">Cargando facturas…</p>
              ) : !entidadSel ? (
                <>
                  {/* PASO 1: elegir cliente/proveedor con facturas pendientes */}
                  <label className="pg-etq">1. Elige {tab === 'cliente' ? 'el cliente' : 'el proveedor'} (se muestran TODAS sus facturas; las pagadas aparecen bloqueadas)</label>
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
                          <button onClick={() => { setEntidadSel(e.nombre); setFacturasSel([]); }}>
                            <span className="pg-entidad">{e.nombre}</span>
                            <span className="pg-entidad-info">{e.cuantas} factura(s) · {e.conSaldo} con saldo · {money(e.saldo)}</span>
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
                      <span className="pg-etq">{tab === 'cliente' ? 'Cliente' : 'Proveedor'}</span>
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
                            <td><span className="pg-numero">Factura # {f.invoice}</span> <span className="pg-desc-fecha">({f.fecha})</span></td>
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
