# V00461 — Operaciones: el tipo de cambio es siempre el de la fecha de servicio

**Web** (más un script de solo lectura en `functions/scripts`). Las Cloud Functions no cambian: no hay que desplegarlas. Sin reglas, índices ni banderas.

## Qué pasaba (TR-151026-019, servicio del 15 con el T.C. del 16)
1. **Al abrir una operación de días anteriores** (en Operaciones Activas, Servicios Completados, Cancelados o desde Facturación), el formulario le ponía el tipo de cambio de **hoy** antes de cargar su fecha, y así se quedaba. Al guardar, la operación se quedaba con el T.C. de hoy.
2. **Al cambiar la fecha a un día sin T.C. registrado**, se quedaba el de la fecha anterior y se mostraba como "TC Oficial".
3. **Un T.C. capturado en la noche** (después de las ~7 p. m.) se tomaba como el del día siguiente, porque se buscaba la fecha en cualquier campo del registro, también en la hora de captura (que se guarda en hora UTC). La tarjeta Tipo de cambio decía "DOF de hoy" con el de ayer por lo mismo.

## Qué cambia
- La operación usa el T.C. **de su fecha de servicio**. El registro de un día es el que tiene esa **fecha**; sábado y domingo sin registro toman el del **viernes** (la misma regla con la que Tipo de Cambio crea esos días). Un día hábil sin registro queda en 0 con aviso en rojo.
- Una operación **ya guardada** conserva su T.C. mientras no le cambies la fecha. Si trae 0, se completa con el de su fecha.
- Debajo de **Fecha de Servicio** (Información General) y del campo **Tipo de Cambio** (Por Cobrar):
  - verde: *TC oficial del 15 oct 2026: $18.4888*
  - amarillo: *TC de la operación $18.3500 · oficial del 15 oct 2026 $18.4888* con el botón **Usar el oficial** (se guarda al presionar Guardar; no aparece si Autorizaciones bloquea el campo para tu rol)
  - rojo: *Sin TC registrado del 12 oct 2026*

## Operaciones que ya se guardaron con otro T.C.
Las que se abrieron y guardaron otro día pueden traer el T.C. de ese día. Para saber cuáles (solo lee, no cambia nada):

```bash
cd functions
gcloud auth application-default login     # una vez, con tu cuenta de Google
npm run revisar:tc -- --desde 2026-09-01
```

Deja en `functions/reportes/tipo-cambio-…/`:
- `distintos.csv`: operación, fecha, cliente, status, T.C. que trae, el de su fecha, de qué día es el que trae, si el T.C. mueve dinero y si está facturada.
- `sin-tc.csv`: las que traen 0 y su fecha sí tiene registro.

Mándame los dos. Corregirlas cambia montos (y las facturadas, su factura): lo revisamos antes. Una sola se corrige abriéndola → **Usar el oficial** → Guardar.

## Técnico
- `src/shared/dominio/tipoCambio.ts` (+ pruebas, copia en functions): `fechaDeTipoCambio` (solo `fecha`/`Fecha`/`FECHA`), `valorDeTipoCambio`, `tipoCambioDeFecha`, `tipoCambioAplicable` (fin de semana → viernes), `mismoTipoCambio` (4 decimales), `mapaTipoCambio`, `revisarTipoCambioOperacion` (T.C. efectivo = `tipoCambioAprobado || tipoCambioDia`, como `dinero.ts`), `tipoCambioMueveDinero`.
- `FormularioOperacion.tsx`: el efecto del T.C. ignora la fecha por defecto mientras no llegan los datos de la operación; `fechaServicioTocada` (se reinicia en `aplicarDatosIniciales`, el formulario se reusa minimizado); depende también de `catalogosBaseListos` (la segunda carga de datos iniciales traía su 0 otra vez); el limpiador apaga "Buscando TC…". `formulario/AvisoTipoCambio.tsx/.css` (prefijo `atc`). Un `style={{` menos.
- `formulario/tipoCambioFila.ts` usa la regla compartida (`buscarTCAplicable`). `App.tsx`: la etiqueta de la tarjeta usa la `fecha` del registro.
- `functions/scripts/revisarTipoCambio.ts` + `npm run revisar:tc` (no tiene `--aplicar`).
- Revisión independiente (agente aparte), corregido: el formulario reusado heredaba "fecha cambiada" de la operación anterior; fin de semana sin registro quedaba en 0; con catálogos lentos el 0 regresaba; "Buscando TC…" podía quedarse; el script ignoraba `tipoCambioDia` y subestimaba qué operaciones mueven dinero.
- Banco de pruebas (T.C. del 14 y 15 capturados en la noche): antes, abrir una operación del 11 mostraba $18.4888 (el del 15, tomado como "hoy") y cambiar la fecha al 15 daba $18.50 (el del 14); ahora cada fecha da el suyo, el 12 (sin registro) dice "Sin TC registrado", el domingo 18 toma el del viernes 16, y un T.C. puesto a mano se conserva al reabrir con el aviso amarillo; "Usar el oficial" + Guardar lo corrige en la base. Sin errores de consola.

## Qué revisar con datos reales
1. Abre TR-151026-019: debe salir en amarillo con el T.C. del 15 como oficial. Presiona Usar el oficial y Guardar (si ya está facturada, avísame antes).
2. Abre una operación de otro día y sin tocar nada ciérrala: el T.C. no debe cambiar.
3. Crea una operación de prueba, cambia la fecha a ayer: debe tomar el T.C. de ayer.
