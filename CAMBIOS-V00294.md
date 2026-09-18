# V00294 — Servicios Completados: datos solo al presionar Buscar y botón "Ver en nueva pestaña"

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/ServiciosCompletados.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00294.

## 1) Los datos aparecen SOLO al presionar Buscar
Antes el módulo restauraba tu último filtro y buscaba solo al entrar.
Ahora, al abrir: los campos del panel se PRECARGAN con tu último criterio
(para no reteclearlo), el panel de Filtros se abre solo, y la tabla queda
vacía hasta que presiones **Buscar**.

## 2) Botón "↗ Ver en nueva pestaña" tras buscar
Al presionar Buscar aparece en dos lugares: junto a los chips del resumen
(arriba de la tabla) y dentro del panel de Filtros, debajo de Buscar. Abre
la app en otra pestaña con la BÚSQUEDA COMPLETA aplicada — todos los
filtros del panel serializados en la URL (`?filtros=…`) más la tarjeta si
hay una activa (`&tarjeta=…`): la pestaña nueva llega directo al mismo
resultado, sin volver a filtrar.

## Deep-links (cómo queda el montaje)
- URL con `?filtros=…` → aplica y busca de inmediato (es el botón nuevo).
- URL con solo `?tarjeta=…` (tarjetas V00293) → usa tu último criterio
  guardado y busca, para que la tarjeta tenga datos que filtrar.
- Sin parámetros → precarga inputs, abre el panel y espera tu Buscar.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: 163 — idéntico a su base.
- `npm run build`: OK (PWA generada).
