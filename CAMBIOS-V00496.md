# V00496 — Moneda de Empresas y pagos, borrar duplicados en el servidor, Unir duplicados sin tope y script de facturas en texto

**Web + Cloud Functions + un script.** Va encima de la V00495. Sin reglas, índices ni banderas.

Corrige los puntos 1, 2, 3, 4 y 6 de la revisión de la V00495. El 5 (Facturación con el listener compartido) va en la V00497. El 7 no lleva código (abajo, "Facturas que quedaron mal antes"). Además, Pagos muestra y cobra cada factura en SU moneda (punto 1b), y lo que encontró una segunda revisión independiente de este cambio.

## 1. La moneda de Empresas ya no separa un pago de su factura emitida
`propagarMoneda.ts` cambiaba la moneda de TODOS los pagos de la empresa, aunque desde la V00495 sus facturas emitidas ya no cambian. Podía quedar una factura emitida en MXN con su pago en USD.

Ahora (`services/monedaPagos.ts`, con pruebas) un pago toma la moneda nueva solo si **todas** las facturas a las que está aplicado quedan en esa moneda:
- aplicado a una factura emitida en otra moneda → no se toca y se cuenta en **"Pagos sin tocar"**;
- aplicado solo a facturas que ya están (o quedan) en la moneda nueva → sí cambia (corrige pagos que ya estaban desfasados);
- sin facturas aplicadas, o de MTTO → sigue la moneda de la empresa, como antes.
Una factura aplicada que no es de esta empresa se lee por id; si no se encuentra, el pago no se toca (también cuenta en "Pagos sin tocar").
La moneda de cada factura se lee como la leen la tabla, la ficha y Pagos: primero `monedaFacturacion` / `monedaProveedor` (lo que escribe Editar factura), no solo `moneda` / `monedaId`. Una factura con esos campos en monedas distintas cuenta como "en otra moneda". Si un borrador trae también el campo de moneda del otro lado (p. ej. `monedaFacturacion` en una de proveedor), se actualiza igual.

## 1b. Pagos muestra y cobra cada factura en su moneda
Pagos tomaba la moneda de la EMPRESA como moneda de la factura (desde la V00148). Con la V00495, una factura emitida en Pesos de una empresa que pasó a Dólares se veía en Dólares (con su total en Pesos) y un pago nuevo se registraba en Dólares. Ahora manda la moneda guardada en la factura; la de la empresa solo si la factura no trae una reconocible. En la ficha de la factura, si la empresa ya está en otra moneda, aparece "(la empresa: USD)"; Recalcular montos (una factura a la vez) la cambia.
- **Editar factura** en Pagos guarda la moneda de la factura (antes la de la empresa: corregir solo el folio la pasaba a la otra moneda con el mismo monto) y en el campo de su lado (`monedaProveedor` en las de proveedor, el que lee Facturación Proveedores; antes siempre `monedaFacturacion`). Igual en la callable `editarFactura`.
- **Editar un pago** solo ofrece facturas de la moneda del pago, y el servidor (`editarPago`) rechaza mezclar monedas, como ya pasaba al registrar.
- El saldo de cada cliente o proveedor (lista de entidades y "Saldo del cliente") se muestra por moneda ("$100.00 MXN + $50.00 USD"): ya no suma Pesos con Dólares.

## 2. El aviso de Empresas ya no manda a Corregir monedas y montos
Antes decía "Después corre Corregir monedas y montos en Facturación para que los totales de sus facturas queden con esta moneda". Desde la V00495 esa herramienta se salta las emitidas. Ahora dice: "Las facturas emitidas no cambian; si alguna debe cambiar, corrígela en Facturación → Editar factura. Los borradores (No Facturado) se ajustan con Corregir monedas y montos." La confirmación de antes de propagar también lo explica. Mismo texto en el aviso al guardar una empresa con otra moneda.

## 3. Con `dineroPorServidor`, borrar un duplicado ya no regresa operaciones a "Pendientes"
`planEliminarFacturas` (servidor) liberaba toda operación que apuntara a la factura borrada, aunque siguiera en otra. En un duplicado, la operación suele apuntar al duplicado, que fue la última factura creada.

Ahora la regla es una sola para la web y el servidor: `destinoAlEliminar` (`src/shared/dominio/facturacion.ts`):
- apunta a OTRA factura que no se borra y que existe → no se toca (como siempre en el servidor). Si esa factura ya no existe, la marca no la retiene;
- si no, y sigue en otra factura **no cancelada** → se liga a esa;
- si no → se libera. Una factura cancelada no retiene la operación (antes la web la ligaba a la cancelada).
La callable `eliminarFactura` lee también las operaciones que la lista guarda con su id de AppSheet (campo `id` del documento): antes no las encontraba y se quedaban marcadas con la factura borrada. Busca las otras facturas por los dos ids, dentro de la misma transacción (`array-contains-any`, de 30 en 30). La web muestra el mismo aviso "N operación(es) siguen facturadas en otra factura" también con la bandera encendida.

## 4. Script para las facturas importadas de AppSheet (operaciones en texto)
`functions/scripts/facturasTexto.ts` (regla en `facturasTextoPlan.ts`, con pruebas). **Escribe en muchos documentos: se corre primero en simulación, se revisan los reportes, se hace el respaldo y solo con tu autorización se aplica.**

