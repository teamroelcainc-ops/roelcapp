// src/features/facturacion/components/generarRemisionPDF.ts
//
// ═══════════════════════════════════════════════════════════════════════
// REMISIÓN EN PDF — diseño limpio y profesional (réplica del formato oficial)
// -----------------------------------------------------------------------
// Se genera con la MISMA técnica del resto de documentos: se arma un HTML en
// un <div> temporal, se ESPERA a que las imágenes (incluido el logo) terminen
// de decodificar y se "fotografía" con html2pdf/html2canvas.
//
// ⚠️ LOGO: va INCRUSTADO en este mismo archivo (LOGO_ROELCA_B64), por lo que
// aparece SIEMPRE, sin depender de getLogoPdf()/LOGO_DEFAULT ni de URLs/Storage.
// Si el dashboard llega a pasar un logo propio en data.logoBase64, ese tiene
// prioridad; si no, se usa el incrustado.
//
// DISEÑO (según formato oficial):
//   · Encabezado SIN azul. Logo a la IZQUIERDA.
//   · Nombre de la empresa / dueño CENTRADO al medio (color cian del logo).
//   · Caja "REMISION" a la derecha: folio en rojo, FECHA debajo.
//   · Tabla de cliente limpia: etiquetas en negritas dentro de la misma celda.
//   · Encabezados de la tabla de servicios SIN relleno de color (solo bordes).
//   · TOTAL en NEGRO (no rojo).
//
// El emisor del encabezado lo decide quien llama (según la moneda):
//   · Remisión en DÓLARES (USD) → nombre de Camila.
//   · Remisión en PESOS   (MXN) → nombre de Rolando.
// ═══════════════════════════════════════════════════════════════════════

import { cargarHtml2pdf } from '../../../shared/utils/pdf'; // ✅ V00534: html2pdf se carga al generar el PDF

import { logoListo, RUTA_LOGO_ROELCA_CHICO } from '../../../shared/utils/logo'; // ✅ V00534: el logo es un archivo (public/logo-roelca-chico.png)

export interface EmisorRemision {
  facturaNombre: string;
  direccion: string;
  ciudadEstado: string;
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
  moneda: string;
  observaciones: string;
  fechaTipoCambio: string;
  tipoCambio: string;
  total: number;
  filas: RemisionFila[];
  logoBase64?: string;
}

// ── Paleta del diseño oficial ───────────────────────────────────────────
const CIAN  = '#0e97c4';
const ROJO  = '#c00000';
const BORDE = '#333333';
const TINTA = '#111111';

/** Prioriza un logo pasado por el dashboard; si no, usa el incrustado. */
const resolverLogo = (logoBase64?: string) => logoBase64 || logoListo(RUTA_LOGO_ROELCA_CHICO); // ✅ V00534: dataURL si ya se convirtió; si no, el archivo (se espera a que cargue)

