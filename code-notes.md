# code-notes.md — decisiones no obvias y pendientes

Registro de decisiones de la refactorización (prompt "Plan de Acción", fases 0–8) y de lo que queda pendiente.
El plan operativo (puntos de parada, banderas, orden de despliegue) está en `PLAN-REFACTOR.md`.

## Base y alcance
- La refactorización parte de la **V00435** (V00434 + parche de la app móvil). El `Roelca-app_1.7z` subido el 10/oct es la V00427 (sin V00428–V00434); aplicarlo ahí habría perdido 7 versiones.
- El CLAUDE.md recibido era el de Precise Cleaning: se conservaron las reglas generales y se reescribió "Específico de este proyecto" para Roelca.
- Puntos de parada respetados: no se publican reglas, no se corren migraciones ni reconciliaciones, no se borran campos legados. Todo lo que depende de eso va detrás de banderas apagadas.

## Decisiones de diseño
- **Rutas del prompt adaptadas al CLAUDE.md**: `src/data/*` → `src/shared/data/*`; `src/data/esquema.ts` → `src/types/firestore.ts`; lógica pura compartida con functions → `src/shared/dominio/` (copia generada en `functions/src/dominio/`).
- **Lógica compartida web ↔ functions por COPIA generada** (`scripts/sincronizar-dominio.mjs` + prueba de paridad): functions se despliega sola y no puede importar de `src/`. Alternativas descartadas: importar `../src` desde functions (no viaja en el deploy) y un paquete npm local (más tooling para un equipo de una persona).
- **`useColeccionViva` usa un store propio con `useSyncExternalStore`, no el queryClient** (el prompt decía "escribe en el queryClient"): React Query no aporta nada a datos en vivo y sería otra capa de caché que invalidar (regla de Caché del CLAUDE.md). React Query se queda para lecturas únicas (conteos, páginas, reportes).
- **Dependencias** (autorizadas por el prompt aplicado): `vitest@5`, `@testing-library/react`, `jsdom@27` (la 30 exige Node ≥22.22.2), `@firebase/rules-unit-testing@5` (la 6 exige firebase 13; el proyecto usa 12), `@tanstack/react-virtual`; en functions `zod` y `vitest`.
- `.env` sale del índice de git (sigue en el zip para que el proyecto compile) y se agrega `.env.example`.

## Limitaciones del entorno donde se hizo
- El emulador de Firestore no se puede descargar en el entorno de Claude (red bloqueada a storage.googleapis.com): las pruebas de reglas (`npm run test:rules`) están escritas pero **no se corrieron**; se corren en la máquina de Omaf con `firebase-tools`.
- No hubo navegador con datos reales: tsc, ESLint, vitest y build verifican que compila y la lógica pura; los listeners, la caché y los flujos de pantalla no se probaron en vivo (cada CAMBIOS-Vxxxxx.md dice qué revisar).

## Fase 1 (V00437)
- **Claims solo para LEER en reglas**; callables y escrituras revisan el documento del perfil (revocación inmediata para escribir). Compromiso: hasta 1 h de lectura tras una baja (vida del token). `exigirAdmin` y el `esAdmin()` de las reglas usan SIEMPRE el documento.
- **"Sin perfil = sin acceso" NO va detrás de bandera**: es el hueco principal. Riesgo: cuentas de Auth sin documento (p. ej. creadas en la consola) quedan fuera al publicar la web → `sincronizarClaims` las lista.
- **Delete en reglas sigue permitido al personal** (122 llamadas de borrado en el código). `eliminarConPapelera` existe y la bandera `eliminarPorServidor` la activa para `eliminarRegistro`; los borrados por lotes de los módulos se migran cuando se toquen. PENDIENTE: negar `delete` en colecciones de negocio cuando no quede ninguno directo.
- **Login ya no abre la sesión**: la abre `onAuthStateChanged` en App.tsx tras validar perfil y red (`abrirSesion`). El listener del perfil propio termina de abrirla si el arranque fue sin red.
- **Red de oficina**: no había interfaz para `requiereIPOficina` (el candado nunca se aplicaba): se agregó la casilla en Roles. La versión robusta (función bloqueante `bloqueoRed.ts`) requiere Identity Platform.
- **Tres copias de "total nativo de factura"** (pagos/services/aplicarPagos.ts, facturacion/services/totalesFactura.ts, relacional.ts): idénticas a propósito por ahora; se unifican en `src/shared/dominio/dinero.ts` en la Fase 5.
- **Nóminas**: listener ordenado por `fechaPago` + listener legado `limit(400)` solo para las que no tienen `fechaPago` (PENDIENTE Fase 4: quitarlo cuando la migración rellene el campo). Folio: contador por día `contadores/referencias_nomina_DDMMAAAA`. `saldoPrestamo` sigue como valor absoluto recalculado del historial completo (no `increment`: arrastraría desfases viejos).
- **Facturación**: el recálculo del total al cambiar operaciones usa delta cuando las filas no reproducen el total guardado (facturas importadas con filas en 0 o total capturado a mano).

## Fase 2 (V00438)
- **Patrón para listeners en módulos de MantenerVivo**: `const visible = useModuloVivoActivo()` + `if (!visible) return;` en el efecto y `visible` en las dependencias (diff mínimo). `useSnapshotSoloVisible` es para código nuevo.
- **memo**: `lazyWithRetry` devuelve `memo(lazy(...))` para TODOS los módulos (reciben props primitivas o ninguna). `FormularioOperacion` en memo + `useHandlerEstable` en los padres. Se justifica por el problema medido en el review (cada render de App re-renderizaba 12 módulos).
- **Recarga por versión nueva**: `edicionesAbiertas.ts` (FormularioOperacion abierto + todo `handleSubmit`). Se conserva `skipWaiting` (V00311) en vez de `registerType: 'prompt'`: 'prompt' reintroduciría el ERR_FAILED intermitente.
- **Flujos de estatus**: la vista previa del formulario ya no usa la caché de 6 h (`flujo_v1__`); lee fresco una vez por formulario. Los botones de estatus siguen con la caché de 6 h (preexistente). PENDIENTE Fase 3.5: versionar `config_flujos_operacion` en `meta/versionesCatalogos` para invalidar en todos los navegadores.
- **Bug preexistente anotado (no corregido)**: `ServiciosCompletados.css` y `ServiciosCancelados.css` definen las mismas clases (`.sc-x1`…) con estilos distintos; el que carga después gana.
- **`src/utils/operacionesBus.ts`** sigue borrando llaves viejas de caché de operaciones en cada evento (inofensivo; borrar al tocarlo).

## Fase 3 (V00439)
- **Catálogos en vivo compartidos en lugar de `meta/versionesCatalogos` (3.5 del prompt)**: el prompt proponía lectura única + caché versionada por un documento `meta/versionesCatalogos` que un trigger incrementa. Se eligió un `onSnapshot` compartido por colección sobre la caché persistente de Firestore: con IndexedDB un listener que se reabre antes de 30 min solo cobra lo que cambió, no necesita trigger ni documento de versiones, y elimina toda invalidación manual (regla de Caché del CLAUDE.md: no apilar capas). Costo: un listener abierto por catálogo en uso (15 min de permanencia). `DOC_VERSIONES_CATALOGOS` queda en constantes sin uso por si se retoma.
- **`useColeccionViva` con store propio** (ver Decisiones de diseño), no el queryClient.
- **`_docId` / `idReal()`**: los módulos armaban `{ id: d.id, ...d.data() }` (un campo `id` guardado gana) y otros usaban `d.id` directo. El catálogo conserva la primera forma y expone el id real como propiedad NO enumerable (`{...doc}` no la copia ni se escribe de vuelta). Regla: para escribir o guardar una llave foránea usa `idReal(x)`. Se revisaron ≈60 archivos contra el diff para conservar el id que usaba cada sitio.
- ~~Una sola pestaña con caché en disco (`persistentSingleTabManager`) hasta la Fase 7~~ → **V00447: `persistentMultipleTabManager`** (ver V00447). `almacenSesion` ya no copia a localStorage valores de más de 200 mil caracteres ni pasa de 2 millones en total; el guardián de 3.5 MB se conserva.
- **Arreglos compartidos congelados en DEV**: varias vistas comparten el mismo arreglo; un `.sort()` en sitio en una afectaría a las demás. En producción no se congela (costo).
- **`obtenerCatalogo` espera al servidor (6 s máx.)**: los servicios que escriben (integridad de convenios, sincronizar nombres) no deben decidir con la copia local; sin red devuelve la caché.
- **EDITAR REF** pasa de `includes('ADMIN')` a admin exacto (corrige que ADMINISTRATIVO contara como admin). Documentado como cambio visible en CAMBIOS-V00439.md.
- **Pendientes detectados (no corregidos, preexistentes)**:
  - Facturación: el filtro "Dólares/Pesos" del historial compara texto y falla con monedas guardadas por ID.
  - `utilidadTransfer`: compara contra `ID_MXN` en mayúsculas (nunca coincide).
  - Proveedores de unidad: el formulario escribe en `proveedores_unidad` pero una vista lee `proveedoresUnidad`.
  - `ServiciosCompletados` sigue con `almacenSesion` (Fase 7) y `EmpresasDashboard` con `empresas_conteo_ops_v2` (Fase 6.5/7.6).

## Fase 4 (V00440)
- **Canónicos JUNTO a los legados**, nunca en su lugar (regla del prompt 4.1). Se agregaron `provServiciosId`, `origenId` y `destinoId` (no estaban en el prompt): sin un ID por papel, `empresasIds` no se puede mantener cuando un papel trae un nombre viejo que el trigger no sabe resolver.
- **Una sola regla de resolución para trigger y migración** (`resolver` en operacionCanonica.ts): un valor con forma de ID se guarda tal cual en los dos, aunque no exista (la migración solo lo reporta en `avisos.csv`). Si la migración "corrigiera" algo que el trigger no puede reproducir, se pisarían mutuamente en cada corrida.
- **El trigger no carga empresas/empleados/unidades** (costo): resuelve por forma de ID; los nombres viejos los resuelve la migración. Para no deshacer lo que ella resolvió, `cambiosCanonicos` conserva el valor canónico existente mientras el dato del usuario no cambie (y en documentos nuevos que ya lo traen: restaurados de la papelera, importados).
- **Campos viejos con el mismo nombre que un canónico** (`unidadId`, `operadorId`, `clientePagaId`, `statusId` en registros de AppSheet): el trigger nunca los usa como fuente (son suyos) pero los conserva; la migración los considera al final (`incluirPropio`).
- **Escrituras del trigger con precondición `lastUpdateTime`**; si falla, recalcula en transacción con el dato actual y el `antes` del evento. Evita escribir canónicos calculados con una versión vieja.
- **Fecha**: `aFechaServicioISO` replica "⚡ Acelerar búsquedas" (UTC para Timestamp) porque ese botón ya escribió `fechaServicioISO` y Servicios Completados lo consulta. Diferencia deliberada: años de 2 dígitos se leen día/mes (⚡ los leía mes/día). Un `fechaServicioISO` válido nunca se reemplaza por "no sé".
- **Nóminas**: `fechaPagoISO` nuevo en vez de reescribir `fechaPago` (el dato original se ve en pantalla). Sin fecha legible se usa fechaFin/createdAt solo en el canónico, con aviso.
- **Pagos**: `empresaId` sí; el `tipo` no se infiere (los pagos sin tipo cambiarían de pestaña): se reportan.
- **4.5 (búsquedas por texto) — parcial a propósito**: `estadoGrupoDe` se aplicó donde el resultado es idéntico (Activas, Falsos de Completados, Nómina). Resumen del día, Resumen diario, saldos/referencias de puentes y `yaCancelada` siguen por texto: pasar a ID cambia sus cifras en datos raros (ID cancelado con nombre distinto, etc.); se cambian con sus consultas en la Fase 7. `where('carga','==',nombre)` de Catálogos y las 6 copias de "EL CONVENIO MANDA" (`split(' - ')`) dependen de `cargaId` (ya canónico) y de guardar `cargaId/aduanaId` en el detalle del convenio (Fase 6.3).
- **4.6**: la conversión a número se hace al guardar (no en `handleChange`: un input numérico controlado con number pierde "1." al teclear) y el historial compara contra los datos iniciales normalizados.
- **Pendientes**: quitar el listener legado de nóminas sin `fechaPago` cuando las consultas usen `fechaPagoISO` (Fase 7); canónicos que son llaves de AppSheet (avisos `aliasAppSheet`) se corrigen al reparar relaciones (Fase 6) — la ficha de Empresas por `array-contains` no los encontrará hasta entonces; `relacional.ts` todavía tiene su propia copia de "total nativo" y de `esUSD` (Fase 5).

