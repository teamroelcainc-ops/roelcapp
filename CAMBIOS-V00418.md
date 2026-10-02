# V00418 — Saldos por PUENTE: cuadran con el Historial de referencias

## Lo que pasaba
El saldo se llevaba por CUENTA exacta del catálogo. Puente III solo tenía saldo en "Caseta Puente III",
así que los "Trompo Puente III" (2 × $65 = $130) no descontaban: 1,426 − 130 = 1,296. En Colombia solo
había saldo en "Puente Mx Colombia", así que la caseta ($388.80) no descontaba: 658.80 − 388.80 = 270.

## Cambio
- El saldo es por PUENTE (AVI / Puente III / Colombia). Cualquier saldo del puente descuenta TODOS sus
  cobros: Puente III = Caseta Puente III + Trompo Puente III (+ casetas Mx a Nuevo Laredo); AVI = sus
  casetas y trompos AVI; Colombia = Caseta/Trompo Colombia + Puente Mx Colombia.
- Pestaña Saldo: monto cruzado, balance, tarjetas de los tres puentes y asiento (el desglose muestra
  el concepto y el monto de cada cruce que va a ese puente) → igual al total del Historial.
- Tarjetas de Operaciones Activas: el saldo restante usa la misma regla; en Colombia, Caseta y Puente
  muestran lo cruzado de cada concepto y lo de hoy.

## Archivos
src/features/puentes/components/ReferenciasPuentesDashboard.tsx
src/features/operaciones/components/TarjetaCasetas.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes; build OK.
