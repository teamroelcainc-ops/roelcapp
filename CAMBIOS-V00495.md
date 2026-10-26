# V00495 — Una factura emitida solo cambia de valor a mano, una por una

**Web + una Cloud Function** (`operacionEscrita`). Va encima de la V00494. Sin reglas, índices ni banderas.

## Qué pidió Roelca
"Es bien fácil… una vez facturado, la única forma de cambiar el valor de la factura es manual, 1 x 1."

## La regla
- **Factura emitida** = cualquier status salvo **No Facturado** (Facturado, Cancelado, Pagada… y sin status, que la app muestra como Facturado). Su valor queda **congelado**: nada automático ni masivo lo cambia.
- **Borrador** (No Facturado): sigue a sus operaciones como hasta hoy.
- Formas manuales, una factura a la vez, que sí cambian el valor: **Facturación → Editar factura** (total, moneda), agregar o quitar una operación de esa factura y **Pagos → Recalcular montos**.

## Qué cambió
| Antes | Ahora |
|---|---|
| Al guardar una operación facturada con un cambio de dinero (monto, cargos, T.C., Facturado en, conversión), el servidor rehacía el renglón y el total de su factura. | Si la factura está emitida, el servidor solo copia el nombre del convenio y la Ref Cliente; importes y total se quedan. Solo un borrador se recalcula. |
| **Corregir monedas y montos** (Facturación) recalculaba todas las facturas, salvo canceladas y totales manuales. | Se salta las emitidas con el motivo "Ya facturada: su valor solo se cambia a mano, una por una (Editar factura)". Corrige solo borradores. |
| El botón de moneda de **Empresas** (y guardar una empresa con otra moneda) cambiaba la moneda de todas sus facturas. | Las emitidas no se tocan; el aviso final dice cuántas quedaron igual. |
| **Corregir monedas** (Operaciones) corregía también operaciones facturadas, y con eso cambiaba su factura. | Una operación facturada de ese lado no se corrige: sale en la lista para revisar, con el motivo. El otro lado, si no está facturado, sí se corrige. |
| El aviso amarillo del formulario decía "si cambias uno a mano, al guardar también cambia la factura". | Dice que cambiar un importe cambia la operación, no la factura, y que el valor de una factura emitida se cambia a mano en Facturación → Editar factura. |

Consecuencia esperada: si alguien cambia a mano un importe de una operación ya facturada, la operación y su factura quedan distintas. La Auditoría de la cadena lo marca como "cambió después de facturarse". Se corrige a mano en esa factura, si hace falta.

**Ojo con lo que se pidió antes:** en la V00486, V00487 y V00489 se pidió correr "Corregir monedas y montos" para arreglar facturas con montos mal. Desde esta versión esa herramienta ya no toca las emitidas. Las que sigan mal se corrigen una por una en Editar factura (o con Recalcular montos en Pagos).

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. Desplegar la función (cambió `functions/src/relacional.ts`; `functions/src/dominio` lo copia el build):
   `npm --prefix functions run build`
   `firebase deploy --only functions:operacionEscrita`
   (nunca `firebase deploy` sin `--only`). **Sin este paso el servidor sigue cambiando el valor de las facturas emitidas** al guardar una operación.

## Técnico
- `src/shared/dominio/cascadaFacturas.ts` (+ pruebas; copia en `functions/src/dominio`): `valorCongelado(statusFactura)` = true para todo status salvo "No Facturado" (sin acentos, espacios ni mayúsculas).
- `functions/src/relacional.ts` (`relacional-v1.9`): en `propagarMontoOperacionAFacturas`, `soloTexto || valorCongelado(fac.statusFactura)` → solo texto. Pruebas: los fixtures de la cascada pasan a "No Facturado" y dos pruebas nuevas (emitida: un cambio de dinero no escribe; la Ref Cliente sí se copia sin tocar importes ni `subtotalMonedaFactura`).
- `corregirFacturas.ts`: `MOTIVO_FACTURADA` en `motivoParaSaltar` (después de canceladas y total manual). `CorregirFacturasModal`: texto del encabezado.
- `empresas/services/propagarMoneda.ts`: `facturasSinTocar`; alertas de `EmpresasDashboard` y `FormularioEmpresa`.
- `operaciones/services/corregirMonedaConvenio.ts`: `MOTIVO_FACTURADA_OP` con `facturadaCliente/Proveedor` por lado (+ prueba).
- `FormularioOperacion.tsx`: texto de los dos avisos `.fo-aviso-facturada`.
- No probado en el navegador: la Cloud Function (el simulador no corre funciones; cubierta por sus pruebas).