const esc = (v: any): string =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const num2 = (n: any): string => {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Deja solo la CAJA (sin placas) en el campo de remolque / equipo.
// El valor llega como "caja placas" (ej.: "45209 4512KDD") y nos quedamos con
// el primer token: "45209". Si cambia el formato, este es el único punto a tocar.
const soloCaja = (valor: any): string => {
  const s = String(valor === null || valor === undefined ? '' : valor).trim();
  if (!s) return '';
  return s.split(/\s+/)[0];
};

export const generarRemisionPDF = (data: RemisionData): void => {
  const logoSrc = resolverLogo(data.logoBase64);
  const logoHeader = logoSrc
    ? `<img src="${logoSrc}" style="width: 130px; height: auto; display: block;" />`
    : '';

  const cInfo = `border: 1px solid ${BORDE}; padding: 6px 9px; font-size: 11px; vertical-align: top; line-height: 1.35; color: ${TINTA};`;
  const lbl   = `font-weight: bold; color: ${TINTA};`;

  const tdC = `border: 1px solid ${BORDE}; padding: 6px; font-size: 10.5px; text-align: center; color: ${TINTA};`;
  const tdL = `border: 1px solid ${BORDE}; padding: 6px; font-size: 10.5px; text-align: left; color: ${TINTA};`;
  const tdR = `border: 1px solid ${BORDE}; padding: 6px; font-size: 10.5px; text-align: right; white-space: nowrap; color: ${TINTA};`;
  const th  = `border: 1px solid ${BORDE}; padding: 7px 6px; font-size: 10px; font-weight: bold; text-align: center; text-transform: uppercase; letter-spacing: .3px; color: ${TINTA}; background: #ffffff;`;

  const filasHtml = (data.filas || []).map((r) => `
    <tr>
      <td style="${tdC}">${esc(r.ref)}</td>
      <td style="${tdC}">${esc(r.fecha)}</td>
      <td style="${tdC}">${esc(soloCaja(r.equipo))}</td>
      <td style="${tdL}">${esc(r.origen)}</td>
      <td style="${tdL}">${esc(r.destino)}</td>
      <td style="${tdL}">${esc(r.descripcion)}</td>
      <td style="${tdR}">${num2(r.importe)}</td>
    </tr>`).join('');

  const tcTexto = (data.fechaTipoCambio || data.tipoCambio)
    ? `Tipo de Cambio de DOF del día ${esc(data.fechaTipoCambio)} &nbsp; $ ${esc(data.tipoCambio)}`
    : '';

  const obsHtml = data.observaciones
    ? `<div style="margin-top: 12px; border: 1px solid ${BORDE}; padding: 7px 10px; font-size: 10.5px; color: ${TINTA};"><span style="${lbl}">OBSERVACIONES:</span> ${esc(data.observaciones)}</div>`
    : '';

  const htmlTemplate = `
    <div style="width: 100%; max-width: 760px; margin: 0 auto; font-family: Arial, Helvetica, sans-serif; color: ${TINTA}; font-size: 12px; background: #fff; box-sizing: border-box; padding: 18px;">

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 14px;">
        <tr>
          <td style="vertical-align: top; width: 150px;">${logoHeader}</td>

          <td style="vertical-align: top; text-align: center; padding: 2px 10px;">
            <div style="font-weight: bold; font-size: 13px; color: ${CIAN}; letter-spacing: .3px;">${esc(data.emisor.facturaNombre)}</div>
            <div style="font-size: 11px; color: ${CIAN};">${esc(data.emisor.direccion)}</div>
            <div style="font-size: 11px; color: ${CIAN};">${esc(data.emisor.ciudadEstado)}</div>
            <div style="font-size: 11px; color: ${CIAN};">${esc(data.emisor.email)}</div>
          </td>

          <td style="vertical-align: top; width: 175px; text-align: right;">
            <table style="border-collapse: collapse; margin-left: auto; width: 170px;">
              <tr>
                <td style="border: 1px solid ${BORDE}; text-align: center; font-weight: bold; font-size: 11px; letter-spacing: 1px; padding: 5px 8px; color: ${TINTA};">REMISION</td>
              </tr>
              <tr>
                <td style="border: 1px solid ${BORDE}; border-top: none; text-align: center; font-weight: bold; font-size: 17px; color: ${ROJO}; padding: 6px 8px;">${esc(data.numero)}</td>
              </tr>
              <tr>
                <td style="border: 1px solid ${BORDE}; border-top: none; text-align: center; font-size: 11px; padding: 6px 8px; color: ${TINTA};"><span style="${lbl}">FECHA</span>&nbsp; ${esc(data.fecha)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="${cInfo}" colspan="3"><span style="${lbl}">CLIENTE:</span> ${esc(data.clienteNombre)}</td>
          <td style="${cInfo}"><span style="${lbl}">DÍAS CRÉDITO:</span> ${esc(data.diasCredito)}</td>
        </tr>
        <tr>
          <td style="${cInfo}" colspan="2" rowspan="2"><span style="${lbl}">DIRECCIÓN:</span> ${esc(data.direccion)}</td>
          <td style="${cInfo}"><span style="${lbl}">NUM. EXT/INT:</span> ${esc(data.numExtInt)}</td>
          <td style="${cInfo}"><span style="${lbl}">COLONIA:</span> ${esc(data.colonia)}</td>
        </tr>
        <tr>
          <td style="${cInfo}"><span style="${lbl}">CIUDAD:</span> ${esc(data.ciudad)}</td>
          <td style="${cInfo}"><span style="${lbl}">DENOMINACIÓN:</span> ${esc(data.moneda)}</td>
        </tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; margin-top: 14px;">
        <thead>
          <tr>
            <th style="${th}">REF#</th>
            <th style="${th}">FECHA</th>
            <th style="${th}">EQ.</th>
            <th style="${th}">ORIGEN</th>
            <th style="${th}">DESTINO</th>
            <th style="${th}">DESCRIPCIÓN</th>
            <th style="${th}">IMPORTE</th>
          </tr>
        </thead>
        <tbody>
          ${filasHtml}
        </tbody>
      </table>

      <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
        <tr>
          <td style="text-align: center; font-size: 11px; font-weight: bold; color: ${TINTA}; vertical-align: middle;">${tcTexto}</td>
          <td style="width: 320px; vertical-align: middle;">
            <table style="border-collapse: collapse; width: 100%;">
              <tr>
                <td style="border: 2px solid ${BORDE}; text-align: center; font-weight: bold; font-size: 16px; padding: 9px 12px; color: ${TINTA};">TOTAL</td>
                <td style="border: 2px solid ${BORDE}; border-left: none; text-align: right; font-weight: bold; font-size: 16px; padding: 9px 14px; color: ${TINTA}; white-space: nowrap;">$ ${num2(data.total)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      ${obsHtml}

      <div style="margin-top: 20px; font-size: 9px; color: #6b7280; line-height: 1.4; text-align: justify;">
        Accounts are due upon receipt. A charge of 1.5% per month will be added to accounts over thirty days past due.
        In the event of default, the customer agrees to pay all costs of collection, including reasonable attorney\'s fees.
      </div>
    </div>
  `;

  const elementoTemporal = document.createElement('div');
  elementoTemporal.innerHTML = htmlTemplate;
  document.body.appendChild(elementoTemporal);

  const numeroLimpio = (data.numero || 'Remision').replace(/\W/g, '_');
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const filename = `Remision_${numeroLimpio}_${timestamp}.pdf`;

  const opt = {
    margin:      10,
    filename:    filename,
    image:       { type: 'jpeg' as const, quality: 0.98 },
    html2canvas: { backgroundColor: '#ffffff', scale: 2, useCORS: true },
    jsPDF:       { unit: 'mm', format: 'letter', orientation: 'portrait' as const },
  };

  (async () => {
    const _imgs = Array.from(elementoTemporal.querySelectorAll('img')) as HTMLImageElement[];
    await Promise.all(_imgs.map(im => (im.complete && im.naturalWidth > 0)
      ? Promise.resolve()
      : new Promise<void>(res => { im.onload = () => res(); im.onerror = () => res(); })));
    try {
      const html2pdf = await cargarHtml2pdf();
      await html2pdf().set(opt).from(elementoTemporal).save();
    } finally {
      if (elementoTemporal.parentNode) document.body.removeChild(elementoTemporal);
    }
  })();
};