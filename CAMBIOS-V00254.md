# V00254 — Modal "Exportar a Excel": 3 columnas y reordenado solo con Drag & Drop

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/ServiciosCompletados.tsx` y `.css`
- `src/features/operaciones/components/ServiciosCancelados.tsx` y `.css` (espejo)
- `src/config/version.ts` y `public/version.json` — bump a V00254.

## Qué hace
- La lista de columnas del modal ahora es una CUADRÍCULA DE 3 COLUMNAS
  (el modal se ensanchó de 480px a 880px; en pantallas angostas < 760px
  vuelve a 1 columna para no encimarse).
- El orden se cambia SOLO arrastrando (Drag & Drop): se retiraron las
  flechas ▲▼, que además no tenían sentido en cuadrícula.
- Mejora del arrastre: la tarjeta destino se RESALTA mientras arrastras
  (verde en Completados, rojo en Cancelados, el color de cada módulo) y el
  cursor cambia a "agarrando". El checkbox sigue incluyendo/excluyendo.
- Se aplicó igual en Servicios Cancelados, que tiene el mismo modal, para
  que ambos se comporten idéntico.

## Convenciones
- Los estilos de la fila pasaron de inline a clases CSS con modificadores
  (.sc-export-tarjeta / --apagada / --destino), como marca el CLAUDE.md:
  los inline styles del archivo BAJARON (Completados 42→38, Cancelados 18→14).

## Verificación
- `tsc --noEmit`: 0 errores.
- ESLint: mismos problemas preexistentes que el original (164 y 139) —
  ninguno nuevo.
- `npm run build`: OK (PWA generada).
