// src/features/facturacion/components/exportarExcelProfesional.ts
//
// ─────────────────────────────────────────────────────────────────────────
// EXPORTADOR DE EXCEL PROFESIONAL (con estilos, colores, alineación y LOGO)
// ─────────────────────────────────────────────────────────────────────────
// Usa ExcelJS. La librería "xlsx" (SheetJS) NO puede pintar colores, alinear
// ni insertar imágenes; por eso este módulo usa ExcelJS.
//
// INSTALAR UNA SOLA VEZ (en la carpeta del proyecto):
//     npm install exceljs
//
// LOGO — dos opciones:
//   Opción 1 (recomendada): coloca tu logo en la carpeta  public/  del
//     proyecto con el nombre  logo-roelca.png . Vite lo sirve en
//     "/logo-roelca.png" y se insertará automáticamente. Si no quieres logo,
//     déjalo así y saldrá un banner de texto "ROELCA".
//   Opción 2: pega el base64 del logo (el mismo que usas en tus PDFs) en
//     LOGO_ROELCA_BASE64 y tendrá prioridad sobre el archivo.
// ─────────────────────────────────────────────────────────────────────────

import ExcelJS from 'exceljs';

export const LOGO_ROELCA_URL: string = '/logo-roelca.png';
export const LOGO_ROELCA_BASE64: string = ''; // p.ej. 'iVBORw0KGgo...' (con o sin prefijo data:)

const COLOR_HEADER = 'FF434343'; // gris carbón (igual que la referencia)
const COLOR_ACCENT = 'FFD84315'; // naranja Roelca
const COLOR_ZEBRA  = 'FFF3F4F6'; // gris muy claro (filas alternas)
const COLOR_TEXTO  = 'FF1F2328';
const COLOR_SUB    = 'FF57606A';
const COLOR_LINEA  = 'FFE1E4E8';

const FMT_MONEDA = '_-"$"* #,##0.00_-;_-"$"* -#,##0.00_-;_-"$"* "-"??_-;_-@_-';
const FMT_FECHA = 'd/mm/yyyy';
const FMT_FECHA_HORA = 'd/mm/yyyy h:mm';
const FMT_ENTERO = '#,##0';

export type TipoColExcel = 'texto' | 'fecha' | 'fechaHora' | 'monto' | 'numero';

export interface ColExcel {
  key: string;
  label: string;
  tipo?: TipoColExcel;
  ancho?: number;
}

export interface OpcionesExcel {
  nombreArchivo: string;
  tituloReporte: string;
  subtitulo?: string;
  nombreHoja?: string;
  columnas: ColExcel[];
  filas: Record<string, any>[];
}

// arrayBuffer → base64 (para el logo descargado por fetch)
const bufferABase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(bin);
};

