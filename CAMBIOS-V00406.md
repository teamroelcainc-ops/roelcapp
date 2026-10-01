# V00406 — Trompo: sueldo del operador en $0

- Una operación es TROMPO si su carga o el nombre de su convenio dice "Trompo".
- Operación NUEVA trompo → Sueldo Operador = $0 automáticamente (aunque la tarifa traiga sueldo).
  Si hace falta pagar un monto, se agrega en Costos Adicionales.
- Al cambiar el convenio o usar "↻ Actualizar convenio" en una operación trompo → sueldo $0.
- Operaciones trompo YA GUARDADAS con sueldo: NO se modifican solas. Junto al Sueldo Operador aparece
  "Actualizar sueldo (Trompo = $0)"; al presionarlo (con confirmación) pone en $0 solo ese monto.
  Se guarda al guardar la operación.
- Sueldo Total se recalcula (sueldo + sueldo extra).

## Archivos
src/features/operaciones/components/FormularioOperacion.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint 376 (igual); build OK.
