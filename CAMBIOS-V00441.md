# V00441 — Fase 5: el dinero en el servidor (facturas, pagos, peaje y diésel)

**Puntos de parada**: P1 (reglas nuevas), P2 (carga inicial del saldo de diésel) y **P3 (reconciliación de facturas)**.
Nada de lo nuevo cambia lo que hace la app hasta encender sus banderas. Con todas apagadas la web y las funciones calculan
lo mismo que la V00440 (hay pruebas de paridad); lo único que corre siempre es el trigger del saldo de diésel, que escribe
en una colección nueva que nadie lee todavía.

## Qué es
Hoy el dinero se calcula y se escribe desde el navegador: Facturación, Pagos y el servidor tenían tres copias de la
fórmula del total de la factura, y cada pantalla leía la factura, sumaba y escribía. Con dos personas a la vez o con una
conexión que se corta, los saldos quedaban mal. Ahora:

| Pieza | Qué hace | Bandera |
|---|---|---|
| `src/shared/dominio/dinero.ts` | UNA regla de conversión de la operación y del total de la factura (la de Facturación), en centavos; el total editado a mano se marca con `totalManualCentavos` y nada lo pisa. Conserva la regla "legado" de Pagos y del trigger hasta P3. | — |
| `src/shared/dominio/facturacion.ts` | Los "planes" de facturar, editar, quitar/mover/agregar operación, eliminar, recalcular y registrar/editar/eliminar pago (qué se escribe), puros y probados. ID determinista `{empresa}_{folio}` para no duplicar facturas. | — |
| `functions/src/dinero.ts` | 10 callables (`facturarOperaciones`, `editarFactura`, `quitarOperacionFactura`, `moverOperacionFactura`, `agregarOperacionFactura`, `eliminarFactura`, `recalcularFactura`, `registrarPago`, `editarPago`, `eliminarPago`): personal + zod + transacción (relee todo antes de escribir). `registrarPago` es idempotente por `pagoId`. | `dineroPorServidor` |
| `functions/src/proyecciones.ts` | Tablas hijas `facturas_x/{id}/renglones/{opId}` y `facturas_x/{id}/aplicaciones/{pagoId}` (para las consultas de la Fase 7). Se mantienen solas desde los arreglos de siempre; un evento que llega tarde escribe lo vigente. | `dineroPorServidor` |
| `functions/src/relacional.ts` | El trigger de saldo de la factura, con la bandera, usa la regla única y mantiene agregados en centavos (`totalCentavos`, `montoPagadoCentavos`, `saldoCentavos`, `saldoAFavorCentavos`, `abierta`, `esquemaDinero: 2`). Sin la bandera, igual que antes. | `dineroPorServidor` |
| `functions/scripts/reconciliarFacturas.ts` | Recalcula todas las facturas con la regla única y compara contra lo guardado y contra el libro de pagos → `diferencias.csv`. | **P3** |
| `firestore.rules` | Con la bandera, el navegador ya no crea/borra facturas ni pagos de clientes/proveedores ni cambia sus campos de dinero; `renglones/`, `aplicaciones/` y `saldos_corrientes/` solo los escribe el servidor (siempre). | **P1** |
| `src/shared/dominio/cobroPuente.ts` + `flujos.ts` | El cobro del peaje y la regla "🌉 aquí se descuenta el puente" como lógica pura (antes en OperacionesDashboard, FormularioOperacion y statusRules). | — |
| `functions/src/puentesYDiesel.ts` | **Peaje**: dentro de `operacionEscrita`, al cambiar de estatus (web, Mis Operaciones **y la app móvil**, que hoy no cobra). **Diésel**: trigger `referenciaDieselEscrita` → `saldos_corrientes/diesel_<proveedor>` con lo cargado por día. | `cobroPuenteEnServidor` / `saldosCorrientes` |
| `functions/scripts/reconstruirSaldosDiesel.ts` | Carga inicial del saldo de diésel + `paridad.csv` contra la tarjeta de siempre. | **P2** |

