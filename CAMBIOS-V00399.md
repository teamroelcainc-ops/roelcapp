# V00399 — Referencias de Puentes: selección visible, fecha/hora, saldos por referencias

1. Generar Referencia: por cada puente, tabla con las operaciones seleccionadas
   (Ref. Operación, Fecha servicio, Unidad, Puente, Monto).
2. Se quitó el campo Status (las referencias nacen Pendientes; se marcan pagadas desde el Historial).
3. Campos Fecha y Hora (precargadas con ahora) → fecha/hora de la referencia; el consecutivo
   AVI/PT3/PTC usa esa fecha.
4. Asignar Operaciones muestra SOLO operaciones sin referencia (se quitó el selector
   Pendientes/Asignadas). Al generar, pasan al Historial; si se borra la referencia, regresan.
5. Agregar Saldo: el MONTO CRUZADO es la suma de las referencias del Historial de ese puente
   (operaciones y otros cruces) desde la fecha del saldo; Colombia separa caseta y puente según el
   saldo. Columna Cruces: "N en X ref.". El detalle (asiento) lista el historial de referencias
   con cargo y saldo corrido; clic en una referencia despliega sus operaciones (ref, fecha, hora del
   verde, unidad, puente, monto).
- El Historial ahora lee hasta 3,000 referencias (antes 400).

## Archivos
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint 50 (antes 51); build OK.