## Fase 5 (V00441)
- **Dos reglas de total a propósito hasta P3**: `totalNativoFactura` (regla única = la de Facturación: total manual → `subtotalMonedaFactura` → renglones) y `totalNativoFacturaLegado` (Pagos) + `totalNativoDeRenglonesLegado` (trigger de saldo y cascada operación→factura del servidor, desde los renglones). Con `dineroPorServidor` apagada cada pantalla y trigger usa EXACTAMENTE su regla de antes (pruebas de paridad de 3,000 casos y `functions/test/relacionalDinero.test.ts`); la reconciliación muestra en qué facturas difieren. Se borran en P4.
- **La cascada operación→factura del servidor conserva su conversión "espejo" sin la bandera** (`conversionOperacionLegado` en relacional.ts): acepta el ID de moneda en `monedaCobroNombre`, la regla única no. Con la bandera usa `conversionOperacion` (la de la web).
- **`totalManualCentavos`** solo se marca si el total capturado no sale de sus renglones (misma regla que la reconciliación). Los caminos viejos de edición lo ponen en 0 (tras apagar la bandera manda lo capturado, no una marca vieja).
- **Las callables leen la bandera sin caché** (`banderaServidorFresca`): las reglas y la web la ven al instante; con la caché de 60 s las callables rechazaban durante un minuto.
- **Proyecciones** (`renglones/`, `aplicaciones/`): diff del evento dentro de una transacción que relee el documento; si el evento llegó tarde se escribe lo vigente y se borra lo que salió (un evento viejo no deja la tabla atrasada).
- **Facturas importadas del CSV** guardan `operacionesIds`/`operaciones` como texto con comas: `lista()` y `renglonesDeFactura()` (facturacion.ts) las leen igual que `normalizarFactura`; quitar/mover también leen la factura a la que apunta la operación (la consulta `array-contains` no las encuentra).
- **Folio con otras mayúsculas**: la búsqueda en Firestore solo prueba exacto/MAYÚSCULAS/minúsculas; el ID determinista cubre las facturas nuevas. PENDIENTE: un campo `invoiceNormalizado` (migración) para las facturas viejas con mayúsculas mezcladas.
- **Reglas**: la condición de dinero revisa primero si cambia un campo de dinero (sin lectura) y solo entonces lee `configuracion/flags`. `moneda*`, `clienteId`/`proveedorId` siguen editables (Sincronizar con Empresas, unir empresas); el trigger recalcula los agregados después.
- **Peaje en el servidor**: dentro de `operacionEscrita` (no un trigger más). Se evalúa al cambiar de estatus o al corregir convenio/tipo/proveedor/tráfico/carga ya en un estatus que cobra; nunca en otras ediciones (una migración no debe cobrar operaciones viejas). Regla = `OperacionesDashboard.camposSaldoPuenteAlCompletar` (con respaldo por el verde marcado), no la del formulario (que no lo tenía).
- **Saldo de diésel**: `saldos_diesel` ya era el libro de SALDOS (abonos), no un saldo corrido; el corrido nuevo vive en `saldos_corrientes/diesel_<proveedor>` (lo cargado por día). Se RECALCULA el día con las referencias de ese día (idempotente, sin `increment`); el trigger corre aunque la bandera esté apagada para que los datos estén al día al encenderla.
- **PENDIENTE (decisión)**: saldo corriente de **puentes**. Saldos de Puentes resta operaciones con `saldoPuente` (desde la 1a recarga) y la tarjeta Casetas resta `referencias_puentes_auto` + otros cruces. Son dos definiciones del consumo; hay que elegir una antes de mantenerla en un documento.
- **PENDIENTE**: grupos de facturas con el mismo folio: los documentos secundarios con total 0 toman, con la regla única, el total de sus renglones (como ya hacía el trigger de saldo). Revisar en `diferencias.csv`.
- **PENDIENTE (P4)**: invertir la dirección de las proyecciones (que las pantallas lean `renglones/` y `aplicaciones/`) y borrar `operacionesGuardadas` y `pagos.facturas[]`.

## Fase 6 (V00442)
- **Un trigger por operación**: `operacionMontoCambiado` se unió a `operacionEscrita` (la cascada de montos es su paso 2). Al desplegar, firebase pide borrar la función vieja: hay que aceptar.
- **"Campos propios"** (`soloCamposPropios`): los canónicos menos `esPrueba` (lo marca el usuario) y la marca del peaje. Un evento que solo cambió esos sale sin calcular. Los derivados del convenio (carga, aduana) NO son propios: el usuario también los edita y la regla "EL CONVENIO MANDA" debe volver a aplicarse.
- **Reintentos (`retry: true`)**: todo trigger relee el documento actual, escribe con precondición o en transacción (nunca con la copia del evento): un reintento tardío de un evento viejo no puede regresar montos, claims, status ni nombres. Se descarta un evento de más de 24 h (no 15 min: una importación grande entrega eventos tarde la primera vez).
- **Contadores en `usos/` y no en la empresa/convenio**: esos documentos los escucha cada navegador (catálogos en vivo); un contador que cambia con cada operación los haría releer en todas las pantallas. Lote sin lecturas con `create` del id del evento (deduplicación) + `increment`; "último uso" es de mejor esfuerzo (solo sube) y lo deja exacto `npm run usos`.
- **Peaje**: desde aquí solo cuentan como "corrección" los IDs que cambia el usuario (convenio, tipo de operación, proveedor). Los nombres y lo que deriva el servidor (carga, aduana, tráfico) no: un renombre o la propagación nunca cobran operaciones viejas.
- **Regla de nombre de empresa POR DESTINO** (la del formulario): razón social en Cliente (Paga)/Cliente Mercancía/Proveedor de Transporte/facturas/pagos/tarifarios/convenios/diésel; nombre corto en Origen/Destino/Prov. Servicios. PENDIENTE (decisión): si se quiere UNA sola regla para todo, cambiar `nombres.ts` y el formulario a la vez.
- **PENDIENTE (decisión)**: propagar la descripción de los detalles de convenio a `convenioNombre`. Requiere que "EL CONVENIO MANDA" use `cargaId`/`aduanaId` del detalle y no el texto (si no, renombrar una descripción re-derivaría carga/aduana de operaciones pasadas).
- **PENDIENTE (decisión, 6.3)**: una sola dirección tarifario ↔ detalles. Propuesta: la pantalla del tarifario escribe el status en el DETALLE cuando la línea ya tiene convenio (el trigger lo proyecta a la línea); las líneas pre-convenio (sin detalle) siguen en el tarifario; entonces `sincronizarDetallesDeTarifario` deja de empujar el status. Se tocan TarifarioClientes/Proveedores: probar en navegador.
- **Botón de Catálogos "Sincronizar nombres"** se queda: también corrige Direcciones, que el mapa no cubre.

## Fase 7 (V00443)
- **Una sola capa de consultas** (`src/shared/data/consultas.ts`): páginas de `tamaño + 1` (saber si hay más sin otra lectura), `todasLasPaginas` con tope que se AVISA, `porIds` en lotes de 30 en paralelo, documentos con `armarDoc` (un `id` guardado gana, `_docId` no enumerable = id real; se pierde al hacer `{...doc}`: leerlo antes).
- **Sin respaldo de "leer todo"** con la bandera (regla 7 del plan): si falta un índice, el error se ve. Los caminos viejos (bandera apagada) conservan sus respaldos.
- **Las pantallas que al montar eligen camino esperan las banderas** (`useFlagsCargadas`, o `await obtenerFlags()` en los cargadores): antes de la primera lectura todas están "apagadas" y empezaban la descarga vieja. A los 3 s sin respuesta se dan por apagadas.
- **La última petición manda** (Facturación, Resumen del día, reporte de puentes): un id de petición descarta respuestas viejas; ninguna se cancela al cambiar de vista para que "Cargando…" siempre se apague.
- **Contadores en vez de listas** (Empresas, Detalles de Convenio, uso de tarifas): `usos/` no cuenta operaciones de prueba; las listas de la ficha también las quitan. DECISIÓN tomada con el plan (7.7): la tabla de Detalles de Convenio ya no muestra el desglose por status de cada fila con la bandera (requeriría descargar todas las operaciones o contadores por status). Si se quiere de vuelta: contadores `porStatus` en `usos/` (más escrituras por cada cambio de status) — pendiente de decidir.
- **Pagos**: `abierta` solo es confiable con `dineroPorServidor` (la escribe el servidor y la reconciliación P3 la deja en todas); por eso el modal acotado pide las DOS banderas. "Unir entidades" sigue leyendo todas las facturas (renombra también las pagadas).
- **Servicios Completados**: la caché del rango canónico vive solo en memoria (CLAUDE.md); las cachés viejas en `almacenSesion` se retiran en P4 junto con el camino viejo. Varias pestañas no comparten esa caché (cada una pide su rango).
- **Cambios sin bandera** (correcciones, no dependen del servidor): cortes silenciosos de 60/150/10 eliminados, lotes de 30 en paralelo, conteo exacto en "¿Dónde se usa?" (con agregación: sin red falla y muestra 0, antes salía de la caché local), re-descarga al cambiar de rango en Completados, escrituras en lote al guardar Detalles de Convenio (todo o nada), "Unir" convenios con `in` (mismo criterio: el campo guardado es exactamente el id).
- **PENDIENTE (decisión)**: (1) lista de Pagos por empresa y periodo — hoy escucha todos los pagos del tipo; acotarla cambia la pantalla (selector de periodo). (2) Historial de facturas paginado y por empresa (Facturación todavía baja la colección de facturas). (3) "Facturadas"/"Todas" por rango de fechas. (4) `resumenes_diarios/{fecha}` con una función programada para Reportes/Resumen (función nueva y despliegue). (5) Totales con `getAggregateFromServer` en Estadísticas. (6) Tarjeta de saldo de puentes (ver Fase 5).

## Fase 8 (V00444)
- **Hooks con el mismo comportamiento**: `useOperacionesActivas` y `useOperacionesFacturables` son el código de antes movido (mismos mensajes, mismos topes, mismo respaldo); entregan `setOperaciones` porque los tableros siguen modificando la lista (status en vivo, facturar). El hook de Operaciones recibe `esActiva` como función que el tablero declara después: solo se llama al cargar (después del render).
- **Unificado solo lo IDÉNTICO** (comparado texto contra texto): selectores de Facturación, `fmtFechaAuditoria`/`colorTipoOperacion`/`compararStatusPorNumero`/`limpiarUndefined` (3 tableros), `truncarValorLog`/`describirCambiosLog` (formulario y Completados).
- **NO unificado (comportamientos distintos, decidir)**: (1) `colorTipoOperacion` del FORMULARIO evalúa 'logist' antes que 'flete' ("Logística Fletes" sale azul en el formulario y verde en las tablas, V00177) — probablemente un olvido del formulario. (2) Cinco normalizadores de fecha casi iguales: el del formulario devuelve '' si no entiende, el de Completados devuelve el texto, Cancelados/Reportes/Resumen tienen otras variantes; el canónico es `aFechaISO` de `shared/dominio/fechas.ts`. Unificarlos cambia qué operaciones entran en los filtros de fecha de cada pantalla.
- **8.2 — diferencias entre Facturación Clientes y Proveedores** (similitud de cada bloque, 1 = idéntico): Emisores de remisión 0.91, Configurar columnas 0.92, Agregar referencia 0.92, Vista previa de remisión 0.86, Diagnóstico 0.69, Modal de facturar 0.68, Filtros 0.66, Edición de factura 0.66, Costo adicional 0.62, Detalle de factura 0.52, pestaña Unidad 0.37; solo Clientes: tarjeta de cliente; solo Proveedores: Confirmación de Tarifa y Rate. Además, el guardado en vivo (`suscribirOperacionGuardada`) quita de la lista en Clientes las operaciones que dejan de ser facturables y en Proveedores no. Hay que elegir en cada punto.
- **`CampoArchivo`**: estilos en línea → clases con modificador (`fo-archivo--arrastrando|cargado|resaltar|vacio`, misma prioridad que antes); el hover del "+" con `:hover` en vez de onMouseEnter/Leave (mismo color).
- **`useEffectEvent` en lugar de `eslint-disable … exhaustive-deps`**: un efecto se repite con las mismas dependencias de antes; su cuerpo (ahora un "effect event") lee los valores vigentes. Para el cuerpo del efecto es lo mismo (el callback del efecto es el del render en que se programa). NO es lo mismo para lo que el efecto deja SUSCRITO (escuchas, timers, `suscribirOperacionGuardada`): antes esas funciones se quedaban con los valores del momento de suscribirse; ahora leen los vigentes. En Pagos eso corrigió un error (ver CAMBIOS-V00444.md). Los efectos con limpieza devuelven la limpieza del evento. Los `useMemo` con `eslint-disable` quedan (necesitan `useCallback` en sus funciones auxiliares).
- **Trinquete de exhaustive-deps**: cuenta `suppressedMessages` de ESLint (lo que de verdad se apaga), no el texto de los comentarios: un `eslint-disable` sin regla o de archivo completo también cuenta; los comentarios que no apagan nada ya salen como problema ("Unused eslint-disable directive").
- **PENDIENTE**: meta de 800 líneas (plan en PLAN-REFACTOR.md, Fase 8.3), 8.2 (decisión), 8.4 (P1 + P2 + app móvil), íconos SVG propios del formulario → lucide-react.

