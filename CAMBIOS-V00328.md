# V00328 — Autorizaciones solo para lo que SÍ se modificó (fix del falso aviso)

## Archivos que cambian (respetar rutas)
- `src/features/empresas/components/FormularioEmpresa.tsx`
- `src/config/version.ts` + `public/version.json` — V00328.

## El problema que corrige
Al guardar una empresa, la verificación de Autorizaciones recibía TODOS
los campos del formulario como si se hubieran modificado. Por eso pedía
autorización por el campo "Status" (u otro con regla) aunque nadie lo
hubiera tocado.

## La corrección
- Al abrir el formulario se toma una FOTO del estado inicial (ya
  normalizado con los catálogos).
- Al guardar, solo los campos cuyo valor REALMENTE cambió respecto de
  esa foto van a la verificación de Autorizaciones.
- Resultado: si un campo con regla no se toca, guardar NO pide
  autorización. Si se toca, todo funciona como hasta ahora (aviso, velo,
  "Agregar libre", solicitudes).
- Crear empresa nueva no cambia: la acción "crear" se evalúa igual.

## Verificación
- `tsc --noEmit` ✓ · eslint del formulario: 21 = baseline exacto ·
  `npm run build` completo ✓

## Al instalar
Reemplaza el archivo + versión, `npm run build` y publica.
