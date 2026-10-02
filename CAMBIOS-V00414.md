# V00414 — Eliminar referencias del Historial de puentes

- Historial de referencias: casilla por fila y casilla en el encabezado para seleccionar todas.
- Botones "Eliminar seleccionadas (N)" y "Eliminar todas" (con confirmación que dice cuántas
  operaciones regresan). El bote de basura de cada fila sigue funcionando.
- Al eliminar, las operaciones regresan solas a "Operaciones sin asignar".
- Ojo: "Recalcular hoy" vuelve a crear las referencias con los verdes de HOY, y cada nuevo verde crea
  o completa la referencia de su puente del día.

## Archivos
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (49); build OK.