## V00445
- **Prueba de humo de módulos** (`src/__pruebas__/`): Firebase falso con un `Proxy` (cualquier función desconocida devuelve un objeto encadenable; lecturas vacías; `configuracion/flags` según `estadoFalso.flags`). Monta cada módulo con banderas apagadas y encendidas y atrapa el error de render con un Error Boundary. Atrapa errores de inicialización (TDZ, imports rotos, hooks mal ordenados) que tsc/eslint no ven; no prueba datos reales. Un módulo nuevo se agrega a `MODULOS`.
- **`VITE_BANXICO_TOKEN`**: quitado (nadie lo leía). Sigue en el historial de git: darlo de baja en Banxico.

## V00446 (rendimiento)
- **Causa medida** (`npm run medir:render`, V00435 vs V00445): `useSyncExternalStore` repinta de forma SÍNCRONA por cada aviso; con un aviso por catálogo (y otro por la confirmación del servidor) un módulo con 8–17 catálogos se repintaba 11–16 veces al abrir. Ahora: avisos agrupados (50 ms), la confirmación del servidor va fuera del estado publicado (`confirmado` en la entrada), módulos ocultos sin oyentes.
- **Catálogos permanentes en la sesión**: un listener abierto solo cobra cambios; cerrarlo a los 15 min obligaba a re-bajar la colección completa (más de 30 min sin escuchar = el servidor la manda toda). Se cierran en `reiniciarCatalogos` (cerrar sesión). `MINUTOS_PERMANENCIA` queda para claves no permanentes.
- **`obtenerCatalogo` rápido por omisión**: la decisión de la V00439 (esperar al servidor) se conserva SOLO donde se escribe con el catálogo (`{ fresco: true }`); con los catálogos permanentes, esa espera ocurre una vez por sesión.
- **Gracia de escucha (10 min)** separada de la visibilidad: `useModuloVivoActivo` = se ve ahora (buscador global, avisos); `useModuloEscuchando` = se ve o se ocultó hace poco (listeners). Costo: un módulo oculto sigue recibiendo cambios (y repintándose por sus propios listeners) hasta 10 min; antes de la V00438 era siempre.
- ~~PENDIENTE: `persistentMultipleTabManager`~~ → hecho en la V00447.

## V00447 (revisión de CSS, caché y rendimiento)
- **Banco de pruebas en navegador** (fuera del repo, en el scratchpad de la sesión): la app real compilada con Firebase SIMULADO (latencia de red, costo del SDK por documento en el hilo principal, caché IndexedDB "tibia", token de reanudación de 30 min) y Chromium; mide arranque y navegación de la V00435, la V00446 y la V00447 con los mismos datos (operaciones 25 mil, facturas 9 mil, empresas 2 mil…). Los milisegundos dependen de los supuestos; los documentos y las consultas en fila no.
- **CSS — clases repetidas entre archivos** (existía en la V00435): el codemod nombró las clases con las iniciales del archivo y 7 grupos compartían prefijo (`sc-x` Completados/Cancelados, `ed-x` Empresas/Empleados, `cd-x` Catálogos/Combustible/Contactos, `rd-x` Reportes/Remolques/Roles, `dd-x` Direcciones/Deducciones, `ud-x` Unidades/Usuarios, `fc-x` formularios de Combustible/Contacto). El CSS de un módulo se queda cargado al navegar, así que abrir uno desacomodaba al otro (la captura del panel de Filtros de Completados). Nuevos prefijos: `scc`, `emd`, `cbd`, `ctd`, `rld`, `rmd`, `ded`, `usd`, `fct`. `scripts/verificar-css.mjs` (en `npm run verificar`) falla si una clase `xx-xN` se define en dos archivos; mobile.css queda exento (corrige clases ajenas a propósito).
- **Arranque**: la V00437 abría la app hasta leer `usuarios/{uid}` del servidor y revisar la red de la oficina (2 consultas de roles EN FILA) y solo entonces empezaba a leer las banderas, que Operaciones espera antes de pedir la lista: 4–5 viajes al servidor en fila (la V00435: 1, en paralelo). Ahora: banderas al iniciar sesión; perfil desde la caché local (el listener del perfil propio lo confirma con el servidor y cierra la sesión si cambió); la revisión de la red corre en segundo plano cuando la caché sabe que ningún rol del usuario la exige (si un rol la exige, o los roles no están en la caché, se espera como antes); las dos consultas de roles van en paralelo. Medido: menú 802 → 198 ms, filas de Operaciones 1,624 → 1,186 ms (V00435: 595 / 1,475).
- **Multi-pestaña**: `persistentMultipleTabManager`. Riesgo conocido: coordina por localStorage y con la cuota llena el SDK se congela (V00109) → tope en `almacenSesion` + guardián al arrancar (que ya no borra filtros, columnas ni selección de Excel de Completados: solo `rango_`/`all_`).
- **Sin índices automáticos de la caché local** (V00446): no medidos, y el SDK los rellena en segundo plano ocupando su cola.
- **Gracia de escucha 10 → 30 min** y `siempreEscuchando` en Operaciones Activas (módulo de inicio, tarjetas de casetas y diésel): un listener reabierto antes de 30 min más solo cobra cambios.
- **Formulario de operación**: sus catálogos se abren en segundo plano 3 s después de pintar la lista de Operaciones (`precalentarCatalogosFormulario`, de uno en uno con `requestIdleCallback`). Son las mismas lecturas que abrir el formulario una vez en la sesión (V00435 releía ~11 mil documentos en CADA apertura). Medido: "Nueva operación" visible 780 → 32 ms (V00435: 1,979 ms). Costo: hasta ~0.4 s de hilo ocupado por catálogo grande mientras llegan (convenios detalle, direcciones).
- **`EditorOperacionEmbebido`** (abrir una operación desde Facturación o Pagos): ya no baja 17 catálogos con getDocs (~14 mil documentos cada 5 min y esperaba a todos); el formulario usa la capa compartida y solo recibe el tipo de cambio. Se borró `services/catalogosOperacion.ts`.
- **Descargas dobles**: Facturación (operaciones facturables, facturas, cruce de facturas de clientes) y Operaciones Activas tienen candado de "descarga en curso". En desarrollo React monta los efectos dos veces y cada pantalla bajaba todo dos veces (Facturación: 40 mil operaciones + 18 mil facturas); en producción pasaba si el efecto corría otra vez antes de terminar (cambio de pestaña).
- **Facturación**: `useMapaEstable` (src/shared/hooks) — el mapa id → nombre conserva su identidad mientras su contenido no cambie; un cambio de catálogo que no toca nombres ya no reordena ni refiltra 20 mil operaciones.
- **`.env` en git**: ya estaba versionado antes del refactor (con el token de Banxico, hoy fuera del archivo pero en el historial). Se deja versionado porque el build de producción lee la configuración de Firebase de ahí; `.gitignore` ya no lo ignora (solo `.env.*`). Si algún día hace falta un secreto, va en las variables del proyecto en Cloudflare y `.env` sale de git.
- **Lo que NO cambió y sigue pesando**: Facturación baja hasta 20 mil operaciones y todas las facturas al abrir (igual que la V00435, ~8.7 s en el banco de pruebas); se reduce al encender `consultasCanonicas` (Fase 7, requiere la migración P2).

## V00448 (Code Review de la V00447)
- **Rechazar en vez de `[]`** (`obtenerVivo`): el cambio de contrato se revisó con un análisis del árbol de llamadas (TypeScript AST, script fuera del repo): de 126 llamadas, 67 ya estaban dentro de try/`.catch`; de las demás, las que escriben quedan protegidas por su llamador (integridad, consecutivos, monedas, bodegas, nombres, peaje) y las que terminaban en un clic sin try eran los PDF/confirmaciones → `leerParaDocumento`. Solo dos lecturas de mostrar caen a vacío (nombres de status del tarifario, nombre de carga del formulario).
- **`moverOperacionFactura` idempotente**: el servidor compara el folio de las facturas de ORIGEN (`mismoFolio`, misma empresa); si todas lo tienen → `sinCambios` sin escribir; si la operación está repetida en dos facturas y una tiene el folio, esa es el destino y se quita de las demás. La web (bandera apagada) solo cubre el caso "todas lo tienen".
- **`SIEMPRE_ESCRITOS`** en `diferenciasCanonicas`: `fechaServicioISO` se escribe como `null` si falta (orderBy excluye documentos sin el campo). Costo: una escritura única por operación sin fecha (la hace la migración o el trigger).
- **Reglas**: no se pudieron correr aquí (`firebase emulators:exec` descarga el jar de storage.googleapis.com, bloqueado). Las pruebas nuevas van en `firebase-tests/firestore.rules.test.ts` y se corren en P1.
- **Reconciliación**: `--manuales <archivo>` (IDs confirmados por el negocio). Sin el archivo, los "totales manuales" solo se reportan.
- **PENDIENTE**: quitar referencia de un grupo fusionado (escribe el grupo completo, V00434); pago con facturas sin moneda reconocible mezclado con USD/MXN; filtro de moneda de Empresas con consultas canónicas; autor de la bitácora lo pone el navegador.

## V00449 (animación de espera y "Varios" en MTTO)
- **`CargandoDatos`** (`src/shared/components`): spinner + texto + barras animadas; `compacto` sin barras; `enLinea` solo el círculo (números de tarjetas). Se aplicó en 35 pantallas: textos sueltos "Cargando…" → componente, y HUECOS donde la pantalla mostraba el estado vacío mientras había una petición en curso. Causas encontradas: (1) la bandera de carga se encendía después de `await obtenerFlags()` (hasta 3 s en pestaña nueva: Completados, Cancelados, Resumen del día); (2) la encendía un efecto un pintado después del clic (Diésel, Nómina, Panel, Usuarios); (3) listeners sin bandera de "primera respuesta" (Pagos, Puentes, Diésel, Autorizaciones, Logs, Papelera, Catálogos, Tarifarios, Saldos de puentes, Nómina paginada → `listo` en `useNominasPaginadas`); (4) `cargandoJoin` de Estadísticas que nadie encendía. Cada bandera nueva se suelta también en el callback de error.
- **Riesgo conocido**: un `finally` que apaga la bandera hace que Buscar con el MISMO rango (Cancelados) muestre la animación un instante (re-monta la tabla). Aceptado: es una búsqueda explícita.
- **MTTO "Varios"**: `MTTO_VARIOS = 'Varios'` en `unidadId` y `operadorId`/`operadorNombre` (mismo trato que `'Oficina'`); las vistas ya muestran el valor crudo cuando no es un id. Las listas de Unidad/Operador se abren al enfocar (antes solo al escribir) y se cierran al salir del campo; el contenedor hace `preventDefault` en mousedown para no perder el clic.
- **No probado en datos reales**: el banco de pruebas (Firebase simulado, red lenta) confirmó Completados, Facturación, Pagos y el formulario de MTTO; el resto solo compila y pasa las pruebas.

