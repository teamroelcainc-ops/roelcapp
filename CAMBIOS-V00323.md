# V00323 — Auditoría al 80% de pantalla · ✓ Revisado · selección tridireccional que muestra SOLO el camino

## Archivos que cambian (respetar rutas)
- `src/features/facturacion/components/AuditoriaCadenaCliente.tsx` y `.css`
- `src/config/version.ts` + `public/version.json` — V00323.

## 1) 80% de la pantalla
El modal ocupa el 80% del ancho y ~86% del alto; las tres columnas
aprovechan todo el alto disponible (en pantallas angostas, 96%).

## 2) Botón ✓ REVISADO — y el orden que pediste
Cada operación, factura y pago trae el botón ✓:
- Al marcarlo, el registro queda como REVISADO (se guarda en el propio
  documento — campo auditRevisado — así que lo comparten todos los
  usuarios y se refleja en vivo) y SE VA AL FINAL de su columna, atenuado
  y con la referencia en verde. Otro clic quita la marca.
- El ORDEN de cada columna es: primero los que tienen ERRORES O FALLAS,
  luego los normales, y al final los revisados (dentro de cada grupo, por
  fecha más reciente).

## 3) Selección TRIDIRECCIONAL que oculta lo demás
- Clic en una OPERACIÓN → las columnas muestran SOLO su factura y los
  pagos de esa factura.
- Clic en una FACTURA → solo sus operaciones amparadas y sus pagos.
- Clic en un PAGO → solo sus facturas y las operaciones de esas facturas.
Todo lo que no pertenece al camino DESAPARECE hasta deseleccionar (clic
de nuevo en la pieza seleccionada). La tarjeta de problemas sigue
funcionando como resaltado (excluyente con la selección).

## Verificación
- `tsc --noEmit` ✓ · eslint del componente en 0 · `npm run build` ✓

## Al instalar
Reemplaza los 2 archivos + versión, `npm run build` y publica.
