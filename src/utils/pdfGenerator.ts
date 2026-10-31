// src/utils/pdfGenerator.ts
// ✅ V00452: html2pdf (~1 MB con jsPDF y html2canvas) se carga al generar el PDF, no al arrancar la
//   app: este archivo lo importa el inicio de sesión (LOGO_DEFAULT) y lo metía en la carga inicial.
import { cargarHtml2pdf } from '../shared/utils/pdf'; // ✅ V00534: el cargador único
import { aNumero } from '../shared/dominio/numeros'; // ✅ V00535

// ============================================================================
// LOGO DE LA EMPRESA PARA LOS PDF
// ----------------------------------------------------------------------------
// El logo se toma de la configuración de la empresa (useEmpresaConfig -> config.logoUrl).
// Para que html2pdf/html2canvas lo dibuje de forma confiable (sin problemas de
// CORS al "tintar" el canvas), se incrusta como dataURL (base64).
//
// Flujo:
//   1) En cada módulo que genera PDFs (OperacionesDashboard, ServiciosCancelados,
//      ServiciosCompletados) se precarga el logo una sola vez con cargarLogoDataUrl()
//      y se registra con setLogoPdf(base64).
//   2) Cada generador usa, por orden de prioridad:
//        datos.logoBase64  ->  LOGO_PDF_GLOBAL  ->  '' (sin logo, sin recuadro roto)
// ============================================================================

// ✅ V00534: el logo es un ARCHIVO (public/logo-roelca.png) y escapar HTML es un util propio; aquí se
//   reexportan para no romper imports. El logo en base64 (140 KB) ya no vive en este archivo: el inicio de
//   sesión lo importaba y metía todo pdfGenerator (~115 KB gz) en la carga de arranque.
import { cargarLogoDataUrl, getLogoPdf, logoPdfPorDefecto, setLogoPdf } from '../shared/utils/logo';
import { escaparHTML, escaparTextos } from '../shared/utils/html';

export { cargarLogoDataUrl, escaparHTML, escaparTextos, getLogoPdf, setLogoPdf };

/** Resuelve el logo a usar en un documento concreto. */
const resolverLogo = (logoBase64?: string) => logoBase64 || logoPdfPorDefecto(); // ✅ V00534

// ============================================================================
// 1. SOLICITUD DE RETIRO
// ============================================================================
export interface DatosSolicitudRetiro {
  bodegaNombre: string;
  tipoMovimiento: string;
  remolqueNombre: string;
  remolquePlacas: string;
  clienteMercancia: string;
  unidadNombre: string;
  unidadPlacas: string;
  empleadoNombre: string;
  destinoNombre: string;
  destinoDireccion: string;
  logoBase64?: string; 
}

export const generarSolicitudRetiroPDF = (datosCrudos: DatosSolicitudRetiro) => {
  const datos = escaparTextos(datosCrudos); // ✅ V00448
  const opcionesFecha: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
  const fechaActual = new Date().toLocaleDateString('es-ES', opcionesFecha);
  const fechaOficial = `Nuevo Laredo, Tamaulipas, México a ${fechaActual}`;

  const logoSrc = resolverLogo(datos.logoBase64);
  const logoWatermark = logoSrc
    ? `<div style="position: absolute; top: 55%; left: 50%; transform: translate(-50%, -50%); opacity: 0.12; z-index: 1;"><img src="${logoSrc}" style="width: 550px; height: auto;" /></div>`
    : '';
  const logoHeader = logoSrc
    ? `<div style="position: absolute; top: 20px; left: 25px; width: 120px;"><img src="${logoSrc}" style="width: 100%;" /></div>`
    : '';

  const htmlTemplate = `
    <div style="width: 100%; height: 100%; position: relative; font-family: Arial, sans-serif; font-size: 12px; color: #000; padding: 20px; box-sizing: border-box; background-color: #fff;">
      ${logoWatermark}
      <div style="width: 100%; max-width: 750px; margin: 0 auto; border: 1px solid #ccc; padding: 35px; position: relative; z-index: 10; box-sizing: border-box;">
        ${logoHeader}
        <div style="text-align: center; margin-bottom: 25px;">
          <div style="font-size: 24px; font-weight: bold; color: #0070C0; text-transform: uppercase; margin-bottom: 5px;">SOLICITUD DE RETIRO</div>
          <div style="font-size: 18px; font-weight: bold; color: #0070C0;">ROELCAINC SA DE CV</div>
          <div style="font-size: 14px; font-weight: bold; color: #F37021;">DIVISION TRANSFER</div>
          <div style="font-size: 12px;">www.roelca.com</div>
        </div>
        <div style="border-top: 2px solid #0070C0; margin: 25px 0;"></div>
        <div style="text-align: right; margin-bottom: 25px; font-weight: bold; font-size: 12px;">${fechaOficial}</div>
        <div style="font-size: 19px; font-weight: bold; color: #F37021; text-align: center; margin-bottom: 30px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
          ${datos.bodegaNombre}
        </div>
        <p style="margin-bottom: 20px; font-size: 12px;">
          Por medio de la presente solicitamos su autorización para retirar el semiremolque con carga de <b>${datos.tipoMovimiento}</b>:
        </p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <tr>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 35%; color: #0070C0; text-transform: uppercase; font-size: 10px;"># de Remolque</td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-size: 12px;">${datos.remolqueNombre}</td>
          </tr>
          <tr>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 35%; color: #0070C0; text-transform: uppercase; font-size: 10px;">Num. De Placas</td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-size: 12px;">${datos.remolquePlacas}</td>
          </tr>
          <tr>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 35%; color: #0070C0; text-transform: uppercase; font-size: 10px;">Cliente (Mercancía)</td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-size: 12px;">${datos.clienteMercancia}</td>
          </tr>
          <tr>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 35%; color: #0070C0; text-transform: uppercase; font-size: 10px;">Tractor / Placas</td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-size: 12px;">${datos.unidadNombre} / ${datos.unidadPlacas}</td>
          </tr>
          <tr>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 35%; color: #0070C0; text-transform: uppercase; font-size: 10px;">Operador</td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-size: 12px;">${datos.empleadoNombre}</td>
          </tr>
          <tr>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 35%; color: #0070C0; text-transform: uppercase; font-size: 10px;">Destino</td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-size: 12px;">${datos.destinoNombre}</td>
          </tr>
          <tr>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 35%; color: #0070C0; text-transform: uppercase; font-size: 10px;">Dirección</td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-size: 12px;">${datos.destinoDireccion}</td>
          </tr>
        </table>
        <div style="margin-top: 100px; border-top: 2px solid #0070C0; padding-top: 12px; text-align: center; font-weight: bold; width: 250px; margin: 100px auto 0 auto; font-size: 13px;">
          FIRMA Y SELLO
        </div>
      </div>
    </div>
  `;

  const elementoTemporal = document.createElement('div');
  elementoTemporal.innerHTML = htmlTemplate;
  document.body.appendChild(elementoTemporal);

  const nombreRemolqueLimpio = datos.remolqueNombre.replace(/\W/g, '_');
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const filename = `Solicitud_${nombreRemolqueLimpio}_${timestamp}.pdf`;

  const opt = {
    margin:       0,
    filename:     filename,
    image:        { type: 'jpeg' as const, quality: 0.98 }, 
    html2canvas:  { backgroundColor: '#ffffff', scale: 2, useCORS: true },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' as const } 
  };

  // ✅ Esperar a que TODAS las imágenes (incluido el logo) terminen de decodificar
  // ANTES de generar el PDF. html2pdf/html2canvas "fotografía" el HTML, y si la
  // imagen aún no cargó, la omite (ese era el motivo de que el logo no apareciera).
  (async () => {
    const _imgs = Array.from(elementoTemporal.querySelectorAll('img')) as HTMLImageElement[];
    await Promise.all(_imgs.map(im => (im.complete && im.naturalWidth > 0)
      ? Promise.resolve()
      : new Promise<void>(res => { im.onload = () => res(); im.onerror = () => res(); })));
    try {
      const html2pdf = await cargarHtml2pdf();
      await html2pdf().set(opt).from(elementoTemporal).save();
    } catch (e) {
      // ✅ V00452: antes el error se perdía (y ahora también puede fallar la carga del generador).
      console.error('[PDF] No se pudo generar:', e);
      alert('No se pudo generar el PDF. Revisa la conexión e intenta de nuevo.');
    } finally {
      if (elementoTemporal.parentNode) document.body.removeChild(elementoTemporal);
    }
  })();
};

