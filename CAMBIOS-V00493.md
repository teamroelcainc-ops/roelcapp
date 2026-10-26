# V00493 — Estadísticas: los montos de Facturación salen de las facturas

**Solo web.** Va encima de la V00492. Sin cambios en funciones, reglas, índices ni banderas.

## Qué cambia
**Estadísticas → área Facturación** (Desglose, Tendencia por cliente, Ventas, Utilidad y Promedios):
- El dinero sale del **módulo de Facturación**: las facturas de clientes con **fecha de factura** dentro del rango buscado, **sin canceladas**, con el mismo total que el Historial de Facturación. Pesos y dólares cuadran con las tarjetas del Historial con las mismas fechas.
- Cada factura reparte su total entre sus operaciones (al centavo), así el desglose por tipo, cliente, operador, unidad o proveedor suma exactamente lo facturado.
- **Costo proveedor** = facturas de proveedor de esas mismas operaciones.
- **Aparte (no se suman)**:
  - *Por facturar*: operaciones con servicio en el rango que aún no están en una factura de cliente, con su Por Cobrar.
  - *Sin factura del proveedor*: operaciones ya facturadas al cliente cuyo Por Pagar aún no tiene factura del proveedor (su costo no entra en la utilidad).
  - Facturas canceladas o sin moneda del rango.
  Al presionar "Por facturar" o "Sin factura del proveedor" se abre el resumen de esas operaciones.
- El área Operaciones no cambia (cuenta servicios por fecha de servicio).

**Facturación → Historial (Clientes y Proveedores)**: las tarjetas Ops. Facturadas y Total Facturado ya **no suman las facturas canceladas** (su reemplazo ya suma). Siguen en la lista; la tarjeta Facturas Listadas avisa cuántas hay. Filtrando por status Cancelado sí se suman.

## Por qué no cuadraba antes
Estadísticas sumaba el Por Cobrar guardado en cada operación por **fecha de servicio**, estuviera facturada o no (8,718 operaciones contra 8,606 facturadas), y una operación cobrada en dólares dentro de una factura en pesos se contaba en dólares. Facturación suma el total de cada **factura** por su fecha (y con "Todos" incluía las canceladas).

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. Revisar con el cliente: Estadísticas → Facturación con un rango y Facturación → Historial con las mismas fechas: Pesos y Dólares deben coincidir.

## Técnico
- `src/features/estadisticas/services/montosFacturados.ts` (+ pruebas): `renglonesFacturados`, `repartirCentavos`, `pesosDeRenglones`, `operacionesConFactura`, `costoPorOperacion`.
- `src/features/estadisticas/hooks/useMontosFacturados.ts`: filas del área Facturación; operaciones facturadas con servicio de otro periodo por `porIds` (lotes de 30, una vez).
- `src/features/estadisticas/components/ResumenMontosFacturados.tsx/.css`: total facturado y lo que va aparte.
- `EstadisticasDashboard.tsx`: helpers de montos con `__fact`/`__costo`/`__fechaFact`; Tendencia, Ventas, Utilidad, Promedios y Desglose de Facturación con esas filas; las facturas del join de formatos pasan al listener compartido (`pagos:facturas_clientes` / `pagos:facturas_proveedores`), ya no hay un segundo listener de la colección completa.
- `DesgloseJerarquico.tsx`: prop `fechaDe` para "Ver por mes".
- `src/features/facturacion/services/normalizarFactura.ts`: forma única de la factura (antes una copia en cada tablero de Facturación).
- `reglasFactura.ts`: `sumaEnTotales` (+ prueba). Tableros de Facturación: tarjetas sin canceladas; detalle y Excel de la tarjeta con el total de la fila agrupada.
