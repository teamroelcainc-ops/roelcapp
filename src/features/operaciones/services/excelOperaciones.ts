// src/features/operaciones/services/excelOperaciones.ts
// ---------------------------------------------------------------------------
// ✅ V00498 — EXCEL DE OPERACIONES: el valor de cada columna (antes dentro de exportarExcel de
// ServiciosCompletados.tsx, ahora compartido con "Excel de operaciones" de las pestañas de
// Operaciones). Las columnas son las de Servicios Completados (completados/columnas.ts).
// Solo usa lo que ya trae la operación (nombres desnormalizados): no lee catálogos.
// ✅ V00500: `conNombreDeStatus` completa el status de las que no lo traen guardado (el que llama
//   le pasa el catálogo): en el Excel de Operaciones las activas salían con Status "-".
// ✅ V00503: primera columna "Validación" (ok / error, para filtrar) y "Motivo" (validacionExcel.ts);
//   "Moneda Empresa" (la del cliente que paga en Empresas) siempre al lado de "Moneda Cobro"; y el
//   archivo sale con ExcelJS: Dólares en azul y Pesos en verde, "error" en rojo, encabezado fijo y
//   filtros puestos (la librería de antes no pinta colores).
// ---------------------------------------------------------------------------
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { partesDeFecha } from '../../../shared/dominio/fechas';
import { monedaCanonica } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
import { fmtSaldoPuente, normalizarFechaServicioISO, normalizarMoneda } from '../components/completados/formatos';
import { textoMonedaEmpresa, validarOperacionExcel } from './validacionExcel';

type Datos = Record<string, unknown>;
export type CeldaExcel = string | number | boolean;
export interface ColumnaExcel { id: string; label: string }

