# V00432 — Operaciones Activas sin Canceladas, Falsos ni Servicios Completados

Causa: la lista solo se filtraba al DESCARGAR (por id de status). Cuando una operación se cancelaba,
se marcaba Falso o se completaba con la lista abierta, el estado local solo actualizaba su status y la
fila se quedaba (caso FL-061026-001 "19. Cancelado").

- esOperacionActiva excluye por id (7607f692, f557b751, c2d57403) Y por nombre del status (guardado o del
  catálogo) que contenga Cancel / Falso / Complet.
- La lista se depura sola: cualquier operación que pase a uno de esos status sale al instante de la tabla,
  las pestañas y los conteos (botones de status, Registrar Movimiento, Cancelar referencia, formulario).

## Archivos
src/features/operaciones/components/OperacionesDashboard.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint Operaciones 125 (uno menos que antes); build OK.
