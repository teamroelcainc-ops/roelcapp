# V00393 — Referencias de Puentes: solo importación/exportación y hora del verde

- Asignar Operaciones muestra SOLO operaciones de Importación o Exportación, de Transfer o de
  Logística con proveedor Roelca. Quedan fuera los movimientos (sin cruce) y Logística Fletes.
- Nueva columna "Hora (Verde)" (después de Fecha Servicio): hora en que se marcó Verde MX y/o
  Verde USA, leída de la bitácora de estatus (colección horarios, consultas de 30 en 30 solo para
  las operaciones del filtro). Pasando el mouse se ve fecha y hora completas. "Sin verde" si aún
  no se marca. Se puede ordenar por ella y sale en el Excel.

## Archivos
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (51); build OK.
