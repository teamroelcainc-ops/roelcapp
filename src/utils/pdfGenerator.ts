// src/utils/pdfGenerator.ts
import html2pdf from 'html2pdf.js';

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

let LOGO_PDF_GLOBAL = '';

/** Registra el logo (idealmente un dataURL base64) que usarán todos los PDF. */
export const setLogoPdf = (logo?: string | null) => {
  LOGO_PDF_GLOBAL = logo || '';
};

/** Devuelve el logo actualmente registrado (por si algún módulo lo necesita). */
export const getLogoPdf = () => LOGO_PDF_GLOBAL;

/**
 * Descarga la URL del logo y la convierte a dataURL (base64) para incrustarlo
 * en el PDF. Devuelve null si no hay URL o si falla la carga (para caer al
 * respaldo: no dibujar logo en lugar de mostrar un recuadro roto).
 */
export async function cargarLogoDataUrl(logoUrl?: string | null): Promise<string | null> {
  if (!logoUrl) return null;
  try {
    const resp = await fetch(logoUrl, { mode: 'cors' });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('No se pudo precargar el logo para el PDF:', e);
    return null;
  }
}

/** Resuelve el logo a usar en un documento concreto. */
const resolverLogo = (logoBase64?: string) => logoBase64 || LOGO_PDF_GLOBAL || '';

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

export const generarSolicitudRetiroPDF = (datos: DatosSolicitudRetiro) => {
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
    html2canvas:  { scale: 2, useCORS: true },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' as const } 
  };

  html2pdf().set(opt).from(elementoTemporal).save().then(() => {
    document.body.removeChild(elementoTemporal);
  });
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

export const generarInstruccionesServicioPDF = (datos: DatosInstruccionesServicio) => {
  
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
    html2canvas:  { scale: 2, useCORS: true },
    jsPDF:        { unit: 'mm', format: 'letter', orientation: 'portrait' as const } 
  };

  html2pdf().set(opt).from(elementoTemporal).save().then(() => {
    document.body.removeChild(elementoTemporal);
  });
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

export const generarCheckListPDF = (datos: DatosCheckList) => {
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
      
      <div style="margin-top: 10px; font-size: 11px; text-align: right; color: #666;">DOCUMENTO: ${datos.supervisor}</div>
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
    html2canvas:  { scale: 2, useCORS: true },
    jsPDF:        { unit: 'mm', format: 'letter', orientation: 'portrait' as const } 
  };

  html2pdf().set(opt).from(elementoTemporal).save().then(() => {
    document.body.removeChild(elementoTemporal);
  });
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

export const generarPruebaEntregaPDF = (datos: DatosPruebaEntrega) => {
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
                <td style="font-weight: bold; text-align: right; padding: 2px 8px 2px 0; width: 100px; vertical-align: top; font-size:10px;">CLIENTE:</td>
                <td style="padding: 2px 0;">${datos.origenNombre}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding: 2px 8px 2px 0; width: 100px; vertical-align: top; font-size:10px;">DIRECCIÓN:</td>
                <td style="padding: 2px 0;">${datos.origenDireccion}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding: 2px 8px 2px 0; width: 100px; vertical-align: top; font-size:10px;">C. POSTAL:</td>
                <td style="padding: 2px 0;">${datos.origenCP}</td>
              </tr>
            </table>
          </td>
          <td style="width: 4%;"></td>
          <td style="width: 48%; vertical-align: top; border: 0.5pt solid #eee; padding: 5px;">
            <div style="font-weight: bold; text-decoration: underline; font-size: 9pt; text-align: center; padding-bottom: 4px; background: #f9f9f9;">DESTINO</div>
            <div style="color: #e74c3c; font-weight: bold; font-size: 10pt; text-align: center; padding: 5px 0;">${datos.destinoCiudad}</div>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="font-weight: bold; text-align: right; padding: 2px 8px 2px 0; width: 100px; vertical-align: top; font-size:10px;">CLIENTE:</td>
                <td style="padding: 2px 0;">${datos.destinoNombre}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding: 2px 8px 2px 0; width: 100px; vertical-align: top; font-size:10px;">DIRECCIÓN:</td>
                <td style="padding: 2px 0;">${datos.destinoDireccion}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding: 2px 8px 2px 0; width: 100px; vertical-align: top; font-size:10px;">C. POSTAL:</td>
                <td style="padding: 2px 0;">${datos.destinoCP}</td>
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
    html2canvas:  { scale: 2, useCORS: true },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' as const } 
  };

  html2pdf().set(opt).from(elementoTemporal).save().then(() => {
    document.body.removeChild(elementoTemporal);
  });
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
  destinoCiudad: string;
  destinoNombre: string;
  destinoDireccion: string;
  destinoColonia: string;
  destinoCP: string;
  logoBase64?: string;
}

