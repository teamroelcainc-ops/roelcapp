# V00253 — Estadísticas: las operaciones de meses anteriores (migradas) ya cuentan

## Archivos que cambian (respetar rutas)
- `src/features/estadisticas/components/EstadisticasOperativas.tsx`
- `src/features/estadisticas/components/EstadisticasDashboard.tsx` (1 línea)
- `src/config/version.ts` y `public/version.json` — bump a V00253.

## El problema
La pestaña "Diario · Semanal · Mensual · Clientes" leía los datos SOLO con el
formato de las operaciones nuevas. Las operaciones de meses anteriores vienen
de la migración de AppSheet y guardan lo mismo con otros nombres/formatos, así
que los filtros las dejaban fuera (por eso con "Hazmat" solo salían agosto y
septiembre):
- El Cargada/Vacía puede venir en `cargadoVacio` (columna de AppSheet) o como
  ID del catálogo — antes solo se leía `carga`/`estadoCarga`/`cargaVacia`.
- El tipo de operación puede venir solo como `tipoOperacionId` — antes solo se
  leía el nombre.
- La fecha puede venir como `d/m/aaaa` — antes solo se entendía `aaaa-mm-dd`.

## El arreglo
- Resolvedores tolerantes en EstadisticasOperativas: C/V y Tipo se normalizan
  contra los catálogos (nombre directo, campo viejo de AppSheet o ID), y la
  fecha acepta ambos formatos (misma lógica fechaISODe que ya usaba el
  Dashboard). Aplica a Diario, Semanal, Mensual, Por cliente y Tipo × C/V,
  y a los chips de filtro.
- En el Desglose del Dashboard, la dimensión C/V también lee `cargadoVacio`.

## Verificación
- `tsc --noEmit`: 0 errores.
- ESLint: mismos problemas preexistentes que el original (Operativas: 5,
  Dashboard: 32) — ninguno nuevo.
- Sin inline styles nuevos. `npm run build`: OK (PWA generada).

## Nota
Si después de esto algún mes siguiera en cero, el siguiente sospechoso sería
que esas operaciones migradas tengan `fechaServicio` en formato d/m/aaaa EN LA
BASE: la consulta a Firestore filtra por rango de texto y esas quedarían fuera
de la carga misma. En ese caso lo correcto es normalizar las fechas en la
base con una utilidad de migración — avísame y la armo.
