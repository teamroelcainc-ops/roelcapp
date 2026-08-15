// src/features/gastos/components/mtto/MttoDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { hoyLocalISO } from '../../../../utils/fechaHoraLocal';
import { FormularioMtto } from './FormularioMtto';
import { collection, query, getDocs, limit, orderBy, where, doc, deleteDoc, writeBatch } from 'firebase/firestore'; 
import { db } from '../../../../config/firebase'; 
import MttoAgrupadosInvoice from './MttoAgrupadosInvoice';
import * as XLSX from 'xlsx';
// ✅ Logo de los PDF (mismas exportaciones que ya usa el historial de Invoice).
import { getLogoPdf, LOGO_DEFAULT } from '../../../../utils/pdfGenerator';
import './MttoDashboard.css';
import { almacenSesion } from '../../../../utils/cacheMemoria';

type VistaMaestra = 'tabla' | 'agrupado' | 'refacciones';

// ✅ NUEVO — helpers de refacciones/garantías.
const diasEntreISO = (a: string, b: string): number | null => {
  const pa = String(a || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const pb = String(b || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!pa || !pb) return null;
  const da = Date.UTC(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3]));
  const db_ = Date.UTC(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3]));
  return Math.round((db_ - da) / 86400000);
};

// ✅ TODAS LAS COLUMNAS DE LA COLECCIÓN MTTO CON NOMBRES LEGIBLES
const COLUMNAS_BASE = [
  { id: 'numeroGasto', label: '# Gasto', visible: true },
  { id: 'invoice', label: 'Invoice', visible: true },
  { id: 'estatus', label: 'Estatus', visible: true },
  { id: 'fecha', label: 'Fecha', visible: true },
  { id: 'unidad', label: 'Unidad', visible: true },
  { id: 'operador', label: 'Operador', visible: true },
  { id: 'descripcion', label: 'Descripción', visible: true },
  { id: 'proveedor', label: 'Proveedor', visible: true },
  { id: 'tipoServicio', label: 'Tipo de Servicio', visible: true },
  { id: 'autorizadoPor', label: 'Autorizado por', visible: true },
  { id: 'condicionPago', label: 'Crédito/Contado', visible: true },
  { id: 'plazo', label: 'Plazo (Dias)', visible: false },
  { id: 'moneda', label: 'Moneda', visible: true },
  { id: 'importe', label: 'Importe', visible: true },
  { id: 'iva', label: 'IVA', visible: true },
  { id: 'retIva', label: 'Ret IVA', visible: true },
  { id: 'retIsr', label: 'Ret ISR', visible: true },
  { id: 'total', label: 'Total', visible: true },
  { id: 'facturaTexto', label: 'Factura', visible: true },
  { id: 'fechaFactura', label: 'Fecha Factura', visible: true },
  { id: 'descripcionFactura', label: 'Descripción (Factura)', visible: true },
  { id: 'fechaPago', label: 'Fecha de Pago', visible: true },
  { id: 'formaPago', label: 'Forma de pago', visible: true },
  { id: 'observaciones', label: 'Observaciones', visible: true },
  { id: 'operacionAsignada', label: 'Asignar Operación', visible: true }
];

// ✅ Consecutivo (última parte numérica del folio)
const consecutivoDe = (m: any): number => {
  const parte = String(m?.numeroGasto || '').split('-').pop() || '';
  const n = parseInt(parte.replace(/\D/g, ''), 10);
  return isNaN(n) ? 0 : n;
};

