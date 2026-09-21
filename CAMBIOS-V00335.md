# V00335 — Auditoría por empresa: rango de fechas + moneda de la empresa

## Archivos que cambian (respetar rutas)
- `src/features/empresas/components/AuditoriaCadenaEmpresa.tsx` y `.css`
- `src/config/historialCambios.ts` (entrada automática de esta versión)
- `src/config/version.ts` + `public/version.json` — V00335.

## Qué cambia
En la auditoría de la cadena por empresa (botón 🔍 de la ficha):

1) **Rango de fechas** — "Servicio de [fecha] a [fecha]" bajo las
   pestañas. Filtra las OPERACIONES por su fecha de servicio (acepta
   también las fechas d/m/aaaa de las migradas); la facturación y los
   pagos de la empresa se muestran completos. El ✕ quita el rango y el
   filtro es en vivo: recalcula columnas y totales al momento, en las
   tres pestañas (Paga / Mercancía / Proveedor).

2) **Moneda de la empresa** — chip junto al rango con la moneda
   configurada en la ficha de la empresa (USD/MXN), como en el auditor
   de Facturación.

## Verificación
- `tsc --noEmit` ✓ · eslint del componente en 0 · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
