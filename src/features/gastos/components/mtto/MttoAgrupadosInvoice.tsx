// src/features/gastos/components/mtto/MttoAgrupadosInvoice.tsx
import { useState, useEffect, useMemo } from 'react';
import { collection, query, getDocs, limit, orderBy } from 'firebase/firestore'; 
import { db } from '../../../../config/firebase';
// ✅ Logo incrustado (base64) usado en TODOS los PDF de la app: prioridad al logo
//    dinámico registrado con setLogoPdf() y respaldo al logo por defecto.
import { getLogoPdf, LOGO_DEFAULT } from '../../../../utils/pdfGenerator';
import './MttoAgrupadosInvoice.css';
import { almacenSesion } from '../../../../utils/cacheMemoria';

interface GastoMtto {
  id: string;
  numeroGasto: string;
  invoice: string;
  estatus: string;
  fecha: string;
  proveedorNombre?: string;
  proveedorId?: string;
  unidadId?: string;
  descripcion?: string;
  descripcionGeneral?: string;
  importe: number | string;
  ivaMonto: number | string;
  retIva: number | string;
  retIsr: number | string;
  total: number | string;
  [key: string]: any;
}

interface GrupoInvoice {
  invoice: string;
  gastos: GastoMtto[];
  sumaImporte: number;
  sumaIva: number;
  sumaRetIva: number;
  sumaRetIsr: number;
  sumaTotal: number;
  /** Fecha (timestamp) del gasto más reciente del grupo; ordena el historial. */
  tiempoReciente: number;
}

