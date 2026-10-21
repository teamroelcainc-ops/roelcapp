# V00473 — Reglas de Estatus: eliminar flujos y elegir el puente de cada paso

**Web y funciones.** Va encima de la V00472. Sin reglas, índices ni banderas nuevas. La parte de funciones hace que el servidor cobre el puente elegido (ver *Pasos manuales*).

## Qué cambia en pantalla
1. **Eliminar un flujo.** En *Configuración → Reglas de Estatus*, cada flujo de la lista tiene el botón **Eliminar**, junto a *Editar*.
   - Primero pide confirmación. Si es el flujo para todas las aduanas de un Transfer, avisa que las operaciones sin flujo de su aduana se quedarían sin él.
   - Luego pide la nota de eliminación (obligatoria, como en todo el sistema).
   - El flujo va a la **Papelera de Reciclaje**, de donde se puede restaurar. También respeta *Autorizaciones*.
2. **Elegir el puente del paso.** En el panel del paso con *🌉 Aquí se descuenta el puente*, la caseta ya no es fija:
   - **Caseta:** una lista con *Automático: Caseta Puente III $144.00 MXN* (el de siempre según el tráfico) y todos los puentes de Tipos de Gastos;
   - **Monto:** se puede cambiar (vacío = el importe del catálogo; *Catálogo* lo regresa al del catálogo). Si cambias el monto estando en *Automático*, se queda elegido ese puente con el monto nuevo;
   - **flujo de Colombia:** dos campos, **Caseta** (Caseta Mx Colombia o Trompo Colombia) y **Puente** (Puente Mx Colombia), cada uno con su monto;
   - se guarda con *Guardar flujo*;
   - si el flujo no tiene un paso con 🌉, los Verde siguen mostrando el puente solo informativo, con la nota *Marca 🌉 aquí para elegir el puente*.
3. **Dónde se usa el puente elegido:**
   - **formulario de operación:** es el puente y el monto por defecto de la tarjeta *Caseta / Puente* (*De Reglas de Estatus: el puente elegido para ese estatus*);
   - **cobro:** se cobra al marcar ese estatus (Operaciones Activas, el formulario y, con la bandera, el servidor), y la ventana *Esta unidad cruzó el puente…* lo dice con su monto.

   El orden queda así:
   1. la caseta de la **tarifa del convenio** (como contestaste: si la tarifa trae su caseta, manda la tarifa);
   2. el **puente elegido** en Reglas de Estatus;
   3. el de siempre (Colombia o tráfico).

   Una operación de **Colombia** que usa el flujo para todas las aduanas no toma la caseta elegida ahí (sería la de Nuevo Laredo): toma la de Colombia. Para Colombia se elige en su propio flujo (Aduana 800 Colombia).

## Pasos manuales
1. **Desplegar la función** que cobra el puente (*no* `firebase deploy` sin `--only`):
   ```
   firebase deploy --only functions:operacionEscrita
   ```
   Con `cobroPuenteEnServidor` apagada, la web ya cobra el puente elegido sin desplegar. Con la bandera encendida, el servidor lo cobra hasta que se despliegue; mientras tanto, la ventana dice el elegido pero el servidor cobra el de siempre.

## Técnico
- `src/shared/dominio/cobroPuente.ts` (se copia a `functions/src/dominio`):
  - `PuenteElegido`, `ReglaPuenteFlujo`, `casetaDeElegido`;
  - `casetaPrevista(ctx, op, statusNombre, reglaPuente)`: tarifa → elegido (`origen: 'regla'`) → Colombia → tráfico;
  - `EventoStatusPuente.reglaPuente`; en `cobroAlCambiarStatus`, el piso elegido de un flujo de Colombia.
- `src/shared/dominio/flujos.ts`: `reglaPuenteDelPaso(flujo, statusNombre)` lee `puenteCaseta` / `puentePiso` (`{ gastoId, monto }`) del nodo con 🌉.
- `functions/src/puentesYDiesel.ts`: el cobro lleva `reglaPuente`.
- `statusRules.ts`:
  - `puenteSegunFlujo(op, nombre)` → `{ flag, regla }` con una sola búsqueda del flujo;
  - se quitó `statusDescuentaPuente`, que ya nadie usaba.
- `crucePuente.ts` y el formulario usan `puenteSegunFlujo`. El formulario tiene `flujoDocForm` y `reglaPuenteForm` para la tarjeta, y `pisoColombia` con el piso elegido.
- `ConfiguradorStatus`:
  - nodo con `puenteCaseta` / `puentePiso` (null = Automático);
  - `CampoPuenteElegible`;
  - `InfoPuenteFlujo.colombia` / `opciones`;
  - `eliminarFlujo` con `eliminarRegistro` (Papelera);
  - clases `.cs-puente-select`, `.cs-puente-monto-*`, `.cs-acciones-flujo`, `.cs-eliminar-flujo`.
- Pruebas: web (`cobroPuente.test.ts`, `crucePuente.test.ts`) y funciones (`puentesYDiesel.test.ts`: el elegido con su monto).
- Banco de pruebas:
  - **eliminar** *Transfer · Importación · Trompo*: sale de la lista y queda en la Papelera con su nota;
  - **paso 9.1 Verde Mx (Exportación) de Transfer · Exportación · Cargado:** *Caseta AVI* con monto 25 → se guarda `{ gastoId: 'g-avi', monto: 25 }`;
  - **formulario:** trae *Caseta AVI · 25 · De Reglas de Estatus*;
  - **al marcar el Verde:** ventana *Caseta AVI · $25.00 USD* y la operación queda con saldoPuente 25 en Dólares;
  - sin errores de consola.
