# V00407 — Guardar flujos de servicios con "/" en el nombre

## Causa
El id del documento del flujo se arma con el nombre del servicio; "Rentas (Patio / Equipo)" lleva "/",
que Firestore interpreta como separador de ruta → "Invalid document reference".

## Cambio
- `idDocFlujo()` (statusRules.ts) cambia "/" por "／" (barra ancha) en el id del documento; se usa
  igual al guardar, leer y borrar flujos (Configurador, statusRules, Formulario de Operaciones).
  El nombre del servicio y el configId guardado dentro del documento no cambian.
- Al renombrar una combinación, la comparación con el flujo anterior usa el mismo formato
  (incluye "Todos"), así no pregunta por borrar un duplicado que no existe.

## Archivos
src/features/operaciones/config/statusRules.ts
src/features/configuracion/components/ConfiguradorStatus.tsx
src/features/operaciones/components/FormularioOperacion.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes; build OK.
