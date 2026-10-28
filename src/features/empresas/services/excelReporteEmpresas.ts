// src/features/empresas/services/excelReporteEmpresas.ts
// ---------------------------------------------------------------------------
// ✅ V00507 — EXCEL del Reporte de empresas (ExcelJS, se carga al descargar). Tres hojas:
//   · Resumen: periodo, totales por categoría (operaciones distintas) y cómo se contó.
//   · Clientes y Proveedores: una fila por empresa con su dirección y sus operaciones
//     (Importación, Exportación, Otros y su desglose). De más a menos operaciones.
// ---------------------------------------------------------------------------
import type { Worksheet } from 'exceljs';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { descargarBuffer } from '../../operaciones/services/excelOperaciones';
import { otrosDe } from './reporteEmpresas';
import type { ConteoOperaciones, FilaReporteEmpresa, ReporteEmpresas } from './reporteEmpresas';
import type { RangoReporte } from './reporteEmpresasLectura';

type Celda = string | number;
type Tono = 'impo' | 'expo' | 'otros';

const COLOR = {
  encabezado: 'FF374151', encabezadoTexto: 'FFFFFFFF', grupo: 'FF111827', nota: 'FF4B5563',
  impo: 'FFDBEAFE', impoTexto: 'FF1D4ED8',
  expo: 'FFDCFCE7', expoTexto: 'FF15803D',
  otros: 'FFFEF3C7', otrosTexto: 'FFB45309',
} as const;
const relleno = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
const FMT_ENTERO = '#,##0';
const TONO_FONDO: Record<Tono, string> = { impo: COLOR.impo, expo: COLOR.expo, otros: COLOR.otros };
const TONO_TEXTO: Record<Tono, string> = { impo: COLOR.impoTexto, expo: COLOR.expoTexto, otros: COLOR.otrosTexto };

interface Columna { titulo: string; grupo: string; ancho: number; valor: (f: FilaReporteEmpresa) => Celda; numero?: boolean; tono?: Tono }

const COLUMNAS: readonly Columna[] = [
  { titulo: '# Empresa', grupo: 'Empresa', ancho: 12, valor: (f) => f.numero },
  { titulo: 'Razón Social', grupo: 'Empresa', ancho: 40, valor: (f) => f.nombre },
  { titulo: 'Nombre Corto', grupo: 'Empresa', ancho: 18, valor: (f) => f.nombreCorto },
  { titulo: 'Tipo(s) de Empresa', grupo: 'Empresa', ancho: 32, valor: (f) => f.tipos },
  { titulo: 'Status', grupo: 'Empresa', ancho: 11, valor: (f) => f.status },
  { titulo: 'Dirección', grupo: 'Dirección', ancho: 50, valor: (f) => f.direccion.completa },
  { titulo: 'Calle', grupo: 'Dirección', ancho: 26, valor: (f) => f.direccion.calle },
  { titulo: '# Ext.', grupo: 'Dirección', ancho: 8, valor: (f) => f.direccion.numExterior },
  { titulo: '# Int.', grupo: 'Dirección', ancho: 8, valor: (f) => f.direccion.numInterior },
  { titulo: 'Colonia', grupo: 'Dirección', ancho: 22, valor: (f) => f.direccion.colonia },
  { titulo: 'Municipio / Ciudad', grupo: 'Dirección', ancho: 20, valor: (f) => f.direccion.municipio },
  { titulo: 'Estado', grupo: 'Dirección', ancho: 16, valor: (f) => f.direccion.estado },
  { titulo: 'C.P.', grupo: 'Dirección', ancho: 9, valor: (f) => f.direccion.cp },
  { titulo: 'País', grupo: 'Dirección', ancho: 12, valor: (f) => f.direccion.pais },
  { titulo: 'Otras direcciones', grupo: 'Dirección', ancho: 50, valor: (f) => f.otrasDirecciones },
  { titulo: 'Operaciones', grupo: 'Operaciones', ancho: 13, numero: true, valor: (f) => f.conteo.total },
  { titulo: 'Importación', grupo: 'Operaciones', ancho: 13, numero: true, tono: 'impo', valor: (f) => f.conteo.importacion },
  { titulo: 'Exportación', grupo: 'Operaciones', ancho: 13, numero: true, tono: 'expo', valor: (f) => f.conteo.exportacion },
  { titulo: 'Otros', grupo: 'Operaciones', ancho: 10, numero: true, tono: 'otros', valor: (f) => otrosDe(f.conteo) },
  { titulo: 'Movimientos', grupo: 'Operaciones', ancho: 13, numero: true, valor: (f) => f.conteo.movimiento },
  { titulo: 'En falso', grupo: 'Operaciones', ancho: 10, numero: true, valor: (f) => f.conteo.falso },
  { titulo: 'Sin clasificar', grupo: 'Operaciones', ancho: 14, numero: true, valor: (f) => f.conteo.sinClasificar },
  { titulo: 'Última operación', grupo: 'Operaciones', ancho: 16, valor: (f) => f.conteo.ultima },
];

