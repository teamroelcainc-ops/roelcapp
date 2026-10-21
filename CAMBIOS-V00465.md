# V00465 — Puentes: el puente del convenio al poner la unidad, el TAG de cada puente y checks alineados en el Acumulado

**Web y funciones.** Va encima de la V00464. Sin reglas, índices ni banderas nuevas. La parte de funciones solo cambia cómo se encuentra la tarifa del convenio al cobrar el puente (ver *Pasos manuales*).

## Qué cambia en pantalla
1. **Referencias de Puentes → Acumulado:** el check de cada referencia y su botón de borrar quedan en la misma columna que el check de *Seleccionar todas* (antes la celda se descuadraba).
2. **TAG según el puente.** Debajo de *Unidad Asignada* (pestaña *Unidad y Operador* de la ficha, en Operaciones Activas, Servicios Completados, Servicios Cancelados, Facturación de Clientes y de Proveedores) sale el TAG de la unidad para el puente de esa operación:
   - Caseta AVI → **TAG AVI**;
   - Caseta Puente III (o cualquier otro puente que no sea AVI ni Colombia) → **TAG Puente 3**;
   - Colombia → **TAG Puente Colombia**.

   El puente es el que ya se cobró; si aún no, el elegido en el formulario; si tampoco, el del tráfico (importación → AVI, exportación → Puente III). Si la unidad no tiene ese TAG dice *sin registrar* (en amarillo). En Fletes, Movimientos o Logística con proveedor externo no sale nada.
   El formulario también lo muestra debajo del *Puente*, y cambia si se elige otro puente.
3. **Formulario de operación → Unidad y Operador:** la tarjeta **Caseta / Puente** aparece en cuanto se pone la **unidad** (antes, hasta marcar Verde). Ya trae elegido el puente que corresponde y su monto:
   1. la **caseta de los gastos incluidos de la tarifa del convenio**, con el monto del vínculo (p. ej. Caseta Puente III $150);
   2. si la tarifa no trae caseta y la aduana es **Colombia** → Caseta Mx Colombia (o Trompo Colombia si es trompo);
   3. si no, **por tráfico**: importación → Caseta AVI, exportación → Caseta Puente III, con el importe del catálogo.

   Debajo dice de dónde salió (*Del convenio…*, *Aduana Colombia* o *Por el tráfico…*). Si cambia el convenio o el tráfico, el puente se vuelve a elegir solo. Si el usuario cambia el puente o el monto a mano, ya no se toca. En una operación guardada que ya tiene puente, ese puente se respeta.

   Si la operación **ya se cobró**, manda el puente cobrado: el TAG es el de ese puente (igual que en la ficha) y debajo dice *Cobrado: Caseta AVI · $23.75*. Si no tenía puente elegido, se elige el cobrado.

## Reglas
- La regla del punto 3 es **la misma con la que se cobra el puente** al pasar a Verde (`cobroAlCambiarStatus`, la que usa el servidor). Ahora las dos usan la misma función (`casetaPrevista`), así que lo que se ve en el formulario es lo que se va a cobrar.
- **Tarifa del convenio:** Convenios de Clientes guarda la tarifa del detalle en `tipoConvenioId`. El formulario ya la leía de ahí, pero el cobro del servidor, la asignación en lote de Referencias de Puentes y la aduana (Colombia) solo la buscaban en `tarifaBaseId`: con un detalle que no lo trae no encontraban la caseta de la tarifa ni la aduana y caían al tráfico. Ahora todos leen primero `tarifaBaseId` (nada cambia donde ya estaba) y luego `tipoConvenioId`.
- El TAG sale de Unidades Propias (los campos TAG AVI, TAG Puente 3 y TAG Puente Colombia de la V00457), del catálogo que la app ya tiene abierto: sin lecturas nuevas.

## Pasos manuales
1. **Desplegar las funciones** (solo la que cobra el puente; *no* `firebase deploy` sin `--only`):
   ```
   firebase deploy --only functions:operacionEscrita
   ```
   Sin desplegar, la web funciona igual. Pero si `cobroPuenteEnServidor` está encendida, el servidor sigue sin leer `tipoConvenioId` hasta que se despliegue.
2. Revisa que las unidades tengan sus TAG en Unidades Propias: los que falten salen como *sin registrar*.

## Técnico
- `src/shared/dominio/cobroPuente.ts` (se copia a `functions/src/dominio`):
  - `tarifaDeDetalleConvenio(det)`: el primer campo con valor de `tarifaBaseId`, `tarifa_base_id`, `tarifaReferenciaId`, `tarifa_referencia_id`, `tipoConvenioId`, `tipo_convenio_id`, `tipoConvenio`, `tipo_convenio`, `tarifaId`, `tarifa_id` y `TIPO DE CONVENIO`;
  - `casetaPrevista(ctx, op, statusNombre?)` → `{ gastoId, nombre, monto, moneda, origen }` o `null`;
  - `cobroAlCambiarStatus` arma su cobro con `casetaPrevista`, con el mismo resultado que antes (pruebas de siempre en verde).
- `functions/src/puentesYDiesel.ts` (contexto del cobro), `src/utils/puenteColombia.ts` (`aduanaDeConvenio`) y `OperacionesDashboard` (`casetaDeGastosSP`) usan `tarifaDeDetalleConvenio`. Se quitaron `PUENTE_IMPORTACION_ID` y `PUENTE_EXPORTACION_ID` de `constantes.ts`: ya nadie los usaba.
- `src/features/puentes/services/tagPuente.ts` (+ pruebas): `grupoTagDeNombres`, `grupoTagDeOperacion`, `grupoTagDeTrafico`, `tagDeUnidad`.
- `components/TagPuenteUnidad.tsx/.css` (prefijo `tpu-`): toma la unidad de `useCatalogo('unidades')`.
- `FormularioOperacion.tsx`:
  - `ctxPuente` se arma con los catálogos que el formulario ya tiene y `puentePrevisto` con `casetaPrevista`;
  - la asignación automática respeta `puenteElegidoAMano` y `puenteAutoId` (se reinician en `aplicarDatosIniciales`) y no corre si `initialData` ya trae `puenteId`; con `saldoPuente`, el objetivo es el puente cobrado;
  - `puenteVisible` también es verdadero con `formData.unidad`.
- `ReferenciasPuentesDashboard`: la celda del check ya no es `display: flex`; un `div.rpd-sel-acciones` adentro.
- Banco de pruebas:
  - **Acumulado:** el check del encabezado y los de las filas quedan en x = 321; check, botón y referencia, a la misma altura;
  - **Formulario:** operación Transfer de importación con un convenio cuyo detalle solo trae `tipoConvenioId` y cuya tarifa incluye Caseta Puente III $150:
    - sin unidad no hay tarjeta;
    - al poner la unidad: *Caseta Puente III · $150 · TAG Puente 3: P3-77881 · Del convenio*;
    - al cambiar a Caseta AVI a mano: *$23.75 · TAG AVI: 00202745*;
    - una operación cobrada en Caseta AVI cuya tarifa dice Puente III: se queda en *Caseta AVI · TAG AVI · Cobrado: Caseta AVI · $23.75*;
  - **Fichas:** cobradas en Puente III, AVI y Colombia muestran *TAG Puente 3: P3-77881*, *TAG AVI: 00202745* y *TAG Puente Colombia: sin registrar*;
  - sin errores de consola.
