// src/features/operaciones/services/cargarFormularioOperacion.ts
// ---------------------------------------------------------------------------
// ✅ V00534 — El código del formulario de operación se baja aparte (FormularioOperacionDiferido).
// Aquí, fuera del componente, para que "fast refresh" funcione: cargar y precargar.
// ---------------------------------------------------------------------------

/** El módulo del formulario (una sola descarga: el navegador reutiliza el módulo). */
export const cargarFormularioOperacion = () => import('../components/FormularioOperacion');

/** Empieza a bajar el formulario sin esperar (al pintar la pantalla o al pasar el mouse por ✎). */
export const precargarFormularioOperacion = (): void => {
  cargarFormularioOperacion().catch(() => undefined); // si falla, lazyWithRetry lo reintenta al abrirlo
};