// ✅ Partes de una fecha ISO "YYYY-MM-DD" sin corrimiento de zona horaria
const partesFechaISO = (v: any): { yyyy: string; mm: string; dd: string } | null => {
  const s = String(v || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { yyyy: m[1], mm: m[2], dd: m[3] };
};

// ✅ Folio normalizado al formato MTTO-DDMMYY-NNN (p. ej. MTTO-290626-001).
//    La fecha sale del campo `fecha` (respaldo `createdAt`); el consecutivo, del folio.
const formatearFolio = (m: any): string => {
  const consStr = String(consecutivoDe(m)).padStart(3, '0');
  const p = partesFechaISO(m?.fecha) || partesFechaISO(m?.createdAt);
  if (p) {
    const ddmmyy = `${p.dd}${p.mm}${p.yyyy.slice(2)}`;
    return `MTTO-${ddmmyy}-${consStr}`;
  }
  // Sin fecha ISO confiable: conserva el bloque de fecha del folio original,
  // pero homologa el prefijo a MTTO y el consecutivo a 3 dígitos.
  const original = String(m?.numeroGasto || '').trim();
  if (!original) return '-';
  const partes = original.split('-');
  if (partes.length >= 3) return `MTTO-${partes[1]}-${consStr}`;
  return original;
};

const MttoDashboard = () => {
  const [vistaActiva, setVistaActiva] = useState<VistaMaestra>('tabla');
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [mttoEditando, setMttoEditando] = useState<any | null>(null);
  const [mttoGlobales, setMttoGlobales] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [catalogosCacheados, setCatalogosCacheados] = useState<any>({});
  const [busqueda, setBusqueda] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + la tabla arranca VACÍA hasta Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  // ✅ Filtro por rango de fechas (sobre el campo `fecha` del gasto)
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [mttoViendo, setMttoViendo] = useState<any | null>(null);
  const [pestañaDetalleActiva, setPestañaDetalleActiva] = useState<string>('general');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;
  // ✅ Pestaña por estatus: separa No facturados / Facturados
  const [estatusVista, setEstatusVista] = useState<'no_facturado' | 'facturado'>('no_facturado');

  // Estados visuales y de acciones masivas
  const [gastosSeleccionados, setGastosSeleccionados] = useState<string[]>([]);
  const [modalInvoiceMasivo, setModalInvoiceMasivo] = useState(false);
  const [nuevoInvoiceTexto, setNuevoInvoiceTexto] = useState('');
  const [cargandoMasivo, setCargandoMasivo] = useState(false);

  // Estados para configuración de columnas
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  const cargarDatos = async () => {
    setCargando(true);
    try {
      let catGuardados = null;
      const cacheCatStr = almacenSesion.getItem('roelca_catalogos_v1');

      if (cacheCatStr) {
        catGuardados = JSON.parse(cacheCatStr);
        setCatalogosCacheados(catGuardados);
      } else {
        const [empSnap, unidSnap, servSnap, monSnap, fpSnap, opSnap, empColSnap] = await Promise.all([
          getDocs(collection(db, 'empresas')),
          getDocs(collection(db, 'unidades')),
          getDocs(collection(db, 'catalogo_tipo_servicio')),
          getDocs(collection(db, 'catalogo_moneda')),
          getDocs(collection(db, 'catalogo_formas_pago')),
          getDocs(query(collection(db, 'operaciones'), limit(200))),
          getDocs(collection(db, 'empleados')) 
        ]);

        catGuardados = {
          empresas: empSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          unidades: unidSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          servicios: servSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          monedas: monSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          formasPago: fpSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          operaciones: opSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          empleados: empColSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
        };
        
        almacenSesion.setItem('roelca_catalogos_v1', JSON.stringify(catGuardados));
        setCatalogosCacheados(catGuardados);
      }

      // ✅ orderBy('createdAt','desc') garantiza que los 300 registros devueltos
      //    sean los MÁS RECIENTES. Antes, limit(300) sin orden traía los primeros
      //    300 por ID de documento (aleatorio), y los gastos nuevos podían quedar
      //    fuera de la ventana: se guardaban en Firestore pero no aparecían aquí.
      const q = query(collection(db, 'gastos_mtto'), orderBy('createdAt', 'desc'), limit(1000));
      const snap = await getDocs(q);
      
      let mttoData = snap.docs.map((d: any) => {
        const data = d.data();
        const tieneInvoice = data.invoice && String(data.invoice).trim() !== '';
        data.estatus = tieneInvoice ? 'Facturado' : 'No facturado';
        
        return { id: d.id, ...data };
      });

      // ✅ ORDEN: 1) Fecha (campo `fecha`) de la más reciente a la más antigua.
      //           2) Empate de fecha: hora de captura (createdAt) más reciente primero.
      //           3) Último desempate: consecutivo del folio más alto primero.
      const tiempoFecha = (m: any) => {
        const p = partesFechaISO(m?.fecha);
        if (p) return parseInt(`${p.yyyy}${p.mm}${p.dd}`, 10);
        // Sin fecha ISO confiable: intenta parseo genérico y, si no, cae a createdAt
        if (m?.fecha) { const t = new Date(m.fecha).getTime(); if (!isNaN(t)) return t; }
        const pc = partesFechaISO(m?.createdAt);
        if (pc) return parseInt(`${pc.yyyy}${pc.mm}${pc.dd}`, 10);
        return 0;
      };
      const tiempoCaptura = (m: any) => {
        if (m?.createdAt) { const t = new Date(m.createdAt).getTime(); if (!isNaN(t)) return t; }
        return 0;
      };
      mttoData.sort((a, b) => {
        const tA = tiempoFecha(a);
        const tB = tiempoFecha(b);
        if (tA !== tB) return tB - tA;
        const cA = tiempoCaptura(a);
        const cB = tiempoCaptura(b);
        if (cA !== cB) return cB - cA;
        return consecutivoDe(b) - consecutivoDe(a);
      });

      setMttoGlobales(mttoData);

    } catch (e) {
      console.error("Error al cargar datos MTTO:", e);
    }
    setCargando(false);
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  useEffect(() => {
    setPaginaActual(1);
    setGastosSeleccionados([]); 
  }, [busqueda, estatusVista, fechaDesde, fechaHasta]);

  const handleNuevo = () => { setMttoEditando(null); setEstadoFormulario('abierto'); };
  const editarMtto = (mtto: any) => { setMttoEditando(mtto); setEstadoFormulario('abierto'); };
  
  const eliminarMtto = async (id: string) => {
    if (!id) return;
    if (window.confirm('¿Estás seguro de eliminar este registro permanentemente?')) {
      
      const respaldoGlobales = [...mttoGlobales];
      setMttoGlobales(prev => prev.filter(m => m.id !== id));
      setGastosSeleccionados(prev => prev.filter(selId => String(selId) !== String(id)));
      if (mttoViendo?.id === id) setMttoViendo(null);
      
      try {
        const docRef = doc(db, 'gastos_mtto', id);
        await deleteDoc(docRef);
      } catch (error) {
        console.error("Error al eliminar en Firebase:", error);
        alert("Hubo un error al eliminar en el servidor. El registro regresará a la lista.");
        setMttoGlobales(respaldoGlobales);
      }
    }
  };

  const mostrarNombreUnidad = (unidadValor: string) => {
    if (!unidadValor) return '-';
    if (unidadValor === 'Oficina') return 'Oficina';
    if (catalogosCacheados.unidades) {
        const uni = catalogosCacheados.unidades.find((u:any) => u.id === unidadValor);
        if (uni) return uni.unidad || uni.numeroEconomico || uni.nombre;
    }
    return unidadValor;
  };

  // ✅ NUEVO: genera para UN registro el MISMO documento "Relación de Compras"
  //    que produce la pestaña "Agrupados por Invoice" (mismo HTML, mismos
  //    estilos, mismo logo), con los datos de ese gasto individual.
  const generarDocumentoGasto = (m: any) => {
    const formatoMonedaDoc = (monto: number | string) => {
      const num = Number(monto) || 0;
      return `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };
    const formatearFechaEspanolDoc = (fechaStr: string | Date) => {
      const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      const d = new Date(fechaStr);
      if (isNaN(d.getTime())) return String(fechaStr || '-');
      const dUTC = new Date(d.getTime() + d.getTimezoneOffset() * 60000);
      return `${dUTC.getDate()} de ${meses[dUTC.getMonth()]} de ${dUTC.getFullYear()}`;
    };
    const escaparHTMLDoc = (texto: any) => String(texto ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const multilineaDoc = (texto: any) => escaparHTMLDoc(texto).replace(/\r\n|\r|\n/g, '<br>');

    const folio = formatearFolio(m);
    const invoiceTxt = m.invoice && String(m.invoice).trim() !== '' ? String(m.invoice).trim() : '';
    const denominacion = invoiceTxt || folio;
    const proveedorTxt = m.proveedorNombre || mostrarDatoMapeado(m.proveedorId, 'empresas');
    const razonSocial = (proveedorTxt && proveedorTxt !== '-') ? String(proveedorTxt) : 'VARIOS';
    const proveedorNum = m.proveedorId || 'N/A';
    const rfc = m.estatus || 'No facturado';
    const fechaActual = formatearFechaEspanolDoc(new Date());
    const logoBase64 = getLogoPdf() || LOGO_DEFAULT;

    const filasHTML = `
        <tr>
          <td class="text-center">${escaparHTMLDoc(folio)}</td>
          <td class="text-center" style="text-transform: capitalize;">${formatearFechaEspanolDoc(String(m.fecha || m.createdAt || ''))}</td>
          <td class="text-center">${escaparHTMLDoc(mostrarNombreUnidad(m.unidadId || m.unidad))}</td>
          <td class="col-desc">${multilineaDoc(m.descripcion || m.descripcionGeneral || '')}</td>
          <td class="text-right">${formatoMonedaDoc(m.total)}</td>
        </tr>
      `;

    const htmlDocument = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Relación de Compras - ${escaparHTMLDoc(denominacion)}</title>
        <style>
          @media print {
            @page { size: letter; margin: 10mm; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: Arial, sans-serif; font-size: 11px; color: #000; background-color: #fff; padding: 20px; }
          .container { max-width: 950px; margin: 0 auto; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
          .logo-section { width: 25%; text-align: center; display: flex; flex-direction: column; align-items: center; }
          .logo-img { max-width: 110px; margin-bottom: 2px; }
          .logo-transporte { color: #00AEEF; font-weight: bold; font-size: 10px; text-transform: uppercase; }
          .logo-url { color: #F15A24; font-weight: bold; font-size: 10px; }
          .title-section { width: 50%; text-align: center; padding-top: 15px; }
          .title-main { color: #00AEEF; font-size: 22px; font-weight: bold; margin-bottom: 5px; }
          .title-sub { color: #F15A24; font-size: 18px; font-weight: bold; }
          .date-section { width: 25%; display: flex; justify-content: flex-end; }
          .date-table { width: 150px; border-collapse: collapse; border: 1px solid #000; }
          .date-table th { background-color: #E6E6E6 !important; border-bottom: 1px solid #000; padding: 6px; text-align: center; font-weight: bold; font-size: 12px; }
          .date-table td { padding: 6px; text-align: center; font-size: 12px; text-transform: capitalize; }
          .info-wrapper { border: 1px solid #000; padding: 8px 10px; margin-bottom: 20px; }
          .info-table { width: 100%; border-collapse: collapse; font-size: 11px; }
          .info-table td { padding: 4px 5px; vertical-align: middle; border: none; }
          .col-label { font-weight: bold; white-space: nowrap; width: 1%; }
          .col-value { width: 32%; text-transform: uppercase; }
          .report-table { width: 100%; border-collapse: collapse; border: 1px solid #000; font-size: 11px; table-layout: fixed; }
          .report-table th, .report-table td { border: 1px solid #000; }
          .report-table th { background-color: #E6E6E6 !important; padding: 8px 5px; text-align: center; font-weight: bold; font-size: 12px; }
          .report-table td { padding: 6px 8px; vertical-align: top; }
          .col-ref { width: 14%; } .col-fecha { width: 15%; } .col-tractor { width: 12%; } .col-servicio { width: 41%; } .col-subtotal { width: 18%; }
          .col-desc { white-space: pre-line; word-break: break-word; overflow-wrap: anywhere; }
          .text-center { text-align: center; } .text-left { text-align: left; } .text-right { text-align: right; }
          .amount-box { display: flex; justify-content: space-between; width: 100%; font-weight: bold; }
          .spacer-row td { height: 60px; border-bottom: none !important; }
          .no-internal-borders { border-right: 1px solid #000; border-left: 1px solid #000; }
          .first-empty { border-top: 1px solid #000; border-bottom: 1px solid transparent; }
          .middle-empty { border-top: 1px solid transparent; border-bottom: 1px solid transparent; }
          .last-empty { border-top: 1px solid transparent; border-bottom: 1px solid #000; }
        </style>
      </head>
      <body>
      <div class="container">
        <div class="header">
          <div class="logo-section">
            ${logoBase64 ? `<img alt="Roelca Logo" class="logo-img" src="${logoBase64}" />` : `<div style="height:40px; font-weight:bold; color:#00AEEF;">[LOGO ROELCA]</div>`}
            <span class="logo-transporte">TRANSPORTE</span> 
            <span class="logo-url">www.roelca.com</span>
          </div>

          <div class="title-section">
            <div class="title-main">ROELCAINC SA DE CV</div>
            <div class="title-sub">RELACIÓN DE COMPRAS</div>
          </div>

          <div class="date-section">
            <table class="date-table">
              <tbody>
                <tr><th>FECHA</th></tr>
                <tr><td>${fechaActual}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="info-wrapper">
          <table class="info-table">
            <tbody>
              <tr>
                <td class="col-label"># PROVEEDOR</td><td class="col-value">${escaparHTMLDoc(proveedorNum)}</td>
                <td class="col-label">RAZON SOCIAL:</td><td class="col-value">${escaparHTMLDoc(razonSocial)}</td>
                <td class="col-label">DENOMINACION:</td><td class="col-value">${escaparHTMLDoc(denominacion)}</td>
              </tr>
              <tr>
                <td class="col-label">TIPO:</td><td class="col-value">${escaparHTMLDoc(rfc)}</td>
                <td class="col-label">CONTACTO:</td><td class="col-value"> </td>
                <td class="col-label"> </td><td class="col-value"> </td>
              </tr>
              <tr>
                <td class="col-label">TELEFONO:</td><td class="col-value"> </td>
                <td class="col-label">MAIL:</td><td class="col-value"> </td>
                <td class="col-label"> </td><td class="col-value"> </td>
              </tr>
              <tr>
                <td class="col-label">BANCO:</td><td class="col-value"> </td>
                <td class="col-label">CUENTA:</td><td class="col-value"> </td>
                <td class="col-label">CLABE:</td><td class="col-value"> </td>
              </tr>
            </tbody>
          </table>
        </div>

        <table class="report-table">
          <thead>
            <tr>
              <th class="col-ref">REF#</th>
              <th class="col-fecha">FECHA</th>
              <th class="col-tractor">UNIDAD</th>
              <th class="col-servicio">SERVICIO / DESCRIPCIÓN</th>
              <th class="col-subtotal">SUBTOTAL</th>
            </tr>
          </thead>
          <tbody>
            ${filasHTML}
            <tr class="spacer-row"><td colspan="5"></td></tr>
            <tr>
              <td class="no-internal-borders first-empty" colspan="4"> </td>
              <td><div class="amount-box"><span>$</span> <span>${(parseFloat(m.importe) || 0).toFixed(2)}</span></div></td>
            </tr>
            <tr>
              <td class="no-internal-borders middle-empty" colspan="4"> </td>
              <td><div class="amount-box"><span>$</span> <span>${(parseFloat(m.ivaMonto) || 0).toFixed(2)}</span></div></td>
            </tr>
            <tr>
              <td class="no-internal-borders last-empty" colspan="4"> </td>
              <td><div class="amount-box"><span>$</span> <span>${(parseFloat(m.total) || 0).toFixed(2)}</span></div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 500);
        }
      </script>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(htmlDocument);
      printWindow.document.close();
    } else {
      alert('Por favor, permite las ventanas emergentes (pop-ups) en tu navegador para generar el PDF.');
    }
  };

  const mostrarDatoMapeado = (id: any, catalogo: string, campoRetorno: string = 'nombre') => {
    if (!id) return '-';
    if (!catalogosCacheados[catalogo] || !Array.isArray(catalogosCacheados[catalogo])) return String(id);
    
    if (Array.isArray(id)) {
        return id.map(itemId => {
            const elemento = catalogosCacheados[catalogo].find((item: any) => item.id === itemId);
            return elemento ? (elemento[campoRetorno] || elemento.nombre || elemento.descripcion || itemId) : itemId;
        }).join(', ');
    }

    const elemento = catalogosCacheados[catalogo].find((item: any) => item.id === id);
    if (!elemento) return id;
    return elemento[campoRetorno] || elemento.nombre || elemento.descripcion || elemento.ref || id;
  };

  const formatoMoneda = (monto: any) => {
    if (monto === undefined || monto === null || monto === '') return '-';
    return `$ ${parseFloat(monto).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  
  const handleGuardado = () => {
    cargarDatos(); 
    setEstadoFormulario('cerrado');
    setMttoEditando(null);
  };

  const toggleSeleccion = (id: string) => {
    setGastosSeleccionados(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const aplicarInvoiceMasivo = async () => {
    if (!nuevoInvoiceTexto.trim()) return alert("Debes escribir un número o texto para el Invoice.");

    const idsValidos = gastosSeleccionados.filter(id => {
      const gasto = mttoGlobales.find(m => m.id === id);
      return gasto && !(gasto.estatus === 'Facturado' || (gasto.invoice && gasto.invoice.trim() !== ''));
    });

    if (idsValidos.length === 0) {
      alert("Ninguno de los gastos seleccionados es elegible para facturar.");
      setModalInvoiceMasivo(false);
      return;
    }

    setCargandoMasivo(true);
    try {
      const batch = writeBatch(db);
      idsValidos.forEach(id => {
        const docRef = doc(db, 'gastos_mtto', id);
        batch.update(docRef, { 
          invoice: nuevoInvoiceTexto.trim(),
          estatus: 'Facturado' 
        });
      });
      await batch.commit();
      await cargarDatos(); 
      alert(`Se aplicó el Invoice exitosamente.`);
      setModalInvoiceMasivo(false);
      setGastosSeleccionados([]); 
      setNuevoInvoiceTexto('');
    } catch (error) {
      alert("Hubo un error al aplicar el Invoice masivo.");
    } finally {
      setCargandoMasivo(false);
    }
  };

  // ✅ Texto buscable: concatena TODOS los campos del documento (incluye arrays y
  //    objetos anidados) más los valores legibles derivados (folio formateado y
  //    nombres resueltos vía catálogos: unidad, proveedor, servicios, moneda,
  //    forma de pago y operación asignada).
  const textoBuscableDe = (m: any): string => {
    const partes: string[] = [];
    const agregar = (v: any) => {
      if (v === undefined || v === null) return;
      if (Array.isArray(v)) { v.forEach(agregar); return; }
      if (typeof v === 'object') { Object.values(v).forEach(agregar); return; }
      partes.push(String(v));
    };
    Object.values(m).forEach(agregar);
    partes.push(formatearFolio(m));
    partes.push(String(mostrarNombreUnidad(m.unidadId || m.unidad)));
    partes.push(String(mostrarDatoMapeado(m.proveedorId, 'empresas')));
    partes.push(String(mostrarDatoMapeado(m.tipoServicioId, 'servicios')));
    partes.push(String(mostrarDatoMapeado(m.monedaId, 'monedas', 'moneda')));
    partes.push(String(mostrarDatoMapeado(m.formaPagoId, 'formasPago', 'forma_pago')));
    partes.push(String(mostrarDatoMapeado(m.operacionAsignadaId, 'operaciones', 'ref')));
    return partes.join(' ').toLowerCase();
  };

  // ✅ FIX GASTO INVISIBLE: normaliza la fecha a ISO aceptando varios formatos
  //   (ISO, dd/mm/aaaa, Timestamp). Si la fecha es ILEGIBLE, devuelve '' y el
  //   filtro de rango NO excluye el registro (antes una fecha mal guardada se
  //   comparaba como texto y el gasto desaparecía de la vista sin aviso).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doc sin tipo canónico (criterio del archivo).
  const fechaISOFiltro = (m: any): string => {
    const candidatos = [m?.fecha, m?.createdAt];
    for (const c of candidatos) {
      if (!c) continue;
      if (typeof c === 'object' && typeof c.toDate === 'function') {
        try { return c.toDate().toISOString().slice(0, 10); } catch { /* sigue */ }
      }
      const s = String(c).trim();
      const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
      const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
      if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }
    return '';
  };

  // ✅ RESCATE POR FOLIO: si la búsqueda es un folio exacto (MTTO-DDMMYY-NNN)
  //   y no está entre los cargados, se trae DIRECTO de Firestore y se agrega.
  //   Garantía: ningún gasto puede volver a "no verse en ningún lado".
  useEffect(() => {
    const b = busqueda.trim().toUpperCase();
    if (!/^MTTO-\d{6}-\d{1,4}$/.test(b)) return;
    const normal = `MTTO-${b.split('-')[1]}-${String(parseInt(b.split('-')[2], 10)).padStart(3, '0')}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doc sin tipo canónico.
    const yaEsta = mttoGlobales.some((m: any) => String(m.numeroGasto || '').toUpperCase() === b || String(m.numeroGasto || '').toUpperCase() === normal);
    if (yaEsta) return;
    let activo = true;
    (async () => {
      try {
        const variantes = Array.from(new Set([b, normal]));
        const snap = await getDocs(query(collection(db, 'gastos_mtto'), where('numeroGasto', 'in', variantes)));
        if (!activo || snap.empty) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doc sin tipo canónico.
        const nuevos = snap.docs.map((d: any) => {
          const data = d.data();
          const tieneInvoice = data.invoice && String(data.invoice).trim() !== '';
          data.estatus = tieneInvoice ? 'Facturado' : 'No facturado';
          return { id: d.id, ...data };
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doc sin tipo canónico.
        setMttoGlobales((prev: any[]) => {
          const ids = new Set(prev.map((x) => x.id));
          return [...nuevos.filter((n) => !ids.has(n.id)), ...prev];
        });
      } catch (e) {
        console.error('No se pudo rescatar el folio buscado:', e);
      }
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, mttoGlobales]);

  const registrosFiltrados = useMemo(() => {
    const b = busqueda.trim().toLowerCase();
    return mttoGlobales.filter(m => {
      // 1) Filtro por rango de fechas (fecha normalizada; ilegible = NO se oculta)
      const fechaISO = fechaISOFiltro(m);
      if (fechaISO) {
        if (fechaDesde && fechaISO < fechaDesde) return false;
        if (fechaHasta && fechaISO > fechaHasta) return false;
      }
      // 2) Búsqueda en cada campo de la colección
      if (!b) return true;
      return textoBuscableDe(m).includes(b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, fechaDesde, fechaHasta, mttoGlobales, catalogosCacheados]);

  // ✅ CÁLCULO DEL SUMARIO DE GASTOS EN TIEMPO REAL
  const resumenSeleccion = useMemo(() => {
    let totalImporte = 0;
    let totalIva = 0;
    let granTotal = 0;
    const numerosGasto: string[] = [];

    gastosSeleccionados.forEach(id => {
      const gasto = mttoGlobales.find(m => m.id === id);
      if (gasto) {
        totalImporte += parseFloat(gasto.importe || 0);
        totalIva += parseFloat(gasto.ivaMonto || 0);
        granTotal += parseFloat(gasto.total || 0);
        numerosGasto.push(formatearFolio(gasto));
      }
    });

    return { totalImporte, totalIva, granTotal, cantidad: gastosSeleccionados.length, numerosGasto };
  }, [gastosSeleccionados, mttoGlobales]);

  // ✅ Separación por estatus (respeta la búsqueda activa)
  const esFacturado = (m: any) => m.estatus === 'Facturado' || (m.invoice && String(m.invoice).trim() !== '');
  const registrosFacturados = useMemo(() => registrosFiltrados.filter(esFacturado), [registrosFiltrados]);
  const registrosNoFacturados = useMemo(() => registrosFiltrados.filter(m => !esFacturado(m)), [registrosFiltrados]);
  const sumaTotal = (lista: any[]) => lista.reduce((s, m) => s + (parseFloat(m.total) || 0), 0);
  const totalFacturado = useMemo(() => sumaTotal(registrosFacturados), [registrosFacturados]);
  const totalNoFacturado = useMemo(() => sumaTotal(registrosNoFacturados), [registrosNoFacturados]);

  // Registros de la pestaña activa
  const registrosVista = estatusVista === 'facturado' ? registrosFacturados : registrosNoFacturados;

  const totalPaginas = Math.ceil(registrosVista.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const registrosEnPantalla = registrosVista.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  // ✅ LÓGICA DE DRAG & DROP PARA COLUMNAS
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedColIndex(index);
  };

  const handleDragEnter = (index: number) => {
    if (draggedColIndex === null || draggedColIndex === index) return;
    const nuevasColumnas = [...columnasTabla];
    const colMovida = nuevasColumnas.splice(draggedColIndex, 1)[0];
    nuevasColumnas.splice(index, 0, colMovida);
    setDraggedColIndex(index);
    setColumnasTabla(nuevasColumnas);
  };

  const toggleColumnaVisible = (index: number) => {
    const nuevas = [...columnasTabla];
    nuevas[index].visible = !nuevas[index].visible;
    setColumnasTabla(nuevas);
  };

  // ✅ RENDERIZADOR DINÁMICO DE CELDAS MTTO
  const renderCellContent = (m: any, colId: string) => {
    switch (colId) {
      case 'numeroGasto': return <span className="md-x1">{formatearFolio(m)}</span>;
      case 'invoice': return <span className="md-x2">{m.invoice || '-'}</span>;
      case 'estatus': return <span style={{ color: m.estatus === 'Facturado' ? '#3fb950' : '#f85149', fontWeight: 'bold' }}>{m.estatus || '-'}</span>;
      case 'fecha': return <span className="md-x2">{m.fecha || '-'}</span>;
      case 'unidad': return <span className="md-x2">{mostrarNombreUnidad(m.unidadId || m.unidad)}</span>;
      case 'operador': return <span className="md-x2">{m.operadorNombre || m.operador || '-'}</span>;
      case 'descripcion': return <span className="md-x3">{m.descripcion || m.descripcionGeneral || '-'}</span>;
      case 'proveedor': return <span className="md-x2">{m.proveedorNombre || mostrarDatoMapeado(m.proveedorId, 'empresas')}</span>;
      case 'tipoServicio': return <span className="md-x2">{mostrarDatoMapeado(m.tipoServicioId, 'servicios')}</span>;
      case 'autorizadoPor': return <span className="md-x2">{m.autorizadoPor || '-'}</span>;
      case 'condicionPago': return <span className="md-x2">{m.condicionPago || '-'}</span>;
      case 'plazo': return <span className="md-x2">{m.plazo || '-'}</span>;
      case 'moneda': return <span className="md-x2">{mostrarDatoMapeado(m.monedaId, 'monedas', 'moneda')}</span>;
      case 'importe': return <span className="md-x2">{formatoMoneda(m.importe)}</span>;
      case 'iva': return <span className="md-x2">{formatoMoneda(m.ivaMonto)} <span className="md-x4">({m.ivaPorcentaje || 0}%)</span></span>;
      case 'retIva': return <span className="md-x5">{formatoMoneda(m.retIva)}</span>;
      case 'retIsr': return <span className="md-x5">{formatoMoneda(m.retIsr)}</span>;
      case 'total': return <span className="md-x6">{formatoMoneda(m.total)}</span>;
      case 'facturaTexto': return <span className="md-x2">{m.facturaTexto || '-'}</span>;
      case 'fechaFactura': return <span className="md-x2">{m.fechaFactura || '-'}</span>;
      case 'descripcionFactura': return <span className="md-x3">{m.descripcionFactura || '-'}</span>;
      case 'fechaPago': return <span className="md-x2">{m.fechaPago || '-'}</span>;
      case 'formaPago': return <span className="md-x2">{mostrarDatoMapeado(m.formaPagoId, 'formasPago', 'forma_pago')}</span>;
      case 'observaciones': return <span className="md-x3">{m.observaciones || '-'}</span>;
      case 'operacionAsignada': return <span className="md-x7">{mostrarDatoMapeado(m.operacionAsignadaId, 'operaciones', 'ref')}</span>;
      default: return <span className="md-x2">-</span>;
    }
  };

  // ✅ EXPORTACIÓN EN EXCEL (XLSX) RESPALDADA EN COLUMNAS VISIBLES
  const exportarExcel = () => {
    if (registrosFiltrados.length === 0) return alert("No hay datos para exportar.");
    
    const columnasVisibles = columnasTabla.filter(c => c.visible);

    const datosExcel = registrosFiltrados.map(m => {
      const fila: any = {};
      columnasVisibles.forEach(col => {
        let val: any = '-';
        switch (col.id) {
          case 'numeroGasto': val = formatearFolio(m); break;
          case 'invoice': val = m.invoice || ''; break;
          case 'estatus': val = m.estatus || ''; break;
          case 'fecha': val = m.fecha || ''; break;
          case 'unidad': val = mostrarNombreUnidad(m.unidadId || m.unidad); break;
          case 'operador': val = m.operadorNombre || m.operador || ''; break;
          case 'descripcion': val = m.descripcion || m.descripcionGeneral || ''; break;
          case 'proveedor': val = m.proveedorNombre || mostrarDatoMapeado(m.proveedorId, 'empresas'); break;
          case 'tipoServicio': val = mostrarDatoMapeado(m.tipoServicioId, 'servicios'); break;
          case 'autorizadoPor': val = m.autorizadoPor || ''; break;
          case 'condicionPago': val = m.condicionPago || ''; break;
          case 'plazo': val = m.plazo || ''; break;
          case 'moneda': val = mostrarDatoMapeado(m.monedaId, 'monedas', 'moneda'); break;
          case 'importe': val = Number(m.importe || 0); break;
          case 'iva': val = `${Number(m.ivaMonto || 0).toFixed(2)} (${m.ivaPorcentaje || 0}%)`; break;
          case 'retIva': val = Number(m.retIva || 0); break;
          case 'retIsr': val = Number(m.retIsr || 0); break;
          case 'total': val = Number(m.total || 0); break;
          case 'facturaTexto': val = m.facturaTexto || ''; break;
          case 'fechaFactura': val = m.fechaFactura || ''; break;
          case 'descripcionFactura': val = m.descripcionFactura || ''; break;
          case 'fechaPago': val = m.fechaPago || ''; break;
          case 'formaPago': val = mostrarDatoMapeado(m.formaPagoId, 'formasPago', 'forma_pago'); break;
          case 'observaciones': val = m.observaciones || ''; break;
          case 'operacionAsignada': val = mostrarDatoMapeado(m.operacionAsignadaId, 'operaciones', 'ref'); break;
        }
        fila[col.label] = val;
      });
      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Gastos MTTO');
    XLSX.writeFile(workbook, `Gastos_MTTO_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const tabsDetalle = [
    { id: 'general', label: 'Información General' },
    { id: 'finanzas', label: 'Detalles Financieros' },
    { id: 'documentos', label: 'Documentos y Cierre' }
  ];

  // Estilos reutilizables para el panel de detalles
  const labelStyle = { color:'#8b949e', display:'block', fontSize:'0.8rem', marginBottom: '4px', textTransform: 'uppercase' as const, fontWeight: 'bold' };
  const valStyle = { color: '#c9d1d9', fontSize: '0.95rem', fontWeight: '500' };
  const boxStyle = { backgroundColor:'#161b22', padding:'12px', borderRadius:'6px', color: '#c9d1d9', border: '1px solid #30363d', marginTop: '4px', minHeight: '60px' };

  return (
    <div className="module-container md-x8">
      
      <style>{`
        .detail-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        @media (max-width: 768px) { .detail-grid-3 { grid-template-columns: 1fr; } }
        .row-hover { background-color: #0d1117; transition: background-color 0.2s; cursor: pointer; border-bottom: 1px solid #21262d; }
        .row-hover:hover { background-color: #21262d; }
      `}</style>

      {estadoFormulario !== 'cerrado' && (
        <FormularioMtto 
          estado={estadoFormulario} 
          initialData={mttoEditando}
          onClose={() => { setEstadoFormulario('cerrado'); setMttoEditando(null); }}
          catalogos={catalogosCacheados} 
          onSave={handleGuardado}
        />
      )}

      <div className="md-x9">
        <h1 className="module-title md-x10">Gastos Mantenimiento (MTTO)</h1>
        <div className="md-x11">
          <button onClick={() => setVistaActiva('tabla')} style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: vistaActiva === 'tabla' ? '2px solid #D84315' : '2px solid transparent', color: vistaActiva === 'tabla' ? '#f0f6fc' : '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: vistaActiva === 'tabla' ? 'bold' : 'normal' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            Todos los Gastos (MTTO)
          </button>
          <button onClick={() => setVistaActiva('agrupado')} style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: vistaActiva === 'agrupado' ? '2px solid #D84315' : '2px solid transparent', color: vistaActiva === 'agrupado' ? '#f0f6fc' : '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: vistaActiva === 'agrupado' ? 'bold' : 'normal' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            Agrupados por Invoice
          </button>
          {/* ✅ NUEVO — vista de refacciones y garantías */}
          <button onClick={() => setVistaActiva('refacciones')} style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: vistaActiva === 'refacciones' ? '2px solid #D84315' : '2px solid transparent', color: vistaActiva === 'refacciones' ? '#f0f6fc' : '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: vistaActiva === 'refacciones' ? 'bold' : 'normal' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
            Refacciones y Garantías
          </button>
        </div>
      </div>

      {/* ✅ NUEVO — VISTA DE REFACCIONES Y GARANTÍAS */}
      {vistaActiva === 'refacciones' && (() => {
        // Se aplanan las refacciones de TODOS los gastos cargados.
        const todas = mttoGlobales.flatMap((m: any) =>
          (Array.isArray(m.refacciones) ? m.refacciones : []).map((r: any) => ({ ...r, __gasto: m }))
        );
        const hoy = hoyLocalISO();
        const conGarantia = todas.filter((r: any) => r.tieneGarantia && r.fechaGarantia);
        const vigentes = conGarantia
          .filter((r: any) => (diasEntreISO(hoy, r.fechaGarantia) ?? -1) >= 0)
          .sort((a: any, b: any) => String(a.fechaGarantia).localeCompare(String(b.fechaGarantia)));
        const vencidas = conGarantia
          .filter((r: any) => (diasEntreISO(hoy, r.fechaGarantia) ?? 0) < 0)
          .sort((a: any, b: any) => String(b.fechaGarantia).localeCompare(String(a.fechaGarantia)));
        const sinGarantia = todas.length - conGarantia.length;

        const thR: React.CSSProperties = { padding: '9px 10px', textAlign: 'left', color: '#8b949e', whiteSpace: 'nowrap' };
        const tdR: React.CSSProperties = { padding: '8px 10px', color: '#c9d1d9' };
        const TablaRef = ({ filas, esVencidas }: { filas: any[]; esVencidas: boolean }) => (
          <div style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#161b22' }}>
                  <th style={thR}>ACCIONES</th><th style={thR}># GASTO</th><th style={thR}>UNIDAD</th><th style={thR}>REFACCIÓN</th>
                  <th style={thR}>COMPRA</th><th style={thR}>VENCE GARANTÍA</th><th style={thR}>{esVencidas ? 'VENCIDA HACE' : 'DÍAS RESTANTES'}</th>
                  <th style={thR}>DÓNDE SE COMPRÓ</th><th style={thR}>DÓNDE SE INSTALÓ</th>
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...tdR, textAlign: 'center', color: '#8b949e', padding: '18px' }}>
                    {esVencidas ? 'Sin garantías vencidas. ✅' : 'Sin garantías pendientes.'}
                  </td></tr>
                ) : filas.map((r: any) => {
                  const dias = diasEntreISO(hoy, r.fechaGarantia) ?? 0;
                  const color = esVencidas ? '#f85149' : dias <= 30 ? '#d29922' : '#3fb950';
                  return (
                    <tr key={`${r.__gasto.id}_${r.id}`} style={{ borderTop: '1px solid #21262d' }}>
                      <td style={{ ...tdR, whiteSpace: 'nowrap' }}>
                        <button type="button" title="Ver detalle del gasto"
                          onClick={() => { setMttoViendo(r.__gasto); setPestañaDetalleActiva('general'); }}
                          style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: '6px', color: '#58a6ff', cursor: 'pointer', padding: '4px 8px' }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        </button>
                      </td>
                      <td style={{ ...tdR, whiteSpace: 'nowrap', color: '#D84315', fontWeight: 600 }}>{formatearFolio(r.__gasto)}</td>
                      <td style={tdR}>{mostrarNombreUnidad(r.__gasto.unidadId || r.__gasto.unidad)}</td>
                      <td style={{ ...tdR, fontWeight: 600 }}>{r.descripcion}</td>
                      <td style={{ ...tdR, whiteSpace: 'nowrap' }}>{r.fechaCompra || '-'}</td>
                      <td style={{ ...tdR, whiteSpace: 'nowrap' }}>{r.fechaGarantia}</td>
                      <td style={{ ...tdR, whiteSpace: 'nowrap', color, fontWeight: 700 }}>
                        {esVencidas ? `${Math.abs(dias)} días` : `${dias} días`}
                      </td>
                      <td style={tdR}>{r.dondeCompro || '-'}</td>
                      <td style={tdR}>{r.dondeInstalo || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );

        return (
          <div className="md-x12" style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
            <div style={{ color: '#8b949e', fontSize: '0.85rem' }}>
              {todas.length} refacción(es) registradas · {vigentes.length} con garantía vigente · {vencidas.length} con garantía vencida · {sinGarantia} sin garantía
            </div>
            <div>
              <h3 style={{ color: '#3fb950', margin: '0 0 10px 0', fontSize: '1rem' }}>🛡️ Garantías pendientes (vigentes) — {vigentes.length}</h3>
              <TablaRef filas={vigentes} esVencidas={false} />
            </div>
            <div>
              <h3 style={{ color: '#f85149', margin: '0 0 10px 0', fontSize: '1rem' }}>⛔ Garantías vencidas — {vencidas.length}</h3>
              <TablaRef filas={vencidas} esVencidas={true} />
            </div>
          </div>
        );
      })()}

      {vistaActiva === 'agrupado' && <MttoAgrupadosInvoice />}
      {vistaActiva === 'tabla' && (
        <div className="md-x12">

          {/* PESTAÑAS POR ESTATUS: No facturados / Facturados (con conteo y monto) */}
          <div className="md-x13">
            {([
              { id: 'no_facturado', label: 'No facturados', count: registrosNoFacturados.length, total: totalNoFacturado, color: '#f85149' },
              { id: 'facturado', label: 'Facturados', count: registrosFacturados.length, total: totalFacturado, color: '#3fb950' },
            ] as const).map(t => {
              const activo = estatusVista === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setEstatusVista(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '12px 18px', borderRadius: '10px', cursor: 'pointer',
                    backgroundColor: activo ? '#161b22' : 'transparent',
                    border: '1px solid ' + (activo ? t.color : '#30363d'),
                    boxShadow: activo ? `inset 0 -3px 0 ${t.color}` : 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span className="md-x14">
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: t.color, display: 'inline-block' }} />
                    <span style={{ color: activo ? '#f0f6fc' : '#8b949e', fontWeight: activo ? 700 : 500, fontSize: '0.95rem' }}>{t.label}</span>
                  </span>
                  <span style={{ backgroundColor: activo ? t.color : '#21262d', color: activo ? '#fff' : '#c9d1d9', borderRadius: '999px', padding: '2px 10px', fontSize: '0.8rem', fontWeight: 700, minWidth: '24px', textAlign: 'center' }}>{t.count}</span>
                  <span style={{ color: activo ? t.color : '#8b949e', fontSize: '0.85rem', fontWeight: 600, borderLeft: '1px solid #30363d', paddingLeft: '12px' }}>{formatoMoneda(t.total)}</span>
                </button>
              );
            })}
          </div>

          <div className="md-x15">
            
            <div className="md-x16">
              <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${(busqueda || fechaDesde || fechaHasta) ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                Filtros
                {(busqueda || fechaDesde || fechaHasta) && <span className="md-x17">{[busqueda, fechaDesde || fechaHasta].filter(Boolean).length}</span>}
              </button>
              {(fechaDesde || fechaHasta) && (
                <span className="md-x18">
                  {(fechaDesde || '…')} → {(fechaHasta || '…')}
                  <button className="md-x19" onClick={() => { setFechaDesde(''); setFechaHasta(''); }}>✕</button>
                </span>
              )}
              {busqueda && (
                <span className="md-x20">
                  "{busqueda}"
                  <button className="md-x21" onClick={() => setBusqueda('')}>✕</button>
                </span>
              )}
              {busquedaHecha && (
                <span className="md-x22">{registrosEnPantalla.length} en pantalla</span>
              )}
            </div>

            <div className="md-x23">
              {gastosSeleccionados.length > 0 && (
                <button className="md-x24" 
                  title="Asignar Invoice Masivo"
                  onClick={() => setModalInvoiceMasivo(true)}
                >
                  <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 1 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5z"/></svg>
                  ({gastosSeleccionados.length})
                </button>
              )}
              
              <button className="btn btn-outline md-x25" onClick={() => setModalColumnas(true)} title="Configurar Columnas">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              </button>

              <button className="md-x26" 
                title="Exportar a Excel"
                onClick={exportarExcel}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              </button>
              <button className="md-x27" 
                title="Agregar Gasto MTTO"
                onClick={handleNuevo}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
            </div>
          </div>

          {/* PANEL DE SUMARIO DE GASTOS */}
          {gastosSeleccionados.length > 0 && (
            <div className="md-x28">
              <div className="md-x29">
                <div className="md-x30">
                  <span className="md-x31">Seleccionados</span>
                  <span className="md-x32">{resumenSeleccion.cantidad}</span>
                </div>
                <div className="md-x30">
                  <span className="md-x31">Suma Importe (Base)</span>
                  <span className="md-x33">{formatoMoneda(resumenSeleccion.totalImporte)}</span>
                </div>
                <div className="md-x30">
                  <span className="md-x31">Suma IVA</span>
                  <span className="md-x33">{formatoMoneda(resumenSeleccion.totalIva)}</span>
                </div>
                <div>
                  <span className="md-x34">Gran Total</span>
                  <span className="md-x35">{formatoMoneda(resumenSeleccion.granTotal)}</span>
                </div>
              </div>
              <div className="md-x36">
                <span className="md-x37">Gastos incluidos:</span>
                <div className="md-x38">
                  {resumenSeleccion.numerosGasto.map((ref, i) => (
                    <span className="md-x39" key={i}>{ref}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="table-container md-x40">
            {!busquedaHecha ? (
              <div className="md-x41">
                <div className="md-x42">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                  <span className="md-x43">Define tus filtros y presiona <b className="md-x44">Buscar</b> para ver los gastos.</span>
                  <button className="md-x45" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                </div>
              </div>
            ) : cargando ? <div className="md-x46">Cargando datos...</div> : (
              <table className="data-table md-x47">
                <thead className="md-x48">
                  <tr>
                    <th className="md-x49"></th>
                    <th className="md-x50">Acciones</th>
                    {columnasTabla.filter(c => c.visible).map(col => (
                      <th className="md-x51" key={`th_${col.id}`}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {registrosEnPantalla.length === 0 ? (
                    <tr><td className="md-x52" colSpan={columnasTabla.length + 2}>Sin resultados.</td></tr>
                  ) : (
                    registrosEnPantalla.map((m: any) => {
                      const isSelected = gastosSeleccionados.includes(m.id);
                      const yaFacturado = m.estatus === 'Facturado' || (m.invoice && m.invoice.trim() !== '');
                      return (
                      <tr 
                        key={m.id} 
                        className="row-hover"
                        style={{ backgroundColor: isSelected ? 'rgba(56, 139, 253, 0.1)' : '' }}
                        onClick={() => setMttoViendo(m)}
                      >
                        <td style={{ padding: '16px 8px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: isSelected ? '#1f2937' : 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                          {!yaFacturado && <input className="md-x53" type="checkbox" checked={isSelected} onChange={() => toggleSeleccion(m.id)} />}
                        </td>
                        <td style={{ padding: '16px', position: 'sticky', left: '56px', backgroundColor: isSelected ? '#1f2937' : 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                          <div className="md-x54">
                            <button className="md-x55" 
                              title="Editar Gasto"
                              onClick={() => editarMtto(m)}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                            </button>
                            <button className="md-x56" 
                              title="Generar documento (Relación de Compras) con este gasto"
                              onClick={() => generarDocumentoGasto(m)}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(245, 158, 11, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                            </button>
                            <button className="md-x57" 
                              title="Eliminar Gasto"
                              onClick={() => eliminarMtto(m.id)}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </div>
                        </td>
                        {columnasTabla.filter(c => c.visible).map(col => (
                          <td className="md-x58" key={`cell_${m.id}_${col.id}`}>
                            {renderCellContent(m, col.id)}
                          </td>
                        ))}
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* CONTROLES DE PAGINACIÓN */}
          {busquedaHecha && registrosVista.length > 0 && !cargando && (
            <div className="md-x59">
              <div className="md-x60">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosVista.length)} de {registrosVista.length} gastos
              </div>
              <div className="md-x61">
                <button 
                  title="Página Anterior"
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1} 
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span className="md-x62">{paginaActual} / {totalPaginas || 1}</span>
                <button 
                  title="Página Siguiente"
                  onClick={irPaginaSiguiente} 
                  disabled={paginaActual === totalPaginas || totalPaginas === 0} 
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL INVOICE MASIVO */}
      {modalInvoiceMasivo && (
        <div className="modal-overlay md-x63">
          <div className="form-card md-x64">
            <div className="form-header md-x65">
              <h2 className="md-x66">Asignar Invoice Masivo</h2>
              <button className="md-x67" onClick={() => setModalInvoiceMasivo(false)}>✕</button>
            </div>
            <div className="md-x68">
              <p className="md-x69">Estás a punto de asignar el mismo número de Invoice a <strong>{gastosSeleccionados.length}</strong> registro(s).</p>
              <div className="form-group">
                <label className="md-x70">Número de Invoice a Asignar</label>
                <input className="md-x71" type="text" placeholder="Ej: INV-99234" value={nuevoInvoiceTexto} onChange={e => setNuevoInvoiceTexto(e.target.value)} autoFocus />
              </div>
            </div>
            <div className="form-actions md-x72">
              <button onClick={() => setModalInvoiceMasivo(false)} disabled={cargandoMasivo} className="btn btn-outline md-x73">Cancelar</button>
              <button onClick={aplicarInvoiceMasivo} disabled={cargandoMasivo || !nuevoInvoiceTexto.trim()} className="btn btn-primary md-x74">{cargandoMasivo ? 'Aplicando...' : 'Aplicar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PARA CONFIGURAR COLUMNAS EN GRID DE 3 COLUMNAS */}
      {modalColumnas && (
        <div className="modal-overlay md-x75">
          <div className="md-x76">
            <div className="md-x77">
              <h3 className="md-x78">Configurar Columnas</h3>
              <button className="md-x67" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <p className="md-x79">Arrastra los campos para reordenarlos. Desmarca los que desees ocultar de la tabla principal y del reporte de Excel.</p>
            
            <ul className="md-x80">
              {columnasTabla.map((col, idx) => (
                <li 
                  key={col.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragEnter={() => handleDragEnter(idx)}
                  onDragEnd={() => setDraggedColIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  style={{ 
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', 
                    backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', 
                    border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab',
                    transition: 'background-color 0.2s'
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input className="md-x53" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                </li>
              ))}
            </ul>

            <div className="md-x81">
              <button className="md-x82" onClick={() => setModalColumnas(false)}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DETALLES RECONSTRUIDO */}
      {mttoViendo && (
        <div className="modal-overlay md-x83">
          <div className="form-card detail-card md-x84">
            <div className="form-header md-x85">
              <h2 className="md-x78">Detalle de Gasto <span className="md-x7">{formatearFolio(mttoViendo)}</span></h2>
              <button className="md-x67" onClick={() => setMttoViendo(null)}>✕</button>
            </div>
            
            <div className="md-x86">
              {tabsDetalle.map(tab => (<button key={tab.id} onClick={() => setPestañaDetalleActiva(tab.id)} style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent', color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer' }}>{tab.label}</button>))}
            </div>
            
            <div className="detail-content md-x87">
              
              {/* PESTAÑA 1: INFORMACIÓN GENERAL */}
              {pestañaDetalleActiva === 'general' && (
                <div className="detail-grid-3">
                   <div><label style={labelStyle}># DE GASTO</label><span style={valStyle}>{formatearFolio(mttoViendo)}</span></div>
                   <div><label style={labelStyle}># DE INVOICE</label><span style={valStyle}>{mttoViendo.invoice || '-'}</span></div>
                   <div><label style={labelStyle}>ESTATUS</label><span style={{color: mttoViendo.estatus === 'Facturado' ? '#3fb950' : '#f85149', fontWeight: 'bold'}}>{mttoViendo.estatus || '-'}</span></div>
                   <div><label style={labelStyle}>FECHA</label><span style={valStyle}>{mttoViendo.fecha || '-'}</span></div>
                   <div><label style={labelStyle}>TIPO DE GASTO</label><span style={valStyle}>{mttoViendo.tipoGasto || '-'}</span></div>
                   <div><label style={labelStyle}>UNIDAD</label><span style={valStyle}>{mostrarNombreUnidad(mttoViendo.unidadId || mttoViendo.unidad)}</span></div>
                   <div><label style={labelStyle}>OPERADOR</label><span style={valStyle}>{mttoViendo.operadorNombre || mttoViendo.operador || '-'}</span></div>
                   <div className="md-x88"><label style={labelStyle}>DESCRIPCIÓN GENERAL</label><div style={boxStyle}>{mttoViendo.descripcion || mttoViendo.descripcionGeneral || '-'}</div></div>

                   {/* ✅ NUEVO — SUBTABLA DE REFACCIONES en el detalle */}
                   {Array.isArray(mttoViendo.refacciones) && mttoViendo.refacciones.length > 0 && (
                     <div className="md-x88">
                       <label style={labelStyle}>🔧 REFACCIONES ({mttoViendo.refacciones.length})</label>
                       <div style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', marginTop: '4px' }}>
                         <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                           <thead>
                             <tr style={{ backgroundColor: '#161b22', color: '#8b949e', textAlign: 'left' }}>
                               <th style={{ padding: '9px 10px' }}>#</th>
                               <th style={{ padding: '9px 10px' }}>REFACCIÓN</th>
                               <th style={{ padding: '9px 10px' }}>COMPRA</th>
                               <th style={{ padding: '9px 10px' }}>GARANTÍA</th>
                               <th style={{ padding: '9px 10px' }}>DÓNDE SE COMPRÓ</th>
                               <th style={{ padding: '9px 10px' }}>DÓNDE SE INSTALÓ</th>
                             </tr>
                           </thead>
                           <tbody>
                             {mttoViendo.refacciones.map((r: any, idx: number) => {
                               const diasRest = r.tieneGarantia && r.fechaGarantia ? diasEntreISO(hoyLocalISO(), r.fechaGarantia) : null;
                               const colorRest = diasRest === null ? '#8b949e' : diasRest < 0 ? '#f85149' : diasRest <= 30 ? '#d29922' : '#3fb950';
                               return (
                                 <tr key={r.id || idx} style={{ borderTop: '1px solid #21262d', color: '#c9d1d9' }}>
                                   <td style={{ padding: '8px 10px', color: '#8b949e' }}>{idx + 1}</td>
                                   <td style={{ padding: '8px 10px', fontWeight: 600 }}>{r.descripcion || '-'}</td>
                                   <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{r.fechaCompra || '-'}</td>
                                   <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                                     {r.tieneGarantia ? (
                                       <span>
                                         {r.fechaGarantia || '-'}
                                         {diasRest !== null && (
                                           <span style={{ display: 'block', fontSize: '0.72rem', color: colorRest, fontWeight: 700 }}>
                                             {diasRest < 0 ? `VENCIDA hace ${Math.abs(diasRest)} d` : `quedan ${diasRest} d`}
                                           </span>
                                         )}
                                       </span>
                                     ) : <span style={{ color: '#8b949e' }}>Sin garantía</span>}
                                   </td>
                                   <td style={{ padding: '8px 10px' }}>{r.dondeCompro || '-'}</td>
                                   <td style={{ padding: '8px 10px' }}>{r.dondeInstalo || '-'}</td>
                                 </tr>
                               );
                             })}
                           </tbody>
                         </table>
                       </div>
                     </div>
                   )}
                </div>
              )}

              {/* PESTAÑA 2: FINANZAS */}
              {pestañaDetalleActiva === 'finanzas' && (
                <div className="detail-grid-3">
                   <div className="md-x88"><label style={labelStyle}>PROVEEDOR</label><span style={valStyle}>{mttoViendo.proveedorNombre || mostrarDatoMapeado(mttoViendo.proveedorId, 'empresas')}</span></div>
                   <div className="md-x88"><label style={labelStyle}>TIPO DE SERVICIO</label>
                      <div className="md-x89">
                          {Array.isArray(mttoViendo.tipoServicioId) && mttoViendo.tipoServicioId.length > 0 
                          ? mttoViendo.tipoServicioId.map((idS: string) => (
                              <span className="md-x90" key={idS}>
                                  {mostrarDatoMapeado(idS, 'servicios')}
                              </span>
                              ))
                          : <span style={valStyle}>{mostrarDatoMapeado(mttoViendo.tipoServicioId, 'servicios')}</span>
                          }
                      </div>
                   </div>
                   <div><label style={labelStyle}>CONDICIÓN DE PAGO</label><span style={valStyle}>{mttoViendo.condicionPago || '-'}</span></div>
                   {mttoViendo.condicionPago === 'Crédito' && (
                     <div><label style={labelStyle}>PLAZO (DÍAS)</label><span style={valStyle}>{mttoViendo.plazo || '-'}</span></div>
                   )}
                   <div><label style={labelStyle}>MONEDA</label><span style={valStyle}>{mostrarDatoMapeado(mttoViendo.monedaId, 'monedas', 'moneda')}</span></div>

                   <div className="md-x88"><hr className="md-x91" /></div>

                   <div><label style={labelStyle}>IMPORTE (MONTO BASE)</label><span className="md-x92">{formatoMoneda(mttoViendo.importe)}</span></div>
                   <div><label style={labelStyle}>IVA (+)</label><span style={valStyle}>{formatoMoneda(mttoViendo.ivaMonto)} <span className="md-x4">({mttoViendo.ivaPorcentaje || 0}%)</span></span></div>
                   <div></div>
                   
                   <div><label style={labelStyle}>RET IVA (-)</label><span className="md-x5">{formatoMoneda(mttoViendo.retIva)}</span></div>
                   <div><label style={labelStyle}>RET ISR (-)</label><span className="md-x5">{formatoMoneda(mttoViendo.retIsr)}</span></div>

                   <div className="md-x88"><label style={{...labelStyle, color:'#3fb950'}}>TOTAL FINAL</label><span className="md-x93">{formatoMoneda(mttoViendo.total)}</span></div>
                </div>
              )}

              {/* PESTAÑA 3: DOCUMENTOS Y CIERRE */}
              {pestañaDetalleActiva === 'documentos' && (
                <div className="detail-grid-3">
                   <div><label style={labelStyle}>FACTURA (TEXTO)</label><span style={valStyle}>{mttoViendo.facturaTexto || '-'}</span></div>
                   <div><label style={labelStyle}>FECHA FACTURA</label><span style={valStyle}>{mttoViendo.fechaFactura || '-'}</span></div>
                   <div><label style={labelStyle}>DESCRIPCIÓN FACTURA</label><span style={valStyle}>{mttoViendo.descripcionFactura || '-'}</span></div>
                   
                   <div><label style={labelStyle}>ARCHIVO (PDF)</label>
                      {mttoViendo.archivoPdfUrl ? (
                          <a className="md-x94" href={mttoViendo.archivoPdfUrl} target="_blank" rel="noreferrer">Ver Documento</a>
                      ) : <span style={valStyle}>Sin archivo</span>}
                   </div>

                   <div><label style={labelStyle}>FECHA DE PAGO</label><span style={valStyle}>{mttoViendo.fechaPago || '-'}</span></div>
                   <div><label style={labelStyle}>FORMA DE PAGO</label><span style={valStyle}>{mostrarDatoMapeado(mttoViendo.formaPagoId, 'formasPago', 'forma_pago')}</span></div>
                   
                   <div><label style={labelStyle}>AUTORIZADO POR</label><span style={valStyle}>{mttoViendo.autorizadoPor || '-'}</span></div>
                   <div><label style={labelStyle}>ASIGNAR A OPERACIÓN</label><span style={valStyle}>{mostrarDatoMapeado(mttoViendo.operacionAsignadaId, 'operaciones', 'ref')}</span></div>

                   <div className="md-x88"><label style={labelStyle}>OBSERVACIONES</label><div style={boxStyle}>{mttoViendo.observaciones || '-'}</div></div>
                </div>
              )}
            </div>
            
            <div className="md-x95">
              <button onClick={() => setMttoViendo(null)} className="btn btn-outline">Cerrar Detalles</button>
            </div>
          </div>
        </div>
      )}

      {/* NUEVO: panel lateral DERECHO de filtros (Gastos MTTO) */}
      {drawerFiltrosAbierto && (
        <div className="md-x96" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="md-x97" onClick={(e) => e.stopPropagation()}>
            <div className="md-x98">
              <h3 className="md-x99">Filtros · Gastos MTTO</h3>
              <button className="md-x67" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="md-x100">
              <label className="md-x101">BÚSQUEDA</label>
              <div className="md-x102">
                <svg className="md-x103" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="md-x104" type="text" placeholder="Folio, unidad, proveedor, montos, observaciones..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="md-x105" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            <div className="md-x106">
              <div className="md-x107">
                <label className="md-x108">FECHA DESDE</label>
                <input className="md-x109" type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
              </div>
              <div className="md-x107">
                <label className="md-x108">FECHA HASTA</label>
                <input className="md-x109" type="date" value={fechaHasta} min={fechaDesde || undefined} onChange={(e) => setFechaHasta(e.target.value)} />
              </div>
            </div>

            <div className="md-x110">
              Todos los campos son <b className="md-x111">opcionales</b>. Presiona <b className="md-x44">Buscar</b> para ver los gastos.
            </div>

            <div className="md-x112">
              <button className="md-x113" onClick={() => { setBusqueda(''); setFechaDesde(''); setFechaHasta(''); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="md-x114" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MttoDashboard;