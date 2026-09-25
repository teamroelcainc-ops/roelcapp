# V00366 — "Gastado hoy" solo con cruces de HOY

## Por qué salían operaciones del 23 y 24
Esas operaciones se COMPLETARON (o guardaron) HOY al ponerse al día, y
el respaldo de "al completar" les puso como fecha de cruce el día del
registro — por eso aparecían en el gastado de hoy.

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00366.

## Qué cambia
1. **Verde marcado hoy → cruce de hoy.** El peaje cobrado al marcar
   Verde MX/USA lleva la fecha del día en que se marca (como siempre).
2. **Respaldo por Completado → fecha de SERVICIO.** Cuando el cobro
   llega por completar (o al guardar el formulario ya completado), el
   cruce lleva la fecha de servicio de la operación — ponerse al día
   con operaciones del 23/24 ya no infla el gastado de hoy.
3. **Reparación con un clic.** El botón "🧮 Aplicar a operaciones" de
   Saldos de Puentes ahora TAMBIÉN corrige los cruces ya cobrados:
   los que fueron por Completado y quedaron con fecha del registro se
   mueven a su fecha de servicio. → PRESIÓNALO UNA VEZ y las del
   23/24 salen del gastado de hoy (se van a su día real).

Los saldos de las cuentas no cambian (el consumo total es el mismo);
solo se corrige EN QUÉ DÍA cuenta cada cruce.

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127, Formulario 377,
  Saldos 0 — baselines exactos · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build`, publica y presiona
"🧮 Aplicar a operaciones" una vez.
