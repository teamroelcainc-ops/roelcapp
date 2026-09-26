# V00376 — FUERA la validación del Verde para completar

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00376.

## Qué cambia
Se eliminó por completo la validación (V00371/V00375) que exigía tener
Verde MX / Verde USA marcado para poner SERVICIO COMPLETADO:
- Ya no hay bloqueo ni aviso en los botones de SIGUIENTE PASO de la
  ficha, ni en "+ Registrar Status" manual, ni al guardar el
  formulario (también se quitó el recordatorio al guardar).
- Todo lo demás sigue igual: el peaje se descuenta al marcar Verde
  (o al completar, como respaldo, con la caseta de los Gastos
  Incluidos de la tarifa), los Movimientos y Fletes no cobran, la
  alerta informativa 🌉⚠ de la fila y el reporte se mantienen.

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127, Formulario 377 —
  baselines exactos · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
