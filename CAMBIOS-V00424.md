# V00424 — Operaciones por convenio en el detalle del Tarifario de Clientes

- Detalle del Pre Convenio: nueva columna OPERACIONES en la tabla de tarifas — cuántas operaciones
  usan cada convenio (op.convenio = detalle del convenio; sin operaciones de prueba). Muestra "…"
  mientras cuenta.
- Al pie: "N tarifa(s) en este pre convenio · TOTAL operaciones hechas".
- La columna solo aparece en el detalle (no en el formulario de captura).

## Archivos
src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint 0; build OK.
