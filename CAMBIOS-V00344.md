# V00344 — "Ver documentos" en la ficha · ✎ Vista (ocultar botones) · 📖 Manual

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx` y `.css`
- `public/manuales/operaciones.html` (NUEVO — crear la carpeta `public/manuales`)
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00344.

## 1) 📄 Ver documentos (Detalle de Operación)
Junto a Bitácora, el botón "Ver documentos" muestra dentro de la ficha
TODOS los documentos guardados de esa operación — Carta Porte, DODA,
Entry's, Manifiesto y lo subido con el botón Documentos — para abrirlos
o administrarlos ahí mismo (misma lista de la colección `documentos`).

## 2) ✎ Vista — ocultar/mostrar los botones agregados
En la cabecera del módulo, el botón "✎ Vista" (visible con permiso)
abre el panel de edición: marcas los botones a OCULTAR (Sincronizar
nombres, Actualizar monedas, Reparar consecutivos), quedan tachados en
rojo, y presionas Listo. La elección se guarda EN LA BASE
(`config_vista/operacionesActivas`) y aplica al momento para TODOS los
usuarios; desmarcar los recupera.
- Permiso: por ahora lo ven los ADMIN (o roles cuyo nombre contenga
  "personalizarVista"). Para ponerlo como casilla dentro del módulo de
  Roles necesito tu `RolesDashboard.tsx` y `App.tsx` ACTUALES (los tocó
  la V00336 de los renombres del menú y no quiero pisarlos con mi copia
  vieja) — mándamelos o el proyecto completo y lo conecto.

## 3) 📖 Manual
El botón "Manual" abre `public/manuales/operaciones.html` en otra
pestaña: guía completa del módulo (resumen del día, cada botón, la
tabla, el formulario, la ficha, documentos, estatus y la edición de
vista), en HTML con CSS propio. Puedo hacer el manual de los demás
módulos igual cuando quieras.

## Verificación
- `tsc --noEmit` ✓ · eslint: 127 = baseline exacto · `npm run build` ✓
  (el manual entra al build por estar en `public/`).

## Al instalar
Reemplaza los archivos + crea `public/manuales/operaciones.html` +
versión, `npm run build` y publica.
