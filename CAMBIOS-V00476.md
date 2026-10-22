# V00476 — Servicios Completados: regresar una operación completada o en Falso a otro estatus

**Solo web.** Va encima de la V00475. Sin funciones, reglas, índices ni banderas.

## Qué cambia en pantalla
**Servicios Completados → ficha de la operación → botón nuevo *Regresar estatus*** (entre *Bitácora* y *Editar*).

La ventana muestra:
- **Los estatus de su flujo** (Configuración → Reglas de Estatus), en orden, sin el actual ni *Cancelado*:
  - los que ya pasó dicen cuándo (*pasó el 22/10/2026 09:15*);
  - *Completado* y *Falso* dicen *Se queda en Completados*;
  - viene marcado el último estatus por el que pasó antes de completarse o irse a Falso.
- **Fecha y hora del movimiento** (por omisión, ahora).
- **Qué va a pasar**, antes de guardar:
  - si sale de Servicios Completados y vuelve a **Operaciones Activas**;
  - el sueldo del operador: al salir de Falso **regresa al completo** (p. ej. $200 → $400); de Completado a Falso, a la mitad;
  - si sigue ligada a una **factura** (cliente o proveedor), **nómina** o **diésel**. Esas referencias no cambian; hay que revisarlas si hace falta.

Al presionar **Regresar a (estatus)**:
- **A un estatus en proceso** (p. ej. *2. En ruta*): la ficha se cierra y la operación sale de la lista de Completados. Aparece en Operaciones Activas sin presionar *Actualizar*, con el aviso *TR-… regresó a 2. En ruta y ya está en Operaciones Activas.*
- **De Falso a Completado (o al revés)**: se queda en Completados con el estatus nuevo.
- **La bitácora** (en Activas y en Completados) muestra ese movimiento con la etiqueta *regresó de 7. Falso*.
- **Si el estatus cobra el puente** (Verde o el paso con 🌉) y la operación aún no lo tiene, se cobra como en Operaciones Activas y sale la ventana *Esta unidad cruzó el puente…*. Si ya lo tenía, no se cobra otra vez.
- **Si alguien más le cambió el estatus** mientras la ficha estaba abierta, no guarda nada y pide cerrarla y volverla a abrir.
- **Historial de Actividad:** queda *Regresó la operación TR-… de "7. Falso" a "2. En ruta"*.

## Pasos manuales
Ninguno.

## A tomar en cuenta
- **Facturas, nómina y diésel no se modifican.** Si una operación facturada o con nómina pagada regresa a Activas, sigue en esa factura o nómina. Si se quiere impedir el regreso en esos casos, es una regla nueva.
- **No tiene permiso propio:** lo ve quien puede abrir la ficha, igual que *Editar*. Se puede pasar a *Permisos Especiales* si se quiere limitar.
- **Roelca Móvil:** la operación vuelve a aparecerle al operador como activa (lee su estatus).

## Técnico
- `features/operaciones/services/regresoStatus.ts` (puro):
  - `opcionesDeRegreso`: flujo → bitácora → catálogo; sin el actual ni cancelación; `ultimaVez` y `terminado`;
  - `efectosDelRegreso`: Activas, sueldo y ligas;
  - `fechaHoraCorta`, `ORIGEN_REGRESO_STATUS`.
- `regresoStatusDatos.ts`:
  - `leerBitacora`;
  - `regresarStatusOperacion` en `runTransaction`. Relee la operación, compara el `status` y calcula `ajusteSueldoPorStatus` con el dato actual. Escribe el horario (`regreso`, `statusAnterior`, `statusAnteriorNombre`) y la operación;
  - el puente se escribe con `cobroPuenteDelPaso` sin la bandera `cobroPuenteEnServidor`, y solo si `!puenteYaCobrado` en la base;
  - después: `registrarLog`, `notificarOperacionGuardada` (origen `regreso-status`), `avisarCrucePuente` y `registrarVerdeAutomatico`.
- `components/RegresarStatus.tsx` + `.css` (`rgs-`): botón y ventana con portal; carga flujo y bitácora al abrir.
- `ServiciosCompletados`:
  - `alRegresarStatus`: a Activas, saca la operación de la lista y limpia las cachés de búsqueda (`roelca_completadas_`); a Completado/Falso, actualiza la fila y la ficha;
  - etiqueta en la bitácora (`.sc-bitacora-regreso`);
  - **se quitó el registro manual muerto desde la V00365** (`abrirRegistroHorario`, `guardarHorario`, `registrarStatusRapido`, modal *Registrar Movimiento*, `cargarBotonesDelFlujo` en cada ficha) y sus clases `.sc-x224`–`.sc-x226`. ESLint del archivo: 143 → 138.
- `OperacionesDashboard`:
  - `recibirRegreso` (bus con origen `regreso-status`) agrega la operación si es activa;
  - etiqueta *(regresó de …)* en la bitácora.
- Pruebas nuevas:
  - `regresoStatus.test.ts`: opciones, nombres tolerantes, respaldo bitácora/catálogo, sueldo, ligas;
  - `regresoStatusDatos.test.ts`: escritura, sueldo con el dato actual, estatus cambiado no escribe, puente con y sin bandera, ya cobrado.
- Banco de pruebas (navegador):
  - **TR-221026-011 en 7. Falso** (bitácora 1. Pendiente 07:30 → 2. En ruta 09:15 → 7. Falso; nómina NOM-45). Las opciones son *1. Pendiente*, *2. En ruta* (propuesta), *3. Verde Mx* y *6. Servicio Completado*, y avisa sueldo $400 y NOM-45. Al regresar a *2. En ruta*, en la base queda `status` En ruta, sueldo 400 y `sueldoMitadAplicada` false, más el horario con `regreso`. Sale de Completados, entra a Activas sin Actualizar y su bitácora dice *(regresó de 7. Falso)*;
  - **TR-221026-012 en Falso, sin bitácora:** sin propuesta, el botón dice *Elige un estatus*. Al pasar a *6. Servicio Completado* se queda en la lista y la ficha muestra el estatus nuevo;
  - sin errores de consola ni diálogos.
