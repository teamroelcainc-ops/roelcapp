# V00361 — "Agregar saldo" con PUENTE en desplegable (no en las tarjetas)

## Archivos que cambian (respetar rutas)
- `src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00361.

## Qué cambia
El saldo ya no se agrega desde cada tarjeta: hay UN botón **➕ Agregar
saldo** arriba (junto a 🧮), que abre el modal con:
- **Fecha** (hoy, fija) · **Puente** en LISTA DESPLEGABLE (todos los del
  catálogo) · **Moneda** (la del puente, no editable) · **Saldo a
  agregar** · **Saldo pendiente por puente** · **Total** (agregar +
  pendiente, en vivo).
Las tarjetas de cada puente quedan informativas (saldo inicial, cruces
de hoy/totales, saldo actual con semáforo) con su botón
**📜 Ver historial**.

## Verificación
- `tsc --noEmit` ✓ · eslint 0 · `npm run build` ✓

## Al instalar
Reemplaza el archivo + versión, `npm run build` y publica.
