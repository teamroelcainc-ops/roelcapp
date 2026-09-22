# V00340 — Auditar cada operación desde Estadísticas · Excel con configuraciones guardadas

## Archivos que cambian (respetar rutas)
- `src/features/estadisticas/components/EstadisticasDashboard.tsx` y `.css`
- `src/config/historialCambios.ts` (entrada automática de esta versión)
- `src/config/version.ts` + `public/version.json` — V00340.

## 1) 🔍 Auditar cada operación del reporte
En "Ver operaciones" / "Ver todo" del desglose, cada fila trae ahora la
columna 🔍 con:
- **👁** — el detalle de la operación (la ficha de siempre).
- **✎** — EDITAR con el formulario completo de operaciones (el mismo del
  auditor de Facturación y del auditor por empresa). El formulario abre
  AL FRENTE y, al cerrarlo, regresas al reporte donde ibas.

## 2) Los cambios se ven al momento
Gracias a las Estadísticas EN VIVO (V00339), lo que corrijas desde el ✎
— o desde cualquier módulo — recalcula el reporte, los desgloses y los
totales al instante, sin volver a presionar Buscar.

## 3) Excel con selector de columnas y configuraciones GUARDADAS
El botón Excel del reporte abre PRIMERO el panel de columnas:
- Marcas/desmarcas las columnas del formato activo.
- Le pones NOMBRE y presionas 💾 Guardar: la configuración queda en la
  base (colección `config_export_excel`, compartida con todos) y aparece
  arriba para USARLA con un clic la próxima vez (o borrarla con 🗑).
- Se guardan configuraciones POR FORMATO (Transfer, Cruces, Fletes y
  vista libre), cada una con las suyas.
- Exportar respeta exactamente la selección.

## Verificación
- `tsc --noEmit` ✓ · eslint: 26 (mejor que el baseline de 32) ·
  `npm run build` completo ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
