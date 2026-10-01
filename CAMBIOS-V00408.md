# V00408 — Botón "Actualizar sueldo (Trompo = $0)" siempre visible

## Causa
El botón (V00406) solo aparecía si el campo Sueldo Operador NO estaba bloqueado por Autorizaciones;
ese campo está bloqueado (incluso para Admin en pantalla), así que no se veía.

## Cambio
- El botón aparece en toda operación TROMPO con sueldo > $0, aunque el campo esté bloqueado: es la
  regla del Trompo, no una edición libre del sueldo. Pide confirmación y pone el sueldo en $0.
- Al guardar no pide autorización por ese cambio (los campos bloqueados en pantalla no cuentan como
  edición del usuario, V00382).
- Es el mismo formulario en Operaciones Activas, Servicios Completados y Cancelados.

## Archivos
src/features/operaciones/components/FormularioOperacion.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint 376 (igual); build OK.