## V00450 (REF Cliente duplicada → Revisión; comprobante de pago)
- **Detección en el cliente, sin servidor nuevo**: `detectarDuplicados` cruza la lista cargada con lo que devolvió `where('refCliente','in', variantes)`. Lo local manda (Ref recién cambiada); identidad por ID o, si no coincide, por consecutivo `ref` (registros viejos con campo `id` interno ≠ ID del documento: el ID real sale del servidor y es el que se escribe). Las variantes cubren mayúsculas/minúsculas/espacios/número; otras escrituras (p. ej. "Po 123" vs "PO 123" en dos operaciones no cargadas) solo se detectan si alguna está en la lista.
- **Costo acotado**: 5 min de vigencia por Ref y sesión, cola de 4 consultas, tope de 400 candidatas (las más recientes) por pantalla. El formulario se adelanta a la cola (`primero`) y ESPERA una consulta que ya venía en camino (antes devolvía vacío).
- **Facturación**: candidatas = no facturadas; `activo` espera también las facturas (sin ellas `esFacturada` puede decir "pendiente" por un instante). Mientras `activo` es false el hook no decide nada (evita sacar y regresar filas al recargar).
- **"No es duplicado"** escribe con `updateDoc` por operación (`allSettled`; si una falla, las demás quedan) y guarda la marca en la sesión (`marcaEnSesion`) para que la otra pantalla abierta también la saque de Revisión.
- **Avisos** (`src/shared/data/avisos.ts`): almacén con `useSyncExternalStore`; notificación solo por IDs nuevos en la sesión, agrupada (1.2 s); la campana lee `revisiones`; `irARevision` navega y pide la pestaña (la pantalla la atiende en un efecto, no en el render: avisa a App).
- **Code review (agente aparte) antes de entregar**: (1) caché del servidor sin refrescar al guardar → `operacionGuardadaEnRefs` escucha `operacionesBus` (avisos parciales sin `refCliente`/status se ignoran), `quitarOperacionDeRefs` al eliminar, `olvidarRefsConsultadas` en Actualizar/Refrescar, y las que están en Revisión se re-consultan cada 5 min; la lista entera entra a `detectarDuplicados` (las que no cuentan con clave '') para que su copia vieja del servidor no cuente; (2) "No es duplicado" devuelve `{hechas, fallidas}` y solo marca en la lista las hechas; (3) facturar/agregar se niegan con `bloqueoPorRevision` (en Revisión o `pendienteDeVerificar`); (4) variantes acumuladas por clave en la sesión + "PO 123" + espacio final; (5) identidad por ID y por folio solo si es único (folios repetidos de la numeración vieja); (6) `_docId` en la descarga vieja de Facturación; (7) `enRevision` estable por firma (Facturación filtra hasta 20k filas con él); (8) tope de 400 ordenado con `aFechaISO`; (9) formulario: la última consulta manda y una notificación por Ref; (10) marca de revisada del servidor también cuenta; (11) más rellenos; (12) arrastrar/soltar en todo el bloque del comprobante; (13) la promesa compartida se borra solo si sigue siendo la suya.
- **Comprobante**: URL local con `URL.createObjectURL` en `useMemo`; se libera en un `setTimeout` solo si ya nadie la usa (el doble montaje de StrictMode no la rompe). Las URL de Storage se muestran en `<iframe>` (no hay CSP en `_headers`).
- **PENDIENTE**: aviso a todos los usuarios (requiere Cloud Function); quitar un comprobante guardado.

## V00451 (facturas "pendientes"; carga de varios archivos en toda la app)
- **Facturar seguro (bandera apagada)**: `facturarSeguro.ts` pregunta al servidor antes de escribir (operación ya facturada: campos de la operación por `documentId in` + facturas por `operacionesIds array-contains-any`, ambos en lotes de 30; folio existente: `invoice in variantesFolio`). Se usa al facturar, al mover una operación a otro folio y al agregar una referencia. No es atómico (lectura y luego batch): la solución completa es la callable con `dineroPorServidor`.
- **Ids**: Facturación escribe la operación con `idRealOp` (`_docId`); la factura sigue guardando en `operacionesIds` el id de la lista (como siempre). El formulario de la operación sigue usando el id de la lista para documentos y avisos (la lista de documentos lo consulta con ese id) y el real para `updateDoc` y `renumerarOperacion`.
- **Total de una fila agrupada** (`totalDeFilaFactura`): por documento el manual; si no, `subtotalMonedaFactura` aunque sea 0 (los demás documentos de un grupo se guardan en 0 y conservan renglones); si no lo tiene, la regla de siempre. Una fila de un documento usa la regla de siempre. Tabla, Excel, resumen y editor usan el mismo.
- **`camposAjenos.ts`**: lista de campos que el formulario de la operación NO escribe (los mantienen Facturación, Nómina, Diésel, Puentes, Confirmación de tarifa, Revisión de Ref). Si un módulo nuevo escribe en `operaciones`, agrega sus campos ahí.
- **`operacionesBus`**: `campos` opcional = campos que cambiaron; quien ya tiene la operación aplica solo esos (`datosAAplicar`). `data` sigue trayendo la operación completa para quien no la tiene (Facturación la agrega a su lista).
- **Adjuntos** (`src/shared/archivos`): lista nueva + el PRIMER archivo en los campos de siempre (`camposDeArchivos`), porque el portal, la app móvil y la aprobación de tarifarios leen uno solo. `archivosDeDocumento` lee la lista o, si no hay, el campo de siempre (acepta listas de objetos o de URLs). La clave de un guardado es su URL (repetidas: clave nueva).
- **Documentos de factura en grupos**: la lista completa se guarda en el primer documento del grupo; los demás que tenían archivos quedan con `docsFactura: []` y el PRIMER archivo en `docFacturaUrl` (portal). Al borrar un documento con archivos (quitar/mover operación, quitar referencia) sus archivos pasan a otro documento del mismo folio (`rescatarDocsDeBorradas`, lectura fresca).
- **Expedientes**: un documento de `documentos` por archivo; el id canónico (`col__registro__tipo`) solo si está libre (transacción); los demás `__<sello>_<i>` y "Tipo (n)" siguiendo el número más alto (como la Carga Masiva). Los slots del formulario de la operación usan lo mismo (antes el primero pisaba). Storage: nombre único; un archivo se borra solo si NINGÚN documento lo usa (`where('path','==',…)`; si no se puede saber, no se borra).
- **Storage sin limpiar**: quitar/reemplazar un archivo en facturas, pagos, tarifarios, MTTO, diésel y herramientas no borra el archivo viejo (no hay forma barata de saber si otro registro lo usa). Pendiente si el espacio importa.
- **`useUrlArchivo`** crea la URL en `useMemo`: un render descartado (StrictMode en desarrollo) deja una URL sin liberar. Aceptado.
- **No escritos más**: `tienePdfDoda`/`cantPdfsEntrys` (nadie los lee en web ni functions; se reiniciaban mal al editar). Si Roelca Móvil los usara, quedan con su último valor.
- **PENDIENTE**: búsqueda de folio sin importar mayúsculas en el servidor (campo normalizado escrito por functions); portal con todos los documentos de la factura.

## V00452 (Pagos: "Registrar Pago" al instante)
- **Facturas de Pagos en vivo** (`features/pagos/hooks/useFacturasPagables.ts`): listener compartido por colección; se activa cuando ya se ve la lista de pagos (o al abrir el modal/edición). Antes: descarga completa por cursor en CADA apertura. Trade-off de lecturas documentado en CAMBIOS-V00452 (entrar a Pagos solo a mirar también descarga; quien registra lee mucho menos).
- **`avisarConfirmacion`** (`coleccionesVivas.ts`): la confirmación del servidor SIN cambios no se publicaba (V00446, para no repintar catálogos); una vista que decide con "al día" (Guardar Pago) la pide y se publica una vez (también si ya había llegado antes de suscribirse). `reintentarVivo(clave)` reabre un listener muerto por error.
- **Sin parches locales** de la lista de facturas en Pagos: las escrituras (batch/transacción) llegan por el listener (compensación de latencia del SDK); las callables (con `dineroPorServidor`) tardan lo que tarde el servidor en avisar.
- **Selección contra la lista en vivo**: al guardar, lo elegido que ya no tiene saldo se quita y lo capturado por encima del saldo nuevo se ajusta, con aviso (antes la lista estaba congelada y la transacción abortaba). La transacción sigue siendo la protección real.
- **Moneda de empresa** por índice (`crearMonedaEmpresa`): mismo resultado que el `find` viejo salvo valores no-texto falsy (0/false) en id/nombre.
- **Carga perezosa**: xlsx y html2pdf con `import()`; `HiloModal`/`EditorOperacionEmbebido` con `lazyWithRetry` + `Suspense`. `pdfGenerator` ya no mete html2pdf en la carga inicial (lo importaba Login por `LOGO_DEFAULT`). Otros generadores de PDF (remisión, tarifario, diésel…) siguen con import estático: van en módulos perezosos y cargan el PDF al abrir esos módulos; candidato a cambiar después.
- **PENDIENTE**: Pagos no está en MantenerVivo (al volver se re-monta; los datos ya no se re-descargan por la permanencia de 15 min).


## V00453 (app móvil: historial y pagos del operador; historial completo del cliente; Usuarios)
- **portalCliente `historial`** (portal-v2): rango {desde, hasta} AAAA-MM-DD, máx. 93 días, 600 operaciones por empresa (`truncado`). Consulta `empresasIds array-contains E` + rango de `fechaServicioISO` (índice que YA existía); como `empresasIds` incluye todos los papeles (proveedor, origen…), se filtra en memoria a Cliente (Paga)/(Mercancía). Sin índice: `clientePaga|clienteMercancia == E` + `fechaServicio` texto (índices del resumen). Operaciones migradas sin `fechaServicioISO` ni fecha ISO solo aparecen por el respaldo.
- **Papel por ID canónico**: `pagaLa`/`mercanciaDe` aceptan `clientePagaId`/`clienteMercanciaId` (operaciones de AppSheet con el NOMBRE en `clientePaga`). Afecta resumen, detalle (`suya`) e historial: un cliente puede ver una operación suya que antes no veía por tener el nombre en vez del id. No abre nada ajeno: el id canónico es de la misma empresa.
- **Operador en la app (lee Firestore directo, es "personal")**: historial = `operaciones where operador == id orderBy fechaServicioISO desc` de 30 en 30; semana = mismo filtro con rango lunes–domingo en vivo; nóminas = `referencias_nomina where operadorId in ids` ∪ `operadorNombre in [nombre + apellido paterno, nombre completo]` (mismo criterio que `obtenerHistorialOperador`). Índice NUEVO `operaciones(operador ASC, fechaServicioISO DESC)` en `firestore.indexes.json` (sin publicar: la app cae a la consulta simple por operador). Las fórmulas del recibo y del sueldo por operación son puerto de `ReferenciasNominaDashboard` (`calcularTotalAPagar`, `reconstruirTotales`, `sueldoBaseDeOp`) en `roelca-movil/src/features/operador/pago.ts`: si cambian aquí, replicar allá.
- **Usuarios**: "📱 Nuevo acceso de cliente" es el MISMO formulario con la casilla de cliente ya marcada (no hay otro camino de alta). Filtro Todos/Personal/Clientes por `tipoUsuario` (sin lecturas nuevas: la lista ya estaba en vivo).
- **Prueba preexistente que falla en este árbol**: `scripts/sincronizar-dominio.test.mjs` (functions/src/dominio vs src/shared/dominio, 13 archivos) — no se tocó `src/shared/dominio`; parece venir de los finales de línea del árbol de Windows. Correr `node scripts/sincronizar-dominio.mjs` en la máquina de Omaf.

