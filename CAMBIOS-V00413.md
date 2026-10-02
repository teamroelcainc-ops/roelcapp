# V00413 — Referencias de puentes: puente por caseta, sin status, saldos claros

1–2. **El puente lo decide la CASETA cobrada** (Caseta AVI → AVI, Caseta Puente III → PT3, casetas
   de Colombia → PTC), ya NO el convenio/aduana (se revierte esa parte de V00412). "Otro puente"
   solo aparece cuando la caseta de la fila no es la del puente de la referencia (p. ej. Caseta AVI
   dentro de PT3).
3. **Sin status** en la lista del Historial de referencias ni en su detalle (el detalle muestra Puente y
   Fecha · Hora; fecha de pago y período solo en el historial manual anterior).
4. **Detalle del saldo (asiento)** hasta 1300 px; tarjetas con color (verde saldo inicial, rojo monto
   cruzado, azul balance); fila del saldo inicial en verde y cada referencia que descuenta en rojo
   (franja lateral y fondo); filas más amplias.
5. **Tres tarjetas arriba de la tabla de Saldo**: Puente AVI, Puente III y Puente Colombia con su
   Balance, Agregado y Cruzado (Colombia desglosa caseta y puente si hay ambos saldos).

## Archivos
src/utils/historialCalculadoPuentes.ts
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (49); build OK.
