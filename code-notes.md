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
