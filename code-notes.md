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
- **Una sola pestaña con caché en disco** (`persistentSingleTabManager`) hasta la Fase 7: `almacenSesion` (Servicios Completados) y el conteo de Empresas todavía copian operaciones a localStorage; el manager multi-pestaña escribe en localStorage y con la cuota llena tumbaba Firestore (V00109). El guardián de 3.5 MB se conserva para esas claves.
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