## V00454 (Referencias de Puentes: el puente elegido manda)
- **Regla única del grupo**: `grupoDeNombresPuente` (`src/utils/historialCalculadoPuentes.ts`) = por el NOMBRE del puente que tiene la operación (caseta + piso): Colombia → PTC, AVI → AVI, lo demás → PT3. La usan `grupoPuenteOp` (tablero), `filaDeOperacion` y `grupoDeFila`; deben coincidir, porque `upsertReferenciaAuto` descarta en silencio la fila cuyo grupo no es el de la referencia.
- **Se revierte el V00416 para operaciones CON puente**: el convenio/aduana Colombia ya no manda a PTC ni recalcula a Colombia una operación que tiene otro puente (elegido o cobrado). Sigue para las que aún NO tienen puente (se calculan con `cobroPuenteDeOperacion`, aduana Colombia → caseta + puente de Colombia). Desde la V00416 el cobro automático ya elige Colombia para aduana Colombia, así que las diferencias solo vienen de un cambio a mano (o de datos anteriores al 2/oct, que ahora se respetan).
- **`saldoPuenteManual: true`** en la operación al cambiar el puente desde la tabla (campo nuevo; las reglas lo permiten, ningún trigger lo lee). "Asignar monto del puente" no toca esas operaciones. Los cobros automáticos (web, servidor) ya no cobran si existe `saldoPuente`, así que tampoco lo pisan.
- **Asignar monto del puente**: solo las que no tienen puente y las de caseta de Colombia sin el Puente Mx Colombia. Antes también agregaba el Puente Mx Colombia a cualquier caseta con aduana Colombia (p. ej. Caseta AVI elegida → "Caseta AVI + Puente Mx Colombia" → PTC).
- Se quitaron el `confirm` del cambio de puente, el aviso "Debe ser Colombia" y el conteo "de Colombia por corregir". El aviso "Otro puente" del detalle de una referencia queda, pero solo por el puente de la fila.
- **PENDIENTE (anterior a esta versión)**: una operación SIN puente se agrupa en el modal por su convenio (Colombia → PTC, si no PT3); si al enviarla se calcula otro puente (p. ej. AVI por importación), `upsertReferenciaAuto` la descarta sin avisar y se queda en "sin asignar". Usar "Asignar monto del puente" antes de enviar lo evita.

## V00455 (tarjetas de Operaciones Activas)
- **Un solo formulario de saldo de puente**: `features/puentes/components/ModalAgregarSaldoPuente.tsx` (+ `services/saldosPuentes.ts` para el alta y `services/puentesCatalogo.ts` para lista, nombre, moneda y caseta por tarjeta). Lo usan la pestaña Saldo de Referencias de Puentes y "Actualizar saldo" de las tarjetas. Antes la tarjeta tenía su propio modal (V00360/V00398: con "Saldo pendiente" y "Total", sin `registradoPor`); se quitó por pedido ("debe aparecer el formulario de Referencias de Puentes"). El registro ahora siempre lleva `registradoPor` y `puenteId` = `p.id` del catálogo, como el módulo (la tarjeta escribía `idReal`; solo difieren si el documento guarda un campo `id` propio, y la tarjeta reconoce el saldo también por `puenteNombre`).
- **Caseta elegida por tarjeta**: AVI → "Caseta AVI", Puente III → "Caseta Puente III" (o "Caseta Puente 3"), Colombia → "Caseta Mx Colombia". Si el catálogo no la tiene, el formulario abre sin puente. La lista muestra TODOS los puentes (como el módulo), no solo los de la tarjeta.
- **Movimientos del saldo** (`features/operaciones/services/movimientosPuente.ts`, modal `ModalMovimientosPuente`): con los datos que la tarjeta YA escucha (saldos_puentes, referencias_puentes_auto, otros cruces): cero lecturas nuevas. Cada referencia cuenta solo las filas/partes de ese puente (igual que la pestaña Saldo y la cifra de la tarjeta). Incluye los saldos agregados (+) aunque la imagen pedida era el Historial: son los otros movimientos del saldo. Rango por defecto: últimos 30 días.
- **Toda la tarjeta es un botón** (`.tcas-card-abrir` absoluto debajo del contenido; el contenido no recibe clics salvo sus botones). Sin `div onClick`.
- Modales con `createPortal` a `document.body` (la tarjeta usa `transform` al pasar el mouse) y perezosos desde la tarjeta (`lazyWithRetry`): la carga inicial crece 0.3 KB (sin eso, ~20 KB por FormularioConfigurable).
- Se quitaron las reglas `.rd-dos*` de App.css (solo las usaba la tarjeta TC · Diesel).

## V00479 (Análisis de Clientes)
- Omaf (23-oct) mandó capturas de una investigación del cliente ("Qué está cambiando" y la tabla Cliente Paga con su ficha) y pidió el dashboard en la app, con los nombres clicables que muestren sus operaciones de la más reciente a la primera. **No se pudo abrir la investigación**: el artefacto es de otra organización y desde aquí no hay salida a esa página (ENOTFOUND), y el chat compartido llega vacío. Las reglas se armaron con las capturas y cuadran con sus números:
  - Bajando ≤ −20% (A. Castañeda −22%) y Estable hasta −19% (Viskoteepak, Landstar −16%);
  - Creciendo ≥ +20% (Transplace +9% estable);
  - Inactivo con 21 días o más sin operar (Esguard, última 29 sep, sale inactivo; con 28 días no saldría);
  - Nuevo si su primera operación del año fue en los últimos 183 días (Meta In "desde 24 abr" entra justo);
  - Ocasional con menos de 20 operaciones ("Clientes con 20 o más operaciones" en la captura).
  Si la investigación usó otras, se cambian en `REGLAS` (`services/analisisClientes.ts`) y la pantalla se explica sola con ese objeto.
- Definiciones propias (no se veían en las capturas):
  - **% de días que opera:** ÷ días de lunes a sábado desde su primera operación; la captura daba 98% a C.H. Robinson con 256 días y no se pudo deducir el denominador;
  - **Días hábiles sin operar:** de lunes a viernes;
  - **Pausa más larga:** días seguidos sin operar entre dos operaciones;
  - **Ops/sem antes:** desde su primera operación del año, no desde el 1 de enero, para que un cliente que empezó en marzo no salga "creciendo";
  - **Hazmat y vacíos:** por el texto de carga y convenio (como Diésel).
- Datos: UNA lectura por rango (fechaServicioISO con `consultasCanonicas`, si no fechaServicio, como Estadísticas), guardada con TanStack Query 10 min. Un año ≈ 8,600 operaciones = 8,600 lecturas por cada vez que se abre o se presiona Actualizar. Si pesa, el siguiente paso es un resumen por cliente y semana calculado en el servidor.
- Los clientes se agrupan por ID (clientePaga / clienteMercancia) con el nombre ACTUAL del catálogo de empresas. Los duplicados de empresas salen como clientes separados (de ahí la V00478). Sin ID se agrupa por nombre.
- La ventana de operaciones muestra las del año ya leídas (sin lecturas nuevas). No abre la ficha de la operación: los módulos vivos leen `roelca_abrir_registro` solo al montarse.
- Permiso nuevo `analisisClientes` ('Análisis de Clientes' en Roles → General). Admin lo ve siempre.

## V00478 (Empresas: duplicados por nombre y unir desde el grupo)
- Omaf (23-oct): "en la hoja de empresas necesito la facilidad y la posibilidad de identificar duplicados en nombre para limpiar el app". Ya existía *Duplicadas*: nombre idéntico sin acentos/signos, mismo RFC y primera+última palabra, con un getDocs propio y sin unir desde ahí ("elimina el otro desde la tabla").
- `services/duplicadosEmpresas.ts` (puro, con pruebas): sin forma legal al final (SA de CV, S de RL de CV, LLC, Inc, Ltd, Corp, Co…), sin espacios (C.H. = CH), errores de escritura (1 letra; 2 desde 20 letras), mismas palabras en otro orden, una palabra de más con la misma primera palabra, mismo RFC (no el genérico). **Números distintos nunca son parecidos** (Planta 5 / Planta 6; en el banco de pruebas, "Empresa 1" / "Empresa 11" daban 2,000 falsos).
- La regla vieja "primera + última palabra" se cambió por "una palabra de más": juntaba "Transportes Morales Valdez" con "Transportes Garcia Valdez".
- Para no comparar todas contra todas: solo dentro de bloques (mismas 4 primeras letras, 4 últimas o primera palabra; un bloque de más de 400 se salta). Unión-búsqueda: si A≈B y B≈C es un solo grupo.
- Los grupos salen EN VIVO del catálogo `empresas` (useCatalogo): al unir, el grupo desaparece solo y ya no hay getDocs propio. Los ids son `e.id`, como la selección de la tabla y el modal Unir.
- Unir: `abrirUnirCon(ids)` (tabla o grupo). Por omisión se conserva el de MÁS operaciones (antes: más campos llenos, que sigue como desempate). El duplicado se borra por `idReal` (antes `e.id`: con un campo `id` de AppSheet distinto al del documento, el borrado no hacía nada).
- No se guarda "no son duplicados": un grupo que no lo es sigue apareciendo (se desmarca y no se une). Si molesta, guardar la marca en la empresa.

## V00477 (Operaciones: activas, completadas y canceladas con pestañas)
- Omaf (23-oct): "las operaciones activas, completadas y canceladas estén todas en un mismo lugar, pero dividido en pestañas".
- NO se fusionó el código de los tres módulos (CLAUDE.md: fusionar dos funcionalidades que funcionan es decisión de producto): siguen siendo `operaciones`, `serviciosCompletados` y `serviciosCancelados`, con sus permisos, `?modulo=`, buscador global y MantenerVivo. Lo nuevo es el menú (un solo ítem) y `PestanasOperaciones` arriba, que solo navega entre ellos.
- El menú lleva a la pestaña que ya se ve o a la primera permitida (`pestanaDeEntrada`). Con una sola pestaña permitida no se pinta la barra.
- La barra móvil inferior (`modulosNavMovil.ts`) conserva sus accesos directos a Completados y Cancelados.
- El panel de Filtros que Completados/Cancelados abren al entrar tapa también las pestañas (su fondo es `position: fixed` a toda la pantalla, como el menú): hay que cerrarlo para cambiar de pestaña. Subir la barra sobre ese fondo la ponía encima de la barra superior fija en el celular.
- Etiquetas: `menu.operaciones` reemplaza a `menu.operaciones_activas`, `menu.servicios_completados` y `menu.servicios_cancelados` en el catálogo de Personalizar Etiquetas.

## V00476 (regresar el estatus de una operación completada o en Falso)
- Omaf (22-oct, captura de la ficha de TR-221026-011 en 7. Falso): "necesito la posibilidad de regresarlo a cualquier status anterior después de haberse completado o enviado a falso".
- "Cualquier status anterior" = los estatus del flujo de la operación (`obtenerNombresStatusDelFlujo`, en orden), sin el actual ni Cancelado (cancelar tiene su propio camino con confirmación). Se incluyen Completado/Falso para corregir uno por otro. Sin flujo: los de la bitácora; sin bitácora: el catálogo.
- Hace lo mismo que marcar ese estatus en Activas → Registrar movimiento: horario en la bitácora, sueldo de Falso (`ajusteSueldoPorStatus`), puente si el estatus lo cobra y aún no se cobró (sin la bandera lo escribe la web; con ella, el servidor), ventana del cruce y Verde automático. Sin cascada (se elige el estatus exacto).
- Va en `runTransaction`: el sueldo es dinero y la lista de Completados puede estar vieja. Si el estatus en la base ya no es el que se ve, no escribe y lo dice.
- El horario lleva `regreso: true`, `statusAnterior`, `statusAnteriorNombre`. Las bitácoras de Activas y Completados lo marcan.
- Facturas, nómina y diésel ya ligados NO se tocan: la ventana lo avisa. Si se quiere bloquear el regreso de una operación facturada o con nómina pagada, es una regla nueva en `efectosDelRegreso`/el botón.
- Sin permiso propio: el botón aparece para quien abre la ficha (igual que Editar). Si se quiere limitar, se agrega a "Permisos Especiales" como `editarTarifaOrigenDestino`.
- Operaciones Activas no tiene listener (páginas): la operación entra por `operacionesBus` (origen `regreso-status`). Si Activas no estaba montado, la lee al abrir.
- Se quitó de `ServiciosCompletados` el registro manual de estatus que estaba muerto desde la V00365 (`abrirRegistroHorario`, `guardarHorario`, `registrarStatusRapido`, modal "Registrar Movimiento", la carga de botones del flujo en cada ficha).

