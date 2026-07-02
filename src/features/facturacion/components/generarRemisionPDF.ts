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

import html2pdf from 'html2pdf.js';

// Logo ROELCA incrustado (PNG base64). Autocontenido: no depende de nada externo.
const LOGO_ROELCA_B64 =
  'data:image/png;base64,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';

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
const resolverLogo = (logoBase64?: string) => logoBase64 || LOGO_ROELCA_B64;

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
    html2canvas: { scale: 2, useCORS: true },
    jsPDF:       { unit: 'mm', format: 'letter', orientation: 'portrait' as const },
  };

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