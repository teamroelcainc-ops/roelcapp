# V00278 — FIX: "Reemplazar…" el documento de la factura desde el editor

## Archivos que cambian (respetar rutas)
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx`
- `src/features/facturacion/components/FacturacionProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00278.

## El bug y el arreglo
El selector de archivo del documento diferido estaba montado DENTRO del
modal de "Confirmar Factura", así que al presionar "Reemplazar…" (o
"Elegir archivo…") desde el modal de EDITAR, el botón apuntaba a un
input que no existía en pantalla y no pasaba nada. El input oculto ahora
vive al nivel raíz del módulo, SIEMPRE montado, y lo comparten los dos
modales: al presionar "Reemplazar…" se abre la ventana de archivos, el
elegido se muestra como 📎 pendiente y SE SUBE AL GUARDAR los cambios
(reemplazando el anterior). Corregido en Facturación de Clientes y de
Proveedores (el mismo bug estaba latente en ambos).

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: 308 y 335 — idénticos a su base.
- `npm run build`: OK (PWA generada).
