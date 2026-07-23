// src/features/gastos/components/mtto/MttoDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { FormularioMtto } from './FormularioMtto';
import { collection, query, getDocs, limit, orderBy, doc, deleteDoc, writeBatch } from 'firebase/firestore'; 
import { db } from '../../../../config/firebase'; 
import MttoAgrupadosInvoice from './MttoAgrupadosInvoice';
import * as XLSX from 'xlsx';
// ✅ Logo de los PDF (mismas exportaciones que ya usa el historial de Invoice).
import { getLogoPdf, LOGO_DEFAULT } from '../../../../utils/pdfGenerator';

type VistaMaestra = 'tabla' | 'agrupado';

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
      const cacheCatStr = sessionStorage.getItem('roelca_catalogos_v1');

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
        
        sessionStorage.setItem('roelca_catalogos_v1', JSON.stringify(catGuardados));
        setCatalogosCacheados(catGuardados);
      }

      // ✅ orderBy('createdAt','desc') garantiza que los 300 registros devueltos
      //    sean los MÁS RECIENTES. Antes, limit(300) sin orden traía los primeros
      //    300 por ID de documento (aleatorio), y los gastos nuevos podían quedar
      //    fuera de la ventana: se guardaban en Firestore pero no aparecían aquí.
      const q = query(collection(db, 'gastos_mtto'), orderBy('createdAt', 'desc'), limit(300));
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

  const registrosFiltrados = useMemo(() => {
    const b = busqueda.trim().toLowerCase();
    return mttoGlobales.filter(m => {
      // 1) Filtro por rango de fechas (campo `fecha`, respaldo `createdAt`)
      const fechaISO = String(m.fecha || m.createdAt || '').slice(0, 10);
      if (fechaDesde && (!fechaISO || fechaISO < fechaDesde)) return false;
      if (fechaHasta && (!fechaISO || fechaISO > fechaHasta)) return false;
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
      case 'numeroGasto': return <span style={{ color: '#58a6ff', fontWeight: 'bold' }}>{formatearFolio(m)}</span>;
      case 'invoice': return <span style={{ color: '#c9d1d9' }}>{m.invoice || '-'}</span>;
      case 'estatus': return <span style={{ color: m.estatus === 'Facturado' ? '#3fb950' : '#f85149', fontWeight: 'bold' }}>{m.estatus || '-'}</span>;
      case 'fecha': return <span style={{ color: '#c9d1d9' }}>{m.fecha || '-'}</span>;
      case 'unidad': return <span style={{ color: '#c9d1d9' }}>{mostrarNombreUnidad(m.unidadId || m.unidad)}</span>;
      case 'operador': return <span style={{ color: '#c9d1d9' }}>{m.operadorNombre || m.operador || '-'}</span>;
      case 'descripcion': return <span style={{ color: '#c9d1d9', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>{m.descripcion || m.descripcionGeneral || '-'}</span>;
      case 'proveedor': return <span style={{ color: '#c9d1d9' }}>{m.proveedorNombre || mostrarDatoMapeado(m.proveedorId, 'empresas')}</span>;
      case 'tipoServicio': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(m.tipoServicioId, 'servicios')}</span>;
      case 'autorizadoPor': return <span style={{ color: '#c9d1d9' }}>{m.autorizadoPor || '-'}</span>;
      case 'condicionPago': return <span style={{ color: '#c9d1d9' }}>{m.condicionPago || '-'}</span>;
      case 'plazo': return <span style={{ color: '#c9d1d9' }}>{m.plazo || '-'}</span>;
      case 'moneda': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(m.monedaId, 'monedas', 'moneda')}</span>;
      case 'importe': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(m.importe)}</span>;
      case 'iva': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(m.ivaMonto)} <span style={{fontSize:'0.8rem'}}>({m.ivaPorcentaje || 0}%)</span></span>;
      case 'retIva': return <span style={{ color: '#f85149' }}>{formatoMoneda(m.retIva)}</span>;
      case 'retIsr': return <span style={{ color: '#f85149' }}>{formatoMoneda(m.retIsr)}</span>;
      case 'total': return <span style={{ color: '#3fb950', fontWeight: 'bold' }}>{formatoMoneda(m.total)}</span>;
      case 'facturaTexto': return <span style={{ color: '#c9d1d9' }}>{m.facturaTexto || '-'}</span>;
      case 'fechaFactura': return <span style={{ color: '#c9d1d9' }}>{m.fechaFactura || '-'}</span>;
      case 'descripcionFactura': return <span style={{ color: '#c9d1d9', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>{m.descripcionFactura || '-'}</span>;
      case 'fechaPago': return <span style={{ color: '#c9d1d9' }}>{m.fechaPago || '-'}</span>;
      case 'formaPago': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(m.formaPagoId, 'formasPago', 'forma_pago')}</span>;
      case 'observaciones': return <span style={{ color: '#c9d1d9', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>{m.observaciones || '-'}</span>;
      case 'operacionAsignada': return <span style={{ color: '#58a6ff' }}>{mostrarDatoMapeado(m.operacionAsignadaId, 'operaciones', 'ref')}</span>;
      default: return <span style={{ color: '#c9d1d9' }}>-</span>;
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
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      
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

      <div style={{ marginBottom: '24px' }}>
        <h1 className="module-title" style={{ fontSize: '1.8rem', color: '#f0f6fc', margin: '0 0 16px 0', fontWeight: 'bold' }}>Gastos Mantenimiento (MTTO)</h1>
        <div style={{ display: 'flex', borderBottom: '1px solid #30363d', gap: '16px' }}>
          <button onClick={() => setVistaActiva('tabla')} style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: vistaActiva === 'tabla' ? '2px solid #D84315' : '2px solid transparent', color: vistaActiva === 'tabla' ? '#f0f6fc' : '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: vistaActiva === 'tabla' ? 'bold' : 'normal' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            Todos los Gastos (MTTO)
          </button>
          <button onClick={() => setVistaActiva('agrupado')} style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: vistaActiva === 'agrupado' ? '2px solid #D84315' : '2px solid transparent', color: vistaActiva === 'agrupado' ? '#f0f6fc' : '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: vistaActiva === 'agrupado' ? 'bold' : 'normal' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            Agrupados por Invoice
          </button>
        </div>
      </div>

      {vistaActiva === 'agrupado' ? <MttoAgrupadosInvoice /> : (
        <div style={{ width: '100%', margin: '0 auto' }}>

          {/* ✅ PESTAÑAS POR ESTATUS: No facturados / Facturados (con conteo y monto) */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
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
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: t.color, display: 'inline-block' }} />
                    <span style={{ color: activo ? '#f0f6fc' : '#8b949e', fontWeight: activo ? 700 : 500, fontSize: '0.95rem' }}>{t.label}</span>
                  </span>
                  <span style={{ backgroundColor: activo ? t.color : '#21262d', color: activo ? '#fff' : '#c9d1d9', borderRadius: '999px', padding: '2px 10px', fontSize: '0.8rem', fontWeight: 700, minWidth: '24px', textAlign: 'center' }}>{t.count}</span>
                  <span style={{ color: activo ? t.color : '#8b949e', fontSize: '0.85rem', fontWeight: 600, borderLeft: '1px solid #30363d', paddingLeft: '12px' }}>{formatoMoneda(t.total)}</span>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
            
            <div style={{ display: 'flex', gap: '10px', flex: '1 1 auto', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${(busqueda || fechaDesde || fechaHasta) ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                Filtros
                {(busqueda || fechaDesde || fechaHasta) && <span style={{ backgroundColor: '#D84315', color: '#fff', borderRadius: '10px', padding: '1px 8px', fontSize: '0.72rem' }}>{[busqueda, fechaDesde || fechaHasta].filter(Boolean).length}</span>}
              </button>
              {(fechaDesde || fechaHasta) && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: 'rgba(216,67,21,0.1)', border: '1px solid #D84315', borderRadius: '14px', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold' }}>
                  {(fechaDesde || '…')} → {(fechaHasta || '…')}
                  <button onClick={() => { setFechaDesde(''); setFechaHasta(''); }} style={{ background: 'transparent', border: 'none', color: '#D84315', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1 }}>✕</button>
                </span>
              )}
              {busqueda && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: 'rgba(88,166,255,0.1)', border: '1px solid #58a6ff', borderRadius: '14px', color: '#58a6ff', fontSize: '0.8rem', fontWeight: 'bold' }}>
                  "{busqueda}"
                  <button onClick={() => setBusqueda('')} style={{ background: 'transparent', border: 'none', color: '#58a6ff', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1 }}>✕</button>
                </span>
              )}
              {busquedaHecha && (
                <span style={{ color: '#8b949e', fontSize: '0.82rem' }}>{registrosEnPantalla.length} en pantalla</span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              {gastosSeleccionados.length > 0 && (
                <button 
                  title="Asignar Invoice Masivo"
                  onClick={() => setModalInvoiceMasivo(true)} 
                  style={{ backgroundColor: '#238636', color: '#ffffff', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 1 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5z"/></svg>
                  ({gastosSeleccionados.length})
                </button>
              )}
              
              <button className="btn btn-outline" onClick={() => setModalColumnas(true)} style={{ backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }} title="Configurar Columnas">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              </button>

              <button 
                title="Exportar a Excel"
                onClick={exportarExcel} 
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', padding: '8px 12px', borderRadius: '6px', color: '#c9d1d9', cursor: 'pointer' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              </button>
              <button 
                title="Agregar Gasto MTTO"
                onClick={handleNuevo} 
                style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
            </div>
          </div>

          {/* ✅ PANEL DE SUMARIO DE GASTOS */}
          {gastosSeleccionados.length > 0 && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '16px' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Seleccionados</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{resumenSeleccion.cantidad}</span>
                </div>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Suma Importe (Base)</span>
                  <span style={{ color: '#3fb950', fontSize: '1.5rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.totalImporte)}</span>
                </div>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Suma IVA</span>
                  <span style={{ color: '#3fb950', fontSize: '1.5rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.totalIva)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Gran Total</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1.8rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.granTotal)}</span>
                </div>
              </div>
              <div style={{ borderTop: '1px dashed #30363d', paddingTop: '16px' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Gastos incluidos:</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {resumenSeleccion.numerosGasto.map((ref, i) => (
                    <span key={i} style={{ backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', padding: '4px 10px', borderRadius: '12px', fontSize: '0.85rem', fontFamily: 'monospace' }}>{ref}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            {!busquedaHecha ? (
              <div style={{ padding: '64px 24px', textAlign: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                  <span style={{ color: '#8b949e', fontSize: '0.95rem' }}>Define tus filtros y presiona <b style={{ color: '#D84315' }}>Buscar</b> para ver los gastos.</span>
                  <button onClick={() => setDrawerFiltrosAbierto(true)} style={{ padding: '10px 20px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' }}>Abrir filtros</button>
                </div>
              </div>
            ) : cargando ? <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando datos...</div> : (
              <table className="data-table" style={{ width: '100%', minWidth: '1500px', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr>
                    <th style={{ padding: '16px 8px', width: '40px', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}></th>
                    <th style={{ padding: '16px', width: '100px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: '56px', backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>Acciones</th>
                    {columnasTabla.filter(c => c.visible).map(col => (
                      <th key={`th_${col.id}`} style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {registrosEnPantalla.length === 0 ? (
                    <tr><td colSpan={columnasTabla.length + 2} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Sin resultados.</td></tr>
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
                          {!yaFacturado && <input type="checkbox" checked={isSelected} onChange={() => toggleSeleccion(m.id)} style={{ cursor: 'pointer', transform: 'scale(1.2)' }} />}
                        </td>
                        <td style={{ padding: '16px', position: 'sticky', left: '56px', backgroundColor: isSelected ? '#1f2937' : 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button 
                              title="Editar Gasto"
                              onClick={() => editarMtto(m)} 
                              style={{ background: 'transparent', border: '1px solid #3b82f6', color: '#3b82f6', borderRadius: '4px', padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                            </button>
                            <button 
                              title="Generar documento (Relación de Compras) con este gasto"
                              onClick={() => generarDocumentoGasto(m)} 
                              style={{ background: 'transparent', border: '1px solid #f59e0b', color: '#f59e0b', borderRadius: '4px', padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(245, 158, 11, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                            </button>
                            <button 
                              title="Eliminar Gasto"
                              onClick={() => eliminarMtto(m.id)} 
                              style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '4px', padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </div>
                        </td>
                        {columnasTabla.filter(c => c.visible).map(col => (
                          <td key={`cell_${m.id}_${col.id}`} style={{ padding: '16px', whiteSpace: 'nowrap' }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosVista.length)} de {registrosVista.length} gastos
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  title="Página Anterior"
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1} 
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
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
        <div className="modal-overlay" style={{ zIndex: 3000 }}>
          <div className="form-card" style={{ maxWidth: '450px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px' }}>
            <div className="form-header" style={{ padding: '16px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem' }}>Asignar Invoice Masivo</h2>
              <button onClick={() => setModalInvoiceMasivo(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div style={{ padding: '24px' }}>
              <p style={{ color: '#8b949e', fontSize: '0.9rem', marginBottom: '20px' }}>Estás a punto de asignar el mismo número de Invoice a <strong>{gastosSeleccionados.length}</strong> registro(s).</p>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem', fontWeight: 'bold' }}>Número de Invoice a Asignar</label>
                <input type="text" placeholder="Ej: INV-99234" value={nuevoInvoiceTexto} onChange={e => setNuevoInvoiceTexto(e.target.value)} autoFocus style={{ width: '100%', padding: '12px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#f0f6fc', fontSize: '1.1rem' }} />
              </div>
            </div>
            <div className="form-actions" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #30363d', backgroundColor: '#161b22', borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px' }}>
              <button onClick={() => setModalInvoiceMasivo(false)} disabled={cargandoMasivo} className="btn btn-outline" style={{ padding: '8px 16px', borderRadius: '6px' }}>Cancelar</button>
              <button onClick={aplicarInvoiceMasivo} disabled={cargandoMasivo || !nuevoInvoiceTexto.trim()} className="btn btn-primary" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: '#238636', border: 'none' }}>{cargandoMasivo ? 'Aplicando...' : 'Aplicar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ MODAL PARA CONFIGURAR COLUMNAS EN GRID DE 3 COLUMNAS */}
      {modalColumnas && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '1000px', maxWidth: '95%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas</h3>
              <button onClick={() => setModalColumnas(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '24px' }}>Arrastra los campos para reordenarlos. Desmarca los que desees ocultar de la tabla principal y del reporte de Excel.</p>
            
            <ul style={{ 
              listStyle: 'none', padding: 0, margin: 0, maxHeight: '60vh', overflowY: 'auto', 
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' 
            }}>
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
                  <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} style={{ cursor: 'pointer', transform: 'scale(1.2)' }} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                </li>
              ))}
            </ul>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', borderTop: '1px solid #30363d', paddingTop: '16px' }}>
              <button onClick={() => setModalColumnas(false)} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ MODAL DE DETALLES RECONSTRUIDO */}
      {mttoViendo && (
        <div className="modal-overlay" style={{ zIndex: 1500 }}>
          <div className="form-card detail-card" style={{ maxWidth: '1000px', width: '100%', maxHeight: '90vh', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
            <div className="form-header" style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc' }}>Detalle de Gasto <span style={{ color: '#58a6ff' }}>{formatearFolio(mttoViendo)}</span></h2>
              <button onClick={() => setMttoViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            
            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '0 24px' }}>
              {tabsDetalle.map(tab => (<button key={tab.id} onClick={() => setPestañaDetalleActiva(tab.id)} style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent', color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer' }}>{tab.label}</button>))}
            </div>
            
            <div className="detail-content" style={{ padding: '24px', overflowY: 'auto' }}>
              
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
                   <div style={{gridColumn:'span 3'}}><label style={labelStyle}>DESCRIPCIÓN GENERAL</label><div style={boxStyle}>{mttoViendo.descripcion || mttoViendo.descripcionGeneral || '-'}</div></div>
                </div>
              )}

              {/* PESTAÑA 2: FINANZAS */}
              {pestañaDetalleActiva === 'finanzas' && (
                <div className="detail-grid-3">
                   <div style={{gridColumn: 'span 3'}}><label style={labelStyle}>PROVEEDOR</label><span style={valStyle}>{mttoViendo.proveedorNombre || mostrarDatoMapeado(mttoViendo.proveedorId, 'empresas')}</span></div>
                   <div style={{gridColumn: 'span 3'}}><label style={labelStyle}>TIPO DE SERVICIO</label>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                          {Array.isArray(mttoViendo.tipoServicioId) && mttoViendo.tipoServicioId.length > 0 
                          ? mttoViendo.tipoServicioId.map((idS: string) => (
                              <span key={idS} style={{ backgroundColor: '#21262d', padding: '4px 8px', borderRadius: '16px', fontSize: '0.85rem', border: '1px solid #30363d', color: '#c9d1d9' }}>
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

                   <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>

                   <div><label style={labelStyle}>IMPORTE (MONTO BASE)</label><span style={{color: '#58a6ff', fontWeight: 'bold', fontSize: '1.1rem'}}>{formatoMoneda(mttoViendo.importe)}</span></div>
                   <div><label style={labelStyle}>IVA (+)</label><span style={valStyle}>{formatoMoneda(mttoViendo.ivaMonto)} <span style={{fontSize:'0.8rem'}}>({mttoViendo.ivaPorcentaje || 0}%)</span></span></div>
                   <div></div>
                   
                   <div><label style={labelStyle}>RET IVA (-)</label><span style={{color: '#f85149'}}>{formatoMoneda(mttoViendo.retIva)}</span></div>
                   <div><label style={labelStyle}>RET ISR (-)</label><span style={{color: '#f85149'}}>{formatoMoneda(mttoViendo.retIsr)}</span></div>

                   <div style={{gridColumn:'span 3'}}><label style={{...labelStyle, color:'#3fb950'}}>TOTAL FINAL</label><span style={{fontSize:'1.8rem', fontWeight:'bold', color:'#3fb950'}}>{formatoMoneda(mttoViendo.total)}</span></div>
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
                          <a href={mttoViendo.archivoPdfUrl} target="_blank" rel="noreferrer" style={{color: '#58a6ff', textDecoration: 'underline'}}>Ver Documento</a>
                      ) : <span style={valStyle}>Sin archivo</span>}
                   </div>

                   <div><label style={labelStyle}>FECHA DE PAGO</label><span style={valStyle}>{mttoViendo.fechaPago || '-'}</span></div>
                   <div><label style={labelStyle}>FORMA DE PAGO</label><span style={valStyle}>{mostrarDatoMapeado(mttoViendo.formaPagoId, 'formasPago', 'forma_pago')}</span></div>
                   
                   <div><label style={labelStyle}>AUTORIZADO POR</label><span style={valStyle}>{mttoViendo.autorizadoPor || '-'}</span></div>
                   <div><label style={labelStyle}>ASIGNAR A OPERACIÓN</label><span style={valStyle}>{mostrarDatoMapeado(mttoViendo.operacionAsignadaId, 'operaciones', 'ref')}</span></div>

                   <div style={{gridColumn:'span 3'}}><label style={labelStyle}>OBSERVACIONES</label><div style={boxStyle}>{mttoViendo.observaciones || '-'}</div></div>
                </div>
              )}
            </div>
            
            <div style={{ padding: '16px 24px', textAlign: 'right', borderTop: '1px solid #30363d' }}>
              <button onClick={() => setMttoViendo(null)} className="btn btn-outline">Cerrar Detalles</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ NUEVO: panel lateral DERECHO de filtros (Gastos MTTO) */}
      {drawerFiltrosAbierto && (
        <div onClick={() => setDrawerFiltrosAbierto(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1400, backdropFilter: 'blur(2px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '360px', maxWidth: '92%', backgroundColor: '#0d1117', borderLeft: '1px solid #30363d', boxShadow: '-8px 0 28px rgba(0,0,0,0.5)', padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', zIndex: 1401, animation: 'fadeIn 0.15s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.05rem' }}>Filtros · Gastos MTTO</h3>
              <button onClick={() => setDrawerFiltrosAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#58a6ff', fontSize: '0.8rem', fontWeight: 'bold' }}>BÚSQUEDA</label>
              <div style={{ position: 'relative' }}>
                <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#58a6ff' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input type="text" placeholder="Folio, unidad, proveedor, montos, observaciones..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                  style={{ width: '100%', padding: '9px 10px 9px 32px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                {busqueda && (
                  <button onClick={() => setBusqueda('')} title="Limpiar" style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '0.95rem' }}>✕</button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>FECHA DESDE</label>
                <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', colorScheme: 'dark', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>FECHA HASTA</label>
                <input type="date" value={fechaHasta} min={fechaDesde || undefined} onChange={(e) => setFechaHasta(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', colorScheme: 'dark', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ color: '#6e7681', fontSize: '0.75rem' }}>
              Todos los campos son <b style={{ color: '#8b949e' }}>opcionales</b>. Presiona <b style={{ color: '#D84315' }}>Buscar</b> para ver los gastos.
            </div>

            <div style={{ marginTop: 'auto', display: 'flex', gap: '10px', borderTop: '1px solid #30363d', paddingTop: '14px' }}>
              <button onClick={() => { setBusqueda(''); setFechaDesde(''); setFechaHasta(''); setBusquedaHecha(false); }} style={{ flex: 1, padding: '10px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Limpiar</button>
              <button onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }} style={{ flex: 1, padding: '10px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>🔍 Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MttoDashboard;