// ============================================================================
// 2. INSTRUCCIONES DEL SERVICIO
// ============================================================================
export interface DatosInstruccionesServicio {
  consecutivo: string;
  fecha: string;
  unidadNombre: string;
  empleadoNombre: string;
  remolqueNombre: string;
  remolquePlacas: string;
  tipoOperacion: string;
  origenNombre: string;
  origenDireccion: string;
  clienteMercancia: string;
  destinoNombre: string;
  destinoDireccion: string;
  logoBase64?: string;
}

export const generarInstruccionesServicioPDF = (datosCrudos: DatosInstruccionesServicio) => {
  const datos = escaparTextos(datosCrudos); // ✅ V00448
  
  let fechaFormateada = datos.fecha;
  if (datos.fecha) {
    const [year, month, day] = datos.fecha.split('-');
    const dateObj = new Date(Number(year), Number(month) - 1, Number(day));
    const opcionesFecha: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
    fechaFormateada = dateObj.toLocaleDateString('es-ES', opcionesFecha);
  }

  const logoSrc = resolverLogo(datos.logoBase64);
  const logoHeader = logoSrc
    ? `<div style="text-align: left; margin-bottom: 8px;"><img src="${logoSrc}" style="max-width: 130px; height: auto;" /></div>`
    : '';

  const htmlTemplate = `
    <div style="width: 100%; max-width: 800px; margin: 0 auto; font-family: Arial, sans-serif; font-size: 16px; color: #000; background-color: #fff; padding: 20px; box-sizing: border-box;">
      ${logoHeader}
      <div style="text-align: center; font-size: 18px; font-weight: bold; color: #F37021; padding: 10px 0; margin-bottom: 10px;">
        INSTRUCCIONES DEL SERVICIO
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
        <tr>
          <td style="font-weight: bold; color: #0070C0; width: 50%;">Referencia:</td>
          <td style="text-align: right; width: 50%;">
            <span style="border: 1px solid #000; padding: 3px 8px; background-color: #f0f0f0; font-weight: bold;">
              ${datos.consecutivo}
            </span>
          </td>
        </tr>
        <tr>
          <td style="font-weight: bold; color: #0070C0; padding-top: 5px;">Fecha:</td>
          <td style="text-align: right; padding-top: 5px;"><strong>${fechaFormateada}</strong></td>
        </tr>
      </table>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
        <tr>
          <td style="font-weight: bold; color: #0070C0; width: 25%;"></td>
          <td style="font-weight: bold; color: #0070C0; width: 25%;">Unidad</td>
          <td style="font-weight: bold; color: #0070C0; width: 50%;">Operador</td>
        </tr>
        <tr>
          <td style="width: 25%;"></td>
          <td style="font-weight: bold; width: 25%;">${datos.unidadNombre}</td>
          <td style="font-weight: bold; width: 50%;">${datos.empleadoNombre}</td>
        </tr>
      </table>
      <table style="width: 100%; border-collapse: collapse; margin-top: 5px; margin-bottom: 10px;">
        <tr>
          <td style="font-weight: bold; color: #F37021; width: 25%; padding: 4px 0;"># de Remolque:</td>
          <td style="font-weight: bold; width: 25%; padding: 4px 0;">${datos.remolqueNombre}</td>
          <td style="font-weight: bold; color: #F37021; width: 25%; padding: 4px 0;">Placas:</td>
          <td style="font-weight: bold; width: 25%; padding: 4px 0;">${datos.remolquePlacas}</td>
        </tr>
        <tr>
          <td style="font-weight: bold; color: #F37021; padding: 4px 0;">Tipo de Operación:</td>
          <td colspan="3" style="font-weight: bold; padding: 4px 0;">${datos.tipoOperacion}</td>
        </tr>
      </table>
      <div style="border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 8px 0; margin: 10px 0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="font-weight: bold; width: 30%; padding: 2px 0;">Origen:</td>
            <td style="padding: 2px 0;">${datos.origenNombre}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; width: 30%; padding: 2px 0;">Dirección:</td>
            <td style="padding: 2px 0;">${datos.origenDireccion}</td>
          </tr>
        </table>
      </div>
      <div style="margin-top: 5px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="font-weight: bold; width: 30%; padding: 2px 0;">Destino:</td>
            <td style="padding: 2px 0;">${datos.destinoNombre}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; width: 30%; padding: 2px 0;">Dirección:</td>
            <td style="padding: 2px 0;">${datos.destinoDireccion}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; color: #F37021; padding-top: 10px;">Cliente/Contacto:</td>
            <td style="font-weight: bold; padding-top: 10px;">${datos.clienteMercancia}</td>
          </tr>
        </table>
      </div>
    </div>
  `;

  const elementoTemporal = document.createElement('div');
  elementoTemporal.innerHTML = htmlTemplate;
  document.body.appendChild(elementoTemporal);

  const consecutivoLimpio = (datos.consecutivo || "Doc").replace(/\W/g, '_');
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const filename = `Servicio_${consecutivoLimpio}_${timestamp}.pdf`;

  const opt = {
    margin:       10, 
    filename:     filename,
    image:        { type: 'jpeg' as const, quality: 0.98 }, 
    html2canvas:  { backgroundColor: '#ffffff', scale: 2, useCORS: true },
    jsPDF:        { unit: 'mm', format: 'letter', orientation: 'portrait' as const } 
  };

  // ✅ Esperar a que TODAS las imágenes (incluido el logo) terminen de decodificar
  // ANTES de generar el PDF. html2pdf/html2canvas "fotografía" el HTML, y si la
  // imagen aún no cargó, la omite (ese era el motivo de que el logo no apareciera).
  (async () => {
    const _imgs = Array.from(elementoTemporal.querySelectorAll('img')) as HTMLImageElement[];
    await Promise.all(_imgs.map(im => (im.complete && im.naturalWidth > 0)
      ? Promise.resolve()
      : new Promise<void>(res => { im.onload = () => res(); im.onerror = () => res(); })));
    try {
      const html2pdf = await cargarHtml2pdf();
      await html2pdf().set(opt).from(elementoTemporal).save();
    } catch (e) {
      // ✅ V00452: antes el error se perdía (y ahora también puede fallar la carga del generador).
      console.error('[PDF] No se pudo generar:', e);
      alert('No se pudo generar el PDF. Revisa la conexión e intenta de nuevo.');
    } finally {
      if (elementoTemporal.parentNode) document.body.removeChild(elementoTemporal);
    }
  })();
};

