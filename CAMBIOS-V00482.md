# V00482 — Facturación: botón Corregir monedas y montos y una vista más sencilla

**Solo web.** Va encima de la V00481. Sin funciones nuevas, reglas, índices ni banderas (con `dineroPorServidor` usa la callable `recalcularFactura`, que ya existe).

## Qué cambia en pantalla (Clientes y Proveedores, Historial de Facturas)
1. **Corregir monedas y montos** (botón nuevo, junto a Filtros):
   - Primero **revisa** todas las facturas sin cambiar nada: cuántas se corrigen (con su moneda y total de antes y después), cuántas ya están bien y cuáles se saltan y por qué.
   - Al presionar **Corregir N facturas**, cada una queda en la **moneda de su cliente/proveedor en Empresas** con el **total de sus operaciones**: Dólares → suma de Dólares (Cliente/Proveedor); Pesos → Conversión Final (pesos + dólares × TC). Sus renglones también se actualizan.
   - **Se saltan**: canceladas, con pagos aplicados (revisarlas en Pagos), de empresas sin moneda, sin operaciones ligadas o con operaciones sin importe ($0).
   - Se puede **Detener**; lo ya corregido se queda.
2. La moneda **no se cambia** desde Facturación: siempre la de Empresas.
3. **Quitados**: Encabezado Remisión, Verificar y Sincronizar con Empresas. Las remisiones siguen saliendo con el encabezado que ya estaba guardado.
4. **Vista más sencilla**: buscador y botones en la misma fila que Filtros; tarjetas más chicas; filas más bajas; si una factura tiene más de 3 referencias se ven 3 y **+N** (abre la ficha).

## Pasos manuales
1. Revisar en **Empresas** que cada cliente y proveedor tenga su moneda (las que no, se saltan).
2. Correr **Corregir monedas y montos** en Clientes y en Proveedores. Revisar la lista antes de confirmar. Lee una vez todas las operaciones facturadas (unas 8,600 lecturas en Clientes).
3. Las facturas con pagos que salgan en la lista se corrigen una por una desde Pagos (Recalcular montos), si hace falta.

## Técnico
- `features/facturacion/services/corregirFacturas.ts` (+ prueba): `revisarFactura`, `motivoParaSaltar`, `resumirRevision`.
- `features/facturacion/services/corregirFacturasDatos.ts`: `leerOperaciones` (porIds), `corregirFactura` (transacción o callable).
- `features/facturacion/components/CorregirFacturasModal.tsx` + `.css`, `AccionesHistorial.tsx` + `.css`.
- `reglasFactura.monedaDeEmpresa`: manda `empresa.moneda` sobre `monedaRef`.
- Dashboards: sin los tres botones y sus modales; filas y tarjetas compactas.
