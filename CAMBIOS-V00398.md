# V00398 — Tarjetas de puente con lo de HOY · hora al actualizar el saldo

## Tarjetas (Operaciones Activas)
- Cifra grande: saldo restante REAL de la cuenta (sin cambio).
- Filas del día: Saldo al iniciar hoy · Recargas hoy (si hay) · Cruces hoy · Consumido hoy
  (inicio + recargas hoy − consumido hoy = restante). Colombia: columnas Caseta y Puente + Restante.
- "Hoy" = FECHA DE SERVICIO de la operación igual a hoy (otros cruces: su fecha de cruce).
- Clic en "Cruces hoy" → lista solo de los cruces de hoy (Fecha servicio, referencia, status, puente, peaje).
- El día usa la fecha LOCAL (antes UTC, que por la tarde-noche ya era "mañana").

## Actualizar saldo
- El modal de la tarjeta pide Fecha y Hora de la actualización (precargadas con ahora); se guardan.
- Saldos de Puentes → Agregar saldo también pide la hora.

## Archivos
src/features/operaciones/components/{TarjetaCasetas.tsx, TarjetaCasetas.css}, src/App.css
src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (TarjetaCasetas y Saldos 0); build OK.
