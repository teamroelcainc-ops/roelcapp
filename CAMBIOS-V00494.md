# V00494 — Facturas que volvían a "Pendientes" e importes facturados que se recalculaban solos

**Web + una Cloud Function** (`operacionEscrita`). Va encima de la V00493. Sin reglas, índices ni banderas.

## Qué reportó Roelca
1. "Metemos las facturas al app y al día siguiente vuelven a salir pendientes… le estamos mandando al cliente facturas duplicadas."
2. "Bloquear que NO se modifiquen los importes una vez facturados automáticamente… ayer los cambié y volvía a calcularlos como le daba la gana, 3 o 4 veces."

## 1. Operaciones facturadas que vuelven a "Pendientes"
| Causa | Corrección |
|---|---|
| Facturación (Clientes y Proveedores) descargaba **solo las primeras 12,000 facturas**, ordenadas por ID interno, no por fecha. Con más facturas, las que quedaban después del corte no se cargaban. Cada factura nueva cae en cualquier lugar de ese orden y saca a otra, así que **cada día faltaba una distinta**. Sus operaciones sin marca de facturada (las que llegaron de AppSheet: su factura guarda las operaciones como texto) volvían a "Pendientes". La revisión anti-duplicados del servidor tampoco las encuentra. | `services/descargarFacturas.ts`: se descargan **todas**, en páginas de 1,000. Hay un tope de seguridad de 100,000 y, si se alcanza, aparece un aviso. También el cruce con las facturas de clientes en Proveedores. |
| **Eliminar una factura** liberaba todas sus operaciones, aunque estuvieran en otra factura. Pasaba, por ejemplo, al borrar un duplicado: quedaban sin marca y volvían a "Pendientes". | `planLiberarAlEliminar` (`facturarSeguro.ts`), con la misma regla que el servidor: solo se libera la operación que apunta a la factura borrada (o a ninguna) y que no está en otra factura. Si está en otra, se liga a esa y aparece un aviso de cuántas siguen facturadas. Una operación que ya no existe no frena el borrado. |

Lo ya guardado: con la V00494, las operaciones que habían vuelto a "Pendientes" por la primera causa vuelven a verse en "Facturadas" (su factura ya se carga). **Las facturas duplicadas que ya se crearon no se borran solas**: hay que revisarlas, borrar el duplicado (ahora sin liberar las operaciones de la factura buena) y avisar al cliente.

**Cómo confirmar la causa:** en Facturación Clientes → Historial, sin filtros, la tarjeta "Facturas Listadas" ahora puede pasar de 12,000. Si es así, esa era la causa.

## 2. Importes facturados que cambiaban solos
| Qué los cambiaba | Corrección |
|---|---|
| Al **abrir** una operación ya facturada, el formulario le ponía la moneda de la empresa en "Facturado en" (V00490), recalculaba Subtotal, Dólares, Pesos y Conversión y, con T.C. en 0, ponía el T.C. del día. Al **Guardar** (aunque solo fuera para subir un documento), el servidor rehacía el renglón y el total de la factura. | `services/montosCongelados.ts`: una operación facturada (de ese lado) conserva sus importes guardados mientras nadie cambie a mano el monto del convenio, los cargos, el T.C., "Facturado en" o la moneda del convenio. "Facturado en" ya no toma sola la moneda de la empresa y queda bloqueado. El T.C. no cambia solo, ni con 0 ("Usar el oficial" sigue a mano). Aparece un aviso amarillo en Facturación al Cliente y en Pago al Proveedor. **Si alguien cambia un importe a mano, al guardar sí cambia la factura** (como hasta hoy). |
| El servidor recalculaba el renglón de la factura con cualquier cambio del nombre del convenio, la Ref Cliente, el nombre de la moneda (`monedaCobroNombre` / `monedaUnidadNombre`) o `tipoCambioDia`. Esos cambios los hace el sistema, por ejemplo al renombrar un convenio. Bastaba también un mismo monto escrito distinto (`'2328.30'` contra `2328.3`). | `src/shared/dominio/cascadaFacturas.ts` en `operacionEscrita` (`relacional-v1.8`): solo un cambio real de dinero recalcula renglón y total. El nombre del convenio y la Ref Cliente solo se copian como texto. Los nombres de moneda y `tipoCambioDia` ya no disparan nada. |
| **Corregir monedas y montos** (Facturación) recalculaba todas las facturas y borraba los totales capturados a mano en "Editar factura". | Esas facturas se saltan con el motivo "Total capturado a mano en Editar factura (no se recalcula)". |

No cambian, porque son botones que se usan a propósito: "⟳ Actualizar moneda" y "↻ Actualizar convenio" del formulario, "Recalcular montos" de Pagos, el botón de moneda de Empresas y "Corregir monedas" de Operaciones.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. Desplegar la función (cambió `functions/src/relacional.ts`; `functions/src/dominio` lo copia el build):
   `npm --prefix functions run build`
   `firebase deploy --only functions:operacionEscrita`
   (nunca `firebase deploy` sin `--only`). Sin este paso, la web ya no recalcula sola al abrir, pero el servidor seguiría rehaciendo renglones con los cambios de texto.
3. Revisar los duplicados ya enviados: buscar el folio en el Historial, borrar el duplicado y comprobar que sus operaciones siguen en "Facturadas".

## Técnico
- `src/features/facturacion/services/descargarFacturas.ts` (nuevo); se quitaron `LIMITE_FACTURAS_TODAS` y `PAG_FACTURAS` de `selectores.ts`.
- `facturarSeguro.ts`: `decidirLiberacion` (puro) y `planLiberarAlEliminar` (lee las operaciones por id y las otras facturas con `array-contains-any`, más la lista cargada), con pruebas. Lo usan los dos tableros al eliminar sin `dineroPorServidor` (con la bandera ya lo hacía el servidor).
- `src/features/operaciones/services/montosCongelados.ts` (+ pruebas): `conservarMontosGuardados` y `montosARestaurar`. Este último regresa los importes guardados si el cálculo que corre con el formulario aún vacío (antes de cargar la operación) los cambió.
- `tipoCambioFila.ts`: `tcParaOperacionGuardada` devuelve null si está facturada (antes con T.C. 0 tomaba el oficial).
- `src/shared/dominio/cascadaFacturas.ts` (+ pruebas): `cambioParaFacturas` → `'dinero' | 'texto' | null` por lado. `propagarMontoOperacionAFacturas(…, soloTexto)`.
- `corregirFacturas.ts`: `MOTIVO_TOTAL_MANUAL`.
- No probado en el navegador: la Cloud Function (el simulador no corre funciones; está cubierta por pruebas de la regla pura). Datos reales: no se pudo contar cuántas facturas hay en producción.
