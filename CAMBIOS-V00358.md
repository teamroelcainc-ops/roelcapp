# V00358 — Saldos de Puentes como CUENTAS: inicial − cruces = actual

## Archivos que cambian (respetar rutas)
- `src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx` y `.css`
- `src/features/operaciones/components/TarjetaCasetas.tsx` y `.css`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00358.

## El modelo (exacto a tu ejemplo)
Cada puente es una CUENTA:
- **Saldo Inicial** = la suma de tus recargas ("Agregar saldo").
- **Cruces** = las operaciones COMPLETADAS que llevan ese puente
  (Puente 3: 5 cruces × $144 = $720; AVI: 4 × $23.75 = $95 — usa la
  tarifa que cada operación guardó al completarse).
- **Saldo Actual = Saldo Inicial − Cruces**, en verde/AMARILLO/ROJO.
El módulo muestra la tarjeta de CADA puente del catálogo (Puente 3,
AVI, Colombia y los demás) con: saldo inicial, cruces de HOY (cuántos y
cuánto), cruces totales y el saldo actual con su semáforo.

## El modal "➕ Agregar saldo" — tal cual lo pediste
- **Fecha**: la de hoy, NO modificable.
- **Moneda**: la del catálogo (Pesos/Dólares), NO modificable.
- **Saldo**: el monto a agregar.
- **Saldo restante**: lo disponible en la cuenta hoy.
- **Total**: restante + agregado (se actualiza mientras tecleas).
Cada recarga queda en el historial de abajo (editable/eliminable), y
puedes recargar varias veces el mismo día.

## Semáforo (tus umbrales)
AMARILLO al bajar de 20 cruces de tarifa y ROJO al bajar de 10:
Puente 3 → $2,880 / $1,440 · AVI → $475 / $237.50 · Colombia y demás
igual con su tarifa. Si quieres otro umbral en algún puente, se le
agregan los campos `umbralAmarillo`/`umbralRojo` a su registro del
catálogo y esos mandan.

## La tarjeta "Casetas del día" (Operaciones)
Ahora muestra el SALDO ACTUAL de la cuenta de cada puente (no la
tarifa), con el mismo semáforo y la marca "· bajo"/"· crítico"; su botón
"➕ Agregar saldo" abre la recarga con restante y total por puente. La
tarifa por cruce ya NO se toca desde aquí — vive en Catálogos → Tipos
de Gastos.

## Para que los cruces cuenten
Presiona UNA vez "🧮 Aplicar a operaciones" (arriba en el módulo):
coloca la tarifa a las completadas que no la tengan; el consumo de cada
cuenta se computa desde la fecha de tu PRIMERA recarga de ese puente.

## Pendiente que anoto (siguiente entrega)
La notificación al generar/completar una operación cuando el puente no
tiene saldo — la dejo lista con este mismo cálculo.

## Verificación
- `tsc --noEmit` ✓ · eslint 0 en ambos · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build`, publica, presiona
"🧮 Aplicar a operaciones" y agrega el saldo inicial de cada puente.
