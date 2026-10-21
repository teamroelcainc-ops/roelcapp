# V00469 — Reglas de Estatus por aduana y revisión del cobro de puentes

**Web y funciones.** Va encima de la V00468. Sin reglas, índices ni banderas nuevas. La parte de funciones cambia cómo el servidor cobra el puente y elige el flujo (ver *Pasos manuales*).

## Historial de versiones
Esta versión trae en `src/config/historialCambios.ts` las entradas de la **V00465 a la V00469**. Si la app en pantalla dice una versión anterior (p. ej. *V00466*), es que los archivos de versión de las entregas anteriores no llegaron al repo. Al aplicar este zip completo quedan todas.

Para revisar que quedó:
```
git log --oneline -3
grep APP_VERSION src/config/version.ts      # → V00469
grep -c "version: 'V0046" src/config/historialCambios.ts
```

## Qué cambia en pantalla
1. **Configuración → Reglas de Estatus (Editor de Flujos):**
   - hay un selector nuevo, **Aduana**, al lado de **Carga**;
   - un flujo puede ser de una sola aduana, p. ej. *Transfer · Exportación · Cargado · 800 Colombia*;
   - las operaciones de esa aduana usan ese flujo, y las de otra aduana siguen con el general (*Aduana: Todas*, como hasta hoy);
   - la lista de flujos tiene la columna **Aduana**, y el buscador también busca por aduana.
2. **Cobro del puente.** Se revisó la lógica de los puentes y se corrigió lo siguiente:
   - **Cascada:** cuando un clic pasa por *Verde USA* y sigue solo a otro estatus (automático, p. ej. *En tránsito* o *Completado*), el puente ahora se cobra en el Verde, con la hora capturada. Antes solo se revisaba el último estatus y el cobro esperaba a *Completado* (con la fecha de servicio y el evento *Completado*).
   - **Puente en 0:** una operación que quedó con el puente en $0 (una caseta del catálogo sin importe) se quedaba sin cobrar para siempre. Ahora $0 no cuenta como cobrado: se cobra en el siguiente estatus que cobra, o con *Asignar monto del puente*. Una caseta sin importe ya no se cobra en $0.
   - **Formulario de operación:** al guardar ya no regresa un puente viejo de su copia. Por ejemplo, ya no deshace el puente cambiado en Referencias de Puentes mientras el formulario estaba abierto. Además cobra con la misma regla que Operaciones Activas y el servidor: con aduana Colombia, solo casetas de Colombia, y "hoy" en hora local (antes en UTC, que en la noche ya era el día siguiente). Y como el servidor, solo cobra cuando el estatus cambia (o se corrige el convenio, el tipo de operación o el proveedor). Antes, editar cualquier campo de una operación que ya estaba en Verde sin puente la cobraba con la fecha de ese día.
   - **Operaciones Activas:** el cobro usa esa misma regla. La fecha de un Completado es la fecha de servicio convertida (las de AppSheet en d/m/aaaa ya no quedan mal).
   - **Referencias de Puentes → Enviar al Acumulado:** cada operación va a la referencia de **su** puente. Antes, una operación sin puente se agrupaba como Puente III; si su puente era AVI se perdía sin aviso, y podía quedar una referencia vacía. Ahora no se crean referencias vacías, y si una operación terminó en otro puente distinto al que mostraba la ventana, lo avisa. Al *Agregar operaciones* a una referencia, avisa cuántas no son de ese puente.
   - **Fechas de AppSheet en Referencias de Puentes:** una fecha de servicio en d/m/aaaa (p. ej. *15/10/2026*) armaba un id de referencia con "/" (Firestore lo toma como otra ruta) y quedaba fuera del filtro de fechas y del reporte del puente. Ahora se convierte a AAAA-MM-DD al agrupar, en la fila del Acumulado, en el filtro de fechas, al buscar los cruces del reporte y al agregar a una referencia.
   - **Asignar monto del puente (en lote):** usa la misma caseta que el cobro (con aduana Colombia ya no toma una caseta de Nuevo Laredo de la tarifa) y la fecha de servicio convertida.
   - **Tarjetas de casetas** (Operaciones Activas): un puente con un nombre que no es AVI, Puente III ni Colombia cuenta en Puente III, igual que en Referencias de Puentes. Antes no entraba en ninguna tarjeta y el saldo no cuadraba con la pestaña Saldo.
   - **Saldos de Puentes (módulo viejo) → Aplicar a operaciones:** un $0 tampoco cuenta como cobrado ahí, y una caseta sin importe no se aplica en $0.
   - **Servicios Completados:** la ficha de una operación ya muestra el puente que se acaba de cobrar en Operaciones Activas, sin recargar.

## Pendientes que necesitan una decisión
1. **Operaciones en el Acumulado sin monto de puente.** Al enviar al Acumulado una operación que aún no tiene puente, la referencia sí lleva su caseta calculada, pero la operación se queda en $0: su utilidad se ve más alta. ¿Se le asigna el monto en ese momento (como *Asignar monto del puente*)?
2. **Módulo viejo Saldos de Puentes.** Su botón *Aplicar a operaciones* lee todas las operaciones y tiene su propio saldo. Ya está todo en Referencias de Puentes. ¿Se retira?
3. **Totales con monedas mezcladas.** El subtotal de una referencia y el total de la ventana *Enviar al Acumulado* suman dólares (AVI) y pesos (Puente III / Colombia) en un solo número. Además, *Hoy* solo cuenta las filas del Acumulado cuya fecha de servicio es hoy. ¿Se separan por moneda y se cambia lo que cuenta *Hoy*?
4. **Orden de Referencias de Puentes.** La lista se pide al servidor ordenada por `fechaServicio`, que tiene formatos mezclados (texto ISO, d/m/aaaa de AppSheet y Timestamp): las de AppSheet pueden quedar fuera de las 2,500 más recientes. Pasarla a `fechaServicioISO` necesita un índice nuevo y hay que revisar cuántas operaciones activas vienen así.
5. **Acumulado:** el listener trae hasta 1,000 referencias, y agregar a una referencia no va en transacción (dos personas al mismo tiempo podrían pisarse). Hoy no pasa de ese tope; queda anotado.

