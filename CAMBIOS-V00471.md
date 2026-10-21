# V00471 — Puentes: ventana al cruzar, aduana en el formulario y el puente de Reglas de Estatus

**Solo web.** Va encima de la V00470. Sin funciones, reglas, índices ni banderas.

## Qué cambia en pantalla
1. **Ventana al cruzar el puente.** Al marcar en Operaciones Activas el **Verde** o el estatus que tiene *🌉 Aquí se descuenta el puente* en Reglas de Estatus, sale una ventana. Pasa con el botón de siguiente paso, con *Registrar Movimiento* y al guardar el formulario cuando su estatus llega ahí:
   > **🌉 Cruce de puente**
   > Esta unidad (T-15 · TR-211026-021) cruzó el puente Caseta Puente III.
   > Se envió el cobro a Operaciones sin asignar por el monto de $144.00 MXN.

   - **Colombia:** *cruzó el puente Caseta Mx Colombia y Puente Mx Colombia … por el monto de $129.60 MXN + $90.00 MXN*.
   - En un estatus sin puente (p. ej. *8.1 Rojo Mx*) no sale, y tampoco si la operación ya tenía su puente cobrado.
   - Se cierra con **Entendido** (o Esc).
   - El puente y el monto son los del cobro, con la misma regla de siempre: la caseta de la tarifa del convenio y, si no trae, la de Reglas de Estatus. Con `cobroPuenteEnServidor` encendida, el cobro lo guarda el servidor con esa misma regla, y la ventana dice lo que va a cobrar.
2. **Formulario → Cliente y Convenio:** en **Transfer**, la **Aduana** aparece debajo de *Cargada / Vacía*. Es de solo lectura, como *Importación / Exportación*: la del convenio. Es la que elige el flujo de Reglas de Estatus.
3. **Formulario → Caseta / Puente:**
   - sigue apareciendo al poner la unidad, con el puente por defecto;
   - si la tarifa del convenio no trae caseta, dice *De Reglas de Estatus: por el tráfico* (o *aduana Colombia*);
   - debajo dice en qué estatus se cobra según Reglas de Estatus, p. ej. *Se cobra al marcar 9.1 Verde Mx (Exportación)*. Si el flujo no tiene un paso con 🌉, dice que se cobra en el Verde;
   - **Colombia:** un tercer campo, **Puente Colombia** (*Puente Mx Colombia · $90.00*), de solo lectura. Con la caseta son los dos cobros. Si ya se cobró, muestra el cobrado.

## Pasos manuales
Ninguno.

## Ojo
- **Mis Operaciones** (la vista del operador) no abre la ventana. Con `cobroPuenteEnServidor` apagada, esa vista tampoco cobra el puente: lo cobra el servidor cuando la bandera está encendida (como hasta hoy).
- El puente que se cambia **a mano** en la tarjeta del formulario se guarda en la operación (`puenteId` / `puenteMonto`), pero el cobro sigue saliendo de la regla (tarifa → Reglas de Estatus). Es así desde antes. Si el puente elegido a mano debe ser el que se cobra, es una decisión aparte.

## Técnico
- `src/shared/data/avisos.ts`: `mostrarVentana` / `cerrarVentana` (estado `ventanas`, en fila). `AvisosFlotantes` (ya montado en App) la pinta con `.avf-fondo` / `.avf-ventana`. No es otro sistema de avisos.
- `src/features/puentes/services/crucePuente.ts` (+ pruebas):
  - `cobroPuenteDelPaso(op, statusId, statusNombre, fechaEvento)` = regla compartida (`cobroAlCambiarStatus` con `cargarCtxCobroPuente`, la regla 🌉 del flujo y "hoy" local); no escribe;
  - `textosCrucePuente` y `avisarCrucePuente`.
- `OperacionesDashboard`: `cobroDelPasoSP` se calcula siempre; `cobroParaEscribirSP` lo deja vacío con la bandera. La ventana sale después del `commit`, en el paso rápido (primer paso de la cascada que cobra) y en Registrar Movimiento.
- `FormularioOperacion`:
  - `camposSaldoPuente` ya no mira la bandera; `handleSubmit` guarda el cobro solo sin ella y abre la ventana después del guardado;
  - `flujoResuelto` (memo) alimenta `buildConfigId` y `pasosQueCobranPuente`;
  - `pisoColombia`;
  - campo Aduana con `isTransfer`.
- Banco de pruebas, con un flujo *Pendiente → 9.1 Verde Mx (Exportación) 🌉 → 8.1 Rojo Mx*:
  - **Nuevo Laredo:** la ventana dice *Caseta Puente III · $144.00 MXN* y la operación queda con saldoPuente 144;
  - **Rojo:** sin ventana;
  - **Colombia** (convenio con tarifa de aduana 800 Colombia): la ventana dice *Caseta Mx Colombia y Puente Mx Colombia · $129.60 MXN + $90.00 MXN*, y queda saldoPuente 129.6 + piso 90;
  - **formulario:** la Aduana queda en la misma columna, debajo de *Cargada / Vacía*. La tarjeta dice *De Reglas de Estatus: aduana Colombia* y *Se cobra al marcar 9.1 Verde Mx (Exportación)*, con *Puente Colombia: Puente Mx Colombia · $90.00*;
  - sin errores de consola.
