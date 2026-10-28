# V00505 — Revisión de datos (pasos 0 y 1 del reporte del 27-oct)

**Solo web.** Va encima de la V00504. Sin funciones, reglas, índices ni banderas. **No escribe nada en la base de datos.**

## Paso 0 · C1 a C5 (reporte hecho sobre la V00495)
Todos ya estaban corregidos. Se revisó cada uno en el código actual:

| # | Qué | Dónde | Prueba | ¿Desplegar? |
|---|---|---|---|---|
| C1 | La moneda de Empresas no cambia los pagos de facturas emitidas ("Pagos sin tocar") | `empresas/services/monedaPagos.ts` + `propagarMoneda.ts` (V00496) | `monedaPagos.test.ts` | No |
| C2 | El aviso ya no pide correr Corregir monedas y montos para las emitidas | `EmpresasDashboard.tsx`, `FormularioEmpresa.tsx` (V00496) | — (texto) | No |
| C3 | Borrar un duplicado con `dineroPorServidor` no regresa a Pendientes lo que sigue en otra factura | callable `eliminarFactura` + `destinoAlEliminar` (V00496) | `functions/test/dinero.test.ts`, `shared/dominio/facturacion.test.ts` | **Sí**: `eliminarFactura` (V00496, sigue pendiente) |
| C4 | Facturación con la lista de facturas en vivo | `facturacion/hooks/useFacturasEnVivo.ts` (V00497) | `useFacturasEnVivo.test.tsx` | No |
| C5 | Unir duplicados de Pagos sin el tope de 12,000 | `descargarFacturasComoVivas` (V00496) | **nueva**: `facturacion/services/descargarFacturas.test.ts` | No |

C5 no tenía prueba propia. Ahora la tiene:
- baja 13,500 facturas página por página, sin aviso;
- el tope de seguridad se avisa.

## Paso 1 · Herramienta "Revisión de datos"
Botón **Revisión de datos** en la barra de Operaciones, junto a Excel y Corregir monedas.
- Al abrir no lee nada. Al presionar **Revisar**:
  - lee todas las operaciones, con el avance "X de Y";
  - lee las facturas de clientes;
  - lista los errores por grupo, con su cantidad y prioridad.
- **Cada registro tiene "Abrir"**: cierra la ventana y abre su ficha en su módulo.
  - Las operaciones abren en Activas, Completadas o Canceladas, según su status.
  - Las facturas abren en Facturación de Clientes.
- Hay botones extra para lo relacionado: las facturas de una operación, o la otra operación con la misma referencia.
- **Excel** con todas las filas, una columna "Grupo" para filtrar y "Dónde se corrige".
- El último resultado queda en memoria durante la sesión: al volver a abrir la ventana sigue ahí. "Revisar de nuevo" lo actualiza.

| Grupo | Qué lista | Regla |
|---|---|---|
| F4 | Operaciones en dos o más facturas no canceladas | Por folio (invoice + cliente): los documentos de un mismo folio cuentan como una. |
| F1 | En la lista de una factura no cancelada, sin Invoice ni marca de facturada | La marca es la misma que usa el servidor (`facturadaCliente`). |
| D2 | Referencia repetida | Sin mayúsculas ni espacios; cada una enlaza a la otra. |
| F3 | Invoice de la operación que no existe en Facturas (de cualquier status) | Sugiere el Invoice si una sola factura la lista. |
| D1 / D4 / D5 | Moneda distinta a la empresa / montos que no cuadran / faltan datos | La MISMA regla del Excel de operaciones (`validacionExcel.ts`, V00503). Dice si ya está facturada. |
| F2 | Total de la factura distinto a la suma de sus operaciones | En la moneda de la factura (`conversionOperacion` con esa moneda). El total es el del Historial (regla única o legado según `dineroPorServidor`). |
| F2c | Lo mismo, pero por menos de $1 | |
| D6 | Canceladas que conservan su monto | |
| F5 | Terminadas (completadas o en falso) sin Invoice, sin marca y en ninguna factura no cancelada | |
| D3 | Sin status, o con un status que no está en el catálogo | Los ids fijos de Completado y Cancelado cuentan como status. |

Detalles de la regla:
- **Cómo se liga** una factura con sus operaciones:
  - por id del documento, por el id de AppSheet o por referencia;
  - por referencia solo si la tiene UNA operación: una repetida no se puede saber a cuál se refiere.
  - Los renglones que no se ligan se cuentan aparte ("renglones sin ligar").
- **Solo el lado del cliente**, como el reporte.
- **Las facturas "No Aplica"** se cuentan como activas por ahora (pendiente de que Roelca decida) y se muestra su status.

## Lecturas
Solo al presionar Revisar:
- **Operaciones:** todas.
  - Es la misma excepción documentada que el Excel de la V00500: la lanza el usuario a mano y avisa el avance.
  - Una revisión cuesta tantas lecturas como operaciones haya.
- **Facturas de clientes:** del listener compartido de Facturación y Pagos. Si ya está abierto, no cuesta lecturas nuevas.
- **Empresas y el catálogo de status:** catálogos abiertos.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones por esta versión.
3. Sigue pendiente de la V00496: `firebase deploy --only functions:eliminarFactura,...` (C3 no funciona en producción hasta entonces).

## Técnico
- `operaciones/services/revisionDatos.ts` (puro, con pruebas): `revisarDatos`, `GRUPOS_REVISION`, `filasExcelRevision`.
- `operaciones/services/revisionDatosLectura.ts`:
  - `leerYRevisarDatos` usa `recorrerOperaciones`, `obtenerVivo('pagos:facturas_clientes')`, `leerMonedasEmpresas`, el catálogo de status y las banderas;
  - `ultimaRevisionDatos` guarda el resultado en memoria.
- `operaciones/components/RevisionDatosModal.tsx` + `.css` (prefijo `rvd-`): se carga al presionar el botón.
- `PestanasOperaciones.tsx`: botón `pop-btn-revision`.
- `facturacion/services/descargarFacturas.test.ts`: la prueba de C5.
- Tamaño: el arranque pasa de 240.8 a 241.0 KB comprimido (el botón); la ventana son 5.5 KB aparte.
- Simulador (16,000 operaciones, 9,010 facturas, casos sembrados):
  - la revisión tardó 6.3 s;
  - cada caso sembrado salió en su grupo (F4, F1, D2, F3, D6, D3);
  - "Abrir" llevó a Completadas con la ficha abierta;
  - al volver a abrir la ventana, el resultado seguía;
  - el Excel salió con 37,251 filas y el filtro puesto.
- No probado contra datos reales: las cantidades. En el simulador las operaciones no traen montos ni marcas de facturada, por eso D5, F1, F2 y F5 salen enormes allí.
