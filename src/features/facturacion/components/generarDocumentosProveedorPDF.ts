// src/features/facturacion/components/generarDocumentosProveedorPDF.ts
//
// ═══════════════════════════════════════════════════════════════════════
// DOCUMENTOS PDF DEL LADO PROVEEDOR (Facturación a Proveedores)
// -----------------------------------------------------------------------
// Este archivo genera DOS documentos, ambos con la MISMA técnica del resto
// (se arma un HTML temporal, se espera a que el logo termine de decodificar
// y se "fotografía" con html2pdf/html2canvas):
//
//   1) CONFIRMACIÓN DE TARIFA A PROVEEDOR  → por OPERACIÓN
//      (pestaña "Asignar Operaciones"). Carta vertical. Réplica del formato
//      que se generaba en AppSheet/Apps Script.
//
//   2) RATE DE PROVEEDOR ("Relación de referencias amparadas con la factura
//      del proveedor") → por FACTURA (pestaña "Historial de Facturas").
//      Carta horizontal. Réplica del formato de AppSheet/Apps Script.
//
// ⚠️ LOGO: va INCRUSTADO en este mismo archivo (LOGO_ROELCA_B64), por lo que
// aparece SIEMPRE, sin depender de URLs ni de Storage. Si quien llama pasa
// un logo propio en data.logoBase64, ese tiene prioridad.
// ═══════════════════════════════════════════════════════════════════════

import { cargarHtml2pdf } from '../../../shared/utils/pdf'; // ✅ V00534: html2pdf se carga al generar el PDF

// Logo ROELCA incrustado (PNG base64). Autocontenido: no depende de nada externo.
import { logoListo, RUTA_LOGO_ROELCA_CHICO } from '../../../shared/utils/logo'; // ✅ V00534: el logo es un archivo (public/logo-roelca-chico.png)

// ── Paleta (misma familia que la Remisión + verde del Rate) ─────────────
const CIAN   = '#00AEEF';
const NARANJA = '#F15A24';
const ROJO   = '#d32f2f';
const AZUL   = '#007bb5';
const VERDE  = '#2e7d32';
const BORDE  = '#000000';
const GRISCL = '#e0e0e0';
const TINTA  = '#111111';

const resolverLogo = (logoBase64?: string) => logoBase64 || logoListo(RUTA_LOGO_ROELCA_CHICO); // ✅ V00534

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