## V00475 (ventana del reporte de puente: el Excel con las referencias de cada unidad y día)
- Omaf (22-oct): "al cargar cualquiera de los excel de los puentes se abra un modal, con la información del excel y las referencias que coincidan en unidad y fecha". La ventana ya se abría (V00466), pero solo mostraba las operaciones de Operaciones sin asignar que coincidían, y el Excel quedaba plegado.
- "Referencias" se mostró de las dos formas que usa la app:
  - la referencia de la operación (TR-…);
  - si ya está en el Acumulado, el consecutivo de la referencia del puente (AVI-/PT3-/PTC-…).
- Solo se pueden enviar al Acumulado las que coinciden y están por asignar (la regla de V00466 no cambia); las demás se muestran para revisar.
- La búsqueda sigue sobre las operaciones que ya trae el módulo (las 2,500 más recientes por fechaServicio). Para días más viejos sale el aviso de rango de siempre.

## V00474 (los movimientos no llevan aduana)
- Omaf (22-oct, captura de la lista): "los movimientos no tienen aduana, quita esa opción". Un movimiento se reconoce porque su tráfico contiene "movimiento" (catálogo de tráfico: Movimiento LDO, Movimiento NLD), con la misma normalización del resto (`normPuente`). La regla es `flujoLlevaAduana`: Transfer y tráfico que no es movimiento.

## V00473 (eliminar flujos; puente elegido por paso)
- Omaf (22-oct):
  - "poder eliminar reglas de estatus" → el flujo completo, con `eliminarRegistro` (Papelera + nota + Autorizaciones). `config_flujos_operacion` no está en `COLECCIONES_NO_BORRABLES`;
  - "poder editar y seleccionar el puente, que no sea estático" → el nodo guarda `puenteCaseta` / `puentePiso` = `{ gastoId, monto | null }`. Solo el id y el monto cambiado: el nombre y la moneda se leen del catálogo al cobrar, así un cambio de nombre o de moneda en Tipos de Gastos llega solo.
- Prioridad: tarifa del convenio → elegido → Colombia/tráfico. Omaf contestó el 21-oct "La de la tarifa" a "¿cuál manda?". Si quiere que el elegido gane a la tarifa, es cambiar el orden en `casetaPrevista`.
- Un flujo general (sin aduana) también lo usan las operaciones de Colombia sin flujo propio. Su caseta elegida (pensada para Nuevo Laredo) no se les aplica (`reglaAplica`). El piso elegido solo cuenta en un flujo de aduana Colombia.
- El puente elegido solo cuenta en el nodo con 🌉 (`reglaPuenteDelPaso`): en los Verde por omisión no hay nodo marcado, y el panel lo deja informativo.

## V00472 (Reglas de Estatus: cambiar la aduana conserva los pasos)
- Omaf (21-oct): "cuando cambio la aduana, se quita lo que tenía guardado. Pero es el mismo proceso, solo lo estoy actualizando".
- El lienzo se vaciaba en la carga de la combinación nueva (sin documento): el confirm de la V00111 con Cancelar, o un navegador que no muestra confirm, lo dejaba en blanco. No se borraba nada en Firestore.
- Ahora se conserva siempre y un aviso lo dice. Con documento se abre el guardado (sin cambio).
- El confirm de borrar el anterior se queda (Cancelar conserva ambos): un flujo general que se borra deja sin flujo a las otras aduanas, por eso el aviso extra.

## V00471 (ventana al cruzar el puente; aduana en el formulario)
- Pedido de Omaf (21-oct):
  - aduana debajo de Cargada/Vacía;
  - "por defecto el puente que fue agregado en las reglas de Estatus";
  - al marcar Verde o el estatus con el puente, un pop-up: "Esta unidad cruzó el puente (nombre). Se envió el cobro a operaciones sin asignar por el monto de (monto)".
- Se le preguntó, y contestó:
  - la tarjeta sigue apareciendo desde la unidad;
  - si la tarifa trae su caseta, manda la tarifa.
  "El puente de Reglas de Estatus" queda entonces como el respaldo de siempre (Colombia / tráfico), etiquetado así, más el estatus en que se cobra.
- La ventana usa el estado de `avisos.ts` (mismo `AvisosFlotantes`), para no hacer otro sistema de avisos (V00450). Una a la vez; si llegan dos, la segunda sale al cerrar la primera.
- La ventana se calcula con `cobroPuenteDelPaso`, también con la bandera encendida (entonces la web no escribe: lo hace el servidor con la misma regla). Si el servidor ya cobró por otro lado, el formulario lo ve al releer el documento y no abre la ventana; en Operaciones Activas la copia de la ficha decide.
- El campo Aduana del formulario solo en Transfer, por consistencia con Reglas de Estatus (V00470). Para Logística de Cruces se cambia con `isTransfer`.
- Pendiente de decidir: el puente cambiado a mano en el formulario (`puenteId`) no es el que se cobra (el cobro sale de la regla). Así está desde la V00355.

## V00470 (Reglas de Estatus: costo del puente en el paso; aduana solo en Transfer)
- Pedido de Omaf (21-oct, captura del panel "Saldo del puente"): "que se agregue directamente la tarifa y aparezca el costo, pero informativamente; si es Colombia, la caseta y el puente (dos campos)". También: "la aduana solo se debe mostrar en los Transfer".
- El flujo no tiene convenio, así que el costo es el del catálogo Tipos de Gastos, con la regla de respaldo del cobro (Colombia → caseta + piso; tráfico → AVI / Puente III). La caseta de los Gastos Incluidos de la tarifa del convenio gana en el cobro real; el panel lo dice.
- Se muestra solo en el paso que cobra: el marcado con 🌉 o, si el flujo no tiene ninguno, en los Verde (misma regla que `descuentaPuenteSegunFlujo` + `disparoCobroPuente`).
- Un flujo de Transfer sin aduana también lo usan las operaciones de Colombia que no tienen flujo propio: por eso la línea "Si la operación es de aduana Colombia…".
- Aduana fuera de Transfer: el selector se oculta, el handler del servicio la borra y `aduanaFlujo` la ignora en el id y al guardar (un flujo viejo guardado con aduana en otro servicio se vuelve a guardar sin ella, y se ofrece borrar el anterior como en cualquier cambio de combinación).

## V00469 (Reglas de Estatus por aduana; revisión del cobro de puentes)
- Pedido de Omaf (21-oct, captura del Editor de Flujos): "agrega la aduana en el configurador de status, al lado de CARGA".
  - El flujo por aduana es `Servicio_Tráfico_Carga_Aduana` con el campo `aduana`; sin aduana el id no cambia (los flujos guardados siguen igual).
  - `buscarFlujo` (web y servidor) y `buildConfigId` (formulario) prueban primero los flujos de la aduana de la operación y luego los generales; un flujo de OTRA aduana nunca se usa.
  - La aduana de la operación es `aduanaNombre` (servidor, V00258). En el formulario, con un convenio nuevo, sale del nombre del convenio o de su tarifa (`aduanaForm`).
  - Roelca Móvil (repo aparte) arma su flujo con el id general: no ve los flujos por aduana.
- Pedido: "revisa la lógica de los puentes". Se revisaron los tres caminos de cobro (formulario, Operaciones Activas, servidor), el Acumulado y las tarjetas. Se corrigió lo que no pedía una decisión:
  - **0 bloqueaba:** `Number.isFinite(saldoPuente)` tomaba 0, '' y null como cobrado. La tarifa por tráfico con importe 0 escribía 0 y ya nunca se cobraba, aunque Referencias de Puentes sí la veía "sin monto". Ahora `puenteYaCobrado` = > 0 o `saldoPuenteManual`, y no se cobra en 0. Ningún camino escribía 0 a propósito: se revisaron todos con grep.
  - **Cascada:** solo se evaluaba el último estatus. En el servidor, los horarios se leen solo si el estatus final es `automatico` en el flujo (sin eso no hay cascada posible) y no cobra, para no sumar una lectura en cada cambio de estatus.
  - **Formulario:**
    - guardaba los `saldoPuente…` de su copia: deshacía un cambio de Referencias de Puentes, o pasaba los de otra operación en un formulario minimizado. Ahora son campos ajenos (`camposAjenos.ts`);
    - el cobro propio va aparte y se confirma con un `getDoc` antes de escribir (solo cuando hay cobro);
    - su copia de la regla se quitó: no tenía el filtro de Colombia (V00416), leía solo `tarifaBaseId` y usaba "hoy" en UTC.
  - **Operaciones Activas:** misma regla compartida. Sin el `getDoc` por clic: los catálogos vienen de `cargarCtxCobroPuente()`, que espera al servidor (`fresco`).
  - **Enviar al Acumulado:** el grupo previsto (`grupoPuenteOp || 'PT3'`) no siempre era el de la fila, y `upsertReferenciaAuto` descartaba las filas de otro grupo sin aviso. Si la referencia no existía, la creaba vacía. Ahora se agrupa por el grupo de la fila.
  - **Tarjetas de casetas:** `grupoDePuente` devolvía null para nombres desconocidos; `grupoDeNombresPuente` los manda a PT3.
- Una revisión aparte del cambio encontró, y se corrigió:
  - el servidor solo miraba los pasos anteriores si el final NO cobraba: Verde MX → Completado automático cobraba en Completado (fecha de servicio), o nada sin tráfico. Ahora se prueban todos en orden;
  - un horario de cascada viejo podía reutilizarse: ahora tiene que ser el último horario de la operación y de menos de 30 min;
  - el formulario cobraba en cualquier guardado (con 0 ya no bloqueando, más operaciones). Ahora sigue la regla del servidor (`cambioStatus` o `CAMPOS_QUE_DECIDEN_PUENTE`);
  - Saldos de Puentes seguía con `Number.isFinite`;
  - fechas d/m/aaaa en Referencias (id con "/");
  - el aviso del bus sin el cobro nuevo (Servicios Completados ahora copia `saldoPuente…` del aviso).
- Decisiones abiertas (en CAMBIOS-V00469.md):
  - la operación queda en $0 al enviarla al Acumulado sin puente;
  - el módulo viejo Saldos de Puentes;
  - subtotales con monedas mezcladas y lo que cuenta "Hoy";
  - el `orderBy('fechaServicio')` de la lista de Referencias (formatos mezclados; necesita índice para pasar a `fechaServicioISO`);
  - tope de 1,000 y sin transacción en el Acumulado.
- Se revisó que coinciden: las reglas de caseta, piso y moneda del servidor y del tablero; que el flujo lo busca la misma función; que no hay doble cobro entre servidor y tablero (con la bandera, la web devuelve {}); y que tarjetas, Saldo y movimientos leen las mismas fuentes.

## V00468 (Aduana: solo cruces de importación y exportación)
- Omaf (21-oct, captura del desglose Aduana → C/V → Exp/Imp/Mov): "en esta lista no se muestran movimientos, solo los cruces de importación y exportación". Se leyó como regla para la lista de Aduana.
- `esCruceOp` = línea Transfer o Logística (`lineaDeOp`; Fletes no) Y movimiento Importación o Exportación (`movimientoDeOp`, el mismo criterio de la dimensión Exp/Imp/Mov de la pantalla; la clasificación manual manda).
- `DesgloseJerarquico.soloPara[dim]`: con esa dimensión como RAÍZ solo entran las operaciones del filtro y se muestra la nota. Como sub-nivel no se filtra (los totales del padre no cambiarían), y lo que no cruza sale "No cruza".
- `norm`, `textoDeOp` y `movimientoDeOp` pasaron a nivel de módulo (son puros) para que el filtro sea estable entre renders. Con eso dos `eslint-disable exhaustive-deps` quedaron sin uso y se quitaron.

## V00467 (Estadísticas por Aduana; reportes de Puente 3 y Puente Colombia)
- Pedido de Omaf (21-oct, mensaje de Facturación): un filtro más en Estadísticas, "por qué aduana cruzó (Transfer y Logística)". Se agregó como dimensión del Desglose (`aduana`). La etiqueta se toma así:
  - `aduanaNombre` de la operación, que mantiene el servidor desde el convenio (V00258);
  - si falta, `aduana`/`aduanaId` contra el catálogo;
  - si falta, `aduanaDeOperacionCtx` (convenio → tarifa → aduana).
  Los catálogos de convenio, tarifa y aduana solo se escuchan con el Desglose a la vista.
