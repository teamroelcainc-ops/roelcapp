# V00518 — Revisión de datos: confirmar como correctas las canceladas con monto (D6)

**Solo web.** Va encima de la V00517. Sin funciones, reglas, índices, banderas ni dependencias. Escribe solo una marca en las operaciones que confirmas.

## Qué cambia

### Operaciones → Revisión de datos → D6 (Canceladas que conservan su monto)
- **✓ Está bien** en cada operación: si ya la revisaste y de verdad se canceló (no se cobra), la confirmas y sale de la lista.
  - Abajo del título aparece "LO-… se confirmó como correcta y salió de la lista" con **Deshacer**, por si te equivocaste.
- **Confirmar todas como correctas (N)**: confirma todas las de la lista (o las del rango de fechas elegido). Es una escritura masiva, así que va en los mismos tres pasos que F1 y D3:
  1. Descargar la prueba (Excel) con las que se confirmarían y su monto.
  2. Descargar el respaldo.
  3. Escribir **APLICAR** y confirmar.
- **No cambia el status ni los montos.** Solo guarda en la operación que se revisó: `revisionOk.D6` = fecha, quién y el detalle confirmado.
- **Si después cambia su monto**, vuelve a aparecer en D6 para revisarla otra vez.
- Arriba del grupo dice cuántas están confirmadas y no se muestran.
- Si alguna **sí se cobra**, no la confirmes: ábrela y cámbiala a **Falso**.
- El texto de arriba de la ventana ya no dice "Solo lee: no cambia nada": las correcciones de F1, D3 y la confirmación de D6 piden tu autorización.

## Archivos (13)
- `src/features/operaciones/services/confirmarRevision.ts` (nuevo) y `confirmarRevision.test.ts` (nuevo)
- `src/features/operaciones/components/ConfirmarCorrectas.tsx` (nuevo) y `ConfirmarCorrectas.css` (nuevo)
- `src/features/operaciones/components/RevisionDatosModal.tsx` y `.css`
- `src/features/operaciones/services/revisionDatos.ts` y `revisionDatosLectura.ts`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00518.md`

## Pasos manuales
1. Aplica el zip encima de la V00517 (no hay archivos borrados) y haz el commit: el conteo debe dar **13**.
2. Push y publicar: `npm run build` y `npx wrangler deploy`.
3. En Revisión de datos → **Revisar de nuevo** → D6: confirma una por una con ✓ Está bien, o todas con prueba, respaldo y APLICAR.
