// src/utils/pdfInstruccionesDiesel.ts
import html2pdf from 'html2pdf.js';
import { LOGO_DEFAULT, getLogoPdf } from './pdfGenerator';

// ============================================================================
// INSTRUCCIONES DEL SERVICIO (DIESEL)
// ----------------------------------------------------------------------------
// Réplica NATIVA (React / html2pdf) del documento que generaba AppSheet para
// las "Referencias del Diesel". Toma los datos de una referencia de diésel
// (consecutivo, unidad, operador, proveedor y galones autorizados) y descarga
// el PDF con el mismo formato y comportamiento que el resto de documentos del
// módulo (mismo manejo del logo y espera de imágenes antes de "fotografiar"
// el HTML con html2canvas).
//
// El logo se reutiliza EXACTAMENTE del módulo central (pdfGenerator):
//   datos.logoBase64  ->  getLogoPdf()  ->  LOGO_DEFAULT
// Así aparece SIEMPRE, sin depender de Firestore, Storage ni CORS.
// ============================================================================

/** Resuelve el logo a usar (igual criterio que en pdfGenerator). */
const resolverLogo = (logoBase64?: string) =>
  logoBase64 || getLogoPdf() || LOGO_DEFAULT || '';

export interface DatosInstruccionesDiesel {
  referencia: string;          // Consecutivo de la referencia (DIESEL-...)
  fecha: string;               // YYYY-MM-DD
  unidadNombre: string;
  operadorNombre: string;
  proveedorNombre: string;     // Origen (nombre del proveedor)
  proveedorDireccion: string;  // Dirección del proveedor
  galonesAutorizados: number | string;
  logoBase64?: string;
}

export const generarInstruccionesDieselPDF = (datos: DatosInstruccionesDiesel) => {
  // Fecha legible en español (mismo formato que Instrucciones del Servicio).
  let fechaFormateada = datos.fecha;
  if (datos.fecha) {
    const [year, month, day] = datos.fecha.split('-');
    const dateObj = new Date(Number(year), Number(month) - 1, Number(day));
    const opcionesFecha: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
    fechaFormateada = dateObj.toLocaleDateString('es-ES', opcionesFecha);
  }

  const galones = Number(datos.galonesAutorizados || 0).toFixed(2);

  const logoSrc = resolverLogo(datos.logoBase64);
  const logoHeader = logoSrc
    ? `<img src="${logoSrc}" style="max-width: 140px; height: auto;" />`
    : '';

  const htmlTemplate = `
    <div style="width: 100%; max-width: 750px; margin: 0 auto; font-family: Arial, sans-serif; font-size: 12px; color: #000; background-color: #fff; box-sizing: border-box; padding: 20px;">

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
        <tr>
          <td style="width: 150px; vertical-align: middle;">${logoHeader}</td>
          <td style="text-align: center; vertical-align: middle; font-size: 20px; font-weight: bold; color: #F37021; padding-bottom: 10px;">
            INSTRUCCIONES DEL SERVICIO
          </td>
        </tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
        <tr>
          <td style="font-weight: bold; color: #0070C0; vertical-align: top; width: 15%;">Referencia:</td>
          <td style="width: 50%;"></td>
          <td style="width: 35%; text-align: right; vertical-align: top;">
            <span style="border: 1px solid #000; padding: 5px 10px; background-color: #f0f0f0; font-weight: bold; font-size: 14px;">${datos.referencia}</span>
          </td>
        </tr>
        <tr>
          <td style="font-weight: bold; color: #0070C0; vertical-align: top; padding-top: 10px;">Fecha:</td>
          <td></td>
          <td style="text-align: right; font-weight: bold; font-size: 14px; vertical-align: top; padding-top: 10px;">${fechaFormateada}</td>
        </tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; border-bottom: 2px solid #0070C0;">
        <tr>
          <td style="font-weight: bold; color: #0070C0; padding-bottom: 4px; width: 25%;"></td>
          <td style="font-weight: bold; color: #0070C0; padding-bottom: 4px; width: 25%;">Unidad</td>
          <td style="font-weight: bold; color: #0070C0; padding-bottom: 4px; width: 50%;">Operador</td>
        </tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
        <tr>
          <td style="font-weight: bold; font-size: 14px; padding-top: 6px; width: 25%;"></td>
          <td style="font-weight: bold; font-size: 14px; padding-top: 6px; width: 25%;">${datos.unidadNombre}</td>
          <td style="font-weight: bold; font-size: 14px; padding-top: 6px; width: 50%;">${datos.operadorNombre}</td>
        </tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 5px;">
        <tr>
          <td style="font-weight: bold; color: #F37021; vertical-align: top; width: 30%;">Tipo de Operación</td>
          <td style="font-weight: bold; font-size: 14px;">Carga de Diesel</td>
        </tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; border-top: 2px solid #000; border-bottom: 2px solid #000; margin-top: 20px;">
        <tr>
          <td style="padding: 12px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="width: 30%; font-weight: bold; vertical-align: top; padding: 5px 0;">Origen:</td>
                <td style="font-weight: bold; font-size: 14px; vertical-align: top; padding: 5px 0;">${datos.proveedorNombre || '-'}</td>
              </tr>
              <tr>
                <td style="width: 30%; font-weight: bold; vertical-align: top; padding: 5px 0;">Dirección:</td>
                <td style="font-weight: bold; font-size: 14px; vertical-align: top; padding: 5px 0;">${datos.proveedorDireccion || '-'}</td>
              </tr>
              <tr>
                <td style="width: 30%; font-weight: bold; vertical-align: top; padding: 5px 0;">Galones Autorizados</td>
                <td style="font-weight: bold; font-size: 14px; vertical-align: top; padding: 5px 0;">${galones}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

    </div>
  `;

  const elementoTemporal = document.createElement('div');
  elementoTemporal.innerHTML = htmlTemplate;
  document.body.appendChild(elementoTemporal);

  const referenciaLimpia = (datos.referencia || 'Doc').replace(/\W/g, '_');
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const filename = `InstruccionesDiesel_${referenciaLimpia}_${timestamp}.pdf`;

  const opt = {
    margin:       10,
    filename:     filename,
    image:        { type: 'jpeg' as const, quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true },
    jsPDF:        { unit: 'mm', format: 'letter', orientation: 'portrait' as const }
  };

  // ✅ Esperar a que TODAS las imágenes (incluido el logo) terminen de decodificar
  // ANTES de generar el PDF. html2pdf/html2canvas "fotografía" el HTML, y si la
  // imagen aún no cargó, la omite (mismo patrón que el resto de documentos).
  (async () => {
    const _imgs = Array.from(elementoTemporal.querySelectorAll('img')) as HTMLImageElement[];
    await Promise.all(_imgs.map(im => (im.complete && im.naturalWidth > 0)
      ? Promise.resolve()
      : new Promise<void>(res => { im.onload = () => res(); im.onerror = () => res(); })));
    try {
      await html2pdf().set(opt).from(elementoTemporal).save();
    } finally {
      if (elementoTemporal.parentNode) document.body.removeChild(elementoTemporal);
    }
  })();
};