const celda = (v: unknown): CeldaExcel => (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
/** `op.x || ''` de siempre. */
const o = (v: unknown): CeldaExcel => (v ? celda(v) : '');
const num = (v: unknown): number => Number(v) || 0;

const mostrarMoneda = (val: unknown): string => {
  if (val === ID_USD) return 'USD';
  if (val === ID_MXN) return 'MXN';
  return val ? String(val) : '-';
};

/** El nombre ya guardado en la operación (nunca un ID); en monedas, el código. Sin catálogos. */
export const nombreGuardado = (id: unknown, guardado: unknown, esMoneda = false): string => {
  const v = guardado !== null && guardado !== undefined ? String(guardado).trim() : '';
  if (v && v !== '-' && v !== String(id ?? '').trim()) return String(guardado);
  if (esMoneda && id) {
    const m = mostrarMoneda(id);
    if (m && m !== '-') return m;
  }
  return '-';
};

const fechaHora = (iso: unknown): string => {
  if (!iso) return '-';
  return new Date(String(iso)).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Valor de una columna del Excel para una operación (mismo texto que el Excel de Servicios Completados). */
export const valorExcelOperacion = (op: Datos, col: string): CeldaExcel => {
  switch (col) {
    case 'ref': return o(op.ref || (typeof op.id === 'string' ? op.id.substring(0, 6) : ''));
    case 'fechaServicio': return o((op._fechaISO !== null && op._fechaISO !== undefined ? op._fechaISO : normalizarFechaServicioISO(op.fechaServicio)) || op.fechaServicio);
    case 'fechaCita': return fechaHora(op.fechaCita);
    case 'tipoOperacion': return nombreGuardado(op.tipoOperacionId, op.tipoOperacionNombre);
    case 'status': return nombreGuardado(op.status, op.statusNombre);
    case 'refDiesel': return o(op.referenciaDieselConsecutivo);
    case 'refNomina': return o(op.referenciaNominaConsecutivo);
    case 'invoiceCliente': return o(op.facturaClienteInvoice || (op.facturado ? 'Facturada' : ''));
    case 'invoiceProveedor': return o(op.facturaProveedorFolio || (op.facturadoProveedor ? 'Facturada' : ''));
    case 'trafico': return o(op.trafico);
    case 'cliente': return nombreGuardado(op.clientePaga || op.clienteId, op.clienteNombre || op.nombreCliente);
    case 'saldoPuente': return fmtSaldoPuente(op);
    case 'convenioTarifa': return nombreGuardado(op.convenio, op.convenioNombre);
    case 'refCliente': return o(op.refCliente);
    case 'facturadoEnCobrar': return normalizarMoneda(nombreGuardado(op.facturadoEnCobrar, op.monedaCobroNombre, true));
    case 'montoConvenioCliente': return num(op.montoConvenioCliente);
    case 'cargosAdicionales': return num(op.cargosAdicionales);
    case 'subtotal': return num(op.subtotalCliente);
    case 'tipoCambioAprobado': return o(op.tipoCambioAprobado);
    case 'dolaresCliente': return num(op.dolaresCliente);
    case 'pesosCliente': return num(op.pesosCliente);
    case 'conversionCliente': return num(op.conversionCliente);
    case 'origen': return nombreGuardado(op.origen, op.origenNombre);
    case 'destino': return nombreGuardado(op.destino, op.destinoNombre);
    case 'remolque': return nombreGuardado(op.numeroRemolque, op.remolqueNombre);
    case 'proveedor': return nombreGuardado(op.proveedorUnidad, op.proveedorUnidadNombre);
    case 'unidadProveedor': return nombreGuardado(op.unidadProveedor, op.unidadProveedorNombre);
    case 'operadorProveedor': return nombreGuardado(op.operadorProveedor, op.operadorProveedorNombre);
    case 'convenioProv': return nombreGuardado(op.convenioProveedor, op.convenioProveedorNombre);
    case 'facturadoEnUnidad': return normalizarMoneda(nombreGuardado(op.facturadoEnUnidad, op.monedaUnidadNombre, true));
    case 'monedaConvenioProv': return normalizarMoneda(nombreGuardado(op.monedaConvenioProv, op.monedaConvProvNombre, true));
    case 'totalAPagarProv': return num(op.totalAPagarProv);
    case 'cargosAdicionalesProv': return num(op.cargosAdicionalesProv);
    case 'subtotalProv': return num(op.subtotalProv);
    case 'dolaresProv': return num(op.dolaresProv);
    case 'pesosProv': return num(op.pesosProv);
    case 'conversionProv': return num(op.conversionProv);
    case 'unidad': return nombreGuardado(op.unidad, op.unidadNombre);
    case 'operador': return nombreGuardado(op.operador, op.operadorNombre);
    case 'sueldoOperador': return num(op.sueldoOperador);
    case 'sueldoExtra': return num(op.sueldoExtra);
    case 'sueldoTotal': return num(op.sueldoTotal);
    case 'combustible': return num(op.combustible);
    case 'combustibleExtra': return num(op.combustibleExtra);
    case 'combustibleTotal': return num(op.combustibleTotal);
    case 'clienteMercancia': return nombreGuardado(op.clienteMercancia, op.clienteMercanciaNombre);
    case 'descripcionMercancia': return o(op.descripcionMercancia);
    case 'cantidad': return o(op.cantidad);
    case 'embalaje': return nombreGuardado(op.embalaje, op.embalajeNombre);
    case 'pesoKg': return o(op.pesoKg);
    case 'numDoda': return o(op.numDoda);
    case 'fechaEmisionDoda': return o(op.fechaEmisionDoda);
    case 'numeroEntrys': return o(op.numeroEntrys);
    case 'cantEntrys': return o(op.cantEntrys);
    case 'numManifiesto': return o(op.numManifiesto);
    case 'provServicios': return nombreGuardado(op.provServicios, op.provServiciosNombre);
    case 'montoManifiesto': return num(op.montoManifiesto);
    case 'totalGastos': return num(op.totalGastos);
    case 'utilidadEstimada': return num(op.utilidadEstimada);
    case 'observacionesEjecutivo': return o(op.observacionesEjecutivo);
    case 'observacionesUnidad': return o(op.observacionesUnidad);
    case 'observacionesCobrar': return o(op.observacionesCobrar);
    default: return '-';
  }
};

/**
 * ✅ V00500 — Puro: a las operaciones sin `statusNombre` (o con el ID guardado como nombre) les pone el
 * nombre del catálogo de status. `status` puede ser el ID del catálogo o, en las de AppSheet, el nombre.
 */
export const conNombreDeStatus = <T extends Datos>(ops: readonly T[], catalogo: readonly { id: string; _docId?: string; nombre?: unknown }[]): T[] => {
  const porId = new Map<string, string>();
  const porNombre = new Map<string, string>();
  catalogo.forEach((s) => {
    const nombre = String(s.nombre ?? '').trim();
    if (!nombre) return;
    porId.set(String(s._docId ?? s.id), nombre);
    porId.set(String(s.id), nombre);
    porNombre.set(nombre.toLowerCase(), nombre);
  });
  return ops.map((op) => {
    const id = String(op.status ?? '').trim();
    const guardado = String(op.statusNombre ?? '').trim();
    if (!id || (guardado && guardado !== '-' && guardado !== id)) return op;
    const nombre = porId.get(id) ?? porNombre.get(id.toLowerCase());
    return nombre ? { ...op, statusNombre: nombre } : op;
  });
};

/**
 * ✅ V00501 — Al lado de la fecha de servicio van SIEMPRE Año, Mes, Semana y Día (no se eligen: salen
 * con la fecha, en cualquier configuración). Mes y Día con nombre y la semana del año de lunes a
 * domingo, como Estadísticas Operativas. Fecha no reconocida → celdas vacías.
 */
export const desgloseFechaExcel = (iso: string): Record<string, CeldaExcel> => {
  const p = partesDeFecha(iso);
  return { Año: p ? p.anio : '', Mes: p ? p.mes : '', Semana: p ? p.semana : '', Día: p ? p.dia : '' };
};

const fechaISODe = (op: Datos): string =>
  String((op._fechaISO !== null && op._fechaISO !== undefined ? op._fechaISO : normalizarFechaServicioISO(op.fechaServicio)) || '');

/** ✅ V00503: columnas que agrega el Excel (no se eligen). */
export const COL_VALIDACION = 'Validación';
export const COL_MOTIVO = 'Motivo';
export const COL_MONEDA_EMPRESA = 'Moneda Empresa';
/** Columnas elegibles que muestran una moneda (se pintan: Dólares azul, Pesos verde). */
const IDS_MONEDA: readonly string[] = ['facturadoEnCobrar', 'facturadoEnUnidad', 'monedaConvenioProv'];

/**
 * Filas del Excel: una por operación. Primero Validación y Motivo; luego las columnas en el orden
 * elegido (encabezado = su nombre), con Año/Mes/Semana/Día junto a la fecha (V00501) y Moneda Empresa
 * junto a Moneda Cobro (si no se eligió Moneda Cobro, va después de Motivo). `monedaEmpresa` = la
 * moneda de cada empresa en Empresas (monedasEmpresas.ts).
 */
export const filasExcel = (ops: readonly Datos[], columnas: readonly ColumnaExcel[], monedaEmpresa: ReadonlyMap<string, Moneda>): Record<string, CeldaExcel>[] => {
  const conCobro = columnas.some((c) => c.id === 'facturadoEnCobrar');
  return ops.map((op) => {
    const v = validarOperacionExcel(op, monedaEmpresa);
    const fila: Record<string, CeldaExcel> = { [COL_VALIDACION]: v.estado, [COL_MOTIVO]: v.motivos.join(' | ') };
    if (!conCobro) fila[COL_MONEDA_EMPRESA] = textoMonedaEmpresa(op, monedaEmpresa);
    columnas.forEach((c) => {
      fila[c.label] = valorExcelOperacion(op, c.id);
      if (c.id === 'fechaServicio') Object.assign(fila, desgloseFechaExcel(fechaISODe(op)));
      if (c.id === 'facturadoEnCobrar') fila[COL_MONEDA_EMPRESA] = textoMonedaEmpresa(op, monedaEmpresa);
    });
    return fila;
  });
};

/** Filas y qué encabezados son de moneda (para pintarlos). */
export interface TablaExcel { filas: Record<string, CeldaExcel>[]; columnasMoneda: string[] }

export const tablaExcel = (ops: readonly Datos[], columnas: readonly ColumnaExcel[], monedaEmpresa: ReadonlyMap<string, Moneda>): TablaExcel => ({
  filas: filasExcel(ops, columnas, monedaEmpresa),
  columnasMoneda: [...columnas.filter((c) => IDS_MONEDA.includes(c.id)).map((c) => c.label), COL_MONEDA_EMPRESA],
});

// ── Colores del archivo (ARGB) ──
const COLOR = {
  encabezado: 'FF374151', encabezadoTexto: 'FFFFFFFF',
  usdFondo: 'FFDBEAFE', usdTexto: 'FF1D4ED8',
  mxnFondo: 'FFDCFCE7', mxnTexto: 'FF15803D',
  errorFondo: 'FFFEE2E2', errorTexto: 'FFB91C1C',
  okTexto: 'FF15803D',
} as const;
const relleno = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

/** Ancho de cada columna: el del encabezado o el valor más largo (de una muestra), entre 8 y 60. */
const anchoColumna = (titulo: string, filas: readonly Record<string, CeldaExcel>[]): number => {
  let max = titulo.length;
  for (let i = 0; i < filas.length && i < 300; i++) max = Math.max(max, String(filas[i][titulo] ?? '').length);
  return Math.min(60, Math.max(8, max + 2));
};

/** Descarga un .xlsx ya armado. ✅ V00507: exportado (también lo usa el Reporte de empresas). */
export const descargarBuffer = (buffer: ArrayBuffer, archivo: string): void => {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = archivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

/**
 * ✅ V00503 — Arma el libro con ExcelJS (se carga al exportar, no al abrir el módulo): encabezado
 * fijo y con filtros, Validación "error" en rojo, y las monedas en azul (Dólares) o verde (Pesos).
 */
export const armarLibroExcel = async (tabla: TablaExcel, hoja: string): Promise<ArrayBuffer> => {
  const { default: ExcelJS } = await import('exceljs');
  const { filas, columnasMoneda } = tabla;
  const titulos = filas.length > 0 ? Object.keys(filas[0]) : [COL_VALIDACION, COL_MOTIVO];
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Roelca';
  const ws = libro.addWorksheet(hoja.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = titulos.map((t) => ({ header: t, key: t, width: anchoColumna(t, filas) }));
  const encabezado = ws.getRow(1);
  encabezado.font = { bold: true, color: { argb: COLOR.encabezadoTexto } };
  encabezado.fill = relleno(COLOR.encabezado);
  encabezado.alignment = { vertical: 'middle' };

  const colValidacion = titulos.indexOf(COL_VALIDACION) + 1;
  const colsMoneda = titulos.map((t, i) => (columnasMoneda.includes(t) ? i + 1 : 0)).filter((i) => i > 0);
  filas.forEach((f) => {
    const r = ws.addRow(titulos.map((t) => f[t]));
    if (colValidacion > 0) {
      const c = r.getCell(colValidacion);
      if (f[COL_VALIDACION] === 'error') { c.fill = relleno(COLOR.errorFondo); c.font = { bold: true, color: { argb: COLOR.errorTexto } }; }
      else c.font = { bold: true, color: { argb: COLOR.okTexto } };
    }
    colsMoneda.forEach((i) => {
      const m = monedaCanonica(f[titulos[i - 1]]);
      if (!m) return;
      const c = r.getCell(i);
      c.fill = relleno(m === 'USD' ? COLOR.usdFondo : COLOR.mxnFondo);
      c.font = { bold: true, color: { argb: m === 'USD' ? COLOR.usdTexto : COLOR.mxnTexto } };
    });
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: titulos.length } };
  return libro.xlsx.writeBuffer() as Promise<ArrayBuffer>;
};

/** Arma y descarga el .xlsx. */
export async function descargarExcel(tabla: TablaExcel, hoja: string, archivo: string): Promise<void> {
  descargarBuffer(await armarLibroExcel(tabla, hoja), archivo);
}
