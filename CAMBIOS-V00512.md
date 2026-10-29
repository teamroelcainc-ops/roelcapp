# V00512 — Revisión de datos al día, con fechas y Cancelar · Observaciones de costos adicionales

**Solo web.** Va encima de la V00511. Sin funciones, reglas, índices ni banderas, y no cambia datos.

## Qué cambia

### Revisión de datos (Operaciones → Revisión de datos)
- **Rango de fechas** (Desde / Hasta): muestra solo los errores de ese periodo.
  - Se aplica al momento y no vuelve a leer.
  - Usa la fecha de servicio de la operación; en F2, la fecha de la factura.
  - Las comparaciones entre facturas y operaciones se siguen haciendo con **todo**, para que el rango no invente errores.
  - Con rango, los errores sin fecha no se muestran: un aviso dice cuántos son.
  - El Excel y "Marcar facturadas" (F1) usan lo del rango.
  - **Todas las fechas** quita el rango.
  - Se recuerda mientras no cierres sesión.
- **Cancelar revisión**: mientras lee aparece el botón. Al cancelar se queda la revisión anterior, si había una.
- **Al día**: lo que corriges deja de aparecer.
  - Si abres un registro desde la revisión, lo corriges y vuelves, la ventana relee **solo ese registro** y recalcula. Si ya está bien, desaparece.
  - Lo mismo pasa con cualquier operación que se guarde en la app mientras la revisión está abierta.
  - Arriba aparece un aviso como "Al día (10:32): se volvieron a revisar 2 registros que cambiaron · 2 errores menos".
  - Las que marcas en F1 salen de la lista al momento, sin tener que presionar Revisar de nuevo.
  - Cambios hechos por otra persona o desde otro equipo: se ven al abrir ese registro desde la revisión o con **Revisar de nuevo**.

### Formulario de operación (Por Cobrar)
Si **Cargos Adicionales** es distinto de 0, debajo aparece la casilla **Observaciones de costos adicionales**. Se guarda con la operación y no es obligatoria.

## Pasos manuales
1. Aplica el zip encima de la V00511 (no hay archivos borrados) y haz el commit: el conteo debe dar **13**.
2. Push y publicar: `npm run build` y `npx wrangler deploy`.

## Técnico
- `revisionDatosLectura.ts`:
  - `SenalRevision` y `RevisionCancelada`.
  - Guarda en memoria los datos de la revisión durante la sesión.
  - Pendientes: los registros abiertos desde la ventana (`marcarParaRevisar`) y las operaciones que avisa `operacionesBus`.
  - `refrescarRevisionDatos` lee esos registros con `porIds` / `getDoc` y recalcula.
  - `aplicarCambiosLocales` actualiza en memoria las marcadas en F1.
  - Guarda el rango durante la sesión.
- `revisionDatos.ts`: `filtrarPorFechas`, función pura y probada.
- `marcarFacturadasF1.ts`: devuelve `marcadasIds`. El componente congela el plan al bajar la prueba.
- `RevisionDatosModal.tsx` y `.css` (prefijo `rvd-`).
- `FormularioOperacion.tsx`: `cargosAdicionalesNotas`.
- Simulador:
  - Cancelar regresó al momento.
  - Con julio, F5 mostró solo la de julio.
  - Al abrir TR-512-A, corregirla y volver: "1 error menos" y salió de F5; el rango seguía puesto.
  - Con un aviso de guardado y la ventana abierta, F5 bajó de 6,234 a 6,233.
  - F1 de un día: se marcaron 4 y el grupo quedó en 0 sin volver a revisar.
  - En el formulario, la casilla aparece con Cargos Adicionales en 75 y no aparece con 0.
