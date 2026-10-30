// src/features/facturacion/services/reportePorFacturar.ts
// ---------------------------------------------------------------------------
// ✅ V00526 — REPORTE POR FACTURAR (Excel para imprimir a diario). (Llegó como "V00525" de otra sesión; se integró
// encima de la V00525 de Completar importes / Actualizar.)
// Una fila por referencia pendiente, agrupada por cliente: Ref. Roelca, Ref. Cliente,
// fecha, caja, servicio, "Datos para la Factura" (la leyenda que se copia al SIT o a
// QuickBooks) y el TOTAL de cada operación (con sus cargos adicionales, sin IVA) ya convertido a la moneda del cliente, con la suma por
// cliente. Lleva una columna vacía para anotar el folio al facturar.
// La leyenda y el importe salen de conceptoSit (datosParaSit.ts): la MISMA regla con
// que se factura y con que "Subir PDF y XML" coteja. Sin IVA (lo pone el SIT). ✅ V00527: la columna dice "Total (sin IVA)" (antes "Subtotal").
// La parte pura (armarReporte) está probada; la escritura del Excel usa ExcelJS,
// que se carga solo al descargar.
// ---------------------------------------------------------------------------
import { aCentavos, deCentavos } from '../../../shared/dominio/numeros';
import { descargarBuffer } from '../../operaciones/services/excelOperaciones';
import { conceptoSit, fechaSit, textoDescripcion } from './datosParaSit';
import type { ConceptoSit, ExtrasOperacion } from './datosParaSit';

export interface FilaReporte extends ConceptoSit {
  refCliente: string;
  fecha: string;
  caja: string;
}

export interface GrupoReporte {
  clienteId: string;
  cliente: string;
  moneda: 'USD' | 'MXN';
  /** El cliente no tiene moneda de facturación en Empresas: se usó la de la operación. */
  sinMonedaCliente: boolean;
  filas: FilaReporte[];
  subtotal: number;
}

export interface Reporte {
  grupos: GrupoReporte[];
  totales: { USD: number; MXN: number };
  referencias: number;
}

/** Lo que el tablero sabe de cada operación y que no es dinero. */
export interface DatosOperacionReporte extends ExtrasOperacion {
  clienteId: string;
  cliente: string;
  /** Moneda del cliente en Empresas (null = no tiene). */
  monedaCliente: 'USD' | 'MXN' | null;
  /** Moneda con que se factura la operación (respaldo si el cliente no tiene). */
  monedaOperacion: 'USD' | 'MXN' | null;
}

const texto = (v: unknown): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim());

export const armarReporte = (
  ops: readonly Record<string, unknown>[], datosDe: (op: Record<string, unknown>) => DatosOperacionReporte,
): Reporte => {
  const grupos = new Map<string, GrupoReporte>();
  ops.forEach((op) => {
    const d = datosDe(op);
    const moneda = d.monedaCliente ?? d.monedaOperacion ?? 'USD';
    const clave = `${d.clienteId}|${moneda}`;
    let g = grupos.get(clave);
    if (!g) {
      g = { clienteId: d.clienteId, cliente: d.cliente, moneda, sinMonedaCliente: d.monedaCliente === null, filas: [], subtotal: 0 };
      grupos.set(clave, g);
    }
    const c = conceptoSit(op, moneda, { caja: d.caja, convenio: d.convenio });
    const refCliente = texto(op.refCliente);
    g.filas.push({ ...c, refCliente: refCliente.toUpperCase() === 'N/A' ? '' : refCliente, fecha: fechaSit(op.fechaServicioISO ?? op.fechaServicio), caja: d.caja });
  });
  const lista = [...grupos.values()].map((g) => {
    const filas = [...g.filas].sort((a, b) => a.ref.localeCompare(b.ref, 'es', { numeric: true }));
    return { ...g, filas, subtotal: deCentavos(filas.reduce((s, f) => s + aCentavos(f.importe), 0)) };
  }).sort((a, b) => a.cliente.localeCompare(b.cliente, 'es') || a.moneda.localeCompare(b.moneda));
  const suma = (m: 'USD' | 'MXN') => deCentavos(lista.filter((g) => g.moneda === m).reduce((s, g) => s + aCentavos(g.subtotal), 0));
  return { grupos: lista, totales: { USD: suma('USD'), MXN: suma('MXN') }, referencias: lista.reduce((s, g) => s + g.filas.length, 0) };
};

const FMT_MONEDA = '"$"#,##0.00';
const GRIS = 'FF434343';
const NARANJA = 'FFD84315';
const CLARO = 'FFF3F4F6';
const LINEA = 'FFBFC5CC';

