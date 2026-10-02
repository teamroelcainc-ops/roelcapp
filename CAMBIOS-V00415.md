# V00415 — Referencias de puentes: cambiar puente, agregar operaciones, destino del otro cruce

1. **Operaciones sin asignar → columna Puente editable**: selector con los puentes del catálogo. Al
   cambiarlo (con confirmación) se actualiza la operación: caseta, monto (importe del catálogo) y moneda;
   si es de Colombia agrega también el Puente Mx Colombia; si deja de serlo, se quita. El saldo se
   recalcula solo al enviarla al Historial.
2. **Detalle de referencia → "+ Agregar operaciones"**: lista las operaciones SIN ASIGNAR del mismo
   puente (por defecto de la fecha de la referencia; casilla "Todas las fechas"), con casillas y
   "Agregar N a <referencia>". Solo acepta operaciones de ese puente.
3. **Otros Cruces → "Enviar a la referencia"** (obligatorio): se elige una referencia existente de ese
   puente o "+ Crear referencia nueva". El cruce queda como una fila dentro de esa referencia (cuenta en
   Saldo y en las tarjetas), aparece en la pestaña Otros Cruces y se puede eliminar o "Sacar".
   Al hacer clic en una fila de otro cruce no se intenta abrir una operación.

## Archivos
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (49); build OK.
