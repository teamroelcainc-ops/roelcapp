// src/features/operaciones/services/excelOperaciones.ts
// ---------------------------------------------------------------------------
// ✅ V00498 — EXCEL DE OPERACIONES: el valor de cada columna (antes dentro de exportarExcel de
// ServiciosCompletados.tsx, ahora compartido con "Excel de operaciones" de las pestañas de
// Operaciones). Las columnas son las de Servicios Completados (completados/columnas.ts).
// Solo usa lo que ya trae la operación (nombres desnormalizados): no lee catálogos.
// ✅ V00500: `conNombreDeStatus` completa el status de las que no lo traen guardado (el que llama
//   le pasa el catálogo): en el Excel de Operaciones las activas salían con Status "-".
// ---------------------------------------------------------------------------
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { partesDeFecha } from '../../../shared/dominio/fechas';
import { fmtSaldoPuente, normalizarFechaServicioISO, normalizarMoneda } from '../components/completados/formatos';

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

/** Filas del Excel: una por operación, con las columnas en el orden elegido (encabezado = su nombre). */
export const filasExcel = (ops: readonly Datos[], columnas: readonly ColumnaExcel[]): Record<string, CeldaExcel>[] =>
  ops.map((op) => {
    const fila: Record<string, CeldaExcel> = {};
    columnas.forEach((c) => {
      fila[c.label] = valorExcelOperacion(op, c.id);
      if (c.id === 'fechaServicio') Object.assign(fila, desgloseFechaExcel(fechaISODe(op)));
    });
    return fila;
  });

/** Arma y descarga el .xlsx (la librería se carga al exportar, no al abrir el módulo). */
export async function descargarExcel(filas: Record<string, CeldaExcel>[], hoja: string, archivo: string): Promise<void> {
  const XLSX = await import('xlsx');
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), hoja);
  XLSX.writeFile(libro, archivo);
}
