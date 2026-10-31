// src/shared/utils/zip.ts
// ---------------------------------------------------------------------------
// ✅ V00534 — EL ÚNICO LUGAR QUE CARGA `jszip`: se descarga con import() al armar el primer .zip,
// no con Empresas, Empleados o Unidades (lo importaban estático por exportarEstructuraCarpetas).
// ---------------------------------------------------------------------------
type JSZipClase = typeof import('jszip');

let enCurso: Promise<JSZipClase> | null = null;

/** `const JSZip = await cargarJSZip(); const zip = new JSZip();` dentro del handler. */
export const cargarJSZip = (): Promise<JSZipClase> => {
  enCurso ??= import('jszip')
    .then((modulo) => (modulo as unknown as { default?: JSZipClase }).default ?? (modulo as unknown as JSZipClase))
    .catch((error: unknown) => {
      enCurso = null;
      throw error;
    });
  return enCurso;
};
