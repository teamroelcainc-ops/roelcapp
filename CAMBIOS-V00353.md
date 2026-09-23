# V00353 — RAZÓN SOCIAL en los documentos generados

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/ServiciosCancelados.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00353.

## Qué cambia
Al generar los documentos de una operación (Solicitud de Retiro,
Check List, Instrucciones de Servicio, etc. — desde Operaciones y desde
Servicios Cancelados), el CLIENTE (MERCANCÍA) y el PROVEEDOR se
resuelven ahora contra la ficha de la empresa y se imprime su
**RAZÓN SOCIAL** (el campo que capturaste en la V00343). El orden es:
razón social de la empresa → nombre guardado en la operación → nombre de
la empresa. Ejemplo: la Solicitud de Retiro de tu captura dirá el nombre
completo de GTA en cuanto captures su Razón Social en la ficha.

## Recuerda
Para las empresas que aún muestran el nombre corto (como "GTA"): edita
la empresa → captura su **Razón Social** → los documentos la usan de
inmediato (no hace falta re-guardar operaciones).

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127 = baseline exacto,
  Cancelados 139 (uno MEJOR que su baseline) · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