Qué hace:
- Factura con `operacionesIds` en texto → lo convierte en arreglo con los mismos ids.
- Cada operación de esas facturas sin marca de facturada (o con una marca que apunta a una factura que ya no existe) → se marca con la factura no cancelada que la contiene (`facturaClienteId` + `facturaClienteInvoice` + `facturado`, o los de proveedor). Encuentra la operación por el id del documento o por su campo `id` de AppSheet.
- No toca: las operaciones ya marcadas con una factura que existe; las que solo están en facturas canceladas (se reportan); los textos vacíos.
- Operación en varias facturas no canceladas → se marca con la primera y el reporte dice "REVISAR" (posible duplicado).
- **Protección de saldos:** al reescribir una factura corre su trigger de saldo. Si ese trigger le cambiaría algo que se ve (saldo o status de pago; con `dineroPorServidor` también que pase a `abierta` o deje de estarlo, porque aparecería o desaparecería de Pagos como deuda; completar los agregados en centavos que faltan no cuenta), la factura NO se convierte y queda en el reporte como "revisar", con el cambio que habría. Sus operaciones sí se marcan. Para convertirlas también: `--incluir-con-saldo`.
- `--limite N` procesa solo N facturas en texto, pero todas siguen contando para saber si una factura existe y dónde está cada operación.

Cómo se corre (desde `functions/`, con tus credenciales de Google):
1. Simulación: `npm run facturas:texto` (o `-- --solo clientes`, `-- --limite 20`).
2. Revisar `functions/reportes/facturas-texto-<fecha>/`: `facturas.csv` (convertir / revisar / vacia), `operaciones.csv` (marcar / yaMarcada / soloCanceladas / noExiste) y `resumen.json`.
3. Respaldo (export de Firestore) y tu autorización.
4. Aplicar: `npm run facturas:texto -- --aplicar --confirmo-respaldo`. Escribe con precondición: lo que cambió mientras corría se salta y lo recoge la siguiente corrida (en `errores.csv`).

## 6. Unir duplicados de Pagos sin tope de 12,000
Con las facturas abiertas por servidor, "Unir duplicados" leía todas las facturas con un tope de 12,000. Ahora usa la misma descarga de Facturación (`descargarFacturasComoVivas`, sin tope; el de seguridad de 100,000 se avisa y en ese caso no une nada, para no dejarlo a medias).

## 7. Facturas que quedaron mal antes de esta versión
En la V00486, V00487 y V00489 se pidió corregirlas con Corregir monedas y montos. Desde la V00495 esa herramienta ya no toca las emitidas. Para encontrarlas: **Facturación Clientes → Auditar cliente**. El motivo "Cambió después de facturarse" (y la hoja Problemas de su Excel) da la lista. Se corrigen una por una en **Editar factura** o con **Recalcular montos** en Pagos.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. Desplegar las funciones que cambiaron:
   `npm --prefix functions run build`
   `firebase deploy --only functions:eliminarFactura,functions:editarFactura,functions:editarPago,functions:facturaClienteMontoCambiado,functions:facturaProveedorMontoCambiado,functions:operacionEscrita`
   (`operacionEscrita` es el de la V00495; si ya lo desplegaste, puedes quitarlo). No uses `firebase deploy --only functions` completo mientras no esté el secreto `BANXICO_TOKEN`: la función del T.C. lo pide.
3. El script del punto 4: solo cuando lo autorices.

## Técnico
- `cambiosSaldoLegado` (`src/shared/dominio/dinero.ts`): la cuenta del trigger de saldo sin la bandera, sacada tal cual de `relacional.ts` (lo usan el trigger y el script). Las pruebas del trigger con la bandera apagada siguen pasando.
- `decidirLiberacion` (web) ahora usa `destinoAlEliminar`; `FacturaLigada` = `FacturaContenedora`.
- Pruebas nuevas: `monedaPagos.test.ts`, `facturacion.test.ts` (eliminar el duplicado, destino), `functions/test/dinero.test.ts` (callable `eliminarFactura` con duplicado), `functions/test/facturasTexto.test.ts` (regla y corrida en simulación).
- `monedaDeFactura` de Pagos (`services/facturasPagables.ts`): primero la factura, luego la empresa (prueba actualizada).
- Probado en el simulador: el botón de moneda de Empresas (empresa a USD): la factura emitida en MXN y su pago se quedan en MXN (1 pago sin tocar); el borrador, el pago de una factura ya en USD y el pago sin facturas pasan a USD.
- Revisado dos veces por un agente independiente; se corrigieron sus hallazgos: moneda leída de `monedaFacturacion`, ids de AppSheet y marcas a facturas que ya no existen al eliminar, `abierta` en la revisión del script (sin contar los agregados que faltan), `--limite`, canceladas al eliminar, texto de "Pagos sin tocar", la moneda de Pagos (ver, editar factura y editar pago) y el saldo por moneda.
- No probado en el navegador: la callable con la bandera y el script (el simulador no corre funciones; cubiertos por pruebas con un Firestore falso).
