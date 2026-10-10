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
