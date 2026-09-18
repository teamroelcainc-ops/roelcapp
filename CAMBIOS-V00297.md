# V00297 — Sincronización TOTAL bidireccional: ningún convenio sin su tarifario

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00297.

## El botón "⟳ Sincronizar TODOS" ahora cierra la relación en AMBOS sentidos
Además de lo que ya hacía (tarifario → convenios: ligar originales,
reparar duplicados, eliminar huérfanos), al final ejecuta la **fase
inversa**: recorre TODOS los detalles de convenios y liga cada uno a SU
tarifario. Resolución del más fuerte al más débil:
- **(a) Por consecutivo** — el tarifario cuya línea tiene ese mismo
  CONV-### (relación directa); de paso alinea status y tarifa del detalle
  con la línea.
- **(b) Único tarifario del mismo convenio maestro** — si el convenio
  solo tiene un tarifario ligado, es ese.
- **(c) Por empresa + descripción** (y monto si hay varias candidatas) —
  y si la línea encontrada no tenía consecutivo, ADOPTA el del detalle,
  cerrando la relación en los dos sentidos.
Lo que no se puede resolver con certeza NO se inventa: el resumen final
lo reporta como "sin tarifario identificable (revisar a mano)".

El resumen del botón ahora muestra las dos direcciones: lo reparado en
tarifarios y cuántos convenios quedaron ligados a su tarifario (más los
pendientes de revisión manual, que idealmente deben ser 0 o muy pocos —
convenios de empresas que nunca tuvieron tarifario).

## Uso
Ejecuta "⟳ Sincronizar TODOS" en Tarifario Clientes y en Tarifario
Proveedores. Después de eso, en Detalles del Convenio no debe quedar
ningún registro sin tarifario (salvo los reportados como no
identificables, que son casos para decidir a mano).

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: ambos tarifarios 0.
- `npm run build`: OK (PWA generada).