// Convierte casi cualquier formato a Date (o null) para que Excel lo trate
// como fecha real (ISO, DD/MM/YYYY, D/M/YY, con guiones, Timestamp Firestore).
const aFechaExcel = (valor: any): Date | null => {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'object') {
    try {
      if (typeof valor.toDate === 'function') { const d = valor.toDate(); return isNaN(d.getTime()) ? null : d; }
      if (typeof valor.seconds === 'number') { const d = new Date(valor.seconds * 1000); return isNaN(d.getTime()) ? null : d; }
    } catch { /* noop */ }
    return null;
  }
  const s = String(valor).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})(?!\d)/); if (m) return new Date(2000 + +m[3], +m[2] - 1, +m[1]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

// Dispara la descarga del archivo en el navegador.
const descargarArchivo = (buffer: ArrayBuffer, filename: string) => {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

export const exportarExcelProfesional = async (opts: OpcionesExcel): Promise<void> => {
  const { nombreArchivo, tituloReporte, subtitulo, nombreHoja, columnas, filas } = opts;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Roelca';
  wb.created = new Date();

  const HEADER_ROW = 5;                  // fila del encabezado de columnas
  const DATA_START = HEADER_ROW + 1;     // primera fila de datos
  const nCols = Math.max(1, columnas.length);

  const ws = wb.addWorksheet(nombreHoja || 'Reporte', {
    views: [{ state: 'frozen', ySplit: HEADER_ROW }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });

  // ── Banda de título (filas 1-4) ────────────────────────────────────────
  ws.getRow(1).height = 26;
  ws.getRow(2).height = 16;
  ws.getRow(3).height = 14;
  ws.getRow(4).height = 6;

  const colTituloInicio = nCols >= 3 ? 3 : 1; // deja A-B para el logo si hay ≥3 cols

  ws.mergeCells(1, colTituloInicio, 1, nCols);
  const celTitulo = ws.getCell(1, colTituloInicio);
  celTitulo.value = tituloReporte;
  celTitulo.font = { name: 'Calibri', size: 16, bold: true, color: { argb: COLOR_TEXTO } };
  celTitulo.alignment = { horizontal: 'left', vertical: 'middle' };

  ws.mergeCells(2, colTituloInicio, 2, nCols);
  const celSub = ws.getCell(2, colTituloInicio);
  celSub.value = subtitulo || '';
  celSub.font = { name: 'Calibri', size: 10, color: { argb: COLOR_SUB } };
  celSub.alignment = { horizontal: 'left', vertical: 'middle' };

  ws.mergeCells(3, colTituloInicio, 3, nCols);
  const celGen = ws.getCell(3, colTituloInicio);
  celGen.value = `Generado el ${new Date().toLocaleString('es-MX')}`;
  celGen.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF8B949E' } };
  celGen.alignment = { horizontal: 'left', vertical: 'middle' };

  // Línea de acento naranja bajo la banda de título
  ws.mergeCells(4, 1, 4, nCols);
  ws.getCell(4, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ACCENT } };

  // ── Logo (o banner de texto de respaldo) ───────────────────────────────
  let logoOk = false;
  try {
    let base64 = LOGO_ROELCA_BASE64 ? LOGO_ROELCA_BASE64.replace(/^data:image\/\w+;base64,/, '') : '';
    let ext: 'png' | 'jpeg' = (/jpe?g/i.test(LOGO_ROELCA_BASE64)) ? 'jpeg' : 'png';
    if (!base64) {
      const resp = await fetch(LOGO_ROELCA_URL);
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        base64 = bufferABase64(buf);
        ext = /\.jpe?g($|\?)/i.test(LOGO_ROELCA_URL) ? 'jpeg' : 'png';
      }
    }
    if (base64) {
      const imgId = wb.addImage({ base64, extension: ext });
      ws.addImage(imgId, { tl: { col: 0.15, row: 0.15 }, ext: { width: 150, height: 58 } });
      logoOk = true;
    }
  } catch { /* si falla, usamos el banner de texto de abajo */ }

  if (!logoOk && nCols >= 2) {
    ws.mergeCells(1, 1, 3, Math.min(2, nCols));
    const cel = ws.getCell(1, 1);
    cel.value = 'ROELCA';
    cel.font = { name: 'Calibri', size: 20, bold: true, color: { argb: COLOR_ACCENT } };
    cel.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  // ── Encabezado de columnas (fila 5): gris carbón + texto blanco negrita ──
  const headerRow = ws.getRow(HEADER_ROW);
  headerRow.height = 30;
  columnas.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: COLOR_ACCENT } } };
  });

  // ── Filas de datos ─────────────────────────────────────────────────────
  const totalesMonto: Record<number, number> = {};
  filas.forEach((fila, idx) => {
    const r = ws.getRow(DATA_START + idx);
    r.height = 18;
    columnas.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      const tipo = c.tipo || 'texto';
      const raw = fila[c.key];

      if (tipo === 'monto') {
        const n = Number(raw);
        cell.value = isNaN(n) ? null : n;
        cell.numFmt = FMT_MONEDA;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        if (!isNaN(n)) totalesMonto[i] = (totalesMonto[i] || 0) + n;
      } else if (tipo === 'numero') {
        const n = Number(raw);
        cell.value = isNaN(n) ? null : n;
        cell.numFmt = FMT_ENTERO;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (tipo === 'fecha' || tipo === 'fechaHora') {
        const d = aFechaExcel(raw);
        if (d) { cell.value = d; cell.numFmt = tipo === 'fechaHora' ? FMT_FECHA_HORA : FMT_FECHA; }
        else cell.value = raw ? String(raw) : '';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else {
        const s = (raw === null || raw === undefined) ? '' : String(raw);
        cell.value = s;
        const largo = s.length > 45;
        cell.alignment = { horizontal: largo ? 'left' : 'center', vertical: 'middle', wrapText: largo };
      }

      cell.font = { name: 'Calibri', size: 10, color: { argb: COLOR_TEXTO } };
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ZEBRA } };
      cell.border = { bottom: { style: 'hair', color: { argb: COLOR_LINEA } } };
    });
  });

  // ── Fila de TOTALES (suma de columnas de dinero) ────────────────────────
  const hayMonto = columnas.some(c => c.tipo === 'monto');
  if (hayMonto && filas.length > 0) {
    const tr = ws.getRow(DATA_START + filas.length);
    tr.height = 24;
    columnas.forEach((c, i) => {
      const cell = tr.getCell(i + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER } };
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      if (i === 0) {
        cell.value = 'TOTAL';
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      } else if (c.tipo === 'monto') {
        cell.value = totalesMonto[i] || 0;
        cell.numFmt = FMT_MONEDA;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });
  }

  // ── Anchos de columna ──────────────────────────────────────────────────
  columnas.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.ancho) { col.width = c.ancho; return; }
    if (c.tipo === 'monto') { col.width = 16; return; }
    if (c.tipo === 'fecha') { col.width = 13; return; }
    if (c.tipo === 'fechaHora') { col.width = 18; return; }
    if (c.tipo === 'numero') { col.width = 11; return; }
    let max = c.label.length;
    filas.forEach(f => { const s = String(f[c.key] ?? ''); if (s.length > max) max = s.length; });
    col.width = Math.min(Math.max(max + 2, 12), 48);
  });

  // Autofiltro sobre el encabezado (permite filtrar/ordenar en Excel).
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: nCols } };

  const buffer = await wb.xlsx.writeBuffer();
  descargarArchivo(buffer as ArrayBuffer, nombreArchivo);
};