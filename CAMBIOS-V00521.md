# V00521 — Facturación de Clientes: Ops. Facturadas muestra las operaciones

**Solo web.** Va encima de la V00520. Sin funciones, reglas, índices, banderas ni dependencias. No escribe datos.

## Qué cambia
En Historial de Facturas → tarjeta **Ops. Facturadas**:
- Lista las **operaciones** facturadas, no las facturas. Por cada una: referencia, caja, invoice, fecha de la factura, cliente, moneda y lo que cobra en su factura.
- Sigue los filtros del historial:
  - si buscas una factura (por ejemplo **A5510**), salen solo sus operaciones;
  - sin filtro, todas las facturadas (sin las canceladas, como la tarjeta).
- Arriba dice cuántas facturas y cuántas operaciones son, y el total de esas facturas.
- Con un clic en una operación se abre su **detalle**, con su botón ✎ Editar operación. Al cerrarlo vuelves a la lista.
  - Si la operación no está ligada (solo su referencia), el clic abre la Ficha de su factura.
- Se muestran de 300 en 300 con **Mostrar más**. **Descargar Excel** trae todas, una fila por operación.
- En las facturas viejas que no guardaron lo que cobró cada operación, el importe sale como **—**.
- Las otras tarjetas (Facturas Listadas, Total USD, Total MXN) siguen listando facturas.

## Archivos (7)
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00521.md`

## Pasos manuales
1. Aplica el zip encima de la V00520 (no hay archivos borrados) y haz el commit: el conteo debe dar **7**.
2. Push y publicar: `npm run build` y `npx wrangler deploy`.
3. Prueba: Historial → busca A5510 → tarjeta Ops. Facturadas: deben salir sus 2 operaciones. Clic en una → su detalle.
