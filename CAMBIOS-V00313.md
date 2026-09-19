# V00313 — Modal "Convenios del Cliente/Proveedor": # de tarifario legible, desplegable Tarifa A/B y base relacional EN VIVO

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/FormularioOperacion.tsx` y `FormularioOperacion.css`
- `src/config/version.ts` + `public/version.json` — V00313.

## 1) El # Tarifario ya no sale como ID
El FK `tarifarioId` del detalle guarda el ID del documento (p. ej.
t6Y41HruWsE6lu0PexGa) — es lo correcto para la relación, pero no para
mostrarse. Ahora se TRADUCE al consecutivo del tarifario (TARI-### /
TARP-###) con el mapa id → consecutivo; si el dato ya viene como
consecutivo queda igual. Aplica a ambos modales (cliente y proveedor).

## 2) Convenios con varias tarifas: desplegable Tarifa A / Tarifa B
Si el convenio tiene varios montos (montos[] de V00304), junto al monto
aparece una flecha ▸ con el número de tarifas. Al desplegarla se ven las
subfilas "↳ Tarifa A", "↳ Tarifa B"… con su monto (la vigente trae la
etiqueta verde) y un clic en la subfila usa el convenio CON ESA tarifa en
la operación. La elección se respeta (el recálculo del monto vigente no
la pisa mientras siga elegido ese convenio); la fila principal o el botón
"↻ Actualizar monto" regresan a la tarifa vigente. En ambos lados.

## 3) Base relacional EN VIVO en el formulario
Convenios maestros, detalles y tarifarios de AMBOS lados dejan el getDocs
de una sola vez y pasan a onSnapshot mientras el formulario está abierto:
cualquier cambio en Convenio de Clientes/Proveedores o en los tarifarios
(montos, monedas, status, tarifas nuevas) se refleja AL MOMENTO en la
tabla del modal y en los montos del formulario, sin cerrar ni recargar.
Las cachés cat_v2__ se mantienen al día con cada snapshot.

## Verificación
- `tsc --noEmit` ✓ · eslint del formulario: 377 problemas = su baseline
  EXACTO (los preexistentes; nada nuevo) · `npm run build` completo ✓

## Al instalar
Reemplaza los 2 archivos + versión, `npm run build` y publica.
