# V00490 — Moneda de la empresa en operaciones, facturas y pagos

**Solo web.** Va encima de la V00489. Sin funciones, reglas, índices ni banderas (la V00489 sí pide desplegar funciones).

## Qué pasaba
Caro-Kar Transportes cobra en Pesos, pero en la Auditoría todas sus operaciones salían con ⚠ USD. No era un error de cobro: su precio (convenio) está en dólares y se cobra en pesos (LO-130126-6: 130 × 17.91 = $2,328.30, igual que su factura). La Auditoría mostraba la moneda del convenio como si fuera la de la operación. Además:
- el botón de moneda de Empresas cambiaba "Facturado en" pero dejaba el nombre copiado y los montos (Dólares / Pesos) de antes;
- en el formulario se podía poner a mano otra moneda distinta a la de la empresa.

## Decisión (Omaf, 26-oct)
Precio en dólares, cobro en pesos: Facturado en, facturas y pagos siempre en la moneda de la empresa. El convenio se queda en su moneda y se convierte con el tipo de cambio.

## Qué cambia
- **Formulario de operación**: Facturado en (Cliente y Proveedor) toma la moneda de su empresa y no se puede cambiar. Solo se elige a mano si la empresa no tiene moneda.
- **Operaciones → Corregir monedas** (antes "Corregir monedas de convenio"): además de la moneda del convenio, pone Facturado en con la moneda de su empresa y recalcula Subtotal, Dólares, Pesos y Utilidad. La Conversión en pesos no cambia. Si no se sabe la moneda del convenio, la operación no se toca y sale en la lista.
- **Empresas → botón de moneda**: corrige las operaciones de esa empresa igual que el botón de Operaciones (una por una) y también la moneda de sus pagos (solo la etiqueta).
- **Auditoría de la cadena**: la moneda de cada operación es en la que se factura; si el precio está en otra moneda dice "precio en USD", sin marcarla como problema.

## Pasos manuales
1. Aplicar el zip.
2. Operaciones → **Corregir monedas** → revisar la lista → Corregir.
3. Facturación → Historial → **Corregir monedas y montos** → Corregir.
4. Para los pagos de una empresa: Empresas → detalle de la empresa → botón de moneda.
5. Revisar que los detalles de convenio con precio en dólares digan Dólares: si un detalle no trae moneda, el formulario usa la del convenio maestro (la de la empresa).

## Técnico
- `operaciones/services/corregirMonedaConvenio.ts`: `monedaEmpresaDelLado`, `revisarLado` (convenio → Facturado en + nombre → montos), `lados` opcional, `cambianFacturado`; `CambioLado` con `facturadoAntes/Despues`; fuente `guardada`.
- `corregirMonedaConvenioDatos.ts`: `leerConvenios` también lee `empresas` y `catalogo_moneda` (moneda por empresa con `monedaDeEmpresa` de reglasFactura).
- `empresas/services/propagarMoneda.ts`: operaciones en transacción con `corregirOperacion(id, cat, [lado])`; pagos; `canon` también por ID; `opsSinTocar`, `pagos`.
- `FormularioOperacion.tsx`: `monedaFijaCliente` / `monedaFijaProveedor` (select deshabilitado `fo-moneda-fija`, efecto que los iguala, Autorizaciones no los cuenta).
- `AuditoriaCadenaCliente.tsx`: chip con `monedaFacturaOperacion`, `monedaConvenio` aparte.
