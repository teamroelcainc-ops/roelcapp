# V00481 — Facturación: Remisión, cancelación con reemplazo, moneda del cliente y colores por moneda

**Solo web.** Va encima de la V00480. Sin funciones, reglas, índices ni banderas. Campos nuevos en `facturas_clientes` / `facturas_proveedores` (no son de dinero; las reglas actuales ya los permiten).

## Qué cambia en pantalla (Clientes y Proveedores)
1. **Facturado**: la ficha ya no muestra *Remisión* ni *＋ Agregar referencia*; la tabla ya no muestra el botón de Remisión. Si de otra forma se intenta, la app no la genera. Con *No Facturado* (y *Cancelado*) siguen.
2. **Cancelado**: al cambiar el status a Cancelado (ficha, Editar Factura o Pagos) se pide la **nota** y el **número de la factura que la reemplaza**. Sin las dos no se cancela. La ficha muestra *Factura cancelada*: la reemplaza, nota, cuándo y quién. Si vuelve a otro status, esos datos se quitan. Una factura nueva ya no se crea Cancelada.
3. **Moneda**: siempre la del cliente/proveedor en **Empresas**. En Editar Factura ya no hay selector (ni "Sin definir"): se muestra la de la empresa. Si la empresa no tiene moneda, no se puede generar ni guardar la factura (aviso en rojo). Si la factura estaba en otra moneda: aviso en la ficha (con botón *Editar factura*) y en el editor; al guardar queda en la moneda de la empresa y el total sugerido ya viene en esa moneda.
4. **Importes**: cada operación de la ficha muestra su importe en la moneda de la factura (Dólares → *Dólares (Cliente)*; Pesos → *Conversión Final (Ingreso)*). *Total Facturado* de la ficha va en esa moneda (antes mostraba la conversión a pesos aunque fuera en dólares). Al generar la factura, el encabezado dice *Total (N Ops)* en la moneda del cliente.
5. **Colores**: Pesos en **verde** y Dólares en **azul** (importes y la palabra). Estaba al revés en las tarjetas Total Facturado, los filtros de moneda, las columnas Dólares/Pesos y la Remisión.
6. **Detalle de Operación** (desde la ficha): botón **✎ Editar operación**; abre el formulario de Operaciones y la ficha queda detrás.

## Pasos manuales
1. Revisar en **Empresas** que los clientes y proveedores tengan su **moneda**: sin ella ya no se puede facturar.
2. Las facturas que estén en otra moneda que la de su empresa mostrarán el aviso; se corrigen con *Editar factura* (revisar el total sugerido antes de guardar).

## Técnico
- `features/facturacion/services/reglasFactura.ts` (+ prueba): status, cancelación (`planCancelacion`), `monedaDeEmpresa`, avisos, `importesDeRenglones`, `totalSugeridoEn`.
- `features/facturacion/services/statusFacturaDatos.ts`: `escrituraCancelacion` (con `deleteField`) y `escribirEnGrupo`.
- Componentes nuevos: `Importe` (+ `NombreMoneda`), `AvisoMonedaFactura`, `CamposCancelacion`, `ModalCancelarFactura`, `CancelacionFicha`, cada uno con su CSS.
- `FacturacionClientesDashboard` / `FacturacionProveedoresDashboard`: ficha, tabla, editor, generar, agregar referencia, detalle de operación. `PagosDashboard`: nota y reemplazo al cancelar desde Pagos.
- Campos nuevos: `motivoCancelacion`, `facturaReemplazo`, `canceladaEn`, `canceladaPor`.
- No probado en el navegador: el camino con la bandera `dineroPorServidor` (el banco no tiene las callables).
