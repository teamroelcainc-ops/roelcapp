// src/features/facturacion/components/generarRemisionPDF.ts
//
// ═══════════════════════════════════════════════════════════════════════
// REMISIÓN EN PDF (misma técnica que el resto de documentos)
// -----------------------------------------------------------------------
// Antes se abría una ventana con window.open + window.print() y el logo se
// tomaba de una URL (/logo-roelca.png) que a veces NO cargaba, por lo que la
// remisión salía sin logo.
//
// Ahora se genera EXACTAMENTE igual que Instrucciones del Servicio, Check List,
// Prueba de Entrega, etc.: se arma un HTML en un <div> temporal, se ESPERA a que
// todas las imágenes (incluido el logo) terminen de decodificar y se "fotografía"
// con html2pdf/html2canvas. El logo se reutiliza del módulo central:
//     data.logoBase64  ->  getLogoPdf()  ->  LOGO_DEFAULT
// Así el logo aparece SIEMPRE, sin depender de Firestore, Storage ni CORS.
//
// El emisor del encabezado lo decide quien llama (según la moneda):
//   · Remisión en DÓLARES (USD) → nombre de Camila.
//   · Remisión en PESOS   (MXN) → nombre de Rolando.
// ═══════════════════════════════════════════════════════════════════════

import html2pdf from 'html2pdf.js';
import { LOGO_DEFAULT, getLogoPdf } from '../../../utils/pdfGenerator';

export interface EmisorRemision {
  facturaNombre: string;   // nombre que aparece arriba (a nombre de quién)
  direccion: string;
  ciudadEstado: string;    // ciudad, estado y/o teléfono
  email: string;
}

export interface RemisionFila {
  ref: string;
  fecha: string;
  equipo: string;
  origen: string;
  destino: string;
  descripcion: string;
  importe: number;
}

export interface RemisionData {
  emisor: EmisorRemision;
  numero: string;
  fecha: string;
  clienteNombre: string;
  diasCredito: string;
  direccion: string;
  numExtInt: string;
  colonia: string;
  ciudad: string;
  moneda: string;          // "Dólares" / "Pesos"
  observaciones: string;
  fechaTipoCambio: string; // fecha del DOF (opcional)
  tipoCambio: string;      // valor del tipo de cambio (opcional)
  total: number;
  filas: RemisionFila[];
  logoBase64?: string;     // logo opcional (dataURL). Si no viene, se usa el central.
}

// ── Colores del diseño (mismos del ejemplo D-6177) ──────────────────────
const AZUL = '#1d4ed8';
const ROJO = '#b91c1c';

/** Resuelve el logo a usar (igual criterio que en pdfGenerator). */
const resolverLogo = (logoBase64?: string) =>
  logoBase64 || getLogoPdf() || LOGO_DEFAULT || '';

