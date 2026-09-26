# V00378 — "Registrar Movimiento" ESTRICTO a la regla del flujo

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx` y `.css`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00378.

## Qué cambia
Tenías razón: cuando la operación no tenía flujo configurado, el
desplegable caía al catálogo COMPLETO y cualquiera podía marcar lo que
quisiera. Ahora es estricto:
1. El desplegable ofrece **ÚNICAMENTE los estatus del flujo** de esa
   operación (Servicio + Tráfico + Carga), en su orden — se eliminó el
   respaldo con la lista completa.
2. Si esa combinación **no tiene flujo** en Reglas de Estatus, el
   desplegable queda **deshabilitado** con el aviso: "⚠ Esta operación
   no tiene un flujo en Configuración → Reglas de Estatus.
   Configúralo y guárdalo para habilitar el registro de movimientos."
   (Tu ejemplo era Logística Fletes · Importación · Cargado — crea su
   flujo y el registro se habilita solo.)
3. **El guardado también valida**: aunque algo se colara, solo se
   registra un estatus que pertenezca a la regla.

Recuerda que los flujos se cachean 6 horas — tras crear/guardar un
flujo nuevo, recarga con Ctrl+Shift+R para verlo al instante.

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127 = baseline exacto ·
  `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
