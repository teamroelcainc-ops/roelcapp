# V00397 — Saldos de puente con cruces, balance y asiento contable

## Agregar Saldo (Referencias de Puentes)
- Columnas nuevas por saldo: Cruces · Monto cruzado · Balance · Alcanza para (balance ÷ tarifa del
  puente del catálogo, "N cruces · $tarifa c/u").
- Qué descuenta de cada saldo: los cruces de su puente (caseta de operaciones, piso de Colombia y
  Otros Cruces; sin operaciones de prueba), desde la fecha del saldo, en orden: primero se consume el
  saldo más antiguo y al agotarse pasa al siguiente; si ya no hay saldo, el excedente queda en el
  último (balance negativo = sobregiro).
- Clic en la fila → ASIENTO: resumen (saldo inicial, cruces, monto cruzado, balance) y tabla
  Fecha · Referencia · Concepto · Cargo (−) · Abono (+) · Saldo corrido, con totales.

## Archivos
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (51); build OK.