// Escapa texto para insertarlo en HTML de forma segura.
const esc = (v: any): string =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Formatea un número a 2 decimales con separador de miles (estilo del ejemplo).
const num2 = (n: any): string => {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const generarRemisionPDF = (data: RemisionData): void => {
  const logoSrc = resolverLogo(data.logoBase64);
  const logoHeader = logoSrc
    ? `<img src="${logoSrc}" style="width: 90px; height: auto;" />`
    : '';

  // Renglones de la tabla de servicios (inline styles para html2canvas).
  const tdC = `border: 1px solid #cbd5e1; padding: 5px 6px; font-size: 11px; text-align: center;`;
  const tdL = `border: 1px solid #cbd5e1; padding: 5px 6px; font-size: 11px; text-align: left;`;
  const tdR = `border: 1px solid #cbd5e1; padding: 5px 6px; font-size: 11px; text-align: right; white-space: nowrap;`;

  const filasHtml = (data.filas || []).map((r) => `
    <tr>
      <td style="${tdC}">${esc(r.ref)}</td>
      <td style="${tdC}">${esc(r.fecha)}</td>
      <td style="${tdC}">${esc(r.equipo)}</td>
      <td style="${tdL}">${esc(r.origen)}</td>
      <td style="${tdL}">${esc(r.destino)}</td>
      <td style="${tdL}">${esc(r.descripcion)}</td>
      <td style="${tdR}">$ ${num2(r.importe)}</td>
    </tr>`).join('');

  const tcLinea = (data.fechaTipoCambio || data.tipoCambio)
    ? `<div style="text-align: right; font-size: 11px; color: #334155; margin-bottom: 4px;">Tipo de Cambio de DOF del día ${esc(data.fechaTipoCambio)} &nbsp; $ ${esc(data.tipoCambio)}</div>`
    : '';

  const obsHtml = data.observaciones
    ? `<div style="margin-top: 14px; border: 1px solid #cbd5e1; border-radius: 3px; padding: 8px 10px; font-size: 11px;"><span style="font-weight: bold; color: #334155;">OBSERVACIONES:</span> ${esc(data.observaciones)}</div>`
    : '';

  const thServ = `background: ${AZUL}; color: #fff; padding: 6px; font-size: 10px; text-transform: uppercase; border: 1px solid ${AZUL};`;
  const tdCli = `border: 1px solid #333; padding: 5px 8px; vertical-align: top; font-size: 11px;`;
  const lblCli = `border: 1px solid #333; padding: 5px 8px; vertical-align: top; background: #f1f5f9; font-weight: bold; width: 120px; font-size: 10px; text-transform: uppercase; color: #334155;`;

  const htmlTemplate = `
    <div style="width: 100%; max-width: 760px; margin: 0 auto; font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; background-color: #fff; box-sizing: border-box; padding: 20px;">

      <!-- Encabezado: emisor (con logo) + caja REMISION -->
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="vertical-align: top;">
            <table style="border-collapse: collapse;">
              <tr>
                <td style="vertical-align: top; padding-right: 14px;">${logoHeader}</td>
                <td style="vertical-align: top; color: ${AZUL}; line-height: 1.35;">
                  <div style="font-weight: bold; font-size: 14px; color: ${AZUL};">${esc(data.emisor.facturaNombre)}</div>
                  <div>${esc(data.emisor.direccion)}</div>
                  <div>${esc(data.emisor.ciudadEstado)}</div>
                  <div>${esc(data.emisor.email)}</div>
                </td>
              </tr>
            </table>
          </td>
          <td style="vertical-align: top; text-align: right; width: 210px;">
            <div style="display: inline-block; border: 2px solid ${AZUL}; border-radius: 4px; text-align: center; min-width: 190px;">
              <div style="background: ${AZUL}; color: #fff; font-weight: bold; padding: 5px 10px; letter-spacing: 1px;">REMISION</div>
              <div style="font-size: 20px; font-weight: bold; color: ${ROJO}; padding: 6px 10px;">${esc(data.numero)}</div>
              <div style="border-top: 1px solid ${AZUL}; padding: 5px 10px; font-size: 11px;">FECHA: <b style="color: #111;">${esc(data.fecha)}</b></div>
            </div>
          </td>
        </tr>
      </table>

      <!-- Datos del cliente -->
      <table style="margin-top: 16px; width: 100%; border-collapse: collapse; border: 1px solid #333;">
        <tr>
          <td style="${lblCli}">Cliente</td>
          <td style="${tdCli}">${esc(data.clienteNombre)}</td>
          <td style="${lblCli}">Días Crédito</td>
          <td style="${tdCli}">${esc(data.diasCredito)}</td>
        </tr>
        <tr>
          <td style="${lblCli}">Dirección</td>
          <td style="${tdCli}">${esc(data.direccion)}</td>
          <td style="${lblCli}">Num. Ext/Int</td>
          <td style="${tdCli}">${esc(data.numExtInt)}</td>
        </tr>
        <tr>
          <td style="${lblCli}">Colonia</td>
          <td style="${tdCli}">${esc(data.colonia)}</td>
          <td style="${lblCli}">Ciudad</td>
          <td style="${tdCli}">${esc(data.ciudad)}</td>
        </tr>
        <tr>
          <td style="${lblCli}">Denominación</td>
          <td style="${tdCli}">${esc(data.moneda)}</td>
          <td style="${lblCli}"></td>
          <td style="${tdCli}"></td>
        </tr>
      </table>

      <!-- Servicios -->
      <table style="margin-top: 16px; width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="${thServ}">REF#</th>
            <th style="${thServ}">FECHA</th>
            <th style="${thServ}">EQ.</th>
            <th style="${thServ}">ORIGEN</th>
            <th style="${thServ}">DESTINO</th>
            <th style="${thServ}">DESCRIPCIÓN</th>
            <th style="${thServ}">IMPORTE</th>
          </tr>
        </thead>
        <tbody>
          ${filasHtml}
        </tbody>
      </table>

      <!-- Totales -->
      <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
        <tr>
          <td></td>
          <td style="width: 280px; vertical-align: top;">
            ${tcLinea}
            <div style="display: flex; justify-content: space-between; border: 2px solid ${AZUL}; border-radius: 3px; padding: 8px 12px; font-weight: bold; font-size: 14px;">
              <span style="color: ${AZUL};">TOTAL</span><span style="color: ${ROJO};">$ ${num2(data.total)}</span>
            </div>
          </td>
        </tr>
      </table>

      ${obsHtml}

      <div style="margin-top: 20px; font-size: 9.5px; color: #64748b; line-height: 1.4; text-align: justify;">
        Accounts are due upon receipts. A charge of 1.5% per month will be added to accounts over thirty days past due.
        In the event of default, the customer agrees to pay all costs of collection, including reasonable attorney's fees.
      </div>

      <div style="margin-top: 14px; text-align: center; font-weight: bold; color: ${AZUL}; letter-spacing: 1px;">THANK YOU FOR USING ROELCA INC.</div>
      <div style="text-align: center; color: ${AZUL}; font-size: 11px; margin-top: 4px;">www.roelca.com</div>
    </div>
  `;

  const elementoTemporal = document.createElement('div');
  elementoTemporal.innerHTML = htmlTemplate;
  document.body.appendChild(elementoTemporal);

  const numeroLimpio = (data.numero || 'Remision').replace(/\W/g, '_');
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const filename = `Remision_${numeroLimpio}_${timestamp}.pdf`;

  const opt = {
    margin:       10,
    filename:     filename,
    image:        { type: 'jpeg' as const, quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true },
    jsPDF:        { unit: 'mm', format: 'letter', orientation: 'portrait' as const },
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
      await html2pdf().set(opt).from(elementoTemporal).save();
    } finally {
      if (elementoTemporal.parentNode) document.body.removeChild(elementoTemporal);
    }
  })();
};