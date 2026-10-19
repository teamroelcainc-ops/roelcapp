# V00463 — Operaciones: ya no aparece el aviso "internal" al guardar una operación nueva

**Solo web.** Va encima de la V00462. Sin funciones, reglas, índices ni banderas.

## La causa
El aviso **"internal"** sale al guardar una operación **nueva**. La operación se crea en el servidor (función `crearOperacion`, la que da el consecutivo sin duplicar) y el formulario mostraba tal cual el error que recibía.

"internal" en minúsculas **no lo escribe la función**: lo pone Firebase en el navegador cuando **no recibió ninguna respuesta válida**. Eso pasa en dos casos:
- se cortó o tardó demasiado la conexión del equipo;
- Google rechazó la llamada antes de que la función contestara (servidor saturado, instancia reiniciándose).

Un error de la propia función llega con su mensaje en español, y un error no controlado de la función llega como "INTERNAL" en mayúsculas. Por eso es intermitente y le pega a quien está capturando.

## Qué cambia
1. **Reintento automático:** si no hay respuesta, la app vuelve a intentar sola hasta **3 veces** (espera 1.5 s y 4 s), siempre con el **mismo identificador de envío**. La función no duplica: si un intento sí llegó, devuelve esa misma operación. La mayoría de las veces el usuario ya no ve nada, solo tarda unos segundos más.
2. **Si aun así no se puede:** en lugar de "internal" sale un aviso en español, por ejemplo *"No se pudo comunicar con el servidor para guardar la operación (se intentó 3 veces en 9.6 s). Tus datos siguen en el formulario: revisa la conexión y presiona Guardar otra vez. No se duplica…"*. El formulario no se cierra.
3. **El siguiente Guardar tampoco duplica:** el formulario conserva el identificador hasta que la operación se guarda o se cancela. Si algún intento anterior sí había llegado, usa esa operación y le aplica lo que se capturó después.
4. **Rastro para saber cuánto pasa:** en el **Historial de actividad** (módulo Operaciones) queda:
   - **Reintento** cuando se salvó al 2.º o 3.er intento;
   - **Error** cuando no se pudo, con el usuario, la hora, los intentos, los segundos y si el equipo estaba sin internet.
5. Cambiar la línea de una operación (renumerar) también se reintenta solo.

## Para confirmar la causa exacta (opcional, 5 minutos)
Consola de Google Cloud → **Logging** → Explorador de registros, del día que pasó:

```
resource.type="cloud_run_revision"
resource.labels.service_name="crearoperacion"
(httpRequest.status>=400 OR severity>=WARNING)
```

- **Si aparecen** respuestas 429, 500 o 503 a la hora de los avisos: es el servidor (se puede dejar una instancia siempre encendida; tiene costo, lo decidimos juntos).
- **Si no aparece nada:** fue la conexión del equipo (las llamadas nunca llegaron).

Mándame una captura de cualquiera de los dos casos.

## Técnico
- `features/operaciones/services/reintentosCallable.ts` (+ pruebas):
  - `codigoCallable`, `esFalloDeConexion` (código pasajero cuyo mensaje es el mismo código), `esReintentable`;
  - `conReintentos(fn, [1500, 4000])` y `ErrorTrasReintentos` (intentos y segundos).
- `operacionesService.guardarOperacionSegura(datos, { clienteOpId })` (+ pruebas con una `crearOperacion` falsa idempotente):
  - 30 s por intento y reintentos con el mismo `clienteOpId`;
  - `yaExistia` en el primer intento de un Guardar → `updateDoc` con lo capturado, sin `id`, `ref`, `refPrefijo`, `refConsecutivo`, `creadoPor` ni `createdAt`;
  - el aviso de conexión va antes del de cuota (un 429 de Cloud Run no es la cuota de Firestore);
  - registra en `historial_actividad`.
- `FormularioOperacion.tsx`:
  - `clienteOpIdRef` se limpia al terminar de guardar (después de los documentos), al cancelar y al cargar otra operación;
  - renumerar va con `conReintentos`;
  - dos `any` menos (línea base 2268 → 2263).
