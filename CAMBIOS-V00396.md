# V00396 — Agregar Saldo · usuario automático en Otros Cruces

## 1. Otros Cruces
- "Usuario que registra" ya no está en el formulario ni en la tabla: se guarda solo con la sesión.
- Clic en una fila de Otros Cruces (o "Ver detalle" en el Historial) abre el detalle: Fecha, Hora,
  Puente, Monto, Unidad y Registrado por.

## 2. Nueva pestaña "Agregar Saldo"
- Tabla y formulario con: Fecha, Hora, Puente, Saldo Inicial (se puede eliminar un registro).
- Se guarda en saldos_puentes, la misma colección de Saldos de Puentes → es el saldo que muestran las
  tarjetas de puente de Operaciones Activas (Agregado) y se descuenta con los cruces de las
  operaciones y otros cruces de ese puente desde la fecha del primer saldo.
- Guarda también quién lo registró (no visible en el formulario).

## Archivos
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (51); build OK.
