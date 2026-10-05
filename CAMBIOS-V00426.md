# V00426 — Tarifario: cuadre con TODAS las operaciones del cliente

El conteo del tarifario (66 en Huizachal) cuenta las operaciones cuyo convenio es una de las tarifas de ESTE
tarifario. Las operaciones del cliente que usan un convenio que ya no existe (p. ej. los borrados 515/518),
uno de otro tarifario o ninguno no entran — por eso no cuadraba con los 71 de Servicios Completados.

- Pie del detalle: "N operaciones hechas con estos convenios · el cliente tiene T en total · X con otro
  convenio ▾" (Cliente Paga = cliente del tarifario; sin operaciones de prueba).
- Clic en "X con otro convenio" → tabla con Referencia, Fecha, Convenio que trae la operación (nombre e id)
  y MOTIVO: Convenio borrado o inexistente · Convenio de otro tarifario · Convenio no ligado a este
  tarifario · Sin convenio.
- Nota: Completados filtra por un rango de fechas; el tarifario cuenta todas las fechas.

## Archivos
src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint 0; build OK.
