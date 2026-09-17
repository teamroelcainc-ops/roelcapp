# V00290 — Botones del detalle del tarifario compactos y uniformes

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.css`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.css`
- `src/config/version.ts` y `public/version.json` — bump a V00290.

## El ajuste (solo CSS)
Los botones del pie de la ficha (+ Agregar tarifa, ⟳ Sincronizar
convenios, Tarifario firmado, Editar, Eliminar, Descargar PDF, Cerrar)
quedaron con el MISMO tamaño compacto: padding 7×12, letra 0.8rem, texto
en una sola línea (sin envolver en dos renglones) y esquinas parejas. El
pie envuelve en fila si no caben, sin agrandar nada. Aplica a clientes y
proveedores; la funcionalidad no se tocó.

## Verificación
- Solo hojas de estilo — `npm run build`: OK (PWA generada).