/** El Excel en memoria. `filtros` describe lo que se filtró ("Todo lo pendiente", fechas, cliente). */
export async function libroReportePorFacturar(reporte: Reporte, filtros: string, generado: string): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Por facturar', {
    pageSetup: {
      orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      printTitlesRow: '4:4',
    },
    headerFooter: { oddFooter: '&LPor facturar · &D&RPágina &P de &N' },
    views: [{ state: 'frozen', ySplit: 4 }],
  });
  hoja.columns = [
    { key: 'cliente', width: 24 }, { key: 'ref', width: 16 }, { key: 'refCliente', width: 18 }, { key: 'fecha', width: 11 },
    { key: 'caja', width: 12 }, { key: 'servicio', width: 30 }, { key: 'datos', width: 34 }, { key: 'moneda', width: 9 },
    { key: 'subtotal', width: 14 }, { key: 'folio', width: 14 },
  ];
  const borde = { style: 'thin' as const, color: { argb: LINEA } };
  const bordes = { top: borde, left: borde, bottom: borde, right: borde };

  hoja.mergeCells('A1:J1');
  const titulo = hoja.getCell('A1');
  titulo.value = 'Pendiente por facturar';
  titulo.font = { bold: true, size: 15, color: { argb: NARANJA } };
  hoja.mergeCells('A2:J2');
  hoja.getCell('A2').value = `${filtros} · ${reporte.referencias} referencias · Generado ${generado}`;
  hoja.getCell('A2').font = { size: 10, color: { argb: 'FF57606A' } };

  const encabezados = ['Cliente', 'Ref. Roelca', 'Ref. Cliente', 'Fecha', 'Caja', 'Servicio', 'Datos para la Factura', 'Moneda', 'Total (sin IVA)', '# Factura'];
  const filaEnc = hoja.getRow(4);
  filaEnc.values = encabezados;
  filaEnc.height = 20;
  filaEnc.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = bordes;
  });

  let r = 5;
  for (const g of reporte.grupos) {
    const moneda = g.moneda === 'USD' ? 'Dólares' : 'Pesos';
    g.filas.forEach((f, i) => {
      const fila = hoja.getRow(r++);
      fila.values = [g.cliente, f.ref, f.refCliente, f.fecha, f.caja, f.convenio, textoDescripcion(f), moneda, f.importe, ''];
      fila.height = Math.max(18, 15 * f.lineas.length);
      fila.eachCell({ includeEmpty: true }, (c, col) => {
        c.alignment = { vertical: 'top', wrapText: col === 6 || col === 7 || col === 1 };
        c.border = bordes;
        if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLARO } };
      });
      fila.getCell(2).font = { bold: true };
      fila.getCell(3).font = { bold: true };
      fila.getCell(7).font = { name: 'Consolas', size: 9 };
      fila.getCell(9).numFmt = FMT_MONEDA;
    });
    const total = hoja.getRow(r);
    total.values = [`Total ${g.cliente} · ${g.filas.length} ${g.filas.length === 1 ? 'referencia' : 'referencias'}${g.sinMonedaCliente ? ' · ⚠ sin moneda en Empresas' : ''}`, '', '', '', '', '', '', moneda, g.subtotal, ''];
    hoja.mergeCells(r, 1, r, 7);
    r++;
    total.eachCell({ includeEmpty: true }, (c) => { c.font = { bold: true }; c.border = { top: { style: 'medium', color: { argb: GRIS } } }; });
    total.getCell(1).alignment = { horizontal: 'right' };
    total.getCell(9).numFmt = FMT_MONEDA;
    r++; // renglón en blanco entre clientes
  }
  for (const [m, nombre] of [['USD', 'Dólares'], ['MXN', 'Pesos']] as const) {
    if (reporte.totales[m] === 0) continue;
    const fila = hoja.getRow(r);
    fila.values = [`TOTAL GENERAL EN ${nombre.toUpperCase()}`, '', '', '', '', '', '', nombre, reporte.totales[m], ''];
    hoja.mergeCells(r, 1, r, 7);
    r++;
    fila.eachCell({ includeEmpty: true }, (c) => { c.font = { bold: true, color: { argb: NARANJA } }; });
    fila.getCell(1).alignment = { horizontal: 'right' };
    fila.getCell(9).numFmt = FMT_MONEDA;
  }

  return libro.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Escribe y descarga el Excel (con la descarga compartida de los Excel de la app). */
export async function descargarReportePorFacturar(reporte: Reporte, filtros: string, generado: string, nombreArchivo: string): Promise<void> {
  descargarBuffer(await libroReportePorFacturar(reporte, filtros, generado), nombreArchivo);
}
