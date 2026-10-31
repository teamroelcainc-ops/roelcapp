// src/shared/utils/excel.ts
// ---------------------------------------------------------------------------
// ✅ V00534 — EL ÚNICO LUGAR QUE CARGA LAS LIBRERÍAS DE EXCEL. `xlsx` (~140 KB gz) y `exceljs`
// (~264 KB gz) se descargan con import() la primera vez que alguien exporta o lee un archivo, no con
// la pantalla: un import estático en cualquier archivo metía la librería entera en el chunk de esa
// pantalla (Operaciones Activas, la de inicio, cargaba xlsx). La promesa se guarda: la segunda vez
// no se vuelve a pedir; si falla (sin conexión), se olvida para reintentar.
// En este paso solo cambia CÓMO se cargan, no qué librería se usa.
// ---------------------------------------------------------------------------
import type ExcelJSModulo from 'exceljs';

export type LibreriaXlsx = typeof import('xlsx');
export type LibreriaExcelJS = typeof ExcelJSModulo;

const unaVez = <T,>(cargar: () => Promise<T>): (() => Promise<T>) => {
  let enCurso: Promise<T> | null = null;
  return () => {
    enCurso ??= cargar().catch((error: unknown) => {
      enCurso = null;
      throw error;
    });
    return enCurso;
  };
};

/** `xlsx` (SheetJS): `const XLSX = await cargarXlsx();` dentro del handler que exporta o lee. */
export const cargarXlsx = unaVez<LibreriaXlsx>(() => import('xlsx'));

/** `exceljs` (libros con formato): `const ExcelJS = await cargarExcelJS();` dentro del handler. */
export const cargarExcelJS = unaVez<LibreriaExcelJS>(async () => {
  const modulo = await import('exceljs');
  // Según el empaquetado, la clase llega en `default` o en el módulo mismo.
  return (modulo as unknown as { default?: LibreriaExcelJS }).default ?? (modulo as unknown as LibreriaExcelJS);
});
