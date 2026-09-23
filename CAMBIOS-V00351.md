# V00351 — El formulario de Saldos de Puentes es un MODAL

## Archivos que cambian (respetar rutas)
- `src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx` y `.css`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00351.

## Qué cambia
El formulario ya no vive en el encabezado: el botón **➕ Registrar
saldo** (arriba a la derecha) abre un MODAL centrado con la fecha, el
puente (del catálogo Tipos de Gastos) y el saldo; el ✎ de cada fila abre
el mismo modal en modo edición. Cancelar, clic fuera o Guardar lo
cierran. Todo lo demás igual: un registro por puente y fecha, y el saldo
más reciente actualiza el catálogo.

## Verificación
- `tsc --noEmit` ✓ · eslint 0 · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
