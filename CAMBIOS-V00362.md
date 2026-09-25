# V00362 — Clic en "Casetas del día" = operaciones que suman al saldo

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/TarjetaCasetas.tsx` y `.css`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00362.

## Qué cambia
En la tarjeta "Casetas del día", las dos líneas del gasto son ahora
CLICABLES: al presionar **Gastado hoy (Dólares)** o **Gastado hoy
(Pesos)** se abre un modal con las OPERACIONES que suman a ese saldo
hoy: **# Referencia** (en azul, monoespaciada), **Puente** y el
**peaje** descontado de cada cruce, con el total del día y el número de
cruces al pie. Todo en vivo — al marcar otro Verde, la lista y los
totales crecen al momento.

## Verificación
- `tsc --noEmit` ✓ · eslint 0 · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
