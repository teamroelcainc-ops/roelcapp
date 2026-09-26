# V00377 — La REGLA DE ESTATUS decide dónde se descuenta el puente

## Archivos que cambian (respetar rutas)
- `src/features/configuracion/components/ConfiguradorStatus.tsx`
- `src/features/operaciones/config/statusRules.ts`
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00377.

## 1) Casilla "🌉 Aquí se descuenta el puente" en el editor de flujos
En Configuración → Reglas de Estatus, selecciona un paso del lienzo y
en el Inspector aparece la sección **"Saldo del puente"** con la
casilla **"🌉 Aquí se descuenta el puente"**. Márcala en el estatus que
debe cobrar (puedes marcarla en más de uno si un flujo lo necesita) y
presiona **Guardar flujo**.
- Al marcar ESE estatus en la operación (botones de SIGUIENTE PASO,
  Registrar Status manual o el formulario), se descuenta el peaje —
  con la caseta de los Gastos Incluidos de la tarifa (V00373) o la del
  tráfico, y el movimiento queda trazado con el nombre del estatus.
- Si el flujo NO tiene ningún paso marcado, todo sigue como hoy
  (Verde MX / Verde USA descuentan). Completado sigue de respaldo, y
  nunca se cobra dos veces.

## 2) "Registrar Movimiento" solo con los estatus de la regla
El desplegable del registro manual ahora ofrece ÚNICAMENTE los estatus
del flujo que corresponde a esa operación (su Servicio + Tráfico +
Carga), en el orden del flujo. Si la operación no tiene flujo
configurado, se muestran todos como antes.

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127 y Formulario 377 =
  baselines exactos; ConfiguradorStatus y statusRules dentro de su
  estilo (any preexistente del archivo) · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build`, publica, marca la
casilla en el estatus que cobra de cada flujo y guarda el flujo. OJO:
los flujos se cachean 6 horas en el navegador — tras guardar la regla,
si no ves el cambio, recarga con Ctrl+Shift+R.
