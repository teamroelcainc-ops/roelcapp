# V00410 — Cantidades en referencias de puentes · tarjetas = pestaña Saldo

## 1. Cantidades
- Detalle de Referencia: columna "#" con la numeración de las operaciones y pie con
  "N operaciones · X con verde · Y sin verde" y el total por moneda.
- Historial de referencias: pie con el total de referencias y de operaciones.

## 2. Tarjetas de puente (Operaciones Activas)
- Antes descontaban el peaje cobrado en cada operación; la pestaña Saldo descuenta el Historial de
  referencias. Por eso no coincidían.
- Ahora las tarjetas usan la MISMA base que Saldo: saldos agregados − (Historial de referencias +
  Otros Cruces) del puente desde su primer saldo → el saldo restante coincide con el Balance de Saldo.
- Las filas de hoy (cruces / consumido hoy) toman las operaciones del Historial con fecha de servicio de hoy.

## Archivos
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/features/operaciones/components/TarjetaCasetas.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes; build OK.
