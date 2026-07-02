// src/features/facturacion/components/generarRemisionPDF.ts
//
// Genera la REMISIÓN en PDF directamente desde el navegador (sin librerías
// externas): construye un documento HTML con el mismo diseño de la remisión
// de Roelca (ej. D-6177) y abre el diálogo de impresión, donde el usuario
// puede elegir "Guardar como PDF".
//
// El emisor del encabezado lo decide quien llama (según la moneda):
//   · Remisión en DÓLARES (USD) → nombre de Camila.
//   · Remisión en PESOS   (MXN) → nombre de Rolando.

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
  logoUrl?: string;        // por defecto /logo-roelca.png
}

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
  const logo = data.logoUrl || '/logo-roelca.png';

  const filasHtml = (data.filas || []).map((r) => `
    <tr>
      <td class="c">${esc(r.ref)}</td>
      <td class="c">${esc(r.fecha)}</td>
      <td class="c">${esc(r.equipo)}</td>
      <td>${esc(r.origen)}</td>
      <td>${esc(r.destino)}</td>
      <td>${esc(r.descripcion)}</td>
      <td class="r">$ ${num2(r.importe)}</td>
    </tr>`).join('');

  const tcLinea = (data.fechaTipoCambio || data.tipoCambio)
    ? `<div class="tc">Tipo de Cambio de DOF del día ${esc(data.fechaTipoCambio)} &nbsp; $ ${esc(data.tipoCambio)}</div>`
    : '';

  const obsHtml = data.observaciones
    ? `<div class="obs"><span class="obs-t">OBSERVACIONES:</span> ${esc(data.observaciones)}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Remisión ${esc(data.numero)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 24px 30px; font-size: 12px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; }
  .company { display: flex; gap: 14px; align-items: flex-start; }
  .company img { width: 90px; height: auto; object-fit: contain; }
  .company .info { color: #1d4ed8; line-height: 1.35; }
  .company .info .name { font-weight: bold; font-size: 14px; color: #1d4ed8; }
  .rem-box { border: 2px solid #1d4ed8; border-radius: 4px; text-align: center; min-width: 190px; }
  .rem-box .h { background: #1d4ed8; color: #fff; font-weight: bold; padding: 5px 10px; letter-spacing: 1px; }
  .rem-box .n { font-size: 20px; font-weight: bold; color: #b91c1c; padding: 6px 10px; }
  .rem-box .f { border-top: 1px solid #1d4ed8; padding: 5px 10px; font-size: 11px; }
  .rem-box .f b { color: #111; }
  .cliente { margin-top: 16px; border: 1px solid #333; border-radius: 3px; width: 100%; border-collapse: collapse; }
  .cliente td { border: 1px solid #333; padding: 5px 8px; vertical-align: top; }
  .cliente .lbl { background: #f1f5f9; font-weight: bold; width: 120px; font-size: 10px; text-transform: uppercase; color: #334155; }
  table.serv { margin-top: 16px; width: 100%; border-collapse: collapse; }
  table.serv th { background: #1d4ed8; color: #fff; padding: 6px 6px; font-size: 10px; text-transform: uppercase; border: 1px solid #1d4ed8; }
  table.serv td { border: 1px solid #cbd5e1; padding: 5px 6px; font-size: 11px; }
  table.serv td.c { text-align: center; }
  table.serv td.r { text-align: right; white-space: nowrap; }
  .totales { margin-top: 10px; display: flex; justify-content: flex-end; }
  .totales .box { min-width: 260px; }
  .tc { text-align: right; font-size: 11px; color: #334155; margin-bottom: 4px; }
  .total-row { display: flex; justify-content: space-between; border: 2px solid #1d4ed8; border-radius: 3px; padding: 8px 12px; font-weight: bold; font-size: 14px; }
  .total-row .t { color: #1d4ed8; }
  .total-row .v { color: #b91c1c; }
  .obs { margin-top: 14px; border: 1px solid #cbd5e1; border-radius: 3px; padding: 8px 10px; font-size: 11px; }
  .obs .obs-t { font-weight: bold; color: #334155; }
  .terms { margin-top: 20px; font-size: 9.5px; color: #64748b; line-height: 1.4; text-align: justify; }
  .thanks { margin-top: 14px; text-align: center; font-weight: bold; color: #1d4ed8; letter-spacing: 1px; }
  .web { text-align: center; color: #1d4ed8; font-size: 11px; margin-top: 4px; }
  @media print { body { padding: 10px 14px; } }
</style>
</head>
<body>
  <div class="top">
    <div class="company">
      <img src="${esc(logo)}" alt="ROELCA" onerror="this.style.display='none'" />
      <div class="info">
        <div class="name">${esc(data.emisor.facturaNombre)}</div>
        <div>${esc(data.emisor.direccion)}</div>
        <div>${esc(data.emisor.ciudadEstado)}</div>
        <div>${esc(data.emisor.email)}</div>
      </div>
    </div>
    <div class="rem-box">
      <div class="h">REMISION</div>
      <div class="n">${esc(data.numero)}</div>
      <div class="f">FECHA: <b>${esc(data.fecha)}</b></div>
    </div>
  </div>

  <table class="cliente">
    <tr>
      <td class="lbl">Cliente</td>
      <td>${esc(data.clienteNombre)}</td>
      <td class="lbl">Días Crédito</td>
      <td>${esc(data.diasCredito)}</td>
    </tr>
    <tr>
      <td class="lbl">Dirección</td>
      <td>${esc(data.direccion)}</td>
      <td class="lbl">Num. Ext/Int</td>
      <td>${esc(data.numExtInt)}</td>
    </tr>
    <tr>
      <td class="lbl">Colonia</td>
      <td>${esc(data.colonia)}</td>
      <td class="lbl">Ciudad</td>
      <td>${esc(data.ciudad)}</td>
    </tr>
    <tr>
      <td class="lbl">Denominación</td>
      <td>${esc(data.moneda)}</td>
      <td class="lbl"></td>
      <td></td>
    </tr>
  </table>

  <table class="serv">
    <thead>
      <tr>
        <th>REF#</th>
        <th>FECHA</th>
        <th>EQ.</th>
        <th>ORIGEN</th>
        <th>DESTINO</th>
        <th>DESCRIPCIÓN</th>
        <th>IMPORTE</th>
      </tr>
    </thead>
    <tbody>
      ${filasHtml}
    </tbody>
  </table>

  <div class="totales">
    <div class="box">
      ${tcLinea}
      <div class="total-row"><span class="t">TOTAL</span><span class="v">$ ${num2(data.total)}</span></div>
    </div>
  </div>

  ${obsHtml}

  <div class="terms">
    Accounts are due upon receipts. A charge of 1.5% per month will be added to accounts over thirty days past due.
    In the event of default, the customer agrees to pay all costs of collection, including reasonable attorney's fees.
  </div>

  <div class="thanks">THANK YOU FOR USING ROELCA INC.</div>
  <div class="web">www.roelca.com</div>

  <script>
    window.onload = function () { setTimeout(function () { try { window.print(); } catch (e) {} }, 300); };
  </script>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) {
    alert('El navegador bloqueó la ventana emergente. Permite las ventanas emergentes (pop-ups) de este sitio para poder generar la remisión en PDF.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
};