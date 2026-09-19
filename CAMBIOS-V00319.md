# V00319 — Auditoría: el buscador ofrece SOLO clientes que pagan

## Archivos que cambian (respetar rutas)
- `src/features/facturacion/components/AuditoriaCadenaCliente.tsx`
- `src/config/version.ts` + `public/version.json` — V00319.

## Qué cambia
En el modal "🔍 Auditar cliente" de Facturación de Clientes, el buscador
ya no lista todas las empresas: ofrece SOLO los clientes que PAGAN —
- las empresas con tipo "Cliente (Paga)" en el catálogo, y
- como respaldo, las que aún no tienen el tipo asignado pero SÍ tienen
  registros en el Tarifario de Clientes (para no dejar fuera a un cliente
  real mal catalogado).

## Verificación
- `tsc --noEmit` ✓ · eslint del componente en 0 · `npm run build` ✓

## Al instalar
Reemplaza el archivo + versión, `npm run build` y publica.
