# V00367 — El Verde cobra el peaje en TODOS los caminos

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00367.

## 1) El cobro dispara con Verde MX / Verde USA por TODOS los caminos
Faltaba un camino: registrar el verde desde el modal MANUAL de
horarios (con fecha/hora) no cobraba. Ahora el peaje se descuenta al
marcar Verde MX (importación o exportación) o Verde USA por:
- los botones de status rápido de la ficha ✓ (ya estaba),
- el registro MANUAL de horarios ✓ (nuevo),
- el FORMULARIO al guardar la operación en verde ✓ (nuevo).
El puente lo decide el tráfico (Importación → AVI dólares ·
Exportación → Puente III pesos), la fecha del cruce es el día en que
se marca el verde, y sigue sin cobrarse dos veces.

## 2) Alerta en la fila: cruces que NO han descontado saldo
En Operaciones (Activas / Mis Operaciones), las operaciones Transfer
con tráfico de importación/exportación que aún no descuentan su
peaje muestran **🌉⚠** junto a la referencia (pasa el mouse para el
detalle: "falta marcar Verde MX / Verde USA").

## 3) Movimientos sin el saldo del puente
El historial 📜 de movimientos (recargas ➕ y deducciones ➖) ya no
enseña la columna del saldo corrido — solo fecha, movimiento y monto.

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127, Formulario 377,
  Saldos 0 — baselines exactos · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
