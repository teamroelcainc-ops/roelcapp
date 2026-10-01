# V00402 — Historial calculado (automático) · operaciones de hoy por defecto

## Asignar Operaciones
- El módulo abre en Asignar Operaciones con Fecha inicio y Fecha fin = HOY y la búsqueda ya hecha.

## Nueva pestaña "Historial calculado" (método automático)
- NUEVO src/utils/historialCalculadoPuentes.ts.
- Al marcar un estatus que contiene "Verde" (Verde MX / Verde USA) en una operación de Transfer o
  Logística con proveedor Roelca (importación/exportación, sin pruebas), la operación se agrega sola
  a `referencias_puentes_auto/{AVI|PT3|PTC}_{fecha de HOY}`:
  · una referencia por puente y por día; el consecutivo sigue la misma serie del Historial
    (AVI-DDMMAA-NNN, considera las manuales y automáticas del día) y se conserva al crecer;
  · misma forma que la referencia manual (operaciones con hora del verde, unidad, convenio, caseta,
    piso, monto; totales por moneda); si la operación aún no tiene cobro de puente, el monto se
    calcula (caseta de la tarifa / por tráfico / Colombia caseta + puente);
  · no se duplica si la operación marca Verde MX y luego Verde USA; no toca las operaciones, así que
    el método manual sigue igual.
- Se dispara desde: Registrar Movimiento y Siguiente paso (Activas, Completados, Cancelados, incluida
  la cascada) y Mis Operaciones.
- "Recalcular hoy": revisa la bitácora de hoy y agrega los verdes que falten (p. ej. marcados desde
  el formulario).
- Tabla igual al Historial de Referencias (chip "auto"), detalle con sus operaciones y eliminar.

## Firestore
Colección nueva `referencias_puentes_auto`: mismas reglas que `referencias_puentes`.

## Archivos
src/utils/historialCalculadoPuentes.ts (nuevo)
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/features/operaciones/components/{OperacionesDashboard, ServiciosCompletados, ServiciosCancelados}.tsx
src/features/misOperaciones/components/MisOperacionesDashboard.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes en todos; build OK.
