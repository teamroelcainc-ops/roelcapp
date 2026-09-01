// src/features/convenios/generarTarifarioPDF.ts
// ---------------------------------------------------------------------------
// ✅ V00157: TARIFARIO EN PDF desde Convenios (clientes y proveedores).
//   Réplica del formato oficial de Roelca (tarifario Castañeda) con dos
//   diferencias pedidas: SIN la columna "Clave de Servicio" y con los datos
//   del convenio (entidad, moneda y crédito). Misma técnica que la Remisión:
//   HTML temporal + html2pdf (carta, vertical) y el logo incrustado.
// ---------------------------------------------------------------------------
import html2pdf from 'html2pdf.js';
import { LOGO_ROELCA_B64 } from '../facturacion/components/generarRemisionPDF';

export interface FilaTarifario {
  descripcion: string;
  tarifa: number | string;
  monedaNombre?: string; // moneda del detalle (opcional)
}

export interface TarifarioData {
  etiquetaEntidad: 'CLIENTE' | 'PROVEEDOR';
  entidadNombre: string;
  monedaEtiqueta: string;   // ej. "PESOS", "DOLARES" o "PESOS/DOLARES"
  creditoDias: string | number;
  filas: FilaTarifario[];
  numeroConvenio?: string;
}

const esc = (t: any) =>
  String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (v: number | string) => {
  const n = Number(v);
  return isNaN(n) ? esc(v) : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const NOTAS = [
  'Servicios en Falso se cobra el 50% del Servicio Solicitado.',
  'No realizamos cruces de Exportacion por la Aduana de Colombia.',
  'Para todo cruce se requiere la información necesaria para generar el Complemento Carta Porte.',
  'No se despachan embarques sin Complemento Carta Porte.',
  'Se consideran 2 hr libres para atencion de Rojos de Importacion e Inspecciones.',
  'Amarillos NO cuentan con horas libres.',
  'Se considera 1 hr libre para carga/descarga y entrega de Documentos y/o Despacho.',
  'Tarifas facturadas en Pesos, se multiplica por el Tipo de Cambio del Diario Oficial del dia del Servicio.',
  'Movimientos se cotizan como complemento de un Servicio de Cruce.',
  'Dias Festivos Mexicanos y Domingos todos los servicios se cobran DOBLE (Expo - Impo).',
  'Multas por Errores en Docs, Sobre Peso, Gruas por Fuera de Servicio de la caja, deberan ser pagadas de CONTADO.',
  'Distancias Extraordinarias SE COTIZAN POR EVENTO.',
  'Cobro por refacturacion $15 usd - $300 mxn',
];

export const generarTarifarioPDF = async (data: TarifarioData): Promise<void> => {
  const hoy = new Date();
  const fechaLarga = hoy.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const monedasDistintas = new Set(data.filas.map((f) => String(f.monedaNombre || '').trim()).filter(Boolean));
  const mostrarMonedaFila = monedasDistintas.size > 1;

  const filasHtml = data.filas.map((f, i) => `
    <tr>
      <td class="c-num">${i + 1}</td>
      <td class="c-desc">${esc(f.descripcion)}</td>
      <td class="c-tar">$&nbsp;${money(f.tarifa)}${mostrarMonedaFila && f.monedaNombre ? `<span class="mon"> ${esc(f.monedaNombre)}</span>` : ''}</td>
    </tr>`).join('');

  const html = `
  <div id="tarifario-pdf-root" style="width: 196mm; padding: 8mm 10mm; box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff;">
    <style>
      #tarifario-pdf-root * { box-sizing: border-box; }
      #tarifario-pdf-root .enc { display: flex; align-items: flex-start; }
      #tarifario-pdf-root .enc-logo { width: 34mm; }
      #tarifario-pdf-root .enc-logo img { width: 30mm; }
      #tarifario-pdf-root .enc-datos { flex: 1; text-align: center; }
      #tarifario-pdf-root .enc-nombre { color: #c00000; font-weight: bold; font-size: 13pt; }
      #tarifario-pdf-root .enc-linea { color: #1f6fb2; font-size: 9pt; line-height: 1.35; }
      #tarifario-pdf-root .enc-rfc { color: #c00000; font-weight: bold; font-size: 9.5pt; }
      #tarifario-pdf-root .fecha { text-align: right; font-size: 9pt; margin: 4mm 0 2mm; }
      #tarifario-pdf-root .fecha b { margin-right: 6mm; }
      #tarifario-pdf-root .datos { display: flex; justify-content: space-between; font-size: 9pt; margin-bottom: 3mm; }
      #tarifario-pdf-root table.tarifas { width: 100%; border-collapse: collapse; font-size: 9pt; }
      #tarifario-pdf-root table.tarifas th { border-bottom: 1.2px solid #000; padding: 1.2mm 1.5mm; font-size: 8.5pt; }
      #tarifario-pdf-root table.tarifas td { padding: 1.1mm 1.5mm; }
      #tarifario-pdf-root .c-num { width: 8mm; text-align: center; }
      #tarifario-pdf-root .c-desc { text-align: left; }
      #tarifario-pdf-root .c-tar { width: 30mm; text-align: right; white-space: nowrap; }
      #tarifario-pdf-root th.c-desc { text-align: center; }
      #tarifario-pdf-root th.c-tar { text-align: center; }
      #tarifario-pdf-root .mon { font-size: 7.5pt; color: #444; }
      #tarifario-pdf-root .notas { font-size: 8.3pt; margin-top: 5mm; line-height: 1.45; }
      #tarifario-pdf-root .notas div { margin-left: 5mm; }
      #tarifario-pdf-root .aviso { font-size: 8.6pt; margin-top: 5mm; }
      #tarifario-pdf-root .gracias { font-size: 8.6pt; margin-top: 4mm; }
      #tarifario-pdf-root .firma { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 7mm; font-size: 8.6pt; }
      #tarifario-pdf-root .firma-der { width: 88mm; text-align: center; }
      #tarifario-pdf-root .firma-linea { border-top: 1px solid #000; padding-top: 1mm; font-size: 8pt; }
      #tarifario-pdf-root .correo { color: #1f6fb2; text-decoration: underline; }
    </style>

    <div class="enc">
      <div class="enc-logo"><img src="${LOGO_ROELCA_B64}" alt="Roelca" /></div>
      <div class="enc-datos">
        <div class="enc-nombre">ROELCAINC S.A. DE C.V.</div>
        <div class="enc-linea">Mar de las Antillas #947, Col. La Paz, C.P. 88290<br/>Nuevo Laredo, Tamaulipas, México.<br/>Tel. + 52 (867) 196 4690</div>
        <div class="enc-rfc">ROE-180119-IV4</div>
        <div class="enc-linea">www.roelca.com</div>
      </div>
      <div class="enc-logo"></div>
    </div>

    <div class="fecha"><b>FECHA:</b>${esc(fechaLarga)}</div>

    <div class="datos">
      <div><b>${esc(data.etiquetaEntidad)}:</b>&nbsp; ${esc(data.entidadNombre || 'A QUIEN CORRESPONDA')}</div>
      <div><b>MONEDA:</b>&nbsp; ${esc(data.monedaEtiqueta || '—')} &nbsp;&nbsp; <b>CREDITO:</b>&nbsp; ${esc(data.creditoDias ?? 0)}</div>
    </div>

    <table class="tarifas">
      <thead><tr><th class="c-num"></th><th class="c-desc">TIPO DE SERVICIO</th><th class="c-tar">TARIFA</th></tr></thead>
      <tbody>${filasHtml}</tbody>
    </table>

    <div class="notas">${NOTAS.map((n) => `<div>- ${esc(n)}</div>`).join('')}</div>

    <div class="aviso">Cualquier incremento o modificacion se notificara con 15 dias de anticipacion</div>
    <div class="gracias">Agradecemos su confianza y preferencia.</div>

    <div class="firma">
      <div>
        Gabriela R. Moreno Osorio<br/>
        <span class="correo">gerencia@roelca.com</span><br/>
        Roelcainc, S.A. de C.V.<br/>
        Tel. (867) 196 4690
      </div>
      <div class="firma-der"><div class="firma-linea">NOMBRE, FIRMA Y SELLO DE ACEPTACION DE TARIFAS</div></div>
    </div>
  </div>`;

  const cont = document.createElement('div');
  cont.style.position = 'fixed';
  cont.style.left = '-10000px';
  cont.style.top = '0';
  cont.innerHTML = html;
  document.body.appendChild(cont);
  try {
    const img = cont.querySelector('img');
    if (img && !(img as HTMLImageElement).complete) {
      await new Promise((res) => { (img as HTMLImageElement).onload = () => res(null); (img as HTMLImageElement).onerror = () => res(null); });
    }
    const nombre = `Tarifario_${(data.entidadNombre || 'convenio').replace(/[^\w\sÁÉÍÓÚÑáéíóúñ-]+/g, '').trim().replace(/\s+/g, '_')}.pdf`;
    await html2pdf().set({
      margin: 0,
      filename: nombre,
      image: { type: 'jpeg', quality: 0.97 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' as const },
    }).from(cont.firstElementChild as HTMLElement).save();
  } finally {
    document.body.removeChild(cont);
  }
};