// ============================================================================
// 3. CHECK LIST ENTREGA DE DOCUMENTOS
// ============================================================================
export interface DatosCheckList {
  consecutivo: string;
  fecha: string;
  cliente: string;
  remolque: string;
  proveedor: string;
  tractorInfo: string;
  numeroPedimento: string;
  prefileEntrys: string;
  entryReferencia: string;
  manifiesto: string;
  origenNombre: string;
  origenDireccion: string;
  destinoNombre: string;
  destinoDireccion: string;
  operadorNombre: string;
  supervisor: string;
  logoBase64?: string;
}

export const generarCheckListPDF = (datosCrudos: DatosCheckList) => {
  const datos = escaparTextos(datosCrudos); // ✅ V00448
  let fechaFormateada = datos.fecha;
  if (datos.fecha) {
    const [year, month, day] = datos.fecha.split('-');
    const dateObj = new Date(Number(year), Number(month) - 1, Number(day));
    const opcionesFecha: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
    fechaFormateada = dateObj.toLocaleDateString('es-ES', opcionesFecha);
  }

  const logoSrc = resolverLogo(datos.logoBase64);
  const logoHeader = logoSrc
    ? `<img src="${logoSrc}" style="position: absolute; top: 15px; left: 20px; max-height: 90px; width: 110px;" />`
    : '';

  const htmlTemplate = `
    <div style="width: 100%; max-width: 800px; margin: 0 auto; border: 1px solid #ccc; padding: 20px; position: relative; font-family: Arial, sans-serif; font-size: 14px; color: #000; line-height: 1.15; background-color: #fff; box-sizing: border-box;">
      ${logoHeader}
      
      <div style="text-align: right; margin-bottom: 2px;">
        <span style="border: 1px solid #000; padding: 2px 10px; background-color: #f0f0f0; font-weight: bold; font-size: 13px; display: inline-block; min-width: 40px; text-align: center;">${datos.consecutivo}</span>
      </div>
      <div style="text-align: right; font-weight: bold; margin-bottom: 15px; font-size: 14px;">
        Nuevo Laredo, Tamaulipas, México a ${fechaFormateada}
      </div>
      
      <h1 style="text-align: center; font-size: 16px; font-weight: bold; color: #0070C0; margin: 0 0 10px 0; text-transform: uppercase;">CHECK LIST ENTREGA DE DOCUMENTOS</h1>
      
      <div style="margin-bottom: 10px; text-align: justify; font-size: 14px;">
        Este documento certifica la revisión y entrega de documentos por parte del Despachador al Operador, asumiendo el Operador la responsabilidad sobre cualquier cargo o multa causada por la falta u omisión de alguna información contenida en los documentos recibidos.
      </div>
      
      <div style="font-weight: bold; color: #F37021; margin-top: 10px; margin-bottom: 2px; text-transform: uppercase; font-size: 13px;">Cliente</div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
        <tr><td style="width: 30%; border: 1px solid #000; padding: 4px 6px;"><strong>Cliente</strong></td><td style="border: 1px solid #000; padding: 4px 6px;">${datos.cliente}</td></tr>
        <tr><td style="border: 1px solid #000; padding: 4px 6px;"><strong>Remolque #</strong></td><td style="border: 1px solid #000; padding: 4px 6px;">${datos.remolque}</td></tr>
        <tr><td style="border: 1px solid #000; padding: 4px 6px;"><strong>Proveedor</strong></td><td style="border: 1px solid #000; padding: 4px 6px;">${datos.proveedor}</td></tr>
        <tr><td style="border: 1px solid #000; padding: 4px 6px;"><strong>Tractor / Placas / Operador</strong></td><td style="border: 1px solid #000; padding: 4px 6px;">${datos.tractorInfo}</td></tr>
      </table>
      
      <div style="font-weight: bold; color: #F37021; margin-top: 10px; margin-bottom: 2px; text-transform: uppercase; font-size: 13px;">Relación de Pedimentos</div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
        <tr><td style="padding: 2px 10px; border: none;"><span style="font-size: 20px; font-weight: bold; margin-right: 5px; line-height: 1;">☐</span> # DODA: ${datos.numeroPedimento}</td></tr>
        <tr><td style="padding: 2px 10px; border: none;"><span style="font-size: 20px; font-weight: bold; margin-right: 5px; line-height: 1;">☐</span> Prefile & Entry's: ${datos.prefileEntrys}</td></tr>
        <tr><td style="padding: 2px 10px; border: none;"><span style="font-size: 20px; font-weight: bold; margin-right: 5px; line-height: 1;">☐</span> Entry's Declarados: ${datos.entryReferencia}</td></tr>
        <tr><td style="padding: 2px 10px; border: none;"><span style="font-size: 20px; font-weight: bold; margin-right: 5px; line-height: 1;">☐</span> E-Manifiest: ${datos.manifiesto}</td></tr>
        <tr><td style="padding: 2px 10px; border: none;"><span style="font-size: 20px; font-weight: bold; margin-right: 5px; line-height: 1;">☐</span> Solicitud de Retiro: ${datos.origenNombre}</td></tr>
        <tr><td style="padding: 2px 10px; border: none;"><span style="font-size: 20px; font-weight: bold; margin-right: 5px; line-height: 1;">☐</span> Visa / Fast </td></tr>
      </table>
      
      <div style="font-weight: bold; color: #F37021; margin-top: 10px; margin-bottom: 2px; text-transform: uppercase; font-size: 13px;">Origen</div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
        <tr><td style="width: 30%; border: 1px solid #000; padding: 4px 6px;"><strong>Origen</strong></td><td style="border: 1px solid #000; padding: 4px 6px;">${datos.origenNombre}</td></tr>
        <tr><td style="border: 1px solid #000; padding: 4px 6px;"><strong>Dirección</strong></td><td style="border: 1px solid #000; padding: 4px 6px;">${datos.origenDireccion}</td></tr>
      </table>
      
      <div style="font-weight: bold; color: #F37021; margin-top: 10px; margin-bottom: 2px; text-transform: uppercase; font-size: 13px;">Destino</div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
        <tr><td style="width: 30%; border: 1px solid #000; padding: 4px 6px;"><strong>Destino</strong></td><td style="border: 1px solid #000; padding: 4px 6px;">${datos.destinoNombre}</td></tr>
        <tr><td style="border: 1px solid #000; padding: 4px 6px;"><strong>Dirección</strong></td><td style="border: 1px solid #000; padding: 4px 6px;">${datos.destinoDireccion}</td></tr>
      </table>
      
      <div style="margin-top: 10px; margin-bottom: 10px; text-align: justify; font-size: 14px;">
        Declaro haber revisado que coincida la Relación de Pedimentos con la cantidad y números de Pedimento, así como que la cantidad de Entry's coincida con lo declarado en el Manifiesto.
      </div>
      
      <div style="margin-top: 50px; font-weight: bold; text-align: center; border-top: 2px solid #0070C0; padding-top: 5px; width: 280px; margin-left: auto; margin-right: auto;">
        ${datos.operadorNombre} OPERADOR<br />
        ${fechaFormateada}
      </div>
      
      <!-- ✅ V00247: se quitó la línea "DOCUMENTO: ..." del pie -->
    </div>
  `;

  const elementoTemporal = document.createElement('div');
  elementoTemporal.innerHTML = htmlTemplate;
  document.body.appendChild(elementoTemporal);

  const consecutivoLimpio = (datos.consecutivo || "Doc").replace(/\W/g, '_');
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const filename = `CheckList_${consecutivoLimpio}_${timestamp}.pdf`;

  const opt = {
    margin:       10, 
    filename:     filename,
    image:        { type: 'jpeg' as const, quality: 0.98 }, 
    html2canvas:  { backgroundColor: '#ffffff', scale: 2, useCORS: true },
    jsPDF:        { unit: 'mm', format: 'letter', orientation: 'portrait' as const } 
  };

  // ✅ Esperar a que TODAS las imágenes (incluido el logo) terminen de decodificar
  // ANTES de generar el PDF. html2pdf/html2canvas "fotografía" el HTML, y si la
  // imagen aún no cargó, la omite (ese era el motivo de que el logo no apareciera).
  (async () => {
    const _imgs = Array.from(elementoTemporal.querySelectorAll('img')) as HTMLImageElement[];
    await Promise.all(_imgs.map(im => (im.complete && im.naturalWidth > 0)
      ? Promise.resolve()
      : new Promise<void>(res => { im.onload = () => res(); im.onerror = () => res(); })));
    try {
      const html2pdf = await cargarHtml2pdf();
      await html2pdf().set(opt).from(elementoTemporal).save();
    } catch (e) {
      // ✅ V00452: antes el error se perdía (y ahora también puede fallar la carga del generador).
      console.error('[PDF] No se pudo generar:', e);
      alert('No se pudo generar el PDF. Revisa la conexión e intenta de nuevo.');
    } finally {
      if (elementoTemporal.parentNode) document.body.removeChild(elementoTemporal);
    }
  })();
};