### En la web (todo detrás de la bandera; apagada = camino de siempre)
- **Facturación Clientes/Proveedores**: facturar, editar, quitar/mover/agregar operación, quitar referencia y eliminar
  llaman a las callables y aplican la respuesta a la lista en memoria. El modal de edición precarga el total **en la
  moneda de la factura** (antes la conversión a pesos).
- **Pagos**: registrar (mismo `pagoId` en los reintentos del mismo pago), editar pago, editar factura, recalcular y
  eliminar pago por callables; la tabla usa la regla única. Los pagos de MTTO siguen desde la web (no tocan facturas).
- **Auditoría de cadena (cliente)**: el ✎ de la factura guarda por la callable; en facturas que no son en pesos ya no
  deja guardar la conversión como total (solo invoice y fecha).
- **Papelera** e **Importación**: con la bandera avisan que facturas y pagos ya no se restauran/importan desde ahí.
- **Tarjeta Saldo Diesel** (Operaciones): con `saldosCorrientes` lee ~1 documento por proveedor en vez de 3,000 referencias.
- **Peaje**: con `cobroPuenteEnServidor`, Operaciones y el formulario dejan de calcularlo (lo hace el trigger).

## Cambios de comportamiento AL ENCENDER las banderas (revisar con el negocio)
- `dineroPorServidor`:
  - Una operación que ya está en OTRA factura no se puede facturar (antes quedaba en dos).
  - Las facturas nuevas tienen ID `{empresaId}_{folio}`; un folio con otras mayúsculas cae en la misma factura.
  - El total editado a mano queda marcado (`totalManualCentavos`) solo si no coincide con sus operaciones; un cambio
    de monto en la operación ya no lo pisa. "Recalcular" en Pagos quita la marca.
  - Sobrepago: queda como `saldoAFavorCentavos` (antes se perdía con `Math.max(0, …)`).
  - Quitar una referencia ya no reescribe el historial `facturas[]` de los pagos (el saldo vive en la factura).
  - "Recalcular" de Pagos usa la conversión de la operación (regla única), no `desgloseDeOp` (que suponía USD).
  - 1 lectura extra (el documento de banderas) en cada escritura del navegador que toque dinero de una factura o pago.
- `cobroPuenteEnServidor`:
  - El peaje se cobra también desde la app móvil.
  - La fecha del cruce es la del horario capturado (hora de Nuevo Laredo, no UTC). En Completado se usa
    `fechaServicioISO`.
  - Ya en un estatus que cobra, corregir los datos que deciden el puente (convenio, tipo, proveedor, tráfico, carga)
    también cobra. Otras ediciones NO cobran: el formulario cobraba en cualquier guardado, pero así una migración nunca
    cobra operaciones viejas. Para esas sigue "Aplicar a operaciones" en Saldos de Puentes.
- `saldosCorrientes`: misma cuenta; diferencias solo en referencias viejas sin fecha AAAA-MM-DD o con otro ID de
  proveedor y el mismo nombre (salen en `paridad.csv`).

## Pasos en producción (en orden)
1. Publicar la web (con banderas apagadas no cambia nada).
2. `firebase deploy --only functions`. Sin banderas: los triggers de dinero calculan igual que antes; empieza a llenarse
   `saldos_corrientes` (solo días con capturas nuevas).
3. **P1 — reglas**: `npm run test:rules` (emulador) en verde → `firebase deploy --only firestore:rules`. Las reglas
   nuevas no cambian nada con la bandera apagada (salvo `saldos_corrientes/`, `renglones/` y `aplicaciones/`, que nadie
   escribe desde la web).
4. **P2 — saldo de diésel** (desde `functions/`): respaldo → `npm run saldos:diesel` (simulación) → revisar
   `reportes/saldos-diesel-*/paridad.csv` → `npm run saldos:diesel -- --aplicar --confirmo-respaldo` en un horario sin
   capturas de diésel → encender `saldosCorrientes`.