const estiloEncabezado = (ws: Worksheet, fila: number, desde: number, hasta: number, fondo: string): void => {
  for (let c = desde; c <= hasta; c++) {
    const celda = ws.getRow(fila).getCell(c);
    celda.font = { bold: true, color: { argb: COLOR.encabezadoTexto } };
    celda.fill = relleno(fondo);
    celda.alignment = { vertical: 'middle', horizontal: c === desde || fila === 1 ? 'left' : 'center', wrapText: true };
  }
};

/** Hoja de una categoría: fila 1 con los grupos (Empresa, Dirección, Operaciones), fila 2 con los títulos. */
const hojaEmpresas = (ws: Worksheet, filas: readonly FilaReporteEmpresa[]): void => {
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];
  COLUMNAS.forEach((c, i) => { ws.getColumn(i + 1).width = c.ancho; });
  // Grupos: una celda combinada por grupo.
  let inicio = 0;
  COLUMNAS.forEach((c, i) => {
    const ultimo = i === COLUMNAS.length - 1 || COLUMNAS[i + 1].grupo !== c.grupo;
    if (!ultimo) return;
    ws.mergeCells(1, inicio + 1, 1, i + 1);
    ws.getRow(1).getCell(inicio + 1).value = c.grupo;
    estiloEncabezado(ws, 1, inicio + 1, i + 1, COLOR.grupo);
    inicio = i + 1;
  });
  ws.getRow(2).values = COLUMNAS.map((c) => c.titulo);
  estiloEncabezado(ws, 2, 1, COLUMNAS.length, COLOR.encabezado);
  COLUMNAS.forEach((c, i) => {
    const celda = ws.getRow(2).getCell(i + 1);
    celda.alignment = { vertical: 'middle', horizontal: c.numero ? 'center' : 'left', wrapText: true };
    if (!c.tono) return;
    celda.fill = relleno(TONO_FONDO[c.tono]);
    celda.font = { bold: true, color: { argb: TONO_TEXTO[c.tono] } };
  });
  ws.getRow(2).height = 30;

  filas.forEach((f) => {
    const r = ws.addRow(COLUMNAS.map((c) => c.valor(f)));
    COLUMNAS.forEach((c, i) => {
      if (!c.numero) return;
      const celda = r.getCell(i + 1);
      celda.numFmt = FMT_ENTERO;
      if (c.tono && Number(celda.value) > 0) celda.font = { bold: true, color: { argb: TONO_TEXTO[c.tono] } };
    });
  });
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: COLUMNAS.length } };
};

const TITULOS_RESUMEN = ['Categoría', 'Empresas', 'Con operaciones', 'Operaciones', 'Importación', 'Exportación', 'Otros', 'Movimientos', 'En falso', 'Sin clasificar'];
const filaResumen = (nombre: string, filas: readonly FilaReporteEmpresa[], t: ConteoOperaciones): Celda[] => [
  nombre, filas.length, filas.filter((f) => f.conteo.total > 0).length,
  t.total, t.importacion, t.exportacion, otrosDe(t), t.movimiento, t.falso, t.sinClasificar,
];
const miles = (n: number): string => n.toLocaleString('es-MX');

