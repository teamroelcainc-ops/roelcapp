# V00431 — Botón "Cancelar referencia" visible sin reglas de estatus

Corrección de V00430: la consulta del flujo (obtenerNombresStatusDelFlujo) devuelve `null` cuando la
operación NO tiene reglas de estatus, y la condición solo reconocía una lista vacía — el botón nunca salía.
Ahora se guarda de qué operación ya se consultó el flujo: si ya se consultó y no hay estatus, aparece
"✕ Cancelar referencia" (junto a Registrar Status y dentro de Registrar Movimiento). Mientras carga, no.

## Archivos
src/features/operaciones/components/OperacionesDashboard.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint Operaciones 126 (igual); build OK.
