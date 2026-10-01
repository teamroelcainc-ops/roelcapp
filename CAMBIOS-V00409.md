# V00409 — Completadas hoy por tipo de operación

- Tarjeta "Completadas hoy" (Operaciones Activas): debajo del total y la barra, el desglose de las
  completadas del día por tipo: Logística Cruces · Transfer · Logística Fletes · Renta
  (y "Otros" solo si hay de algún otro tipo).
- Mismo criterio del total: operaciones con fecha de servicio de hoy y estatus completado.

## Archivos
src/App.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint 72 (igual); build OK.
