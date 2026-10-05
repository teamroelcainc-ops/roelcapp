# V00425 — Relación Tarifario (padre) ↔ Convenios (detalles) corregida

## Causa
La llave entre la línea del tarifario y su convenio es el CONSECUTIVO, pero se guarda en formatos
distintos según quién lo escribió: "CONV-054" en el tarifario y "054" en el convenio. Se comparaban
como texto exacto → no coincidían:
- El detalle del tarifario no encontraba el convenio → Operaciones = 0.
- Al borrar el convenio 515/518, la cascada no encontraba su línea → quedó huérfana en el tarifario.

## Cambio
- NUEVO src/utils/claveConsecutivo.ts: compara por NÚMERO ("CONV-054" = "054" = 54).
- Aplicado en Tarifario Clientes, Tarifario Proveedores y Convenio de Clientes/Proveedores: detalle de la
  línea, sincronizar, alinear, reparar relación y la cascada al borrar/unir convenios.
- Detalle del tarifario: las líneas sin convenio muestran "Sin convenio" y el botón
  "Quitar N sin convenio" las elimina del tarifario (en tu caso, CONV-515 y CONV-518 de Huizachal).

## Archivos
src/utils/claveConsecutivo.ts (nuevo)
src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx + .css
src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx
src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint 0 en los archivos tocados; build OK.
