# V00404 — Referencias de Puentes reorganizado

## Pestañas (nuevo orden y nombres)
1. Historial de referencias (antes "Historial calculado") — se abre primero.
2. Operaciones sin asignar (antes "Asignar Operaciones") — solo las que NO están en el Historial de
   referencias (por defecto, las de hoy).
3. Saldo (antes "Agregar Saldo").
4. Otros Cruces.
5. Historial manual (anterior) — las referencias manuales creadas antes, solo para consulta.

## Enviar al Historial de referencias
- Botón "Enviar al Historial (N)" (antes Generar Referencia), con las casillas de siempre.
- Las seleccionadas se agrupan por PUENTE (AVI / PT3 / PTC) y FECHA DE SERVICIO. Para cada grupo se
  elige la referencia ya creada que coincide (puente + fecha) o "+ Crear referencia nueva"
  (con el siguiente consecutivo de la serie). Si no existe ninguna, se crea nueva.
- Si una operación aún no tiene monto de puente, se calcula al enviar (caseta de la tarifa / por
  tráfico / Colombia caseta + puente); las que no se pueden determinar se avisan.
- Al enviar, salen de Operaciones sin asignar y aparecen en el Historial de referencias.

## Saldo
- Monto cruzado = suma del Historial de referencias (calculado) + Otros Cruces de ese puente,
  desde la fecha del saldo.

## Archivos
src/utils/historialCalculadoPuentes.ts (filaDeOperacion, upsertReferenciaAuto)
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint 49 (antes 50); build OK.