export const generarCartaInstruccionesPDF = (datos: DatosCartaInstrucciones) => {
  const logoSrc = resolverLogo(datos.logoBase64);
  const logoHeader = logoSrc
    ? `<img src="${logoSrc}" style="max-width: 110px; height: auto; display: block;" />`
    : '';

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

      <div style="text-align: center; margin: 5px 0; font-size: 7.5pt;">
        <span style="color: red; font-weight: bold; text-decoration: underline;">FACTURAR A:</span><br />
        <strong>ROELCAINC SA DE CV</strong> | <strong>ROE180119IV4</strong><br />
        MAR DE LAS ANTILLAS #947 COL. LA PAZ, 88290 NUEVO LAREDO, TAMPS<br />
        email: proveedores@roelca.com
      </div>

      <div style="margin-bottom: 8px;">
        <table style="margin-left: auto; width: auto; border-collapse: collapse;">
          <tr>
            <td style="font-weight: bold; text-align: right; padding: 1px 4px;">REFERENCIA ROELCA:</td>
            <td style="padding: 1px 4px;">${datos.consecutivo}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; text-align: right; padding: 1px 4px;">FECHA DE EMBARQUE:</td>
            <td style="padding: 1px 4px;">${datos.fechaServicio}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; text-align: right; padding: 1px 4px;">FECHA DE CITA:</td>
            <td style="color: red; font-weight: bold; padding: 1px 4px;">${datos.fechaCita}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; text-align: right; padding: 1px 4px;">HORA DE CITA:</td>
            <td style="color: red; font-weight: bold; padding: 1px 4px;">DIRECTO</td>
          </tr>
        </table>
      </div>

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
          <td style="width: 180px; text-align: center; border-bottom: 0.5pt solid #eee; padding: 2px;">${datos.numeroEconomico}</td>
          <td></td>
        </tr>
        <tr>
          <td style="font-weight: bold; width: 130px; text-align: right; padding: 2px 10px 2px 2px;">PLACAS:</td>
          <td style="width: 180px; text-align: center; border-bottom: 0.5pt solid #eee; padding: 2px;">${datos.placas}</td>
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
        <div style="background-color: yellow; height: 12px; width: 100%; margin: 2px 0 8px 0;"></div>
      </div>

      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="width: 48%; vertical-align: top; border: 0.5pt solid #eee; padding: 5px;">
            <div style="text-align:center; font-weight:bold; text-decoration:underline; margin-bottom:3px;">ORIGEN</div>
            <div style="color: red; font-weight: bold; font-size: 10pt; text-align: center; padding-bottom: 4px;">${datos.origenCiudad}</div>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">REMITENTE:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.origenNombre}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">DIRECCION:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.origenDireccion}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">COLONIA:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.origenColonia}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">C.POSTAL:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.origenCP}</td>
              </tr>
            </table>
          </td>
          <td style="width: 4%;"></td>
          <td style="width: 48%; vertical-align: top; border: 0.5pt solid #eee; padding: 5px;">
            <div style="text-align:center; font-weight:bold; text-decoration:underline; margin-bottom:3px;">DESTINO</div>
            <div style="color: red; font-weight: bold; font-size: 10pt; text-align: center; padding-bottom: 4px;">${datos.destinoCiudad}</div>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">DESTINATARIO:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.destinoNombre}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">DIRECCION:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.destinoDireccion}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">COLONIA:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.destinoColonia}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; text-align: right; padding-right: 5px; width: 90px; vertical-align: top; font-size: 7.5pt;">C.POSTAL:</td>
                <td style="font-size: 7.5pt; padding: 2px 0;">${datos.destinoCP}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <div style="text-align:center; font-weight:bold; text-decoration:underline; font-size:10pt; margin-top:10px;">INSTRUCCIONES</div>
      <div style="background-color: red; color: white; font-weight: bold; text-align: center; padding: 4px; font-size: 9pt; margin-top: 5px;">MUY IMPORTANTE NO MOSTRAR NINGÚN TALÓN O CARTA PORTE</div>
      <div style="background-color: yellow; height: 8px; margin: 4px 0;"></div>
      <div style="text-align: center; font-weight: bold; font-size: 8pt; margin: 8px 0; line-height: 1.3;">
        ÚNICAMENTE FIRMAR LA PRUEBA DE ENTREGA ANEXA Y REGRESARLA A ORIGEN<br />
        CUALQUIER CONTACTO CON EL CLIENTE, FAVOR DE REPORTARSE COMO <span style="color: red;">ROELCA</span><br />
        PARA CUALQUIER DUDA FAVOR DE COMUNICARSE AL (867)579 12 42
      </div>
      <div style="background-color: yellow; height: 8px; margin: 4px 0;"></div>

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
    html2canvas:  { scale: 2, useCORS: true },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' as const } 
  };

  html2pdf().set(opt).from(elementoTemporal).save().then(() => {
    document.body.removeChild(elementoTemporal);
  });
};