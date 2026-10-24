# V00484 — Referencias de la empresa: editar y Actualizar; Pagos: plantilla de facturas y Expandir

**Solo web.** Va encima de la V00483. Sin funciones nuevas, reglas, índices ni banderas.

## Qué cambia en pantalla
1. **Empresas → Detalle de Empresa → Referencias**
   - Cada operación tiene un **lápiz** que abre el formulario de edición de la operación. En el Detalle de Operación también está **Editar operación**.
   - Al guardar en el formulario, el renglón de esa operación se actualiza solo.
   - **Actualizar** vuelve a leer operaciones, convenios, facturas y pagos **sin quitar la vista**: la sección, la búsqueda y la posición de la lista se quedan.
2. **Pagos → Registrar pago y Editar pago: plantilla de facturas**
   - **Descargar plantilla**: un Excel con las columnas *Factura* y *Monto (opcional)*, y una hoja de instrucciones.
   - **Cargar plantilla**: se marcan las transacciones pendientes que coinciden, con su saldo completo.
   - El monto **solo confirma**: si no es igual al saldo abierto, esa factura no se marca.
   - Las que no se marcan salen en una lista con el motivo y el renglón: el monto no coincide (y cuál es el saldo), ya está pagada, es de otra empresa, ya está en este pago, no se encontró o está repetida.
3. **Expandir** en Transacciones pendientes (Registrar pago), en las facturas de Editar pago y en la lista del Detalle del pago: la tabla ocupa casi toda la pantalla; en Registrar pago lleva abajo las marcadas, el Monto a aplicar y el Monto a favor. **Contraer** o **Esc** la regresan.

## Pasos manuales
Ninguno.

## Técnico
- `features/empresas/services/referenciasEmpresa.ts`: `leerReferenciasEmpresa`, `releerOperacionReferencia`, `rolesDeOperacion`.
- `features/pagos/services/plantillaFacturas.ts` (+ prueba): `leerFilasPlantilla`, `cruzarPlantilla`, `claveFactura`, `leerMonto`.
- `features/pagos/services/plantillaFacturasExcel.ts`: descargar y leer (xlsx se carga al usarlo).
- `features/pagos/components/PlantillaFacturas.tsx` + `.css` (`ptf-`), `TablaExpandible.tsx` + `.css` (`pte-`).
- `EmpresasDashboard`: lápiz, Editar operación, Actualizar, `EditorOperacionEmbebido` perezoso.
- `PagosDashboard`: plantilla y Expandir en Registrar, Editar y Detalle; se quitaron `.pg-tabla-facturas` y `.pg-trans-encabezado`.
