# V00515 — Facturación: tarjetas al lado del título y tabla sin scroll propio

**Solo web.** Va encima de la V00514. Sin funciones, reglas, índices, banderas ni dependencias, y no cambia datos.

## Qué cambia

### Facturación de Clientes y Facturación de Proveedores
- **Tarjetas al lado del título**: las tarjetas de resumen ya no ocupan su propio renglón arriba de la tabla. Van a la derecha de "Facturación de Clientes" / "Facturación de Proveedores", más compactas.
  - Cambian según la pestaña:
    - **Asignar Operaciones**: en espera por facturar, ya facturadas y total completadas.
    - **Historial de Facturas** y **Pagadas**: facturas listadas, operaciones facturadas, total en dólares y total en pesos.
    - **Revisión** (Clientes): sin tarjetas, igual que antes.
  - Las de Clientes siguen abriendo el detalle de dónde sale el número.
  - En pantallas angostas las tarjetas pasan debajo del título. En teléfono ocupan todo el ancho.
- **La tabla sube**: se libera el renglón que ocupaban las tarjetas. Medido en el simulador a 1440 px: la tabla empieza 96 px más arriba en Asignar Operaciones y 75 px en Historial.
- **Sin scroll vertical en la tabla**: la tabla ya no tiene alto máximo ni barra propia para bajar. Crece con sus filas y se baja con la barra de la ventana.
  - La barra para moverse a los lados sigue en la tabla, al final de sus filas. También funciona Shift + rueda del mouse.
  - Como la tabla ya no se desplaza por dentro, **sus encabezados ya no se quedan fijos arriba** al bajar.

## Archivos (9)
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/features/facturacion/components/FacturacionProveedoresDashboard.tsx` y `.css`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00515.md`

## Pasos manuales
1. Aplica el zip encima de la V00514 (no hay archivos borrados) y haz el commit: el conteo debe dar **9**.
2. Push y publicar: `npm run build` y `npx wrangler deploy`.
