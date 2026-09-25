# V00370 — "Registrar Status" de vuelta en la ficha de Operaciones

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00370.

## Qué cambia
El botón naranja "+ Registrar Status" REGRESA al Detalle de Operación
de Operaciones Activas / Mis Operaciones (tal como estaba antes de la
V00368). Registrar un Verde MX / Verde USA por ahí sigue cobrando el
peaje, con las reglas de la V00369. En Servicios Completados el botón
permanece fuera (la operación ya terminó).

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127 = baseline exacto ·
  `npm run build` ✓

## Al instalar
Reemplaza el archivo + versión, `npm run build` y publica.
