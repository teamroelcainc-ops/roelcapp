# V00371 — Sin VERDE no se puede COMPLETAR

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00371.

## Qué cambia
1. **Candado**: una operación de **Transfer** o de **Logística de
   Cruces con proveedor Roelca** NO se puede marcar como SERVICIO
   COMPLETADO sin haber registrado antes **Verde MX / Verde USA**. Al
   intentarlo aparece el aviso:
   "⛔ Esta operación cruza puente y aún NO ha marcado Verde MX /
   Verde USA. No se puede COMPLETAR el servicio hasta registrar el
   verde en los estatus (ahí se descuenta el peaje del puente)."
   El candado vive en los TRES caminos: botones de SIGUIENTE PASO de
   la ficha, "+ Registrar Status" manual, y el formulario al guardar
   con status completado.
2. **Exentos**: **Fletes y Movimientos** no llevan esta regla — y de
   paso quedaron excluidos también del cobro del peaje y del reporte
   (un "Movimiento" no cruza puente).
3. Una operación que YA descontó su peaje (verde marcado, o cobros
   históricos) completa normal.

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127, Formulario 377,
  Saldos 0 — baselines exactos · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
