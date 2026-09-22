# V00339 — Estadísticas EN VIVO: siempre precisas con el resto de la app

## Archivos que cambian (respetar rutas)
- `src/features/estadisticas/components/EstadisticasDashboard.tsx` y `EstadisticasDashboard.css`
- `src/config/historialCambios.ts` (entrada automática de esta versión)
- `src/config/version.ts` + `public/version.json` — V00339.

## Qué cambia — base relacional viva, como pediste
1) **Operaciones EN VIVO**: al presionar Buscar, Estadísticas ya no
   descarga una foto: se SUSCRIBE al rango de fechas. Crear, editar,
   completar o cancelar una operación recalcula TODAS las pestañas al
   momento (desgloses, tendencias, totales) sin volver a presionar
   Buscar. El chip 🟢 EN VIVO junto al subtítulo lo confirma.

2) **Facturación y pagos EN VIVO**: los formatos que cruzan con facturas
   y pagos (Transfer, Cruces, Fletes) también quedan suscritos — editar
   una factura o aplicar un pago se refleja al instante en la tabla y en
   el Excel.

3) **Precisión auditada**: la fuente y los criterios son LOS MISMOS que
   ya usa el resto de la app — operaciones por fecha de servicio
   excluyendo canceladas y montos con el criterio de Facturación
   (recalculados de la misma base). Al estar todo suscrito a las mismas
   colecciones, Estadísticas no puede quedarse con números viejos: lo
   que ves ahí es lo que hay en la base en ese segundo.

## Verificación
- `tsc --noEmit` ✓ · eslint: 26 (MEJOR que el baseline de 32 — la
  reescritura eliminó tipados flojos viejos, nada nuevo) ·
  `npm run build` completo ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