export const textoPeriodo = (rango: RangoReporte): string => {
  if (rango.desde && rango.hasta) return `Del ${rango.desde} al ${rango.hasta} (fecha de servicio)`;
  if (rango.desde) return `Desde el ${rango.desde} (fecha de servicio)`;
  if (rango.hasta) return `Hasta el ${rango.hasta} (fecha de servicio)`;
  return 'Todas las operaciones, de cualquier fecha';
};

const hojaResumen = (ws: Worksheet, r: ReporteEmpresas, rango: RangoReporte): void => {
  ws.getColumn(1).width = 22;
  for (let c = 2; c <= TITULOS_RESUMEN.length; c++) ws.getColumn(c).width = 15;
  ws.getCell('A1').value = 'Reporte de empresas';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = `Periodo: ${textoPeriodo(rango)}`;
  ws.getCell('A3').value = `Generado: ${new Date().toLocaleString('es-MX')}`;
  ws.getRow(5).values = TITULOS_RESUMEN;
  estiloEncabezado(ws, 5, 1, TITULOS_RESUMEN.length, COLOR.encabezado);
  ws.getRow(5).height = 30;
  [filaResumen('Clientes', r.clientes, r.totales.cliente), filaResumen('Proveedores', r.proveedores, r.totales.proveedor)].forEach((valores, i) => {
    const fila = ws.getRow(6 + i);
    fila.values = valores;
    for (let c = 2; c <= TITULOS_RESUMEN.length; c++) fila.getCell(c).numFmt = FMT_ENTERO;
    fila.getCell(1).font = { bold: true };
  });
  const notas = [
    `Operaciones revisadas: ${miles(r.revisadas)} (sin las de prueba). Canceladas: ${miles(r.canceladas)}; no cuentan en nada.`,
    `Operaciones con un cliente que no está en Empresas: ${miles(r.sinEmpresa.cliente)} · sin cliente: ${miles(r.sinPapel.cliente)}.`,
    `Operaciones con un proveedor que no está en Empresas: ${miles(r.sinEmpresa.proveedor)} · sin proveedor: ${miles(r.sinPapel.proveedor)}.`,
    'Cliente = el que paga o el de la mercancía. Proveedor = el de transporte o el de servicios. Una empresa que es cliente y proveedor sale en las dos hojas.',
    'Una operación cuenta una vez para cada empresa. Si tiene dos clientes (el que paga y el de la mercancía) cuenta para los dos, por eso la suma de la hoja Clientes puede ser mayor que el total de arriba.',
    'Otros = Movimientos + En falso + Sin clasificar. Las operaciones en falso van a Otros aunque fueran de importación o exportación.',
    'Importación, Exportación y Movimiento: la misma clasificación de Estadísticas (convenio, tipo de operación y tipo de servicio, o la que se puso a mano) y, si no dice, el tráfico de la operación.',
  ];
  notas.forEach((n, i) => {
    const celda = ws.getCell(10 + i, 1);
    celda.value = n;
    celda.font = { color: { argb: COLOR.nota } };
  });
};

/** Arma el libro (Resumen, Clientes, Proveedores). */
export const armarLibroReporteEmpresas = async (r: ReporteEmpresas, rango: RangoReporte): Promise<ArrayBuffer> => {
  const { default: ExcelJS } = await import('exceljs');
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Roelca';
  hojaResumen(libro.addWorksheet('Resumen'), r, rango);
  hojaEmpresas(libro.addWorksheet('Clientes'), r.clientes);
  hojaEmpresas(libro.addWorksheet('Proveedores'), r.proveedores);
  return libro.xlsx.writeBuffer() as Promise<ArrayBuffer>;
};

export const nombreArchivoReporte = (rango: RangoReporte): string =>
  (rango.desde || rango.hasta
    ? `Reporte_empresas_${rango.desde || 'inicio'}_a_${rango.hasta || hoyLocalISO()}.xlsx`
    : `Reporte_empresas_todas_${hoyLocalISO()}.xlsx`);

export async function descargarReporteEmpresas(r: ReporteEmpresas, rango: RangoReporte): Promise<void> {
  descargarBuffer(await armarLibroReporteEmpresas(r, rango), nombreArchivoReporte(rango));
}
