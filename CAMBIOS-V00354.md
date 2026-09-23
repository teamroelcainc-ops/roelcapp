# V00354 — Cliente (Mercancía) con RAZÓN SOCIAL

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00354.

## Qué cambia
En el formulario de la operación, el campo **Cliente (Mercancía)**:
- Las sugerencias del buscador muestran la RAZÓN SOCIAL de cada empresa
  (el campo capturado en la ficha, V00343); si no tiene, su nombre.
- Al elegir (o al crear con ➕), el campo queda con la razón social, y
  ESO es lo que se guarda como nombre en la operación — por eso también
  sale en los documentos, tablas y auditorías.
- Al reabrir una operación, el campo muestra la razón social actual de
  la empresa aunque el registro viejo tenga el nombre corto.
- El helper de razón social ahora prioriza el campo Razón Social de la
  ficha en TODO el formulario (Cliente Paga y Proveedor de Transporte ya
  lo usaban desde la V00271).

## Recuerda
Captura la Razón Social en la ficha de las empresas que hoy muestran
nombre corto (Global Textile, GTA, etc.) — todo lo demás es automático.

## Verificación
- `tsc --noEmit` ✓ · eslint: 377 = baseline exacto · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
