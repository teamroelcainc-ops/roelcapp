# V00401 — Convenio en la tabla de Generar Referencia (Puentes)

- Generar Referencia: nueva columna Convenio (ej. "Cruce de Exportación - Caja - Cargado - 240 Nuevo
  Laredo") entre Unidad y Puente; texto completo al pasar el mouse. El modal se amplió a 980 px.
- Agregar Saldo → asiento → operaciones de una referencia: también muestran el Convenio.

## Archivos
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (50); build OK.