## Pasos manuales
1. **Desplegar la función** que cobra el puente y elige el flujo (*no* `firebase deploy` sin `--only`):
   ```
   firebase deploy --only functions:operacionEscrita
   ```
   Sin desplegar, la web funciona igual. Con `cobroPuenteEnServidor` encendida, el servidor sigue con la regla anterior (flujo general, sin cascada, el 0 bloquea) hasta que se despliegue.
2. **Roelca Móvil** (repo aparte) usa los flujos generales: un flujo por aduana no le aplica hasta que se actualice esa app.

## Técnico
- `src/shared/dominio/flujos.ts` (se copia a `functions/src/dominio`):
  - `aduanaParaFlujo`, `aduanaDeFlujo`, `mismaAduana`;
  - `buscarFlujo` prueba primero los flujos de la aduana de la operación (`aduanaNombre`) y luego los generales (sin aduana); un flujo de otra aduana nunca se usa;
  - `esStatusAutomatico(flujo, nombre)`.
- `ConfiguradorStatus`: campo `aduana`; el id es `Servicio_Tráfico_Carga[_Aduana]`; columna Aduana en la lista; `.cs-par-selectores`.
- `FormularioOperacion`:
  - `aduanaForm` (la del servidor con el mismo convenio; si no, el segmento del nombre del convenio que sea una aduana del catálogo, o la de su tarifa);
  - `buildConfigId` y `flujosIndex` con aduana;
  - `camposSaldoPuente` usa `cobroAlCambiarStatus` con `cargarCtxCobroPuente()` y `hoyLocalISO()`; solo si cambió el estatus (o `convenio`, `tipoOperacionId`, `proveedorUnidad`), y relee el documento antes de escribir un cobro;
  - el cobro se agrega después de `quitarCamposAjenos`.
- `camposAjenos.ts`: `saldoPuente…`, `saldoPuentePiso…`, `saldoPuenteManual`, `puenteCobradoEn` y `puenteCobradoPor` son campos ajenos al formulario. Servicios Completados también los refresca al abrir la ficha.
- `src/shared/dominio/cobroPuente.ts`:
  - `puenteYaCobrado` (> 0 o `saldoPuenteManual`);
  - `cobroAlCambiarStatus` no cobra en 0;
  - `cobroPuenteDeOperacion` con `casetaPrevista` y `fechaServicioISO`;
  - `cobroEnCascada`.
- `functions/src/puentesYDiesel.ts`:
  - `puenteYaCobrado`;
  - si el estatus final es automático, lee los horarios y prueba EN ORDEN los pasos del mismo clic y el final; cobra el primero que da un cobro;
  - `pasosPreviosDeCascada`: el último horario de la operación tiene que ser ese paso final (mismo `registradoEn`, `ordenCascada` menor) y de hace menos de 30 minutos (`MINUTOS_CASCADA_VIGENTE`); una cascada vieja o un horario posterior sin cascada no se reutilizan;
  - los horarios se leen una sola vez.
- `OperacionesDashboard`:
  - `camposSaldoPuenteAlCompletar` usa la regla compartida (se quitaron `casetaDeGastosSP`, `camposSaldoPuenteBaseSP` y `aplicaPeajeSP`, y el `getDoc` por clic);
  - `registrarStatusRapido` cobra en el primer paso de la cascada que dispara.
- `ReferenciasPuentesDashboard`: el grupo previsto sin puente sale por el tráfico; al guardar se agrupa por el grupo de la fila. `upsertReferenciaAuto` no escribe sin filas nuevas. Fechas con `fechaServicioDeOperacion` (nuevo en `shared/dominio/fechas.ts`; también en `filaDeOperacion` y `cobroPuenteDeOperacion`).
- `OperacionesDashboard`: el aviso de cambio de estatus (`notificarOperacionGuardada`) lleva el cobro nuevo.
- `SaldosPuentesDashboard.aplicarAOperaciones`: `puenteYaCobrado` y tarifa > 0.
- `TarjetaCasetas.grupoDePuente`: lo demás → `p3`.
- Pruebas nuevas: web (`cobroPuente.test.ts`, `camposAjenos.test.ts`, `historialCalculadoPuentes.test.ts`: fecha d/m/aaaa) y funciones (`puentesYDiesel.test.ts`: 0 no bloquea, manual sí; cascada a *En tránsito* y a *Completado*; sin leer horarios si el estatus no es automático; `pasosPreviosDeCascada` con cascadas viejas).
- Banco de pruebas:
  - **Editor de Flujos:** la lista muestra *Aduana: Todas / 800 Colombia*; el id dice *Transfer · Todos · Todos · 800 Colombia*;
  - **formulario:** la operación de Colombia muestra las pestañas de su flujo (General / Unidad / Por Cobrar) y la de Nuevo Laredo, las 5 del general;
  - **cascada:** una operación con puente en 0, *Verde USA* → *En tránsito* (automático), queda en *En tránsito* con Caseta AVI $23.75, evento *Verde USA* y fecha de hoy en hora local;
  - **formulario con copia vieja:** la lista traía Caseta AVI $23.75 y Referencias de Puentes lo cambió a Caseta Puente III $150 (manual); al guardar el formulario se queda en $150;
  - sin errores de consola.
