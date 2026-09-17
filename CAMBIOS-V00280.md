# V00280 — Botón "Guardar cambios" al editar el tarifario (sin pasar por Pre convenios)

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx` y `.css`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00280.

## El problema
El único guardado del tarifario vivía DENTRO del flujo "Pre convenios"
(elegir tarifas → Guardar). Al EDITAR solo la cabecera — fechas,
"Tarifario obligatorio" (V00277) o el documento firmado — no había
ningún botón para guardar: solo Cancelar y Pre convenios.

## El arreglo
En EDICIÓN, el pie del modal ahora trae el botón verde **"Guardar
cambios"** (junto a Pre convenios): guarda fecha de emisión, fecha de
vencimiento y "Tarifario obligatorio", sube el documento firmado si
elegiste uno (con motivo exacto si Storage lo rechaza — los demás
cambios ya quedaron guardados), registra el log y cierra el modal.
Las tarifas NO se tocan por este camino; para modificarlas sigue el
flujo de Pre convenios de siempre. Clientes y proveedores.

Con esto ya puedes cerrar el pendiente del TARI-072: Editar → "Tarifario
obligatorio: No" → Guardar cambios.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: AMBOS dashboards en 0. Sin inline styles.
- `npm run build`: OK (PWA generada).