const MttoAgrupadosInvoice = () => {
  const [cargando, setCargando] = useState(true);
  const [gastosGlobales, setGastosGlobales] = useState<GastoMtto[]>([]);
  const [busqueda, setBusqueda] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + la vista arranca VACÍA hasta Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  // ✅ Filtro por rango de fechas (sobre el campo `fecha` del gasto)
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  // ✅ Catálogo de unidades para mostrar el NOMBRE de la unidad (no el ID) en
  //    la búsqueda y en el documento PDF. Se toma del caché compartido de la
  //    app (sessionStorage 'roelca_catalogos_v1') con respaldo a Firestore.
  const [unidadesCat, setUnidadesCat] = useState<any[]>([]);

  const [acordeonesAbiertos, setAcordeonesAbiertos] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const cargarUnidades = async () => {
      try {
        const cacheStr = almacenSesion.getItem('roelca_catalogos_v1');
        if (cacheStr) {
          const cache = JSON.parse(cacheStr);
          if (Array.isArray(cache?.unidades) && cache.unidades.length > 0) {
            setUnidadesCat(cache.unidades);
            return;
          }
        }
        const snap = await getDocs(collection(db, 'unidades'));
        setUnidadesCat(snap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error('Error al cargar catálogo de unidades:', error);
      }
    };
    cargarUnidades();
  }, []);

  const mostrarNombreUnidad = (unidadValor: any): string => {
    if (!unidadValor) return '-';
    if (unidadValor === 'Oficina') return 'Oficina';
    const uni = unidadesCat.find((u: any) => u.id === unidadValor);
    if (uni) return uni.unidad || uni.numeroEconomico || uni.nombre || String(unidadValor);
    return String(unidadValor);
  };

  useEffect(() => {
    const cargarGastos = async () => {
      setCargando(true);
      try {
        // ✅ Mismo fix que el dashboard: sin orderBy, limit(500) traía 500 docs
        //    por ID aleatorio y los gastos nuevos podían no aparecer.
        const q = query(collection(db, 'gastos_mtto'), orderBy('createdAt', 'desc'), limit(500));
        const snap = await getDocs(q);
        
        let data = snap.docs.map(d => {
          const rawData = d.data();
          const tieneInvoice = rawData.invoice && String(rawData.invoice).trim() !== '';
          return { 
            id: d.id, 
            ...rawData, 
            estatus: tieneInvoice ? 'Facturado' : 'No facturado' 
          } as GastoMtto;
        });

        // ✅ ORDEN: más recientes primero por el campo `fecha` (respaldo createdAt
        //    y, en empate, la fecha codificada en el folio).
        const tiempoDe = (g: GastoMtto): number => {
          const m = String(g.fecha || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (m) return parseInt(`${m[1]}${m[2]}${m[3]}`, 10) * 1000000;
          const mc = String(g.createdAt || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (mc) return parseInt(`${mc[1]}${mc[2]}${mc[3]}`, 10) * 1000000;
          return 0;
        };
        const parseGasto = (str: string) => {
          if (!str) return 0;
          const match = String(str).match(/[A-Za-z]+-(\d{2})(\d{2})(\d{4})-(\d+)/);
          if (match) {
              const [ , mm, dd, yyyy, seq ] = match;
              return parseInt(`${yyyy}${mm}${dd}${seq.padStart(4, '0')}`, 10);
          }
          return 0;
        };

        data.sort((a, b) => {
          const tA = tiempoDe(a);
          const tB = tiempoDe(b);
          if (tA !== tB) return tB - tA;

          const valA = parseGasto(a.numeroGasto);
          const valB = parseGasto(b.numeroGasto);
          if (valA !== valB) return valB - valA;

          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : new Date(a.fecha || 0).getTime();
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : new Date(b.fecha || 0).getTime();
          return dateB - dateA;
        });

        setGastosGlobales(data);
      } catch (error) {
        console.error("Error al cargar gastos para agrupación:", error);
      }
      setCargando(false);
    };
    cargarGastos();
  }, []);

  // ✅ Texto buscable: TODOS los campos del gasto (incluye anidados) más el
  //    nombre resuelto de la unidad.
  const textoBuscableDe = (g: GastoMtto): string => {
    const partes: string[] = [];
    const agregar = (v: any) => {
      if (v === undefined || v === null) return;
      if (Array.isArray(v)) { v.forEach(agregar); return; }
      if (typeof v === 'object') { Object.values(v).forEach(agregar); return; }
      partes.push(String(v));
    };
    Object.values(g).forEach(agregar);
    partes.push(mostrarNombreUnidad(g.unidadId || (g as any).unidad));
    return partes.join(' ').toLowerCase();
  };

  const gruposFacturados = useMemo(() => {
    const gruposMapa: Record<string, GrupoInvoice> = {};
    const b = busqueda.trim().toLowerCase();

    const gastosFiltrados = gastosGlobales.filter(g => {
      // 1) Filtro por rango de fechas (campo `fecha`, respaldo `createdAt`)
      const fechaISO = String(g.fecha || g.createdAt || '').slice(0, 10);
      if (fechaDesde && (!fechaISO || fechaISO < fechaDesde)) return false;
      if (fechaHasta && (!fechaISO || fechaISO > fechaHasta)) return false;
      // 2) Búsqueda en cada campo de la colección
      if (!b) return true;
      return textoBuscableDe(g).includes(b);
    });

    const tiempoDe = (g: GastoMtto): number => {
      const t = new Date(String(g.fecha || g.createdAt || 0)).getTime();
      return isNaN(t) ? 0 : t;
    };

    gastosFiltrados.forEach(gasto => {
      const invoiceKey = gasto.invoice?.trim() ? gasto.invoice.trim() : 'SIN INVOICE (No Facturados)';
      
      if (!gruposMapa[invoiceKey]) {
        gruposMapa[invoiceKey] = {
          invoice: invoiceKey,
          gastos: [],
          sumaImporte: 0,
          sumaIva: 0,
          sumaRetIva: 0,
          sumaRetIsr: 0,
          sumaTotal: 0,
          tiempoReciente: 0
        };
      }

      gruposMapa[invoiceKey].gastos.push(gasto);
      gruposMapa[invoiceKey].sumaImporte += Number(gasto.importe) || 0;
      gruposMapa[invoiceKey].sumaIva += Number(gasto.ivaMonto) || 0;
      gruposMapa[invoiceKey].sumaRetIva += Number(gasto.retIva) || 0;
      gruposMapa[invoiceKey].sumaRetIsr += Number(gasto.retIsr) || 0;
      gruposMapa[invoiceKey].sumaTotal += Number(gasto.total) || 0;
      gruposMapa[invoiceKey].tiempoReciente = Math.max(gruposMapa[invoiceKey].tiempoReciente, tiempoDe(gasto));
    });

    // ✅ ORDEN DEL HISTORIAL: grupos con el gasto más reciente primero.
    //    "SIN INVOICE" siempre al final. Empate: por número de invoice.
    return Object.values(gruposMapa).sort((a, b) => {
      if (a.invoice.includes('SIN INVOICE')) return 1; 
      if (b.invoice.includes('SIN INVOICE')) return -1;
      if (a.tiempoReciente !== b.tiempoReciente) return b.tiempoReciente - a.tiempoReciente;
      return b.invoice.localeCompare(a.invoice); 
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gastosGlobales, busqueda, fechaDesde, fechaHasta, unidadesCat]);

  const toggleAcordeon = (invoiceKey: string) => {
    setAcordeonesAbiertos(prev => ({
      ...prev,
      [invoiceKey]: !prev[invoiceKey]
    }));
  };

  const formatoMoneda = (monto: number | string) => {
    const num = Number(monto) || 0;
    return `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatearFechaEspañol = (fechaStr: string | Date) => {
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const d = new Date(fechaStr);
    if (isNaN(d.getTime())) return String(fechaStr); 
    const dUTC = new Date(d.getTime() + d.getTimezoneOffset() * 60000); 
    return `${dUTC.getDate()} de ${meses[dUTC.getMonth()]} de ${dUTC.getFullYear()}`;
  };

  // ✅ ESCAPA CARACTERES HTML PARA EVITAR QUE EL CONTENIDO ROMPA EL DOCUMENTO
  const escaparHTML = (texto: any) => {
    return String(texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // ✅ RESPETA LOS SALTOS DE LÍNEA DE LA DESCRIPCIÓN EN EL PDF (\n -> <br>)
  const formatearTextoMultilinea = (texto: any) => {
    if (texto === undefined || texto === null || String(texto).trim() === '') return '-';
    return escaparHTML(texto).replace(/\r\n|\r|\n/g, '<br>');
  };

  const handleGenerarDocumento = (grupo: GrupoInvoice) => {
    let filasHTML = '';
    
    grupo.gastos.forEach(g => {
      const fechaFmt = formatearFechaEspañol(g.fecha);
      const descripcionFmt = formatearTextoMultilinea(g.descripcion || g.descripcionGeneral);
      filasHTML += `
        <tr>
          <td class="text-center">${g.numeroGasto || '-'}</td>
          <td class="text-center" style="text-transform: capitalize;">${fechaFmt}</td>
          <td class="text-center">${escaparHTML(mostrarNombreUnidad(g.unidadId || (g as any).unidad))}</td>
          <td class="col-desc">${descripcionFmt}</td>
          <td class="text-right">${formatoMoneda(g.total)}</td>
        </tr>
      `;
    });

    const primerGasto = grupo.gastos[0] || {};
    const proveedorNum = primerGasto.proveedorId || "N/A";
    const razonSocial = primerGasto.proveedorNombre || "VARIOS";
    const rfc = primerGasto.estatus || "FACTURADO";
    const fechaActual = formatearFechaEspañol(new Date());

    // ✅ Logo: primero el registrado dinámicamente (setLogoPdf), si no, el logo
    //    por defecto incrustado en base64 — así el logo aparece SIEMPRE.
    const logoBase64 = getLogoPdf() || LOGO_DEFAULT;

    const htmlDocument = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Relación de Compras - ${grupo.invoice}</title>
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
          /* La descripción respeta saltos de línea y ajusta palabras largas */
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
                <td class="col-label"># PROVEEDOR</td><td class="col-value">${proveedorNum}</td>
                <td class="col-label">RAZON SOCIAL:</td><td class="col-value">${razonSocial}</td>
                <td class="col-label">DENOMINACION:</td><td class="col-value">${grupo.invoice}</td>
              </tr>
              <tr>
                <td class="col-label">TIPO:</td><td class="col-value">${rfc}</td>
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
              <td><div class="amount-box"><span>$</span> <span>${grupo.sumaImporte.toFixed(2)}</span></div></td>
            </tr>
            <tr>
              <td class="no-internal-borders middle-empty" colspan="4"> </td>
              <td><div class="amount-box"><span>$</span> <span>${grupo.sumaIva.toFixed(2)}</span></div></td>
            </tr>
            <tr>
              <td class="no-internal-borders last-empty" colspan="4"> </td>
              <td><div class="amount-box"><span>$</span> <span>${grupo.sumaTotal.toFixed(2)}</span></div></td>
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
      alert("Por favor, permite las ventanas emergentes (pop-ups) en tu navegador para generar el PDF.");
    }
  };

  return (
    <div className="mai-x1">
      <div className="mai-x2">
        <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${(busqueda || fechaDesde || fechaHasta) ? '#3fb950' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
          Filtros
          {(busqueda || fechaDesde || fechaHasta) && <span className="mai-x3">{[busqueda, fechaDesde || fechaHasta].filter(Boolean).length}</span>}
        </button>
        {(fechaDesde || fechaHasta) && (
          <span className="mai-x4">
            {(fechaDesde || '…')} → {(fechaHasta || '…')}
            <button className="mai-x5" onClick={() => { setFechaDesde(''); setFechaHasta(''); }}>✕</button>
          </span>
        )}
        {busqueda && (
          <span className="mai-x6">
            "{busqueda}"
            <button className="mai-x7" onClick={() => setBusqueda('')}>✕</button>
          </span>
        )}
        <div className="mai-x8">
          {busquedaHecha ? `${gruposFacturados.length} Grupos Encontrados` : 'Presiona Filtros y Buscar para consolidar los Invoices.'}
        </div>
      </div>

      {!busquedaHecha ? (
        <div className="mai-x9">
          <div className="mai-x10">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
            <span className="mai-x11">Define tus filtros y presiona <b className="mai-x12">Buscar</b> para ver los grupos por Invoice.</span>
            <button className="mai-x13" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
          </div>
        </div>
      ) : cargando ? (
        <div className="mai-x14">
          Procesando consolidación de Invoices...
        </div>
      ) : gruposFacturados.length === 0 ? (
        <div className="mai-x15">
          No se encontraron gastos para la búsqueda especificada.
        </div>
      ) : (
        <div className="mai-x16">
          {gruposFacturados.map((grupo) => {
            const isSinInvoice = grupo.invoice.includes('SIN INVOICE');
            const isAbierto = acordeonesAbiertos[grupo.invoice] || false;

            return (
              <div key={grupo.invoice} style={{ backgroundColor: '#0d1117', borderRadius: '8px', border: isSinInvoice ? '1px dashed #30363d' : '1px solid #3fb950', overflow: 'hidden', transition: 'all 0.3s ease' }}>
                
                <div 
                  onClick={() => toggleAcordeon(grupo.invoice)}
                  style={{ padding: '16px 24px', backgroundColor: isSinInvoice ? '#161b22' : 'rgba(63, 185, 80, 0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none', flexWrap: 'wrap', gap: '16px' }}
                >
                  <div className="mai-x17">
                    <div style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e', transform: isAbierto ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
                      ▶
                    </div>
                    <div>
                      <h2 style={{ margin: 0, fontSize: '1.2rem', color: isSinInvoice ? '#8b949e' : '#f0f6fc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {isSinInvoice ? 'Gastos Pendientes de Facturar' : `Invoice: ${grupo.invoice}`}
                        <span className="mai-x18">
                          {grupo.gastos.length} Items
                        </span>
                      </h2>
                    </div>
                  </div>

                  <div className="mai-x19">
                    <div className="mai-x20">
                      <div className="mai-x21">
                        <span className="mai-x22">Suma Importe</span>
                        <span className="mai-x23">{formatoMoneda(grupo.sumaImporte)}</span>
                      </div>
                      <div className="mai-x21">
                        <span className="mai-x22">Suma IVA</span>
                        <span className="mai-x23">{formatoMoneda(grupo.sumaIva)}</span>
                      </div>
                      <div className="mai-x21">
                        <span className="mai-x22">Total Consolidado</span>
                        <span style={{ color: isSinInvoice ? '#c9d1d9' : '#3fb950', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(grupo.sumaTotal)}</span>
                      </div>
                    </div>

                    {!isSinInvoice && (
                      <button className="mai-x24" 
                        onClick={(e) => { e.stopPropagation(); handleGenerarDocumento(grupo); }}
                        onMouseEnter={(e:any) => e.currentTarget.style.backgroundColor = '#2ea043'}
                        onMouseLeave={(e:any) => e.currentTarget.style.backgroundColor = '#238636'}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                        Generar Doc
                      </button>
                    )}
                  </div>
                </div>

                {/* VISTA SIMPLIFICADA: SOLO REFERENCIAS (# DE GASTO) */}
                {isAbierto && (
                  <div style={{ borderTop: isSinInvoice ? '1px solid #30363d' : '1px solid rgba(63, 185, 80, 0.2)', padding: '16px' }}>
                    <span className="mai-x25">
                      Gastos incluidos en este Invoice:
                    </span>
                    <div className="mai-x26">
                      {grupo.gastos.map(g => (
                        <span className="mai-x27" 
                          key={g.id} 
                          title={`Importe Base: ${formatoMoneda(g.importe)} | Proveedor: ${g.proveedorNombre || 'N/A'}`}
                        >
                          {g.numeroGasto || '-'}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            );
          })}
        </div>
      )}

      {/* NUEVO: panel lateral DERECHO de filtros (Agrupados por Invoice) */}
      {drawerFiltrosAbierto && (
        <div className="mai-x28" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="mai-x29" onClick={(e) => e.stopPropagation()}>
            <div className="mai-x30">
              <h3 className="mai-x31">Filtros · Agrupados por Invoice</h3>
              <button className="mai-x32" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="mai-x33">
              <label className="mai-x34">BÚSQUEDA</label>
              <div className="mai-x35">
                <svg className="mai-x36" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="mai-x37" type="text" placeholder="Invoice, folio, unidad, proveedor..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="mai-x38" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            <div className="mai-x39">
              <div className="mai-x40">
                <label className="mai-x41">FECHA DESDE</label>
                <input className="mai-x42" type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
              </div>
              <div className="mai-x40">
                <label className="mai-x41">FECHA HASTA</label>
                <input className="mai-x42" type="date" value={fechaHasta} min={fechaDesde || undefined} onChange={(e) => setFechaHasta(e.target.value)} />
              </div>
            </div>

            <div className="mai-x43">
              Todos los campos son <b className="mai-x44">opcionales</b>. Presiona <b className="mai-x12">Buscar</b> para consolidar los Invoices.
            </div>

            <div className="mai-x45">
              <button className="mai-x46" onClick={() => { setBusqueda(''); setFechaDesde(''); setFechaHasta(''); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="mai-x47" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MttoAgrupadosInvoice;