- Reportes de puente (los dos Excel de muestra):
  - Puente 3: REPORTE_PUENTE_240, estado de cuenta de "Puente del Comercio Mundial". Hoja PVentaEdoCta con Fecha (serie, solo día) + Hora + Folio Tarjeta (hex de 16, rellenado con ceros) + Importe + T. Movimiento. Una segunda hoja (Hoja1) trae los mismos datos desde el 30-abr con columnas dispersas.
  - Colombia: REPORTE_PUENTE_800 con Fecha (serie con hora) + Tag (numérico) + #Económico (= número de la unidad) + Importe Trans. + Descuento % + Importe Total.
- El formato se reconoce por el encabezado (Folio Tarjeta → Puente 3; #Económico o Importe Total → Colombia; Transaction Date / Tag # → AVI). Se leen todas las hojas de ese puente y un cobro igual (fecha, hora, tag, monto) no se repite.
- Colombia cobra DOS veces por cruce (puente 100→90 y caseta 144→129.60, con 10% de descuento):
  - casi siempre a ≤10 min, pero a veces hasta 4 h 20 (la fila); también pasando la medianoche;
  - `unirCruces` une dos cobros seguidos del mismo tag con montos distintos y ≤ 300 min;
  - en los 380 cobros de la muestra quedaron 2 sueltos.
  Del lado de la operación, el monto comparado es caseta + piso.
- Tag por puente: Puente 3 se compara en mayúsculas y sin los ceros de relleno del final (9D1A330000000000 = 9D1A33); AVI y Colombia, solo dígitos y sin ceros a la izquierda. Colombia de respaldo por # económico (dígitos del nombre de la unidad), con aviso.
- Emparejamiento: las operaciones de OTRO puente (con monto) van al final (+1,000,000 en la distancia) y con aviso, para que un cruce de Puente 3 no se quede con la operación AVI de la misma unidad ese día.
- Los nombres de archivo `reporteAvi.ts` y `PanelReporteAvi.tsx` se quedaron (ya sirven para los tres puentes) para no pedir `git rm`.

## V00466 (reporte AVI: solo Operaciones sin asignar, en una ventana)
- Pedido de Omaf (20-oct), con captura de 226 cruces: 91 salían "Ya está en el Acumulado". Pidió tres cosas:
  - buscar solo en Operaciones sin asignar;
  - abrir un modal con las que coinciden;
  - no mostrar el lugar (todo el reporte es del AVI).
- Las candidatas siguen la regla de la tabla "Operaciones sin asignar": Transfer o Logística Roelca, completada, de importación o exportación, fuera del Acumulado y no de prueba. No se aplican los filtros de puente y unidad.
- `coincidirCruces` ya no tiene los estados enAcumulado, noCompletada ni otroTrafico. Las demás operaciones de la unidad ese día no se emparejan, pero llegan en `otrasDelDia` y se avisan en cada cruce ("también tiene ese día: TR-… (en el Acumulado)").
- El riesgo que cubre el aviso: con un solo cruce, una operación en el Acumulado y otra sin asignar, el cruce queda con la sin asignar. Puede ser el de la otra, y entonces se pagaría dos veces. El usuario decide con el check.
- Ventana: guarda las DESMARCADAS, no las marcadas. Así, si la coincidencia cambia cuando llegan las horas de Verde, lo nuevo entra marcado. Mientras falten horas sale CargandoDatos.
  - "Enviar al Acumulado" deja esas como seleccionadas y abre la ventana de siempre;
  - "Solo marcar en la tabla" solo las selecciona;
  - Esc o ✕ cierra la ventana y deja el reporte cargado (botón "Coincidencias AVI (N)").
- Se quitó la columna `lugar` (LOCATION): ni se lee ni se exporta.

## V00465 (puente por convenio al poner la unidad, TAG por puente, checks del Acumulado)
- Pedido de Omaf (20-oct): checks disparejos en el Acumulado; el TAG que corresponde según el puente en la ficha; en el formulario, al poner la unidad, habilitar el puente que toca por el convenio y la tarifa.
- Una sola regla para "qué caseta le toca": `casetaPrevista` en `shared/dominio/cobroPuente.ts`. La usan el formulario (para preelegir) y `cobroAlCambiarStatus` (el cobro del servidor). El resultado de `cobroAlCambiarStatus` no cambió: las pruebas de siempre siguen en verde.
- Hallazgo: los detalles de convenio guardan la tarifa en `tipoConvenioId` (Convenios de Clientes, triggers de `relacional.ts`). La regla pura, el contexto del servidor (`puentesYDiesel.ts`), `aduanaDeConvenio` y `casetaDeGastosSP` solo leían `tarifaBaseId`; el formulario sí leía `tipoConvenioId`. Con un detalle sin `tarifaBaseId`:
  - no se encontraban la caseta de la tarifa ni la aduana Colombia;
  - el cobro caía al tráfico (Caseta AVI / Puente III del catálogo).
  Ahora `tarifaDeDetalleConvenio` lee primero `tarifaBaseId` (nada cambia donde existe) y luego `tipoConvenioId` y las variantes. Requiere desplegar `functions:operacionEscrita`.
- Pendiente: `camposSaldoPuenteBase` del formulario (el cobro desde la web con `cobroPuenteEnServidor` apagada) tiene su propia copia de la regla, sin el filtro "aduana Colombia → solo casetas de Colombia" de la V00416. No se tocó. Cuando la bandera quede encendida para siempre, esa copia se puede borrar. **Resuelto en la V00469**: el formulario y Operaciones Activas ya usan `cobroAlCambiarStatus`.
- TAG: el grupo del puente usa la misma regla que el Acumulado (`grupoDeNombresPuente`: Colombia → PTC, AVI → AVI, lo demás → PT3). La regla está repetida en `tagPuente.ts`, que es puro (`historialCalculadoPuentes` importa Firebase). Sin puente ni tráfico, o sin peaje (`aplicaPeaje`), no se muestra.
- Asignación automática del formulario:
  - no pisa un puente guardado (salvo el que ella misma puso en esta sesión: `puenteAutoId`) ni uno elegido a mano (`puenteElegidoAMano`, también al editar el monto);
  - sigue funcionando aunque la tarjeta no se vea (como desde la V00364).
  - la guarda del puente guardado lee `initialData` y no `formData`: al reusar el formulario minimizado, el efecto puede correr con el `formData` de la operación anterior (lo encontró la revisión);
  - con `saldoPuente`, el objetivo y el TAG son los del puente cobrado, como en la ficha.
- Se quitaron `PUENTE_IMPORTACION_ID` y `PUENTE_EXPORTACION_ID`: el respaldo por tráfico busca por nombre en el catálogo, como el servidor.

## V00464 (reporte del puente AVI en Referencias de Puentes)
- Pedido de Omaf (20-oct): subir el Excel de cruces del portal del AVI y que el sistema una cada TAG # (= TAG AVI de Unidades Propias, V00457) con la unidad y, por fecha, devuelva las operaciones que coinciden.
- Lógica pura en `features/puentes/services/reporteAvi.ts` (+ pruebas): encabezado buscado en las primeras 30 filas; fechas del portal como mes/día/año (es de EE. UU.), también serie de Excel; tag comparable = solo dígitos sin ceros a la izquierda; monto "($23.75)" → 23.75.
- Coincidencia por unidad + fecha de servicio. Varias operaciones/cruces el mismo día: emparejamiento por cercanía entre la hora del cruce y la del Verde (bitácora `horarios`, la misma "Hora (Verde)" de la tabla); sin hora, por orden de referencia. Una operación se usa una sola vez.
- Solo SELECCIONA las que coinciden (y quedan listas para "Enviar al Acumulado" de siempre); no escribe nada. El reporte vive en pantalla (no se guarda). El LOCATION (Bridge 2/3/4) solo se muestra: todos los renglones son cobros del tag AVI.
- Se usan las operaciones que el módulo ya escucha (las 2,500 más recientes por fecha de servicio): si el reporte trae días anteriores, el panel lo avisa.
- El archivo se lee con un `<input type="file">` propio: no es un adjunto (no se sube a Storage), por eso no usa `AdjuntosArchivos`.
- Pendiente posible: poner el monto del AVI a las operaciones "sin monto de puente" desde el reporte (hoy se avisa y se usa "Asignar monto del puente").

## V00463 (aviso "internal" al guardar operaciones nuevas)
- El alert "internal" (minúsculas) es el `catch` de `handleSubmit` mostrando el mensaje de `crearOperacion`. El SDK de Functions pone "internal" como mensaje cuando NO hubo respuesta válida: `fetch` falló (red cortada, CORS de un rechazo de Cloud Run 429/500/503 sin cabeceras, instancia caída) o HTTP 500 sin JSON (ver `postJSON`/`codeForHTTPStatus(0)` en @firebase/functions). Una excepción no controlada de la función llega como "INTERNAL" (mayúsculas) y un HttpsError con su mensaje en español. No hay acceso a los registros de Cloud Run desde aquí: la causa exacta (red de la oficina vs. servidor) se confirma con Logging y con el Historial de actividad nuevo.
- Arreglo en el cliente, sin desplegar: `conReintentos` (services/reintentosCallable.ts) reintenta 3 veces (1.5 s y 4 s) los códigos pasajeros con el MISMO `clienteOpId` (crearOperacion ya era idempotente por `operaciones_idempotencia`); 30 s por intento. El formulario conserva el `clienteOpId` entre sus "Guardar" hasta guardar o cancelar (se limpia también al cargar otra operación): un segundo Guardar tras una falla cuya primera llamada sí llegó recibe `yaExistia` y se le aplica lo capturado ahora (`updateDoc` sin campos de control). renumerarOperacion también con reintentos (es idempotente).
- Mensaje final en español (con intentos, segundos y si el equipo estaba sin internet) y rastro en historial_actividad: 'Reintento' cuando se salvó al 2.º/3.er intento o por idempotencia, 'Error' cuando no.
- No se tocó el servidor. Si los registros muestran rechazos de Cloud Run (429/503) o instancias caídas, el siguiente paso es `minInstances: 1` / más memoria en crearOperacion (cuesta dinero: decidir con Omaf).

## V00462 (el T.C. sigue a la fecha también al abrir)
- Omaf (17-oct, con TR-151026-019): "el tipo de cambio debe cambiar conforme se cambia la fecha: si la fecha es hoy, el de hoy; si es ayer, el de ayer". La V00461 conservaba el T.C. guardado de una operación (por si se ajustó a mano) y solo avisaba; para su rol el campo está bloqueado por Autorizaciones, así que no aparecía "Usar el oficial" y no había forma de corregirla. Además, al regresar a la fecha original se restauraba el T.C. guardado (el malo).
- Ahora (`tcParaOperacionGuardada`, formulario/tipoCambioFila.ts): al abrir una guardada en su fecha, su T.C. pasa al oficial de su fecha (se guarda al Guardar; el aviso azul dice cuál traía). Excepciones: ya facturada (cliente o proveedor: cambiaría una factura emitida → aviso amarillo, se decide en Facturación o con "Usar el oficial" si el rol puede) y T.C. escrito a mano en esta sesión. Sin T.C. registrado para su fecha se queda el que trae.
- Un T.C. escrito a mano ya no sobrevive a volver a abrir la operación (regresa al oficial). Es la regla que pidió el negocio; si algún día hace falta un T.C. especial por operación, habría que guardar una marca de "a mano".
- La corrección automática respeta Autorizaciones: `tipoCambioAprobado` bloqueado en pantalla no cuenta como cambio del usuario (V00382), así que guardar no pide autorización.

## V00461 (Tipo de cambio de la operación = el de su fecha de servicio)
- Reporte de Facturación: TR-151026-019 (servicio del 15) con el T.C. del 16. Tres causas, reproducidas en el banco de pruebas:
  1. Al abrir una operación guardada, el efecto del T.C. corría primero con la fecha POR DEFECTO del formulario (hoy) y escribía el T.C. de hoy; al cargar su fecha ya no lo cambiaba (fecha = la inicial). Guardar dejaba el de hoy. Pasa en cualquier módulo que edita operaciones (Activas, Completados, Cancelados, editor embebido).
  2. Al cambiar la fecha a un día sin registro se quedaba el T.C. anterior y se mostraba como "TC Oficial".
  3. `buscarTCDeFecha` aceptaba un renglón si CUALQUIER campo tenía la fecha: el `createdAt` (UTC) de un T.C. capturado después de las ~7 p. m. lo hacía pasar por el del día siguiente. Lo mismo en la etiqueta de la tarjeta Tipo de cambio ("DOF de hoy" con el de ayer).
- Regla única en `shared/dominio/tipoCambio.ts`: el renglón de un día es el de su campo `fecha`; `tipoCambioAplicable`: sábado/domingo sin registro → el del viernes (misma regla con la que Tipo de Cambio crea esos días al capturar el viernes; la captura rápida de la tarjeta no los crea). Un día hábil sin registro → ninguno (no se toma otro día).
- Formulario: una operación GUARDADA no toma el T.C. de otra fecha hasta que el usuario cambia la fecha (`fechaServicioTocada`, se reinicia al cargar otra operación porque el formulario se reusa minimizado). Nueva o con fecha cambiada → el de esa fecha o 0; volver a la fecha original → su T.C. guardado. Guardada con 0 → se completa con el de su fecha. Guardada con otro → NO se cambia solo (pudo ajustarse a mano): `AvisoTipoCambio` lo marca en amarillo con "Usar el oficial" (oculto si Autorizaciones bloquea el campo).
- Operaciones ya guardadas con otro T.C.: `npm run revisar:tc` (functions/, solo lee) → distintos.csv y sin-tc.csv. Corregirlas cambia dinero (y las facturadas, su factura): decisión del negocio, se revisa el reporte antes.
- Pendiente (no se hizo): operaciones guardadas con 0 porque se crearon antes de capturar el T.C. del día siguen en 0 hasta que alguien las abre; completar el T.C. en el servidor al capturarlo sería otra versión (con bandera).

## V00460 (Últimas capturas de diesel: descuento y costo real)
- Columnas Descuento y Costo real en `ModalHistorialResumen` (tarjeta Diesel). Regla en `filasDiesel` (`resumenDia.ts`) con `DESCUENTO_MURPHY_POR_GALON` y `esCargaMurphy` de `shared/dominio/cobroDiesel.ts` (Murphy por el nombre guardado en `combustibles.proveedor`).
- El descuento se muestra en TODAS las fechas (a diferencia del estimado de las cargas, que empieza el 17-oct): aquí es información de precio y no mueve saldos.
- "más bajo" del modal pasa a ser por costo real. La tarjeta Diesel sigue mostrando el precio de lista más bajo de hoy (no se cambió: es el costo que se usa al capturar). Por litro sigue sin descuento.

## V00459 (Diesel: cobro real y descuento de Murphy)
- **Decisiones del usuario** (16-oct): el Descuento y el Monto cobrado se CAPTURAN del reporte de Murphy; mientras no, se estima $0.20 × galones (solo Murphy); el saldo descuenta lo cobrado; el estimado aplica desde `INICIO_DESCUENTO_MURPHY` = 2026-10-17 (las cargas anteriores quedan igual); Dif. monto = galones cargados × precio − cobrado. En el reporte real el descuento no siempre es 0.20 × todos los galones (DIESEL-151026-003: 81.29 gal, descuento $10.65 = 0.20 × 53.29), por eso manda lo capturado.
- **Regla en `shared/dominio/cobroDiesel.ts`** y `cargadoDiesel` (saldosCorrientes) la usa: así la tarjeta, la pestaña Saldos, el historial y el servidor descuentan lo mismo. Requiere desplegar `functions:referenciaDieselEscrita` (la única función que usa `cargadoDiesel`); con `saldosCorrientes` encendida, además correr `saldos:diesel`. Sin bandera nueva a propósito: para las referencias existentes (sin captura y con fecha < 17-oct, o en formato no ISO) el resultado es idéntico, así que el orden de deploy no cambia cifras actuales.
- `null` en `descuentoDiesel` / `montoCobrado` = no capturado (0 sí cuenta). El estimado solo con fecha AAAA-MM-DD (los registros viejos d/m/aaaa nunca lo reciben).
- **Confirmar cobro** escribe en transacción (es dinero) y solo reescribe galones/total/status si cambiaron los galones; sin costo por galón los galones quedan de solo lectura (se corrigen en Editar referencia).
- Murphy por nombre (`proveedorNombre` contiene "murphy"): limitación conocida, solo afecta al estimado. Si se renombra, poner su ID en una constante.
- El modal no va dentro de `FormularioConfigurable`: su etiqueta "Galones cargados" compartiría la llave de configuración con los otros formularios del módulo.

## V00458 (Otros Cruces: Caseta AVI predeterminada, puente seleccionable)
- El usuario pidió que la Caseta AVI sea solo el puente **predeterminado** de Otros Cruces (en la V00457 quedó fijo). `otroPuenteElegido` en null = `casetaAviOtrosCruces(puentesCatalogo)` (aunque el catálogo llegue después de abrir); al elegir otro se toma su `importe` y se limpia la referencia destino, porque la lista depende del grupo del puente (AVI / PT3 / PTC). Mismo patrón que `ModalAgregarSaldoPuente` (V00455).

## V00457 (TAG en Unidades, Acumulado en Puentes, Saldo Diesel)
- **TAG de puentes**: `tagAvi`, `tagPuente3`, `tagPuenteColombia` (opcionales en el tipo; las unidades viejas no los traen). `tagAvc` se quedó a pedido del usuario (no es el mismo dato).
- **"Completadas" en Operaciones sin asignar** = `esGrupoTerminado(estadoGrupoDe(op))`: completada **o falso**, la misma regla de Servicios Completados (`estados: ['completada','falso']`). Si el negocio quiere dejar fuera los Falsos, cambia a `estadoGrupoDe(op) === 'completada'` en `esCompletadaOp`.
- **Historial manual quitado**: el listener de `referencias_puentes` se queda (consecutivos y otros cruces viejos), y `handleEliminarReferencia` también (borra un otro cruce viejo desde Otros Cruces). Se quitó el detalle de "fecha de pago / período", que solo se alcanzaba desde esa pestaña.
- **Otros Cruces solo Caseta AVI**: `casetaAviOtrosCruces()` (puentesCatalogo.ts). Primero el nombre exacto de la tarjeta AVI (`puentePredeterminado`), si no la caseta AVI de nombre más corto sin paréntesis, para no bloquear los otros cruces por un nombre distinto en el catálogo.
- **Formulario de saldo de diesel compartido** (`ModalAgregarSaldoDiesel` + `guardarSaldoDiesel`), como el de puentes en V00455: el mismo `FormularioConfigurable modulo="referenciasDiesel"` y las mismas etiquetas (las claves de configuración salen del texto de la etiqueta). `SelectorProveedorBuscable` salió del dashboard con su CSS (`spd-`): desde Operaciones Activas el CSS del módulo de diesel no está cargado.
- **Historial del Saldo Diesel**: se calcula dentro del modal (perezoso) con los datos que ya escucha la tarjeta. Las sumas de lo cargado se hacen como la tarjeta (centavos del servidor, o `totalCargado` crudo de cada referencia) para que el saldo final cuadre al centavo; los totales del rango (`resumenDiesel`) sí van en centavos. En un mismo día el saldo agregado va antes que las cargas. El detalle de un día con `saldosCorrientes` lee `referencias_diesel` por rango de `fecha` (`>= dia`, `<= dia + \uf8ff`, para las que guardan hora); la clave de TanStack lleva cargas y monto del día para releer solo si cambió.
- **Banderas al montar** en TarjetaSaldoDiesel: espera `useFlagsCargadas()` (regla de CLAUDE.md que no cumplía desde V00441).
- `ModalMovimientosDiesel.css` reutiliza las clases `tmov-` importando `ModalMovimientosPuente.css` (no las redefine) y agrega las suyas con `tmd-`.
- Pendiente (sin pedir): el formulario de saldo de puentes (`ModalAgregarSaldoPuente`) no cierra con Escape; el de diesel sí.
- **16-oct, build de GitHub caído (V00457)**: entraron otra vez archivos de ServiExpress en `src/components/crud`, `src/components/ui` y `src/components/layout/*.tsx` (igual que el 29-sep, commit dfa0c40d); `verificar-imports` los detuvo en el prebuild. Se quitan comparando el árbol con la V00457 (`arreglar-build-V00457.sh`). También se quitaron los 5 CSS de ServiExpress que quedaron aquel día en `src/components/layout` (AppLayout, Sidebar, Topbar, UpdateNotice, ViewAsModal; nadie los importa). Causa probable: un zip de ServiExpress descomprimido dentro de Roelca-app y `git add src` en el Paso 1, que agrega todo lo que haya en src. La guía ahora corre `verificar-imports` antes del commit.

## V00456 (Operaciones Activas: tarjetas, completadas, TC/diesel y tablero)
- **Reglas del Resumen del día en un servicio** (`features/operaciones/services/resumenDia.ts`, puro + pruebas): fechas, tipo de cambio, completadas/canceladas, desglose por tipo. Antes vivían sueltas en App.tsx (`resumenNormalizarISO`, `resumenExtraerTC`, `resumenMejorFechaFila` y el ciclo de conteo); se movieron sin cambiar la regla.
- **Pestaña "Completadas hoy"**: la tarjeta la pide con `pedirCompletadasHoy()` (`services/pestanaCompletadas.ts`, contador + `useSyncExternalStore`) porque la tarjeta (App.tsx) y el tablero son hermanos. El tablero lee con `leerOperacionesDeHoy` (MISMA consulta `fechaServicio == hoy` que la tarjeta) y filtra con `esCompletadaDelDia`: el número de la tarjeta y la lista coinciden. Se relee al abrirla, al presionar Actualizar y al guardar una operación; con la pestaña abierta escucha el bus de operaciones (`suscribirOperacionGuardada`): una de hoy que se completa entra y una que deja de estar completada sale, sin releer. Solo se aplica la última lectura (`lecturaCompletadasRef`). Los pedidos hechos antes de montar el tablero no abren la pestaña (`pedidosVistosRef`). Las pestañas son un grupo de botones con `aria-pressed` (antes `tablist`): la ✕ de cerrar no puede vivir dentro de un tablist.
- **Modales de TC y diesel** (`ModalHistorialResumen`, perezoso): TanStack Query (`CLAVE_ULTIMOS_TC` / `CLAVE_ULTIMOS_DIESEL`), se invalidan al capturar desde las tarjetas. Consultas: `tipo_cambio where fecha <= hoy orderBy fecha desc limit 30` (la misma forma que ya usaba la tarjeta) y `combustibles orderBy fecha desc limit 40`. Los registros viejos con fecha d/m/aaaa no salen en el de TC (igual que en la tarjeta).
- **Tarjeta que se abre al presionarla**: `rd-card--clic` + `rd-card__abrir` en App.css (las de puente pasaron a usarlas; antes `tcas-card` en TarjetaCasetas.css).
- **Tablero rediseñado** (solo marcado y CSS, mismos handlers): `od-cabeza` (título + "Nueva operación"), `od-barra` (búsqueda + filtros + acciones; las herramientas de admin siguen detrás de "Vista"), `od-panel` (pestañas, tabla, pie). El color del tipo sale de la clase de la fila (`od-fila-op--<tipo>` → `--od-tipo`), ya no de `style` con `colorTipoOperacion`; Rentas pasa de gris a morado (igual que su pestaña). Se quitaron los `onMouseEnter/onMouseLeave` de los botones de acción y 10 `style={{` (17 → 7). Se borraron las reglas `od-x14…od-x47`, `od-tab-tipo*`, `od-btn-filtros`, `od-btn-monedas/reparar/manual/vista` (ya sin uso).
- Los selectores de la tabla llevan `.od-tabla` para ganarle a `.data-table th/td` de App.css; los botones de ícono llevan `padding: 0` porque el `button` global de index.css trae `padding: .6em 1.2em` (dejaba el ícono en 0 px).
- El `@keyframes spin` que usaba el botón Actualizar no existía (el ícono no giraba): ahora `od-giro`.
- Carga inicial: +3.3 KB (1.3 KB gzip) en `index`.
