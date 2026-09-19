# V00315 — Unir duplicados con información completa de cada registro

## Archivos que cambian (respetar rutas)
- `src/features/empresas/components/EmpresasDashboard.tsx`
- `src/config/version.ts` + `public/version.json` — V00315.

## Qué cambia
En el modal "Unir registros duplicados", cada candidato ahora muestra la
información para decidir con criterio cuál conservar:
- **Papeles de la empresa** (en azul): Cliente (Paga), Proveedor
  (Servicios), Cliente (Mercancía), Origen/Destino, Bodega… — o "Sin tipo
  de empresa asignado".
- **Datos del registro**: # de cliente, RFC, status y fecha de alta.
- **Cuántas operaciones tiene registradas** (en cualquier papel: paga,
  mercancía, proveedor, unidad, origen o destino; cada operación cuenta
  una sola vez). En ámbar cuando tiene operaciones; "⏳ Contando…"
  mientras el conteo global termina de cargar.

Recordatorio del propio modal: las referencias del registro eliminado
(operaciones, facturación, convenios, unidades, diesel y documentos) se
REAPUNTAN al conservado — no se pierde nada al unir.

## Verificación
- `tsc --noEmit` ✓ · eslint: 71 problemas (uno MENOS que su baseline de
  72 — se aprovechó para quitar un `any` viejo del mismo renglón) ·
  `npm run build` completo ✓

## Al instalar
Reemplaza el archivo + versión, `npm run build` y publica.