// Descarga el HTML temporal como PDF, esperando a que carguen las imágenes.
const descargarComoPDF = (html: string, filename: string, orientation: 'portrait' | 'landscape'): void => {
  const elementoTemporal = document.createElement('div');
  elementoTemporal.innerHTML = html;
  document.body.appendChild(elementoTemporal);

  const opt = {
    margin:      orientation === 'portrait' ? 10 : 6,
    filename:    filename,
    image:       { type: 'jpeg' as const, quality: 0.98 },
    html2canvas: { backgroundColor: '#ffffff', scale: 2, useCORS: true },
    jsPDF:       { unit: 'mm', format: 'letter', orientation },
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

const nombreArchivo = (prefijo: string, referencia: string): string => {
  const limpio = (referencia || 'Doc').replace(/\W/g, '_');
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  return `${prefijo}_${limpio}_${timestamp}.pdf`;
};

// ═══════════════════════════════════════════════════════════════════════
// 1) CONFIRMACIÓN DE TARIFA A PROVEEDOR (por operación)
// ═══════════════════════════════════════════════════════════════════════

export interface ConfirmacionTarifaData {
  coordinador: string;
  referencia: string;        // No. Referencia (LO-XXXXXX-XXX)
  remolque: string;
  tipoUnidad: string;
  placasRemolque: string;
  unidad: string;
  operador: string;
  fechaServicio: string;
  tipoCambio: string;        // Tipo de cambio DOF
  proveedor: string;
  tipoOperacion: string;     // Descripción del tarifario/convenio
  impoExpoMov: string;       // Importación / Exportación / Movimiento
  clienteOrigen: string;
  ciudadOrigen: string;
  clienteDestino: string;
  ciudadDestino: string;
  refCliente: string;
  facturadoEn: string;       // Moneda en la que se factura (Pesos / Dólares)
  monedaConvenio: string;    // Moneda del convenio (Pesos / Dólares)
  monedaPago?: string;       // ✅ Moneda de PAGO: manda en el TOTAL A FACT.
  convenioProv: string;      // Monto convenio
  costosAdic: string;        // Costos adicionales
  subtotalProv: string;      // Subtotal proveedor
  totalAFacturar: string;    // Total a facturar (ya convertido)
  emisorDireccion: string;   // Dirección Roelca (pie derecho)
  emisorCiudad: string;      // Ciudad/CP Roelca (pie derecho)
  observaciones?: string;    // ✅ NUEVO: observaciones impresas en el documento
  logoBase64?: string;
}

export const generarConfirmacionTarifaPDF = (data: ConfirmacionTarifaData): void => {
  const logoSrc = resolverLogo(data.logoBase64);

  const label = `background-color: #f8f9fa; width: 148px; padding: 6px 10px; text-align: right; text-transform: uppercase; font-weight: bold; border: 1px solid ${GRISCL}; border-right: none; font-size: 11px; color: ${TINTA}; vertical-align: middle;`;
  const value = `padding: 6px 10px; border: 1px solid ${GRISCL}; background-color: #ffffff; font-size: 11.5px; color: ${TINTA}; vertical-align: middle;`;
  const valueBold   = `${value} font-weight: bold;`;
  const valueYellow = `${value} background-color: #fff9c4; font-weight: bold;`;
  const valueBlue   = `${value} color: ${AZUL}; font-weight: bold;`;
  const valueRed    = `${value} color: ${ROJO}; font-weight: bold;`;

  const filaSimple = (lbl: string, val: string, estiloVal: string) => `
    <tr>
      <td style="${label}">${lbl}</td>
      <td style="${estiloVal}">${esc(val)}</td>
    </tr>`;

  const filaMonto = (lbl: string, monto: string, moneda: string, estiloVal: string) => `
    <tr>
      <td style="${label}">${lbl}</td>
      <td style="${estiloVal}">
        <table style="width: 100%; border-collapse: collapse;"><tr>
          <td style="text-align: left; padding: 0; border: none; font: inherit; color: inherit;">${esc(monto)}</td>
          <td style="text-align: right; padding: 0; border: none; font: inherit; color: inherit;">${esc(moneda)}</td>
        </tr></table>
      </td>
    </tr>`;

  const htmlTemplate = `
    <div style="width: 100%; max-width: 780px; margin: 0 auto; font-family: Arial, Helvetica, sans-serif; color: ${TINTA}; background: #fff; box-sizing: border-box; padding: 14px;">

      <!-- Encabezado -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 14px; border-bottom: 2px solid ${GRISCL};">
        <tr>
          <td style="width: 170px; text-align: center; padding-bottom: 8px;">
            <img src="${logoSrc}" style="max-width: 150px; height: auto; display: inline-block;" />
            <div style="color: ${CIAN}; font-weight: bold; font-size: 10px; text-transform: uppercase;">LOGISTICA</div>
            <div style="color: ${NARANJA}; font-weight: bold; font-size: 10px;">www.roelca.com</div>
          </td>
          <td style="text-align: center; vertical-align: middle;">
            <div style="font-size: 19px; font-weight: bold; text-decoration: underline; color: ${TINTA};">CONFIRMACION DE TARIFA A PROVEEDOR</div>
          </td>
        </tr>
      </table>

      <!-- Bloque 1: datos de la unidad / referencia -->
      <table style="width: 100%; border-collapse: separate; border-spacing: 0;">
        <tr>
          <td style="width: 50%; vertical-align: top; padding-right: 8px;">
            <table style="width: 100%; border-collapse: collapse;">
              ${filaSimple('COORDINADOR', data.coordinador, valueBold)}
              ${filaSimple('REMOLQUE', data.remolque, valueBold)}
              ${filaSimple('TIPO DE UNIDAD', data.tipoUnidad, valueYellow)}
              ${filaSimple('PLACAS REMOLQUE', data.placasRemolque, valueYellow)}
              ${filaSimple('UNIDAD', data.unidad, valueYellow)}
              ${filaSimple('OPERADOR', data.operador, valueBold)}
            </table>
          </td>
          <td style="width: 50%; vertical-align: top; padding-left: 8px;">
            <table style="width: 100%; border-collapse: collapse;">
              ${filaSimple('No. REFERENCIA', data.referencia, valueYellow)}
              ${filaSimple('FECHA DEL SERVICIO', data.fechaServicio, valueBold)}
              ${filaSimple('TIPO DE CAMBIO DOF $', data.tipoCambio, valueBold)}
            </table>
            <div style="height: 10px;"></div>
            <table style="width: 100%; border-collapse: collapse;">
              ${filaSimple('PROVEEDOR', data.proveedor, valueBold)}
              ${filaSimple('TIPO DE OPER.', data.tipoOperacion, valueBold)}
              ${filaSimple('IMPO / EXPO / MOV', data.impoExpoMov, valueBold)}
            </table>
          </td>
        </tr>
      </table>

      <div style="height: 16px;"></div>

      <!-- Bloque 2: ruta y montos -->
      <table style="width: 100%; border-collapse: separate; border-spacing: 0;">
        <tr>
          <td style="width: 50%; vertical-align: top; padding-right: 8px;">
            <table style="width: 100%; border-collapse: collapse;">
              ${filaSimple('CLIENTE ORIGEN', data.clienteOrigen, valueBold)}
              ${filaSimple('CIUDAD ORIGEN', data.ciudadOrigen, valueBold)}
            </table>
            <div style="height: 10px;"></div>
            <table style="width: 100%; border-collapse: collapse;">
              ${filaSimple('CLIENTE DESTINO', data.clienteDestino, valueBold)}
              ${filaSimple('CIUDAD DESTINO', data.ciudadDestino, valueBold)}
            </table>
            <div style="height: 10px;"></div>
            <table style="width: 100%; border-collapse: collapse;">
              ${filaSimple('#REF CLIENTE', data.refCliente, valueBold)}
            </table>
          </td>
          <td style="width: 50%; vertical-align: top; padding-left: 8px;">
            <table style="width: 100%; border-collapse: collapse;">
              ${filaSimple('FACTURADO EN:', data.facturadoEn, valueBlue)}
              ${filaMonto('CONVENIO PROV. $', data.convenioProv, data.monedaConvenio, valueBlue)}
              ${filaMonto('COSTOS ADIC. $', data.costosAdic, data.monedaConvenio, valueBlue)}
              ${filaMonto('SUBTOTAL PROV. $', data.subtotalProv, data.monedaConvenio, valueBlue)}
              ${filaMonto('TOTAL A FACT. $', data.totalAFacturar, data.monedaPago || data.facturadoEn, valueRed)}
            </table>
          </td>
        </tr>
      </table>

      ${data.observaciones && String(data.observaciones).trim() ? `
      <!-- ✅ NUEVO: Observaciones -->
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        <tr>
          <td style="${label} vertical-align: top; padding-top: 8px;">OBSERVACIONES</td>
          <td style="${value} line-height: 1.5; white-space: pre-wrap;">${esc(String(data.observaciones).trim())}</td>
        </tr>
      </table>` : ''}

      <!-- Pie: datos de facturación -->
      <table style="width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 18px;">
        <tr>
          <td style="width: 50%; vertical-align: top; padding-right: 8px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="${label} text-align: left; line-height: 1.6; vertical-align: top; padding-top: 8px;">
                  FACTURAR A:<br/>DIRECCION:<br/>C.P:<br/>RFC / TAX ID:<br/>TEL:<br/>CORREO:
                </td>
                <td style="${value} background-color: #fafafa;">&nbsp;</td>
              </tr>
            </table>
          </td>
          <td style="width: 50%; vertical-align: middle; padding-left: 8px; text-align: center;">
            <div style="border-top: 2px solid ${GRISCL}; padding-top: 12px; font-size: 11px; line-height: 1.5;">
              <div style="font-weight: bold;">ROELCAINC, S.A. DE C.V.</div>
              <div>${esc(data.emisorDireccion)}</div>
              <div>${esc(data.emisorCiudad)}</div>
              <div style="font-weight: bold; margin-top: 5px;">ROE - 180119 - IV4 / 8671964690</div>
              <div style="color: ${AZUL}; font-weight: bold;">proveedores@roelca.com</div>
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;

  descargarComoPDF(htmlTemplate, nombreArchivo('ConfirmacionTarifa', data.referencia), 'portrait');
};

// ═══════════════════════════════════════════════════════════════════════
// 2) RATE DE PROVEEDOR (relación de referencias por factura)
// ═══════════════════════════════════════════════════════════════════════

export interface RateProveedorFila {
  ref: string;
  equipo: string;
  origen: string;
  destino: string;
  descripcion: string;
  facturaRoelca: string;
  cobrado: number;     // Lo que Roelca cobró al cliente (siempre en pesos)
  subtotalProv?: number; // Subtotal del proveedor (convenio + costos, en la moneda del convenio)
  proveedor: number;   // Conversión a pesos de lo que se paga al proveedor
}

export interface RateProveedorData {
  fecha: string;              // Fecha del documento
  facturaProveedor: string;   // # de factura del proveedor
  proveedorNombre: string;
  diasCredito: string;
  vencimiento: string;
  direccion: string;
  colonia: string;
  ciudad: string;
  moneda: string;             // PESOS / DÓLARES (para los encabezados de columnas)
  observaciones: string;
  filas: RateProveedorFila[];
  logoBase64?: string;
}

export const generarRateProveedorPDF = (data: RateProveedorData): void => {
  const logoSrc = resolverLogo(data.logoBase64);

  const th = `border: 1px solid ${BORDE}; padding: 7px 4px; font-size: 10px; font-weight: bold; text-align: center; background-color: ${GRISCL}; color: ${TINTA};`;
  const td = `border-left: 1px solid ${BORDE}; border-right: 1px solid ${BORDE}; padding: 8px 4px; font-size: 10px; text-align: center; vertical-align: top; color: ${TINTA};`;

  const celdaMonto = (v: number) => `
    <table style="width: 100%; border-collapse: collapse;"><tr>
      <td style="text-align: left; padding: 0 4px; border: none; font-size: 10px; color: inherit;">$</td>
      <td style="text-align: right; padding: 0 4px; border: none; font-size: 10px; color: inherit;">${num2(v)}</td>
    </tr></table>`;

  let totalCobrado = 0, totalProveedor = 0, totalUtilidad = 0;
  let totalSubtotalProv = 0;
  const filasHtml = (data.filas || []).map((r) => {
    const cobrado = Number(r.cobrado) || 0;
    const subtotalProv = Number(r.subtotalProv) || 0;
    const proveedor = Number(r.proveedor) || 0;
    const utilidad = cobrado - proveedor;
    totalCobrado += cobrado; totalSubtotalProv += subtotalProv; totalProveedor += proveedor; totalUtilidad += utilidad;
    return `
    <tr>
      <td style="${td}">${esc(r.ref)}</td>
      <td style="${td}">${esc(r.equipo)}</td>
      <td style="${td}">${esc(r.origen)}</td>
      <td style="${td}">${esc(r.destino)}</td>
      <td style="${td}">${esc(r.descripcion)}</td>
      <td style="${td}">${esc(r.facturaRoelca)}</td>
      <td style="${td}">${celdaMonto(cobrado)}</td>
      <td style="${td}">${celdaMonto(subtotalProv)}</td>
      <td style="${td}">${celdaMonto(proveedor)}</td>
      <td style="${td} ${utilidad < 0 ? `color: ${ROJO}; font-weight: bold;` : ''}">${celdaMonto(utilidad)}</td>
    </tr>`;
  }).join('');

  const filasVacias = (data.filas || []).length === 0
    ? `<tr><td colspan="10" style="${td} padding: 16px;">No hay servicios registrados.</td></tr>`
    : '';

  const htmlTemplate = `
    <div style="width: 100%; max-width: 990px; margin: 0 auto; font-family: Arial, Helvetica, sans-serif; color: ${TINTA}; background: #fff; box-sizing: border-box; padding: 12px 16px; font-size: 11px;">

      <!-- Encabezado -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
        <tr>
          <td style="width: 150px; text-align: center; vertical-align: top;">
            <img src="${logoSrc}" style="max-width: 110px; height: auto; display: inline-block;" />
            <div style="color: ${CIAN}; font-weight: bold; font-size: 10px; text-transform: uppercase;">LOGISTICA</div>
            <div style="color: ${NARANJA}; font-weight: bold; font-size: 10px;">www.roelca.com</div>
          </td>
          <td style="text-align: center; vertical-align: middle; padding: 0 10px;">
            <div style="color: ${VERDE}; font-size: 15px; font-weight: bold;">RELACION DE REFERENCIAS AMPARADAS CON LA FACTURA DEL PROVEEDOR</div>
          </td>
          <td style="width: 160px; vertical-align: top;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
              <tr><th style="${th}">FACTURA DEL PROVEEDOR</th></tr>
              <tr><td style="border: 1px solid ${BORDE}; padding: 5px; text-align: center; font-weight: bold; color: ${ROJO}; font-size: 10.5px;">${esc(data.facturaProveedor)}</td></tr>
            </table>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><th style="${th}">FECHA</th></tr>
              <tr><td style="border: 1px solid ${BORDE}; padding: 5px; text-align: center; font-weight: bold; font-size: 10.5px; color: ${TINTA};">${esc(data.fecha)}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Datos del proveedor -->
      <div style="border-top: 1px solid ${BORDE}; border-bottom: 1px solid ${BORDE}; padding: 7px 0; margin-bottom: 12px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 10.5px;">
          <tr>
            <td style="width: 80px; font-weight: bold; padding: 2px 0;">PROVEEDOR:</td>
            <td style="width: 300px; text-transform: uppercase; padding: 2px 0;">${esc(data.proveedorNombre)}</td>
            <td style="width: 140px; font-weight: bold; text-align: right; padding: 2px 12px 2px 0;">DIAS DE CREDITO:</td>
            <td style="width: 50px; padding: 2px 0;">${esc(data.diasCredito)}</td>
            <td style="width: 120px; font-weight: bold; text-align: right; padding: 2px 12px 2px 0;">VENCIMIENTO:</td>
            <td style="color: ${ROJO}; font-weight: bold; padding: 2px 0;">${esc(data.vencimiento)}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; padding: 2px 0;">DIRECCION</td>
            <td style="text-transform: uppercase; padding: 2px 0;" colspan="3">${esc(data.direccion)}</td>
            <td></td><td></td>
          </tr>
          <tr>
            <td style="font-weight: bold; padding: 2px 0;">COLONIA</td>
            <td style="text-transform: uppercase; padding: 2px 0;" colspan="3">${esc(data.colonia)}</td>
            <td></td><td></td>
          </tr>
          <tr>
            <td style="font-weight: bold; padding: 2px 0;">CIUDAD</td>
            <td style="text-transform: uppercase; padding: 2px 0;">${esc(data.ciudad)}</td>
            <td style="font-weight: bold; text-align: right; padding: 2px 12px 2px 0;"></td>
            <td></td>
            <td style="font-weight: bold; text-align: right; padding: 2px 12px 2px 0;">MONEDA</td>
            <td style="color: ${ROJO}; font-weight: bold; text-transform: uppercase; padding: 2px 0;">${esc(data.moneda)}</td>
          </tr>
        </table>
      </div>

      <!-- Tabla principal -->
      <table style="width: 100%; border-collapse: collapse; border: 1px solid ${BORDE}; table-layout: fixed;">
        <thead>
          <tr>
            <th style="${th} width: 10%;">REF#</th>
            <th style="${th} width: 8%;">EQ.</th>
            <th style="${th} width: 12%;">ORIGEN</th>
            <th style="${th} width: 12%;">DESTINO</th>
            <th style="${th} width: 13%;">DESCRIPCION</th>
            <th style="${th} width: 8%;">FACTURA ROELCA</th>
            <th style="${th} width: 9%;">COBRADO EN PESOS</th>
            <th style="${th} width: 9%;">SUBTOTAL PROV.</th>
            <th style="${th} width: 9%;">CONVERSION A PESOS</th>
            <th style="${th} width: 10%;">UTILIDAD</th>
          </tr>
        </thead>
        <tbody>
          ${filasHtml}
          ${filasVacias}
          <tr>
            <td colspan="9" style="border-left: 1px solid ${BORDE}; border-right: 1px solid ${BORDE}; height: 30px;">&nbsp;</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5" style="border: 1px solid ${BORDE}; background-color: ${GRISCL}; font-weight: bold; text-align: center; padding: 6px 4px; font-size: 10px;">OBSERVACIONES${data.observaciones ? `: <span style="font-weight: normal;">${esc(data.observaciones)}</span>` : ''}</td>
            <td style="border: 1px solid ${BORDE}; text-align: center; padding: 6px 4px; font-size: 10px;">TOTAL</td>
            <td style="border: 1px solid ${BORDE}; padding: 6px 0; font-weight: bold;">${celdaMonto(totalCobrado)}</td>
            <td style="border: 1px solid ${BORDE}; padding: 6px 0; font-weight: bold;">${celdaMonto(totalSubtotalProv)}</td>
            <td style="border: 1px solid ${BORDE}; padding: 6px 0; font-weight: bold;">${celdaMonto(totalProveedor)}</td>
            <td style="border: 1px solid ${BORDE}; padding: 6px 4px; text-align: right; font-weight: bold; font-size: 10px; ${totalUtilidad < 0 ? `color: ${ROJO};` : ''}">${num2(totalUtilidad)}</td>
          </tr>
          <tr>
            <td colspan="10" style="border: 1px solid ${BORDE}; text-align: center; font-weight: bold; font-size: 16px; padding: 10px 0;">GRACIAS POR USAR TRANSPORTES ROELCA</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  descargarComoPDF(htmlTemplate, nombreArchivo('Rate_Proveedor', data.facturaProveedor), 'landscape');
};