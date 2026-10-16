# V00459 — Diesel: confirmar el cobro real (descuento de Murphy) y el saldo con lo cobrado

**Web + Cloud Functions.** Cambia el cálculo compartido del saldo de diesel (`src/shared/dominio`, copiado a `functions/src/dominio`). Sin reglas, índices ni banderas nuevas.

## Qué cambia
1. **Confirmar cobro** (botón **$** en cada carga del Historial de Referencias y en la ficha): se corrigen los **galones que realmente se cargaron** y se capturan el **Descuento** y el **Monto cobrado** tal como vienen en el reporte de Murphy (*Discount* y *Net of Discount*). Muestra en vivo: sin descuento − descuento = cobrado, diferencia de galones y de monto. Si un número se ve raro (por ejemplo el cobrado escrito en Descuento) avisa y pide Guardar otra vez. Guarda quién y cuándo confirmó.
2. **Mientras no se captura** se estima: en las cargas de **Murphy con fecha desde el 17-oct-2026**, descuento = **$0.20 × galones cargados** y cobrado = galones × precio − descuento. Las cargas anteriores al 17 y las de otros proveedores quedan **exactamente como antes** hasta que se confirmen. (Ojo: en el reporte de Murphy el descuento no siempre es 0.20 × todos los galones, por eso lo capturado manda.)
3. **Historial de Referencias**: columnas Gal. autorizados · Total autorizado · Gal. cargados · **Sin descuento** · **Descuento** · **Cobrado** · **Dif. galones** (cargados − autorizados) · **Dif. monto** (sin descuento − cobrado). El resumen de arriba suma todo y dice cuántas cargas están **por confirmar**. El Excel trae esas columnas más el origen del descuento (reporte / estimado), si el cobro está confirmado, quién y cuándo.
4. **Saldo Diesel** (pestaña Saldos, tarjeta de Operaciones Activas y su historial): cada carga descuenta **lo cobrado** (confirmado o estimado). En el historial de la tarjeta, la columna del día dice *Cobrado* y marca *est.* lo que aún es estimado.

## Pasos manuales
- **Despliega la función del saldo de diesel** el mismo día que publiques la web: `npm --prefix functions run build` y `firebase deploy --only functions:referenciaDieselEscrita` (es la única función que usa la regla; las demás no cambian).
- **Si ya encendiste `saldosCorrientes`**: después del deploy corre `npm --prefix functions run saldos:diesel` (simulación) y revisa `documentos.csv`; si algo cambia, aplícalo con `-- --aplicar --confirmo-respaldo` (punto de parada P2). Si la bandera sigue apagada no hay que hacer nada más: la puesta al día que se corre antes de encenderla ya usará la regla nueva.

## Técnico
- Nuevo `src/shared/dominio/cobroDiesel.ts` (+ pruebas): `cobroDiesel`, `descuentoEstimadoDiesel` (solo fechas AAAA-MM-DD ≥ `INICIO_DESCUENTO_MURPHY`), `cobroPorConfirmar`, `cobroEstimado`, `numeroCapturado`. `saldosCorrientes.cargadoDiesel` = `cobroDiesel(r).cobrado` (sin descuento ni captura da EXACTO el total de siempre). Copia en `functions/src/dominio`.
- Campos nuevos en `referencias_diesel`: `descuentoDiesel`, `montoCobrado` (número o null = no capturado), `cobroConfirmadoPor`, `cobroConfirmadoEn`.
- `features/diesel/services/confirmacionCobro.ts` (puro + pruebas) y `confirmacionCobroDatos.ts`: **transacción** que relee la referencia; galones, total y status solo se reescriben si cambiaron los galones (una referencia vieja sin costo no pierde su total). `components/ModalConfirmarCobroDiesel.tsx/.css` (prefijo `mcd-`).
- Murphy se reconoce por el nombre del proveedor guardado en la referencia (el ID no está en el código); solo afecta al estimado.
- Revisión independiente (agente aparte), corregido: confirmar una referencia vieja sin costo le borraba el total; fechas d/m/aaaa o números recibían el estimado; topes de lo capturado y aviso de valores cruzados; *estimado* solo donde de verdad hay estimado; el modal no usa el formulario configurable (compartía la llave "galones cargados"); fecha local en el Excel; "Monto cobrado" en Saldos.
- Banco de pruebas: tarjeta y pestaña Saldos cuadran (5000 − cobrados), carga vieja sin cambios, Murphy del 17 con −$10.66 estimado y *por confirmar*, confirmar con 10.65 / 446.98 (guarda, la fila y la ficha se actualizan, avisa la diferencia de $0.78 contra sin descuento − descuento), La Noria con galones corregidos, avisos y errores, Excel con las columnas nuevas. Sin errores de consola.

## Qué revisar con datos reales
1. Confirma una carga de Murphy con su renglón del reporte (Discount y Net of Discount) y revisa que el Saldo Diesel baje lo cobrado.
2. Revisa que las cargas de antes del 17 sigan con los mismos montos y que el saldo de hoy no cambie.
3. Exporta el Excel y revisa las columnas nuevas.