5. **P3 — dinero**:
   1. Respaldo (ver PLAN-REFACTOR.md).
   2. `npm run reconciliar` (simulación) → el negocio revisa `reportes/reconciliacion-*/diferencias.csv` factura por
      factura (total manual propuesto, total legado vs. regla única, pagado vs. libro de pagos, saldo, status,
      saldo a favor).
   3. Encender `dineroPorServidor` y esperar 1 minuto.
   4. `npm run reconciliar -- --aplicar --confirmo-respaldo` (se niega si la bandera está apagada: el trigger de saldo
      lo desharía). `--pagado-desde-pagos` solo si el negocio decide que manda el libro de pagos.
   5. Probar en el emulador antes, si es posible: `npm --prefix functions run test:emulador` (concurrencia de dos pagos).
6. `cobroPuenteEnServidor`: encender cuando las funciones estén desplegadas; revisar en Saldos de Puentes los cruces
   del día siguiente.

**Volver atrás**: apagar la bandera. Los datos escritos con ella siguen siendo válidos para el camino viejo; la
edición de un total en el camino viejo borra la marca de total manual (para que mande lo capturado).

## Lecturas por acción (estimadas; medir con `npm run dev:medir`)
| Acción | V00436 (línea base) | V00441 con banderas |
|---|---|---|
| Marcar Verde/Completado (peaje) | T + 3G + 7 en ~8 viajes desde el navegador | 0 en el navegador; servidor: 2 documentos + horarios de la operación (~10) + catálogos en memoria |
| Tarjeta Saldo Diesel abierta | saldos + hasta 3,000 referencias | saldos + ~1 documento por proveedor |
| Facturar N operaciones | N + facturas en memoria (Facturación ya cargada) | N + 1–2 en el servidor; 0 en el navegador |
| Aplicar un pago a K facturas | K (transacción en el navegador) | 1 + K en el servidor |
| Guardar una factura (trigger) | 1 evento | 1 evento + 1 lectura (proyección en transacción) |

## Verificación
- `tsc -b` ✔ · trinquete ESLint ✔ (`any` 2,474 → 2,470) · vitest web 146 ✔ (incluye 3,000 casos de paridad con las
  fórmulas viejas de Facturación, Pagos y servidor; paridad de 2,000 referencias de diésel) · `npm run build` ✔ ·
  functions `tsc` ✔ + scripts ✔ · vitest functions 39 ✔ (callables con un Firestore transaccional simulado, triggers con
  bandera apagada/encendida, reconciliación en simulación, peaje y diésel) · copia de dominio al día ✔.
- Revisión independiente: 21 hallazgos. Corregidos los que cambiaban algo con la bandera apagada (el trigger de saldo
  leía primero `subtotalMonedaFactura`; la cascada operación→factura usaba la conversión nueva), las facturas
  importadas con IDs en texto, la Auditoría que guardaba la conversión como total, el folio con otras mayúsculas, el
  pago duplicado al reintentar, facturas repetidas en un pago, el total marcado como manual sin cambiar, la
  reconciliación con la bandera apagada, el peaje al corregir el convenio, proyecciones atrasadas por eventos tardíos,
  la regla de total en la tabla de Pagos, MTTO por callable, `--limite` destructivo en el script de diésel y el
  minuto de espera de la bandera en las callables. Anotados (no corregidos): grupos de facturas con el mismo folio
  (los documentos secundarios sin total toman el de sus renglones, como ya hacía el trigger) y que `moneda*`,
  `clienteId`/`proveedorId` siguen editables desde la web (el trigger recalcula los agregados después).
- **No probado aquí**: las reglas (`npm run test:rules`) y la concurrencia en el emulador (`test:emulador`) — el
  emulador de Firestore no se puede descargar en este entorno. Tampoco en el navegador: tsc, eslint, build y las
  pruebas verifican que compila y que la lógica da lo mismo, no que las pantallas funcionen contra Firebase.
- **No hecho** (decisión pendiente): saldo corriente de **puentes** (5.6). Hay dos definiciones distintas del consumo:
  Saldos de Puentes resta las operaciones con `saldoPuente` y la tarjeta Casetas resta las referencias calculadas
  (`referencias_puentes_auto`). Hay que elegir una antes de mantenerla en un documento; anotado en code-notes.md.
