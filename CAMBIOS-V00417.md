# V00417 — El asiento de cada saldo muestra solo lo que le descuenta

## Lo que pasaba
El monto cruzado SÍ era correcto: el saldo de "Puente Mx Colombia" descuenta solo el PUENTE ($90 por
cruce → 3 × $90 = $270). La caseta ($129.60) se descuenta del saldo de "Caseta Mx Colombia".
Pero el desglose mostraba el TOTAL del cruce ($219.60 = $129.60 + $90), por eso no cuadraba a la vista.

## Cambio
- Desglose de una referencia dentro del asiento: solo las operaciones que descuentan de ese saldo, con
  "Concepto (este saldo)" (Puente Mx Colombia / Caseta Mx Colombia / Caseta AVI…), "Monto" = la parte
  que descuenta (suma = cargo de la referencia) y "Total del cruce" en gris como referencia.

## Archivos
src/features/puentes/components/ReferenciasPuentesDashboard.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (49); build OK.
