# V00386 — Cambiar o actualizar el convenio trae todo lo ligado

## Causa
En una operación YA GUARDADA, al cambiar el convenio del cliente solo se re-derivaban tráfico, carga y
servicio: el monto (fila principal del convenio), la moneda, el sueldo del operador y el combustible
se quedaban con los del convenio anterior (los efectos tenían `if (initialData) return`).
"↻ Actualizar monto" solo traía el monto.

## Cambio (FormularioOperacion.tsx)
- Al cambiar el convenio (nuevo o guardado) se aplican UNA vez por convenio: monto y moneda (respeta
  la tarifa alterna A/B si se eligió), sueldo del operador y combustible (Gastos Incluidos /
  Rendimientos de la tarifa), tipo de servicio, tráfico y carga. Después se pueden ajustar a mano sin
  que se sobrescriban.
- "↻ Actualizar convenio" (antes "Actualizar monto", en Cliente y Convenio y en Por Cobrar): muestra
  qué cambia (monto, sueldo, combustible) y trae todos los datos vigentes aunque el convenio sea el mismo.
- Si la tarifa nueva no define sueldo o combustible, se conserva el valor actual.
- Totales, utilidad y facturación se recalculan solos al guardar (motor relacional existente).

## Archivos
src/features/operaciones/components/FormularioOperacion.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint 376 (igual que antes); build OK.
