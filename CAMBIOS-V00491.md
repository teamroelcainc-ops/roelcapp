# V00491 — Auditoría de la cadena: motivos de los problemas, importes en su moneda y Editar Factura de Facturación

**Solo web.** Va encima de la V00490 (y la V00489). Sin funciones, reglas, índices ni banderas.

## Qué cambia (Facturación de Clientes → Auditar cliente)
1. **Motivos de los problemas.** La tarjeta de problemas abre la lista de cada uno con su motivo, agrupada:
   - En más de una factura (posible doble cobro)
   - Cancelada pero aparece en una factura
   - Cambió después de facturarse
   - Pagos aplicados distintos al pagado registrado
   - Pagada de más
   - Pagada de más por centavos (redondeo, menos de $1)
   - Sin facturar

   Al presionar uno se ve su camino (operación, factura y pagos). El Excel del reporte trae la hoja **Problemas**.
2. **Importe en la moneda en que se factura.** Una operación facturada en Dólares muestra sus dólares; en Pesos, la conversión. Facturas y pagos muestran total, pagado y saldo en su moneda, con su color. La operación se compara con su factura en la moneda de la factura.
3. **✎ de una factura** abre el formulario **Editar Factura** de Facturación (cliente, status, invoice, documentos, fecha, moneda y total). La auditoría queda detrás y regresa al cerrarlo. Se quitó el editor corto que tenía la auditoría.

## Pasos manuales
1. Aplicar el zip.
2. Auditar a Caro-Kar, presionar la tarjeta de problemas y revisar la lista. Los de "por centavos" se pueden marcar con ✓ revisado.

## Técnico
- `AuditoriaCadenaCliente.tsx`: `MOTIVOS`, `problemasPorMotivo`, `importe` y `monedaComparacion` por operación, `Importe` en las tarjetas, props `onEditarFactura` y `detras`; hoja Problemas en el Excel; CSS `acc-problemas*`.
- `FacturacionClientesDashboard.tsx`: `prepararEdicionFactura` (lo que hacía `abrirEditarFactura`) y `editarFacturaDesdeAuditoria`.
