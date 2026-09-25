# V00359 — Saldo disponible por MONEDA · historial de deducciones · modal completo

## Archivos que cambian (respetar rutas)
- `src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx` y `.css`
- `src/features/operaciones/components/TarjetaCasetas.tsx` y `.css`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00359.

## 1) El modal de la tarjeta (Operaciones) con los 5 conceptos
Ahora muestra, por puente: **Fecha** (hoy, fija) · **Moneda** (la del
catálogo, junto al nombre) · **Saldo a agregar** · **Saldo restante** ·
**Total** (restante + agregado, en vivo). Igual que el del módulo.

## 2) Saldo disponible en Dólares y en Pesos + historial
Arriba del módulo Saldos de Puentes hay dos tarjetas grandes:
**Saldo disponible en Dólares** y **Saldo disponible en Pesos** (la suma
del saldo actual de las cuentas de cada moneda; en rojo si es negativo).
Al PRESIONARLAS se abre el **📜 Historial por fechas**: cada recarga (➕
verde) y cada deducción por cruce (➖ rojo, con la referencia de la
operación y el puente), ordenadas por fecha con el **saldo corrido** en
cada movimiento. Cada tarjeta de puente también tiene su botón 📜 para
ver solo su historial.

## Nota sobre los saldos NEGATIVOS que viste
Las recargas del 24/09 por $23.75 y $144.00 son del modelo anterior
(eran la tarifa, no un saldo) — bórralas con el 🗑 del historial de
recargas y captura el saldo inicial real de cada puente; los números
quedan correctos al momento.

## Verificación
- `tsc --noEmit` ✓ · eslint 0 en ambos · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