// ============================================================================
// 4. PRUEBA DE ENTREGA
// ============================================================================
export interface DatosPruebaEntrega {
  referencia: string;
  fechaServicio: string;
  fechaCita: string;
  origenNombre: string;
  origenDireccion: string;
  origenCP: string;
  origenCiudad: string;
  destinoNombre: string;
  destinoDireccion: string;
  destinoCP: string;
  destinoCiudad: string;
  tipoServicio: string;
  tipoUnidad: string;
  numeroEconomico: string;
  placas: string;
  operador: string;
  descripcionMercancia: string;
  logoBase64?: string;
}

export const generarPruebaEntregaPDF = (datosCrudos: DatosPruebaEntrega) => {
  const datos = escaparTextos(datosCrudos); // ✅ V00448
  const opcionesFechaActual: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const fechaGeneracion = new Date().toLocaleDateString('es-ES', opcionesFechaActual);

  const logoSrc = resolverLogo(datos.logoBase64);
  const logoHeader = logoSrc
    ? `<img src="${logoSrc}" style="max-width: 120px; height: auto; display: block; margin-bottom: 2px;" />`
    : '';

  const htmlTemplate = `
    <div style="width: 100%; max-width: 750px; margin: 0 auto; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; color: #333; line-height: 1.2; background-color: #fff; box-sizing: border-box; padding: 20px;">
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
        <tr>
          <td style="width: 25%; text-align: left; vertical-align: middle;">
            ${logoHeader}
            <span style="color: #f39c12; font-weight: bold; font-size: 10pt; display: block;">LOGISTICA</span>
            <span style="color: #f39c12; font-size: 8pt;">www.roelca.com</span>
          </td>
          <td style="width: 75%; text-align: center; vertical-align: middle; font-size: 18pt; font-weight: bold; padding-right: 10%;">
            PRUEBA DE ENTREGA
          </td>
        </tr>
      </table>

      <div style="width: 100%; margin-bottom: 10px;">
        <table style="margin-left: auto; width: auto; border-collapse: collapse;">
          <tr>
            <td style="font-weight: bold; text-align: right; padding: 1px 5px;">REFERENCIA ROELCA:</td>
            <td style="color: #e74c3c; font-weight: bold; text-align: left; padding: 1px 5px;">${datos.referencia}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; text-align: right; padding: 1px 5px;">FECHA DE EMBARQUE:</td>
            <td style="padding: 1px 5px;">${datos.fechaServicio}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; text-align: right; padding: 1px 5px;">FECHA DE CITA:</td>
            <td style="color: #e74c3c; font-weight: bold; text-align: left; padding: 1px 5px;">${datos.fechaCita}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; text-align: right; padding: 1px 5px;">HORA DE CITA:</td>
            <td style="color: #e74c3c; font-weight: bold; text-align: left; padding: 1px 5px;">DIRECTO</td>
          </tr>
        </table>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
        <tr>
          <td style="width: 48%; vertical-align: top; border: 0.5pt solid #eee; padding: 5px;">
            <div style="font-weight: bold; text-decoration: underline; font-size: 9pt; text-align: center; padding-bottom: 4px; background: #f9f9f9;">ORIGEN</div>
            <div style="color: #e74c3c; font-weight: bold; font-size: 10pt; text-align: center; padding: 5px 0;">${datos.origenCiudad}</div>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="font-weight: bold; text-align: right; padding: 2px 8px 2px 0; width: 100px; vertical-align: top; font-size:10px;">PATIO/BODEGA:</td>
                <td style="padding: 2px 0;">${datos.origenNombre}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding: 2px 8px 2px 0; width: 100px; vertical-align: top; font-size:10px;">DIRECCIÓN:</td>
                <td style="padding: 2px 0; line-height: 1.35;">${datos.origenDireccion}</td>
              </tr>
            </table>
          </td>
          <td style="width: 4%;"></td>
          <td style="width: 48%; vertical-align: top; border: 0.5pt solid #eee; padding: 5px;">
            <div style="font-weight: bold; text-decoration: underline; font-size: 9pt; text-align: center; padding-bottom: 4px; background: #f9f9f9;">DESTINO</div>
            <div style="color: #e74c3c; font-weight: bold; font-size: 10pt; text-align: center; padding: 5px 0;">${datos.destinoCiudad}</div>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="font-weight: bold; text-align: right; padding: 2px 8px 2px 0; width: 100px; vertical-align: top; font-size:10px;">PATIO/BODEGA:</td>
                <td style="padding: 2px 0;">${datos.destinoNombre}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding: 2px 8px 2px 0; width: 100px; vertical-align: top; font-size:10px;">DIRECCIÓN:</td>
                <td style="padding: 2px 0; line-height: 1.35;">${datos.destinoDireccion}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <div style="font-weight: bold; text-decoration: underline; font-size: 9pt; text-align: center; width: 100%; margin: 12px 0 6px 0; text-transform: uppercase;">
        Transporte
      </div>

      <table style="margin: 0 auto; width: auto; min-width: 450px; border-collapse: collapse;">
        <tr>
          <td style="font-weight: bold; text-align: right; width: 160px; padding: 2px 8px;">TIPO DE SERVICIO:</td>
          <td colspan="2" style="text-align: center; border-bottom: 0.5pt solid #eee; padding: 2px 8px;">${datos.tipoServicio}</td>
        </tr>
        <tr>
          <td style="font-weight: bold; text-align: right; width: 160px; padding: 2px 8px;">TIPO DE UNIDAD:</td>
          <td style="text-align: center; width: 220px; border-bottom: 0.5pt solid #eee; padding: 2px 8px;">${datos.tipoUnidad}</td>
          <td></td>
        </tr>
        <tr>
          <td style="font-weight: bold; text-align: right; width: 160px; padding: 2px 8px;">NÚMERO ECONÓMICO:</td>
          <td style="text-align: center; width: 220px; border-bottom: 0.5pt solid #eee; padding: 2px 8px;">${datos.numeroEconomico}</td>
          <td></td>
        </tr>
        <tr>
          <td style="font-weight: bold; text-align: right; width: 160px; padding: 2px 8px;">PLACAS:</td>
          <td style="text-align: center; width: 220px; border-bottom: 0.5pt solid #eee; padding: 2px 8px;">${datos.placas}</td>
          <td></td>
        </tr>
        <tr>
          <td style="font-weight: bold; text-align: right; width: 160px; padding: 2px 8px;">OPERADOR:</td>
          <td style="text-align: center; width: 220px; border-bottom: 0.5pt solid #eee; padding: 2px 8px;">${datos.operador}</td>
          <td></td>
        </tr>
      </table>

      <div style="font-weight: bold; text-decoration: underline; font-size: 9pt; text-align: center; width: 100%; margin: 12px 0 6px 0; text-transform: uppercase;">
        Descripción de la Mercancía
      </div>
      <div style="text-align:center; padding: 5px 0; font-weight: bold;">
        ${datos.descripcionMercancia}
      </div>

      <div style="font-weight: bold; text-decoration: underline; font-size: 9pt; text-align: center; width: 100%; margin: 12px 0 6px 0; text-transform: uppercase;">
        Información de Recepción de Mercancía
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-top: 5px;">
        <tr>
          <td style="width:12%; font-weight:bold; padding: 5px; vertical-align: bottom;">SELLO:</td>
          <td style="width:33%; padding: 5px; vertical-align: bottom;">
            <div style="border-bottom: 1pt solid black; width: 100%; height: 14px;"></div>
          </td>
          <td style="width:12%; padding: 5px 5px 5px 15px; font-weight:bold; vertical-align: bottom;">CANTIDAD:</td>
          <td style="width:43%; padding: 5px; vertical-align: bottom;">
            <div style="border-bottom: 1pt solid black; width: 100%; height: 14px;"></div>
          </td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding: 5px; vertical-align: bottom;">OBSERVACIONES:</td>
          <td colspan="3" style="padding: 5px; vertical-align: bottom;">
            <div style="border-bottom: 1pt solid black; width: 100%; height: 14px;"></div>
          </td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding: 5px; vertical-align: bottom;">FECHA REC.:</td>
          <td style="padding: 5px; vertical-align: bottom;">
            <div style="border-bottom: 1pt solid black; width: 100%; height: 14px;"></div>
          </td>
          <td style="padding: 5px 5px 5px 15px; font-weight:bold; vertical-align: bottom;">HORA REC.:</td>
          <td style="padding: 5px; vertical-align: bottom;">
            <div style="border-bottom: 1pt solid black; width: 100%; height: 14px;"></div>
          </td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding: 5px; vertical-align: bottom;">QUIEN RECIBE:</td>
          <td style="padding: 5px; vertical-align: bottom;">
            <div style="border-bottom: 1pt solid black; width: 100%; height: 14px;"></div>
          </td>
          <td style="padding: 5px 5px 5px 15px; font-weight:bold; vertical-align: bottom;">FIRMA:</td>
          <td style="padding: 5px; vertical-align: bottom;">
            <div style="border-bottom: 1pt solid black; width: 100%; height: 14px;"></div>
          </td>
        </tr>
      </table>

      <div style="text-align:center; margin-top:10px; font-weight:bold; text-decoration:underline;">SELLO</div>
      <div style="border: 1.5pt solid black; border-radius: 10px; width: 220px; height: 90px; margin: 5px auto;"></div>

      <div style="color: #e74c3c; font-weight: bold; text-align: center; margin-top: 15px; font-size: 7.5pt; line-height: 1.4;">
        PARA CUALQUIER DUDA O COMENTARIO FAVOR DE COMUNICARSE AL (867) 252 4892<br />
        O ENVIAR CORREO A: trafico@roelca.com<br />
        ${fechaGeneracion}
      </div>
    </div>
  `;

  const elementoTemporal = document.createElement('div');
  elementoTemporal.innerHTML = htmlTemplate;
  document.body.appendChild(elementoTemporal);

  const consecutivoLimpio = (datos.referencia || "Doc").replace(/\W/g, '_');
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const filename = `PruebaEntrega_${consecutivoLimpio}_${timestamp}.pdf`;

  const opt = {
    margin:       0, 
    filename:     filename,
    image:        { type: 'jpeg' as const, quality: 0.98 }, 
    html2canvas:  { backgroundColor: '#ffffff', scale: 2, useCORS: true },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' as const } 
  };

  // ✅ Esperar a que TODAS las imágenes (incluido el logo) terminen de decodificar
  // ANTES de generar el PDF. html2pdf/html2canvas "fotografía" el HTML, y si la
  // imagen aún no cargó, la omite (ese era el motivo de que el logo no apareciera).
  (async () => {
    const _imgs = Array.from(elementoTemporal.querySelectorAll('img')) as HTMLImageElement[];
    await Promise.all(_imgs.map(im => (im.complete && im.naturalWidth > 0)
      ? Promise.resolve()
      : new Promise<void>(res => { im.onload = () => res(); im.onerror = () => res(); })));
    try {
      const html2pdf = await cargarHtml2pdf();
      await html2pdf().set(opt).from(elementoTemporal).save();
    } catch (e) {
      // ✅ V00452: antes el error se perdía (y ahora también puede fallar la carga del generador).
      console.error('[PDF] No se pudo generar:', e);
      alert('No se pudo generar el PDF. Revisa la conexión e intenta de nuevo.');
    } finally {
      if (elementoTemporal.parentNode) document.body.removeChild(elementoTemporal);
    }
  })();
};

