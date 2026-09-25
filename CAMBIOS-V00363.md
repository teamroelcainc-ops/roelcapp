# V00363 — Status en los cruces del día · peaje SOLO al marcar Verde

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/TarjetaCasetas.tsx` y `.css`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00363.

## 1) El modal de la tarjeta muestra el STATUS de cada operación
Al hacer clic en "Gastado hoy", cada cruce enseña ahora su columna
**Status** (el status actual de la operación, en verde) y debajo la
marca con la que se cobró el peaje: **✓ Verde MX**, **✓ Verde USA** o
**✓ Completado**. Así verificas de un vistazo que nada se descontó
antes de tiempo.

## 2) El descuento SOLO ocurre al marcar Verde (garantía)
Desde la V00360 el peaje se cobra únicamente al registrar **Verde MX**
o **Verde USA** en los horarios (con Completado como respaldo por si el
verde no se marcó) — un "Documentado (Asignado)" u otro status NUNCA
descuenta. Ahora cada cobro guarda además QUÉ evento lo disparó
(saldoPuenteEvento), para que quede trazable en la tarjeta.

## 3) Sobre la sección "Caseta / Puente" del formulario
Esa sección (Puente / Puente Monto en Unidad y Operador) es de tu
V00356, que se hizo en otra sesión y NO está en mi copia — para
ocultarla hasta que la operación marque Verde MX/USA necesito tu
`FormularioOperacion.tsx` ACTUAL (mándamelo y lo integro en la
siguiente entrega sin pisar nada). OJO: esos campos (puenteMonto) son
informativos y NO son los que descuentan el saldo — el descuento usa
saldoPuente y solo se escribe al marcar verde/completado.

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127 = baseline exacto,
  tarjeta 0 · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
