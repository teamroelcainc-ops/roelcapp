# V00387 — Movimiento en Falso paga la mitad del sueldo

## Regla (src/utils/sueldoFalso.ts, NUEVO)
- Estatus cuyo nombre contiene la palabra "Falso" (ej. "7. Falso") → Sueldo Operador ÷ 2
  (400 → 200, redondeo a centavos) y Sueldo Total = mitad + Sueldo Extra (el extra no se divide).
- Se guarda el completo en `sueldoOperadorCompleto` y `sueldoMitadAplicada: true` para no
  dividir dos veces.
- Si la operación sale de Falso (otro estatus o se deshace la marca) → se restaura el completo.
- Si se trae el sueldo del convenio ("↻ Actualizar convenio" o cambio de convenio) estando en Falso,
  se vuelve a aplicar la mitad sobre el sueldo nuevo.

## Dónde aplica
- Formulario de la operación (se ve al instante con el estatus calculado y se guarda).
- Registrar Movimiento y botones de Siguiente paso: Operaciones Activas, Servicios Completados y
  Servicios Cancelados (incluida la cascada automática).
- Mis Operaciones (marca del operador y "deshacer última marca").
- Nómina lee el sueldo guardado, así que paga la mitad.

## Nota
Operaciones que YA estaban en Falso antes de esta versión se ajustan al abrirlas y guardarlas
(o al registrar un nuevo movimiento).

## Archivos
src/utils/sueldoFalso.ts (nuevo)
src/features/operaciones/components/{FormularioOperacion, OperacionesDashboard, ServiciosCompletados, ServiciosCancelados}.tsx
src/features/misOperaciones/components/MisOperacionesDashboard.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes en todos; prueba de la regla (400→200, sin doble división,
restauración); build OK.
