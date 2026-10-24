# V00483 — Facturación: corregir también las facturas con pagos, y los pagos en la ficha

**Solo web.** Va encima de la V00482. Sin funciones nuevas, reglas, índices ni banderas.

## Qué cambia en pantalla (Clientes y Proveedores)
1. **Corregir monedas y montos corrige todas las facturas**, tengan pagos o no:
   - Los pagos no se tocan. El saldo se recalcula con lo ya pagado (Parcial o Pagada).
   - Si lo pagado pasa del total nuevo: la factura queda **Pagada con saldo $0** y la lista la marca **pagada de más** con la diferencia (revisarla en Pagos).
   - La revisión trae la columna **Pagado** y un aviso con cuántas tienen pagos.
   - Se siguen saltando: canceladas, empresas sin moneda, sin operaciones o con recálculo en $0.
2. **Ficha de Factura con pagos**: más ancha y a la derecha **Pagos de esta factura** (total, pagado, saldo y cada pago con número, fecha, método, referencia y lo aplicado).
3. **Clic en un pago** → se abre Pagos con el **detalle de ese pago** (necesita el permiso de Pagos; sin él, la lista se ve pero no se abre).
4. Teléfono: los pagos van debajo del detalle y los datos de la ficha ya no se salen de la pantalla.

## Pasos manuales
1. Volver a correr **Corregir monedas y montos** en Clientes y en Proveedores (ahora incluye las que tienen pagos). Revisar la lista antes de confirmar, sobre todo las marcadas **de más**.
2. Las pagadas de más: revisar en Pagos si el pago se aplicó a la factura correcta.
3. Si `dineroPorServidor` está encendida: el servidor no deja un total menor a lo pagado; esas facturas salen como error y se revisan en Pagos.

## Técnico
- `features/facturacion/services/corregirFacturas.ts` (+ prueba): ya no salta por pagos; `pagado`, `pagadoDeMas`; `ResumenRevision.conPagos` / `deMas`.
- `features/facturacion/services/pagosDeFactura.ts` (+ prueba): `indexarPagos`, `pagosDeFacturas`, `numerosPorFactura`.
- `features/facturacion/components/PagosDeFactura.tsx` + `.css` (`pfa-`).
- `features/pagos/services/pagoPedido.ts`: `abrirPagoEnPagos`, `pagoPedido`, `olvidarPagoPedido`; `PagosDashboard` lo lee al montar.
- Dashboards: el listener de pagos guarda el detalle; ficha `*-ficha--con-pagos` (1180 px, cuadrícula con columna de 340 px); `CorregirFacturasModal` con columna Pagado.