// ============================================================================
// 5. CARTA DE INSTRUCCIONES FLETES
// ============================================================================
export interface DatosCartaInstrucciones {
  referencia: string;
  consecutivo: string;
  fechaServicio: string;
  fechaCita: string;
  tipoServicio: string;
  trafico: string;
  tipoUnidad: string;
  numeroEconomico: string;
  placas: string;
  operador: string;
  descripcionMercancia: string;
  origenCiudad: string;
  origenNombre: string;
  origenDireccion: string;
  origenColonia: string;
  origenCP: string;
  // ✅ Desglose estructurado (catálogo de direcciones).
  origenMunicipio?: string;
  origenEstado?: string;
  origenPais?: string;
  destinoCiudad: string;
  destinoNombre: string;
  destinoDireccion: string;
  destinoColonia: string;
  destinoCP: string;
  destinoMunicipio?: string;
  destinoEstado?: string;
  destinoPais?: string;
  // ✅ V00421: datos del cliente y bultos
  refCliente?: string;
  clientePaga?: string;
  clienteMercancia?: string;
  bultos?: string;
  logoBase64?: string;
}

export const generarCartaInstruccionesPDF = (datosCrudos: DatosCartaInstrucciones) => {
  const datos = escaparTextos(datosCrudos); // ✅ V00448
  const logoSrc = resolverLogo(datos.logoBase64);
  const logoHeader = logoSrc
    ? `<img src="${logoSrc}" style="max-width: 110px; height: auto; display: block;" />`
    : '';

  // ✅ V00427: FACTURAR A, FECHA/HORA DE CITA e INSTRUCCIONES solo en LOGÍSTICA FLETES
  const esFletes = String(datos.tipoServicio || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('flete');
  // ✅ V00427: "672243 PA45396" → Número económico = antes del espacio; Placas = después
  const ecoTxt = String(datos.numeroEconomico ?? '').trim();
  const [ecoNum, ...ecoResto] = ecoTxt.split(/\s+/);
  const placasGuardadas = String(datos.placas ?? '').trim();
  const numeroEconomicoCarta = ecoNum || 'N/A';
  const placasCarta = placasGuardadas && placasGuardadas !== 'undefined' && placasGuardadas !== 'N/A' ? placasGuardadas : (ecoResto.join(' ') || 'N/A');

  const htmlTemplate = `
    <div style="width: 100%; max-width: 750px; margin: 0 auto; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #333; line-height: 1.1; background-color: #fff; box-sizing: border-box; padding: 20px;">
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 5px;">
        <tr>
          <td style="width:30%; text-align: left;">
            ${logoHeader}
            <span style="color: #f39c12; font-weight: bold; font-size: 10pt; display: block; margin-top: 2px;">LOGISTICA</span>
            <span style="color: #f39c12; font-size: 7pt;">www.roelca.com</span>
          </td>
          <td style="width:40%; text-align: center; font-size: 16pt; font-weight: bold; text-decoration: underline;">
            CARTA DE INSTRUCCIONES
          </td>
          <td style="width:30%; text-align:right; vertical-align: top;">
            REF#
            <div style="background-color: #d9e1f2; padding: 3px 8px; border: 1px solid #ccc; display: inline-block; font-weight: bold;">
              ${datos.referencia}
            </div>
          </td>
        </tr>
      </table>

      ${esFletes ? `<div style="text-align: center; margin: 5px 0; font-size: 7.5pt;">
        <span style="color: red; font-weight: bold; text-decoration: underline;">FACTURAR A:</span><br />
        <strong>ROELCAINC SA DE CV</strong> | <strong>ROE180119IV4</strong><br />
        MAR DE LAS ANTILLAS #947 COL. LA PAZ, 88290 NUEVO LAREDO, TAMPS<br />
        email: proveedores@roelca.com
      </div>` : '<div style="height: 10px;"></div>'}

      <div style="margin-bottom: 8px;">
        <table style="margin-left: auto; width: auto; border-collapse: collapse;">
          <tr>
            <td style="font-weight: bold; text-align: right; padding: 1px 4px;">REFERENCIA ROELCA:</td>
            <td style="padding: 1px 4px;">${datos.consecutivo}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; text-align: right; padding: 1px 4px;">REFERENCIA CLIENTE:</td>
            <td style="padding: 1px 6px; font-weight: bold; font-size: 9.5pt; background-color: #fff2cc; border: 1px solid #f1c232;">${datos.refCliente || 'N/A'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; text-align: right; padding: 1px 4px;">FECHA DE EMBARQUE:</td>
            <td style="padding: 1px 4px;">${datos.fechaServicio}</td>
          </tr>
          ${esFletes ? `<tr>
            <td style="font-weight: bold; text-align: right; padding: 1px 4px;">FECHA DE CITA:</td>
            <td style="color: red; font-weight: bold; padding: 1px 4px;">${datos.fechaCita}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; text-align: right; padding: 1px 4px;">HORA DE CITA:</td>
            <td style="color: red; font-weight: bold; padding: 1px 4px;">DIRECTO</td>
          </tr>` : ''}
        </table>
      </div>

      <!-- ✅ V00421: cliente -->
      <div style="font-size: 9pt; font-weight: bold; text-decoration: underline; margin: 5px 0; text-transform: uppercase;">CLIENTE</div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 6px;">
        <tr>
          <td style="font-weight: bold; width: 130px; text-align: right; padding: 2px 10px 2px 2px;">CLIENTE PAGA:</td>
          <td style="border-bottom: 0.5pt solid #eee; padding: 2px;">${datos.clientePaga || 'N/A'}</td>
        </tr>
        <tr>
          <td style="font-weight: bold; width: 130px; text-align: right; padding: 2px 10px 2px 2px;">CLIENTE MERCANCÍA:</td>
          <td style="border-bottom: 0.5pt solid #eee; padding: 2px;">${datos.clienteMercancia || 'N/A'}</td>
        </tr>
        <tr>
          <td style="font-weight: bold; width: 130px; text-align: right; padding: 2px 10px 2px 2px;">REF. CLIENTE:</td>
          <td style="border-bottom: 0.5pt solid #eee; padding: 2px; font-weight: bold;">${datos.refCliente || 'N/A'}</td>
        </tr>
      </table>

      <div style="font-size: 9pt; font-weight: bold; text-decoration: underline; margin: 5px 0; text-transform: uppercase;">
        TRANSPORTE
      </div>

      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="font-weight: bold; width: 130px; text-align: right; padding: 2px 10px 2px 2px;">TIPO DE SERVICIO:</td>
          <td style="width: 180px; text-align: center; border-bottom: 1px solid #8ea9db; padding: 2px;">${datos.tipoServicio}</td>
          <td style="text-align:center; width: 100px; font-weight:bold; padding: 2px;">${datos.trafico}</td>
        </tr>
        <tr>
          <td style="font-weight: bold; width: 130px; text-align: right; padding: 2px 10px 2px 2px;">TIPO DE UNIDAD:</td>
          <td style="width: 180px; text-align: center; border-bottom: 0.5pt solid #eee; padding: 2px;">${datos.tipoUnidad}</td>
          <td></td>
        </tr>
        <tr>
          <td style="font-weight: bold; width: 130px; text-align: right; padding: 2px 10px 2px 2px;">NUMERO ECONÓMICO:</td>
          <td style="width: 180px; text-align: center; border-bottom: 0.5pt solid #eee; padding: 2px;">${numeroEconomicoCarta}</td>
          <td></td>
        </tr>
        <tr>
          <td style="font-weight: bold; width: 130px; text-align: right; padding: 2px 10px 2px 2px;">PLACAS:</td>
          <td style="width: 180px; text-align: center; border-bottom: 0.5pt solid #eee; padding: 2px;">${placasCarta}</td>
          <td></td>
        </tr>
        <tr>
          <td style="font-weight: bold; width: 130px; text-align: right; padding: 2px 10px 2px 2px;">OPERADOR:</td>
          <td style="width: 180px; text-align: center; border-bottom: 0.5pt solid #eee; padding: 2px;">${datos.operador}</td>
          <td></td>
        </tr>
      </table>

      <div style="text-align: center; margin-top: 10px;">
        <span style="font-size: 9pt; font-weight: bold; text-decoration: underline;">DESCRIPCION DE LA MERCANCIA</span>
        <!-- ✅ V00419: se imprime la descripción de la mercancía (antes solo la barra amarilla) -->
        <div style="background-color: yellow; min-height: 12px; width: 100%; margin: 2px 0 8px 0; font-size: 8pt; font-weight: bold; padding: 2px 0;">${[datos.descripcionMercancia && datos.descripcionMercancia !== 'N/A' ? datos.descripcionMercancia : '', datos.bultos ? `BULTOS: ${datos.bultos}` : ''].filter(Boolean).join(' · ')}</div>
      </div>

      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="width: 48%; vertical-align: top; border: 0.5pt solid #eee; padding: 5px;">
            <div style="text-align:center; font-weight:bold; text-decoration:underline; margin-bottom:3px;">ORIGEN (DONDE SE ENGANCHA)</div>
            <div style="color: red; font-weight: bold; font-size: 7.5pt; text-align: center; padding-bottom: 4px; line-height: 1.3;">${datos.origenCiudad}</div>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">REMITENTE:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.origenNombre}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">DIRECCION:</td>
                <td style="font-size: 7.5pt; padding: 2px 0; line-height: 1.35;">${datos.origenDireccion}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">COLONIA:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.origenColonia || 'N/A'}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">C.POSTAL:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.origenCP || 'N/A'}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">MUNICIPIO:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.origenMunicipio || 'N/A'}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">ESTADO:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.origenEstado || 'N/A'}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">PAIS:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.origenPais || 'N/A'}</td>
              </tr>
            </table>
          </td>
          <td style="width: 4%;"></td>
          <td style="width: 48%; vertical-align: top; border: 0.5pt solid #eee; padding: 5px;">
            <div style="text-align:center; font-weight:bold; text-decoration:underline; margin-bottom:3px;">DESTINO (DONDE SE ENTREGA)</div>
            <div style="color: red; font-weight: bold; font-size: 7.5pt; text-align: center; padding-bottom: 4px; line-height: 1.3;">${datos.destinoCiudad}</div>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">DESTINATARIO:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.destinoNombre}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">DIRECCION:</td>
                <td style="font-size: 7.5pt; padding: 2px 0; line-height: 1.35;">${datos.destinoDireccion}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">COLONIA:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.destinoColonia || 'N/A'}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">C.POSTAL:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.destinoCP || 'N/A'}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">MUNICIPIO:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.destinoMunicipio || 'N/A'}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">ESTADO:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.destinoEstado || 'N/A'}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">PAIS:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.destinoPais || 'N/A'}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      ${esFletes ? `<div style="text-align:center; font-weight:bold; text-decoration:underline; font-size:10pt; margin-top:10px;">INSTRUCCIONES</div>
      <div style="background-color: red; color: white; font-weight: bold; text-align: center; padding: 4px; font-size: 9pt; margin-top: 5px;">MUY IMPORTANTE NO MOSTRAR NINGÚN TALÓN O CARTA PORTE</div>
      <div style="background-color: yellow; height: 8px; margin: 4px 0;"></div>
      <div style="text-align: center; font-weight: bold; font-size: 8pt; margin: 8px 0; line-height: 1.3;">
        ÚNICAMENTE FIRMAR LA PRUEBA DE ENTREGA ANEXA Y REGRESARLA A ORIGEN<br />
        CUALQUIER CONTACTO CON EL CLIENTE, FAVOR DE REPORTARSE COMO <span style="color: red;">ROELCA</span><br />
        PARA CUALQUIER DUDA FAVOR DE COMUNICARSE AL (867)579 12 42
      </div>
      <div style="background-color: yellow; height: 8px; margin: 4px 0;"></div>` : ''}

      <div style="text-align: center; margin-top: 15px;">
        <p style="margin: 2px;"><strong>Atentamente:</strong></p>
        <div style="margin-top: 20px;">
          <div style="font-size: 11pt; font-weight: bold;">Roberto Carlos Leal</div>
          <div style="color: #0070c0; font-weight: bold; font-size: 10pt;">ROELCAINC SA DE CV</div>
          <div style="color: #ff9900; font-weight: bold; font-size: 9pt;">DIVISION LOGISTICA</div>
          <a style="color: #0070c0; text-decoration: none; font-size: 8pt;" href="http://www.roelca.com">www.roelca.com</a>
        </div>
      </div>

    </div>
  `;

  const elementoTemporal = document.createElement('div');
  elementoTemporal.innerHTML = htmlTemplate;
  document.body.appendChild(elementoTemporal);

  const consecutivoLimpio = (datos.referencia || "Doc").replace(/\W/g, '_');
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const filename = `CartaInstrucciones_${consecutivoLimpio}_${timestamp}.pdf`;

  const opt = {
    margin:       0, 
    filename:     filename,
    image:        { type: 'jpeg' as const, quality: 0.98 }, 
    html2canvas:  { backgroundColor: '#ffffff', scale: 2, useCORS: true },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' as const } 
  };

  // ✅ Esperar a que TODAS las imágenes (incluido el logo) terminen de decodificar
  // ANTES de generar el PDF. html2pdf/html2canvas "fotografía" el HTML, y si la
  // imagen aún no cargó, la omite (ese era el motivo de que el logo no apareciera).
  (async () => {
    const _imgs = Array.from(elementoTemporal.querySelectorAll('img')) as HTMLImageElement[];
    await Promise.all(_imgs.map(im => (im.complete && im.naturalWidth > 0)
      ? Promise.resolve()
      : new Promise<void>(res => { im.onload = () => res(); im.onerror = () => res(); })));
    try {
      const html2pdf = await cargarHtml2pdf();
      await html2pdf().set(opt).from(elementoTemporal).save();
    } catch (e) {
      // ✅ V00452: antes el error se perdía (y ahora también puede fallar la carga del generador).
      console.error('[PDF] No se pudo generar:', e);
      alert('No se pudo generar el PDF. Revisa la conexión e intenta de nuevo.');
    } finally {
      if (elementoTemporal.parentNode) document.body.removeChild(elementoTemporal);
    }
  })();
};


// ═══════════════════════════════════════════════════════════════════════════
// ✅ RELACIÓN DE COMPRAS (MTTO)
//    Documento que antes se armaba dentro de MttoAgrupadosInvoice. Al vivir
//    aquí, el historial de Invoice y la vista "Todos los Gastos" generan
//    EXACTAMENTE el mismo documento (con uno o varios gastos).
// ═══════════════════════════════════════════════════════════════════════════
export interface RelacionComprasFila {
  numeroGasto: string;
  fecha: string;          // ISO YYYY-MM-DD (o texto de fecha válido)
  unidadNombre: string;
  descripcion: string;
  total: number | string;
}

export interface RelacionComprasMttoData {
  denominacion: string;   // Número de invoice o, si no hay, el folio del gasto
  proveedorNum: string;
  razonSocial: string;
  tipo: string;           // Estatus (Facturado / No facturado)
  filas: RelacionComprasFila[];
  sumaImporte: number;
  sumaIva: number;
  sumaTotal: number;
}

export const generarRelacionComprasMttoPDF = (data: RelacionComprasMttoData): void => {
  const formatoMoneda = (monto: number | string) => {
    const num = aNumero(monto); // ✅ V00535: acepta "1,234.50"
    return `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const formatearFechaEspanol = (fechaStr: string | Date) => {
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const d = new Date(fechaStr);
    if (isNaN(d.getTime())) return escaparHTML(fechaStr || '-'); // ✅ V00448
    const dUTC = new Date(d.getTime() + d.getTimezoneOffset() * 60000);
    return `${dUTC.getDate()} de ${meses[dUTC.getMonth()]} de ${dUTC.getFullYear()}`;
  };
  // Respeta los saltos de línea de la descripción en el PDF (\n -> <br>)
  const formatearTextoMultilinea = (texto: unknown) => {
    return escaparHTML(texto).replace(/\r\n|\r|\n/g, '<br>');
  };

  let filasHTML = '';
  (data.filas || []).forEach((g) => {
    const fechaFmt = formatearFechaEspanol(g.fecha);
    const descripcionFmt = formatearTextoMultilinea(g.descripcion);
    filasHTML += `
        <tr>
          <td class="text-center">${escaparHTML(g.numeroGasto || '-')}</td>
          <td class="text-center" style="text-transform: capitalize;">${fechaFmt}</td>
          <td class="text-center">${escaparHTML(g.unidadNombre)}</td>
          <td class="col-desc">${descripcionFmt}</td>
          <td class="text-right">${formatoMoneda(g.total)}</td>
        </tr>
      `;
  });

  const fechaActual = formatearFechaEspanol(new Date());
  const logoBase64 = logoPdfPorDefecto(); // ✅ V00534

  const htmlDocument = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Relación de Compras - ${escaparHTML(data.denominacion)}</title>
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
                <td class="col-label"># PROVEEDOR</td><td class="col-value">${escaparHTML(data.proveedorNum)}</td>
                <td class="col-label">RAZON SOCIAL:</td><td class="col-value">${escaparHTML(data.razonSocial)}</td>
                <td class="col-label">DENOMINACION:</td><td class="col-value">${escaparHTML(data.denominacion)}</td>
              </tr>
              <tr>
                <td class="col-label">TIPO:</td><td class="col-value">${escaparHTML(data.tipo)}</td>
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
              <td><div class="amount-box"><span>$</span> <span>${(Number(data.sumaImporte) || 0).toFixed(2)}</span></div></td>
            </tr>
            <tr>
              <td class="no-internal-borders middle-empty" colspan="4"> </td>
              <td><div class="amount-box"><span>$</span> <span>${(Number(data.sumaIva) || 0).toFixed(2)}</span></div></td>
            </tr>
            <tr>
              <td class="no-internal-borders last-empty" colspan="4"> </td>
              <td><div class="amount-box"><span>$</span> <span>${(Number(data.sumaTotal) || 0).toFixed(2)}</span></div></td>
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