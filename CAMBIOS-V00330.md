# V00330 — El Historial de Cambios se llena SOLO (registro automático por versión)

> Requiere tener instalada la V00329 (donde nació el módulo).

## Archivos que cambian (respetar rutas)
- `src/config/historialCambios.ts` — **NUEVO**
- `src/features/historialCambios/HistorialCambiosDashboard.tsx` y `.css`
- `src/config/version.ts` + `public/version.json` — V00330.

## Qué cambia
1) **Registro automático**: las actualizaciones de la app ahora viajan
   CON el código en `src/config/historialCambios.ts`. Al publicar una
   versión, el Historial de Cambios ya la muestra — sin capturar nada.
   Cada entrega futura incluirá este archivo actualizado con su entrada
   en lenguaje cotidiano. Estas entradas se marcan con "⚙ auto" y no se
   editan ni borran desde la pantalla (viven en el código).

2) **Sembrado con las últimas entregas**: V00311 → V00330 ya vienen
   registradas con su fecha, título y explicación sencilla, listas para
   el informe de WhatsApp. (Las fechas de las entregas pasadas son las
   de su entrega aproximada; si me pasas el registro exacto, las ajusto
   en el archivo.)

3) **Convivencia con lo manual**: lo que registres a mano (➕ o
   importación masiva) se combina en la misma lista y en el informe. Si
   una versión se registra a mano, la manual manda sobre la automática.

## Verificación
- `tsc --noEmit` ✓ · eslint del módulo y el config en 0 ·
  `npm run build` completo ✓

## Al instalar
Copia el archivo NUEVO a src/config/, reemplaza los 2 del módulo +
versión, `npm run build` y publica.
